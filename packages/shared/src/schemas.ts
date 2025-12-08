import { z } from 'zod';

/**
 * Vibe score: 0 = gridlock nightmare, 10 = smooth sailing
 */
export const VibeScoreSchema = z.number().min(0).max(10);

/**
 * Trend direction based on historical data
 */
export const TrendSchema = z.enum(['IMPROVING', 'WORSENING', 'STABLE']);

/**
 * Camera snapshot data
 */
export const CameraSchema = z.object({
  id: z.string(),
  name: z.string(),
  imageUrl: z.string().url(),
  lastUpdated: z.coerce.date(),
});

/**
 * Live dashboard record - what the frontend displays
 */
export const LiveDashboardSchema = z.object({
  segment_id: z.string(),
  current_speed: z.number().nullable(),
  vibe_score: VibeScoreSchema.nullable(),
  ai_summary: z.string().nullable(),
  trend: TrendSchema,
  active_cameras: z.array(CameraSchema),
  updated_at: z.coerce.date(),
});

/**
 * Status buffer record - for trend analysis (rolling 2hr window)
 */
export const StatusBufferSchema = z.object({
  id: z.number().optional(),
  segment_id: z.string(),
  speed: z.number().nullable(),
  vibe_score: VibeScoreSchema.nullable(),
  timestamp: z.coerce.date(),
});

/**
 * AI Incident Normalization response schema
 * Used to normalize dirty CDOT incident text
 */
export const IncidentNormalizationSchema = z.object({
  summary: z.string().max(100),
  penalty: z.number().min(0).max(10),
});

// =============================================================================
// CDOT API Schemas (matching actual API response format)
// =============================================================================

/**
 * CDOT Destination (from /destinations endpoint)
 * Primary source for traffic flow/speed - calculate speed from travelTime
 */
export const CdotDestinationSchema = z.object({
  type: z.literal('Feature'),
  properties: z.object({
    id: z.string(),
    name: z.string(), // e.g., "070W224 Silverplume Chainup to Tunnel"
    travelTime: z.number(), // IN SECONDS - critical metric
    lastUpdated: z.string(),
    segmentParts: z.array(
      z.object({
        route: z.string(), // "I-70W"
        startMarker: z.number(),
        endMarker: z.number(),
      })
    ),
  }),
});

/**
 * CDOT Incident (from /incidents endpoint)
 * Note: travelerInformationMessage is dirty text - send to LLM for normalization
 */
export const CdotIncidentSchema = z.object({
  type: z.literal('Feature'),
  properties: z.object({
    id: z.string(),
    type: z.string(), // e.g., "Crash", "Safety Closure", "Traction Law Code 15"
    severity: z.enum(['major', 'moderate', 'minor']),
    startMarker: z.number(),
    endMarker: z.number(),
    travelerInformationMessage: z.string(), // RAW TEXT: "Rt Ln Clsd due to..."
    lastUpdated: z.string(),
    routeName: z.string(), // e.g., "I-70"
    direction: z.string(), // e.g., "W", "E", "both"
  }),
});

/**
 * CDOT Road Condition (from /roadConditions endpoint)
 * Note: Conditions are often reported in large segments
 */
export const CdotConditionSchema = z.object({
  type: z.literal('Feature'),
  properties: z.object({
    routeName: z.string(), // "I-70"
    primaryMP: z.number(), // Start Mile Marker
    secondaryMP: z.number(), // End Mile Marker
    currentConditions: z.array(
      z.object({
        conditionId: z.number(),
        conditionDescription: z.string(), // "Wet", "Icy", "Dry"
      })
    ),
  }),
});

/**
 * CDOT Weather Station sensor
 */
export const CdotWeatherSensorSchema = z.object({
  type: z.string(), // "road surface status", "wind speed", "visibility"
  currentReading: z.string(), // "Wet", "25.04", "Low"
});

/**
 * CDOT Weather Station (from /weatherStations endpoint)
 */
export const CdotWeatherStationSchema = z.object({
  type: z.literal('Feature'),
  properties: z.object({
    name: z.string(), // e.g., "070W214 Eisenhower Tunnel West"
    sensors: z.array(CdotWeatherSensorSchema),
  }),
});

/**
 * Corridor segment configuration (watchlist)
 */
export const CorridorSegmentSchema = z.object({
  logicalName: z.string(),
  jsonName: z.string(), // Must match CDOT destination name
  distanceMiles: z.number(),
  freeFlowSeconds: z.number(),
});

/**
 * Normalized incident after LLM processing
 */
export const NormalizedIncidentSchema = z.object({
  id: z.string(),
  originalMessage: z.string(),
  summary: z.string(),
  penalty: z.number(), // -2 for lane closure, -5 for road closure
  severity: z.enum(['major', 'moderate', 'minor']),
});

// =============================================================================
// Segment Configuration Schemas (for Spatial Hub)
// =============================================================================

/**
 * Display properties for a segment
 */
export const SegmentDisplaySchema = z.object({
  subtitle: z.string(),
  direction: z.string(), // e.g., "W", "E", "both"
  color: z.string(),
});

/**
 * Geographic bounds for a segment
 */
export const SegmentBoundsSchema = z.object({
  routeId: z.string(), // e.g., "070"
  direction: z.string(), // e.g., "W", "E"
  startMM: z.number(),
  endMM: z.number(),
});

/**
 * Data sources for a segment
 */
export const SegmentDataSourcesSchema = z.object({
  destinationName: z.string(),
});

/**
 * Performance thresholds for a segment
 */
export const SegmentThresholdsSchema = z.object({
  freeFlowSeconds: z.number(),
  criticalSeconds: z.number(),
});

/**
 * Complete segment configuration
 */
export const SegmentConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  display: SegmentDisplaySchema,
  bounds: SegmentBoundsSchema,
  dataSources: SegmentDataSourcesSchema,
  thresholds: SegmentThresholdsSchema,
});

/**
 * Segment configuration file structure
 */
export const SegmentConfigFileSchema = z.object({
  version: z.string(),
  segments: z.array(SegmentConfigSchema),
});
