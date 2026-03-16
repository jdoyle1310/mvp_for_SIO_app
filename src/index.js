/**
 * GreenWatt Lead Validation Lambda — Main Handler
 *
 * Orchestrates the validation + scoring flow:
 * 1. Validate input
 * 2. Load vertical config (for pricing/routing)
 * 3. Normalize phone to E.164
 * 4. Call 3 APIs in parallel (Trestle, BatchData, TrustedForm)
 * 5. Merge API responses
 * 6. Run quick hard-kill checks (save LLM cost on obvious rejects)
 * 7. Call Anthropic Sonnet with locked v4 prompt
 * 8. Parse tier + score from LLM response
 * 9. Route to buyer
 * 10. Log to DynamoDB + emit CloudWatch metrics
 * 11. Return SIO response
 *
 * CHANGES (2026-03-12):
 * - FullContact REMOVED (zero marginal value, 0% coverage on most sources)
 * - Rules engine (scorer.js + normalizer.js) REPLACED with LLM scoring
 * - BatchData switched to Quick List API key
 * - Anthropic Sonnet added for lead scoring (~$0.003/lead)
 *
 * NOTE: eHawk is the upstream pre-filter for phone/email/IP fraud.
 * Our hard kills catch property-level issues only BatchData/TrustedForm reveal.
 */

import { loadConfig } from './config-loader.js';
import { normalizePhone } from './utils/phone-normalizer.js';
import { VALID_VERTICALS, DECISIONS, API_TIMEOUT_MS } from './utils/constants.js';
import { routeLead } from './router.js';
import { logScoredLead, emitMetrics } from './utils/logger.js';

// API clients (3 enrichment APIs — FullContact dropped, Twilio dropped)
import { callTrestle } from './api/trestle.js';
import { callBatchData } from './api/batchdata.js';
import { callTrustedForm } from './api/trustedform.js';

// LLM scorer (replaces rules engine — scorer.js + normalizer.js)
import { scoreLead } from './llm-scorer.js';

/**
 * Lambda handler.
 *
 * @param {object} event - Lambda event (the lead JSON from SIO)
 * @returns {object} SIO response JSON
 */
export async function handler(event) {
  const startTime = Date.now();

  try {
    // Parse body if coming through API Gateway
    const lead = typeof event.body === 'string' ? JSON.parse(event.body) : event;

    // 1. Validate input
    const validationError = validateInput(lead);
    if (validationError) {
      return formatError(400, validationError);
    }

    // 2. Load vertical config + normalize phone in parallel (independent operations)
    const [config, phone] = await Promise.all([
      loadConfig(lead.vertical),
      Promise.resolve(normalizePhone(lead.contact.phone)),
    ]);

    // 3. Reject invalid phone early
    if (!phone) {
      return formatResponse(lead, {
        decision: DECISIONS.REJECT,
        score: 0,
        tier: 'Reject',
        hard_kill: true,
        hard_kill_reason: 'INVALID_PHONE_NUMBER',
        reason_codes: ['INVALID_PHONE_NUMBER'],
        llm_response: null,
        routing: { buyer_id: null, buyer_name: null, endpoint_url: null, cpl: null },
        api_performance: {},
        processing_time_ms: Date.now() - startTime,
      });
    }

    // 4. Call 3 APIs in parallel with timeout
    const apiPerformance = {};
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS + 1000);

    const apiResults = await callAllAPIs(lead, phone, controller.signal, apiPerformance);
    clearTimeout(timeout);

    // 5. Merge all API responses into flat map
    const apiData = { ...apiResults };

    // 6. Quick hard-kill checks (save LLM cost on obvious rejects)
    const hardKillReason = checkQuickHardKills(apiData, lead.vertical);
    if (hardKillReason) {
      const result = formatResponse(lead, {
        decision: DECISIONS.REJECT,
        score: 0,
        tier: 'Reject',
        hard_kill: true,
        hard_kill_reason: hardKillReason,
        reason_codes: [hardKillReason],
        llm_response: null,
        routing: { buyer_id: null, buyer_name: null, endpoint_url: null, cpl: null },
        api_performance: apiPerformance,
        processing_time_ms: Date.now() - startTime,
      });

      await logScoredLead(result, apiPerformance, apiData, null);
      emitMetrics(result, apiPerformance);
      return result;
    }

    // 7. Call Anthropic Sonnet with v4 prompt
    const leadName = [lead.contact.first_name, lead.contact.last_name]
      .filter(Boolean).join(' ') || null;

    const llmStart = Date.now();
    const llmResult = await scoreLead(apiData, lead.vertical, leadName);
    apiPerformance.anthropic = {
      response_time_ms: Date.now() - llmStart,
      success: true,
      input_tokens: llmResult.llm_usage?.input_tokens || 0,
      output_tokens: llmResult.llm_usage?.output_tokens || 0,
    };

    // 8. Use LLM tier + score
    const { tier, score } = llmResult;

    // 9. Route to buyer
    const { decision, routing } = await routeLead(lead.vertical, tier, score, lead);

    // 10. Build final result
    const llmResponse = {
      confidence: llmResult.confidence,
      reasons: llmResult.reasons,
      concerns: llmResult.concerns,
    };

    const result = formatResponse(lead, {
      decision,
      score,
      tier,
      hard_kill: false,
      hard_kill_reason: null,
      reason_codes: llmResult.reasons || [],
      llm_response: llmResponse,
      routing,
      api_performance: apiPerformance,
      processing_time_ms: Date.now() - startTime,
    });

    // 11. Log and emit
    await logScoredLead(result, apiPerformance, apiData, llmResponse);
    emitMetrics(result, apiPerformance);

    return result;

  } catch (err) {
    console.error('Lambda handler error:', err);
    return formatError(500, `Internal error: ${err.message}`);
  }
}

