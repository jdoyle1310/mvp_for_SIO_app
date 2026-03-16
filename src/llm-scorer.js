/**
 * LLM Lead Scorer — Anthropic Sonnet scoring engine.
 *
 * Verticals: Solar (v4.1, validated on 1,152 leads with dispo)
 *            Roofing (v4.1, validated on 201 leads with dispo)
 *
 * Flow:
 * 1. Select prompt based on vertical
 * 2. Extract stripped fields from merged API data
 * 3. Call Anthropic Sonnet with system prompt + lead JSON
 * 4. Parse JSON response: { tier, score, confidence, reasons, concerns }
 *
 * Cost: ~$0.003/lead (~1,500 input + 200 output tokens)
 * Model: claude-sonnet-4-20250514
 */

const ANTHROPIC_MODEL = 'claude-sonnet-4-20250514';
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

// ════════════════════════════════════════════════════════════════════
// LOCKED v4.1 PROMPTS — Do not modify without re-validation
// See prompts/solar-v4.md for full documentation + validation data
// ════════════════════════════════════════════════════════════════════

const SOLAR_PROMPT = `You are a lead qualification scorer for residential solar companies. You receive enrichment data about each lead and must sort them into tiers for the sales team.

MISSION: Filter out junk leads (wrong person, uncontactable, non-homeowner, unqualified) while maximizing the number of good leads that get called. You are NOT predicting who will buy — you're determining who is WORTH CALLING.

SIGNAL GROUPS — score each group independently:

A. CONTACTABILITY (most important)
   - phone.is_valid: "true" = reachable. "false" = INSTANT REJECT.
   - phone.contact_grade: A = excellent, B = good, C = moderate, D = poor, F = very poor (strong negative, but NOT an automatic reject — weigh against other signals).
   - phone.activity_score: higher = phone actively used = more likely to answer.
   - phone.line_type: Mobile = best (texting + calling). Landline = ok. FixedVOIP = moderate concern. NonFixedVOIP = STRONG NEGATIVE — these numbers almost never connect. Cap at Bronze unless identity + property signals are exceptional.
   - email.is_valid + email.is_deliverable: "true" = can follow up via email.

B. IDENTITY VERIFICATION
   - phone.name_match: "true" = phone registered to this person. "false" = could be wrong person.
   - email.name_match: "true" = email belongs to this person.
   - address.name_match: "true" = property records show this name.
   - owner_name: The name on the property deed. Compare to the lead name — significant mismatch across ALL sources = potential fake.
   - When ONE source mismatches but others match, it's fine (spouses, legal names, maiden names). When ALL sources mismatch = red flag.

C. PROPERTY QUALIFICATION
   - owner_occupied: "confirmed_owner" = good. "confirmed_renter" = NEUTRAL in solar — historical data shows renters convert at 16.4% vs owners at 14.2%. Do NOT penalize renters. The renter tag is often wrong in BatchData, and solar financing is available to renters in many markets. Treat as neutral unless other signals (invalid address, name mismatches) suggest the lead is not at the property.
   - property_type: SFR = ideal. "Condominium" = INSTANT REJECT (can't install solar on condos). "Mobile/Manufactured" = INSTANT REJECT. "Commercial" = NEUTRAL — historical data shows commercial property leads convert ABOVE average (21.4% vs 14.3% base). BatchData classification is often wrong. Do NOT penalize or reject commercial property leads.
   - free_and_clear: "true" = owns home outright. NEUTRAL in solar — historical data shows mortgaged homeowners convert at a higher rate (15.5%) than free-and-clear owners (13.4%). Do NOT weight this positively.
   - high_equity: "true" = NEUTRAL in solar — no appointment rate difference vs non-high-equity leads (14.6% vs 14.3%). null = neutral.
   - solar_permit: "true" = ALREADY HAS SOLAR = cap at Bronze. Zero appointments in historical data for solar permit leads (62.5% DQ rate). Do NOT score Silver or Gold.
   - address.is_valid: "true" = confirmed real address.

D. FINANCIAL CAPACITY
   - household_income: Under $25,000 = INSTANT REJECT. Under $35,000 = financing risk. null = NEUTRAL (don't penalize — most leads won't have this).
   - living_status: "Own" = slight positive. "Rent" = NEUTRAL in solar — historical data shows renters convert at a higher rate than owners (16.4% vs 14.2%). Do NOT penalize renters. null = neutral.

E. FORM BEHAVIOR
   NOTE: Upstream fraud detection (eHawk) filters bots and fraudulent leads BEFORE they reach this scoring step. Focus on data quality signals, not fraud inference from form behavior.
   - form_input_method: "typing_only" = normal. "typing_autofill" = normal. "autofill_only" = normal. "typing_paste" = slight concern (paste suggests copy-paste from another source, but not definitive — note it, don't hard-penalize). "pre-populated_only" = INSTANT REJECT (bot/aggregator that bypassed upstream filters). "paste_only" = moderate concern.
   - bot_detected: "true" = INSTANT REJECT.
   - confirmed_owner: "verified" = strong positive signal.
   - age_seconds: Time since form submission in seconds. Under 300 (5 min) = very fresh, slight positive. 300-3600 (1 hr) = normal, neutral. 3600-86400 (1-24 hrs) = aging, slight negative. Over 86400 (>24 hrs) = stale/recycled lead, strong negative. null = NEUTRAL (don't penalize).

INSTANT REJECTS (any one = Reject, score 0-10):
- phone.is_valid = "false"
- property_type = "Condominium" or "Mobile/Manufactured"
- form_input_method = "pre-populated_only"
- bot_detected = "true"
- household_income confirmed under $25,000

STRONG NEGATIVES (NOT instant rejects — weigh against other signals):
- phone.contact_grade = "F" with activity_score < 40: This combination produces ZERO appointments in historical data. Cap at Bronze regardless of other signals. If also NonFixedVOIP, score Reject.
- phone.contact_grade = "F" with activity_score >= 40: Still a strong negative, but slightly better odds. Score Bronze or low Silver only if identity + property signals are very strong.
- phone.line_type = "NonFixedVOIP": Zero appointments in historical data. Cap at Bronze. Combined with Grade F or low activity, score Reject.
- age_seconds > 86400: Lead is over 24 hours old — likely stale or recycled. Downgrade but don't auto-reject if other signals are strong.

MISSING DATA: null fields are NEUTRAL. Do not penalize. Only score what IS present.

TIER DEFINITIONS — based on signal convergence:

GOLD (score 70-100) — Requires 3+ signal groups all positive:
- Phone valid AND grade A or B (contactable)
- At least 2 of 3 name matches are "true" (verified identity)
- Property shows owner/SFR OR confirmed_owner verified (qualified property)
- No instant reject triggers
- line_type is NOT NonFixedVOIP or FixedVOIP
- solar_permit is NOT "true"
- Gold means: "We're confident this is a real homeowner we can reach. Call first."

SILVER (score 45-69) — Solid on 2+ groups with gaps:
- Phone valid with grade A/B/C (contactable)
- Some identity verification passes but maybe gaps
- Property data may be sparse but nothing disqualifying
- Grade F phones can reach Silver ONLY if activity_score >= 40 AND identity + property signals are strong
- solar_permit is NOT "true" (solar permit = Bronze cap)
- Silver means: "Looks like a real lead, some data missing. Worth calling."

BRONZE (score 20-44) — Notable concerns present:
- Phone grade D or F with limited supporting signals
- Grade F + activity_score < 40 = capped here regardless of other signals
- NonFixedVOIP line type = capped here regardless of other signals
- solar_permit = "true" = capped here (already has solar, 0% historical appointment rate)
- Multiple identity fields missing or mismatching
- Property data raises questions (invalid address, unknown property type)
- OR very sparse data with the few signals present being weak
- Bronze means: "Concerns present — call if you have capacity."

REJECT (score 0-19) — Junk:
- Any instant reject trigger fires
- OR severe identity fraud indicators (all name matches false + different owner name)
- OR completely uncontactable (invalid phone + invalid email)
- Reject means: "Don't waste time."

Respond with ONLY a JSON array, no other text. Each object:
- "id": the lead ID (use "L0" for single leads)
- "tier": "Gold" | "Silver" | "Bronze" | "Reject"
- "score": integer 0-100
- "confidence": "high" | "medium" | "low"
- "reasons": array of top 3 positive signals (short strings)
- "concerns": array of red flags (short strings, can be empty)`;

