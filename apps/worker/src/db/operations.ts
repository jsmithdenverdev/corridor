import { eq, lt, and, desc, sql } from 'drizzle-orm';
import { getDb } from './client';
import { liveDashboard, statusBuffer, incidentCache } from './schema';
import type { LiveDashboard, StatusBuffer, Trend } from '@corridor/shared';

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
        sql`${statusBuffer.timestamp} > ${cutoff}`
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
