import { useLiveDashboard } from '@/hooks/useLiveDashboard';
import { SegmentCard } from './SegmentCard';
import { formatRelativeTime } from '@/lib/utils';

export function Dashboard() {
  const { segments, loading, error, lastUpdated, refresh } = useLiveDashboard();

  if (loading) {
    return (
      <div className="dashboard loading">
        <div className="loading-spinner" />
        <p>Loading corridor status...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="dashboard error">
        <div className="error-icon">⚠️</div>
        <h2>Unable to load data</h2>
        <p>{error.message}</p>
        <button onClick={refresh} className="retry-button">
          Try Again
        </button>
      </div>
    );
  }

  if (segments.length === 0) {
    return (
      <div className="dashboard empty">
        <div className="empty-icon">🏔️</div>
        <h2>No data available</h2>
        <p>The corridor status will appear here once data is collected.</p>
        <button onClick={refresh} className="retry-button">
          Refresh
        </button>
      </div>
    );
  }

  // Calculate overall vibe
  const avgVibe =
    segments.reduce((sum, s) => sum + (s.vibe_score ?? 5), 0) / segments.length;

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <div className="header-content">
          <h1>I-70 Corridor</h1>
          <p className="subtitle">Georgetown to Eisenhower Tunnel</p>
        </div>
        <div className="overall-vibe">
          <span className="vibe-label">Overall</span>
          <span className="vibe-value">{avgVibe.toFixed(1)}</span>
        </div>
      </header>

      <main className="segment-list">
        {segments.map((segment) => (
          <SegmentCard key={segment.segment_id} segment={segment} />
        ))}
      </main>

      <footer className="dashboard-footer">
        <button onClick={refresh} className="refresh-button" title="Refresh">
          🔄
        </button>
        <span className="last-updated">
          {lastUpdated
            ? `Updated ${formatRelativeTime(lastUpdated)}`
            : 'Live updates enabled'}
        </span>
      </footer>
    </div>
  );
}
