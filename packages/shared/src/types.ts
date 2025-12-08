import type { z } from 'zod';
import type {
  LiveDashboardSchema,
  StatusBufferSchema,
  CameraSchema,
  TrendSchema,
  IncidentNormalizationSchema,
  CdotDestinationSchema,
  CdotIncidentSchema,
  CdotConditionSchema,
  CdotWeatherStationSchema,
  CdotWeatherSensorSchema,
  CorridorSegmentSchema,
  NormalizedIncidentSchema,
} from './schemas';

// Database types
export type LiveDashboard = z.infer<typeof LiveDashboardSchema>;
export type StatusBuffer = z.infer<typeof StatusBufferSchema>;
export type Camera = z.infer<typeof CameraSchema>;
export type Trend = z.infer<typeof TrendSchema>;

// AI types
export type IncidentNormalization = z.infer<typeof IncidentNormalizationSchema>;

// CDOT API types (matching actual API response format)
export type CdotDestination = z.infer<typeof CdotDestinationSchema>;
export type CdotIncident = z.infer<typeof CdotIncidentSchema>;
export type CdotCondition = z.infer<typeof CdotConditionSchema>;
export type CdotWeatherStation = z.infer<typeof CdotWeatherStationSchema>;
export type CdotWeatherSensor = z.infer<typeof CdotWeatherSensorSchema>;

// Corridor config types
export type CorridorSegment = z.infer<typeof CorridorSegmentSchema>;
export type NormalizedIncident = z.infer<typeof NormalizedIncidentSchema>;

/**
 * Processed segment data (internal worker type)
 */
export interface SegmentData {
  segment: CorridorSegment;
  travelTimeSeconds: number | null;
  impliedSpeedMph: number | null;
  /** True if implied speed > 85 mph (bad data) */
  speedAnomalyDetected: boolean;
  incidents: NormalizedIncident[];
  roadCondition: string | null;
  weatherSurface: string | null;
}

/**
 * Vibe calculation inputs
 */
export interface VibeInput {
  currentTravelTime: number;
  freeFlowTravelTime: number;
  incidents: NormalizedIncident[];
  roadCondition: string | null;
}

/**
 * Vibe calculation result
 */
export interface VibeResult {
  score: number;
  flowScore: number;
  incidentPenalty: number;
  weatherPenalty: number;
  summary: string;
}

/**
 * Worker run result
 */
export interface WorkerRunResult {
  success: boolean;
  segmentsProcessed: number;
  incidentsNormalized: number;
  incidentsCached: number;
  errors: string[];
  duration: number;
}

/**
 * Incident cache entry (for LLM cost control)
 */
export interface IncidentCacheEntry {
  messageHash: string;
  normalizedText: string;
  severityPenalty: number;
  createdAt: Date;
}
