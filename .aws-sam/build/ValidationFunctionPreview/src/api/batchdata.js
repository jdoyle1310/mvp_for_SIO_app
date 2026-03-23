/**
 * BatchData Property API client — Full Core Property extraction.
 *
 * Endpoint: POST https://api.batchdata.com/api/v1/property/lookup/all-attributes
 * Auth: Bearer token
 *
 * Captures EVERY data point from the response for correlation analysis.
 */

import { API_ENDPOINTS } from '../utils/constants.js';

/**
 * Call BatchData Property API.
 */
export async function callBatchData(contact, signal) {
  const apiKey = process.env.BATCHDATA_API_KEY;
  if (!apiKey || apiKey === 'PLACEHOLDER_API_KEY') {
    return createNullResponse();
  }

  const body = {
    requests: [{
      address: {
        street: contact.address || '',
        city: contact.city || '',
        state: contact.state || '',
        zip: contact.zip || '',
      },
    }],
  };

  const response = await fetch(API_ENDPOINTS.BATCHDATA, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    console.error(`BatchData API error: ${response.status} ${response.statusText}`);
    return createNullResponse();
  }

  const data = await response.json();
  return extractFields(data);
}

/**
 * Extract ALL available fields from BatchData Core Property response.
 * Captures every data point for correlation analysis.
 */
