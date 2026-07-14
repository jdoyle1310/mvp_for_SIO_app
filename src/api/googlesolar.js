/**
 * Google Solar API — existing-installation detection (DETECTED_ARRAYS).
 *
 * Validated Jul 10 2026 on 2,926 dispo-matched leads: 8.7% of sold solar leads
 * have arrays already visible on the roof; detection catches 68%+ of the leads
 * buyers later DQ as "already has solar" (misses are imagery-recency, not
 * detection quality). Arrays-detected leads convert 7.4% vs 9.8% — Bronze-level
 * but NOT zero (3 confirmed sales: expansions/batteries/new owners), hence a
 * Bronze CAP + routable flag, never a reject.
 *
 * NOTE (pilot finding, same dataset): roof capacity / sunshine metrics do NOT
 * predict conversion (small roofs convert ABOVE base) — deliberately not used.
 *
 * Fail-open by design: no GOOGLE_SOLAR_API_KEY env var, timeout, quota, or
 * NOT_FOUND all return null and scoring proceeds unchanged. Runs in parallel
 * with the Anthropic call, so it adds zero wall-clock to the SIO budget.
 * Free tier: 10,000 buildingInsights calls/month (current solar volume ~7K/mo).
 */

const GOOGLE_SOLAR_TIMEOUT_MS = 1500;

export async function callGoogleSolar(apiData) {
  const apiKey = process.env.GOOGLE_SOLAR_API_KEY;
  const lat = apiData['batchdata.latitude'];
  const lng = apiData['batchdata.longitude'];
  if (!apiKey || lat == null || lng == null) {
    return null; // dormant until env var set / no coordinates — fail open
  }

  const url = 'https://solar.googleapis.com/v1/buildingInsights:findClosest'
    + `?location.latitude=${lat}&location.longitude=${lng}`
    + `&requiredQuality=MEDIUM&additionalInsights=DETECTED_ARRAYS`
    + `&key=${apiKey}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GOOGLE_SOLAR_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null; // 404 no building, 429 quota, etc. — fail open
    const body = await res.json();
    const det = body.detectedArrays || {};
    return {
      arrays_detected: det.detectionStatus === 'DETECTION_STATUS_ARRAYS_DETECTED',
      detection_status: det.detectionStatus ?? null,
      imagery_date: det.latestCaptureDate ?? null,
    };
  } catch {
    return null; // timeout / network — fail open
  } finally {
    clearTimeout(timer);
  }
}
