# GreenWatt LLM Lead Scoring — Specification & Developer Handoff

**Last updated**: 2026-03-12
**Status**: Production implemented. Prompts locked v4 for solar + roofing. Ready for more backtest data.
**Model**: Claude Sonnet (`claude-sonnet-4-20250514`)

---

## Quick Reference

| Item | Location |
|------|----------|
| **Solar prompt (LOCKED)** | `prompts/solar-v4.md` |
| **Roofing prompt (LOCKED)** | `prompts/roofing-v4.md` |
| **Solar scorer script** | `dry-run/llm-scorer-v3.mjs` (runs v4 prompt) |
| **Roofing scorer script** | `dry-run/llm-scorer-v3-roofing.mjs` (runs v4 prompt) |
| **Solar results** | `dry-run/llm-v4-sonnet-results.json` |
| **Roofing results** | `dry-run/llm-v4-roofing-sonnet-results.json` |
| **Enrichment data** | `dry-run/sew-backtest-results.json`, `venture-backtest-results.json`, `mixed-backtest-results.json`, `batch-results.json` |

---

## 1. Architecture Overview

```
Lead comes in via SIO ping-post
        │
        ▼
    ┌─────────┐
    │  eHawk   │ ◄── Upstream fraud screen (-100 to +10 score)
    │ (bouncer)│     Kills blatant fraud BEFORE Lambda
    └────┬────┘
         │  (lead passes eHawk)
         ▼
    ┌──────────────────────────────────────────┐
    │           Lambda (src/index.js)           │
    │                                           │
    │  1. Call Trestle     ($0.035/lead)         │
    │  2. Call BatchData   ($0.10/lead)          │
    │  3. Call TrustedForm ($0.25/lead)          │
    │  4. Prepare 21 stripped fields             │
    │  5. Call Anthropic Sonnet (~$0.003/lead)   │
    │  6. Parse tier + score                     │
    │  7. Return pricing based on tier           │
    └──────────────────────────────────────────┘
```

**Total cost per lead**: ~$0.298 (down from ~$0.42 with FullContact + old BatchData key)

---

## 2. API Stack (FINAL)

| API | Keep/Drop | Cost/Lead | Why |
|-----|-----------|-----------|-----|
| **Trestle** | KEEP | $0.035 | 93-100% coverage. Top discriminating fields: phone grade, name match |
| **BatchData** | KEEP | $0.01 | 66-82% coverage. Quick-list key — property ownership, equity, permits |
| **TrustedForm** | KEEP | $0.25 | 100% coverage. Form behavior, bot detection, confirmed owner |
| **eHawk** | KEEP (upstream) | $0 in Lambda | Upstream fraud bouncer. Screens BEFORE Lambda. NOT passed to LLM. |
| **Anthropic** | NEW | ~$0.003 | Sonnet scoring. ~1,500 input + 200 output tokens |
| **FullContact** | **DROP** | ~~$0.02~~ | 0% coverage for Solar Bear (86 leads), 0% for batch (481 leads). Even best-case (SEW, 51% coverage): +0.1 point controlled impact. Zero marginal value. |

### Why eHawk is NOT Passed to LLM
eHawk screens out blatant fraud on the front end. By the time a lead reaches the Lambda, it already passed eHawk. Passing eHawk data to the LLM is redundant. They are separate stages:
- **eHawk** = upstream bouncer (kills blatant fraud)
- **LLM** = detailed scorer (tiers surviving leads)

---

## 3. Tier Definitions & Pricing

| Tier | Price | Definition |
|------|-------|------------|
| **Gold** | $95 | 3+ signal groups ALL positive (contactable + verified identity + qualified property) |
| **Silver** | $65 | Solid on 2+ groups, gaps in others, nothing disqualifying |
| **Bronze** | $40 | Notable concerns (weak phone, sparse data, some red flags) |
| **Reject** | $0 | Instant reject triggers OR severe fraud indicators |

---

## 4. Instant Rejects (ALL verticals)

| Trigger | Field | Value |
|---------|-------|-------|
| Invalid phone | phone.is_valid | "false" |
| Mobile/Manufactured home | property_type | "Mobile/Manufactured" |
| Pre-populated form (bot) | form_input_method | "pre-populated_only" |
| Bot detected | bot_detected | "true" |
| Very low income | household_income | confirmed < $25,000 |

