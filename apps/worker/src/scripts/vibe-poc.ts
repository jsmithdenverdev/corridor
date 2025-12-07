#!/usr/bin/env bun
/**
 * Vibe Check Proof of Concept
 *
 * Tests the Claude integration with sample data.
 * Run with: bun run vibe-poc
 */

import { VibeChecker } from '../ai/client';

const TEST_CASES = [
  {
    name: 'Eisenhower Tunnel',
    speed: 45,
    conditions: `Road Condition: Clear and Dry
Active Incidents (1):
- Vehicle accident cleared, minor delays expected for next 30 minutes [MM 215]`,
  },
  {
    name: 'Georgetown',
    speed: 25,
    conditions: `Road Condition: Snow Packed
Active Incidents (2):
- Traction Law in Effect (Severity: Moderate) [MM 230]
- Slow moving traffic due to weather [MM 229]`,
  },
  {
    name: 'Silver Plume',
    speed: 65,
    conditions: `Road Condition: Clear and Dry
No active incidents reported.`,
  },
  {
    name: 'Loveland Pass Area',
    speed: null,
    conditions: `Road Condition: Unknown
Active Incidents (1):
- Road Closed due to avalanche control [MM 220]`,
  },
];

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    console.error('Missing ANTHROPIC_API_KEY environment variable');
    console.log('\nTo test, set the environment variable:');
    console.log('  export ANTHROPIC_API_KEY=sk-ant-...');
    console.log('  bun run vibe-poc');
    process.exit(1);
  }

  console.log('=== Corridor Vibe Check POC ===\n');

  const checker = new VibeChecker({ apiKey });

  for (const testCase of TEST_CASES) {
    console.log(`Testing: ${testCase.name}`);
    console.log('-'.repeat(40));

    try {
      const result = await checker.getVibeScore(
        testCase.name,
        testCase.speed,
        testCase.conditions
      );

      console.log(`  Score: ${result.score}/10`);
      console.log(`  Summary: ${result.summary}`);
      console.log(`  Fallback: ${result.usedFallback ? 'Yes' : 'No'}`);
    } catch (error) {
      console.error(`  Error: ${error}`);
    }

    console.log();
  }

  console.log('=== POC Complete ===');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
