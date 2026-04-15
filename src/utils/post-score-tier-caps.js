/**
 * Post-score tier caps — deterministic Bronze overrides after LLM (or timeout fast path).
 * Duplicated list (keep in sync with llm-scorer.js HOME_SERVICES_VERTICALS) to avoid circular imports.
 */
const HOME_SERVICES_VERTICALS = [
  'solar', 'roofing', 'windows', 'hvac', 'siding', 'gutters',
  'painting', 'plumbing', 'bathroom_remodel', 'kitchen_remodel', 'flooring',
];

const RENTER_CAP_VERTICALS = new Set(HOME_SERVICES_VERTICALS);

const GRADE_POOR = new Set(['C', 'D', 'F']);
const LINE_LANDLINE_VOIP = new Set(['Landline', 'FixedVOIP']);

/**
 * Apply four validated post-score caps. Only tightens Gold/Silver → Bronze.
 *
 * @param {object} apiData - Flat merged enrichment map (trestle.*, batchdata.*)
 * @param {string} tier - Current tier
 * @param {number} score - Current score
 * @param {string} leadVertical - Lead vertical
 * @returns {{ tier: string, score: number, capsTriggered: string[] }}
 */
export function applyPostScoreTierCaps(apiData, tier, score, leadVertical) {
  const capsTriggered = [];

  if (tier !== 'Gold' && tier !== 'Silver') {
    return { tier, score, capsTriggered };
  }

  let outTier = tier;
  let outScore = score;

  const ownerOccupied = apiData['batchdata.owner_occupied'] ?? null;
  const phoneNameMatch = apiData['trestle.phone.name_match'] ?? null;
  const addrNameMatch = apiData['trestle.address.name_match'] ?? null;
  const addrValid = apiData['trestle.address.is_valid'] ?? null;
  const phoneGrade = apiData['trestle.phone.contact_grade'] ?? null;
  const phoneType = apiData['trestle.phone.line_type'] ?? null;

  // RULE 1: Confirmed renter → Bronze (home services only; not mortgage/insurance)
  if (RENTER_CAP_VERTICALS.has(leadVertical) && ownerOccupied === 'confirmed_renter') {
    outTier = 'Bronze';
    outScore = Math.min(outScore, 44);
    capsTriggered.push('RENTER_CAP');
  }

  // RULE 2: Double name mismatch (explicit false only)
  if (phoneNameMatch === 'false' && addrNameMatch === 'false') {
    outTier = 'Bronze';
    outScore = Math.min(outScore, 44);
    capsTriggered.push('DOUBLE_NAME_MISMATCH');
  }

  // RULE 3: Invalid address + not confirmed owner (NULL owner fails)
  if (addrValid === 'false' && ownerOccupied !== 'confirmed_owner') {
    outTier = 'Bronze';
    outScore = Math.min(outScore, 44);
    capsTriggered.push('INVALID_ADDR_UNVERIFIED_OWNER');
  }

  // RULE 4: Poor phone grade + landline/FixedVOIP (both must be present)
  if (
    phoneGrade != null &&
    phoneType != null &&
    GRADE_POOR.has(phoneGrade) &&
    LINE_LANDLINE_VOIP.has(phoneType)
  ) {
    outTier = 'Bronze';
    outScore = Math.min(outScore, 44);
    capsTriggered.push('GRADE_C_LANDLINE_VOIP');
  }

  // RULE 5 (v5.2): Email name mismatch → Bronze cap (backup for hard kill)
  // 96% accuracy on 25 leads — 24 losses caught, 1 false positive.
  const emailNameMatch = apiData['trestle.email.name_match'] ?? null;
  if (emailNameMatch === 'false') {
    outTier = 'Bronze';
    outScore = Math.min(outScore, 44);
    capsTriggered.push('EMAIL_NAME_MISMATCH');
  }

  return { tier: outTier, score: outScore, capsTriggered };
}

/**
 * Audit log when caps fire (call from handler with lead context).
 */
export function logTierCapsAudit(capsTriggered, originalTier, newTier, score, lead) {
  if (!capsTriggered.length) return;
  const fn = lead?.contact?.first_name ?? '';
  const ln = lead?.contact?.last_name ?? '';
  console.log(
    `TIER_CAP: ${capsTriggered.join(', ')} | ${originalTier} → ${newTier} | score: ${score} | lead: ${fn} ${ln}`.trim(),
  );
}
