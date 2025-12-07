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
 * AI Vibe Check response schema (what Claude should return)
 */
export const VibeCheckResponseSchema = z.object({
  score: VibeScoreSchema,
  summary: z.string().max(100),
});

/**
 * CDOT Incident from API
 */
export const CDOTIncidentSchema = z.object({
  id: z.string(),
  type: z.string(),
  description: z.string(),
  location: z.object({
    latitude: z.number(),
    longitude: z.number(),
    mileMarker: z.number().optional(),
    route: z.string().optional(),
  }),
  severity: z.string().optional(),
  startTime: z.coerce.date().optional(),
  endTime: z.coerce.date().optional(),
});

/**
 * CDOT Speed segment data
 */
export const CDOTSpeedSchema = z.object({
  segmentId: z.string(),
  currentSpeed: z.number(),
  freeFlowSpeed: z.number().optional(),
  congestionLevel: z.string().optional(),
});

/**
 * CDOT Road condition
 */
export const CDOTRoadConditionSchema = z.object({
  route: z.string(),
  startMileMarker: z.number(),
  endMileMarker: z.number(),
  condition: z.string(),
  description: z.string().optional(),
});
