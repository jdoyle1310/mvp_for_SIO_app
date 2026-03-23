import { describe, test, expect } from '@jest/globals';
import { applyPostScoreTierCaps } from '../src/utils/post-score-tier-caps.js';

describe('applyPostScoreTierCaps', () => {
  test('RENTER_CAP: solar confirmed_renter caps Gold to Bronze', () => {
    const apiData = { 'batchdata.owner_occupied': 'confirmed_renter' };
    const r = applyPostScoreTierCaps(apiData, 'Gold', 85, 'solar');
    expect(r.tier).toBe('Bronze');
    expect(r.score).toBe(44);
    expect(r.capsTriggered).toContain('RENTER_CAP');
  });

  test('RENTER_CAP skipped for mortgage', () => {
    const apiData = { 'batchdata.owner_occupied': 'confirmed_renter' };
    const r = applyPostScoreTierCaps(apiData, 'Gold', 85, 'mortgage');
    expect(r.tier).toBe('Gold');
    expect(r.capsTriggered).not.toContain('RENTER_CAP');
  });

  test('DOUBLE_NAME_MISMATCH: both false', () => {
    const apiData = {
      'trestle.phone.name_match': 'false',
      'trestle.address.name_match': 'false',
    };
    const r = applyPostScoreTierCaps(apiData, 'Silver', 58, 'solar');
    expect(r.tier).toBe('Bronze');
    expect(r.capsTriggered).toContain('DOUBLE_NAME_MISMATCH');
  });

  test('DOUBLE_NAME_MISMATCH: null phone does not trigger', () => {
    const apiData = {
      'trestle.phone.name_match': null,
      'trestle.address.name_match': 'false',
    };
    const r = applyPostScoreTierCaps(apiData, 'Silver', 58, 'solar');
    expect(r.tier).toBe('Silver');
  });

  test('INVALID_ADDR_UNVERIFIED_OWNER', () => {
    const apiData = {
      'trestle.address.is_valid': 'false',
      'batchdata.owner_occupied': null,
    };
    const r = applyPostScoreTierCaps(apiData, 'Silver', 62, 'solar');
    expect(r.tier).toBe('Bronze');
    expect(r.capsTriggered).toContain('INVALID_ADDR_UNVERIFIED_OWNER');
  });

  test('INVALID_ADDR: confirmed_owner passes', () => {
    const apiData = {
      'trestle.address.is_valid': 'false',
      'batchdata.owner_occupied': 'confirmed_owner',
    };
    const r = applyPostScoreTierCaps(apiData, 'Silver', 62, 'solar');
    expect(r.tier).toBe('Silver');
  });

  test('GRADE_C_LANDLINE_VOIP', () => {
    const apiData = {
      'trestle.phone.contact_grade': 'C',
      'trestle.phone.line_type': 'Landline',
    };
    const r = applyPostScoreTierCaps(apiData, 'Gold', 85, 'solar');
    expect(r.tier).toBe('Bronze');
    expect(r.capsTriggered).toContain('GRADE_C_LANDLINE_VOIP');
  });

  test('no cap when Bronze already', () => {
    const apiData = { 'batchdata.owner_occupied': 'confirmed_renter' };
    const r = applyPostScoreTierCaps(apiData, 'Bronze', 40, 'solar');
    expect(r.tier).toBe('Bronze');
    expect(r.capsTriggered).toEqual([]);
  });
});
