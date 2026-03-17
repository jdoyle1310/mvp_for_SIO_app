/**
 * Score 10 Leads × 13 Verticals — Validation Reference for Production Deploy
 *
 * Runs 10 pre-enriched leads through every vertical using Sonnet.
 * - Solar/Roofing/Windows: scored with BOTH v4.2 standalone AND v5.0 assembled prompts
 * - All 13 verticals: scored with v5.0 assembled prompts
 * - Output: JSON reference file for devs to validate production matches local
 *
 * Usage: ANTHROPIC_API_KEY=sk-... node scripts/score-10-leads-all-verticals.mjs
 */

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_MODEL = 'claude-sonnet-4-20250514';
const API_KEY = process.env.ANTHROPIC_API_KEY;

if (!API_KEY) {
  console.error('ERROR: Set ANTHROPIC_API_KEY env var');
  process.exit(1);
}

// ═══════════════════════════════════════════════════
// LOAD LEAD DATA
// ═══════════════════════════════════════════════════

const MASTER_DATA_PATH = '/Users/jacksondoyle/greenwatt-validation/dry-run/data/master-revalidation-dataset.json';
const masterData = JSON.parse(readFileSync(MASTER_DATA_PATH, 'utf-8'));
const solarLeads = masterData.solar;

// 10 diverse leads selected by index (mix of Gold/Silver/Bronze/Reject, varied profiles)
const LEAD_INDICES = [2, 9, 23, 0, 41, 348, 5, 3, 6, 13];
const selectedLeads = LEAD_INDICES.map((idx, i) => ({
  lead_id: `L${i + 1}`,
  idx,
  first_name: solarLeads[idx].first_name,
  last_name: solarLeads[idx].last_name,
  original_tier: solarLeads[idx].new_tier || solarLeads[idx].old_tier,
  original_score: solarLeads[idx].new_score || solarLeads[idx].old_score,
  api_data: solarLeads[idx].api_data,
}));

console.log('Selected 10 leads:');
selectedLeads.forEach(l => {
  const ad = l.api_data;
  console.log(`  ${l.lead_id}: ${l.first_name} ${l.last_name} [${l.original_tier}:${l.original_score}] Grade=${ad['trestle.phone.contact_grade']} Owner=${ad['batchdata.owner_occupied']} Value=$${ad['batchdata.estimated_value']?.toLocaleString()} YearBuilt=${ad['batchdata.year_built']}`);
});

// ═══════════════════════════════════════════════════
// LOAD PROMPTS — mirrors getPromptForVertical() logic
// v4.2 standalone for solar/roofing/windows
// v5.0 BASE_PROMPT + VERTICAL_CONTEXTS for new verticals
// ═══════════════════════════════════════════════════

const v50Source = readFileSync(join(__dirname, '..', 'src', 'llm-scorer.js'), 'utf-8');

const VERTICALS = [
  'solar', 'roofing', 'windows',
  'hvac', 'siding', 'gutters', 'painting', 'plumbing',
  'bathroom_remodel', 'kitchen_remodel', 'flooring',
  'insurance', 'mortgage',
];

// Extract the 3 standalone prompts (v4.2, byte-for-byte locked)
const SOLAR_PROMPT = v50Source.match(/const SOLAR_PROMPT = `([\s\S]*?)`;/)[1];
const ROOFING_PROMPT = v50Source.match(/const ROOFING_PROMPT = `([\s\S]*?)`;/)[1];
const WINDOWS_PROMPT = v50Source.match(/const WINDOWS_PROMPT = `([\s\S]*?)`;/)[1];

// Extract BASE_PROMPT for new verticals
const BASE_PROMPT = v50Source.match(/const BASE_PROMPT = `([\s\S]*?)`;/)[1];

// For v4.2 comparison, use the same standalone prompts from git history
const v42Source = readFileSync('/tmp/llm-scorer-v42.js', 'utf-8');
const V42_SOLAR = v42Source.match(/const SOLAR_PROMPT = `([\s\S]*?)`;/)[1];
const V42_ROOFING = v42Source.match(/const ROOFING_PROMPT = `([\s\S]*?)`;/)[1];
const V42_WINDOWS = v42Source.match(/const WINDOWS_PROMPT = `([\s\S]*?)`;/)[1];

