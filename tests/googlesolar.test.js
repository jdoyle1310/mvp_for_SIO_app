import { jest } from '@jest/globals';
import { callGoogleSolar } from '../src/api/googlesolar.js';

/**
 * Google Solar detection is FAIL-OPEN by design: any missing precondition
 * (env var, coordinates) or API failure returns null and scoring proceeds
 * unchanged. These tests pin that contract.
 */
describe('Google Solar existing-arrays detection', () => {
  const OLD_ENV = process.env.GOOGLE_SOLAR_API_KEY;
  afterEach(() => {
    if (OLD_ENV === undefined) delete process.env.GOOGLE_SOLAR_API_KEY;
    else process.env.GOOGLE_SOLAR_API_KEY = OLD_ENV;
  });

  test('returns null (dormant) when GOOGLE_SOLAR_API_KEY is unset', async () => {
    delete process.env.GOOGLE_SOLAR_API_KEY;
    const res = await callGoogleSolar({
      'batchdata.latitude': 40.1, 'batchdata.longitude': -74.5,
    });
    expect(res).toBeNull();
  });

  test('returns null when coordinates are missing', async () => {
    process.env.GOOGLE_SOLAR_API_KEY = 'test-key';
    expect(await callGoogleSolar({})).toBeNull();
    expect(await callGoogleSolar({ 'batchdata.latitude': 40.1 })).toBeNull();
  });

  test('returns null on API failure (fail-open)', async () => {
    process.env.GOOGLE_SOLAR_API_KEY = 'test-key';
    const realFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 429 });
    const res = await callGoogleSolar({
      'batchdata.latitude': 40.1, 'batchdata.longitude': -74.5,
    });
    global.fetch = realFetch;
    expect(res).toBeNull();
  });

  test('parses DETECTED_ARRAYS from a successful response', async () => {
    process.env.GOOGLE_SOLAR_API_KEY = 'test-key';
    const realFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        detectedArrays: {
          detectionStatus: 'DETECTION_STATUS_ARRAYS_DETECTED',
          latestCaptureDate: { year: 2025, month: 3, day: 1 },
        },
      }),
    });
    const res = await callGoogleSolar({
      'batchdata.latitude': 40.1, 'batchdata.longitude': -74.5,
    });
    global.fetch = realFetch;
    expect(res.arrays_detected).toBe(true);
    expect(res.detection_status).toBe('DETECTION_STATUS_ARRAYS_DETECTED');
  });
});
