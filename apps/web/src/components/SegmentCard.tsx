import type { LiveDashboard } from '@corridor/shared';
import {
  getVibeColor,
  getVibeEmoji,
  getTrendIcon,
  getTrendColor,
  formatSegmentName,
  formatRelativeTime,
} from '@/lib/utils';

interface SegmentCardProps {
  segment: LiveDashboard;
}

export function SegmentCard({ segment }: SegmentCardProps) {
  const vibeColor = getVibeColor(segment.vibe_score ?? 5);
  const vibeEmoji = getVibeEmoji(segment.vibe_score ?? 5);
  const trendIcon = getTrendIcon(segment.trend);
  const trendColor = getTrendColor(segment.trend);

  return (
    <div
      className="segment-card"
      style={{ borderLeftColor: vibeColor }}
    >
      <div className="segment-header">
        <h2 className="segment-name">
          {formatSegmentName(segment.segment_id)}
        </h2>
        <div
          className="vibe-badge"
          style={{ backgroundColor: vibeColor }}
        >
          <span className="vibe-emoji">{vibeEmoji}</span>
          <span className="vibe-score">
            {segment.vibe_score?.toFixed(1) ?? '?'}/10
          </span>
        </div>
      </div>

      <div className="segment-body">
        <div className="speed-display">
          <span className="speed-value">
            {segment.current_speed ?? '--'}
          </span>
          <span className="speed-unit">mph</span>
        </div>

        <div
          className="trend-indicator"
          style={{ color: trendColor }}
        >
          <span className="trend-icon">{trendIcon}</span>
          <span className="trend-label">{segment.trend.toLowerCase()}</span>
        </div>
      </div>

      {segment.ai_summary && (
        <p className="ai-summary">{segment.ai_summary}</p>
      )}

      {segment.active_cameras.length > 0 && (
        <div className="camera-previews">
          {segment.active_cameras.slice(0, 2).map((camera) => (
            <div key={camera.id} className="camera-container">
              <img
                src={camera.imageUrl}
                alt={camera.name}
                className="camera-thumbnail"
                loading="lazy"
                onError={(e) => {
                  // Hide broken camera images
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
              />
              <span className="camera-label">{camera.name}</span>
            </div>
          ))}
        </div>
      )}

      <div className="segment-footer">
        <span className="updated-time">
          Updated {formatRelativeTime(new Date(segment.updated_at))}
        </span>
      </div>
    </div>
  );
}
