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
 * 7. Call Anthropic Sonnet (abort if SIO_BUDGET_MS wall clock exceeded → enrichment fast path)
 * 8. Parse tier + score; legacy post-scoring + four post-score tier caps + Silver floor
 * 9. Route to buyer (direct_buyers_gold_only → HOLD for Silver)
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
import { VALID_VERTICALS, DECISIONS, API_TIMEOUT_MS, SIO_BUDGET_MS } from './utils/constants.js';
import { applyPostScoreTierCaps, logTierCapsAudit } from './utils/post-score-tier-caps.js';
import { routeLead } from './router.js';
import { logScoredLead, emitMetrics, buildEnrichmentData } from './utils/logger.js';

// API clients (3 enrichment APIs — FullContact dropped, Twilio dropped)
import { callTrestle } from './api/trestle.js';
import { callBatchData } from './api/batchdata.js';
import { callTrustedForm } from './api/trustedform.js';

// LLM scorer (replaces rules engine — scorer.js + normalizer.js)
import { scoreLead, HOME_SERVICES_VERTICALS } from './llm-scorer.js';

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

      logScoredLead(result, apiPerformance, null).catch(err => {
        console.error('Background log failed:', err.message);
      });
      emitMetrics(result, apiPerformance);
      return toApiGwResponse(200, result);
    }

    // 7. Call Anthropic Sonnet with v4 prompt (abort if SIO wall-clock budget exceeded)
    const leadName = [lead.contact.first_name, lead.contact.last_name]
      .filter(Boolean).join(' ') || null;

    const budgetRemaining = SIO_BUDGET_MS - (Date.now() - startTime);
    const sioAbort = new AbortController();
    let sioTimer = null;
    if (budgetRemaining > 0) {
      sioTimer = setTimeout(() => sioAbort.abort(), budgetRemaining);
    } else {
      sioAbort.abort();
    }

    const llmStart = Date.now();
    let llmResult;
    let timeoutFastPath = false;

    try {
      if (budgetRemaining <= 0) {
        const budgetErr = new Error('SIO budget exhausted');
        budgetErr.name = 'AbortError';
        throw budgetErr;
      }
      llmResult = await scoreLead(apiData, lead.vertical, leadName, { signal: sioAbort.signal });
    } catch (err) {
      if (err.name === 'AbortError') {
        timeoutFastPath = true;
        llmResult = {
          tier: 'Silver',
          score: 0,
          confidence: 'low',
          reasons: ['Scored on enrichment data only — no LLM analysis'],
          concerns: ['TIMEOUT: Anthropic did not respond within 5.8s'],
          llm_usage: {
            input_tokens: 0,
            output_tokens: 0,
            cache_read_tokens: 0,
            cache_write_tokens: 0,
          },
        };
        apiPerformance.anthropic = {
          response_time_ms: Date.now() - llmStart,
          success: false,
          timeout_fast_path: true,
        };
      } else {
        if (sioTimer) clearTimeout(sioTimer);
        throw err;
      }
    } finally {
      if (sioTimer) clearTimeout(sioTimer);
    }

    if (!timeoutFastPath) {
      apiPerformance.anthropic = {
        response_time_ms: Date.now() - llmStart,
        success: true,
        input_tokens: llmResult.llm_usage?.input_tokens || 0,
        output_tokens: llmResult.llm_usage?.output_tokens || 0,
        cache_read_tokens: llmResult.llm_usage?.cache_read_tokens ?? 0,
        cache_write_tokens: llmResult.llm_usage?.cache_write_tokens ?? 0,
      };
    }

    // 8. Use LLM tier + score, then apply deterministic post-scoring enforcement.
    // Rules run most-restrictive first: Bronze caps → Silver caps → Silver floor.
    // Each section only tightens; a Bronze result cannot be upgraded by a later Silver cap.
    let { tier, score } = llmResult;

    // Shared values referenced across multiple rules
    const phoneNameMatch = apiData['trestle.phone.name_match'];
    const addrNameMatch  = apiData['trestle.address.name_match'];
    const ownerOccupied  = apiData['batchdata.owner_occupied'];
    const corporateOwned = apiData['batchdata.corporate_owned'];
    const propertyType   = apiData['batchdata.property_type'];
    const phoneGrade     = apiData['trestle.phone.contact_grade'];
    const phoneActivity  = apiData['trestle.phone.activity_score'];
    const phoneLineType  = apiData['trestle.phone.line_type'];
    const taxLien        = apiData['batchdata.tax_lien'];
    const involuntaryLien = apiData['batchdata.involuntary_lien'];
    const preForeclosure = apiData['batchdata.pre_foreclosure'];
    const confirmedOwner = apiData['trustedform.confirmed_owner'];
    const bdAge          = apiData['batchdata.bd_age'];
    const trestleMissing = isTrestleDataMissing(apiData);

    // Helper: demote to Bronze
    const capBronze = () => { tier = 'Bronze'; score = Math.min(score, 44); };
    // Helper: demote to Silver (no-op if already Bronze)
    const capSilver = () => {
      if (tier === 'Gold') { tier = 'Silver'; score = Math.min(score, 69); }
    };

    // ── 8a. BRONZE CAPS (most restrictive — run first) ──────────────────────────

    // Rule 3: Both phone AND address name mismatches — confirmed wrong contact data.
    // Proof: Mary Browning Silver 52 — wrong number, DNC, tax lien + involuntary lien.
    if (
      String(phoneNameMatch).toLowerCase() === 'false' &&
      String(addrNameMatch).toLowerCase() === 'false'
    ) {
      capBronze();
    }

    // Rule 4: Phone name mismatch + corporate owned — identity can't be tied to a person.
    // Proof: Harsha Patel Gold 85 — phone mismatch, corporate owned, involuntary lien → Bad Contact Data.
    if (
      String(phoneNameMatch).toLowerCase() === 'false' &&
      corporateOwned === true
    ) {
      capBronze();
    }

    // Rule 5: Confirmed renter without clean name-match signals — can't authorize home work.
    // Proof: Randy Rush Gold 85 — renter on commercial, absentee owner → Wrong Number.
    if (
      ownerOccupied === 'confirmed_renter' &&
      !(String(phoneNameMatch).toLowerCase() === 'true' && String(addrNameMatch).toLowerCase() === 'true')
    ) {
      capBronze();
    }

    // Rule 6: NonFixedVOIP line type — high fraud/wrong-person risk.
    if (phoneLineType === 'NonFixedVOIP') {
      capBronze();
    }

    // Rule 7: Grade F phone + low activity — effectively unreachable.
    if (phoneGrade === 'F' && phoneActivity != null && phoneActivity < 40) {
      capBronze();
    }

    // Existing 8a: Data coverage cap — 3+ of 5 signal groups entirely null.
    // Backtest: sparse-data Silver leads had 0% appointment rate (0/7 with dispo).
    if (countSignalGroups(apiData) <= 2) {
      capBronze();
    }

    // Age 65+ cap (Bronze) — moved here from 8d since Bronze is the outcome.
    // Dispo data: 0% appt rate at 65-69, near-zero at 70+. Insurance/mortgage exempt.
    const NON_AGE_CAPPED_VERTICALS = ['insurance', 'mortgage'];
    if (bdAge && bdAge >= 65 && !NON_AGE_CAPPED_VERTICALS.includes(lead.vertical)) {
      capBronze();
    }

    // ── 8b. SILVER CAPS (run only if not already Bronze) ────────────────────────

    // Rule 8: Corporate owned — real person can't authorize work on corporate property.
    // Affects: DAVE PARKER, Stephen Marshall, Erlinda Stone, JOSEPH CASCONE, Keith Batker,
    //          Sharon St Clair, Harsha Patel (also Bronze via rule 4).
    if (corporateOwned === true) {
      capSilver();
    }

    // Rule 9: Confirmed renter with clean name-match signals — contactable but can't convert
    //         on home services (doesn't own the property being serviced).
    // Affects: Curtis Nobis, Michael McCarthy, Amanda Lewis, Youssef Bessam, Scott Lee.
    if (
      ownerOccupied === 'confirmed_renter' &&
      String(phoneNameMatch).toLowerCase() === 'true' &&
      String(addrNameMatch).toLowerCase() === 'true'
    ) {
      capSilver();
    }

    // Rule 10: Commercial property on a home-services vertical — no residential structure.
    // Affects: Randy Rush (solar), NANCY HOST (solar).
    if (propertyType === 'Commercial' && HOME_SERVICES_VERTICALS.includes(lead.vertical)) {
      capSilver();
    }

    // Rule 11: No Trestle data — identity can't be verified at all.
    // Affects: Nino Pacantara, DEL MCCORD, Gregory Brooks, wendell dotson, Raman Patel, Dan Houston.
    if (trestleMissing) {
      capSilver();
    }

    // Rule 12: Stacked fraud signals — 2+ of tax lien, involuntary lien, pre-foreclosure.
    // Affects: Terry Olson Gold 85, Sherrie McCloud-McGHee Gold 95.
    {
      const fraudCount = [taxLien, involuntaryLien, preForeclosure].filter(v => v === true).length;
      if (fraudCount >= 2) {
        capSilver();
      }
    }

    // Existing 8b: Dual identity mismatch — phone belongs to someone else AND owner name
    // doesn't match. Backtest: avg score 41.7 (Bronze), 0% appts when also sparse.
    {
      const ownerName = apiData['_batchdata.owner_name'];
      const lastNameLower = (lead.contact.last_name || '').toLowerCase();
      if (String(phoneNameMatch).toLowerCase() === 'false') {
        const ownerMismatch = ownerName && lastNameLower &&
          !ownerName.toLowerCase().includes(lastNameLower);
        if (ownerMismatch) {
          if (String(addrNameMatch).toLowerCase() === 'false') {
            capBronze(); // triple mismatch: phone + owner + address
          } else {
            capSilver(); // dual mismatch: phone + owner, address ok
          }
        }
      }
    }

    // Existing 8c: TrustedForm unverified owner cap.
    // "no_verified_account" converts at 5.9% vs "verified" at 21.4% (102 vs 28 leads).
    if (confirmedOwner === 'no_verified_account' && score < 80) {
      capSilver();
    }

    // Existing 8d: Age 60-64 Silver cap (65+ already handled above in Bronze section).
    // Dispo: 0% appt rate in 9 leads at 60-64, sharp drop from 20%+.
    if (bdAge && bdAge >= 60 && bdAge < 65 && !NON_AGE_CAPPED_VERTICALS.includes(lead.vertical)) {
      capSilver();
    }

    // ── 8b2. Four post-score tier caps (validated dispo — runs after legacy enforcement, before Silver floor)
    const tierBeforeFourCaps = tier;
    const fourCaps = applyPostScoreTierCaps(apiData, tier, score, lead.vertical);
    tier = fourCaps.tier;
    score = fourCaps.score;
    logTierCapsAudit(fourCaps.capsTriggered, tierBeforeFourCaps, tier, score, lead);

    if (timeoutFastPath) {
      const fn = lead.contact?.first_name ?? '';
      const ln = lead.contact?.last_name ?? '';
      console.log(
        `TIMEOUT_FAST_PATH | lead: ${fn} ${ln} | enrichment_tier: ${tier} | caps: ${fourCaps.capsTriggered.join(', ') || 'none'}`,
      );
    }

    // ── 8c. SILVER FLOOR ────────────────────────────────────────────────────────
    // Silver scores below 53 have 0% appointment rate — demote to Bronze.
    // Affects: Katie Woodring 52, RANI BAHR 52, Aaron Morse 52, Ralph Poston 52.
    // (Mary Browning 52 already Bronze via rule 3.)
    // Skip when SIO timeout fast path: score is 0 (not LLM-comparable); spec keeps Silver if no caps fired.
    if (tier === 'Silver' && score < 53 && !timeoutFastPath) {
      tier = 'Bronze';
      score = 44;
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

    // 11. Log and emit — fire-and-forget so DynamoDB write doesn't block the HTTP response
    logScoredLead(result, apiPerformance, llmResponse).catch(err => {
      console.error('Background log failed:', err.message);
    });
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

  // Litigator risk (universal) — stored as stringified boolean from Trestle add_on
  if (apiData['trestle.litigator_risk'] === 'true') {
    return 'LITIGATOR_RISK';
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
 * Returns true when Trestle returned no usable phone data — all 5 core phone
 * fields are null, indicating either an API error or a completely unknown number.
 * Used to inject a context flag for the LLM and enforce a Silver cap post-LLM.
 */
function isTrestleDataMissing(apiData) {
  return [
    'trestle.phone.is_valid', 'trestle.phone.contact_grade',
    'trestle.phone.activity_score', 'trestle.phone.line_type', 'trestle.phone.name_match',
  ].every(k => apiData[k] == null);
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