// Verify byte-for-byte match
console.log('\nPrompt verification:');
console.log(`  Solar: ${SOLAR_PROMPT === V42_SOLAR ? '✅ MATCH' : '❌ MISMATCH'} (${SOLAR_PROMPT.length} chars)`);
console.log(`  Roofing: ${ROOFING_PROMPT === V42_ROOFING ? '✅ MATCH' : '❌ MISMATCH'} (${ROOFING_PROMPT.length} chars)`);
console.log(`  Windows: ${WINDOWS_PROMPT === V42_WINDOWS ? '✅ MATCH' : '❌ MISMATCH'} (${WINDOWS_PROMPT.length} chars)`);

// Build prompts for new verticals using dynamic import of the actual module
// Since we can't easily import ES modules, we'll use a simpler approach:
// Import the buildPrompt function by loading the module
const { buildPrompt: _buildPrompt } = await import(join(__dirname, '..', 'src', 'llm-scorer.js'));

function getPrompt(vertical) {
  if (vertical === 'solar') return SOLAR_PROMPT;
  if (vertical === 'roofing') return ROOFING_PROMPT;
  if (vertical === 'windows') return WINDOWS_PROMPT;
  return _buildPrompt(vertical);
}

function getV42Prompt(vertical) {
  if (vertical === 'solar') return V42_SOLAR;
  if (vertical === 'roofing') return V42_ROOFING;
  if (vertical === 'windows') return V42_WINDOWS;
  throw new Error(`No v4.2 prompt for: ${vertical}`);
}

// ═══════════════════════════════════════════════════
// FIELD PREPARATION (from v5.0 logic)
// ═══════════════════════════════════════════════════

const VERTICAL_FIELDS = {
  solar:             ['email.is_deliverable', 'solar_permit', 'estimated_value', 'bd_age', 'sale_propensity', 'mortgage_total_payment'],
  roofing:           ['roof_permit', 'year_built', 'estimated_value', 'bd_age', 'sale_propensity', 'length_of_residence_years', 'recently_sold'],
  windows:           ['email.is_deliverable', 'year_built', 'estimated_value', 'tax_lien', 'pre_foreclosure', 'sale_propensity', 'bd_age', 'length_of_residence_years'],
  hvac:              ['year_built', 'estimated_value', 'length_of_residence_years', 'sale_propensity', 'recently_sold', 'tax_lien', 'pre_foreclosure'],
  siding:            ['year_built', 'estimated_value', 'sale_propensity', 'length_of_residence_years'],
  gutters:           ['year_built', 'bd_age', 'sale_propensity', 'length_of_residence_years'],
  painting:          ['sale_propensity', 'length_of_residence_years'],
  plumbing:          ['year_built', 'length_of_residence_years'],
  bathroom_remodel:  ['year_built', 'estimated_value', 'sale_propensity', 'bd_age', 'length_of_residence_years', 'recently_sold'],
  kitchen_remodel:   ['year_built', 'estimated_value', 'sale_propensity', 'bd_age', 'length_of_residence_years', 'recently_sold', 'tax_lien', 'pre_foreclosure'],
  flooring:          ['year_built', 'estimated_value', 'sale_propensity', 'length_of_residence_years', 'recently_sold'],
  insurance:         ['year_built', 'estimated_value', 'sale_propensity', 'recently_sold', 'bd_age', 'roof_permit', 'properties_count', 'inherited', 'absentee_owner', 'sq_ft'],
  mortgage:          ['estimated_value', 'sale_propensity', 'recently_sold', 'bd_age', 'length_of_residence_years', 'tax_lien', 'pre_foreclosure', 'properties_count', 'inherited', 'absentee_owner', 'active_listing'],
};

const FIELD_SOURCES = {
  'email.is_deliverable':      'trestle.email.is_deliverable',
  'solar_permit':              'batchdata.solar_permit',
  'roof_permit':               'batchdata.roof_permit',
  'year_built':                'batchdata.year_built',
  'estimated_value':           'batchdata.estimated_value',
  'tax_lien':                  'batchdata.tax_lien',
  'pre_foreclosure':           'batchdata.pre_foreclosure',
  'bd_age':                    'batchdata.bd_age',
  'sale_propensity':           'batchdata.sale_propensity',
  'mortgage_total_payment':    'batchdata.mortgage_total_payment',
  'length_of_residence_years': 'batchdata.length_of_residence_years',
  'recently_sold':             'batchdata.recently_sold',
  'properties_count':          'batchdata.properties_count',
  'inherited':                 'batchdata.inherited',
  'absentee_owner':            'batchdata.absentee_owner',
  'active_listing':            'batchdata.active_listing',
  'sq_ft':                     'batchdata.sq_ft',
};

