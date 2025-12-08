/**
 * Spatial Matching Utilities
 *
 * Correlate CDOT data sources using Mile Markers instead of shared IDs.
 * Handles the westbound gotcha: I-70 MMs decrease westbound (startMM > endMM).
 */

import type {
  SegmentBounds,
  SegmentConfig,
  CdotDestination,
  CdotIncident,
  CdotCondition,
} from '@corridor/shared';

/**
 * Road condition severity ranking (higher = worse)
 */
const CONDITION_SEVERITY: Record<string, number> = {
  icy: 5,
  ice: 5,
  snow: 4,
  'snow packed': 4,
  'snow covered': 4,
  slush: 3,
  wet: 2,
  dry: 1,
};

/**
 * Get normalized mile marker range from segment bounds.
 * Handles westbound corridors where startMM > endMM.
 */
export const getMileMarkerRange = (
  bounds: SegmentBounds
): { minMM: number; maxMM: number } => {
  return {
    minMM: Math.min(bounds.startMM, bounds.endMM),
    maxMM: Math.max(bounds.startMM, bounds.endMM),
  };
};

/**
 * Check if a mile marker falls within segment bounds.
 */
export const isMarkerInBounds = (
  marker: number,
  bounds: SegmentBounds
): boolean => {
  const { minMM, maxMM } = getMileMarkerRange(bounds);
  return marker >= minMM && marker <= maxMM;
};

/**
 * Check if two mile marker ranges overlap.
 */
export const rangesOverlap = (
  range1: { minMM: number; maxMM: number },
  range2: { minMM: number; maxMM: number }
): boolean => {
  return range1.minMM <= range2.maxMM && range1.maxMM >= range2.minMM;
};

/**
 * Check if route name matches route ID.
 * Handles variations like "I-70" matching "070".
 */
export const routeMatches = (routeName: string, routeId: string): boolean => {
  // Normalize route name: "I-70" -> "70", "US-6" -> "6"
  const normalizedRoute = routeName
    .replace(/^(I-|US-|CO-|SH-)/i, '')
    .replace(/^0+/, '');

  // Normalize route ID: "070" -> "70"
  const normalizedId = routeId.replace(/^0+/, '');

  return normalizedRoute === normalizedId;
};

/**
 * Check if incident direction matches segment direction.
 * Handles variations and "both" direction.
 */
export const directionMatches = (
  incidentDir: string,
  segmentDir: string
): boolean => {
  const normalizedIncident = incidentDir.toLowerCase().trim();
  const normalizedSegment = segmentDir.toLowerCase().trim();

  // "both" matches everything
  if (normalizedIncident === 'both') {
    return true;
  }

  // Direct match
  if (normalizedIncident === normalizedSegment) {
    return true;
  }

  // Handle variations: "W" vs "Westbound", "E" vs "Eastbound"
  const directionMap: Record<string, string[]> = {
    w: ['w', 'west', 'westbound', 'wb'],
    e: ['e', 'east', 'eastbound', 'eb'],
    n: ['n', 'north', 'northbound', 'nb'],
    s: ['s', 'south', 'southbound', 'sb'],
  };

  for (const [key, variants] of Object.entries(directionMap)) {
    if (
      variants.includes(normalizedIncident) &&
      variants.includes(normalizedSegment)
    ) {
      return true;
    }
  }

  return false;
};

/**
 * Find the CDOT destination that matches a segment by exact name.
 */
export const findDestinationForSegment = (
  segment: SegmentConfig,
  destinations: CdotDestination[]
): CdotDestination | null => {
  const targetName = segment.dataSources.destinationName;

  const match = destinations.find(
    (dest) => dest.properties.name === targetName
  );

  return match ?? null;
};

/**
 * Find all incidents that fall within a segment's bounds.
 * Matches by route, direction, and mile marker position.
 */
export const findIncidentsForSegment = (
  segment: SegmentConfig,
  incidents: CdotIncident[]
): CdotIncident[] => {
  const { bounds } = segment;

  return incidents.filter((incident) => {
    const props = incident.properties;

    // Check route matches
    if (!routeMatches(props.routeName, bounds.routeId)) {
      return false;
    }

    // Check direction matches
    if (!directionMatches(props.direction, bounds.direction)) {
      return false;
    }

    // Check if incident start marker is within bounds
    // We use startMarker as the primary location indicator
    if (!isMarkerInBounds(props.startMarker, bounds)) {
      return false;
    }

    return true;
  });
};

/**
 * Find all road conditions that overlap with a segment's bounds.
 */
export const findConditionsForSegment = (
  segment: SegmentConfig,
  conditions: CdotCondition[]
): CdotCondition[] => {
  const { bounds } = segment;
  const segmentRange = getMileMarkerRange(bounds);

  return conditions.filter((condition) => {
    const props = condition.properties;

    // Check route matches
    if (!routeMatches(props.routeName, bounds.routeId)) {
      return false;
    }

    // Check if mile marker ranges overlap
    const conditionRange = {
      minMM: Math.min(props.primaryMP, props.secondaryMP),
      maxMM: Math.max(props.primaryMP, props.secondaryMP),
    };

    return rangesOverlap(segmentRange, conditionRange);
  });
};

/**
 * Get the worst (most severe) condition from a list of conditions.
 * Returns null if no conditions or all conditions are dry/unknown.
 */
export const getWorstCondition = (
  conditions: CdotCondition[]
): string | null => {
  let worstCondition: string | null = null;
  let worstSeverity = 0;

  for (const condition of conditions) {
    for (const currentCond of condition.properties.currentConditions) {
      const description = currentCond.conditionDescription.toLowerCase();
      const severity = CONDITION_SEVERITY[description] ?? 0;

      if (severity > worstSeverity) {
        worstSeverity = severity;
        worstCondition = currentCond.conditionDescription;
      }
    }
  }

  // Don't return "dry" as a notable condition
  if (worstSeverity <= 1) {
    return null;
  }

  return worstCondition;
};

/**
 * Get weather surface reading from a segment's weather stations.
 * Returns the worst surface condition found.
 */
export const getWeatherSurface = (
  conditions: CdotCondition[]
): string | null => {
  return getWorstCondition(conditions);
};
