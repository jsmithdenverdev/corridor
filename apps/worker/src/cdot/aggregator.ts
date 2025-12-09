import { MAX_REASONABLE_SPEED_MPH } from '@corridor/shared';

import type { CdotClient } from './client';
import type {
  CdotDestination,
  CdotIncident,
  CdotCondition,
  CdotWeatherStation,
  SegmentData,
  SegmentConfig,
  NormalizedIncident,
} from '@corridor/shared';

import {
  findDestinationForSegment,
  findIncidentsForSegment,
  findConditionsForSegment,
  getWorstCondition,
} from '../spatial/matching';

/**
 * Raw data fetched from CDOT API
 */
export type CDOTRawData = {
  destinations: CdotDestination[];
  incidents: CdotIncident[];
  conditions: CdotCondition[];
  weatherStations: CdotWeatherStation[];
};

/**
 * Aggregator configuration
 */
type AggregatorConfig = {
  segments: SegmentConfig[];
};

/**
 * CDOT Data Aggregator
 *
 * Fetches all data from CDOT API and matches to configured segments
 * using spatial correlation by Mile Markers.
 */
export const createAggregator = (
  client: Pick<
    CdotClient,
    'getDestinations' | 'getIncidents' | 'getRoadConditions' | 'getWeatherStations'
  >,
  config: AggregatorConfig
) => {
  const { segments } = config;

  /**
   * Find road surface status from weather stations
   * Returns the first road surface reading found
   */
  const findWeatherSurface = (stations: CdotWeatherStation[]): string | null => {
    for (const station of stations) {
      const surfaceSensor = station.properties.sensors.find((s) =>
        s.type.toLowerCase().includes('road surface')
      );

      if (surfaceSensor) {
        return surfaceSensor.currentReading;
      }
    }
    return null;
  };

  /**
   * Fetch all raw data from CDOT API
   */
  const fetchAllData = async (): Promise<CDOTRawData> => {
    console.log('Fetching CDOT data from all endpoints...');

    const [destinations, incidents, conditions, weatherStations] =
      await Promise.all([
        client.getDestinations(),
        client.getIncidents(),
        client.getRoadConditions(),
        client.getWeatherStations(),
      ]);

    console.log(
      `  Fetched: ${destinations.length} destinations, ${incidents.length} incidents, ` +
        `${conditions.length} conditions, ${weatherStations.length} weather stations`
    );

    return { destinations, incidents, conditions, weatherStations };
  };

  /**
   * Process raw data into segment data for each configured segment
   * Uses spatial matching to correlate incidents and conditions to segments
   */
  const processSegments = (
    rawData: CDOTRawData,
    normalizedIncidents: NormalizedIncident[]
  ): SegmentData[] => {
    const results: SegmentData[] = [];

    for (const segment of segments) {
      // Find matching destination by exact name from config
      const destination = findDestinationForSegment(segment, rawData.destinations);

      // Calculate travel time and implied speed
      let travelTimeSeconds: number | null = null;
      let impliedSpeedMph: number | null = null;
      let speedAnomalyDetected = false;

      // Calculate distance from mile markers
      const distanceMiles = Math.abs(segment.bounds.startMM - segment.bounds.endMM);

      if (destination) {
        travelTimeSeconds = destination.properties.travelTime;

        if (travelTimeSeconds > 0) {
          // Speed = Distance / Time (convert seconds to hours)
          impliedSpeedMph = distanceMiles / (travelTimeSeconds / 3600);

          // Check for "132 MPH anomaly" - bad data from CDOT
          if (impliedSpeedMph > MAX_REASONABLE_SPEED_MPH) {
            speedAnomalyDetected = true;
            // Don't null out the speed - we'll handle display in frontend
          }
        }
      }

      // Find incidents spatially within segment bounds
      const rawIncidentsInBounds = findIncidentsForSegment(segment, rawData.incidents);

      // Match normalized incidents to raw incidents by ID
      const segmentIncidents = normalizedIncidents.filter((ni) =>
        rawIncidentsInBounds.some((raw) => raw.properties.id === ni.id)
      );

      // Find conditions spatially overlapping segment bounds
      const segmentConditions = findConditionsForSegment(segment, rawData.conditions);
      const roadCondition = getWorstCondition(segmentConditions);

      // Get weather surface status (for now corridor-wide)
      const weatherSurface = findWeatherSurface(rawData.weatherStations);

      results.push({
        segment,
        travelTimeSeconds,
        impliedSpeedMph: impliedSpeedMph ? Math.round(impliedSpeedMph) : null,
        speedAnomalyDetected,
        incidents: segmentIncidents,
        roadCondition,
        weatherSurface,
      });
    }

    return results;
  };

  /**
   * Get raw incidents for normalization
   * Returns all incidents that fall within any configured segment
   */
  const getRawIncidents = (rawData: CDOTRawData): CdotIncident[] => {
    // Collect incidents from all segments
    const incidentIds = new Set<string>();
    const result: CdotIncident[] = [];

    for (const segment of segments) {
      const segmentIncidents = findIncidentsForSegment(segment, rawData.incidents);
      for (const incident of segmentIncidents) {
        if (!incidentIds.has(incident.properties.id)) {
          incidentIds.add(incident.properties.id);
          result.push(incident);
        }
      }
    }

    return result;
  };

  /**
   * Build conditions summary text for AI/display
   */
  const buildConditionsSummary = (segmentData: SegmentData): string => {
    const parts: string[] = [];

    // Travel time status
    if (segmentData.travelTimeSeconds !== null) {
      const freeFlowSeconds = segmentData.segment.thresholds.freeFlowSeconds;
      const ratio = freeFlowSeconds / segmentData.travelTimeSeconds;

      if (ratio >= 0.9) {
        parts.push('Traffic flowing smoothly');
      } else if (ratio >= 0.5) {
        parts.push('Moderate delays');
      } else {
        parts.push('Significant delays');
      }
    }

    // Road condition
    if (segmentData.roadCondition) {
      parts.push(`Road: ${segmentData.roadCondition}`);
    }

    // Weather surface
    if (segmentData.weatherSurface) {
      parts.push(`Surface: ${segmentData.weatherSurface}`);
    }

    // Incidents
    if (segmentData.incidents.length > 0) {
      parts.push(`${segmentData.incidents.length} active incident(s)`);
    }

    return parts.length > 0 ? parts.join('. ') : 'No data available';
  };

  return {
    fetchAllData,
    processSegments,
    getRawIncidents,
    buildConditionsSummary,
  };
};

export type CdotAggregator = ReturnType<typeof createAggregator>;
