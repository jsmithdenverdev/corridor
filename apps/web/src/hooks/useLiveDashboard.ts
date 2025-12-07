import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import type { LiveDashboard, Trend, Camera } from '@corridor/shared';

interface DashboardState {
  segments: LiveDashboard[];
  loading: boolean;
  error: Error | null;
  lastUpdated: Date | null;
}

/**
 * Hook for subscribing to live dashboard updates via Supabase Realtime
 */
export function useLiveDashboard(): DashboardState & { refresh: () => void } {
  const [state, setState] = useState<DashboardState>({
    segments: [],
    loading: true,
    error: null,
    lastUpdated: null,
  });

  // Fetch initial data
  const fetchData = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('live_dashboard')
        .select('*')
        .order('segment_id');

      if (error) throw error;

      // Transform database records to our type
      const segments: LiveDashboard[] = (data || []).map((row) => ({
        segment_id: row.segment_id,
        current_speed: row.current_speed,
        vibe_score: row.vibe_score,
        ai_summary: row.ai_summary,
        trend: row.trend as Trend,
        active_cameras: (row.active_cameras as Camera[]) || [],
        updated_at: new Date(row.updated_at),
      }));

      setState({
        segments,
        loading: false,
        error: null,
        lastUpdated: new Date(),
      });
    } catch (err) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: err instanceof Error ? err : new Error('Failed to fetch data'),
      }));
    }
  }, []);

  useEffect(() => {
    // Initial fetch
    fetchData();

    // Set up realtime subscription
    const channel = supabase
      .channel('live_dashboard_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'live_dashboard',
        },
        (payload) => {
          if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
            const newRecord = payload.new as Record<string, unknown>;

            const segment: LiveDashboard = {
              segment_id: newRecord.segment_id as string,
              current_speed: newRecord.current_speed as number | null,
              vibe_score: newRecord.vibe_score as number | null,
              ai_summary: newRecord.ai_summary as string | null,
              trend: newRecord.trend as Trend,
              active_cameras: (newRecord.active_cameras as Camera[]) || [],
              updated_at: new Date(newRecord.updated_at as string),
            };

            setState((prev) => {
              const existingIndex = prev.segments.findIndex(
                (s) => s.segment_id === segment.segment_id
              );

              let newSegments: LiveDashboard[];
              if (existingIndex >= 0) {
                newSegments = [...prev.segments];
                newSegments[existingIndex] = segment;
              } else {
                newSegments = [...prev.segments, segment].sort((a, b) =>
                  a.segment_id.localeCompare(b.segment_id)
                );
              }

              return {
                ...prev,
                segments: newSegments,
                lastUpdated: new Date(),
              };
            });
          }

          if (payload.eventType === 'DELETE') {
            const oldRecord = payload.old as Record<string, unknown>;
            setState((prev) => ({
              ...prev,
              segments: prev.segments.filter(
                (s) => s.segment_id !== oldRecord.segment_id
              ),
              lastUpdated: new Date(),
            }));
          }
        }
      )
      .subscribe();

    // Cleanup on unmount
    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchData]);

  return {
    ...state,
    refresh: fetchData,
  };
}
