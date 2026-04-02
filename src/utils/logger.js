/**
 * DynamoDB logging + CloudWatch EMF metrics.
 *
 * Every scored lead gets written to greenwatt_score_log table.
 * Every invocation emits CloudWatch Embedded Metric Format (EMF) metrics.
 */

import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { TABLE_NAMES, METRICS_NAMESPACE } from './constants.js';
import { getDocClient, setDocClient } from './dynamo-client.js';

/**
 * Log a scored lead to DynamoDB.
 *
 * @param {object} result - Full scoring result (lead_id, score, tier, enrichment_data, etc.)
 * @param {object} apiPerformance - API response times { trestle: { response_time_ms, success }, ... }
 * @param {object|null} llmResponse - LLM output { confidence, reasons, concerns }
 * @param {object|null} contact - Raw contact object from the lead (address, city, state, zip, name, phone)
 */
export async function logScoredLead(result, apiPerformance, llmResponse = null, contact = null) {
  try {
    const client = getDocClient();
    const now = new Date().toISOString();

    const item = {
      lead_id: result.lead_id,
      scored_at: now,
      vertical: result.vertical || 'unknown',
      score: result.score,
      tier: result.tier,
      decision: result.decision,
      hard_kill: result.hard_kill,
      hard_kill_reason: result.hard_kill_reason || null,
      reason_codes: result.reason_codes || [],
      llm_response: llmResponse || null,
      enrichment_data: result.enrichment_data || null,
      routing: result.routing || {},
      api_performance: apiPerformance || {},
      processing_time_ms: result.processing_time_ms || 0,
      publisher_id: result.publisher_id || null,
      publisher_name: result.publisher_name || null,
      // Raw contact stored for address format analysis and debugging
      contact: contact ? {
        first_name: contact.first_name || null,
        last_name: contact.last_name || null,
        address: contact.address || null,
        city: contact.city || null,
        state: contact.state || null,
        zip: contact.zip || null,
      } : null,
      // TTL: auto-delete after 90 days
      ttl: Math.floor(Date.now() / 1000) + (90 * 24 * 60 * 60),
    };

    await client.send(new PutCommand({
      TableName: TABLE_NAMES.SCORE_LOG,
      Item: item,
    }));
  } catch (err) {
    // Log error but don't crash the Lambda — scoring result is more important than logging
    console.error('Failed to log scored lead to DynamoDB:', err.message);
  }
}

/**
 * Emit CloudWatch EMF metrics.
 *
 * EMF format: JSON object printed to stdout with _aws metadata.
 * CloudWatch agent parses these and creates metrics automatically.
 *
 * @param {object} result - Scoring result
 * @param {object} apiPerformance - API timing data
 */
export function emitMetrics(result, apiPerformance) {
  const vertical = result.vertical || 'unknown';
  const tier = result.tier || 'unknown';

  // Core scoring metrics
  emitEMF({
    LeadScore: result.score || 0,
    ProcessingTime: result.processing_time_ms || 0,
    HardKillTriggered: result.hard_kill ? 1 : 0,
    TierAssignment: 1,
  }, {
    vertical,
    tier,
    hard_kill_reason: result.hard_kill_reason || 'none',
  });

  // API performance metrics (one per API)
  if (apiPerformance) {
    for (const [apiName, perf] of Object.entries(apiPerformance)) {
      emitEMF({
        APIResponseTime: perf.response_time_ms || 0,
        APIError: perf.success ? 0 : 1,
      }, {
        api_name: apiName,
        error_type: perf.error_type || 'none',
      });
    }
  }

  // Pillar score metrics
  if (result.pillar_breakdown) {
    for (const [pillar, data] of Object.entries(result.pillar_breakdown)) {
      emitEMF({
        PillarScore: data.weighted_score || 0,
      }, {
        pillar,
        vertical,
      });
    }
  }
}

/**
 * Emit a single CloudWatch EMF metric log line.
 */
function emitEMF(metrics, dimensions) {
  const emfLog = {
    _aws: {
      Timestamp: Date.now(),
      CloudWatchMetrics: [{
        Namespace: METRICS_NAMESPACE,
        Dimensions: [Object.keys(dimensions)],
        Metrics: Object.keys(metrics).map(name => ({
          Name: name,
          Unit: name.includes('Time') ? 'Milliseconds' : 'None',
        })),
      }],
    },
    ...dimensions,
    ...metrics,
  };

  // EMF logs go to stdout — CloudWatch agent picks them up
  console.log(JSON.stringify(emfLog));
}

