import {
  CDOT_API_BASE,
  CORRIDOR_MILE_MARKERS,
  RELEVANT_WEATHER_SENSORS,
  CdotDestinationSchema,
  CdotIncidentSchema,
  CdotConditionSchema,
  CdotWeatherStationSchema,
} from '@corridor/shared';

import type {
  CdotDestination,
  CdotIncident,
  CdotCondition,
  CdotWeatherStation,
} from '@corridor/shared';

type CdotClientConfig = {
  apiKey: string;
  timeout?: number;
};

/**
 * CDOT API Client
 *
 * Fetches data from 4 endpoints:
 * - /destinations (traffic flow/travel times)
 * - /incidents (crashes, closures)
 * - /roadConditions (surface state)
 * - /weatherStations (hyper-local weather)
 *
 * Auth: Query param ?apiKey=YOUR_KEY
 */
export const createCdotClient = (config: CdotClientConfig) => {
  const apiKey = config.apiKey;
  const timeout = config.timeout ?? 30000;

  /**
   * Fetch from CDOT API endpoint
   * Auth via query param: ?apiKey=YOUR_KEY
   */
  const fetchEndpoint = async (endpoint: string): Promise<unknown> => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const url = `${CDOT_API_BASE}${endpoint}?apiKey=${apiKey}`;
      const response = await fetch(url, {
        headers: {
          Accept: 'application/json',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`CDOT API error: ${response.status} ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`CDOT API timeout for ${endpoint}`);
      }
      throw error;
    }
  };

  /**
   * Extract features array from GeoJSON response
   */
  const extractFeatures = (data: unknown): unknown[] => {
    if (Array.isArray(data)) {
      return data;
    }

    const obj = data as Record<string, unknown>;

    // Standard GeoJSON FeatureCollection
    if (Array.isArray(obj.features)) {
      return obj.features;
    }

    // Other common wrappers
    if (Array.isArray(obj.data)) {
      return obj.data;
    }

    console.warn('Unexpected CDOT API response format');
    return [];
  };

  /**
   * Parse destinations response
   * Filter to westbound I-70 (070W in name)
   */
  const parseDestinations = (data: unknown): CdotDestination[] => {
    const features = extractFeatures(data);
    const destinations: CdotDestination[] = [];

    for (const feature of features) {
      try {
        // Filter to westbound only (070W in name)
        const featureObj = feature as Record<string, unknown>;
        const props = featureObj.properties as Record<string, unknown> | undefined;
        const name = props?.name;
        if (typeof name !== 'string' || !name.includes('070W')) {
          continue;
        }

        const parsed = CdotDestinationSchema.safeParse(feature);
        if (parsed.success) {
          destinations.push(parsed.data);
        }
      } catch (error) {
        // Skip invalid entries
      }
    }

    return destinations;
  };

  /**
   * Parse incidents response
   * Filter to westbound I-70 within corridor mile markers
   */
  const parseIncidents = (data: unknown): CdotIncident[] => {
    const features = extractFeatures(data);
    const incidents: CdotIncident[] = [];

    for (const feature of features) {
      try {
        const props = (feature as Record<string, unknown>).properties as
          | Record<string, unknown>
          | undefined;

        if (!props) continue;

        // Filter by mile marker range
        const startMarker = props.startMarker as number | undefined;
        const endMarker = props.endMarker as number | undefined;

        if (startMarker === undefined || endMarker === undefined) continue;

        // Check if incident overlaps with our corridor
        if (
          endMarker < CORRIDOR_MILE_MARKERS.start ||
          startMarker > CORRIDOR_MILE_MARKERS.end
        ) {
          continue;
        }

        // Note: Could also filter by direction field if available
        // For now, mile marker filtering should be sufficient for westbound

        const parsed = CdotIncidentSchema.safeParse(feature);
        if (parsed.success) {
          incidents.push(parsed.data);
        }
      } catch (error) {
        // Skip invalid entries
      }
    }

    return incidents;
  };

  /**
   * Parse road conditions response
   * Filter to I-70 within corridor mile markers
   */
  const parseConditions = (data: unknown): CdotCondition[] => {
    const features = extractFeatures(data);
    const conditions: CdotCondition[] = [];

    for (const feature of features) {
      try {
        const props = (feature as Record<string, unknown>).properties as
          | Record<string, unknown>
          | undefined;

        if (!props) continue;

        // Filter to I-70
        const routeName = props.routeName as string | undefined;
        if (!routeName?.includes('I-70')) continue;

        // Check if condition overlaps with our corridor
        const primaryMP = props.primaryMP as number | undefined;
        const secondaryMP = props.secondaryMP as number | undefined;

        if (primaryMP !== undefined && secondaryMP !== undefined) {
          const minMM = Math.min(primaryMP, secondaryMP);
          const maxMM = Math.max(primaryMP, secondaryMP);

          if (
            maxMM < CORRIDOR_MILE_MARKERS.start ||
            minMM > CORRIDOR_MILE_MARKERS.end
          ) {
            continue;
          }
        }

        const parsed = CdotConditionSchema.safeParse(feature);
        if (parsed.success) {
          conditions.push(parsed.data);
        }
      } catch (error) {
        // Skip invalid entries
      }
    }

    return conditions;
  };

  /**
   * Parse weather stations response
   * Filter to stations in corridor area (070W in name)
   * Only extract relevant sensors (road surface status, wind gust)
   */
  const parseWeatherStations = (data: unknown): CdotWeatherStation[] => {
    const features = extractFeatures(data);
    const stations: CdotWeatherStation[] = [];

    for (const feature of features) {
      try {
        const props = (feature as Record<string, unknown>).properties as
          | Record<string, unknown>
          | undefined;

        if (!props) continue;

        // Filter to westbound corridor stations
        const name = props.name as string | undefined;
        if (!name?.includes('070W')) continue;

        // Filter sensors to only relevant types
        const sensors = props.sensors as Array<Record<string, unknown>> | undefined;
        if (!sensors) continue;

        const filteredSensors = sensors.filter((sensor) => {
          const sensorType = (sensor.type as string)?.toLowerCase();
          return RELEVANT_WEATHER_SENSORS.some((relevant) =>
            sensorType?.includes(relevant)
          );
        });

        // Build filtered station
        const featureObj = feature as Record<string, unknown>;
        const filteredFeature = {
          ...featureObj,
          properties: {
            ...props,
            sensors: filteredSensors,
          },
        };

        const parsed = CdotWeatherStationSchema.safeParse(filteredFeature);
        if (parsed.success) {
          stations.push(parsed.data);
        }
      } catch (error) {
        // Skip invalid entries
      }
    }

    return stations;
  };

  /**
   * Fetch destinations (primary source for traffic flow/speed)
   * Filter to westbound I-70 (070W in name)
   */
  const getDestinations = async (): Promise<CdotDestination[]> => {
    try {
      const data = await fetchEndpoint('/destinations');
      return parseDestinations(data);
    } catch (error) {
      console.error('Failed to fetch CDOT destinations:', error);
      return [];
    }
  };

  /**
   * Fetch incidents on I-70 westbound within corridor mile markers
   */
  const getIncidents = async (): Promise<CdotIncident[]> => {
    try {
      const data = await fetchEndpoint('/incidents');
      return parseIncidents(data);
    } catch (error) {
      console.error('Failed to fetch CDOT incidents:', error);
      return [];
    }
  };

  /**
   * Fetch road conditions for I-70
   */
  const getRoadConditions = async (): Promise<CdotCondition[]> => {
    try {
      const data = await fetchEndpoint('/roadConditions');
      return parseConditions(data);
    } catch (error) {
      console.error('Failed to fetch CDOT road conditions:', error);
      return [];
    }
  };

  /**
   * Fetch weather stations for corridor area
   */
  const getWeatherStations = async (): Promise<CdotWeatherStation[]> => {
    try {
      const data = await fetchEndpoint('/weatherStations');
      return parseWeatherStations(data);
    } catch (error) {
      console.error('Failed to fetch CDOT weather stations:', error);
      return [];
    }
  };

  return {
    getDestinations,
    getIncidents,
    getRoadConditions,
    getWeatherStations,
  };
};

export type CdotClient = ReturnType<typeof createCdotClient>;
