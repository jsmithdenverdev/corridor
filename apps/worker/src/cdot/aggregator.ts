import { CDOTClient } from './client';
import {
  I70_SEGMENTS,
  getSegmentByMileMarker,
  type SegmentData,
  type CDOTIncident,
} from '@corridor/shared';

interface AggregatorConfig {
  apiKey: string;
}

/**
 * Aggregates CDOT data across all defined segments
 * Handles the complexity of mapping CDOT's many small segments
 * to our defined corridor segments
 */
export class CDOTAggregator {
  private client: CDOTClient;

  constructor(config: AggregatorConfig) {
    this.client = new CDOTClient({ apiKey: config.apiKey });
  }

  /**
   * Aggregate all data for all MVP segments
   */
  async aggregateAllSegments(): Promise<Map<string, SegmentData>> {
    console.log('Fetching CDOT data...');

    // Fetch all data in parallel
    const [incidents, speeds, conditions] = await Promise.all([
      this.client.getIncidents(),
      this.client.getSpeeds(),
      this.client.getRoadConditions(),
    ]);

    console.log(
      `  Fetched: ${incidents.length} incidents, ${speeds.size} speed segments`
    );

    const segmentDataMap = new Map<string, SegmentData>();

    // Process each defined segment
    for (const segment of Object.values(I70_SEGMENTS)) {
      // Get cameras for this segment
      const cameras = await this.client.getCameras([...segment.cameras]);

      // Filter incidents to this segment's mile marker range
      const segmentIncidents = incidents.filter((inc) => {
        const mm = inc.location.mileMarker;
        if (mm === undefined) return false;
        return mm >= segment.mileMarkers.start && mm <= segment.mileMarkers.end;
      });

      // Calculate average speed from CDOT segments that overlap with ours
      const avgSpeed = this.calculateAverageSpeed(speeds, segment.mileMarkers);

      // Get road condition for this segment
      const roadCondition = this.getRoadConditionForSegment(
        conditions,
        segment.mileMarkers
      );

      segmentDataMap.set(segment.id, {
        segmentId: segment.id,
        segmentName: segment.name,
        speed: avgSpeed,
        incidents: segmentIncidents,
        cameras,
        roadCondition,
      });
    }

    return segmentDataMap;
  }

  /**
   * Build incident text for AI processing
   * Creates a natural language summary of current incidents
   */
  buildIncidentText(incidents: CDOTIncident[], roadCondition: string | null): string {
    const parts: string[] = [];

    // Add road condition if available
    if (roadCondition) {
      parts.push(`Road Condition: ${roadCondition}`);
    }

    // Add incidents
    if (incidents.length === 0) {
      parts.push('No active incidents reported.');
    } else {
      parts.push(`Active Incidents (${incidents.length}):`);
      for (const inc of incidents) {
        let incText = `- ${inc.type}: ${inc.description}`;
        if (inc.severity) {
          incText += ` (Severity: ${inc.severity})`;
        }
        if (inc.location.mileMarker) {
          incText += ` [MM ${inc.location.mileMarker}]`;
        }
        parts.push(incText);
      }
    }

    return parts.join('\n');
  }

  /**
   * Calculate average speed from overlapping CDOT speed segments
   *
   * CDOT splits the corridor into many small segments (sometimes 0.5-1 mile each).
   * We need to aggregate these into our larger segment definitions.
   */
  private calculateAverageSpeed(
    speeds: Map<string, { currentSpeed: number }>,
    mileMarkers: { start: number; end: number }
  ): number | null {
    const relevantSpeeds: number[] = [];

    for (const [segmentId, speedData] of speeds) {
      // Parse segment ID to get mile markers (format: "start-end")
      const match = segmentId.match(/^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/);
      if (!match) continue;

      const [, startStr, endStr] = match;
      const segStart = parseFloat(startStr!);
      const segEnd = parseFloat(endStr!);

      // Check if this CDOT segment overlaps with our segment
      if (segEnd >= mileMarkers.start && segStart <= mileMarkers.end) {
        if (speedData.currentSpeed > 0) {
          relevantSpeeds.push(speedData.currentSpeed);
        }
      }
    }

    if (relevantSpeeds.length === 0) {
      return null;
    }

    // Return weighted average (could weight by segment length, but simple average for now)
    return Math.round(
      relevantSpeeds.reduce((a, b) => a + b, 0) / relevantSpeeds.length
    );
  }

  /**
   * Get road condition that applies to this segment
   */
  private getRoadConditionForSegment(
    conditions: Map<string, string>,
    mileMarkers: { start: number; end: number }
  ): string | null {
    for (const [range, condition] of conditions) {
      const match = range.match(/^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/);
      if (!match) continue;

      const [, startStr, endStr] = match;
      const condStart = parseFloat(startStr!);
      const condEnd = parseFloat(endStr!);

      // Check if condition range overlaps with our segment
      if (condEnd >= mileMarkers.start && condStart <= mileMarkers.end) {
        return condition;
      }
    }

    return null;
  }
}

/**
 * Helper to get segment for a given mile marker
 * Re-exported for convenience
 */
export { getSegmentByMileMarker };
