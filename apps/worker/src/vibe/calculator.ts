import {
  VIBE_PENALTIES,
  type SegmentData,
  type NormalizedIncident,
  type VibeResult,
} from '@corridor/shared';

/**
 * Calculate vibe score using deterministic algorithm
 *
 * The algorithm:
 * 1. Flow Score (0-10) based on travel time ratio
 * 2. Incident Penalty from LLM normalization
 * 3. Weather Penalty for icy/snow conditions
 *
 * Final Vibe = max(0, FlowScore - Penalties)
 */
export function calculateVibeScore(segmentData: SegmentData): VibeResult {
  // 1. Calculate Flow Score
  const flowScore = calculateFlowScore(
    segmentData.travelTimeSeconds,
    segmentData.segment.thresholds.freeFlowSeconds,
    segmentData.speedAnomalyDetected
  );

  // 2. Calculate Incident Penalty
  const incidentPenalty = calculateIncidentPenalty(segmentData.incidents);

  // 3. Calculate Weather Penalty
  const weatherPenalty = calculateWeatherPenalty(
    segmentData.roadCondition,
    segmentData.weatherSurface
  );

  // Final score
  const score = Math.max(0, flowScore - incidentPenalty - weatherPenalty);

  // Generate summary
  const summary = generateSummary(
    score,
    flowScore,
    incidentPenalty,
    weatherPenalty,
    segmentData
  );

  return {
    score: Math.round(score * 10) / 10, // Round to 1 decimal
    flowScore,
    incidentPenalty,
    weatherPenalty,
    summary,
  };
}

/**
 * Calculate flow score based on travel time ratio
 *
 * ratio = expectedTravelTime / currentTravelTime
 * - If ratio >= 0.9 (moving well) -> 10
 * - If ratio <= 0.5 (double time) -> 5
 * - If ratio <= 0.2 (5x time) -> 1
 */
function calculateFlowScore(
  currentTravelTime: number | null,
  freeFlowTravelTime: number,
  speedAnomalyDetected: boolean
): number {
  // If speed anomaly detected (>85mph), assume free flow
  if (speedAnomalyDetected) {
    return 10;
  }

  // No data - return neutral score
  if (currentTravelTime === null || currentTravelTime <= 0) {
    return 5;
  }

  // Calculate ratio (inverted: freeFlow/current because lower travel time is better)
  const ratio = freeFlowTravelTime / currentTravelTime;

  if (ratio >= 0.9) {
    // Moving at or near free flow
    return 10;
  } else if (ratio >= 0.5) {
    // Linear interpolation between 5 and 10
    // ratio 0.5 -> 5, ratio 0.9 -> 10
    return 5 + ((ratio - 0.5) / 0.4) * 5;
  } else if (ratio >= 0.2) {
    // Linear interpolation between 1 and 5
    // ratio 0.2 -> 1, ratio 0.5 -> 5
    return 1 + ((ratio - 0.2) / 0.3) * 4;
  } else {
    // Extremely slow (5x+ travel time)
    return 1;
  }
}

/**
 * Calculate total penalty from incidents
 */
function calculateIncidentPenalty(incidents: NormalizedIncident[]): number {
  return incidents.reduce((total, incident) => total + incident.penalty, 0);
}

/**
 * Calculate weather penalty
 * -1 for icy or snow conditions
 */
function calculateWeatherPenalty(
  roadCondition: string | null,
  weatherSurface: string | null
): number {
  const conditions = [
    roadCondition?.toLowerCase() || '',
    weatherSurface?.toLowerCase() || '',
  ].join(' ');

  if (
    conditions.includes('icy') ||
    conditions.includes('ice') ||
    conditions.includes('snow') ||
    conditions.includes('frozen')
  ) {
    return VIBE_PENALTIES.ICY_CONDITIONS;
  }

  return 0;
}

/**
 * Generate human-readable summary
 */
function generateSummary(
  score: number,
  flowScore: number,
  incidentPenalty: number,
  weatherPenalty: number,
  segmentData: SegmentData
): string {
  // Speed anomaly - don't mention speed
  if (segmentData.speedAnomalyDetected) {
    if (incidentPenalty > 0) {
      return 'Data unclear, but incidents reported. Drive carefully.';
    }
    return 'Conditions look good, but data may be stale.';
  }

  // Score-based summaries
  if (score >= 9) {
    return 'Smooth sailing! Perfect conditions.';
  } else if (score >= 7) {
    if (weatherPenalty > 0) {
      return 'Moving well, but watch for slick spots.';
    }
    return 'Looking good! Light traffic ahead.';
  } else if (score >= 5) {
    if (incidentPenalty > 0) {
      return 'Expect delays due to incident(s).';
    }
    return 'Moderate traffic. Allow extra time.';
  } else if (score >= 3) {
    if (incidentPenalty >= VIBE_PENALTIES.ROAD_CLOSURE) {
      return 'Major incident ahead. Consider waiting.';
    }
    return 'Significant slowdowns. Grab dinner first?';
  } else {
    if (incidentPenalty >= VIBE_PENALTIES.ROAD_CLOSURE) {
      return 'Road closure reported. Check alternatives.';
    }
    return 'Heavy delays. Definitely wait this out.';
  }
}

/**
 * Determine penalty for an incident based on type/severity
 * Used by AI normalizer as guidance
 */
export function suggestIncidentPenalty(
  incidentType: string,
  severity: 'major' | 'moderate' | 'minor'
): number {
  const typeLower = incidentType.toLowerCase();

  // Road closures
  if (
    typeLower.includes('closure') ||
    typeLower.includes('closed') ||
    typeLower.includes('blocked')
  ) {
    return VIBE_PENALTIES.ROAD_CLOSURE;
  }

  // Lane closures
  if (typeLower.includes('lane') && typeLower.includes('clos')) {
    return VIBE_PENALTIES.LANE_CLOSURE;
  }

  // Crashes
  if (typeLower.includes('crash') || typeLower.includes('accident')) {
    return severity === 'major'
      ? VIBE_PENALTIES.ROAD_CLOSURE
      : VIBE_PENALTIES.LANE_CLOSURE;
  }

  // Traction/chain law
  if (typeLower.includes('traction') || typeLower.includes('chain')) {
    return 1; // Minor penalty
  }

  // Default by severity
  switch (severity) {
    case 'major':
      return VIBE_PENALTIES.LANE_CLOSURE;
    case 'moderate':
      return 1;
    case 'minor':
    default:
      return 0;
  }
}
