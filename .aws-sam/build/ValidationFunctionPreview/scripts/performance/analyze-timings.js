#!/usr/bin/env node
/**
 * Lambda Performance Profiler — analyze-timings.js
 *
 * Fires N requests against the deployed /validate endpoint, collects the
 * per-phase `timings` breakdown from each response, and prints:
 *
 *   1. Per-phase statistics table  (mean, p50, p95, min, max)
 *   2. Text-based waterfall        (mean duration per phase, to scale)
 *   3. Critical path summary       (phases accounting for 90%+ of total)
 *   4. High-variance flags         (phases where p95 ≫ p50)
 *
 * Usage:
 *   node scripts/performance/analyze-timings.js [options]
 *
 * Options:
 *   --url <url>        Base URL of the API (default: $API_URL env var)
 *   --n <number>       Number of requests to fire (default: 20)
 *   --delay <ms>       Delay between requests in ms (default: 200)
 *   --profile <name>   AWS profile for resolving the API URL from SAM outputs
 *                      (optional, only used if --url is not provided)
 *
 * Example:
 *   node scripts/performance/analyze-timings.js --url https://xxxxx.execute-api.us-east-1.amazonaws.com/Prod --n 20
 *   API_URL=https://... node scripts/performance/analyze-timings.js
 */

import { execSync } from 'child_process';

// ── Configuration ────────────────────────────────────────────────────────────

const ARGS = parseArgs(process.argv.slice(2));
const N_REQUESTS   = parseInt(ARGS['n']     ?? '20',  10);
const DELAY_MS     = parseInt(ARGS['delay'] ?? '200', 10);
const AWS_PROFILE  = ARGS['profile'] ?? 'greenwatt';

const TEST_PAYLOAD = {
  lead_id: 'PERF-ANALYSIS',
  vertical: 'roofing',
  publisher_id: 'PUB-PERF',
  publisher_name: 'Performance Test',
  contact: {
    first_name: 'Gwendolyn',
    last_name: 'Allen',
    phone: '9785978058',
    email: 'gwendolyn79@gmail.com',
    address: '88 Tyler Rd',
    city: 'TOWNSEND',
    state: 'MA',
    zip: '01469',
  },
};

const PHASE_ORDER = [
  'cold_start_ms',
  'config_load_ms',
  'apis_parallel_ms',
  'hard_kill_check_ms',
  'field_prep_ms',
  'llm_call_ms',
  'routing_ms',
  'dynamo_log_ms',
];

const PHASE_LABELS = {
  cold_start_ms:      'Cold Start       (module init)',
  config_load_ms:     'Config Load      (DynamoDB GetItem or cache)',
  apis_parallel_ms:   'Parallel APIs    (Trestle + BatchData + TrustedForm)',
  hard_kill_check_ms: 'Hard-Kill Check  (compute)',
  field_prep_ms:      'Field Prep       (prepareFieldsForLLM, compute)',
  llm_call_ms:        'LLM Call         (Anthropic Sonnet, network)',
  routing_ms:         'Routing          (routeLead, stub)',
  dynamo_log_ms:      'DynamoDB Log     (logScoredLead, PutItem)',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      result[key] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
    }
  }
  return result;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}

function mean(arr) {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function pad(str, len, right = false) {
  const s = String(str);
  return right ? s.padEnd(len) : s.padStart(len);
}

function resolveApiUrl() {
  if (ARGS['url']) return ARGS['url'];
  if (process.env.API_URL) return process.env.API_URL;

  console.log('No --url provided. Resolving from CloudFormation stack outputs...');
  try {
    const raw = execSync(
      `aws cloudformation describe-stacks --stack-name greenwatt --profile ${AWS_PROFILE} --region us-east-1 --query "Stacks[0].Outputs[?OutputKey=='ApiUrl'].OutputValue" --output text`,
      { encoding: 'utf8' }
    ).trim();
    if (raw && raw !== 'None') return raw.replace('/validate', '');
  } catch {
    // ignore
  }

  console.error([
    'Could not resolve API URL. Provide one of:',
    '  --url https://xxxxx.execute-api.us-east-1.amazonaws.com/Prod',
    '  API_URL=https://... node scripts/performance/analyze-timings.js',
  ].join('\n'));
  process.exit(1);
}

// ── Request runner ────────────────────────────────────────────────────────────

async function fireRequest(baseUrl, index) {
  const url = `${baseUrl.replace(/\/$/, '')}/validate`;
  const payload = { ...TEST_PAYLOAD, lead_id: `PERF-${String(index).padStart(3, '0')}` };

  const start = Date.now();
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    return { index, error: err.message, wall_ms: Date.now() - start };
  }

  const wall_ms = Date.now() - start;

  if (!response.ok) {
    const text = await response.text();
    return { index, error: `HTTP ${response.status}: ${text}`, wall_ms };
  }

  let body;
  try {
    body = await response.json();
  } catch (err) {
    return { index, error: `JSON parse error: ${err.message}`, wall_ms };
  }

  return {
    index,
    wall_ms,
    processing_time_ms: body.processing_time_ms ?? null,
    timings: body.timings ?? null,
    tier: body.tier ?? null,
    score: body.score ?? null,
    api_performance: body.api_performance ?? null,
  };
}

