import { CDOTClient } from './client';
import {
  CORRIDOR_SEGMENTS,
  MAX_REASONABLE_SPEED_MPH,
  getSegmentByJsonName,
  type CdotDestination,
  type CdotIncident,
  type CdotCondition,
  type CdotWeatherStation,
  type SegmentData,
  type CorridorSegment,
  type NormalizedIncident,
} from '@corridor/shared';

interface AggregatorConfig {
  apiKey: string;
}

/**
 * Raw data fetched from CDOT API
 */
export interface CDOTRawData {
  destinations: CdotDestination[];
  incidents: CdotIncident[];
  conditions: CdotCondition[];
  weatherStations: CdotWeatherStation[];
}

/**
 * CDOT Data Aggregator
 *
 * Fetches all data from CDOT API and matches to our watchlist segments.
 * Calculates implied speed from travel time.
 */
export class CDOTAggregator {
  private client: CDOTClient;

  constructor(config: AggregatorConfig) {
    this.client = new CDOTClient({ apiKey: config.apiKey });
  }

  /**
   * Fetch all raw data from CDOT API
   */
  async fetchAllData(): Promise<CDOTRawData> {
    console.log('Fetching CDOT data from all endpoints...');

    const [destinations, incidents, conditions, weatherStations] =
      await Promise.all([
        this.client.getDestinations(),
        this.client.getIncidents(),
        this.client.getRoadConditions(),
        this.client.getWeatherStations(),
      ]);

    console.log(
      `  Fetched: ${destinations.length} destinations, ${incidents.length} incidents, ` +
        `${conditions.length} conditions, ${weatherStations.length} weather stations`
    );

    return { destinations, incidents, conditions, weatherStations };
  }

  /**
   * Process raw data into segment data for each watchlist segment
   *
   * Note: Incidents are not normalized yet - that happens in the AI step
   */
  processSegments(
    rawData: CDOTRawData,
    normalizedIncidents: NormalizedIncident[]
  ): SegmentData[] {
    const results: SegmentData[] = [];

    for (const segment of CORRIDOR_SEGMENTS) {
      // Find matching destination by JSON name
      const destination = rawData.destinations.find(
        (d) => d.properties.name === segment.jsonName
      );

      // Calculate travel time and implied speed
      let travelTimeSeconds: number | null = null;
      let impliedSpeedMph: number | null = null;
      let speedAnomalyDetected = false;

      if (destination) {
        travelTimeSeconds = destination.properties.travelTime;

        if (travelTimeSeconds > 0) {
          // Speed = Distance / Time (convert seconds to hours)
          impliedSpeedMph =
            segment.distanceMiles / (travelTimeSeconds / 3600);

          // Check for "132 MPH anomaly" - bad data from CDOT
          if (impliedSpeedMph > MAX_REASONABLE_SPEED_MPH) {
            speedAnomalyDetected = true;
            // Don't null out the speed - we'll handle display in frontend
          }
        }
      }

      // Get road condition
      const roadCondition = this.findRoadCondition(rawData.conditions);

      // Get weather surface status
      const weatherSurface = this.findWeatherSurface(rawData.weatherStations);

      // Filter normalized incidents for this segment
      const segmentIncidents = normalizedIncidents.filter((inc) => {
        // For now, include all incidents since we're looking at corridor-wide
        // Could filter by segment parts if needed
        return true;
      });

      results.push({
        segment,
        travelTimeSeconds,
        impliedSpeedMph: impliedSpeedMph
          ? Math.round(impliedSpeedMph)
          : null,
        speedAnomalyDetected,
        incidents: segmentIncidents,
        roadCondition,
        weatherSurface,
      });
    }

    return results;
  }

  /**
   * Get raw incidents for normalization
   */
  getRawIncidents(rawData: CDOTRawData): CdotIncident[] {
    return rawData.incidents;
  }

  /**
   * Find road condition from conditions list
   * Returns the most severe condition found
   */
  private findRoadCondition(conditions: CdotCondition[]): string | null {
    for (const condition of conditions) {
      const descriptions = condition.properties.currentConditions
        .map((c) => c.conditionDescription)
        .filter(Boolean);

      if (descriptions.length > 0) {
        // Return the first non-dry condition, or first condition if all dry
        const nonDry = descriptions.find(
          (d) => !d.toLowerCase().includes('dry')
        );
        return nonDry || descriptions[0] || null;
      }
    }
    return null;
  }

  /**
   * Find road surface status from weather stations
   */
  private findWeatherSurface(stations: CdotWeatherStation[]): string | null {
    for (const station of stations) {
      const surfaceSensor = station.properties.sensors.find((s) =>
        s.type.toLowerCase().includes('road surface')
      );

      if (surfaceSensor) {
        return surfaceSensor.currentReading;
      }
    }
    return null;
  }

  /**
   * Build conditions summary text for AI/display
   */
  buildConditionsSummary(segmentData: SegmentData): string {
    const parts: string[] = [];

    // Travel time status
    if (segmentData.travelTimeSeconds !== null) {
      const ratio =
        segmentData.segment.freeFlowSeconds / segmentData.travelTimeSeconds;

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
  }
}