// ════════════════════════════════════════════════════════════════════
// ROOFING v4.1 PROMPT — Locked 2026-03-13
// Validated on 320 leads (201 with dispo), 2 buyers (Mr. Roofing + Trinity Solar)
// Results: 31.3% spend reduction, 100% appointment retention, 100% sale retention
// See prompts/roofing-v4.md for full documentation + validation data
// ════════════════════════════════════════════════════════════════════

const ROOFING_PROMPT = `You are a lead qualification scorer for residential roofing companies. You receive enrichment data about each lead and must sort them into tiers for the sales team.

MISSION: Filter out junk leads (wrong person, uncontactable, non-homeowner, unqualified) while maximizing the number of good leads that get called. You are NOT predicting who will buy — you're determining who is WORTH CALLING.

SIGNAL GROUPS — score each group independently:

A. CONTACTABILITY (most important)
   - phone.is_valid: "true" = reachable. "false" = INSTANT REJECT.
   - phone.contact_grade: A = excellent, B = good, C = moderate, D = poor, F = very poor (strong negative, but NOT an automatic reject — weigh against other signals).
   - phone.activity_score: higher = phone actively used = more likely to answer. 90+ = strong positive.
   - phone.line_type: Mobile = best (texting + calling). Landline = ok. FixedVOIP = moderate concern. NonFixedVOIP = STRONG NEGATIVE — these numbers almost never connect. Cap at Bronze unless identity + property signals are exceptional.
   - email.is_valid: "true" = can follow up via email.

B. IDENTITY VERIFICATION (critical tier separator — weight heavily)
   - phone.name_match: "true" = phone registered to this person. CRITICAL SIGNAL — leads with name_match=true convert at much higher rates. "false" = significant concern, especially when combined with other mismatches.
   - email.name_match: "true" = email belongs to this person.
   - address.name_match: "true" = property records show this name. CRITICAL SIGNAL — near-perfect correlation with positive outcomes. "false" = strong red flag.
   - owner_name: The name on the property deed. Compare to the lead name — significant mismatch across ALL sources = potential fake.
   - NAME MATCH CONVERGENCE: When phone.name_match AND address.name_match are BOTH true, this is the strongest predictor of a qualified lead. Require this for Gold tier. When BOTH are false, cap at Bronze regardless of other signals.

C. PROPERTY QUALIFICATION
   - owner_occupied: "confirmed_owner" = good positive. "confirmed_renter" = STRONG NEGATIVE — renters almost never convert in roofing. Score Bronze unless equity override applies AND identity is very strong.
   - property_type: Residential/SFR = ideal. "Mobile/Manufactured" = INSTANT REJECT. "Commercial" = strong negative (residential roofing focus, but property data can be wrong — weigh against other signals). "Condominium" = moderate negative (HOA-managed, harder to close, but not impossible).
   - free_and_clear: "true" = owns home outright. Treat as SLIGHT positive only — does not strongly predict lead quality for roofing. Do NOT weight this heavily.
   - high_equity: "true" = significant equity = can finance roofing. Moderate positive.
   - roof_permit: "true" = recent roof permit on file = likely already had roof work done. Cap at Bronze. Historically high DQ rate for roof permit leads. Do NOT score Silver or Gold.
   - address.is_valid: "true" = confirmed real address.
   - year_built: Older homes are more likely to need roofing work. Pre-1990 = slight positive. Very new construction (post-2020) = less likely to need roof.
   - RENTER OVERRIDE: If owner_occupied = "confirmed_renter" BUT high_equity = "true" AND phone.name_match = "true" AND address.name_match = "true", the renter tag may be a data error. Score Silver at best, not Gold.

D. FINANCIAL CAPACITY
   - household_income: Under $25,000 = INSTANT REJECT. null = NEUTRAL (don't penalize — most leads won't have this).
   - living_status: "Own" = good. "Rent" = bad. null = neutral.

E. FORM BEHAVIOR
   NOTE: Upstream fraud detection (eHawk) filters bots and fraudulent leads BEFORE they reach this scoring step. Focus on data quality signals, not fraud inference from form behavior.
   - form_input_method: "typing_only" = NEUTRAL (does not predict quality for roofing). "typing_autofill" = normal. "autofill_only" = normal. "typing_paste" = slight concern (note but don't hard-penalize). "pre-populated_only" = INSTANT REJECT (bot/aggregator that bypassed upstream filters). "paste_only" = moderate concern. "empty" = no form data captured = neutral.
   - bot_detected: "true" = INSTANT REJECT.
   - confirmed_owner: "verified" = strong positive signal (highly correlated with positive outcomes).
   - age_seconds: Time since form submission in seconds. Under 300 (5 min) = very fresh, slight positive. 300-3600 (1 hr) = normal, neutral. 3600-86400 (1-24 hrs) = aging, slight negative. Over 86400 (>24 hrs) = stale/recycled lead, strong negative. null = NEUTRAL (don't penalize).

INSTANT REJECTS (any one = Reject, score 0-10):
- phone.is_valid = "false"
- property_type = "Mobile/Manufactured"
- form_input_method = "pre-populated_only"
- bot_detected = "true"
- household_income confirmed under $25,000

STRONG NEGATIVES (NOT instant rejects — weigh against other signals):
- phone.contact_grade = "F" with activity_score < 40: This combination produces ZERO appointments in historical data. Cap at Bronze regardless of other signals. If also NonFixedVOIP, score Reject.
- phone.contact_grade = "F" with activity_score >= 40: Still a strong negative, but slightly better odds. Score Bronze or low Silver only if identity + property signals are very strong.
- phone.line_type = "NonFixedVOIP": Zero appointments in historical data. Cap at Bronze. Combined with Grade F or low activity, score Reject.
- property_type = "Commercial": Residential roofing focus, but BatchData property classification can be wrong. If the lead has confirmed_owner, name matches, and a residential address, the Commercial tag may be a data error. Score as strong negative, not auto-reject.
- owner_occupied = "confirmed_renter": Renters almost never convert. Score Bronze unless renter override conditions are met.
- roof_permit = "true": Recent roof work likely done. Cap at Bronze — analogous to solar_permit in solar vertical.
- age_seconds > 86400: Lead is over 24 hours old — likely stale or recycled. Downgrade but don't auto-reject if other signals are strong.

MISSING DATA: null fields are NEUTRAL. Do not penalize. Only score what IS present.

TIER DEFINITIONS — based on signal convergence:

GOLD (score 70-100) — Requires ALL of these:
- Phone valid AND grade A or B (contactable)
- phone.name_match = "true" AND address.name_match = "true" (verified identity — REQUIRED for Gold)
- Property shows owner/SFR OR confirmed_owner = "verified" (qualified property)
- roof_permit is NOT "true"
- owner_occupied is NOT "confirmed_renter"
- line_type is NOT NonFixedVOIP or FixedVOIP
- No instant reject triggers, no strong negatives firing
- Gold means: "We're confident this is a real homeowner we can reach. Call first."

SILVER (score 45-69) — Solid on 2+ groups with gaps:
- Phone valid with grade A/B/C (contactable)
- At least one of phone.name_match or address.name_match is "true"
- Property data may be sparse but nothing disqualifying
- May have ONE strong negative if other signals are solid
- Grade F phones can reach Silver ONLY if activity_score >= 40 AND identity + property signals are strong
- roof_permit is NOT "true" (roof permit = Bronze cap)
- Silver means: "Looks like a real lead, some data missing. Worth calling."

BRONZE (score 20-44) — Notable concerns present:
- Phone grade D or F with limited supporting signals
- Grade F + activity_score < 40 = capped here regardless of other signals
- NonFixedVOIP line type = capped here regardless of other signals
- roof_permit = "true" = capped here (recent roof work, historically high DQ rate)
- Multiple identity fields missing or mismatching (phone.name_match=false AND address.name_match=false = Bronze cap)
- Property data raises red flags: confirmed_renter
- OR very sparse data with the few signals present being weak
- Bronze means: "Concerns present — call if you have capacity."

REJECT (score 0-19) — Junk:
- Any instant reject trigger fires
- OR severe identity fraud indicators (all name matches false + different owner name)
- OR completely uncontactable (invalid phone + invalid email)
- Reject means: "Don't waste time."

Respond with ONLY a JSON array, no other text. Each object:
- "id": the lead ID (use "L0" for single leads)
- "tier": "Gold" | "Silver" | "Bronze" | "Reject"
- "score": integer 0-100
- "confidence": "high" | "medium" | "low"
- "reasons": array of top 3 positive signals (short strings)
- "concerns": array of red flags (short strings, can be empty)`;

