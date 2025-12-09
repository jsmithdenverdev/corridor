#!/usr/bin/env bun
/**
 * Incident Normalization Proof of Concept
 *
 * Tests the Claude integration for incident text normalization.
 * Run with: bun run vibe-poc
 */

import { file } from 'bun';
import { join } from 'path';

import Anthropic from '@anthropic-ai/sdk';

import { createIncidentNormalizer } from '../ai/client';

import type { CdotIncident } from '@corridor/shared';

/**
 * Load environment variables from .env file at repo root
 */
const loadEnv = async (): Promise<void> => {
  const envPath = join(import.meta.dir, '..', '..', '.env');
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

      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  }
};

// Mock incidents with typical CDOT message formats
const TEST_INCIDENTS: CdotIncident[] = [
  {
    type: 'Feature',
    properties: {
      id: 'test-1',
      type: 'accident',
      severity: 'major',
      travelerInformationMessage:
        'ACCIDENT-I70 WB @ MP 213.5 NEAR EISENHOWER TUNNEL - LEFT LANE BLOCKED - EXPECT DELAYS',
      startMarker: 213,
      endMarker: 214,
      lastUpdated: new Date().toISOString(),
      routeName: 'I-70',
      direction: 'W',
    },
  },
  {
    type: 'Feature',
    properties: {
      id: 'test-2',
      type: 'closure',
      severity: 'major',
      travelerInformationMessage:
        'ROAD CLOSED - I70 WB BETWEEN SILVER PLUME (MM 226) AND TUNNEL (MM 213) DUE TO AVALANCHE CONTROL OPERATIONS - ESTIMATED REOPENING 2 PM',
      startMarker: 213,
      endMarker: 226,
      lastUpdated: new Date().toISOString(),
      routeName: 'I-70',
      direction: 'W',
    },
  },
  {
    type: 'Feature',
    properties: {
      id: 'test-3',
      type: 'restriction',
      severity: 'moderate',
      travelerInformationMessage:
        'TRACTION LAW IN EFFECT (CODE 15) - I70 WB FROM IDAHO SPRINGS TO EISENHOWER TUNNEL - 4WD/AWD OR CHAINS REQUIRED',
      startMarker: 213,
      endMarker: 240,
      lastUpdated: new Date().toISOString(),
      routeName: 'I-70',
      direction: 'W',
    },
  },
  {
    type: 'Feature',
    properties: {
      id: 'test-4',
      type: 'information',
      severity: 'minor',
      travelerInformationMessage:
        'FYI - CONSTRUCTION CREW PRESENT I70 WB MM 228 - PLEASE USE CAUTION',
      startMarker: 227,
      endMarker: 229,
      lastUpdated: new Date().toISOString(),
      routeName: 'I-70',
      direction: 'W',
    },
  },
];

// Simple in-memory cache for POC
const memoryCache = new Map<string, { summary: string; penalty: number }>();

const getCached = async (
  hash: string
): Promise<{ summary: string; penalty: number } | null> => {
  return memoryCache.get(hash) ?? null;
};

const setCache = async (
  hash: string,
  summary: string,
  penalty: number
): Promise<void> => {
  memoryCache.set(hash, { summary, penalty });
};

const main = async (): Promise<void> => {
  await loadEnv();

  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    console.error('Missing ANTHROPIC_API_KEY environment variable');
    console.log('\nTo test, set the environment variable:');
    console.log('  export ANTHROPIC_API_KEY=sk-ant-...');
    console.log('  bun run vibe-poc');
    process.exit(1);
  }

  console.log('=== Incident Normalization POC ===\n');

  // Composition root - construct dependencies here
  const anthropicClient = new Anthropic({ apiKey });
  const normalizer = createIncidentNormalizer(anthropicClient);

  console.log('Testing incident normalization...\n');

  const { normalized, newCount, cachedCount } =
    await normalizer.normalizeIncidents(TEST_INCIDENTS, getCached, setCache);

  for (const incident of normalized) {
    console.log(`ID: ${incident.id}`);
    console.log(`  Original: ${incident.originalMessage.substring(0, 60)}...`);
    console.log(`  Summary:  ${incident.summary}`);
    console.log(`  Penalty:  -${incident.penalty} points`);
    console.log(`  Severity: ${incident.severity}`);
    console.log();
  }

  console.log('-'.repeat(50));
  console.log(`Normalized: ${newCount} new, ${cachedCount} cached\n`);

  // Test caching - run again
  console.log('Running again to test caching...\n');
  const { newCount: newCount2, cachedCount: cachedCount2 } =
    await normalizer.normalizeIncidents(TEST_INCIDENTS, getCached, setCache);

  console.log(`Result: ${newCount2} new, ${cachedCount2} cached`);
  console.log(
    cachedCount2 === TEST_INCIDENTS.length
      ? 'Cache working correctly!'
      : 'Cache may have issues'
  );

  console.log('\n=== POC Complete ===');
};

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