function extractFields(data) {
  const property = data?.results?.properties?.[0] || {};
  const quickLists = property?.quickLists || {};
  const listing = property?.listing || {};
  const building = property?.building || {};
  const general = property?.general || {};
  const valuation = property?.valuation || {};
  const ownerProfile = property?.propertyOwnerProfile || {};
  const permit = property?.permit || {};
  const permitTags = permit?.tags || {};
  const demographics = property?.demographics || {};
  const intel = property?.intel || {};
  const address = property?.address || {};
  const openLien = property?.openLien || {};
  const foreclosure = property?.foreclosure || {};
  const owner = property?.owner || {};

  // ── Owner occupied ──
  let ownerOccupied = null;
  if (quickLists.ownerOccupied === true) {
    ownerOccupied = 'confirmed_owner';
  } else if (quickLists.ownerOccupied === false) {
    if (quickLists.absenteeOwner === true) {
      ownerOccupied = 'confirmed_renter';
    } else {
      ownerOccupied = 'probable_renter';
    }
  }

  // ── Property type ──
  // Map general.propertyTypeCategory to scoring categories.
  // API returns: "Single Family Residential", "Townhouse", "Condominium",
  //   "Multi-Family", "Mobile/Manufactured", "Office", "Industrial", etc.
  // Fallback to corporateOwned flag if general section unavailable.
  const propertyType = normalizePropertyType(general.propertyTypeCategory, quickLists.corporateOwned);

  return {
    // ════════════════════════════════════════════════════
    // QUICK LISTS — Boolean flags (38 fields)
    // ════════════════════════════════════════════════════
    'batchdata.owner_occupied': ownerOccupied,
    'batchdata.property_type': propertyType,
    'batchdata.free_and_clear': quickLists.freeAndClear ?? null,
    'batchdata.high_equity': quickLists.highEquity ?? null,
    'batchdata.low_equity': quickLists.lowEquity ?? null,
    'batchdata.tax_lien': quickLists.taxDefault ?? null,
    'batchdata.pre_foreclosure': quickLists.preforeclosure ?? null,
    'batchdata.cash_buyer': quickLists.cashBuyer ?? null,
    'batchdata.senior_owner': quickLists.seniorOwner ?? null,
    'batchdata.corporate_owned': quickLists.corporateOwned ?? null,
    'batchdata.absentee_owner': quickLists.absenteeOwner ?? null,
    'batchdata.absentee_in_state': quickLists.absenteeOwnerInState ?? null,
    'batchdata.absentee_out_of_state': quickLists.absenteeOwnerOutOfState ?? null,
    'batchdata.inherited': quickLists.inherited ?? null,
    'batchdata.fix_and_flip': quickLists.fixAndFlip ?? null,
    'batchdata.active_listing': quickLists.activeListing ?? null,
    'batchdata.active_auction': quickLists.activeAuction ?? null,
    'batchdata.expired_listing': quickLists.expiredListing ?? null,
    'batchdata.failed_listing': quickLists.failedListing ?? null,
    'batchdata.pending_listing': quickLists.pendingListing ?? null,
    'batchdata.on_market': quickLists.onMarket ?? null,
    'batchdata.for_sale_by_owner': quickLists.forSaleByOwner ?? null,
    'batchdata.listed_below_market': quickLists.listedBelowMarketPrice ?? null,
    'batchdata.involuntary_lien': quickLists.involuntaryLien ?? null,
    'batchdata.mailing_vacant': quickLists.mailingAddressVacant ?? null,

    // ════════════════════════════════════════════════════
    // LISTING — Property characteristics
    // ════════════════════════════════════════════════════
    'batchdata.year_built': listing.yearBuilt ?? building.yearBuilt ?? ownerProfile.averageYearBuilt ?? null,
    'batchdata.bedrooms': listing.bedroomCount ?? null,
    'batchdata.bathrooms': listing.bathroomCount ?? null,
    'batchdata.sq_ft': listing.livingAreaSquareFeet ?? null,
    'batchdata.lot_size_sqft': listing.lotSizeSquareFeet ?? null,
    'batchdata.listing_status': listing.status ?? null,
    'batchdata.listing_status_category': listing.statusCategory ?? null,
    'batchdata.listing_rental': listing.rental ?? null,
    'batchdata.listing_original_date': listing.originalListingDate ?? null,
    'batchdata.listing_sold_price': listing.soldPrice ?? null,
    'batchdata.listing_sold_date': listing.soldDate ?? null,
    'batchdata.listing_failed_date': listing.failedListingDate ?? null,

    // ════════════════════════════════════════════════════
    // VALUATION — AVM and equity
    // ════════════════════════════════════════════════════
    'batchdata.estimated_value': valuation.estimatedValue ?? null,
    'batchdata.value_range_min': valuation.priceRangeMin ?? null,
    'batchdata.value_range_max': valuation.priceRangeMax ?? null,
    'batchdata.valuation_confidence': valuation.confidenceScore ?? null,
    'batchdata.equity_current': valuation.equityCurrentEstimatedBalance ?? null,
    'batchdata.equity_percent': valuation.equityPercent ?? null,
    'batchdata.ltv': valuation.ltv ?? null,

    // ════════════════════════════════════════════════════
    // PROPERTY OWNER PROFILE
    // ════════════════════════════════════════════════════
    'batchdata.assessed_value': ownerProfile.averageAssessedValue ?? null,
    'batchdata.avg_purchase_price': ownerProfile.averagePurchasePrice ?? null,
    'batchdata.properties_count': ownerProfile.propertiesCount ?? null,
    'batchdata.total_equity': ownerProfile.propertiesTotalEquity ?? null,
    'batchdata.total_estimated_value': ownerProfile.propertiesTotalEstimatedValue ?? null,
    'batchdata.total_purchase_price': ownerProfile.totalPurchasePrice ?? null,
    'batchdata.mortgages_count': ownerProfile.mortgagesCount ?? null,
    'batchdata.mortgages_total_balance': ownerProfile.mortgagesTotalBalance ?? null,
    'batchdata.mortgages_avg_balance': ownerProfile.mortgagesAverageBalance ?? null,

    // ════════════════════════════════════════════════════
    // PERMIT DATA — Critical for solar/roofing detection
    // ════════════════════════════════════════════════════
    'batchdata.solar_permit': permitTags.solar ?? null,
    'batchdata.roof_permit': permitTags.roofing ?? null,
    'batchdata.hvac_permit': permitTags.hvac ?? null,
    'batchdata.electrical_permit': permitTags.electrical ?? null,
    'batchdata.addition_permit': permitTags.addition ?? null,
    'batchdata.new_construction': permitTags.newConstruction ?? null,
    'batchdata.ev_charger': permitTags.evCharger ?? null,
    'batchdata.battery_permit': permitTags.battery ?? null,
    'batchdata.heat_pump': permitTags.heatPump ?? null,
    'batchdata.permit_count': permit.permitCount ?? null,
    'batchdata.permit_earliest': permit.earliestDate ?? null,
    'batchdata.permit_latest': permit.latestDate ?? null,
    'batchdata.permit_total_value': permit.totalJobValue ?? null,
    'batchdata.permit_all_tags': permit.allTags ?? null,

    // ════════════════════════════════════════════════════
    // DEMOGRAPHICS (BatchData's own, separate from FullContact)
    // ════════════════════════════════════════════════════
    'batchdata.bd_income': demographics.income ?? null,
    'batchdata.bd_net_worth': demographics.netWorth ?? null,
    'batchdata.bd_discretionary_income': demographics.discretionaryIncome ?? null,
    'batchdata.bd_age': demographics.age ?? null,
    'batchdata.bd_gender': demographics.gender ?? null,
    'batchdata.bd_homeowner': demographics.homeownerRenter ?? null,
    'batchdata.bd_household_size': demographics.householdSize ?? null,
    'batchdata.bd_marital_status': demographics.maritalStatus ?? null,
    'batchdata.bd_education': demographics.individualEducation ?? null,
    'batchdata.bd_occupation': demographics.individualOccupation ?? null,
    'batchdata.bd_pet_owner': demographics.petOwner ?? null,
    'batchdata.bd_investments': demographics.investments ?? null,

    // ════════════════════════════════════════════════════
    // INTEL — Sale propensity scoring
    // ════════════════════════════════════════════════════
    'batchdata.sale_propensity': intel.salePropensity ?? null,
    'batchdata.sale_propensity_category': intel.salePropensityCategory ?? null,

    // ════════════════════════════════════════════════════
    // OPEN LIENS
    // ════════════════════════════════════════════════════
    'batchdata.open_lien_count': openLien.totalOpenLienCount ?? null,
    'batchdata.open_lien_balance': openLien.totalOpenLienBalance ?? null,
    'batchdata.lien_types': openLien.allLoanTypes ?? null,

    // ════════════════════════════════════════════════════
    // ADDRESS
    // ════════════════════════════════════════════════════
    'batchdata.county': address.county ?? null,
    'batchdata.address_valid': address.addressValidity ?? null,
    'batchdata.latitude': address.latitude ?? null,
    'batchdata.longitude': address.longitude ?? null,

    // ════════════════════════════════════════════════════
    // FORECLOSURE
    // ════════════════════════════════════════════════════
    'batchdata.has_foreclosure': Object.keys(foreclosure).length > 0 ? true : null,

    // ════════════════════════════════════════════════════
    // OWNER NAME — Used by LLM for identity cross-reference
    // ════════════════════════════════════════════════════
    '_batchdata.owner_name': extractOwnerName(owner),
  };
}