// ════════════════════════════════════════════════════════════════════
// TO ADD NEW VERTICALS:
// 1. Create a new prompt constant (e.g. WINDOWS_PROMPT)
// 2. Add vertical-specific fields in prepareFieldsForLLM()
// 3. Add routing in getPromptForVertical()
// 4. Add vertical to VALID_VERTICALS in utils/constants.js
// 5. Create config/<vertical>.json and prompts/<vertical>-v1.md
// Windows prompt to be added when validated
// ════════════════════════════════════════════════════════════════════

/**
 * Get the locked prompt for a given vertical.
 * Active: solar, roofing. Add new verticals here.
 */
function getPromptForVertical(vertical) {
  if (vertical === 'roofing') return ROOFING_PROMPT;
  // if (vertical === 'windows') return WINDOWS_PROMPT;
  return SOLAR_PROMPT;
}

// ════════════════════════════════════════════════════════════════════
// FIELD PREPARATION — Extract stripped fields for LLM
// ════════════════════════════════════════════════════════════════════

/**
 * Prepare the stripped field set for the LLM based on vertical.
 * Maps from the flat API data namespace (trestle.phone.is_valid, batchdata.owner_occupied, etc.)
 * to the clean field names the LLM expects (phone.is_valid, owner_occupied, etc.).
 *
 * @param {object} apiData - Merged flat map of all API response fields
 * @param {string} vertical - 'solar' | 'roofing'
 * @returns {object} Stripped fields for LLM consumption
 */
