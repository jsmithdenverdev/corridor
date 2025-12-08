import Anthropic from '@anthropic-ai/sdk';
import {
  IncidentNormalizationSchema,
  VIBE_PENALTIES,
  type CdotIncident,
  type NormalizedIncident,
  type IncidentNormalization,
} from '@corridor/shared';
import { suggestIncidentPenalty } from '../vibe/calculator';

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

interface IncidentNormalizerConfig {
  apiKey: string;
  maxRetries?: number;
  timeout?: number;
}

/**
 * Incident Normalizer
 *
 * Uses Claude to clean up dirty CDOT incident text.
 * Implements hash-based caching to avoid re-processing identical messages.
 */
export class IncidentNormalizer {
  private client: Anthropic;

  constructor(config: IncidentNormalizerConfig) {
    this.client = new Anthropic({
      apiKey: config.apiKey,
      maxRetries: config.maxRetries ?? 2,
      timeout: config.timeout ?? 30000,
    });
  }

  /**
   * Normalize a list of incidents
   *
   * @param incidents Raw CDOT incidents
   * @param getCached Function to get cached normalization by hash
   * @param setCache Function to store normalization in cache
   */
  async normalizeIncidents(
    incidents: CdotIncident[],
    getCached: (hash: string) => Promise<{ summary: string; penalty: number } | null>,
    setCache: (hash: string, summary: string, penalty: number) => Promise<void>
  ): Promise<{ normalized: NormalizedIncident[]; newCount: number; cachedCount: number }> {
    const normalized: NormalizedIncident[] = [];
    let newCount = 0;
    let cachedCount = 0;

    for (const incident of incidents) {
      const message = incident.properties.travelerInformationMessage;
      const hash = this.hashMessage(message);

      // Check cache first
      const cached = await getCached(hash);

      if (cached) {
        // Use cached normalization
        normalized.push({
          id: incident.properties.id,
          originalMessage: message,
          summary: cached.summary,
          penalty: cached.penalty,
          severity: incident.properties.severity,
        });
        cachedCount++;
        continue;
      }

      // Normalize with AI
      try {
        const result = await this.normalizeWithAI(
          message,
          incident.properties.type,
          incident.properties.severity
        );

        // Cache the result
        await setCache(hash, result.summary, result.penalty);

        normalized.push({
          id: incident.properties.id,
          originalMessage: message,
          summary: result.summary,
          penalty: result.penalty,
          severity: incident.properties.severity,
        });
        newCount++;
      } catch (error) {
        console.error(`Failed to normalize incident ${incident.properties.id}:`, error);

        // Use fallback
        const fallback = this.fallbackNormalization(
          message,
          incident.properties.type,
          incident.properties.severity
        );

        normalized.push({
          id: incident.properties.id,
          originalMessage: message,
          summary: fallback.summary,
          penalty: fallback.penalty,
          severity: incident.properties.severity,
        });
        newCount++;
      }
    }

    return { normalized, newCount, cachedCount };
  }

  /**
   * Call Claude to normalize incident text
   */
  private async normalizeWithAI(
    message: string,
    incidentType: string,
    severity: 'major' | 'moderate' | 'minor'
  ): Promise<IncidentNormalization> {
    const userPrompt = `Incident type: ${incidentType}
Severity: ${severity}
Raw message: "${message}"`;

    const response = await this.client.messages.create({
      model: 'claude-3-haiku-20240307',
      max_tokens: 100,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const textContent = response.content.find((c) => c.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      throw new Error('No text response from Claude');
    }

    return this.parseResponse(textContent.text);
  }

  /**
   * Parse Claude's JSON response
   */
  private parseResponse(text: string): IncidentNormalization {
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
  }

  /**
   * Fallback normalization without AI
   */
  private fallbackNormalization(
    message: string,
    incidentType: string,
    severity: 'major' | 'moderate' | 'minor'
  ): IncidentNormalization {
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
  }

  /**
   * Hash message for caching
   * Using simple hash for deduplication
   */
  private hashMessage(message: string): string {
    // Simple hash function
    let hash = 0;
    for (let i = 0; i < message.length; i++) {
      const char = message.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash.toString(16);
  }
}