/**
 * Normalize BatchData propertyTypeCategory to scoring categories.
 *
 * API returns values like: "Single Family Residential", "Townhouse",
 * "Condominium", "Multi-Family", "Mobile/Manufactured", "Office",
 * "Industrial", "Retail", "Commercial Office", etc.
 *
 * Maps to config scoring categories:
 *   Single Family Residential, Townhouse, Condominium,
 *   Multi-Family, Mobile/Manufactured, Commercial
 */
function normalizePropertyType(category, corporateOwned) {
  if (!category) {
    // Fallback: if no category but corporateOwned flag is set
    return corporateOwned === true ? 'Commercial' : null;
  }

  const lower = category.toLowerCase();

  if (lower.includes('single family')) return 'Single Family Residential';
  if (lower.includes('townhouse') || lower.includes('town house')) return 'Townhouse';
  if (lower.includes('condo')) return 'Condominium';
  if (lower.includes('multi-family') || lower.includes('multi family') || lower.includes('duplex') || lower.includes('triplex')) return 'Multi-Family';
  if (lower.includes('mobile') || lower.includes('manufactured')) return 'Mobile/Manufactured';
  if (lower.includes('commercial') || lower.includes('office') || lower.includes('industrial') || lower.includes('retail') || lower.includes('warehouse')) return 'Commercial';

  // Unknown type — return raw value for logging, LLM can interpret
  return category;
}

/**
 * Extract owner name from BatchData owner object.
 * Tries multiple paths since BatchData response structure varies.
 */
