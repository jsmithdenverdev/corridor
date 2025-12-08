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

import { file } from 'bun';
import { join } from 'path';

import Anthropic from '@anthropic-ai/sdk';

/**
 * Load environment variables from .env file at repo root
 * In production (Fly.io), env vars are set via secrets - this is a no-op
 */
const loadEnv = async (): Promise<void> => {
  const envPath = join(import.meta.dir, '..', '.env');
  const envFile = file(envPath);

  if (await envFile.exists()) {
    const content = await envFile.text();
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const eqIndex = trimmed.indexOf('=');
      if (eqIndex === -1) continue;

      const key = trimmed.slice(0, eqIndex);
      const value = trimmed.slice(eqIndex + 1);

      // Don't override existing env vars (allows CLI overrides)
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  }
};

import { createCdotClient } from './cdot/client';
import { createAggregator } from './cdot/aggregator';
import { createIncidentNormalizer } from './ai/client';
import { calculateVibeScore } from './vibe/calculator';
import {
  upsertLiveDashboard,
  insertStatusBuffer,
  getRecentBufferEntries,
  cleanupOldBufferEntries,
  cleanupOldCacheEntries,
  cleanupOldAuditData,
  calculateTrend,
  getCachedIncident,
  setCachedIncident,
  createWorkerRun,
  completeWorkerRun,
  saveCdotSnapshot,
  saveVibeScoreHistory,
  saveIncidentHistory,
} from './db/operations';
import type { IncidentHistoryData, VibeScoreData } from './db/operations';

import type { WorkerRunResult } from '@corridor/shared';
import type { CdotAggregator } from './cdot/aggregator';
import type { IncidentNormalizer } from './ai/client';

/**
 * Required environment variables
 */
const REQUIRED_ENV = ['CDOT_API_KEY', 'ANTHROPIC_API_KEY', 'DATABASE_URL'];

/**
 * Dependencies required by the worker loop
 */
type WorkerDependencies = {
  aggregator: CdotAggregator;
  normalizer: IncidentNormalizer;
};

/**
 * Validate environment variables
 */
const validateEnv = (): void => {
  const missing = REQUIRED_ENV.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}\n` +
        'See .env.example for required configuration.'
    );
  }
};

/**
 * Main worker loop
 */
const runWorkerLoop = async (deps: WorkerDependencies): Promise<WorkerRunResult> => {
  const startTime = Date.now();
  const errors: string[] = [];
  let segmentsProcessed = 0;
  let incidentsNormalized = 0;
  let incidentsCached = 0;
  let incidentsTotal = 0;

  console.log(`[${new Date().toISOString()}] Starting Corridor worker...`);

  // Create worker run record for audit trail
  const runId = await createWorkerRun();
  console.log(`  Worker run ID: ${runId}`);

  try {
    // 1. Fetch all CDOT data
    const rawData = await deps.aggregator.fetchAllData();

    // Save raw CDOT data snapshot for audit
    await saveCdotSnapshot(runId, {
      destinations: rawData.destinations,
      incidents: rawData.incidents,
      conditions: rawData.conditions,
      weatherStations: rawData.weatherStations,
    });

    // 2. Normalize incidents (with caching)
    const rawIncidents = deps.aggregator.getRawIncidents(rawData);

    const { normalized, normalizedWithAudit, newCount, cachedCount } =
      await deps.normalizer.normalizeIncidents(
        rawIncidents,
        getCachedIncident,
        setCachedIncident
      );

    incidentsNormalized = newCount;
    incidentsCached = cachedCount;
    incidentsTotal = normalized.length;

    // Save incident history for audit
    if (normalizedWithAudit.length > 0) {
      const incidentHistoryData: IncidentHistoryData[] = normalizedWithAudit.map((i) => ({
        cdotIncidentId: i.id,
        incidentType: i.incidentType,
        severity: i.severity,
        startMarker: i.startMarker,
        endMarker: i.endMarker,
        originalMessage: i.originalMessage,
        normalizedSummary: i.summary,
        penaltyApplied: i.penalty,
        fromCache: i.fromCache,
        cacheHash: i.cacheHash,
      }));
      await saveIncidentHistory(runId, incidentHistoryData);
    }

    console.log(
      `  Incidents: ${normalized.length} total (${newCount} normalized, ${cachedCount} cached)`
    );

    // 3. Process segments with normalized incidents
    const segments = deps.aggregator.processSegments(rawData, normalized);

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

        // Save vibe score history for audit
        const vibeScoreData: VibeScoreData = {
          segmentId,
          vibeScore: vibeResult.score,
          flowScore: vibeResult.flowScore,
          incidentPenalty: vibeResult.incidentPenalty,
          weatherPenalty: vibeResult.weatherPenalty,
          travelTimeSeconds: segmentData.travelTimeSeconds,
          impliedSpeedMph: segmentData.impliedSpeedMph,
          speedAnomalyDetected: segmentData.speedAnomalyDetected,
          roadCondition: segmentData.roadCondition,
          weatherSurface: segmentData.weatherSurface,
          aiSummary: vibeResult.summary,
          trend,
        };
        await saveVibeScoreHistory(runId, vibeScoreData);

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
    const deletedAuditRuns = await cleanupOldAuditData();

    if (deletedBufferEntries > 0 || deletedCacheEntries > 0 || deletedAuditRuns > 0) {
      console.log(
        `Cleanup: ${deletedBufferEntries} buffer, ${deletedCacheEntries} cache, ${deletedAuditRuns} audit runs`
      );
    }
  } catch (error) {
    const errorMsg = `Worker loop error: ${error}`;
    console.error(errorMsg);
    errors.push(errorMsg);
  }

  const duration = Date.now() - startTime;

  // Complete worker run record
  await completeWorkerRun(runId, {
    segmentsProcessed,
    incidentsTotal,
    incidentsNormalized,
    incidentsCached,
    success: errors.length === 0,
    errors,
    durationMs: duration,
  });

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
};

/**
 * Main entry point
 */
const main = async (): Promise<void> => {
  try {
    await loadEnv();
    validateEnv();

    // Composition root - construct all dependencies here
    const cdotClient = createCdotClient({ apiKey: process.env.CDOT_API_KEY! });
    const aggregator = createAggregator(cdotClient);
    const anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
    const normalizer = createIncidentNormalizer(anthropicClient);

    // Pass dependencies to worker
    const result = await runWorkerLoop({ aggregator, normalizer });

    if (!result.success) {
      console.error('Worker completed with errors');
      process.exit(1);
    }
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
};

// Run the worker
main();
