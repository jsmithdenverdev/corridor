import Anthropic from '@anthropic-ai/sdk';

import { suggestIncidentPenalty } from '../vibe/calculator';

import type {
  CdotIncident,
  IncidentNormalization,
  NormalizedIncident,
} from '@corridor/shared';
import { IncidentNormalizationSchema, VIBE_PENALTIES } from '@corridor/shared';

/**
 * System prompt for incident normalization
 * Only used to clean up dirty CDOT text and assess severity
 */
const SYSTEM_PROMPT = `You are a traffic incident analyst. Your job is to:
1. Clean up messy CDOT incident text into a clear, brief summary (max 80 chars)
2. Assess the severity penalty for the vibe score

Penalty guide:
- Road closure (full closure, blocked): ${VIBE_PENALTIES.ROAD_CLOSURE}
- Lane closure (partial, one lane): ${VIBE_PENALTIES.LANE_CLOSURE}
- Minor (traction law, advisory): 1
- Informational only: 0

Respond in JSON only:
{"summary": "<clean text>", "penalty": <number>}`;

/**
 * Hash message for caching
 * Using simple hash for deduplication
 */
const hashMessage = (message: string): string => {
  // Simple hash function
  let hash = 0;
  for (let i = 0; i < message.length; i++) {
    const char = message.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash.toString(16);
};

/**
 * Parse Claude's JSON response
 */
const parseResponse = (text: string): IncidentNormalization => {
  // Handle potential markdown wrapping
  let jsonText = text.trim();
  if (jsonText.startsWith('```')) {
    jsonText = jsonText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }

  const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('No JSON in response');
  }

  const parsed = JSON.parse(jsonMatch[0]);
  const result = IncidentNormalizationSchema.safeParse(parsed);

  if (!result.success) {
    throw new Error(`Invalid response: ${result.error.message}`);
  }

  return result.data;
};

/**
 * Fallback normalization without AI
 */
const fallbackNormalization = (
  message: string,
  incidentType: string,
  severity: 'major' | 'moderate' | 'minor'
): IncidentNormalization => {
  // Truncate and clean up message
  let summary = message
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 80);

  if (summary.length === 80) {
    summary = summary.substring(0, 77) + '...';
  }

  // Use heuristic penalty
  const penalty = suggestIncidentPenalty(incidentType, severity);

  return { summary, penalty };
};

/**
 * Call Claude to normalize incident text
 */
const normalizeWithAI = async (
  anthropicClient: Pick<Anthropic, 'messages'>,
  message: string,
  incidentType: string,
  severity: 'major' | 'moderate' | 'minor'
): Promise<IncidentNormalization> => {
  const userPrompt = `Incident type: ${incidentType}
Severity: ${severity}
Raw message: "${message}"`;

  const response = await anthropicClient.messages.create({
    model: 'claude-3-haiku-20240307',
    max_tokens: 100,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const textContent = response.content.find((c) => c.type === 'text');
  if (!textContent || textContent.type !== 'text') {
    throw new Error('No text response from Claude');
  }

  return parseResponse(textContent.text);
};

/**
 * Extended incident data for audit trail
 */
export type NormalizedIncidentWithAudit = NormalizedIncident & {
  incidentType: string;
  startMarker: number;
  endMarker: number;
  fromCache: boolean;
  cacheHash: string;
};

export type IncidentNormalizer = {
  normalizeIncidents: (
    incidents: CdotIncident[],
    getCached: (hash: string) => Promise<{ summary: string; penalty: number } | null>,
    setCache: (hash: string, summary: string, penalty: number) => Promise<void>
  ) => Promise<{
    normalized: NormalizedIncident[];
    normalizedWithAudit: NormalizedIncidentWithAudit[];
    newCount: number;
    cachedCount: number;
  }>;
};

/**
 * Incident Normalizer Factory
 *
 * Uses Claude to clean up dirty CDOT incident text.
 * Implements hash-based caching to avoid re-processing identical messages.
 */
export const createIncidentNormalizer = (
  anthropicClient: Pick<Anthropic, 'messages'>
): IncidentNormalizer => {
  return {
    /**
     * Normalize a list of incidents
     *
     * @param incidents Raw CDOT incidents
     * @param getCached Function to get cached normalization by hash
     * @param setCache Function to store normalization in cache
     */
    normalizeIncidents: async (
      incidents: CdotIncident[],
      getCached: (hash: string) => Promise<{ summary: string; penalty: number } | null>,
      setCache: (hash: string, summary: string, penalty: number) => Promise<void>
    ): Promise<{
      normalized: NormalizedIncident[];
      normalizedWithAudit: NormalizedIncidentWithAudit[];
      newCount: number;
      cachedCount: number;
    }> => {
      const normalized: NormalizedIncident[] = [];
      const normalizedWithAudit: NormalizedIncidentWithAudit[] = [];
      let newCount = 0;
      let cachedCount = 0;

      for (const incident of incidents) {
        const message = incident.properties.travelerInformationMessage;
        const hash = hashMessage(message);

        // Check cache first
        const cached = await getCached(hash);

        if (cached) {
          // Use cached normalization
          const base = {
            id: incident.properties.id,
            originalMessage: message,
            summary: cached.summary,
            penalty: cached.penalty,
            severity: incident.properties.severity,
          };
          normalized.push(base);
          normalizedWithAudit.push({
            ...base,
            incidentType: incident.properties.type,
            startMarker: incident.properties.startMarker,
            endMarker: incident.properties.endMarker,
            fromCache: true,
            cacheHash: hash,
          });
          cachedCount++;
          continue;
        }

        // Normalize with AI
        try {
          const result = await normalizeWithAI(
            anthropicClient,
            message,
            incident.properties.type,
            incident.properties.severity
          );

          // Cache the result
          await setCache(hash, result.summary, result.penalty);

          const base = {
            id: incident.properties.id,
            originalMessage: message,
            summary: result.summary,
            penalty: result.penalty,
            severity: incident.properties.severity,
          };
          normalized.push(base);
          normalizedWithAudit.push({
            ...base,
            incidentType: incident.properties.type,
            startMarker: incident.properties.startMarker,
            endMarker: incident.properties.endMarker,
            fromCache: false,
            cacheHash: hash,
          });
          newCount++;
        } catch (error) {
          console.error(`Failed to normalize incident ${incident.properties.id}:`, error);

          // Use fallback
          const fallback = fallbackNormalization(
            message,
            incident.properties.type,
            incident.properties.severity
          );

          const base = {
            id: incident.properties.id,
            originalMessage: message,
            summary: fallback.summary,
            penalty: fallback.penalty,
            severity: incident.properties.severity,
          };
          normalized.push(base);
          normalizedWithAudit.push({
            ...base,
            incidentType: incident.properties.type,
            startMarker: incident.properties.startMarker,
            endMarker: incident.properties.endMarker,
            fromCache: false,
            cacheHash: hash,
          });
          newCount++;
        }
      }

      return { normalized, normalizedWithAudit, newCount, cachedCount };
    },
  };
};
