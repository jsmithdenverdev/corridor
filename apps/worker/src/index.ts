#!/usr/bin/env bun
/**
 * Corridor Worker
 *
 * ETL job that runs every 5-10 minutes:
 * 1. Fetches data from 4 CDOT endpoints (destinations, incidents, conditions, weather)
 * 2. Normalizes incident text with Claude (with hash caching for cost control)
 * 3. Calculates deterministic vibe score using flow ratio + penalties
 * 4. Updates Supabase (live_dashboard + status_buffer)
 * 5. Cleans up old entries
 */

import { CDOTAggregator } from './cdot/aggregator';
import { IncidentNormalizer } from './ai/client';
import { calculateVibeScore } from './vibe/calculator';
import {
  upsertLiveDashboard,
  insertStatusBuffer,
  getRecentBufferEntries,
  cleanupOldBufferEntries,
  cleanupOldCacheEntries,
  calculateTrend,
  getCachedIncident,
  setCachedIncident,
} from './db/operations';
import type { WorkerRunResult } from '@corridor/shared';

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
  let incidentsNormalized = 0;
  let incidentsCached = 0;

  console.log(`[${new Date().toISOString()}] Starting Corridor worker...`);

  const aggregator = new CDOTAggregator({
    apiKey: process.env.CDOT_API_KEY!,
  });

  const normalizer = new IncidentNormalizer({
    apiKey: process.env.ANTHROPIC_API_KEY!,
  });

  try {
    // 1. Fetch all CDOT data
    const rawData = await aggregator.fetchAllData();

    // 2. Normalize incidents (with caching)
    const rawIncidents = aggregator.getRawIncidents(rawData);

    const { normalized, newCount, cachedCount } =
      await normalizer.normalizeIncidents(
        rawIncidents,
        getCachedIncident,
        setCachedIncident
      );

    incidentsNormalized = newCount;
    incidentsCached = cachedCount;

    console.log(
      `  Incidents: ${normalized.length} total (${newCount} normalized, ${cachedCount} cached)`
    );

    // 3. Process segments with normalized incidents
    const segments = aggregator.processSegments(rawData, normalized);

    console.log(`Processing ${segments.length} segments...`);

    // 4. Calculate vibe scores and update database
    for (const segmentData of segments) {
      try {
        const segmentId = segmentData.segment.logicalName
          .toLowerCase()
          .replace(/\s+/g, '-');

        console.log(`  ${segmentData.segment.logicalName}...`);

        // Calculate vibe score (deterministic)
        const vibeResult = calculateVibeScore(segmentData);

        // Get historical data for trend calculation
        const recentEntries = await getRecentBufferEntries(segmentId);
        const trend = calculateTrend(recentEntries);

        // Insert into status buffer
        await insertStatusBuffer({
          segment_id: segmentId,
          speed: segmentData.speedAnomalyDetected
            ? null
            : segmentData.impliedSpeedMph,
          vibe_score: vibeResult.score,
        });

        // Update live dashboard
        await upsertLiveDashboard({
          segment_id: segmentId,
          current_speed: segmentData.speedAnomalyDetected
            ? null
            : segmentData.impliedSpeedMph,
          vibe_score: vibeResult.score,
          ai_summary: vibeResult.summary,
          trend,
          active_cameras: [], // TODO: Add camera integration
        });

        console.log(
          `    Vibe: ${vibeResult.score.toFixed(1)}/10, Flow: ${vibeResult.flowScore.toFixed(1)}, ` +
            `Penalties: -${vibeResult.incidentPenalty + vibeResult.weatherPenalty}, Trend: ${trend}`
        );

        segmentsProcessed++;
      } catch (error) {
        const errorMsg = `Error processing ${segmentData.segment.logicalName}: ${error}`;
        console.error(`    ${errorMsg}`);
        errors.push(errorMsg);
      }
    }

    // 5. Cleanup old entries
    const deletedBufferEntries = await cleanupOldBufferEntries();
    const deletedCacheEntries = await cleanupOldCacheEntries();

    if (deletedBufferEntries > 0 || deletedCacheEntries > 0) {
      console.log(
        `Cleanup: ${deletedBufferEntries} buffer entries, ${deletedCacheEntries} cache entries`
      );
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
  console.log(`  Segments: ${segmentsProcessed}`);
  console.log(`  Incidents: ${incidentsNormalized} new, ${incidentsCached} cached`);
  console.log(`  Errors: ${errors.length}`);

  return {
    success: errors.length === 0,
    segmentsProcessed,
    incidentsNormalized,
    incidentsCached,
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
