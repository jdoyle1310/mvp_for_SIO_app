/**
 * Buyer routing with shadow mode support.
 *
 * Shadow mode: New verticals (HVAC, siding, etc.) get scored and logged
 * but return HOLD instead of POST. This lets us collect real scoring data
 * without affecting live traffic until dispo data validates the prompts.
 *
 * Future implementation will:
 * - Query DynamoDB buyers table for buyers matching this vertical + tier
 * - Check buyer daily caps
 * - Apply buyer preferences (state filters, property type preferences)
 * - Return matched buyer with endpoint URL and agreed CPL
 */

import { DECISIONS, TIERS } from './utils/constants.js';

/**
 * Route a scored lead to a buyer.
 *
 * @param {string} vertical - Lead vertical
 * @param {string} tier - Assigned tier (Gold/Silver/Bronze/Reject)
 * @param {number} score - Composite score 0-100
 * @param {object} lead - Original lead data
 * @param {object} config - Vertical config (from loadConfig)
 * @returns {{ decision: string, routing: object }}
 */
export async function routeLead(vertical, tier, score, lead, config = {}) {
  const nullRouting = {
    buyer_id: null,
    buyer_name: null,
    endpoint_url: null,
    cpl: null,
  };

  // Reject tier leads always get rejected
  if (tier === TIERS.REJECT) {
    return { decision: DECISIONS.REJECT, routing: nullRouting };
  }

  // Shadow mode: score + log but don't route to buyers
  // Unvalidated verticals return HOLD until dispo data confirms prompt accuracy
  if (config.shadow_mode) {
    return { decision: DECISIONS.HOLD, routing: nullRouting };
  }

  // Direct buyers: only Gold until Silver performance improves (stub routing — no DynamoDB match yet)
  if (config.direct_buyers_gold_only === true && tier === TIERS.SILVER) {
    return { decision: DECISIONS.HOLD, routing: nullRouting };
  }

  // STUB: For now, all non-reject, non-shadow leads get "post" decision
  // Real implementation will query buyer table and match
  return { decision: DECISIONS.POST, routing: nullRouting };
}