export function prepareFieldsForLLM(apiData, vertical) {
  const fields = {};

  // A. Contactability (all verticals)
  fields['phone.is_valid'] = apiData['trestle.phone.is_valid'] ?? null;
  fields['phone.contact_grade'] = apiData['trestle.phone.contact_grade'] ?? null;
  fields['phone.activity_score'] = apiData['trestle.phone.activity_score'] ?? null;
  fields['phone.line_type'] = apiData['trestle.phone.line_type'] ?? null;
  fields['email.is_valid'] = apiData['trestle.email.is_valid'] ?? null;

  // B. Identity (all verticals)
  fields['phone.name_match'] = apiData['trestle.phone.name_match'] ?? null;
  fields['email.name_match'] = apiData['trestle.email.name_match'] ?? null;
  fields['address.name_match'] = apiData['trestle.address.name_match'] ?? null;
  fields['owner_name'] = apiData['_batchdata.owner_name'] ?? null;

  // C. Property (all verticals)
  fields['owner_occupied'] = apiData['batchdata.owner_occupied'] ?? null;
  fields['property_type'] = apiData['batchdata.property_type'] ?? null;
  fields['free_and_clear'] = apiData['batchdata.free_and_clear'] ?? null;
  fields['high_equity'] = apiData['batchdata.high_equity'] ?? null;
  fields['address.is_valid'] = apiData['trestle.address.is_valid'] ?? null;

  // Vertical-specific property fields
  if (vertical === 'solar') {
    fields['email.is_deliverable'] = apiData['trestle.email.is_deliverable'] ?? null;
    fields['solar_permit'] = apiData['batchdata.solar_permit'] ?? null;
  } else if (vertical === 'roofing') {
    fields['roof_permit'] = apiData['batchdata.roof_permit'] ?? null;
    fields['year_built'] = apiData['batchdata.year_built'] ?? null;
  }
  // else if (vertical === 'windows') {
  //   fields['email.is_deliverable'] = apiData['trestle.email.is_deliverable'] ?? null;
  //   fields['year_built'] = apiData['batchdata.year_built'] ?? null;
  // }

  // D. Financial (will be null after FullContact dropped — LLM treats null as neutral)
  fields['household_income'] = apiData['fullcontact.household_income'] ?? null;
  fields['living_status'] = apiData['fullcontact.living_status'] ?? null;

  // E. Form behavior (all verticals)
  fields['form_input_method'] = apiData['trustedform.form_input_method'] ?? null;
  fields['bot_detected'] = apiData['trustedform.bot_detected'] ?? null;
  fields['confirmed_owner'] = apiData['trustedform.confirmed_owner'] ?? null;
  fields['age_seconds'] = apiData['trustedform.age_seconds'] ?? null;

  return fields;
}