// ── Statistics ────────────────────────────────────────────────────────────────

function computeStats(samples) {
  if (samples.length === 0) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    mean:  Math.round(mean(samples)),
    p50:   percentile(sorted, 50),
    p95:   percentile(sorted, 95),
    min:   sorted[0],
    max:   sorted[sorted.length - 1],
    count: samples.length,
  };
}

// ── Output formatters ─────────────────────────────────────────────────────────

function printTable(phaseStats, totalStats) {
  const COL = { phase: 46, mean: 8, p50: 8, p95: 8, min: 8, max: 8, pct: 8 };
  const line = '-'.repeat(Object.values(COL).reduce((a, b) => a + b, 0) + Object.keys(COL).length - 1);

  console.log('\n' + line);
  console.log(
    pad('Phase', COL.phase, true) + ' ' +
    pad('Mean', COL.mean) + ' ' +
    pad('p50', COL.p50) + ' ' +
    pad('p95', COL.p95) + ' ' +
    pad('Min', COL.min) + ' ' +
    pad('Max', COL.max) + ' ' +
    pad('% Total', COL.pct)
  );
  console.log(line);

  const totalMean = totalStats.mean || 1;

  for (const phase of PHASE_ORDER) {
    const s = phaseStats[phase];
    if (!s) continue;
    const pct = Math.round((s.mean / totalMean) * 100);
    const marker = pct >= 20 ? ' ◀' : '';
    console.log(
      pad(PHASE_LABELS[phase] ?? phase, COL.phase, true) + ' ' +
      pad(s.mean  + 'ms', COL.mean) + ' ' +
      pad(s.p50   + 'ms', COL.p50) + ' ' +
      pad(s.p95   + 'ms', COL.p95) + ' ' +
      pad(s.min   + 'ms', COL.min) + ' ' +
      pad(s.max   + 'ms', COL.max) + ' ' +
      pad(pct + '%', COL.pct) +
      marker
    );
  }

  console.log(line);
  console.log(
    pad('Total (processing_time_ms)', COL.phase, true) + ' ' +
    pad(totalStats.mean  + 'ms', COL.mean) + ' ' +
    pad(totalStats.p50   + 'ms', COL.p50) + ' ' +
    pad(totalStats.p95   + 'ms', COL.p95) + ' ' +
    pad(totalStats.min   + 'ms', COL.min) + ' ' +
    pad(totalStats.max   + 'ms', COL.max) + ' ' +
    pad('100%', COL.pct)
  );
  console.log(line);
  console.log('  ◀  = accounts for ≥20% of mean total time (primary optimization targets)\n');
}

function printWaterfall(phaseStats, totalMean) {
  const MAX_BAR = 50;
  console.log('── Mean Duration Waterfall (proportional to total time) ──\n');

  for (const phase of PHASE_ORDER) {
    const s = phaseStats[phase];
    if (!s || s.mean === 0) continue;
    const barLen = Math.max(1, Math.round((s.mean / totalMean) * MAX_BAR));
    const bar = '█'.repeat(barLen);
    const label = (PHASE_LABELS[phase] ?? phase).padEnd(46);
    console.log(`  ${label} ${bar} ${s.mean}ms`);
  }
  console.log('');
}

