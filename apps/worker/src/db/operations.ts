import { eq, lt, gt, and, desc } from 'drizzle-orm';
import { getDb } from './client';
import {
  liveDashboard,
  statusBuffer,
  incidentCache,
  workerRun,
  cdotSnapshot,
  vibeScoreHistory,
  incidentHistory,
} from './schema';
import type {
  LiveDashboard,
  StatusBuffer,
  Trend,
  CdotDestination,
  CdotIncident,
  CdotCondition,
  CdotWeatherStation,
} from '@corridor/shared';

/**
 * Upsert live dashboard data for a segment
 * Uses PostgreSQL ON CONFLICT for atomic upsert
 */
export async function upsertLiveDashboard(
  data: Omit<LiveDashboard, 'updated_at'>
): Promise<void> {
  const db = getDb();

  await db
    .insert(liveDashboard)
    .values({
      segment_id: data.segment_id,
      current_speed: data.current_speed,
      vibe_score: data.vibe_score,
      ai_summary: data.ai_summary,
      trend: data.trend,
      active_cameras: data.active_cameras,
      updated_at: new Date(),
    })
    .onConflictDoUpdate({
      target: liveDashboard.segment_id,
      set: {
        current_speed: data.current_speed,
        vibe_score: data.vibe_score,
        ai_summary: data.ai_summary,
        trend: data.trend,
        active_cameras: data.active_cameras,
        updated_at: new Date(),
      },
    });
}

/**
 * Insert a new entry into the status buffer
 */
export async function insertStatusBuffer(
  data: Omit<StatusBuffer, 'id' | 'timestamp'>
): Promise<void> {
  const db = getDb();

  await db.insert(statusBuffer).values({
    segment_id: data.segment_id,
    speed: data.speed,
    vibe_score: data.vibe_score,
    timestamp: new Date(),
  });
}

/**
 * Get recent buffer entries for a segment (for trend calculation)
 * @param segmentId - The segment to query
 * @param minutes - How far back to look (default: 120 minutes / 2 hours)
 */
export async function getRecentBufferEntries(
  segmentId: string,
  minutes = 120
): Promise<StatusBuffer[]> {
  const db = getDb();
  const cutoff = new Date(Date.now() - minutes * 60 * 1000);

  const results = await db
    .select()
    .from(statusBuffer)
    .where(
      and(
        eq(statusBuffer.segment_id, segmentId),
        gt(statusBuffer.timestamp, cutoff)
      )
    )
    .orderBy(desc(statusBuffer.timestamp));

  return results.map((r) => ({
    id: r.id,
    segment_id: r.segment_id,
    speed: r.speed,
    vibe_score: r.vibe_score,
    timestamp: r.timestamp,
  }));
}

/**
 * Cleanup old buffer entries (older than 2 hours)
 * Called after each worker run to keep the table small
 */
export async function cleanupOldBufferEntries(): Promise<number> {
  const db = getDb();
  const cutoff = new Date(Date.now() - 2 * 60 * 60 * 1000);

  const result = await db
    .delete(statusBuffer)
    .where(lt(statusBuffer.timestamp, cutoff))
    .returning({ id: statusBuffer.id });

  return result.length;
}

/**
 * Calculate trend from buffer entries
 * Compares recent third of entries to oldest third
 */
export function calculateTrend(entries: StatusBuffer[]): Trend {
  if (entries.length < 6) {
    // Need at least 6 entries to have meaningful trend
    return 'STABLE';
  }

  const third = Math.floor(entries.length / 3);

  // Recent entries (first third - entries are sorted desc by timestamp)
  const recentEntries = entries.slice(0, third);
  // Older entries (last third)
  const olderEntries = entries.slice(-third);

  const avgRecentVibe = average(
    recentEntries.map((e) => e.vibe_score ?? 5)
  );
  const avgOlderVibe = average(
    olderEntries.map((e) => e.vibe_score ?? 5)
  );

  // Threshold for trend detection
  const threshold = 0.5;

  if (avgRecentVibe - avgOlderVibe > threshold) {
    return 'IMPROVING';
  }
  if (avgOlderVibe - avgRecentVibe > threshold) {
    return 'WORSENING';
  }

  return 'STABLE';
}

/**
 * Helper: Calculate average of numbers
 */
