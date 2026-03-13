/**
 * Buyer routing — STUB.
 *
 * This is a pass-through stub. Real buyer matching comes later.
 * For now, returns the tier and score without routing to a specific buyer.
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
 * @returns {{ decision: string, routing: object }}
 */
export async function routeLead(vertical, tier, score, lead) {
  // Reject tier leads always get rejected
  if (tier === TIERS.REJECT) {
    return {
      decision: DECISIONS.REJECT,
      routing: {
        buyer_id: null,
        buyer_name: null,
        endpoint_url: null,
        cpl: null,
      },
    };
  }

  // STUB: For now, all non-reject leads get "post" decision
  // Real implementation will query buyer table and match
  return {
    decision: DECISIONS.POST,
    routing: {
      buyer_id: null,
      buyer_name: null,
      endpoint_url: null,
      cpl: null,
    },
  };
}
