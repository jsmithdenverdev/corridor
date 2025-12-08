import {
  pgTable,
  text,
  real,
  timestamp,
  jsonb,
  serial,
  index,
  integer,
  boolean,
} from 'drizzle-orm/pg-core';
import type {
  Camera,
  CdotDestination,
  CdotIncident,
  CdotCondition,
  CdotWeatherStation,
} from '@corridor/shared';

/**
 * Live Dashboard - Singleton per segment
 * The "hot" table that the frontend reads from via Supabase Realtime
 */
export const liveDashboard = pgTable(
  'live_dashboard',
  {
    segment_id: text('segment_id').primaryKey(),
    current_speed: real('current_speed'),
    vibe_score: real('vibe_score'), // 0-10 scale
    ai_summary: text('ai_summary'),
    trend: text('trend', { enum: ['IMPROVING', 'WORSENING', 'STABLE'] })
      .notNull()
      .default('STABLE'),
    active_cameras: jsonb('active_cameras').$type<Camera[]>().default([]),
    updated_at: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index('live_dashboard_updated_at_idx').on(table.updated_at)]
);

/**
 * Status Buffer - Rolling 2-hour window
 * Used by the worker to calculate trends
 * Self-cleaning: worker deletes rows older than 2 hours
 */
export const statusBuffer = pgTable(
  'status_buffer',
  {
    id: serial('id').primaryKey(),
    segment_id: text('segment_id').notNull(),
    speed: real('speed'),
    vibe_score: real('vibe_score'),
    timestamp: timestamp('timestamp', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('status_buffer_segment_timestamp_idx').on(
      table.segment_id,
      table.timestamp
    ),
    index('status_buffer_timestamp_idx').on(table.timestamp),
  ]
);

/**
 * Incident Cache - LLM cost control
 * Stores normalized incident text by message hash to avoid re-processing
 */
export const incidentCache = pgTable('incident_cache', {
  message_hash: text('message_hash').primaryKey(),
  normalized_text: text('normalized_text').notNull(),
  severity_penalty: real('severity_penalty').notNull(),
  created_at: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// =============================================================================
// Audit Tables
// =============================================================================

/**
 * Worker Run - Central correlation point for audit trail
 * Links each worker execution to all associated data
 */
export const workerRun = pgTable(
  'worker_run',
  {
    id: serial('id').primaryKey(),
    started_at: timestamp('started_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    completed_at: timestamp('completed_at', { withTimezone: true }),
    segments_processed: integer('segments_processed').notNull().default(0),
    incidents_total: integer('incidents_total').notNull().default(0),
    incidents_normalized: integer('incidents_normalized').notNull().default(0),
    incidents_cached: integer('incidents_cached').notNull().default(0),
    success: boolean('success').notNull().default(false),
    error_messages: jsonb('error_messages').$type<string[]>().default([]),
    duration_ms: integer('duration_ms'),
  },
  (table) => [index('worker_run_started_at_idx').on(table.started_at)]
);

/**
 * CDOT Snapshot - Full raw CDOT API responses
 * One row per worker run with complete API data for debugging
 */
export const cdotSnapshot = pgTable(
  'cdot_snapshot',
  {
    id: serial('id').primaryKey(),
    worker_run_id: integer('worker_run_id')
      .notNull()
      .references(() => workerRun.id, { onDelete: 'cascade' })
      .unique(),
    destinations: jsonb('destinations')
      .$type<CdotDestination[]>()
      .notNull(),
    incidents: jsonb('incidents').$type<CdotIncident[]>().notNull(),
    conditions: jsonb('conditions').$type<CdotCondition[]>().notNull(),
    weather_stations: jsonb('weather_stations')
      .$type<CdotWeatherStation[]>()
      .notNull(),
    fetched_at: timestamp('fetched_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('cdot_snapshot_worker_run_idx').on(table.worker_run_id),
    index('cdot_snapshot_fetched_at_idx').on(table.fetched_at),
  ]
);

/**
 * Vibe Score History - Extended historical scores
 * Full breakdown of each vibe score calculation for auditing
 */
export const vibeScoreHistory = pgTable(
  'vibe_score_history',
  {
    id: serial('id').primaryKey(),
    worker_run_id: integer('worker_run_id')
      .notNull()
      .references(() => workerRun.id, { onDelete: 'cascade' }),
    segment_id: text('segment_id').notNull(),

    // Score breakdown
    vibe_score: real('vibe_score').notNull(),
    flow_score: real('flow_score').notNull(),
    incident_penalty: real('incident_penalty').notNull(),
    weather_penalty: real('weather_penalty').notNull(),

    // Inputs
    travel_time_seconds: integer('travel_time_seconds'),
    implied_speed_mph: real('implied_speed_mph'),
    speed_anomaly_detected: boolean('speed_anomaly_detected')
      .notNull()
      .default(false),
    road_condition: text('road_condition'),
    weather_surface: text('weather_surface'),

    ai_summary: text('ai_summary'),
    trend: text('trend', { enum: ['IMPROVING', 'WORSENING', 'STABLE'] }),
    timestamp: timestamp('timestamp', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('vibe_score_history_segment_timestamp_idx').on(
      table.segment_id,
      table.timestamp
    ),
    index('vibe_score_history_worker_run_idx').on(table.worker_run_id),
    index('vibe_score_history_timestamp_idx').on(table.timestamp),
  ]
);

/**
 * Incident History - Normalized incidents archive
 * Links incidents to worker runs with both raw and normalized data
 */
export const incidentHistory = pgTable(
  'incident_history',
  {
    id: serial('id').primaryKey(),
    worker_run_id: integer('worker_run_id')
      .notNull()
      .references(() => workerRun.id, { onDelete: 'cascade' }),
    cdot_incident_id: text('cdot_incident_id').notNull(),
    incident_type: text('incident_type').notNull(),
    severity: text('severity', {
      enum: ['major', 'moderate', 'minor'],
    }).notNull(),
    start_marker: real('start_marker'),
    end_marker: real('end_marker'),
    original_message: text('original_message').notNull(),
    normalized_summary: text('normalized_summary').notNull(),
    penalty_applied: real('penalty_applied').notNull(),
    from_cache: boolean('from_cache').notNull().default(false),
    cache_hash: text('cache_hash'),
    timestamp: timestamp('timestamp', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('incident_history_worker_run_idx').on(table.worker_run_id),
    index('incident_history_cdot_id_idx').on(table.cdot_incident_id),
    index('incident_history_timestamp_idx').on(table.timestamp),
  ]
);

// Type exports for Drizzle queries
export type LiveDashboardRecord = typeof liveDashboard.$inferSelect;
export type LiveDashboardInsert = typeof liveDashboard.$inferInsert;
export type StatusBufferRecord = typeof statusBuffer.$inferSelect;
export type StatusBufferInsert = typeof statusBuffer.$inferInsert;
export type IncidentCacheRecord = typeof incidentCache.$inferSelect;
export type IncidentCacheInsert = typeof incidentCache.$inferInsert;
export type WorkerRunRecord = typeof workerRun.$inferSelect;
export type WorkerRunInsert = typeof workerRun.$inferInsert;
export type CdotSnapshotRecord = typeof cdotSnapshot.$inferSelect;
export type CdotSnapshotInsert = typeof cdotSnapshot.$inferInsert;
export type VibeScoreHistoryRecord = typeof vibeScoreHistory.$inferSelect;
export type VibeScoreHistoryInsert = typeof vibeScoreHistory.$inferInsert;
export type IncidentHistoryRecord = typeof incidentHistory.$inferSelect;
export type IncidentHistoryInsert = typeof incidentHistory.$inferInsert;
