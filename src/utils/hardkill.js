/**
 * Hard-kill evaluator.
 *
 * Reads hard_kill rules from vertical config and checks API response data.
 * If ANY hard-kill condition fires, the lead is immediately rejected.
 *
 * Hard-kill rules come in two categories:
 * - universal: apply to all verticals (commercial property)
 * - vertical_specific: only apply to certain verticals (renter for solar/roofing/windows,
 *   mobile/manufactured home, etc.)
 *
 * Additionally, field_scores can contain "HARD_KILL" as a points value,
 * which is detected during scoring and triggers a hard kill.
 *
 * NOTE: Phone/email/bot hard kills were removed — eHawk handles those upstream.
 * Our hard kills only cover property-based issues eHawk can't detect.
 */

import { HARD_KILL_SENTINEL } from './constants.js';

/**
 * Evaluate hard-kill conditions against API data.
 *
 * @param {object} apiData - Merged API response fields (flat key-value map)
 * @param {object} config - Vertical config object
 * @returns {{ hardKill: boolean, reason: string|null }}
 */
export function evaluateHardKills(apiData, config) {
  const hardKills = config.hard_kills || {};
  const universal = hardKills.universal || {};
  const verticalSpecific = hardKills.vertical_specific || {};

  // Check universal hard-kill rules
  const universalResult = checkUniversalRules(apiData, universal);
  if (universalResult) {
    return { hardKill: true, reason: universalResult };
  }

  // Check vertical-specific hard-kill rules
  const verticalResult = checkVerticalSpecificRules(apiData, verticalSpecific);
  if (verticalResult) {
    return { hardKill: true, reason: verticalResult };
  }

  return { hardKill: false, reason: null };
}

/**
 * Check universal hard-kill rules.
 *
 * v5.2: Added data-validated hard kills based on 299-lead backtest (April 2026).
 * Each rule validated at 92-100% accuracy across 5 buyers.
 *
 * NOTE: Commercial property type was downgraded from hard kill to -80 penalty
 * in all configs (2026-03-11). BatchData's corporateOwned flag is unreliable —
 * it misclassifies mixed-use, multi-parcel, and some single-family properties.
 */
function checkUniversalRules(apiData, rules) {
  // v5.2: FixedVOIP — 0% win rate on 5 leads, 100% accuracy.
  // These are call center / auto-dialer numbers that never connect.
  const phoneLineType = apiData['trestle.phone.line_type'];
  if (phoneLineType === 'FixedVOIP') {
    return 'FIXED_VOIP';
  }

  // v5.2: Email name mismatch — 4% win rate on 25 leads, 96% accuracy.
  // When the email doesn't match the lead's name, it's almost always
  // bad data, a fake submission, or a different person entirely.
  const emailNameMatch = apiData['trestle.email.name_match'];
  if (emailNameMatch === 'false') {
    return 'EMAIL_NAME_MISMATCH';
  }

  // v5.2: Empty form input — 0% win rate on 5 leads, 100% accuracy.
  // No typing, no autofill, no paste — bot or accidental submission.
  const formInput = apiData['trustedform.form_input_method'];
  if (formInput === 'empty') {
    return 'EMPTY_FORM_INPUT';
  }

  return null;
}

/**
 * Check vertical-specific hard-kill rules.
 */
function checkVerticalSpecificRules(apiData, rules) {
  // Confirmed renter (hard kill for solar/roofing/windows)
  // OVERRIDE: If BatchData also reports free_and_clear=true or high_equity=true,
  // the renter classification is likely wrong (contradictory property signals).
  // In that case, skip hard kill — let the -100 penalty in scoring handle it.
  if (rules.batchdata_renter_confirmed) {
    const ownership = apiData['batchdata.owner_occupied'];
    if (ownership === 'confirmed_renter') {
      const freeAndClear = apiData['batchdata.free_and_clear'];
      const highEquity = apiData['batchdata.high_equity'];
      const hasOwnershipSignals = freeAndClear === true || highEquity === true;
      if (!hasOwnershipSignals) {
        return 'RENTER_CONFIRMED';
      }
      // Contradictory signals — skip hard kill, let scoring penalize heavily
    }
  }

  // Mobile/manufactured home (hard kill for solar/roofing/windows)
  if (rules.batchdata_mobile_manufactured) {
    const propType = apiData['batchdata.property_type'];
    if (propType === 'Mobile/Manufactured') {
      return 'MOBILE_MANUFACTURED_HOME';
    }
  }

  // v5.2: Solar permit = already has solar (solar vertical only)
  // 0% win rate on 3 leads, 100% accuracy. Configured per-vertical in config JSON.
  if (rules.batchdata_solar_permit) {
    const solarPermit = apiData['batchdata.solar_permit'];
    if (solarPermit === true) {
      return 'HAS_SOLAR_PERMIT';
    }
  }

  return null;
}

/**
 * Check if a field score value is a hard-kill sentinel.
 * Used during scoring when a field_score config has "HARD_KILL" as its points value.
 *
 * @param {any} points - The points value from config
 * @returns {boolean}
 */
export function isHardKillValue(points) {
  return points === HARD_KILL_SENTINEL;
}
