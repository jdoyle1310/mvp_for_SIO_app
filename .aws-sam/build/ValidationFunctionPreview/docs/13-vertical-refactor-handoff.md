# 13-Vertical Refactor — Handoff Document
> Generated: 2026-03-17
> Status: **IMPLEMENTED, NOT COMMITTED**
> Tests: 61/61 passing

---

## What Was Done

3 files changed in `/Users/jacksondoyle/greenwatt-solar/`:

### 1. `src/utils/constants.js`
`VALID_VERTICALS` expanded from 3 → 13:
```
solar, roofing, windows
+ hvac, siding, gutters, painting, plumbing, bathroom_remodel, kitchen_remodel, flooring, insurance, mortgage
```

### 2. `src/llm-scorer.js` — Full Rewrite (v5.0)
Replaced 3 separate ~100-line prompts (SOLAR_PROMPT, ROOFING_PROMPT, WINDOWS_PROMPT) with:

- **`BASE_PROMPT`** (~80 lines) — Cross-vertical validated logic with 9 `{{placeholders}}`
- **`VERTICAL_CONTEXTS`** — Map of 13 entries, each providing vertical-specific placeholder values
- **`buildPrompt(vertical)`** — Assembles BASE_PROMPT + vertical context
- **`getPromptForVertical(vertical)`** — Calls buildPrompt()

**Validated verticals** (solar, roofing, windows) reproduce v4.2 logic exactly.
**New verticals** use conservative defaults with `[UNVALIDATED]` tags.

#### Key Signal Inversions Handled

| Signal | Solar/Roofing | Windows/Siding/Painting/Flooring | Insurance | Mortgage |
|--------|--------------|----------------------------------|-----------|----------|
| sale_propensity | NEGATIVE | **POSITIVE** | **STRONG POSITIVE** | **STRONG POSITIVE** |
| confirmed_renter | NEUTRAL (solar) / Strong neg (roofing) | Strong negative | Moderate neg only | **NEUTRAL** |
| free_and_clear | Neutral | Slight positive | **NEGATIVE** | **STRONGLY POSITIVE** |
| roof_permit | Bronze cap | Neutral | **STRONG POSITIVE** | Slight positive |
| Mobile/Manufactured | HARD KILL | HARD KILL | Moderate neg (NOT kill) | Strong neg (NOT kill) |

#### Field Mappings Expanded

`VERTICAL_FIELDS` — 13 entries (was 3). Each vertical gets only relevant fields.

`FIELD_SOURCES` — Added 6 new entries:
```javascript
'properties_count':  'batchdata.properties_count',
'inherited':         'batchdata.inherited',
'absentee_owner':    'batchdata.absentee_owner',
'active_listing':    'batchdata.active_listing',
'sq_ft':             'batchdata.sq_ft',
```

### 3. `src/index.js`
`checkQuickHardKills()` updated:
- Mobile/Manufactured → hard kill for **structural verticals only** (solar, roofing, windows, siding)
- Condominium → hard kill for **solar + siding** only
- All other verticals handle these in LLM prompt (not hard kill)

---

## Verification Results
- ✅ 61/61 tests pass (`npm test`)
- ✅ All 13 verticals build with no leftover `{{placeholders}}`
- ✅ Prompt sizes: 6,557–8,731 chars per vertical
- ✅ Field mappings verified for all verticals

---

## Key Reference Files

| File | Purpose |
|------|---------|
| `docs/field-by-vertical-matrix.md` | Full 18-section scoring matrix (all 13 verticals) |
| `src/llm-scorer.js` | The refactored scorer (v5.0) |
| `src/utils/constants.js` | VALID_VERTICALS list |
| `src/index.js` | Hard kill logic |
| `tests/hardkill.test.js` | Hard kill tests (all pass) |

---

## To Continue in New Chat

Paste this prompt:

```
Continue the GreenWatt 13-vertical refactor. The implementation is DONE but NOT committed.

Read these files to verify current state:
- greenwatt-solar/src/llm-scorer.js (v5.0 — BASE_PROMPT + VERTICAL_CONTEXTS)
- greenwatt-solar/src/utils/constants.js (13 verticals)
- greenwatt-solar/src/index.js (updated checkQuickHardKills)
- greenwatt-solar/docs/field-by-vertical-matrix.md (scoring reference)
- greenwatt-solar/docs/13-vertical-refactor-handoff.md (this doc)

Run `npm test` to verify 61/61 pass, then commit.
```

---

## What's Next After Commit
1. Smoke test with a real lead for each new vertical (dry-run mode)
2. Build vertical configs in `config/` for new verticals (hard kill flags, pillar weights)
3. Shadow-test unvalidated verticals — score but don't filter until dispo data validates
4. As dispo data comes in, promote `[UNVALIDATED]` tags to validated thresholds
