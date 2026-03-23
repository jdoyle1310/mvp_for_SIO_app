import { jest } from '@jest/globals';
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = join(__dirname, '..', 'config');

describe('Config Validation', () => {
  // Test ALL verticals that have config files
  const configFiles = readdirSync(CONFIG_DIR).filter(f => f.endsWith('.json'));
  const verticals = configFiles.map(f => f.replace('.json', ''));
  const requiredPillars = ['contactability', 'identity', 'fraud_legal', 'behavioral', 'property_financial'];

  const validatedVerticals = ['solar', 'roofing', 'windows'];
  const shadowVerticals = ['hvac', 'siding', 'gutters', 'painting', 'plumbing', 'bathroom_remodel', 'kitchen_remodel', 'flooring', 'insurance', 'mortgage'];

  test('all 13 verticals have config files', () => {
    const expected = [...validatedVerticals, ...shadowVerticals];
    for (const v of expected) {
      expect(verticals).toContain(v);
    }
  });

  for (const vertical of verticals) {
    describe(`${vertical} config`, () => {
      let config;

      beforeAll(() => {
        const filePath = join(CONFIG_DIR, `${vertical}.json`);
        const raw = readFileSync(filePath, 'utf-8');
        config = JSON.parse(raw);
      });

      test('has valid vertical name', () => {
        expect(config.vertical).toBe(vertical);
      });

      test('has version string', () => {
        expect(typeof config.version).toBe('string');
        expect(config.version.length).toBeGreaterThan(0);
      });

      test('has hard_kills with universal rules', () => {
        expect(config.hard_kills).toBeDefined();
        expect(config.hard_kills.universal).toBeDefined();
      });

      test('has pillar_weights that sum to 1.0', () => {
        expect(config.pillar_weights).toBeDefined();
        const sum = Object.values(config.pillar_weights).reduce((a, b) => a + b, 0);
        expect(sum).toBeCloseTo(1.0, 2);
      });

      test('has all 5 pillar weights', () => {
        for (const pillar of requiredPillars) {
          expect(config.pillar_weights[pillar]).toBeDefined();
          expect(typeof config.pillar_weights[pillar]).toBe('number');
        }
      });

      test('has tier_thresholds in correct order', () => {
        expect(config.tier_thresholds).toBeDefined();
        expect(config.tier_thresholds.gold).toBeDefined();
        expect(config.tier_thresholds.silver).toBeDefined();
        expect(config.tier_thresholds.bronze).toBeDefined();
        expect(config.tier_thresholds.gold).toBeGreaterThan(config.tier_thresholds.silver);
        expect(config.tier_thresholds.silver).toBeGreaterThan(config.tier_thresholds.bronze);
      });

      test('has field_scores object with 18+ fields', () => {
        expect(config.field_scores).toBeDefined();
        expect(Object.keys(config.field_scores).length).toBeGreaterThanOrEqual(18);
      });

      test('every field_score has a valid pillar', () => {
        for (const [key, fieldConfig] of Object.entries(config.field_scores)) {
          expect(requiredPillars).toContain(fieldConfig.pillar);
        }
      });

      test('every field_score has null_penalty of 0', () => {
        for (const [key, fieldConfig] of Object.entries(config.field_scores)) {
          if (fieldConfig.scoring_type === 'fuzzy_name_match') continue;
          expect(fieldConfig.null_penalty).toBeDefined();
          expect(fieldConfig.null_penalty).toBe(0);
        }
      });

      test('has bonus_penalty_cap of 15', () => {
        expect(config.bonus_penalty_cap).toBe(15);
      });

      // ── Signal Clusters Validation ──

      test('has signal_clusters section with 4+ clusters', () => {
        expect(config.signal_clusters).toBeDefined();
        expect(Object.keys(config.signal_clusters).length).toBeGreaterThanOrEqual(4);
      });

      test('all required signal clusters are present', () => {
        const requiredClusters = [
          'phone_quality', 'email_quality', 'name_verification', 'ownership',
        ];
        for (const cluster of requiredClusters) {
          expect(config.signal_clusters[cluster]).toBeDefined();
        }
      });

      test('each signal cluster has valid pillar and fields array', () => {
        for (const [name, cluster] of Object.entries(config.signal_clusters)) {
          expect(requiredPillars).toContain(cluster.pillar);
          expect(Array.isArray(cluster.fields)).toBe(true);
          expect(cluster.fields.length).toBeGreaterThanOrEqual(1);
        }
      });

      test('every clustered field exists in field_scores', () => {
        for (const [name, cluster] of Object.entries(config.signal_clusters)) {
          for (const field of cluster.fields) {
            expect(config.field_scores[field]).toBeDefined();
          }
        }
      });

      test('clustered fields belong to the correct pillar', () => {
        for (const [name, cluster] of Object.entries(config.signal_clusters)) {
          for (const field of cluster.fields) {
            const fieldConfig = config.field_scores[field];
            if (fieldConfig) {
              expect(fieldConfig.pillar).toBe(cluster.pillar);
            }
          }
        }
      });

      // ── Universal HARD_KILLs ──

      test('pre-populated form is HARD_KILL', () => {
        expect(config.field_scores['trustedform.form_input_method'].values['pre-populated_only']).toBe('HARD_KILL');
      });

      test('lead age >24h is HARD_KILL', () => {
        const ageRanges = config.field_scores['trustedform.age_seconds'].ranges;
        const over24h = ageRanges.find(r => r.min === 86400);
        expect(over24h.points).toBe('HARD_KILL');
      });

      test('invalid phone is HARD_KILL', () => {
        expect(config.field_scores['trestle.phone.is_valid'].values['false']).toBe('HARD_KILL');
      });

      test('phone grade F is HARD_KILL', () => {
        expect(config.field_scores['trestle.phone.contact_grade'].values['F']).toBe('HARD_KILL');
      });

      // ── Shadow mode flag ──

      test('has shadow_mode flag', () => {
        expect(typeof config.shadow_mode).toBe('boolean');
      });

      if (validatedVerticals.includes(vertical)) {
        test('validated vertical is NOT in shadow mode', () => {
          expect(config.shadow_mode).toBe(false);
        });
      }

      if (shadowVerticals.includes(vertical)) {
        test('unvalidated vertical IS in shadow mode', () => {
          expect(config.shadow_mode).toBe(true);
        });
      }

      // ── Vertical-specific hard kills ──

      if (['solar', 'roofing', 'windows', 'siding'].includes(vertical)) {
        test('Mobile/Manufactured is HARD_KILL for structural verticals', () => {
          expect(config.field_scores['batchdata.property_type'].values['Mobile/Manufactured']).toBe('HARD_KILL');
        });
      }

      if (vertical === 'solar') {
        test('Condominium is HARD_KILL for solar', () => {
          expect(config.field_scores['batchdata.property_type'].values['Condominium']).toBe('HARD_KILL');
        });

        test('confirmed renter is HARD_KILL for solar', () => {
          expect(config.field_scores['batchdata.owner_occupied'].values['confirmed_renter']).toBe('HARD_KILL');
        });
      }

      if (vertical === 'roofing') {
        test('Condominium is scored (not HARD_KILL) for roofing', () => {
          const condoScore = config.field_scores['batchdata.property_type'].values['Condominium'];
          expect(condoScore).toBeDefined();
          expect(condoScore).not.toBe('HARD_KILL');
        });
      }

      if (['insurance', 'mortgage'].includes(vertical)) {
        test('renter is NOT HARD_KILL for financial verticals', () => {
          const renterScore = config.field_scores['batchdata.owner_occupied'].values['confirmed_renter'];
          expect(renterScore).not.toBe('HARD_KILL');
        });
      }

      // ── Key Fields Present ──

      test('has BatchData fields', () => {
        const fields = [
          'batchdata.free_and_clear', 'batchdata.high_equity',
          'batchdata.tax_lien', 'batchdata.pre_foreclosure',
        ];
        for (const field of fields) {
          expect(config.field_scores[field]).toBeDefined();
        }
      });
    });
  }
});