// ════════════════════════════════════════════════════════════════════
// LLM SCORING — Call Anthropic Sonnet
// ════════════════════════════════════════════════════════════════════

/**
 * Score a lead using Anthropic Sonnet with the locked v4 prompt.
 *
 * @param {object} apiData - Merged flat map of all API response fields
 * @param {string} vertical - 'solar' | 'roofing'
 * @param {string} leadName - Lead's name (for identity comparison in prompt)
 * @returns {object} { tier, score, confidence, reasons, concerns }
 */
export async function scoreLead(apiData, vertical, leadName) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY not configured');
  }

  const prompt = getPromptForVertical(vertical);
  const fields = prepareFieldsForLLM(apiData, vertical);

  const userMessage = leadName
    ? `Score this lead (name: ${leadName}):\n${JSON.stringify(fields, null, 2)}`
    : `Score this lead:\n${JSON.stringify(fields, null, 2)}`;

  const response = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 512,
      temperature: 0,
      system: prompt,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`Anthropic API ${response.status}: ${errBody}`);
  }

  const data = await response.json();
  const text = data.content[0].text;

  // Parse JSON — handle both raw JSON and code-block wrapped responses
  let jsonStr = text;
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) jsonStr = codeBlockMatch[1];
  jsonStr = jsonStr.trim();

  // Parse — response may be an array (batch mode) or single object
  const parsed = JSON.parse(jsonStr);
  const result = Array.isArray(parsed) ? parsed[0] : parsed;

  return {
    tier: result.tier || 'Bronze',
    score: result.score ?? 30,
    confidence: result.confidence || 'medium',
    reasons: result.reasons || [],
    concerns: result.concerns || [],
    llm_usage: {
      input_tokens: data.usage?.input_tokens || 0,
      output_tokens: data.usage?.output_tokens || 0,
    },
  };
}