function printVarianceFlags(phaseStats) {
  const flags = [];
  for (const phase of PHASE_ORDER) {
    const s = phaseStats[phase];
    if (!s || s.p50 === 0) continue;
    const ratio = s.p95 / s.p50;
    if (ratio >= 2.0 && s.p95 > 50) {
      flags.push({ phase, ratio: ratio.toFixed(1), p50: s.p50, p95: s.p95 });
    }
  }

  if (flags.length === 0) {
    console.log('── Variance Flags: none (all phases have p95/p50 < 2x)\n');
    return;
  }

  console.log('── High-Variance Phases (p95 ≥ 2x p50 and p95 > 50ms) ──');
  console.log('   These have inconsistent latency and are worth investigating:\n');
  for (const f of flags) {
    const label = PHASE_LABELS[f.phase] ?? f.phase;
    console.log(`  ⚠  ${label}`);
    console.log(`     p50=${f.p50}ms  p95=${f.p95}ms  ratio=${f.ratio}x\n`);
  }
}

function printCriticalPath(phaseStats, totalMean) {
  const phases = PHASE_ORDER
    .filter(p => phaseStats[p])
    .map(p => ({ phase: p, mean: phaseStats[p].mean }))
    .sort((a, b) => b.mean - a.mean);

  let cumulative = 0;
  const critical = [];
  for (const p of phases) {
    critical.push(p);
    cumulative += p.mean;
    if (cumulative / totalMean >= 0.9) break;
  }

  console.log('── Critical Path (phases accounting for ≥90% of mean total time) ──\n');
  for (const p of critical) {
    const pct = Math.round((p.mean / totalMean) * 100);
    const label = PHASE_LABELS[p.phase] ?? p.phase;
    console.log(`  ${String(pct + '%').padStart(4)}  ${label}  (${p.mean}ms)`);
  }
  console.log(`\n  Total of listed phases: ${critical.reduce((a, b) => a + b.mean, 0)}ms of ${totalMean}ms mean total\n`);
}

