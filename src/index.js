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
import { logScoredLead, emitMetrics, buildEnrichmentData } from './utils/logger.js';

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
      return toApiGwResponse(200, formatResponse(lead, {
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
      }));
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
        enrichment_data: buildEnrichmentData(apiData),
        routing: { buyer_id: null, buyer_name: null, endpoint_url: null, cpl: null },
        api_performance: apiPerformance,
        processing_time_ms: Date.now() - startTime,
      });

      await logScoredLead(result, apiPerformance, null);
      emitMetrics(result, apiPerformance);
      return toApiGwResponse(200, result);
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

    // 8. Use LLM tier + score, then apply post-scoring caps
    let { tier, score } = llmResult;

    // ── 8a. Data coverage cap ──
    // If 3+ of 5 signal groups are entirely null, cap at Bronze.
    // Backtest: sparse-data Silver leads had 0% appointment rate (0/7 with dispo).
    const groupsPresent = countSignalGroups(apiData);
    if (groupsPresent <= 2) {
      if (tier === 'Gold' || tier === 'Silver') {
        tier = 'Bronze';
        score = Math.min(score, 44);
      }
    }

    // ── 8b. Dual identity mismatch cap ──
    // Phone belongs to someone else AND property belongs to someone else.
    // Backtest: 42 leads, avg score 41.7 (Bronze). 0% appts when also sparse.
    const phoneNameMatch = apiData['trestle.phone.name_match'];
    const addrNameMatch = apiData['trestle.address.name_match'];
    const ownerName = apiData['_batchdata.owner_name'];
    const lastNameLower = (lead.contact.last_name || '').toLowerCase();

    if (String(phoneNameMatch).toLowerCase() === 'false') {
      const ownerMismatch = ownerName && lastNameLower &&
        !ownerName.toLowerCase().includes(lastNameLower);
      if (ownerMismatch) {
        if (String(addrNameMatch).toLowerCase() === 'false') {
          // Triple mismatch: phone + owner + address = Bronze cap
          if (tier === 'Gold' || tier === 'Silver') {
            tier = 'Bronze';
            score = Math.min(score, 44);
          }
        } else {
          // Dual mismatch: phone + owner, address ok = Silver cap
          if (tier === 'Gold') {
            tier = 'Silver';
            score = Math.min(score, 69);
          }
        }
      }
    }

    // ── 8c. TrustedForm verified owner cap ──
    // "no_verified_account" converts at 5.9% vs "verified" at 21.4% (102 vs 28 leads).
    // If unverified and score < 80, cap at Silver.
    const confirmedOwner = apiData['trustedform.confirmed_owner'];
    if (confirmedOwner === 'no_verified_account' && score < 80) {
      if (tier === 'Gold') {
        tier = 'Silver';
        score = Math.min(score, 69);
      }
    }

    // ── 8d. Age-based caps ──
    // Dispo data (559 leads, 74 with age):
    //   Under 60: 19-26% appt rate
    //   60-64: 0% (9 leads)
    //   65-69: 0% (8 leads)
    //   70+: ~5% (2 appts in 32 leads, outliers at 75 and 80+)
    // Insurance and mortgage exempt (financial products, no physical presence needed).
    const NON_AGE_CAPPED_VERTICALS = ['insurance', 'mortgage'];
    const bdAge = apiData['batchdata.bd_age'];
    if (bdAge && !NON_AGE_CAPPED_VERTICALS.includes(lead.vertical)) {
      if (bdAge >= 65) {
        // 65+ = Bronze cap. 0% appt rate at 65-69, near-zero at 70+.
        if (tier === 'Gold' || tier === 'Silver') {
          tier = 'Bronze';
          score = Math.min(score, 44);
        }
      } else if (bdAge >= 60) {
        // 60-64 = Silver cap. 0% appt rate in 9 leads, sharp drop from 20%+.
        if (tier === 'Gold') {
          tier = 'Silver';
          score = Math.min(score, 69);
        }
      }
    }

    // 9. Route to buyer (pass config for shadow_mode check)
    const { decision, routing } = await routeLead(lead.vertical, tier, score, lead, config);

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
      enrichment_data: buildEnrichmentData(apiData),
      routing,
      api_performance: apiPerformance,
      processing_time_ms: Date.now() - startTime,
    });

    // 11. Log and emit
    await logScoredLead(result, apiPerformance, llmResponse);
    emitMetrics(result, apiPerformance);

    return toApiGwResponse(200, result);

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
 * The LLM prompt also has these rules, so this is purely a cost optimization.
 *
 * Universal: invalid phone, bot, pre-populated form
 * Mobile/Manufactured: hard kill for structural home services only (solar, roofing, windows, siding)
 *   — HVAC, gutters, painting, plumbing, flooring, insurance, mortgage handle in LLM prompt
 * Condominium: hard kill for solar only (shared roof) and siding (HOA exterior)
 *
 * @returns {string|null} Kill reason or null if lead passes
 */
