/**
 * I-70 Mountain Corridor Segment Definitions
 * MVP Scope: Georgetown to Eisenhower Tunnel (MM 213-228)
 */

export const I70_SEGMENTS = {
  EISENHOWER_TUNNEL: {
    id: 'eisenhower-tunnel',
    name: 'Eisenhower Tunnel',
    mileMarkers: { start: 213, end: 218 },
    cameras: ['eisenhower-east', 'eisenhower-west'],
    description: 'Highest point on the Interstate System (11,158 ft)',
  },
  LOVELAND_PASS_AREA: {
    id: 'loveland-pass-area',
    name: 'Loveland Pass Area',
    mileMarkers: { start: 218, end: 223 },
    cameras: ['loveland-ski-area'],
    description: 'Ski area and tunnel approach',
  },
  SILVER_PLUME: {
    id: 'silver-plume',
    name: 'Silver Plume',
    mileMarkers: { start: 223, end: 228 },
    cameras: ['silver-plume'],
    description: 'Historic mining town section',
  },
  GEORGETOWN: {
    id: 'georgetown',
    name: 'Georgetown',
    mileMarkers: { start: 228, end: 232 },
    cameras: ['georgetown-loop', 'georgetown-lake'],
    description: 'Gateway to the high country',
  },
} as const;

export type SegmentKey = keyof typeof I70_SEGMENTS;
export type Segment = (typeof I70_SEGMENTS)[SegmentKey];
export type SegmentId = Segment['id'];

/**
 * Get all segment IDs for iteration
 */
export const SEGMENT_IDS = Object.values(I70_SEGMENTS).map((s) => s.id);

/**
 * Mile marker range for MVP scope
 */
export const MVP_MILE_MARKER_RANGE = {
  start: 213,
  end: 232,
} as const;

/**
 * Find segment by mile marker
 */
export function getSegmentByMileMarker(
  mileMarker: number
): Segment | undefined {
  return Object.values(I70_SEGMENTS).find(
    (segment) =>
      mileMarker >= segment.mileMarkers.start &&
      mileMarker <= segment.mileMarkers.end
  );
}

/**
 * Get segment by ID
 */
export function getSegmentById(id: string): Segment | undefined {
  return Object.values(I70_SEGMENTS).find((segment) => segment.id === id);
}

/**
 * Camera configuration
 * Using static snapshot URLs (not M3U8 streams)
 */
export const CAMERA_BASE_URL = 'https://www.cotrip.org/camera';

export function getCameraSnapshotUrl(cameraId: string): string {
  return `${CAMERA_BASE_URL}/${cameraId}/snapshot.jpg`;
}