/**
 * Call 3 APIs in parallel. Each call is individually timed and error-handled.
 * FullContact dropped (zero value). Twilio dropped (overlaps Trestle).
 * eHawk handles phone validation upstream.
 */
async function callAllAPIs(lead, phone, signal, apiPerformance) {
  const contact = lead.contact;
  const certUrl = lead.trustedform_cert_url;

  const apiCalls = [
    timedApiCall('trestle', () => callTrestle(contact, phone, signal), apiPerformance),
    timedApiCall('batchdata', () => callBatchData(contact, signal), apiPerformance),
    timedApiCall('trustedform', () => callTrustedForm(certUrl, signal), apiPerformance),
  ];

  const results = await Promise.all(apiCalls);

  // Merge all API results into one flat object
  const merged = {};
  for (const result of results) {
    Object.assign(merged, result);
  }

  return merged;
}

/**
 * Quick hard-kill checks that save the ~$0.003 LLM cost on obvious rejects.
 * These are universal across all verticals and indisputable.
 * The LLM prompt also has these rules, so this is purely a cost optimization.
 *
 * @returns {string|null} Kill reason or null if lead passes
 */
function checkQuickHardKills(apiData, vertical) {
  // Invalid phone
  if (apiData['trestle.phone.is_valid'] === false || apiData['trestle.phone.is_valid'] === 'false') {
    return 'INVALID_PHONE';
  }

  // Bot detected
  if (apiData['trustedform.bot_detected'] === true || apiData['trustedform.bot_detected'] === 'true') {
    return 'BOT_DETECTED';
  }

  // Pre-populated form (bot/aggregator)
  if (apiData['trustedform.form_input_method'] === 'pre-populated_only') {
    return 'PRE_POPULATED_FORM';
  }

  // Mobile/Manufactured home (all verticals)
  if (apiData['batchdata.property_type'] === 'Mobile/Manufactured') {
    return 'MOBILE_MANUFACTURED_HOME';
  }

  // Condominium — instant reject for solar only
  if (vertical === 'solar' && apiData['batchdata.property_type'] === 'Condominium') {
    return 'CONDOMINIUM_SOLAR';
  }

  return null;
}

/**
 * Wrap an API call with timing and error handling.
 */
async function timedApiCall(apiName, callFn, apiPerformance) {
  const start = Date.now();
  try {
    const result = await callFn();
    apiPerformance[apiName] = {
      response_time_ms: Date.now() - start,
      success: true,
    };
    return result;
  } catch (err) {
    const elapsed = Date.now() - start;
    console.error(`${apiName} API call failed after ${elapsed}ms:`, err.message);
    apiPerformance[apiName] = {
      response_time_ms: elapsed,
      success: false,
      error_type: err.name === 'AbortError' ? 'timeout' : 'error',
    };
    // Return empty object — LLM will treat missing fields as null (neutral)
    return {};
  }
}

/**
 * Validate the lead input.
 */
function validateInput(lead) {
  if (!lead) return 'Missing lead data';
  if (!lead.lead_id) return 'Missing lead_id';
  if (!lead.vertical) return 'Missing vertical';
  if (!VALID_VERTICALS.includes(lead.vertical)) {
    return `Invalid vertical: ${lead.vertical}. Must be one of: ${VALID_VERTICALS.join(', ')}`;
  }
  if (!lead.contact) return 'Missing contact object';
  if (!lead.contact.phone) return 'Missing contact.phone';
  return null;
}

/**
 * Format the SIO response.
 */
function formatResponse(lead, data) {
  return {
    lead_id: lead.lead_id,
    vertical: lead.vertical,
    publisher_id: lead.publisher_id,
    publisher_name: lead.publisher_name,
    decision: data.decision,
    score: data.score,
    tier: data.tier,
    hard_kill: data.hard_kill,
    hard_kill_reason: data.hard_kill_reason,
    reason_codes: data.reason_codes,
    llm_response: data.llm_response || null,
    routing: data.routing,
    api_performance: data.api_performance,
    processing_time_ms: data.processing_time_ms,
  };
}

/**
 * Format an error response.
 */
function formatError(statusCode, message) {
  return {
    statusCode,
    body: JSON.stringify({ error: message }),
  };
}
