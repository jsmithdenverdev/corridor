// Constants and segment definitions
export {
  I70_SEGMENTS,
  SEGMENT_IDS,
  MVP_MILE_MARKER_RANGE,
  CAMERA_BASE_URL,
  getSegmentByMileMarker,
  getSegmentById,
  getCameraSnapshotUrl,
  type SegmentKey,
  type Segment,
  type SegmentId,
} from './constants';

// Zod schemas for validation
export {
  VibeScoreSchema,
  TrendSchema,
  CameraSchema,
  LiveDashboardSchema,
  StatusBufferSchema,
  VibeCheckResponseSchema,
  CDOTIncidentSchema,
  CDOTSpeedSchema,
  CDOTRoadConditionSchema,
} from './schemas';

// TypeScript types
export type {
  LiveDashboard,
  StatusBuffer,
  Camera,
  Trend,
  CDOTIncident,
  CDOTSpeed,
  CDOTRoadCondition,
  VibeCheckResponse,
  SegmentData,
  VibeCheckResult,
  WorkerRunResult,
} from './types';