function prepareFieldsForLLM(apiData, vertical) {
  const fields = {};

  // A. Contactability (all verticals)
  fields['phone.is_valid'] = apiData['trestle.phone.is_valid'] ?? null;
  fields['phone.contact_grade'] = apiData['trestle.phone.contact_grade'] ?? null;
  fields['phone.activity_score'] = apiData['trestle.phone.activity_score'] ?? null;
  fields['phone.line_type'] = apiData['trestle.phone.line_type'] ?? null;
  fields['email.is_valid'] = apiData['trestle.email.is_valid'] ?? null;

  // B. Identity (all verticals)
  fields['phone.name_match'] = apiData['trestle.phone.name_match'] ?? null;
  fields['email.name_match'] = apiData['trestle.email.name_match'] ?? null;
  fields['address.name_match'] = apiData['trestle.address.name_match'] ?? null;
  fields['owner_name'] = apiData['_batchdata.owner_name'] ?? null;

  // C. Property (all verticals)
  fields['owner_occupied'] = apiData['batchdata.owner_occupied'] ?? null;
  fields['property_type'] = apiData['batchdata.property_type'] ?? null;
  fields['free_and_clear'] = apiData['batchdata.free_and_clear'] ?? null;
  fields['high_equity'] = apiData['batchdata.high_equity'] ?? null;
  fields['address.is_valid'] = apiData['trestle.address.is_valid'] ?? null;

  // Add vertical-specific fields
  const verticalFields = VERTICAL_FIELDS[vertical] || [];
  for (const fieldName of verticalFields) {
    const source = FIELD_SOURCES[fieldName];
    if (source) {
      fields[fieldName] = apiData[source] ?? null;
    }
  }

  // D. Financial
  fields['household_income'] = apiData['fullcontact.household_income'] ?? null;
  fields['living_status'] = apiData['fullcontact.living_status'] ?? null;

  // E. Form behavior (all verticals)
  fields['form_input_method'] = apiData['trustedform.form_input_method'] ?? null;
  fields['bot_detected'] = apiData['trustedform.bot_detected'] ?? null;
  fields['confirmed_owner'] = apiData['trustedform.confirmed_owner'] ?? null;
  fields['age_seconds'] = apiData['trustedform.age_seconds'] ?? null;

  return fields;
}

// v4.2 field prep (same as v5.0 solar/roofing/windows - just uses the same function)
function prepareFieldsForLLMv42(apiData, vertical) {
  return prepareFieldsForLLM(apiData, vertical);
}

// ═══════════════════════════════════════════════════
// CALL ANTHROPIC API
// ═══════════════════════════════════════════════════

