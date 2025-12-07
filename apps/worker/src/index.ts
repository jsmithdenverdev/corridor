#!/usr/bin/env bun
/**
 * Corridor Worker
 *
 * ETL job that runs every 5-10 minutes:
 * 1. Fetches data from CDOT API (speed, incidents, cameras)
 * 2. Sends conditions to Claude 3 Haiku for "vibe scoring"
 * 3. Calculates trends from historical data
 * 4. Updates Supabase (live_dashboard + status_buffer)
 * 5. Cleans up old buffer entries
 */

import { CDOTAggregator } from './cdot/aggregator';
import { VibeChecker } from './ai/client';
import {
  upsertLiveDashboard,
  insertStatusBuffer,
  getRecentBufferEntries,
  cleanupOldBufferEntries,
  calculateTrend,
} from './db/operations';
import { I70_SEGMENTS, type WorkerRunResult } from '@corridor/shared';

/**
 * Required environment variables
 */
const REQUIRED_ENV = ['CDOT_API_KEY', 'ANTHROPIC_API_KEY', 'DATABASE_URL'];

/**
 * Validate environment variables
 */
function validateEnv(): void {
  const missing = REQUIRED_ENV.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}\n` +
        'See .env.example for required configuration.'
    );
  }
}

/**
 * Main worker loop
 */
async function runWorkerLoop(): Promise<WorkerRunResult> {
  const startTime = Date.now();
  const errors: string[] = [];
  let segmentsProcessed = 0;

  console.log(`[${new Date().toISOString()}] Starting Corridor worker...`);

  const aggregator = new CDOTAggregator({
    apiKey: process.env.CDOT_API_KEY!,
  });

  const vibeChecker = new VibeChecker({
    apiKey: process.env.ANTHROPIC_API_KEY!,
  });

  try {
    // 1. Aggregate all CDOT data
    const segmentDataMap = await aggregator.aggregateAllSegments();

    console.log(`Processing ${segmentDataMap.size} segments...`);

    // 2. Process each segment
    for (const [segmentId, data] of segmentDataMap) {
      const segment = Object.values(I70_SEGMENTS).find(
        (s) => s.id === segmentId
      );

      if (!segment) {
        console.warn(`Unknown segment: ${segmentId}`);
        continue;
      }

      try {
        console.log(`  ${segment.name}...`);

        // Build conditions text for AI
        const conditionsText = aggregator.buildIncidentText(
          data.incidents,
          data.roadCondition
        );

        // Get vibe score (AI with fallback)
        const vibeResult = await vibeChecker.getVibeScore(
          segment.name,
          data.speed,
          conditionsText
        );

        // Get historical data for trend calculation
        const recentEntries = await getRecentBufferEntries(segmentId);
        const trend = calculateTrend(recentEntries);

        // Insert into status buffer (for future trend calculations)
        await insertStatusBuffer({
          segment_id: segmentId,
          speed: data.speed,
          vibe_score: vibeResult.score,
        });

        // Update live dashboard
        await upsertLiveDashboard({
          segment_id: segmentId,
          current_speed: data.speed,
          vibe_score: vibeResult.score,
          ai_summary: vibeResult.summary,
          trend,
          active_cameras: data.cameras,
        });

        console.log(
          `    Vibe: ${vibeResult.score}/10, Trend: ${trend}${vibeResult.usedFallback ? ' (fallback)' : ''}`
        );

        segmentsProcessed++;
      } catch (error) {
        const errorMsg = `Error processing ${segment.name}: ${error}`;
        console.error(`    ${errorMsg}`);
        errors.push(errorMsg);
      }
    }

    // 3. Cleanup old buffer entries
    const deletedCount = await cleanupOldBufferEntries();
    if (deletedCount > 0) {
      console.log(`Cleaned up ${deletedCount} old buffer entries`);
    }
  } catch (error) {
    const errorMsg = `Worker loop error: ${error}`;
    console.error(errorMsg);
    errors.push(errorMsg);
  }

  const duration = Date.now() - startTime;

  console.log(
    `[${new Date().toISOString()}] Worker completed in ${duration}ms`
  );
  console.log(`  Segments processed: ${segmentsProcessed}`);
  console.log(`  Errors: ${errors.length}`);

  return {
    success: errors.length === 0,
    segmentsProcessed,
    errors,
    duration,
  };
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  try {
    validateEnv();
    const result = await runWorkerLoop();

    if (!result.success) {
      console.error('Worker completed with errors');
      process.exit(1);
    }
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

// Run the worker
main();
