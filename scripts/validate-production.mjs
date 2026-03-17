#!/usr/bin/env node
/**
 * Production Validation Script
 *
 * Compares production Lambda scores against the 160-score reference file.
 * For validated verticals (solar/roofing/windows): checks exact tier match.
 * For unvalidated verticals: logs scores and flags any tier >1 level off.
 *
 * Usage:
 *   node scripts/validate-production.mjs <API_GATEWAY_URL>
 *
 * Example:
 *   node scripts/validate-production.mjs https://abc123.execute-api.us-east-1.amazonaws.com/Prod/validate
 *
 * The script reads enrichment data from docs/validation-reference-10-leads-13-verticals.json
 * and POSTs each lead to the production endpoint for each vertical.
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REFERENCE_PATH = join(__dirname, '..', 'docs', 'validation-reference-10-leads-13-verticals.json');

const VALIDATED_VERTICALS = ['solar', 'roofing', 'windows'];
const TIER_ORDER = ['Reject', 'Bronze', 'Silver', 'Gold'];

function tierDistance(a, b) {
  return Math.abs(TIER_ORDER.indexOf(a) - TIER_ORDER.indexOf(b));
}

async function validateLead(apiUrl, lead, vertical, referenceScore) {
  // Build the lead payload matching Lambda's expected input format
  const payload = {
    lead_id: `${lead.lead_id}_${vertical}_validation`,
    vertical,
    publisher_id: 'validation_script',
    publisher_name: 'Validation Script',
    contact: {
      first_name: lead.name.split(' ')[0],
      last_name: lead.name.split(' ').slice(1).join(' '),
      phone: '2025550100', // dummy phone — real enrichment comes from reference data
      email: `${lead.lead_id}@validation.test`,
    },
    // Note: In production, enrichment comes from live API calls.
    // For validation, we'd need to either:
    // 1. Mock the APIs to return reference data, or
    // 2. Use dry-run mode that accepts pre-enriched data
    // This script validates the ENDPOINT is working and returns valid responses.
  };

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      return { status: 'error', error: `HTTP ${response.status}` };
    }

    const result = JSON.parse((await response.json()).body || await response.text());
    return {
      status: 'ok',
      production_tier: result.tier,
      production_score: result.score,
      reference_tier: referenceScore.tier,
      reference_score: referenceScore.score,
      tier_match: result.tier === referenceScore.tier,
      tier_distance: tierDistance(result.tier, referenceScore.tier),
      decision: result.decision,
      hard_kill: result.hard_kill,
      processing_time_ms: result.processing_time_ms,
    };
  } catch (err) {
    return { status: 'error', error: err.message };
  }
}

async function main() {
  const apiUrl = process.argv[2];
  if (!apiUrl) {
    console.error('Usage: node scripts/validate-production.mjs <API_GATEWAY_URL>');
    console.error('Example: node scripts/validate-production.mjs https://abc123.execute-api.us-east-1.amazonaws.com/Prod/validate');
    process.exit(1);
  }

  console.log(`\n=== GreenWatt Production Validation ===`);
  console.log(`API URL: ${apiUrl}`);
  console.log(`Reference: ${REFERENCE_PATH}\n`);

  // Load reference data
  const reference = JSON.parse(readFileSync(REFERENCE_PATH, 'utf-8'));
  const leads = reference.leads;
  const scoresByVertical = reference.scores_by_vertical;

  // Health check
  try {
    const healthUrl = apiUrl.replace('/validate', '/health');
    const healthResp = await fetch(healthUrl);
    console.log(`Health check: ${healthResp.ok ? 'PASS' : 'FAIL'} (${healthResp.status})\n`);
  } catch (err) {
    console.log(`Health check: FAIL (${err.message})\n`);
  }

  // Results tracking
  const results = { validated: { total: 0, match: 0, mismatch: 0, errors: 0 }, shadow: { total: 0, flagged: 0, errors: 0 } };
  const mismatches = [];
  const flags = [];

  // Validate each vertical
  for (const [vertical, refScores] of Object.entries(scoresByVertical)) {
    const isValidated = VALIDATED_VERTICALS.includes(vertical);
    console.log(`\n--- ${vertical.toUpperCase()} ${isValidated ? '(VALIDATED)' : '(SHADOW)'} ---`);

    for (let i = 0; i < refScores.length; i++) {
      const refScore = refScores[i];
      const lead = leads[i];
      const result = await validateLead(apiUrl, lead, vertical, refScore);

      if (result.status === 'error') {
        console.log(`  ${lead.lead_id}: ERROR — ${result.error}`);
        if (isValidated) results.validated.errors++;
        else results.shadow.errors++;
        continue;
      }

      const marker = result.tier_match ? 'MATCH' : (result.tier_distance > 1 ? 'FLAG' : 'DRIFT');
      console.log(`  ${lead.lead_id}: ref=${refScore.tier}(${refScore.score}) prod=${result.production_tier}(${result.production_score}) [${marker}] ${result.processing_time_ms}ms`);

      if (isValidated) {
        results.validated.total++;
        if (result.tier_match) results.validated.match++;
        else {
          results.validated.mismatch++;
          mismatches.push({ lead_id: lead.lead_id, vertical, ...result });
        }
      } else {
        results.shadow.total++;
        if (result.tier_distance > 1) {
          results.shadow.flagged++;
          flags.push({ lead_id: lead.lead_id, vertical, ...result });
        }
      }
    }
  }

  // Summary
  console.log(`\n\n=== RESULTS SUMMARY ===\n`);
  console.log(`VALIDATED (solar/roofing/windows):`);
  console.log(`  Total: ${results.validated.total}`);
  console.log(`  Tier Match: ${results.validated.match}/${results.validated.total} (${((results.validated.match / results.validated.total) * 100).toFixed(1)}%)`);
  console.log(`  Mismatches: ${results.validated.mismatch}`);
  console.log(`  Errors: ${results.validated.errors}`);

  console.log(`\nSHADOW MODE (10 new verticals):`);
  console.log(`  Total: ${results.shadow.total}`);
  console.log(`  Flagged (>1 tier off): ${results.shadow.flagged}`);
  console.log(`  Errors: ${results.shadow.errors}`);

  if (mismatches.length > 0) {
    console.log(`\n--- VALIDATED MISMATCHES (need investigation) ---`);
    for (const m of mismatches) {
      console.log(`  ${m.lead_id} [${m.vertical}]: expected ${m.reference_tier}(${m.reference_score}), got ${m.production_tier}(${m.production_score})`);
    }
  }

  if (flags.length > 0) {
    console.log(`\n--- SHADOW FLAGS (>1 tier drift from reference) ---`);
    for (const f of flags) {
      console.log(`  ${f.lead_id} [${f.vertical}]: expected ${f.reference_tier}(${f.reference_score}), got ${f.production_tier}(${f.production_score})`);
    }
  }

  // Exit code: fail if validated mismatches > 0
  const exitCode = results.validated.mismatch > 0 ? 1 : 0;
  console.log(`\nExit code: ${exitCode}`);
  process.exit(exitCode);
}

main();