function checkQuickHardKills(apiData, vertical) {
  // Invalid phone (universal)
  if (apiData['trestle.phone.is_valid'] === false || apiData['trestle.phone.is_valid'] === 'false') {
    return 'INVALID_PHONE';
  }

  // Bot detected (universal)
  if (apiData['trustedform.bot_detected'] === true || apiData['trustedform.bot_detected'] === 'true') {
    return 'BOT_DETECTED';
  }

  // Pre-populated form (universal)
  if (apiData['trustedform.form_input_method'] === 'pre-populated_only') {
    return 'PRE_POPULATED_FORM';
  }

  // Mobile/Manufactured home — hard kill for structural verticals only
  // HVAC, gutters, painting, plumbing, flooring, insurance, mortgage serve mobile homes (handled in LLM)
  const mobileHardKillVerticals = ['solar', 'roofing', 'windows', 'siding'];
  if (mobileHardKillVerticals.includes(vertical) && apiData['batchdata.property_type'] === 'Mobile/Manufactured') {
    return 'MOBILE_MANUFACTURED_HOME';
  }

  // Condominium — solar (can't install on shared roof) + siding (HOA manages exterior)
  if ((vertical === 'solar' || vertical === 'siding') && apiData['batchdata.property_type'] === 'Condominium') {
    return 'CONDOMINIUM_HARD_KILL';
  }

  // Solar permit = already has solar. 0% appointment rate, 40% DQ rate in backtest.
  // Only applies to solar vertical (other verticals don't care about existing solar).
  if (vertical === 'solar' && apiData['batchdata.solar_permit'] === true) {
    return 'ALREADY_HAS_SOLAR';
  }

  // Empty form input = TrustedForm captured zero form interaction.
  // 0% appointment rate across 16 leads. Suspicious — possible bot or uninstrumented form.
  if (apiData['trustedform.form_input_method'] === 'empty') {
    return 'EMPTY_FORM_INPUT';
  }

  return null;
}

/**
 * Count how many of the 5 signal groups have at least one non-null field.
 * Groups: A=Contactability, B=Identity, C=Property, D=Financial, E=Form Behavior
 */
function countSignalGroups(apiData) {
  let groups = 0;
  if (['trestle.phone.is_valid', 'trestle.phone.contact_grade', 'trestle.phone.activity_score', 'trestle.phone.line_type']
    .some(k => apiData[k] != null)) groups++;
  if (['trestle.phone.name_match', 'trestle.email.name_match', 'trestle.address.name_match', '_batchdata.owner_name']
    .some(k => apiData[k] != null)) groups++;
  if (['batchdata.owner_occupied', 'batchdata.property_type', 'batchdata.estimated_value', 'batchdata.year_built', 'batchdata.free_and_clear', 'batchdata.high_equity']
    .some(k => apiData[k] != null)) groups++;
  if (['fullcontact.household_income', 'fullcontact.living_status']
    .some(k => apiData[k] != null)) groups++;
  if (['trustedform.form_input_method', 'trustedform.bot_detected', 'trustedform.confirmed_owner', 'trustedform.age_seconds']
    .some(k => apiData[k] != null)) groups++;
  return groups;
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
    enrichment_data: data.enrichment_data ?? null,
    routing: data.routing,
    api_performance: data.api_performance,
    processing_time_ms: data.processing_time_ms,
  };
}

/**
 * Wrap any body object in the API Gateway proxy response envelope.
 * All handler return paths must go through this so API GW receives
 * a well-formed { statusCode, headers, body } object.
 */
function toApiGwResponse(statusCode, bodyObj) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(bodyObj),
  };
}

/**
 * Format an error response.
 */
function formatError(statusCode, message) {
  return toApiGwResponse(statusCode, { error: message });
}
