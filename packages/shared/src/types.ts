import type { z } from 'zod';
import type {
  LiveDashboardSchema,
  StatusBufferSchema,
  CameraSchema,
  CDOTIncidentSchema,
  CDOTSpeedSchema,
  CDOTRoadConditionSchema,
  TrendSchema,
  VibeCheckResponseSchema,
} from './schemas';

// Database types
export type LiveDashboard = z.infer<typeof LiveDashboardSchema>;
export type StatusBuffer = z.infer<typeof StatusBufferSchema>;
export type Camera = z.infer<typeof CameraSchema>;
export type Trend = z.infer<typeof TrendSchema>;

// CDOT API types
export type CDOTIncident = z.infer<typeof CDOTIncidentSchema>;
export type CDOTSpeed = z.infer<typeof CDOTSpeedSchema>;
export type CDOTRoadCondition = z.infer<typeof CDOTRoadConditionSchema>;

// AI types
export type VibeCheckResponse = z.infer<typeof VibeCheckResponseSchema>;

/**
 * Internal worker types
 */
export interface SegmentData {
  segmentId: string;
  segmentName: string;
  speed: number | null;
  incidents: CDOTIncident[];
  cameras: Camera[];
  roadCondition: string | null;
}

export interface VibeCheckResult {
  score: number;
  summary: string;
  rawText: string;
  usedFallback: boolean;
}

export interface WorkerRunResult {
  success: boolean;
  segmentsProcessed: number;
  errors: string[];
  duration: number;
}