function printApiBreakdown(results) {
  const apis = ['trestle', 'batchdata', 'trustedform', 'anthropic'];
  const apiSamples = {};
  for (const api of apis) apiSamples[api] = [];

  for (const r of results) {
    if (!r.api_performance) continue;
    for (const api of apis) {
      const p = r.api_performance[api];
      if (p?.response_time_ms != null) {
        apiSamples[api].push(p.response_time_ms);
      }
    }
  }

  const hasData = apis.some(a => apiSamples[a].length > 0);
  if (!hasData) return;

  console.log('── Individual API Breakdown (from api_performance) ──\n');
  console.log(
    pad('API', 14, true) + ' ' +
    pad('Mean', 8) + ' ' +
    pad('p50', 8) + ' ' +
    pad('p95', 8) + ' ' +
    pad('Min', 8) + ' ' +
    pad('Max', 8) + ' ' +
    pad('Calls', 6)
  );
  console.log('-'.repeat(60));

  for (const api of apis) {
    const samples = apiSamples[api];
    if (samples.length === 0) continue;
    const s = computeStats(samples);
    console.log(
      pad(api, 14, true) + ' ' +
      pad(s.mean  + 'ms', 8) + ' ' +
      pad(s.p50   + 'ms', 8) + ' ' +
      pad(s.p95   + 'ms', 8) + ' ' +
      pad(s.min   + 'ms', 8) + ' ' +
      pad(s.max   + 'ms', 8) + ' ' +
      pad(s.count, 6)
    );
  }
  console.log('');
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const baseUrl = resolveApiUrl();

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  Lambda Performance Profiler — greenwatt-validation');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  Endpoint  : ${baseUrl}/validate`);
  console.log(`  Requests  : ${N_REQUESTS}`);
  console.log(`  Delay     : ${DELAY_MS}ms between requests`);
  console.log(`  Payload   : TEST-R-006 (roofing / Gwendolyn Allen)`);
  console.log('═══════════════════════════════════════════════════════════\n');

  const results = [];
  let errors = 0;

  for (let i = 1; i <= N_REQUESTS; i++) {
    process.stdout.write(`  Request ${String(i).padStart(2)}/${N_REQUESTS} ... `);
    const r = await fireRequest(baseUrl, i);
    if (r.error) {
      errors++;
      console.log(`ERROR: ${r.error}`);
    } else {
      const timingsStr = r.timings
        ? `[apis=${r.timings.apis_parallel_ms ?? '?'}ms llm=${r.timings.llm_call_ms ?? '?'}ms]`
        : '[no timings in response]';
      console.log(`${r.processing_time_ms}ms total  ${timingsStr}  tier=${r.tier}`);
      results.push(r);
    }

    if (i < N_REQUESTS) await sleep(DELAY_MS);
  }

  if (results.length === 0) {
    console.error('\nNo successful responses — cannot compute statistics.');
    process.exit(1);
  }

  console.log(`\n  ${results.length}/${N_REQUESTS} requests succeeded (${errors} errors)\n`);

  // Warn if timings are missing (handler not yet deployed with new version)
  const hasTimings = results.some(r => r.timings && Object.keys(r.timings).length > 0);
  if (!hasTimings) {
    console.warn(
      '⚠  No `timings` field found in responses.\n' +
      '   The deployed handler does not yet include phase instrumentation.\n' +
      '   Deploy the updated src/index.js first, then re-run this script.\n' +
      '   Falling back to total processing_time_ms statistics only.\n'
    );
  }

  // Collect samples per phase
  const phaseSamples = {};
  for (const phase of PHASE_ORDER) phaseSamples[phase] = [];
  const totalSamples = [];

  for (const r of results) {
    if (r.processing_time_ms != null) totalSamples.push(r.processing_time_ms);

    if (!r.timings) continue;
    for (const phase of PHASE_ORDER) {
      const v = r.timings[phase];
      if (v != null) phaseSamples[phase].push(v);
    }
  }

  // Build stats objects
  const phaseStats = {};
  for (const phase of PHASE_ORDER) {
    if (phaseSamples[phase].length > 0) {
      phaseStats[phase] = computeStats(phaseSamples[phase]);
    }
  }
  const totalStats = computeStats(totalSamples);

  // ── Print results ──────────────────────────────────────────────────────────
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  Results');
  console.log('═══════════════════════════════════════════════════════════\n');

  printTable(phaseStats, totalStats);
  printWaterfall(phaseStats, totalStats.mean);
  printCriticalPath(phaseStats, totalStats.mean);
  printVarianceFlags(phaseStats);
  printApiBreakdown(results);

  // Optimization hints
  console.log('── Optimization Hints ──\n');
  const apisMs = phaseStats['apis_parallel_ms']?.mean ?? 0;
  const llmMs  = phaseStats['llm_call_ms']?.mean ?? 0;
  const dynaMs = phaseStats['dynamo_log_ms']?.mean ?? 0;
  const cfgMs  = phaseStats['config_load_ms']?.mean ?? 0;

  if (apisMs > 1000) {
    console.log('  • Parallel APIs are the largest bottleneck. Individual API timings above');
    console.log('    show which specific API is the slowest. Consider:');
    console.log('    - Reducing the Trestle add-ons if litigator_checks rarely fires');
    console.log('    - Skipping TrustedForm entirely when no cert URL is present (already done)');
    console.log('    - Increasing API_TIMEOUT_MS to reduce tail-latency retries');
  }

  if (llmMs > 1000) {
    console.log('  • Anthropic LLM call is significant. Consider:');
    console.log('    - Verifying cache_control ephemeral is working (check cache_read_input_tokens)');
    console.log('    - Switching to claude-haiku for Bronze-capped leads (post hard-kill check)');
    console.log('    - Moving to claude-sonnet-3-5 if latency improves without quality loss');
  }

  if (dynaMs > 100) {
    console.log('  • DynamoDB log write is measurable. Consider fire-and-forget (remove await)');
    console.log('    since a failed log write does not affect the scoring result.');
  }

  if (cfgMs > 30) {
    const cfgP95 = phaseStats['config_load_ms']?.p95 ?? 0;
    if (cfgP95 < 10) {
      console.log('  • Config load is fast on warm invocations (cache hit). Cold starts will be higher.');
    } else {
      console.log('  • Config load is slow — possible cache miss rate. Check CONFIG_CACHE_TTL.');
    }
  }

  console.log('');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
