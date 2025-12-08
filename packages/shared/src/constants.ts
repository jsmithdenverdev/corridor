import type { CorridorSegment } from './types';

/**
 * CDOT API Configuration
 */
export const CDOT_API_BASE = 'https://data.cotrip.org/api/v1';

/**
 * Mile marker range for I-70 Westbound corridor (Georgetown to Tunnel)
 */
export const CORRIDOR_MILE_MARKERS = {
  start: 213, // Eisenhower Tunnel
  end: 228, // Georgetown
} as const;

/**
 * Corridor Segments Watchlist
 *
 * These are the specific CDOT destinations we track.
 * The `jsonName` must match exactly what CDOT returns in the API.
 */
export const CORRIDOR_SEGMENTS: CorridorSegment[] = [
  {
    logicalName: 'The Gauntlet',
    jsonName: '070W224 Silverplume Chainup to Tunnel (East Entrance)',
    distanceMiles: 10.5,
    freeFlowSeconds: 600, // 10 mins @ 60mph
  },
  {
    logicalName: 'The Approach',
    jsonName: '070W266 Kipling to Idaho Springs',
    distanceMiles: 25.0,
    freeFlowSeconds: 1500, // 25 mins @ 60mph
  },
];

/**
 * Get segment by logical name
 */
export function getSegmentByName(name: string): CorridorSegment | undefined {
  return CORRIDOR_SEGMENTS.find((s) => s.logicalName === name);
}

/**
 * Get segment by CDOT JSON name
 */
export function getSegmentByJsonName(
  jsonName: string
): CorridorSegment | undefined {
  return CORRIDOR_SEGMENTS.find((s) => s.jsonName === jsonName);
}

/**
 * Speed anomaly threshold
 * If implied speed exceeds this, treat as bad data
 */
export const MAX_REASONABLE_SPEED_MPH = 85;

/**
 * Vibe score penalties
 */
export const VIBE_PENALTIES = {
  /** Lane closure penalty */
  LANE_CLOSURE: 2,
  /** Full road closure penalty */
  ROAD_CLOSURE: 5,
  /** Icy/Snow road condition penalty */
  ICY_CONDITIONS: 1,
} as const;

/**
 * Weather sensor types we care about
 */
export const RELEVANT_WEATHER_SENSORS = [
  'road surface status',
  'wind gust',
] as const;

/**
 * Camera configuration
 * Using static snapshot URLs (not M3U8 streams)
 */
export const CAMERA_BASE_URL = 'https://www.cotrip.org/camera';

export function getCameraSnapshotUrl(cameraId: string): string {
  return `${CAMERA_BASE_URL}/${cameraId}/snapshot.jpg`;
}
