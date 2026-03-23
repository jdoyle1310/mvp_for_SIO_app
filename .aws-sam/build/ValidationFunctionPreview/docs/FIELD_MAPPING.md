# Field-to-Signal-Group Mapping

How API response fields map to the 5 scoring signal groups. The LLM receives these exact field names as JSON and scores holistically across all groups.

**Key rule:** `null` fields are NEUTRAL — the LLM ignores them and scores based on what IS present. If an entire signal group is null (e.g., no TrustedForm cert), the LLM scores using the remaining groups.

---

## A. CONTACTABILITY (highest weight — all verticals)

| LLM Field | API Source | Values |
|-----------|-----------|--------|
| `phone.is_valid` | Trestle | `true`/`false` — false = INSTANT REJECT |
| `phone.contact_grade` | Trestle | A (best) → F (worst). F + activity < 40 = Bronze cap |
| `phone.activity_score` | Trestle | 0-100. Higher = phone actively used |
| `phone.line_type` | Trestle | Mobile (best), Landline (ok), FixedVOIP (concern), NonFixedVOIP (Bronze cap) |
| `email.is_valid` | Trestle | `true`/`false` |

## B. IDENTITY VERIFICATION (weight varies by vertical)

| LLM Field | API Source | Values |
|-----------|-----------|--------|
| `phone.name_match` | Trestle | `true`/`false` — phone registered to this person? |
| `email.name_match` | Trestle | `true`/`false` — email belongs to this person? |
| `address.name_match` | Trestle | `true`/`false` — property records show this name? |
| `owner_name` | BatchData | Name on deed — LLM compares against lead name |

**Vertical-specific weight:**
- **Gutters, Painting, Plumbing**: REDUCED — low/mid ticket, single match is fine for Gold
- **Bathroom Remodel, Insurance**: ELEVATED — high ticket or fraud risk
- **Kitchen Remodel, Mortgage**: STRICTEST — highest ticket / federal crime risk. Both phone + address must match for Gold

## C. PROPERTY QUALIFICATION (varies by vertical)

### Core fields (all verticals):

| LLM Field | API Source | Values |
|-----------|-----------|--------|
| `owner_occupied` | BatchData | `confirmed_owner` (good), `confirmed_renter` (strong negative for most verticals) |
| `property_type` | BatchData | SFR (good), Townhouse (ok), Condo (ok), Mobile/Manufactured = INSTANT REJECT |
| `free_and_clear` | BatchData | `true`/`false` — **INVERTED for insurance** (negative) and **strong positive for mortgage** |
| `high_equity` | BatchData | `true`/`false` |
| `address.is_valid` | Trestle | `true`/`false` |

### Vertical-specific fields:

| LLM Field | API Source | Verticals |
|-----------|-----------|-----------|
| `estimated_value` | BatchData | Solar, Roofing, Windows, HVAC, Siding, Bath, Kitchen, Flooring, Insurance, Mortgage |
| `year_built` | BatchData | Roofing, Windows, HVAC, Siding, Gutters, Plumbing, Bath, Kitchen, Flooring, Insurance |
| `sale_propensity` | BatchData | Solar, Roofing, Windows, HVAC, Siding, Gutters, Painting, Bath, Kitchen, Flooring, Insurance, Mortgage |
| `length_of_residence_years` | BatchData | Roofing, Windows, HVAC, Siding, Gutters, Painting, Plumbing, Bath, Kitchen, Flooring, Mortgage |
| `recently_sold` | BatchData | Roofing, HVAC, Bath, Kitchen, Flooring, Insurance, Mortgage |
| `sq_ft` | BatchData | Insurance |
| `solar_permit` | BatchData | Solar |
| `roof_permit` | BatchData | Roofing, Insurance |
| `properties_count` | BatchData | Insurance, Mortgage |
| `inherited` | BatchData | Insurance, Mortgage |
| `absentee_owner` | BatchData | Insurance, Mortgage |
| `active_listing` | BatchData | Mortgage |
| `tax_lien` | BatchData | Windows, HVAC, Kitchen, Mortgage |
| `pre_foreclosure` | BatchData | Windows, HVAC, Kitchen, Mortgage |
| `mortgage_total_payment` | BatchData | Solar |
| `email.is_deliverable` | Trestle | Solar, Windows |

## D. FINANCIAL CAPACITY

| LLM Field | API Source | Values |
|-----------|-----------|--------|
| `household_income` | FullContact | Currently null (API dropped). Under $25K = INSTANT REJECT |
| `living_status` | FullContact | Currently null (API dropped). "Own" = slight positive |

**Note:** FullContact was dropped — both fields are always null. LLM treats null as neutral. These fields remain in the code for future re-integration.

## E. FORM BEHAVIOR (requires TrustedForm cert URL)

| LLM Field | API Source | Values |
|-----------|-----------|--------|
| `form_input_method` | TrustedForm | `typing_only`/`typing_autofill`/`autofill_only` (normal), `typing_paste` (slight concern), `pre-populated_only` = INSTANT REJECT, `paste_only` (concern) |
| `bot_detected` | TrustedForm | `true` = INSTANT REJECT, `false` = ok |
| `confirmed_owner` | TrustedForm | `verified` = strong positive |
| `age_seconds` | TrustedForm | Seconds since form submit. <300 = fresh (positive), >86400 = stale (strong negative) |

**If no TrustedForm cert URL is provided:** All 4 fields are null. LLM ignores the entire group and scores on groups A-D only. No penalty.

---

## Instant Rejects (any one = Reject tier, score 0-10)

- `phone.is_valid` = false
- `property_type` = "Mobile/Manufactured"
- `form_input_method` = "pre-populated_only"
- `bot_detected` = true
- `household_income` < $25,000
- `owner_occupied` = "confirmed_renter" (Solar and Windows ONLY)

## Signal Inversions by Vertical

| Field | Home Services | Insurance | Mortgage |
|-------|--------------|-----------|----------|
| `free_and_clear` | Positive | **NEGATIVE** | **STRONG POSITIVE** |
| `recently_sold` | Neutral/negative | Positive (new policy need) | **NEGATIVE** |
| `owner_occupied` = renter | Hard reject (most) | Not hard kill | Not hard kill |
| `roof_permit` | N/A | **POSITIVE** (risk signal) | N/A |

---

## Tier Thresholds

| Tier | Score Range |
|------|------------|
| Gold | 70 - 100 |
| Silver | 45 - 69 |
| Bronze | 20 - 44 |
| Reject | 0 - 19 |
