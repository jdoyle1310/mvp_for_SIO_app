/**
 * Trestle Real Contact API client.
 *
 * Endpoint: GET https://api.trestleiq.com/1.1/real_contact
 * Auth: x-api-key header
 * Add-ons: litigator_checks only (email_checks_deliverability + email_checks_age dropped — eHawk covers)
 * COST: $0.035/call (was $0.045 with 3 add-ons)
 *
 * Returns normalized fields for scoring.
 */

import { API_ENDPOINTS, API_TIMEOUT_MS } from '../utils/constants.js';

/**
 * Call Trestle Real Contact API.
 *
 * @param {object} contact - Lead contact info { first_name, last_name, email, phone, address, city, state, zip }
 * @param {string} phone - E.164 normalized phone
 * @param {AbortSignal} signal - AbortController signal for cancellation
 * @returns {object} Normalized Trestle response fields
 */
export async function callTrestle(contact, phone, signal) {
  const apiKey = process.env.TRESTLE_API_KEY;
  if (!apiKey || apiKey === 'PLACEHOLDER_API_KEY') {
    return createNullResponse();
  }

  const params = new URLSearchParams({
    phone: phone.replace('+1', '').replace('+', ''),
    email: contact.email || '',
    name: `${contact.first_name || ''} ${contact.last_name || ''}`.trim(),
    'address.street_line_1': contact.address || '',
    'address.city': contact.city || '',
    'address.state_code': contact.state || '',
    'address.postal_code': contact.zip || '',
    add_ons: 'litigator_checks',
  });

  const url = `${API_ENDPOINTS.TRESTLE}?${params.toString()}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'x-api-key': apiKey,
      'Accept': 'application/json',
    },
    signal,
  });

  if (!response.ok) {
    console.error(`Trestle API error: ${response.status} ${response.statusText}`);
    return createNullResponse();
  }

  const data = await response.json();
  return extractFields(data);
}

/**
 * Extract and normalize fields from Trestle v1.1 response.
 *
 * Response uses flat dot-notation keys at top level:
 *   "phone.contact_grade", "phone.activity_score", "phone.linetype", etc.
 * Add-ons are nested under data.add_ons:
 *   data.add_ons.email_checks: { "email.is_deliverable", "email.age_score" }
 *   data.add_ons.litigator_checks: { "phone.is_litigator_risk" }
 *
 * Verified fields against actual API response 2026-03-11:
 *   phone.is_valid, phone.contact_grade, phone.activity_score, phone.linetype,
 *   phone.name_match, email.is_valid, email.name_match, email.contact_grade,
 *   address.is_valid, address.name_match, warnings[]
 *   add_ons.email_checks: email.is_deliverable, email.age_score
 *   add_ons.litigator_checks: phone.is_litigator_risk
 */
function extractFields(data) {
  const addOns = data?.add_ons || {};
  const emailChecks = addOns?.email_checks || {};
  const litigatorChecks = addOns?.litigator_checks || {};

  // Litigator risk from add_ons
  const isLitigatorRisk = litigatorChecks?.['phone.is_litigator_risk'] ?? null;

  // Email deliverability + age from add_ons
  const emailIsDeliverable = emailChecks?.['email.is_deliverable'] ?? null;
  const emailAgeScore = emailChecks?.['email.age_score'] ?? null;

  // Warnings array — check for "Free Email Service Provider"
  const warnings = data?.warnings || [];
  const isFreeEmail = warnings.some(w =>
    typeof w === 'string' && w.toLowerCase().includes('free email')
  );

  return {
    // ── Phone fields (contactability) ──
    'trestle.phone.is_valid': data['phone.is_valid'] != null ? String(data['phone.is_valid']) : null,
    'trestle.phone.contact_grade': data['phone.contact_grade'] ?? null,
    'trestle.phone.activity_score': data['phone.activity_score'] ?? null,
    'trestle.phone.line_type': data['phone.linetype'] ?? null,
    'trestle.phone.name_match': data['phone.name_match'] != null ? String(data['phone.name_match']) : null,

    // ── Email fields (identity + contactability) ──
    'trestle.email.is_valid': data['email.is_valid'] != null ? String(data['email.is_valid']) : null,
    'trestle.email.name_match': data['email.name_match'] != null ? String(data['email.name_match']) : null,
    'trestle.email.contact_grade': data['email.contact_grade'] ?? null,
    'trestle.email.is_deliverable': emailIsDeliverable != null ? String(emailIsDeliverable) : null,
    '_trestle.email.age_score': emailAgeScore,
    '_trestle.email.is_free_provider': isFreeEmail ? 'true' : 'false',

    // ── Address fields (identity) ──
    'trestle.address.is_valid': data['address.is_valid'] != null ? String(data['address.is_valid']) : null,
    'trestle.address.name_match': data['address.name_match'] != null ? String(data['address.name_match']) : null,

    // ── Risk fields (fraud_legal) ──
    'trestle.litigator_risk': isLitigatorRisk != null ? String(isLitigatorRisk) : null,
  };
}

/**
 * Return null fields when API is unavailable.
 */
function createNullResponse() {
  return {
    'trestle.phone.is_valid': null,
    'trestle.phone.contact_grade': null,
    'trestle.phone.activity_score': null,
    'trestle.phone.line_type': null,
    'trestle.phone.name_match': null,
    'trestle.email.is_valid': null,
    'trestle.email.name_match': null,
    'trestle.email.contact_grade': null,
    'trestle.email.is_deliverable': null,
    '_trestle.email.age_score': null,
    '_trestle.email.is_free_provider': null,
    'trestle.address.is_valid': null,
    'trestle.address.name_match': null,
    'trestle.litigator_risk': null,
  };
}
