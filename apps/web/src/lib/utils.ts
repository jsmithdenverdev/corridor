import type { Trend } from '@corridor/shared';

/**
 * Get color for vibe score (0-10)
 */
export function getVibeColor(score: number): string {
  if (score <= 2) return '#ef4444'; // red-500
  if (score <= 4) return '#f97316'; // orange-500
  if (score <= 6) return '#eab308'; // yellow-500
  if (score <= 8) return '#22c55e'; // green-500
  return '#10b981'; // emerald-500
}

/**
 * Get emoji for vibe score
 */
export function getVibeEmoji(score: number): string {
  if (score <= 2) return '🔴';
  if (score <= 4) return '🟠';
  if (score <= 6) return '🟡';
  if (score <= 8) return '🟢';
  return '✨';
}

/**
 * Get trend icon
 */
export function getTrendIcon(trend: Trend): string {
  switch (trend) {
    case 'IMPROVING':
      return '📈';
    case 'WORSENING':
      return '📉';
    case 'STABLE':
    default:
      return '➡️';
  }
}

/**
 * Get trend color
 */
export function getTrendColor(trend: Trend): string {
  switch (trend) {
    case 'IMPROVING':
      return '#22c55e'; // green
    case 'WORSENING':
      return '#ef4444'; // red
    case 'STABLE':
    default:
      return '#6b7280'; // gray
  }
}

/**
 * Format segment ID to display name
 */
export function formatSegmentName(segmentId: string): string {
  return segmentId
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Format relative time
 */
export function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return 'just now';
  if (diffMins === 1) return '1 min ago';
  if (diffMins < 60) return `${diffMins} mins ago`;

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours === 1) return '1 hour ago';
  return `${diffHours} hours ago`;
}