function extractOwnerName(owner) {
  if (!owner) return null;

  // Try owner.names array (most common)
  if (owner.names && Array.isArray(owner.names) && owner.names.length > 0) {
    const name = owner.names[0];
    if (name.fullName) return name.fullName;
    const parts = [name.firstName, name.lastName].filter(Boolean);
    if (parts.length > 0) return parts.join(' ');
  }

  // Try direct name fields
  if (owner.fullName) return owner.fullName;
  if (owner.name) return owner.name;

  // Try firstName + lastName
  const parts = [owner.firstName, owner.lastName].filter(Boolean);
  if (parts.length > 0) return parts.join(' ');

  return null;
}

/**
 * Return null fields when API is unavailable.
 */
function createNullResponse() {
  return {
    'batchdata.owner_occupied': null, 'batchdata.property_type': null,
    'batchdata.free_and_clear': null, 'batchdata.high_equity': null,
    'batchdata.low_equity': null, 'batchdata.tax_lien': null,
    'batchdata.pre_foreclosure': null, 'batchdata.cash_buyer': null,
    'batchdata.senior_owner': null, 'batchdata.corporate_owned': null,
    'batchdata.absentee_owner': null, 'batchdata.absentee_in_state': null,
    'batchdata.absentee_out_of_state': null, 'batchdata.inherited': null,
    'batchdata.fix_and_flip': null, 'batchdata.active_listing': null,
    'batchdata.active_auction': null, 'batchdata.expired_listing': null,
    'batchdata.failed_listing': null, 'batchdata.pending_listing': null,
    'batchdata.on_market': null, 'batchdata.for_sale_by_owner': null,
    'batchdata.listed_below_market': null, 'batchdata.involuntary_lien': null,
    'batchdata.mailing_vacant': null,
    'batchdata.year_built': null, 'batchdata.bedrooms': null,
    'batchdata.bathrooms': null, 'batchdata.sq_ft': null,
    'batchdata.lot_size_sqft': null, 'batchdata.listing_status': null,
    'batchdata.listing_status_category': null, 'batchdata.listing_rental': null,
    'batchdata.listing_original_date': null, 'batchdata.listing_sold_price': null,
    'batchdata.listing_sold_date': null, 'batchdata.listing_failed_date': null,
    'batchdata.estimated_value': null, 'batchdata.value_range_min': null,
    'batchdata.value_range_max': null, 'batchdata.valuation_confidence': null,
    'batchdata.equity_current': null, 'batchdata.equity_percent': null,
    'batchdata.ltv': null,
    'batchdata.assessed_value': null, 'batchdata.avg_purchase_price': null,
    'batchdata.properties_count': null, 'batchdata.total_equity': null,
    'batchdata.total_estimated_value': null, 'batchdata.total_purchase_price': null,
    'batchdata.mortgages_count': null, 'batchdata.mortgages_total_balance': null,
    'batchdata.mortgages_avg_balance': null,
    'batchdata.solar_permit': null, 'batchdata.roof_permit': null,
    'batchdata.hvac_permit': null, 'batchdata.electrical_permit': null,
    'batchdata.addition_permit': null, 'batchdata.new_construction': null,
    'batchdata.ev_charger': null, 'batchdata.battery_permit': null,
    'batchdata.heat_pump': null, 'batchdata.permit_count': null,
    'batchdata.permit_earliest': null, 'batchdata.permit_latest': null,
    'batchdata.permit_total_value': null, 'batchdata.permit_all_tags': null,
    'batchdata.bd_income': null, 'batchdata.bd_net_worth': null,
    'batchdata.bd_discretionary_income': null, 'batchdata.bd_age': null,
    'batchdata.bd_gender': null, 'batchdata.bd_homeowner': null,
    'batchdata.bd_household_size': null, 'batchdata.bd_marital_status': null,
    'batchdata.bd_education': null, 'batchdata.bd_occupation': null,
    'batchdata.bd_pet_owner': null, 'batchdata.bd_investments': null,
    'batchdata.sale_propensity': null, 'batchdata.sale_propensity_category': null,
    'batchdata.open_lien_count': null, 'batchdata.open_lien_balance': null,
    'batchdata.lien_types': null,
    'batchdata.county': null, 'batchdata.address_valid': null,
    'batchdata.latitude': null, 'batchdata.longitude': null,
    'batchdata.has_foreclosure': null,
    '_batchdata.owner_name': null,
  };
}
