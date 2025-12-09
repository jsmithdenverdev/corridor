/**
 * AI Summary Generator
 *
 * Uses Claude to generate natural language narrative summaries
 * for traffic conditions. Implements hash-based caching to
 * minimize API costs.
 */

import Anthropic from '@anthropic-ai/sdk';

import type { NarrativeSummaryInput, NarrativeSummaryResult } from '@corridor/shared';

/**
 * System prompt for narrative generation
 */
const SYSTEM_PROMPT = `You are a friendly traffic reporter for Colorado's I-70 ski corridor. Generate a brief, natural-sounding traffic update (2-3 sentences max, under 200 characters).

Guidelines:
- Be conversational and helpful, not robotic
- Focus on actionable information
- Mention specific conditions that matter (incidents, weather, delays)
- Don't repeat the vibe score number
- Use present tense
- If conditions are good, keep it short

Examples:
- "Clear roads and smooth traffic through the tunnel. Perfect conditions for the drive up."
- "A fender-bender near MM 220 is causing backups. Expect 15-20 min delays through this stretch."
- "Roads are wet with scattered snow. Traffic moving steadily but allow extra time."`;

/**
 * Build user prompt from segment data
 */
const buildUserPrompt = (input: NarrativeSummaryInput): string => {
  const parts: string[] = [
    `Segment: ${input.segmentName}`,
    `Current conditions: ${input.vibeScore >= 7 ? 'Good' : input.vibeScore >= 4 ? 'Moderate' : 'Poor'} (${input.vibeScore.toFixed(1)}/10)`,
    `Trend: ${input.trend.toLowerCase()}`,
  ];

  if (input.impliedSpeedMph && !input.speedAnomalyDetected) {
    parts.push(`Traffic speed: ~${input.impliedSpeedMph} mph`);
  }

  if (input.roadCondition) {
    parts.push(`Road condition: ${input.roadCondition}`);
  }

  if (input.weatherSurface) {
    parts.push(`Surface: ${input.weatherSurface}`);
  }

  if (input.incidents.length > 0) {
    parts.push('Active incidents:');
    input.incidents.forEach((i) => {
      parts.push(`  - ${i.summary} (${i.severity})`);
    });
  } else {
    parts.push('No active incidents');
  }

  return parts.join('\n');
};

/**
 * Generate hash from input data for caching
 * Only includes data that would materially change the narrative
 */
const generateInputHash = (input: NarrativeSummaryInput): string => {
  const hashInput = JSON.stringify({
    segmentName: input.segmentName,
    // Bucket vibe score to reduce churn (round to nearest 0.5)
    vibeScore: Math.round(input.vibeScore * 2) / 2,
    // Include incident summaries (already normalized)
    incidents: input.incidents.map((i) => i.summary).sort(),
    // Weather/road conditions
    roadCondition: input.roadCondition,
    weatherSurface: input.weatherSurface,
    // Trend direction
    trend: input.trend,
    // Speed anomaly flag
    speedAnomalyDetected: input.speedAnomalyDetected,
  });

  // Simple hash function (same as incident cache)
  let hash = 0;
  for (let i = 0; i < hashInput.length; i++) {
    const char = hashInput.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return hash.toString(16);
};

/**
 * Summary Generator interface
 */
export type SummaryGenerator = {
  generateNarrative: (
    input: NarrativeSummaryInput,
    getCached: (hash: string) => Promise<string | null>,
    setCache: (hash: string, narrative: string) => Promise<void>
  ) => Promise<NarrativeSummaryResult>;
};

/**
 * Create a summary generator instance
 *
 * @param anthropicClient - Anthropic API client
 * @returns SummaryGenerator instance
 */
export const createSummaryGenerator = (
  anthropicClient: Pick<Anthropic, 'messages'>
): SummaryGenerator => {
  return {
    generateNarrative: async (
      input: NarrativeSummaryInput,
      getCached: (hash: string) => Promise<string | null>,
      setCache: (hash: string, narrative: string) => Promise<void>
    ): Promise<NarrativeSummaryResult> => {
      const hash = generateInputHash(input);

      // Check cache first
      try {
        const cached = await getCached(hash);
        if (cached) {
          return { narrative: cached, hash, fromCache: true };
        }
      } catch (error) {
        console.error('Failed to check narrative cache:', error);
        // Continue to generate fresh
      }

      // Generate with Claude
      try {
        const response = await anthropicClient.messages.create({
          model: 'claude-3-haiku-20240307',
          max_tokens: 150,
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: buildUserPrompt(input) }],
        });

        const textContent = response.content.find((c) => c.type === 'text');
        if (!textContent || textContent.type !== 'text') {
          throw new Error('No text response from Claude');
        }

        const narrative = textContent.text.trim();

        // Cache the result (don't block on cache write)
        setCache(hash, narrative).catch((error) => {
          console.error('Failed to cache narrative:', error);
        });

        return { narrative, hash, fromCache: false };
      } catch (error) {
        console.error('Failed to generate narrative:', error);
        // Return empty narrative - headline will still display
        return { narrative: '', hash, fromCache: false };
      }
    },
  };
};
