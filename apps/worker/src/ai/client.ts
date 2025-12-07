import Anthropic from '@anthropic-ai/sdk';
import { VibeCheckResponseSchema, type VibeCheckResult } from '@corridor/shared';

/**
 * System prompt for the vibe check
 * Focuses on producing actionable, friendly summaries for mobile display
 */
const SYSTEM_PROMPT = `You are a friendly traffic analyst for the I-70 Mountain Corridor in Colorado.
Your job is to give drivers a quick "vibe check" on current conditions.

Your responses should be:
- Conversational and helpful (like a friend giving advice)
- Focused on actionable info ("grab dinner first" vs "moderate delays")
- Under 100 characters for mobile display

Score guide (0-10):
- 0-2: Avoid if possible (major incidents, closures, severe weather)
- 3-4: Expect significant delays (30+ min)
- 5-6: Moderate delays or minor incidents
- 7-8: Light traffic, minor slowdowns
- 9-10: Smooth sailing, ideal conditions`;

const USER_PROMPT_TEMPLATE = `Current conditions for {{SEGMENT_NAME}}:

Speed: {{SPEED}}
{{CONDITIONS}}

Provide a vibe score (0-10) and a brief, friendly summary (max 100 chars).

Respond in JSON format only:
{"score": <number>, "summary": "<text>"}`;

interface VibeCheckerConfig {
  apiKey: string;
  maxRetries?: number;
  timeout?: number;
}

/**
 * Claude-powered vibe scoring with automatic fallback
 */
export class VibeChecker {
  private client: Anthropic;

  constructor(config: VibeCheckerConfig) {
    this.client = new Anthropic({
      apiKey: config.apiKey,
      maxRetries: config.maxRetries ?? 2,
      timeout: config.timeout ?? 30000,
    });
  }

  /**
   * Get vibe score for a segment
   * Returns AI-generated score and summary, or falls back to heuristics on failure
   */
  async getVibeScore(
    segmentName: string,
    speed: number | null,
    conditionsText: string
  ): Promise<VibeCheckResult> {
    const rawText = this.buildRawText(segmentName, speed, conditionsText);

    try {
      const result = await this.callClaude(segmentName, speed, conditionsText);
      return {
        ...result,
        rawText,
        usedFallback: false,
      };
    } catch (error) {
      console.error(`AI vibe check failed for ${segmentName}:`, error);
      return this.generateFallbackScore(segmentName, speed, conditionsText);
    }
  }

  /**
   * Call Claude 3 Haiku for vibe scoring
   */
  private async callClaude(
    segmentName: string,
    speed: number | null,
    conditionsText: string
  ): Promise<{ score: number; summary: string }> {
    const userPrompt = USER_PROMPT_TEMPLATE.replace('{{SEGMENT_NAME}}', segmentName)
      .replace('{{SPEED}}', speed !== null ? `${speed} mph` : 'Unknown')
      .replace('{{CONDITIONS}}', conditionsText);

    const message = await this.client.messages.create({
      model: 'claude-3-haiku-20240307',
      max_tokens: 150,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: userPrompt,
        },
      ],
    });

    // Extract text content
    const textContent = message.content.find((c) => c.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      throw new Error('No text response from Claude');
    }

    return this.parseVibeResponse(textContent.text);
  }

  /**
   * Parse and validate Claude's JSON response
   */
  private parseVibeResponse(text: string): { score: number; summary: string } {
    // Extract JSON from response (handle potential markdown code blocks)
    let jsonText = text.trim();

    // Remove markdown code block if present
    if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }

    // Find JSON object
    const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error(`No JSON found in response: ${text.substring(0, 100)}`);
    }

    const parsed = JSON.parse(jsonMatch[0]);

    // Validate with Zod
    const result = VibeCheckResponseSchema.safeParse(parsed);
    if (!result.success) {
      throw new Error(`Invalid response format: ${result.error.message}`);
    }

    return result.data;
  }

  /**
   * Generate fallback score using simple heuristics
   * Used when Claude API fails
   */
  private generateFallbackScore(
    segmentName: string,
    speed: number | null,
    conditionsText: string
  ): VibeCheckResult {
    let score = 7; // Default to "pretty good"
    const issues: string[] = [];

    // Adjust based on speed
    if (speed !== null) {
      if (speed < 15) {
        score = 2;
        issues.push('very slow');
      } else if (speed < 25) {
        score = 3;
        issues.push('slow');
      } else if (speed < 35) {
        score = 5;
        issues.push('moderate pace');
      } else if (speed < 50) {
        score = 7;
      } else {
        score = 9;
      }
    }

    // Check for concerning keywords in conditions
    const lowerConditions = conditionsText.toLowerCase();

    if (
      lowerConditions.includes('closed') ||
      lowerConditions.includes('closure')
    ) {
      score = Math.min(score, 1);
      issues.push('closure');
    }
    if (
      lowerConditions.includes('accident') ||
      lowerConditions.includes('crash')
    ) {
      score = Math.min(score, 3);
      issues.push('incident');
    }
    if (
      lowerConditions.includes('chain law') ||
      lowerConditions.includes('traction law')
    ) {
      score = Math.min(score, 4);
      issues.push('chain law');
    }
    if (
      lowerConditions.includes('snow') ||
      lowerConditions.includes('ice') ||
      lowerConditions.includes('slick')
    ) {
      score = Math.max(1, score - 2);
      issues.push('winter conditions');
    }
    if (lowerConditions.includes('construction')) {
      score = Math.max(3, score - 1);
      issues.push('construction');
    }

    // Count incidents (rough approximation)
    const incidentMatches = conditionsText.match(/^-/gm);
    const incidentCount = incidentMatches?.length ?? 0;
    if (incidentCount > 0) {
      score = Math.max(1, score - Math.min(incidentCount, 4));
    }

    // Build summary
    let summary: string;
    if (issues.length === 0) {
      if (speed !== null) {
        summary =
          speed >= 50
            ? 'Looking good! Smooth sailing ahead.'
            : `${speed} mph, no major issues.`;
      } else {
        summary = 'Conditions unclear, drive carefully.';
      }
    } else {
      const issueText = issues.slice(0, 2).join(', ');
      summary =
        score <= 3
          ? `Heads up: ${issueText}. Consider waiting.`
          : `Note: ${issueText}. Allow extra time.`;
    }

    // Ensure summary is under 100 chars
    if (summary.length > 100) {
      summary = summary.substring(0, 97) + '...';
    }

    return {
      score: Math.max(0, Math.min(10, score)),
      summary,
      rawText: this.buildRawText(segmentName, speed, conditionsText),
      usedFallback: true,
    };
  }

  /**
   * Build raw text for debugging/logging
   */
  private buildRawText(
    segmentName: string,
    speed: number | null,
    conditionsText: string
  ): string {
    return `${segmentName}: ${speed !== null ? `${speed} mph` : 'unknown speed'}\n${conditionsText}`;
  }
}