function average(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

// =============================================================================
// Incident Cache Operations
// =============================================================================

/**
 * Get cached incident normalization by message hash
 */
export async function getCachedIncident(
  hash: string
): Promise<{ summary: string; penalty: number } | null> {
  const db = getDb();

  const results = await db
    .select()
    .from(incidentCache)
    .where(eq(incidentCache.message_hash, hash))
    .limit(1);

  if (results.length === 0) {
    return null;
  }

  const cached = results[0];
  return {
    summary: cached!.normalized_text,
    penalty: cached!.severity_penalty,
  };
}

/**
 * Store incident normalization in cache
 */
export async function setCachedIncident(
  hash: string,
  summary: string,
  penalty: number
): Promise<void> {
  const db = getDb();

  await db
    .insert(incidentCache)
    .values({
      message_hash: hash,
      normalized_text: summary,
      severity_penalty: penalty,
      created_at: new Date(),
    })
    .onConflictDoNothing();
}

/**
 * Cleanup old incident cache entries (older than 24 hours)
 */
export async function cleanupOldCacheEntries(): Promise<number> {
  const db = getDb();
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const result = await db
    .delete(incidentCache)
    .where(lt(incidentCache.created_at, cutoff))
    .returning({ hash: incidentCache.message_hash });

  return result.length;
}

/**
 * Get all current dashboard entries
 * Useful for debugging and health checks
 */
export async function getAllDashboardEntries(): Promise<LiveDashboard[]> {
  const db = getDb();

  const results = await db.select().from(liveDashboard);

  return results.map((r) => ({
    segment_id: r.segment_id,
    current_speed: r.current_speed,
    vibe_score: r.vibe_score,
    ai_summary: r.ai_summary,
    trend: r.trend as Trend,
    active_cameras: r.active_cameras ?? [],
    updated_at: r.updated_at,
  }));
}

// =============================================================================
// Audit Trail Operations
// =============================================================================

/**
 * Create a new worker run record
 * Returns the run ID for correlation with other audit tables
 */
export async function createWorkerRun(): Promise<number> {
  const db = getDb();

  const result = await db
    .insert(workerRun)
    .values({
      started_at: new Date(),
    })
    .returning({ id: workerRun.id });

  return result[0]!.id;
}

/**
 * Complete a worker run with final stats
 */
export type WorkerRunStats = {
  segmentsProcessed: number;
  incidentsTotal: number;
  incidentsNormalized: number;
  incidentsCached: number;
  success: boolean;
  errors: string[];
  durationMs: number;
};

export async function completeWorkerRun(
  runId: number,
  stats: WorkerRunStats
): Promise<void> {
  const db = getDb();

  await db
    .update(workerRun)
    .set({
      completed_at: new Date(),
      segments_processed: stats.segmentsProcessed,
      incidents_total: stats.incidentsTotal,
      incidents_normalized: stats.incidentsNormalized,
      incidents_cached: stats.incidentsCached,
      success: stats.success,
      error_messages: stats.errors,
      duration_ms: stats.durationMs,
    })
    .where(eq(workerRun.id, runId));
}

/**
 * Save raw CDOT API responses for a worker run
 */
export type CdotRawData = {
  destinations: CdotDestination[];
  incidents: CdotIncident[];
  conditions: CdotCondition[];
  weatherStations: CdotWeatherStation[];
};

export async function saveCdotSnapshot(
  runId: number,
  data: CdotRawData
): Promise<void> {
  const db = getDb();

  await db.insert(cdotSnapshot).values({
    worker_run_id: runId,
    destinations: data.destinations,
    incidents: data.incidents,
    conditions: data.conditions,
    weather_stations: data.weatherStations,
    fetched_at: new Date(),
  });
}

/**
 * Save vibe score history with full breakdown
 */
export type VibeScoreData = {
  segmentId: string;
  vibeScore: number;
  flowScore: number;
  incidentPenalty: number;
  weatherPenalty: number;
  travelTimeSeconds: number | null;
  impliedSpeedMph: number | null;
  speedAnomalyDetected: boolean;
  roadCondition: string | null;
  weatherSurface: string | null;
  aiSummary: string | null;
  trend: Trend;
};

export async function saveVibeScoreHistory(
  runId: number,
  data: VibeScoreData
): Promise<void> {
  const db = getDb();

  await db.insert(vibeScoreHistory).values({
    worker_run_id: runId,
    segment_id: data.segmentId,
    vibe_score: data.vibeScore,
    flow_score: data.flowScore,
    incident_penalty: data.incidentPenalty,
    weather_penalty: data.weatherPenalty,
    travel_time_seconds: data.travelTimeSeconds,
    implied_speed_mph: data.impliedSpeedMph,
    speed_anomaly_detected: data.speedAnomalyDetected,
    road_condition: data.roadCondition,
    weather_surface: data.weatherSurface,
    ai_summary: data.aiSummary,
    trend: data.trend,
    timestamp: new Date(),
  });
}

/**
 * Save incident history records
 */
export type IncidentHistoryData = {
  cdotIncidentId: string;
  incidentType: string;
  severity: 'major' | 'moderate' | 'minor';
  startMarker: number | null;
  endMarker: number | null;
  originalMessage: string;
  normalizedSummary: string;
  penaltyApplied: number;
  fromCache: boolean;
  cacheHash: string | null;
};

export async function saveIncidentHistory(
  runId: number,
  incidents: IncidentHistoryData[]
): Promise<void> {
  if (incidents.length === 0) return;

  const db = getDb();

  await db.insert(incidentHistory).values(
    incidents.map((i) => ({
      worker_run_id: runId,
      cdot_incident_id: i.cdotIncidentId,
      incident_type: i.incidentType,
      severity: i.severity,
      start_marker: i.startMarker,
      end_marker: i.endMarker,
      original_message: i.originalMessage,
      normalized_summary: i.normalizedSummary,
      penalty_applied: i.penaltyApplied,
      from_cache: i.fromCache,
      cache_hash: i.cacheHash,
      timestamp: new Date(),
    }))
  );
}

/**
 * Cleanup old audit data (older than 7 days)
 * Cascade deletes handle cdot_snapshot, vibe_score_history, incident_history
 */
export async function cleanupOldAuditData(): Promise<number> {
  const db = getDb();
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const result = await db
    .delete(workerRun)
    .where(lt(workerRun.started_at, sevenDaysAgo))
    .returning({ id: workerRun.id });

  return result.length;
}