/**
 * Build a nested enrichment data object from the merged flat API data map.
 *
 * This is the single source of truth for enrichment data structure — used by
 * both the API response returned to SIO and the DynamoDB audit log.
 *
 * Keyed by provider: { trestle: {...}, batchdata: {...}, trustedform: {...} }
 *
 * @param {object} apiData - Merged flat dot-notation map from all 3 API clients
 * @returns {object} Enrichment data nested by provider
 */
export function buildEnrichmentData(apiData) {
  if (!apiData) return null;

  return {
    // ── Trestle Real Contact (14 fields) ──────────────────────────────────
    trestle: {
      phone_is_valid:        apiData['trestle.phone.is_valid'] ?? null,
      phone_contact_grade:   apiData['trestle.phone.contact_grade'] ?? null,
      phone_activity_score:  apiData['trestle.phone.activity_score'] ?? null,
      phone_line_type:       apiData['trestle.phone.line_type'] ?? null,
      phone_name_match:      apiData['trestle.phone.name_match'] ?? null,
      email_is_valid:        apiData['trestle.email.is_valid'] ?? null,
      email_name_match:      apiData['trestle.email.name_match'] ?? null,
      email_contact_grade:   apiData['trestle.email.contact_grade'] ?? null,
      email_is_deliverable:  apiData['trestle.email.is_deliverable'] ?? null,
      email_age_score:       apiData['_trestle.email.age_score'] ?? null,
      email_is_free_provider: apiData['_trestle.email.is_free_provider'] ?? null,
      address_is_valid:      apiData['trestle.address.is_valid'] ?? null,
      address_name_match:    apiData['trestle.address.name_match'] ?? null,
      litigator_risk:        apiData['trestle.litigator_risk'] ?? null,
    },

    // ── BatchData Property (~80 fields) ───────────────────────────────────
    batchdata: {
      // Ownership & property type
      owner_occupied:           apiData['batchdata.owner_occupied'] ?? null,
      owner_name:               apiData['_batchdata.owner_name'] ?? null,
      property_type:            apiData['batchdata.property_type'] ?? null,

      // Quick list flags
      free_and_clear:           apiData['batchdata.free_and_clear'] ?? null,
      high_equity:              apiData['batchdata.high_equity'] ?? null,
      low_equity:               apiData['batchdata.low_equity'] ?? null,
      tax_lien:                 apiData['batchdata.tax_lien'] ?? null,
      pre_foreclosure:          apiData['batchdata.pre_foreclosure'] ?? null,
      cash_buyer:               apiData['batchdata.cash_buyer'] ?? null,
      senior_owner:             apiData['batchdata.senior_owner'] ?? null,
      corporate_owned:          apiData['batchdata.corporate_owned'] ?? null,
      absentee_owner:           apiData['batchdata.absentee_owner'] ?? null,
      absentee_in_state:        apiData['batchdata.absentee_in_state'] ?? null,
      absentee_out_of_state:    apiData['batchdata.absentee_out_of_state'] ?? null,
      inherited:                apiData['batchdata.inherited'] ?? null,
      fix_and_flip:             apiData['batchdata.fix_and_flip'] ?? null,
      active_listing:           apiData['batchdata.active_listing'] ?? null,
      active_auction:           apiData['batchdata.active_auction'] ?? null,
      expired_listing:          apiData['batchdata.expired_listing'] ?? null,
      failed_listing:           apiData['batchdata.failed_listing'] ?? null,
      pending_listing:          apiData['batchdata.pending_listing'] ?? null,
      on_market:                apiData['batchdata.on_market'] ?? null,
      for_sale_by_owner:        apiData['batchdata.for_sale_by_owner'] ?? null,
      listed_below_market:      apiData['batchdata.listed_below_market'] ?? null,
      involuntary_lien:         apiData['batchdata.involuntary_lien'] ?? null,
      mailing_vacant:           apiData['batchdata.mailing_vacant'] ?? null,

      // Property characteristics
      year_built:               apiData['batchdata.year_built'] ?? null,
      bedrooms:                 apiData['batchdata.bedrooms'] ?? null,
      bathrooms:                apiData['batchdata.bathrooms'] ?? null,
      sq_ft:                    apiData['batchdata.sq_ft'] ?? null,
      lot_size_sqft:            apiData['batchdata.lot_size_sqft'] ?? null,
      listing_status:           apiData['batchdata.listing_status'] ?? null,
      listing_status_category:  apiData['batchdata.listing_status_category'] ?? null,
      listing_rental:           apiData['batchdata.listing_rental'] ?? null,
      listing_original_date:    apiData['batchdata.listing_original_date'] ?? null,
      listing_sold_price:       apiData['batchdata.listing_sold_price'] ?? null,
      listing_sold_date:        apiData['batchdata.listing_sold_date'] ?? null,
      listing_failed_date:      apiData['batchdata.listing_failed_date'] ?? null,

      // Valuation & equity
      estimated_value:          apiData['batchdata.estimated_value'] ?? null,
      value_range_min:          apiData['batchdata.value_range_min'] ?? null,
      value_range_max:          apiData['batchdata.value_range_max'] ?? null,
      valuation_confidence:     apiData['batchdata.valuation_confidence'] ?? null,
      equity_current:           apiData['batchdata.equity_current'] ?? null,
      equity_percent:           apiData['batchdata.equity_percent'] ?? null,
      ltv:                      apiData['batchdata.ltv'] ?? null,

      // Property owner profile
      assessed_value:           apiData['batchdata.assessed_value'] ?? null,
      avg_purchase_price:       apiData['batchdata.avg_purchase_price'] ?? null,
      properties_count:         apiData['batchdata.properties_count'] ?? null,
      total_equity:             apiData['batchdata.total_equity'] ?? null,
      total_estimated_value:    apiData['batchdata.total_estimated_value'] ?? null,
      total_purchase_price:     apiData['batchdata.total_purchase_price'] ?? null,
      mortgages_count:          apiData['batchdata.mortgages_count'] ?? null,
      mortgages_total_balance:  apiData['batchdata.mortgages_total_balance'] ?? null,
      mortgages_avg_balance:    apiData['batchdata.mortgages_avg_balance'] ?? null,

      // Permits
      solar_permit:             apiData['batchdata.solar_permit'] ?? null,
      roof_permit:              apiData['batchdata.roof_permit'] ?? null,
      hvac_permit:              apiData['batchdata.hvac_permit'] ?? null,
      electrical_permit:        apiData['batchdata.electrical_permit'] ?? null,
      addition_permit:          apiData['batchdata.addition_permit'] ?? null,
      new_construction:         apiData['batchdata.new_construction'] ?? null,
      ev_charger:               apiData['batchdata.ev_charger'] ?? null,
      battery_permit:           apiData['batchdata.battery_permit'] ?? null,
      heat_pump:                apiData['batchdata.heat_pump'] ?? null,
      permit_count:             apiData['batchdata.permit_count'] ?? null,
      permit_earliest:          apiData['batchdata.permit_earliest'] ?? null,
      permit_latest:            apiData['batchdata.permit_latest'] ?? null,
      permit_total_value:       apiData['batchdata.permit_total_value'] ?? null,
      permit_all_tags:          apiData['batchdata.permit_all_tags'] ?? null,

      // Demographics
      bd_income:                apiData['batchdata.bd_income'] ?? null,
      bd_net_worth:             apiData['batchdata.bd_net_worth'] ?? null,
      bd_discretionary_income:  apiData['batchdata.bd_discretionary_income'] ?? null,
      bd_age:                   apiData['batchdata.bd_age'] ?? null,
      bd_gender:                apiData['batchdata.bd_gender'] ?? null,
      bd_homeowner:             apiData['batchdata.bd_homeowner'] ?? null,
      bd_household_size:        apiData['batchdata.bd_household_size'] ?? null,
      bd_marital_status:        apiData['batchdata.bd_marital_status'] ?? null,
      bd_education:             apiData['batchdata.bd_education'] ?? null,
      bd_occupation:            apiData['batchdata.bd_occupation'] ?? null,
      bd_pet_owner:             apiData['batchdata.bd_pet_owner'] ?? null,
      bd_investments:           apiData['batchdata.bd_investments'] ?? null,

      // Sale propensity
      sale_propensity:          apiData['batchdata.sale_propensity'] ?? null,
      sale_propensity_category: apiData['batchdata.sale_propensity_category'] ?? null,

      // Open liens
      open_lien_count:          apiData['batchdata.open_lien_count'] ?? null,
      open_lien_balance:        apiData['batchdata.open_lien_balance'] ?? null,
      lien_types:               apiData['batchdata.lien_types'] ?? null,

      // Address
      county:                   apiData['batchdata.county'] ?? null,
      address_valid:            apiData['batchdata.address_valid'] ?? null,
      latitude:                 apiData['batchdata.latitude'] ?? null,
      longitude:                apiData['batchdata.longitude'] ?? null,

      // Foreclosure
      has_foreclosure:          apiData['batchdata.has_foreclosure'] ?? null,
    },

    // ── TrustedForm Insights (3 fields) ───────────────────────────────────
    trustedform: {
      form_input_method: apiData['trustedform.form_input_method'] ?? null,
      age_seconds:       apiData['trustedform.age_seconds'] ?? null,
      confirmed_owner:   apiData['trustedform.confirmed_owner'] ?? null,
    },
  };
}

export { setDocClient };
