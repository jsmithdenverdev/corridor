import {
  pgTable,
  text,
  real,
  timestamp,
  jsonb,
  serial,
  index,
} from 'drizzle-orm/pg-core';
import type { Camera } from '@corridor/shared';

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

// Type exports for Drizzle queries
export type LiveDashboardRecord = typeof liveDashboard.$inferSelect;
export type LiveDashboardInsert = typeof liveDashboard.$inferInsert;
export type StatusBufferRecord = typeof statusBuffer.$inferSelect;
export type StatusBufferInsert = typeof statusBuffer.$inferInsert;
