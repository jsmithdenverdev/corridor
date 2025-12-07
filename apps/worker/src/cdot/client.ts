import {
  CDOTIncidentSchema,
  CDOTSpeedSchema,
  MVP_MILE_MARKER_RANGE,
  getCameraSnapshotUrl,
  type CDOTIncident,
  type CDOTSpeed,
  type Camera,
} from '@corridor/shared';

/**
 * CDOT API Endpoints
 * Primary: COtrip API (https://www.cotrip.org/api/)
 *
 * Note: CDOT provides multiple API endpoints. The actual endpoints
 * may need adjustment based on your API key type and access level.
 */
const CDOT_API_BASE = 'https://data.cotrip.org/api/v1';
const COTRIP_API_BASE = 'https://www.cotrip.org/api';

interface CDOTClientConfig {
  apiKey: string;
  timeout?: number;
}

export class CDOTClient {
  private apiKey: string;
  private timeout: number;

  constructor(config: CDOTClientConfig) {
    this.apiKey = config.apiKey;
    this.timeout = config.timeout ?? 30000;
  }

  /**
   * Fetch current incidents on I-70 within MVP mile marker range
   */
  async getIncidents(): Promise<CDOTIncident[]> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(
        `${CDOT_API_BASE}/incidents?route=I-70`,
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            Accept: 'application/json',
          },
          signal: controller.signal,
        }
      );

      clearTimeout(timeoutId);

      if (!response.ok) {
        console.error(`CDOT Incidents API error: ${response.status}`);
        return [];
      }

      const data = await response.json();
      return this.parseAndFilterIncidents(data);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        console.error('CDOT Incidents API timeout');
      } else {
        console.error('Failed to fetch CDOT incidents:', error);
      }
      return [];
    }
  }

  /**
   * Fetch current speed data for I-70 segments
   */
  async getSpeeds(): Promise<Map<string, CDOTSpeed>> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(
        `${CDOT_API_BASE}/speeds?route=I-70`,
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            Accept: 'application/json',
          },
          signal: controller.signal,
        }
      );

      clearTimeout(timeoutId);

      if (!response.ok) {
        console.error(`CDOT Speeds API error: ${response.status}`);
        return new Map();
      }

      const data = await response.json();
      return this.parseSpeedData(data);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        console.error('CDOT Speeds API timeout');
      } else {
        console.error('Failed to fetch CDOT speeds:', error);
      }
      return new Map();
    }
  }

  /**
   * Get camera snapshot data for given camera IDs
   * Uses static snapshot URLs (not M3U8 streams)
   */
  async getCameras(cameraIds: string[]): Promise<Camera[]> {
    const cameras: Camera[] = [];

    for (const cameraId of cameraIds) {
      try {
        const imageUrl = getCameraSnapshotUrl(cameraId);

        // Verify the camera URL is accessible (optional - can skip for faster response)
        // const response = await fetch(imageUrl, { method: 'HEAD' });
        // if (!response.ok) continue;

        cameras.push({
          id: cameraId,
          name: this.formatCameraName(cameraId),
          imageUrl,
          lastUpdated: new Date(),
        });
      } catch (error) {
        console.error(`Failed to fetch camera ${cameraId}:`, error);
      }
    }

    return cameras;
  }

  /**
   * Fetch road conditions for I-70
   */
  async getRoadConditions(): Promise<Map<string, string>> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(
        `${CDOT_API_BASE}/road-conditions?route=I-70`,
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            Accept: 'application/json',
          },
          signal: controller.signal,
        }
      );

      clearTimeout(timeoutId);

      if (!response.ok) {
        console.error(`CDOT Road Conditions API error: ${response.status}`);
        return new Map();
      }

      const data = await response.json();
      return this.parseRoadConditions(data);
    } catch (error) {
      console.error('Failed to fetch road conditions:', error);
      return new Map();
    }
  }

  /**
   * Parse and filter incidents to MVP mile marker range
   */
  private parseAndFilterIncidents(rawData: unknown): CDOTIncident[] {
    const incidents: CDOTIncident[] = [];

    if (!Array.isArray(rawData)) {
      // Try common API response wrappers
      const data = rawData as Record<string, unknown>;
      if (Array.isArray(data.incidents)) {
        return this.parseAndFilterIncidents(data.incidents);
      }
      if (Array.isArray(data.features)) {
        return this.parseAndFilterIncidents(data.features);
      }
      console.warn('Unexpected CDOT incidents response format');
      return [];
    }

    for (const item of rawData) {
      try {
        // Handle GeoJSON format (common for CDOT)
        const properties = (item as Record<string, unknown>).properties || item;
        const geometry = (item as Record<string, unknown>).geometry as
          | Record<string, unknown>
          | undefined;

        const mileMarker =
          (properties as Record<string, unknown>).mileMarker ??
          (properties as Record<string, unknown>).startMileMarker ??
          (properties as Record<string, unknown>).mile_marker;

        // Filter to MVP range
        if (typeof mileMarker === 'number') {
          if (
            mileMarker < MVP_MILE_MARKER_RANGE.start ||
            mileMarker > MVP_MILE_MARKER_RANGE.end
          ) {
            continue;
          }
        }

        // Extract coordinates
        let latitude = 0;
        let longitude = 0;
        if (geometry && Array.isArray(geometry.coordinates)) {
          [longitude, latitude] = geometry.coordinates as [number, number];
        } else if (properties) {
          latitude =
            ((properties as Record<string, unknown>).latitude as number) ?? 0;
          longitude =
            ((properties as Record<string, unknown>).longitude as number) ?? 0;
        }

        const incident: CDOTIncident = {
          id: String(
            (properties as Record<string, unknown>).id ??
              (properties as Record<string, unknown>).incidentId ??
              `incident-${Date.now()}-${Math.random()}`
          ),
          type: String(
            (properties as Record<string, unknown>).type ??
              (properties as Record<string, unknown>).eventType ??
              'Unknown'
          ),
          description: String(
            (properties as Record<string, unknown>).description ??
              (properties as Record<string, unknown>).travelerInformationMessage ??
              ''
          ),
          location: {
            latitude,
            longitude,
            mileMarker: typeof mileMarker === 'number' ? mileMarker : undefined,
            route: 'I-70',
          },
          severity: (properties as Record<string, unknown>).severity as
            | string
            | undefined,
          startTime: (properties as Record<string, unknown>).startTime
            ? new Date(
                (properties as Record<string, unknown>).startTime as string
              )
            : undefined,
        };

        // Validate with Zod
        const parsed = CDOTIncidentSchema.safeParse(incident);
        if (parsed.success) {
          incidents.push(parsed.data);
        }
      } catch (error) {
        console.warn('Failed to parse incident:', error);
      }
    }

    return incidents;
  }

  /**
   * Parse speed data and map to our segments
   */
  private parseSpeedData(rawData: unknown): Map<string, CDOTSpeed> {
    const speedMap = new Map<string, CDOTSpeed>();

    if (!Array.isArray(rawData)) {
      const data = rawData as Record<string, unknown>;
      if (Array.isArray(data.speeds)) {
        return this.parseSpeedData(data.speeds);
      }
      if (Array.isArray(data.features)) {
        return this.parseSpeedData(data.features);
      }
      return speedMap;
    }

    for (const item of rawData) {
      try {
        const properties = (item as Record<string, unknown>).properties || item;

        const startMM =
          ((properties as Record<string, unknown>).startMileMarker as number) ??
          ((properties as Record<string, unknown>).beginMileMarker as number);
        const endMM =
          ((properties as Record<string, unknown>).endMileMarker as number) ??
          ((properties as Record<string, unknown>).endMileMarker as number);

        // Filter to MVP range
        if (startMM !== undefined && endMM !== undefined) {
          if (
            endMM < MVP_MILE_MARKER_RANGE.start ||
            startMM > MVP_MILE_MARKER_RANGE.end
          ) {
            continue;
          }
        }

        const speed: CDOTSpeed = {
          segmentId: String(
            (properties as Record<string, unknown>).segmentId ??
              `${startMM}-${endMM}`
          ),
          currentSpeed:
            ((properties as Record<string, unknown>).currentSpeed as number) ??
            ((properties as Record<string, unknown>).avgSpeed as number) ??
            0,
          freeFlowSpeed: (properties as Record<string, unknown>)
            .freeFlowSpeed as number | undefined,
          congestionLevel: (properties as Record<string, unknown>)
            .congestionLevel as string | undefined,
        };

        const parsed = CDOTSpeedSchema.safeParse(speed);
        if (parsed.success && parsed.data.currentSpeed > 0) {
          speedMap.set(parsed.data.segmentId, parsed.data);
        }
      } catch (error) {
        console.warn('Failed to parse speed data:', error);
      }
    }

    return speedMap;
  }

  /**
   * Parse road conditions
   */
  private parseRoadConditions(rawData: unknown): Map<string, string> {
    const conditions = new Map<string, string>();

    if (!Array.isArray(rawData)) {
      const data = rawData as Record<string, unknown>;
      if (Array.isArray(data.conditions)) {
        return this.parseRoadConditions(data.conditions);
      }
      return conditions;
    }

    for (const item of rawData) {
      try {
        const properties = (item as Record<string, unknown>).properties || item;

        const startMM = (properties as Record<string, unknown>)
          .startMileMarker as number;
        const endMM = (properties as Record<string, unknown>)
          .endMileMarker as number;
        const condition = (properties as Record<string, unknown>)
          .condition as string;

        if (startMM !== undefined && condition) {
          conditions.set(`${startMM}-${endMM}`, condition);
        }
      } catch (error) {
        console.warn('Failed to parse road condition:', error);
      }
    }

    return conditions;
  }

  /**
   * Format camera ID to human-readable name
   */
  private formatCameraName(cameraId: string): string {
    return cameraId
      .split('-')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }
}