async function callSonnet(systemPrompt, leadName, fieldsJson) {
  const userMessage = leadName
    ? `Score this lead (name: ${leadName}):\n${fieldsJson}`
    : `Score this lead:\n${fieldsJson}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 512,
        temperature: 0,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`Anthropic API ${response.status}: ${errBody.slice(0, 200)}`);
    }

    const data = await response.json();
    const text = data.content[0].text;

    let jsonStr = text;
    const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) jsonStr = codeBlockMatch[1];
    jsonStr = jsonStr.trim();

    const parsed = JSON.parse(jsonStr);
    const result = Array.isArray(parsed) ? parsed[0] : parsed;

    return {
      tier: result.tier || 'Bronze',
      score: result.score ?? 30,
      confidence: result.confidence || 'medium',
      reasons: result.reasons || [],
      concerns: result.concerns || [],
      input_tokens: data.usage?.input_tokens || 0,
      output_tokens: data.usage?.output_tokens || 0,
    };
  } catch (err) {
    if (err.name === 'AbortError') {
      return { tier: 'ERROR', score: 0, confidence: 'none', reasons: [], concerns: ['API timeout'], input_tokens: 0, output_tokens: 0 };
    }
    return { tier: 'ERROR', score: 0, confidence: 'none', reasons: [], concerns: [err.message.slice(0, 100)], input_tokens: 0, output_tokens: 0 };
  } finally {
    clearTimeout(timeout);
  }
}

// ═══════════════════════════════════════════════════
// MAIN — Score all leads × all verticals
// ═══════════════════════════════════════════════════

async function main() {
  const results = [];
  let totalCalls = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  // PHASE 1: v4.2 vs v5.0 comparison for validated verticals
  console.log('\n═══ PHASE 1: v4.2 vs v5.0 comparison (solar/roofing/windows) ═══\n');

  for (const vertical of ['solar', 'roofing', 'windows']) {
    const v42Prompt = getV42Prompt(vertical);
    const v50Prompt = getPrompt(vertical);

    for (const lead of selectedLeads) {
      const fields = prepareFieldsForLLM(lead.api_data, vertical);
      const nonNullFields = Object.fromEntries(Object.entries(fields).filter(([, v]) => v != null));
      const fieldsJson = JSON.stringify(nonNullFields, null, 2);
      const leadName = `${lead.first_name} ${lead.last_name}`;

      // Score with v4.2
      console.log(`  Scoring ${lead.lead_id} (${leadName}) × ${vertical} [v4.2]...`);
      const v42Result = await callSonnet(v42Prompt, leadName, fieldsJson);
      totalCalls++;
      totalInputTokens += v42Result.input_tokens;
      totalOutputTokens += v42Result.output_tokens;

      results.push({
        lead_id: lead.lead_id,
        lead_name: leadName,
        vertical,
        version: 'v4.2',
        tier: v42Result.tier,
        score: v42Result.score,
        confidence: v42Result.confidence,
        reasons: v42Result.reasons,
        concerns: v42Result.concerns,
      });

      // Score with v5.0
      console.log(`  Scoring ${lead.lead_id} (${leadName}) × ${vertical} [v5.0]...`);
      const v50Result = await callSonnet(v50Prompt, leadName, fieldsJson);
      totalCalls++;
      totalInputTokens += v50Result.input_tokens;
      totalOutputTokens += v50Result.output_tokens;

      results.push({
        lead_id: lead.lead_id,
        lead_name: leadName,
        vertical,
        version: 'v5.0',
        tier: v50Result.tier,
        score: v50Result.score,
        confidence: v50Result.confidence,
        reasons: v50Result.reasons,
        concerns: v50Result.concerns,
      });

      // Compare
      const match = v42Result.tier === v50Result.tier ? '✅' : '⚠️ MISMATCH';
      const scoreDiff = Math.abs(v42Result.score - v50Result.score);
      console.log(`    v4.2: ${v42Result.tier} ${v42Result.score} | v5.0: ${v50Result.tier} ${v50Result.score} | ${match} (diff: ${scoreDiff})`);

      // Rate limit: ~50 requests/min for Sonnet
      await new Promise(r => setTimeout(r, 600));
    }
  }

  // PHASE 2: v5.0 for all 13 verticals
  console.log('\n═══ PHASE 2: v5.0 scoring for all 13 verticals ═══\n');

  for (const vertical of VERTICALS) {
    const prompt = getPrompt(vertical);

    for (const lead of selectedLeads) {
      const fields = prepareFieldsForLLM(lead.api_data, vertical);
      const nonNullFields = Object.fromEntries(Object.entries(fields).filter(([, v]) => v != null));
      const fieldsJson = JSON.stringify(nonNullFields, null, 2);
      const leadName = `${lead.first_name} ${lead.last_name}`;

      // Skip if already scored in Phase 1 (v5.0 for solar/roofing/windows)
      if (['solar', 'roofing', 'windows'].includes(vertical)) continue;

      console.log(`  Scoring ${lead.lead_id} (${leadName}) × ${vertical} [v5.0]...`);
      const result = await callSonnet(prompt, leadName, fieldsJson);
      totalCalls++;
      totalInputTokens += result.input_tokens;
      totalOutputTokens += result.output_tokens;

      results.push({
        lead_id: lead.lead_id,
        lead_name: leadName,
        vertical,
        version: 'v5.0',
        tier: result.tier,
        score: result.score,
        confidence: result.confidence,
        reasons: result.reasons,
        concerns: result.concerns,
      });

      console.log(`    ${result.tier} ${result.score} (${result.confidence})`);

      // Rate limit
      await new Promise(r => setTimeout(r, 600));
    }
  }

  // ═══════════════════════════════════════════════════
  // OUTPUT
  // ═══════════════════════════════════════════════════

  // Build the reference output
  const output = {
    metadata: {
      generated: new Date().toISOString(),
      model: ANTHROPIC_MODEL,
      temperature: 0,
      total_api_calls: totalCalls,
      total_input_tokens: totalInputTokens,
      total_output_tokens: totalOutputTokens,
      estimated_cost: `$${((totalInputTokens * 3 + totalOutputTokens * 15) / 1000000).toFixed(2)}`,
      purpose: 'Production validation reference — devs run same leads through Lambda and compare scores',
    },
    leads: selectedLeads.map(l => ({
      lead_id: l.lead_id,
      name: `${l.first_name} ${l.last_name}`,
      original_solar_tier: l.original_tier,
      original_solar_score: l.original_score,
      enrichment_summary: {
        phone_grade: l.api_data['trestle.phone.contact_grade'],
        phone_line_type: l.api_data['trestle.phone.line_type'],
        activity_score: l.api_data['trestle.phone.activity_score'],
        phone_name_match: l.api_data['trestle.phone.name_match'],
        email_name_match: l.api_data['trestle.email.name_match'],
        address_name_match: l.api_data['trestle.address.name_match'],
        owner_occupied: l.api_data['batchdata.owner_occupied'],
        property_type: l.api_data['batchdata.property_type'],
        estimated_value: l.api_data['batchdata.estimated_value'],
        year_built: l.api_data['batchdata.year_built'],
        free_and_clear: l.api_data['batchdata.free_and_clear'],
        sale_propensity: l.api_data['batchdata.sale_propensity'],
        bd_age: l.api_data['batchdata.bd_age'],
        sq_ft: l.api_data['batchdata.sq_ft'],
        properties_count: l.api_data['batchdata.properties_count'],
        inherited: l.api_data['batchdata.inherited'],
        absentee_owner: l.api_data['batchdata.absentee_owner'],
        active_listing: l.api_data['batchdata.active_listing'],
        recently_sold: l.api_data['batchdata.recently_sold'],
        tax_lien: l.api_data['batchdata.tax_lien'],
      },
    })),
    v42_vs_v50_comparison: results
      .filter(r => ['solar', 'roofing', 'windows'].includes(r.vertical))
      .reduce((acc, r) => {
        const key = `${r.lead_id}_${r.vertical}`;
        if (!acc[key]) acc[key] = {};
        acc[key][r.version] = { tier: r.tier, score: r.score, confidence: r.confidence, reasons: r.reasons, concerns: r.concerns };
        acc[key].lead_name = r.lead_name;
        acc[key].vertical = r.vertical;
        if (acc[key]['v4.2'] && acc[key]['v5.0']) {
          acc[key].tier_match = acc[key]['v4.2'].tier === acc[key]['v5.0'].tier;
          acc[key].score_diff = Math.abs(acc[key]['v4.2'].score - acc[key]['v5.0'].score);
        }
        return acc;
      }, {}),
    scores_by_vertical: VERTICALS.reduce((acc, v) => {
      acc[v] = results
        .filter(r => r.vertical === v && r.version === 'v5.0')
        .map(r => ({
          lead_id: r.lead_id,
          lead_name: r.lead_name,
          tier: r.tier,
          score: r.score,
          confidence: r.confidence,
          reasons: r.reasons,
          concerns: r.concerns,
        }));
      return acc;
    }, {}),
    all_results: results,
  };

  // Save
  const outputPath = join(__dirname, '..', 'docs', 'validation-reference-10-leads-13-verticals.json');
  writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`\n═══ DONE ═══`);
  console.log(`Total API calls: ${totalCalls}`);
  console.log(`Total tokens: ${totalInputTokens} input, ${totalOutputTokens} output`);
  console.log(`Estimated cost: ${output.metadata.estimated_cost}`);
  console.log(`Output: ${outputPath}`);

  // Print v4.2 vs v5.0 comparison summary
  console.log('\n═══ v4.2 vs v5.0 COMPARISON SUMMARY ═══\n');
  const comparisons = Object.values(output.v42_vs_v50_comparison);
  const tierMatches = comparisons.filter(c => c.tier_match).length;
  const avgScoreDiff = comparisons.reduce((sum, c) => sum + (c.score_diff || 0), 0) / comparisons.length;
  console.log(`Tier matches: ${tierMatches}/${comparisons.length} (${(tierMatches/comparisons.length*100).toFixed(1)}%)`);
  console.log(`Average score difference: ${avgScoreDiff.toFixed(1)} points`);

  for (const c of comparisons) {
    const match = c.tier_match ? '✅' : '⚠️';
    console.log(`  ${match} ${c.lead_name} × ${c.vertical}: v4.2=${c['v4.2']?.tier}/${c['v4.2']?.score} v5.0=${c['v5.0']?.tier}/${c['v5.0']?.score} (diff=${c.score_diff})`);
  }

  // Print scores grid
  console.log('\n═══ SCORES GRID (v5.0) ═══\n');
  const header = ['Lead', ...VERTICALS.map(v => v.slice(0, 8))];
  console.log(header.join('\t'));
  for (const lead of selectedLeads) {
    const row = [lead.lead_id];
    for (const v of VERTICALS) {
      const r = results.find(r => r.lead_id === lead.lead_id && r.vertical === v && r.version === 'v5.0');
      row.push(r ? `${r.tier[0]}${r.score}` : '---');
    }
    console.log(row.join('\t'));
  }
}

main().catch(console.error);
