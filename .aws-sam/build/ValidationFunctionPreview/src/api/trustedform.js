/**
 * TrustedForm Insights API v4.0 client.
 *
 * Endpoint: POST https://cert.trustedform.com/{cert_id}
 * Auth: Basic (username: "API", password: API_KEY)
 * Headers: Api-Version: 4.0
 *
 * COST OPTIMIZATION (2026-03-11):
 *   Only requesting 2 paid Insights data points + 1 free ($0.25/call, was $0.85).
 *   - form_input_method ($0.05) — HARD_KILL: pre-populated forms
 *   - age_seconds ($0.05) — HARD_KILL: cert >24h old (stale/recycled lead)
 *   - confirmed_owner ($0.00) — free
 *   Dropped 12 paid data points ($0.60 savings): bot_detected, ip, approx_ip_geo,
 *   os, browser, domain, is_framed, page_url, parent_page_url, form_input_kpm,
 *   form_input_wpm, seconds_on_page. eHawk covers bot/IP/fraud signals.
 *
 * NOTE: If trustedform_cert_url is null/empty, skip call entirely. Apply all null_penalty values.
 * NOTE: form_input_method value is "pre-populated" (hyphenated), not "prepopulated"
 */

import { API_ENDPOINTS } from '../utils/constants.js';

/**
 * Call TrustedForm Insights API.
 *
 * @param {string|null} certUrl - Full TrustedForm certificate URL
 * @param {AbortSignal} signal - AbortController signal
 * @returns {object} Normalized TrustedForm response fields
 */
export async function callTrustedForm(certUrl, signal) {
  const apiKey = process.env.TRUSTEDFORM_API_KEY;

  // If no cert URL, skip entirely — publisher doesn't use TrustedForm
  if (!certUrl || !apiKey || apiKey === 'PLACEHOLDER_API_KEY') {
    return createNullResponse();
  }

  // Extract cert ID from URL
  // URL format: https://cert.trustedform.com/2605ec3a321e1b3a41addf0bba1213505ef57985
  const certId = certUrl.split('/').pop();
  if (!certId) {
    console.error('TrustedForm: Could not extract cert ID from URL:', certUrl);
    return createNullResponse();
  }

  const url = `${API_ENDPOINTS.TRUSTEDFORM}/${certId}`;
  const auth = Buffer.from(`API:${apiKey}`).toString('base64');

  const body = {
    scan: ['insights'],
    insights: {
      properties: [
        'form_input_method',   // $0.05 — HARD_KILL: pre-populated
        'age_seconds',         // $0.05 — HARD_KILL: >24h stale
        'confirmed_owner',     // $0.00 — free
      ],
    },
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Api-Version': '4.0',
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    console.error(`TrustedForm API error: ${response.status} ${response.statusText}`);
    return createNullResponse();
  }

  const data = await response.json();
  return extractFields(data);
}

/**
 * Extract and normalize fields from TrustedForm response.
 * Only 3 fields: form_input_method, age_seconds, confirmed_owner.
 */
function extractFields(data) {
  const props = data?.insights?.properties || {};

  // form_input_method is an array of strings — convert to scoring category
  const inputMethod = normalizeInputMethod(props.form_input_method);

  // Normalize confirmed_owner to match config values
  const confirmedOwner = normalizeConfirmedOwner(props.confirmed_owner);

  return {
    'trustedform.form_input_method': inputMethod,
    'trustedform.age_seconds': props.age_seconds ?? null,
    'trustedform.confirmed_owner': confirmedOwner,
  };
}

/**
 * Normalize form_input_method array to a scoring category.
 *
 * TrustedForm returns an array like ["typing", "autofill"] for the methods used.
 * Map to config categories: typing_only, typing_autofill, autofill_only,
 * typing_paste, paste_only, pre-populated_only, empty
 */
function normalizeInputMethod(methods) {
  if (!methods || !Array.isArray(methods) || methods.length === 0) return 'empty';

  const hasTyping = methods.includes('typing');
  const hasAutofill = methods.includes('autofill');
  const hasPaste = methods.includes('paste');
  const hasPrePop = methods.includes('pre-populated');

  if (hasPrePop && !hasTyping && !hasAutofill && !hasPaste) return 'pre-populated_only';
  if (hasPaste && !hasTyping && !hasAutofill) return 'paste_only';
  if (hasTyping && hasPaste) return 'typing_paste';
  if (hasTyping && hasAutofill) return 'typing_autofill';
  if (hasAutofill && !hasTyping) return 'autofill_only';
  if (hasTyping && !hasAutofill && !hasPaste) return 'typing_only';

  // Fallback
  return 'empty';
}

/**
 * Normalize TrustedForm confirmed_owner values to match config expectations.
 *
 * API returns: "ActiveProspect Verified Owner", "No Verified ActiveProspect Account Identified"
 * Config expects: "verified", "named_account", "no_verified_account"
 */
function normalizeConfirmedOwner(rawValue) {
  if (!rawValue || typeof rawValue !== 'string') return null;

  const lower = rawValue.toLowerCase();

  if (lower.includes('verified owner')) return 'verified';
  if (lower.includes('named account')) return 'named_account';
  if (lower.includes('no verified')) return 'no_verified_account';

  return null;
}

/**
 * Return null fields when API is unavailable.
 */
function createNullResponse() {
  return {
    'trustedform.form_input_method': null,
    'trustedform.age_seconds': null,
    'trustedform.confirmed_owner': null,
  };
}