### NOT instant rejects (strong negatives only):
- **phone.contact_grade = "F"**: Strong negative but NOT auto-reject. Proven by Cynthia Wint (phone F, but confirmed owner, high equity, $498k property, 14 permits — set an appointment).
- **property_type = "Commercial"**: Strong negative but NOT auto-reject. BatchData property classification can be wrong. Proven by Gin Dent (Commercial tag, but set appointment).
- **property_type = "Condominium"**: Instant reject for SOLAR (can't install). Moderate negative for ROOFING (HOA-managed but can get roofs).

---

## 5. DQ Reclassification

**Critical for measuring scorer accuracy:**
- "Do Not Contact" and "Not Interested" = **NORMAL_LOSS** (not junk)
- These are normal sales outcomes — the person was real, reachable, just didn't want it
- **Real DQ** = Bad Contact Data, Already Has Solar, Shade, Property Type, Credit, Bad Number, Mobile Home

Don't penalize the scorer for "missing" leads that were legitimately contacted.

---

## 6. Fields Sent to LLM (22 fields)

Stripped from 50+ fields down to 22. These do 95% of the work.

### A. Contactability (from Trestle)
| Field | Source | Notes |
|-------|--------|-------|
| phone.is_valid | trestle.phone.is_valid | |
| phone.contact_grade | trestle.phone.contact_grade | A through F |
| phone.activity_score | trestle.phone.activity_score | 0-100 |
| phone.line_type | trestle.phone.line_type | Mobile/Landline/VOIP |
| email.is_valid | trestle.email.is_valid | |
| email.is_deliverable | trestle.email.is_deliverable | Solar only (0% coverage roofing) |

### B. Identity (from Trestle + BatchData)
| Field | Source | Notes |
|-------|--------|-------|
| phone.name_match | trestle.phone.name_match | CRITICAL separator |
| email.name_match | trestle.email.name_match | |
| address.name_match | trestle.address.name_match | CRITICAL separator |
| owner_name | _batchdata.owner_name | For cross-reference |

### C. Property (from BatchData + Trestle)
| Field | Source | Notes |
|-------|--------|-------|
| owner_occupied | batchdata.owner_occupied | |
| property_type | batchdata.property_type | |
| free_and_clear | batchdata.free_and_clear | Slight positive for roofing, strong for solar |
| high_equity | batchdata.high_equity | |
| solar_permit | batchdata.solar_permit | Solar only — "already has solar" |
| roof_permit | batchdata.roof_permit | Roofing only — "already had roof work" |
| address.is_valid | trestle.address.is_valid | |
| year_built | batchdata.year_built | Roofing only — older = more likely needs roof |

### D. Financial (will be null after FC dropped)
| Field | Source | Notes |
|-------|--------|-------|
| household_income | fullcontact.household_income | Null = neutral |
| living_status | fullcontact.living_status | Null = neutral |

### E. Form Behavior (from TrustedForm)
| Field | Source | Notes |
|-------|--------|-------|
| form_input_method | trustedform.form_input_method | |
| bot_detected | trustedform.bot_detected | |
| confirmed_owner | trustedform.confirmed_owner | Strong positive when "verified" |
| age_seconds | trustedform.age_seconds | **Production only** — null in backtest. <5min=fresh, >24h=stale |

---

## 7. Vertical-Specific Differences

| Feature | Solar | Roofing |
|---------|-------|---------|
| Permit field | solar_permit (strong downgrade) | roof_permit (STRONG downgrade) |
| year_built | Not included | Included (pre-1990 = slight positive) |
| email.is_deliverable | Included | Not included (0% coverage) |
| Condominium | INSTANT REJECT | Moderate negative |
| Commercial | N/A | Strong negative (not instant reject) |
| free_and_clear | Strong positive | Slight positive only |
| typing_only | Positive | Neutral |
| confirmed_renter | Moderate negative | STRONG negative (Bronze unless override) |
| Gold identity requirement | 2 of 3 name matches true | phone + address BOTH true (required) |

---

## 8. Validation Results

### Solar v4 (379 leads, $1.05)

| Metric | Rules Engine | LLM v3 (phone F = reject) | LLM v4 (phone F = strong neg) |
|--------|-------------|---------------------------|-------------------------------|
| Sale-DQ gap | +7.8 | +12.2 | **+12.1** |
| Sales in Gold/Silver | 5/8 (63%) | 7/8 (88%) | **7/8 (88%)** |
| Sales blocked | 3/8 | 1/8 | **1/8** (Tony Bondar — zero enrichment) |
| Revenue (tiered) | $15,160 | $25,435 | **$26,100 (+72%)** |
| Gold leads | ~30 | 161 | **166** |
| Reject leads | — | 27 | **26** |
| Cost | $0 | $1.03 | $1.05 |

**v3→v4 impact**: Phone F fix saved ~5 leads from Reject without degrading separation (+$665 revenue). Gap unchanged.

### Roofing v4 (44 leads, $0.14)

| Metric | Rules Engine | LLM v3 | LLM v4 |
|--------|-------------|--------|--------|
| Positive avg score | 45.6 | ~65 | **73.8** |
| DQ avg score | 39.8 | ~57 | **59.5** |
| Positive-DQ gap | +5.8 | +8.5 | **+14.3** |
| Positive in Gold/Silver | 10/11 (91%) | 10/11 (91%) | **10/11 (91%)** |
| Positive blocked | 1 (Reject — phone F) | 1 (Bronze) | **1 (Bronze)** |
| Gold leads | 0 | 16 | **17** |
| Gold positive rate | n/a | 37.5% | **35.3%** |
| Revenue (tiered) | $2,490 | $3,215 | **$3,245 (+30%)** |

### Per-Tier Quality (Roofing v4)
| Tier | Leads | Positive | Pos% | DQ | DQ% |
|------|-------|----------|------|----|-----|
| Gold | 17 | 6 | 35.3% | 3 | 17.6% |
| Silver | 22 | 4 | 18.2% | 10 | 45.5% |
| Bronze | 5 | 1 | 20.0% | 3 | 60.0% |

---

## 9. Production Implementation — DONE (2026-03-12)

All changes implemented. Rules engine replaced with LLM scoring.

### Files Changed

| File | Change |
|------|--------|
| `src/llm-scorer.js` | **NEW** — LLM scoring module with locked v4 prompts for solar + roofing |
| `src/index.js` | Rewritten: removed FullContact, replaced rules engine with `scoreLead()`, added quick hard-kill pre-check |
| `src/utils/constants.js` | Removed FullContact endpoint, added Anthropic endpoint |
| `src/api/batchdata.js` | Added `_batchdata.owner_name` extraction (needed by LLM for identity cross-reference) |
| `.env` | New BatchData quick-list key, Anthropic API key added, FullContact commented out |
| `config/solar.json` | v4.0 — removed 11 FullContact field_scores, cleaned signal_clusters |
| `config/roofing.json` | v4.0 — same FC cleanup |
| `config/windows.json` | v4.0 — same FC cleanup |
| `config/mortgage.json` | v4.0 — same FC cleanup |
| `config/insurance.json` | v4.0 — same FC cleanup |

### Files No Longer Imported (can be deleted)
- `src/scorer.js` — old rules engine (420 lines)
- `src/normalizer.js` — old pillar normalization (116 lines)
- `src/utils/hardkill.js` — old hard kill evaluator (106 lines)
- `src/api/fullcontact.js` — FullContact client (291 lines)

### How It Works Now

```
Lead arrives (passed eHawk upstream)
    │
    ▼
┌─────────────────────────────────────────┐
│  1. Call 3 APIs in parallel             │
│     Trestle + BatchData + TrustedForm   │
│                                         │
│  2. Quick hard-kill check               │
│     (invalid phone, bot, pre-pop,       │
│      mobile/manufactured, condo/solar)  │
│     → Saves $0.003 on obvious rejects   │
│                                         │
│  3. Prepare 21 stripped fields           │
│     prepareFieldsForLLM(apiData, vert)  │
│                                         │
│  4. Call Anthropic Sonnet               │
│     scoreLead(apiData, vertical, name)  │
│     → Returns { tier, score,            │
│        confidence, reasons, concerns }  │
│                                         │
│  5. Map tier → price                    │
│     Gold=$95, Silver=$65, Bronze=$40    │
└─────────────────────────────────────────┘
```

### Key Implementation Details
- `src/llm-scorer.js` contains SOLAR_PROMPT and ROOFING_PROMPT as string constants
- `prepareFieldsForLLM()` maps flat API namespace (e.g., `trestle.phone.is_valid`) to clean LLM field names (e.g., `phone.is_valid`)
- `scoreLead()` calls Anthropic API directly via fetch (no SDK dependency)
- JSON parsing handles both raw JSON and code-block-wrapped responses from the LLM
- `checkQuickHardKills()` in index.js catches obvious rejects before the LLM call
- Response includes `llm_response` field (replaces old `pillar_breakdown` and `field_scores`)

### Cost Impact
- Remove: FullContact $0.02/lead
- BatchData: $0.10/lead (full-attributes key — Quick Lists + Core + Listing + Permit)
- Add: Anthropic Sonnet ~$0.003/lead
- **Total: ~$0.388/lead** (Trestle $0.035 + BatchData $0.10 + TrustedForm $0.25 + Anthropic $0.003)
- Plus: Better tier placement = higher revenue per lead

---

## 10. Production vs Backtest — Developer Guide

### Production Flow (`src/index.js`)

Real-time scoring in the Lambda. Lead arrives, gets scored, response returned in <3s.

```
Lead arrives (passed eHawk) → validate input → normalize phone
  → Call 3 APIs in parallel (Trestle + BatchData + TrustedForm)
  → checkQuickHardKills() [saves LLM cost on obvious rejects]
  → scoreLead() [Anthropic Sonnet, 21 stripped fields]
  → Map tier → route to buyer → return SIO response
```

**Files**:
- `src/index.js` — Lambda handler, API orchestration, hard-kill pre-check
- `src/llm-scorer.js` — LLM prompts (LOCKED), `prepareFieldsForLLM()`, `scoreLead()`
- `src/api/trestle.js`, `src/api/batchdata.js`, `src/api/trustedform.js` — API clients

### Backtest Flow (`dry-run/sew-v4-backtest.mjs`)

Offline batch processing for validation. Reads CSV of historical leads, enriches + scores.

```
Load CSV → dedup by phone → load existing enrichment & LLM scores
  → For each lead:
    - If enrichment exists: reuse saved api_data (skip API calls)
    - If LLM score exists: reuse saved score (skip Anthropic call)
    - If new: call 3 APIs + Anthropic
  → Save results to JSON + CSV
```

**Key difference: `age_seconds` neutralization**
- TrustedForm returns `age_seconds` (time since form submission)
- In production: certs are fresh (seconds/minutes old) — `age_seconds` is stored but **NOT scored** (not in the 21 LLM fields, not in hard-kill checks)
- In backtest: certs are days/weeks old — `age_seconds` is neutralized (set to null) for safety

**Both production and backtest use the same**:
- `scoreLead()` function from `src/llm-scorer.js`
- `prepareFieldsForLLM()` for field mapping (21 fields, no age_seconds)
- Same API clients (Trestle, BatchData, TrustedForm)
- Same locked v4 prompts

### Running Backtests

```bash
# Preflight (test 1 lead — costs ~$0.39)
node dry-run/sew-v4-backtest.mjs

# Full run (all leads — costs vary by new leads)
node dry-run/sew-v4-backtest.mjs --run

# Resume from checkpoint after interruption
node dry-run/sew-v4-backtest.mjs --resume

# Re-score with LLM only (enrichment already saved — costs ~$0.003/lead)
node dry-run/sew-v4-backtest.mjs --rescore
```

### Backtest Dedup Logic
1. Deduplicates within CSV by phone (keeps first occurrence)
2. Loads existing enrichment from `dry-run/*-results.json` files (phone → api_data map)
3. Loads existing LLM v4 scores from `dry-run/llm-v4-*-results.json` (email → score map)
4. Only calls APIs for truly new leads (saves money)
5. Only calls Anthropic for leads without existing LLM v4 scores

### Environment Variables Required

| Variable | Required By | Notes |
|----------|-------------|-------|
| `TRESTLE_API_KEY` | Production + Backtest | x-api-key header |
| `BATCHDATA_API_KEY` | Production + Backtest | Bearer token, full-attributes key |
| `TRUSTEDFORM_API_KEY` | Production + Backtest | Basic auth password |
| `ANTHROPIC_API_KEY` | Production + Backtest | x-api-key header, Sonnet model |
| `AWS_REGION` | Production only | DynamoDB region |
| `DYNAMO_*` | Production only | Table names for logging |

---

## 10a. SIO budget, post-score caps, direct buyers

| Mechanism | Location | Notes |
|-----------|----------|--------|
| **SIO wall clock** | `SIO_BUDGET_MS` in `src/utils/constants.js` (default 5800ms, env `SIO_BUDGET_MS`) | From handler `startTime`. Merged abort signal passed into `scoreLead`. On abort: enrichment-only fast path (Silver default, score 0, synthetic `llm_response`). |
| **Four tier caps** | `src/utils/post-score-tier-caps.js` | Runs after legacy post-LLM enforcement, before Silver floor. Renter cap only on `HOME_SERVICES_VERTICALS` (not mortgage/insurance). |
| **Silver floor** | `src/index.js` | Skipped when `timeoutFastPath` — fast-path score 0 is not LLM-comparable. |
| **Direct buyers Gold-only** | `config.direct_buyers_gold_only` on vertical JSON + `src/router.js` | When `true` and tier is Silver → `decision: hold`. When DynamoDB buyer matching exists, replace HOLD with routing to non-direct buyers if applicable. |

---

## 11. Next Steps

1. **Run more backtest data** through locked v4 prompts to validate with larger sample
2. **Windows vertical** — 198 leads with enrichment, needs disposition matching and prompt creation
3. **Mortgage/Insurance** — No data yet, prompts TBD
