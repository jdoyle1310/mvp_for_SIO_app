import { jest } from '@jest/globals';
import { evaluateHardKills, isHardKillValue } from '../src/utils/hardkill.js';

/**
 * Hard-kill tests — property-based kills only.
 *
 * Phone/email/bot hard kills removed — eHawk handles those upstream.
 * Our hard kills only cover property-level issues eHawk can't detect:
 * - Commercial property (all verticals)
 * - Confirmed renter (solar, roofing, windows)
 * - Mobile/manufactured home (solar, roofing, windows)
 */

// Solar config — has renter + mobile/manufactured hard kills
// Commercial property downgraded to -80 penalty (no longer universal hard kill)
const solarConfig = {
  hard_kills: {
    universal: {},
    vertical_specific: {
      batchdata_renter_confirmed: true,
      batchdata_mobile_manufactured: true,
    },
  },
};

// Mortgage config — no renter or mobile/manufactured hard kills
const mortgageConfig = {
  hard_kills: {
    universal: {},
    vertical_specific: {},
  },
};

describe('Hard Kill Evaluator', () => {
  test('passes clean lead', () => {
    const apiData = {
      'trestle.phone.contact_grade': 'A',
      'trestle.phone.activity_score': 85,
      'trestle.litigator_risk': 'false',
      'batchdata.property_type': 'Single Family Residential',
      'batchdata.owner_occupied': 'confirmed_owner',
      'trustedform.bot_detected': 'false',
    };

    const result = evaluateHardKills(apiData, solarConfig);
    expect(result.hardKill).toBe(false);
    expect(result.reason).toBeNull();
  });

  test('does NOT hard kill on F phone grade (handled by scoring now)', () => {
    const apiData = {
      'trestle.phone.contact_grade': 'F',
      'trestle.phone.activity_score': 85,
      'batchdata.property_type': 'Single Family Residential',
      'batchdata.owner_occupied': 'confirmed_owner',
    };

    const result = evaluateHardKills(apiData, solarConfig);
    // F grade is now a steep -80 penalty in scoring, NOT a hard kill
    expect(result.hardKill).toBe(false);
  });

  test('does NOT hard kill on litigator risk (handled by scoring now)', () => {
    const apiData = {
      'trestle.litigator_risk': 'true',
      'batchdata.property_type': 'Single Family Residential',
      'batchdata.owner_occupied': 'confirmed_owner',
    };

    const result = evaluateHardKills(apiData, solarConfig);
    // Litigator risk is now a steep -80 penalty in scoring, NOT a hard kill
    expect(result.hardKill).toBe(false);
  });

  test('does NOT hard kill on bot detected (handled by scoring now)', () => {
    const apiData = {
      'batchdata.property_type': 'Single Family Residential',
      'batchdata.owner_occupied': 'confirmed_owner',
      'trustedform.bot_detected': 'true',
    };

    const result = evaluateHardKills(apiData, solarConfig);
    // Bot detection is now a steep -80 penalty in scoring, NOT a hard kill
    expect(result.hardKill).toBe(false);
  });

  test('does NOT hard kill on commercial property (now -80 penalty in scoring)', () => {
    const apiData = {
      'batchdata.property_type': 'Commercial',
      'batchdata.owner_occupied': 'confirmed_owner',
    };

    const result = evaluateHardKills(apiData, solarConfig);
    expect(result.hardKill).toBe(false);
  });

  test('does NOT hard kill on commercial property for mortgage either', () => {
    const apiData = {
      'batchdata.property_type': 'Commercial',
    };

    const result = evaluateHardKills(apiData, mortgageConfig);
    expect(result.hardKill).toBe(false);
  });

  test('kills confirmed renter for solar', () => {
    const apiData = {
      'batchdata.property_type': 'Single Family Residential',
      'batchdata.owner_occupied': 'confirmed_renter',
    };

    const result = evaluateHardKills(apiData, solarConfig);
    expect(result.hardKill).toBe(true);
    expect(result.reason).toBe('RENTER_CONFIRMED');
  });

  test('does NOT kill confirmed renter for mortgage', () => {
    const apiData = {
      'batchdata.property_type': 'Single Family Residential',
      'batchdata.owner_occupied': 'confirmed_renter',
    };

    const result = evaluateHardKills(apiData, mortgageConfig);
    expect(result.hardKill).toBe(false);
  });

  test('kills on mobile/manufactured home for solar', () => {
    const apiData = {
      'batchdata.property_type': 'Mobile/Manufactured',
      'batchdata.owner_occupied': 'confirmed_owner',
    };

    const result = evaluateHardKills(apiData, solarConfig);
    expect(result.hardKill).toBe(true);
    expect(result.reason).toBe('MOBILE_MANUFACTURED_HOME');
  });

  test('does NOT kill on mobile/manufactured for mortgage', () => {
    const apiData = {
      'batchdata.property_type': 'Mobile/Manufactured',
      'batchdata.owner_occupied': 'confirmed_owner',
    };

    const result = evaluateHardKills(apiData, mortgageConfig);
    expect(result.hardKill).toBe(false);
  });

  test('probable_renter does NOT trigger hard kill (only confirmed_renter does)', () => {
    const apiData = {
      'batchdata.property_type': 'Single Family Residential',
      'batchdata.owner_occupied': 'probable_renter',
    };

    const result = evaluateHardKills(apiData, solarConfig);
    expect(result.hardKill).toBe(false);
  });

  test('handles missing API data gracefully', () => {
    const apiData = {};

    const result = evaluateHardKills(apiData, solarConfig);
    expect(result.hardKill).toBe(false);
    expect(result.reason).toBeNull();
  });

  test('isHardKillValue correctly identifies sentinel', () => {
    expect(isHardKillValue('HARD_KILL')).toBe(true);
    expect(isHardKillValue(120)).toBe(false);
    expect(isHardKillValue(-20)).toBe(false);
    expect(isHardKillValue(null)).toBe(false);
  });
});
