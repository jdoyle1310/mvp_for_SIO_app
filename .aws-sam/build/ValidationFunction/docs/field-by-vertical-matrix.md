# GreenWatt Field-by-Vertical Scoring Matrix
> Generated: 2026-03-17
> Covers: 13 verticals (3 validated + 10 research-based)
> Source: Cross-vertical backtest data (solar 1,152 / roofing 201 / windows 170 leads) + market research agents

> **CALIBRATION NOTE:** The +/- point values in this document are internal calibration references for tuning the directional language in the LLM prompts. They are NOT fed to the model. The actual prompts use directional language only (slight/moderate/strong positive/negative) and the LLM assigns the final score.

---

## How to Read This Document

- **Validated verticals** (solar, roofing, windows): Thresholds come from real dispo data with proven appointment/sale correlations
- **Research-based verticals** (all others): Thresholds derived from industry research, marked `[UNVALIDATED]` — will need backtest confirmation
- **Direction**: Positive/Negative/Neutral — how the field affects lead quality
- **Strength**: How much weight to give the signal (Strong > Moderate > Slight > Neutral)
- **Hard Kill**: Instant reject (score 0-19), bypasses LLM scoring entirely

---

## 1. RENTER / CONDO / COMMERCIAL Treatment Matrix

The single most important vertical differentiation. These three fields completely change meaning across verticals.

### confirmed_renter

| Vertical | Treatment | Reasoning |
|----------|-----------|-----------|
| **Solar** | **NEUTRAL** | Validated: renters convert at 16.4% vs owners 14.2%. DO NOT penalize. |
| **Roofing** | Strong negative / Bronze cap | Renters can't authorize roof replacement |
| **Windows** | Strong negative / Bronze cap | Renters can't authorize window replacement |
| **HVAC** | Strong negative / Bronze cap | Renters can't replace HVAC systems [UNVALIDATED] |
| **Siding** | Strong negative / Bronze cap | Renters can't authorize siding replacement [UNVALIDATED] |
| **Gutters** | Moderate negative | Lower ticket — some renters get landlord approval, but uncommon [UNVALIDATED] |
| **Painting** | Moderate negative | Renters DO paint interiors with landlord approval [UNVALIDATED] |
| **Plumbing** | Moderate negative | Renters DO call plumbers for emergencies [UNVALIDATED] |
| **Bathroom Remodel** | Strong negative / near hard kill | Renters can't authorize $15-30K remodels [UNVALIDATED] |
| **Kitchen Remodel** | **HARD KILL** | 95%+ of kitchen remodels are owner-occupants [UNVALIDATED] |
| **Flooring** | Strong negative | Renters can't authorize flooring replacement [UNVALIDATED] |
| **Insurance** | Moderate negative only (-30) | Renters buy HO-4 renters insurance — ~40% penetration [UNVALIDATED] |
| **Mortgage** | **NEUTRAL to slight positive** | Renters are first-time homebuyer candidates [UNVALIDATED] |

### property_type = Condominium

| Vertical | Treatment | Reasoning |
|----------|-----------|-----------|
| **Solar** | **HARD KILL** | Can't install solar on shared roof. 0% conversion validated. |
| **Roofing** | Moderate negative | HOA-managed, harder to close but not impossible |
| **Windows** | Moderate negative | Condo owners DO replace their own windows |
| **HVAC** | Slight negative | Condos have individual HVAC units, HOA rules vary [UNVALIDATED] |
| **Siding** | **HARD KILL** | HOA manages all exterior — condo owner cannot authorize [UNVALIDATED] |
| **Gutters** | Strong negative | HOA manages exterior including gutters [UNVALIDATED] |
| **Painting** | Slight negative | Condo owners DO paint interiors; exterior is HOA [UNVALIDATED] |
| **Plumbing** | Slight negative | Condo owners handle their own unit plumbing [UNVALIDATED] |
| **Bathroom Remodel** | **NEUTRAL** | Interior work — condo owners fully control bathroom [UNVALIDATED] |
| **Kitchen Remodel** | **NEUTRAL to slight positive** | Interior work — condo owners fully control kitchen [UNVALIDATED] |
| **Flooring** | Slight negative | HOA soundproofing rules, but owners DO replace flooring [UNVALIDATED] |
| **Insurance** | **NEUTRAL** | Condo owners need HO-6 policies. Valid lead. [UNVALIDATED] |
| **Mortgage** | **NEUTRAL** | Condos need mortgages. Not negative. [UNVALIDATED] |

### property_type = Commercial

| Vertical | Treatment | Reasoning |
|----------|-----------|-----------|
| **Solar** | **NEUTRAL** | Validated: 21.4% appt rate, above base rate |
| **Roofing** | Strong negative | Residential roofing focus |
| **Windows** | Strong negative / Silver cap | 4.2% vs 8.3% base rate validated |
| **HVAC** | Moderate negative | Commercial HVAC exists but different market [UNVALIDATED] |
| **Siding** | Strong negative | Residential siding focus [UNVALIDATED] |
| **Gutters** | Slight negative | Commercial gutter work exists [UNVALIDATED] |
| **Painting** | Slight negative | Commercial painting is a real market [UNVALIDATED] |
| **Plumbing** | Slight negative | Most plumbers serve both markets [UNVALIDATED] |
| **Bathroom Remodel** | Moderate negative | Residential remodelers focus on residential [UNVALIDATED] |
| **Kitchen Remodel** | **HARD KILL** | Not a residential kitchen remodel target [UNVALIDATED] |
| **Flooring** | Moderate negative | Separate commercial flooring market [UNVALIDATED] |
| **Insurance** | Moderate negative | Personal vs commercial lines are different [UNVALIDATED] |
| **Mortgage** | Moderate negative | Residential vs commercial mortgage are different [UNVALIDATED] |

---

## 2. year_built — Peak Eras by Vertical

Every vertical has a completely different "sweet spot" for home age based on material/system lifecycles.

| Vertical | Peak Era | Reasoning | Strength |
|----------|----------|-----------|----------|
| **Solar** | Not scored | Year built doesn't predict solar conversion | N/A |
| **Roofing** | Pre-1990 slight positive, 2020+ slight negative | Older roofs need replacement | Slight |
| **Windows** | 1970-1989 peak (+31% of appts) | Pre-1970 neutral (underperforms) | **Strong** (validated) |
| **HVAC** | 1990-2004 peak (R-22 phaseout era) | R-22 refrigerant phased out 2020, systems from this era need replacement | Moderate [UNVALIDATED] |
| **Siding** | 1960-1979 peak (aluminum siding era) | Aluminum siding aging; vinyl 1980-2000 also aging | Moderate [UNVALIDATED] |
| **Gutters** | Slight signal only | Weather damage, not age-based | Slight [UNVALIDATED] |
| **Painting** | Not strongly scored | All homes need painting regardless of age | Minimal [UNVALIDATED] |
| **Plumbing** | **1975-1996 ABSOLUTE PEAK** (polybutylene) | 6-10M homes with failure-prone polybutylene pipes | **Strong** [UNVALIDATED] |
| **Bathroom Remodel** | 1970-1999 (80s-90s fixtures maximally dated) | Pre-granite, pre-modern era bathrooms | Moderate [UNVALIDATED] |
| **Kitchen Remodel** | 1960-1989 (pre-granite, pre-stainless-steel) | Highest aesthetic obsolescence era | Moderate [UNVALIDATED] |
| **Flooring** | 1980-1999 ("carpet era" peak) | Original carpet/vinyl from this era needs replacement | Moderate [UNVALIDATED] |
| **Insurance** | **2000-2015 peak** (INVERTED from home services) | Old enough to have real replacement value, new enough for easy underwriting | **Strong** [UNVALIDATED] |
| **Mortgage** | Largely neutral (5-10 all ages) | Age doesn't affect mortgage eligibility | Slight [UNVALIDATED] |

---

## 3. estimated_value — Thresholds by Vertical

Property value means completely different things across verticals.

| Vertical | < $100K | $100-150K | $150-300K | $300-500K | $500K+ | Strongest Signal? |
|----------|---------|-----------|-----------|-----------|--------|-------------------|
| **Solar** | Slight neg | Neutral | Slight pos | Moderate pos | Strong pos | No — contactability matters more |
| **Roofing** | Not strongly scored | — | — | — | — | No |
| **Windows** | **Bronze cap (0 appts)** | Slight neg | Neutral | Moderate pos | **Strong pos (46% of appts)** | **YES — #1 signal** (validated) |
| **HVAC** | Slight neg | Neutral | Slight pos | Moderate pos | Moderate pos | No [UNVALIDATED] |
| **Siding** | Slight neg | Slight neg ($125K floor) | Slight pos | Moderate pos ($400K+) | Strong pos | Moderate [UNVALIDATED] |
| **Gutters** | Slight neg ($75K floor) | Neutral | Neutral | Slight pos | Slight pos | No — lower ticket [UNVALIDATED] |
| **Painting** | Slight neg ($75K floor) | Neutral | Neutral | Slight pos | Slight pos | No [UNVALIDATED] |
| **Plumbing** | Neutral | Neutral | Neutral | Slight pos | Slight pos | No — necessity driven [UNVALIDATED] |
| **Bath Remodel** | Slight neg | Slight neg ($150K floor) | Sweet spot | **$300-750K peak** | Strong pos | Moderate [UNVALIDATED] |
| **Kitchen Remodel** | **-30** | -20 | Slight neg ($200K floor) | **$300K+ sweet spot** | **Strongest pos** | **YES — property/financial pillar 0.35** [UNVALIDATED] |
| **Flooring** | Slight neg ($125K floor) | Neutral | Slight pos | Moderate pos ($400K+) | Strong pos | Moderate [UNVALIDATED] |
| **Insurance** | **-25** (<$50K) | +10 | +20 | +35 | **+50** | **YES — value = premium = commission** [UNVALIDATED] |
| **Mortgage** | **-25** (<$100K) | +5 | +15-20 | +30-45 | **+60** ($766K+ jumbo) | **YES — value = loan size = commission** [UNVALIDATED] |

---

## 4. sale_propensity — Direction FLIPS by Vertical

This is the single most important field differentiation across verticals.

| Vertical | Direction | Strength | Reasoning |
|----------|-----------|----------|-----------|
| **Solar** | **Negative** | Moderate | Selling = won't install panels. Validated. |
| **Roofing** | **Negative** | Moderate | Selling = won't invest in new roof |
| **Windows** | **POSITIVE** | Strong | Pre-sale improvement. Windows are #1 realtor recommendation. Validated. |
| **HVAC** | Slight negative | Slight | Less likely to replace HVAC if moving [UNVALIDATED] |
| **Siding** | **STRONG POSITIVE** | Strong | Fiber cement 80.2% cost recovery. Pre-sale curb appeal. [UNVALIDATED] |
| **Gutters** | **Moderate positive** | Moderate | Cheap curb appeal fix ($1.5-3K), 80-90% ROI at resale, flagged in 35-40% of home inspections [UNVALIDATED] |
| **Painting** | **STRONG POSITIVE (107% ROI)** | Strong | 36% of realtors recommend pre-listing painting [UNVALIDATED] |
| **Plumbing** | Neutral | Neutral | Emergency-driven, not sale-related [UNVALIDATED] |
| **Bath Remodel** | **Positive (73.7% ROI)** | Moderate | Pre-sale bathroom refresh is common [UNVALIDATED] |
| **Kitchen Remodel** | **Positive (96.1% minor ROI)** | Moderate | #1 ROI remodel for resale [UNVALIDATED] |
| **Flooring** | **STRONGEST POSITIVE (147% ROI hardwood refinish)** | Strong | #1 pre-sale interior project [UNVALIDATED] |
| **Insurance** | **STRONG POSITIVE (+40 at 80+)** | Strong | Selling = buying = MANDATORY new policy [UNVALIDATED] |
| **Mortgage** | **STRONG POSITIVE (+35 at 80+)** | Strong | Selling = needs purchase mortgage for next home [UNVALIDATED] |

---

## 5. free_and_clear — Direction Changes by Vertical

| Vertical | Direction | Points | Reasoning |
|----------|-----------|--------|-----------|
| **Solar** | Reverse signal (DO NOT weight) | 0 | Validated: free_and_clear solar leads performed worse |
| **Roofing** | Slight positive | +5 | Slight indicator of stability |
| **Windows** | Not strongly scored | 0 | — |
| **HVAC** | Slight positive | +5 | Homeowner stability [UNVALIDATED] |
| **Siding** | Slight positive | +5 | [UNVALIDATED] |
| **Gutters** | Not scored | 0 | Lower ticket doesn't need financing proxy [UNVALIDATED] |
| **Painting** | Not scored | 0 | [UNVALIDATED] |
| **Plumbing** | Not scored | 0 | Emergency-driven [UNVALIDATED] |
| **Bath Remodel** | Moderate positive | +15 | HELOC access for financing [UNVALIDATED] |
| **Kitchen Remodel** | **Moderate positive** | **+20** | Full equity = easy HELOC for $50K+ remodel [UNVALIDATED] |
| **Flooring** | Slight positive | +10 | [UNVALIDATED] |
| **Insurance** | **NEGATIVE** | **-15** | No lender mandate = 12-20% drop coverage entirely [UNVALIDATED] |
| **Mortgage** | **STRONGLY POSITIVE** | **+40** | 100% equity = maximum HELOC/cash-out refi [UNVALIDATED] |

---

## 6. length_of_residence — Lifecycle Mapping

| Vertical | Peak Range | Reasoning | Direction (long residence) |
|----------|------------|-----------|---------------------------|
| **Solar** | Not strongly scored | — | Neutral |
| **Roofing** | Not strongly scored | — | Neutral |
| **Windows** | 8-15 years | Original windows aging | Positive (validated) |
| **HVAC** | 10-20 years | HVAC system lifespan | Positive [UNVALIDATED] |
| **Siding** | 20-40 years (vinyl lifespan) | Material lifecycles | Positive [UNVALIDATED] |
| **Gutters** | **15-25yr peak** (aluminum gutter lifespan 20-30yr) | Direct lifecycle alignment | **Moderate positive** [UNVALIDATED] |
| **Painting** | 5-10 years (exterior repaint cycle) | Natural repaint cycle | Moderate positive [UNVALIDATED] |
| **Plumbing** | **20+ years strongest** | Pipe aging beyond design life | **Strong positive** [UNVALIDATED] |
| **Bath Remodel** | 8-15 years | Fixture/style cycling | Moderate positive [UNVALIDATED] |
| **Kitchen Remodel** | **Bimodal: 0-2yr (new buyers) AND 8-15yr** | New owners update + long-term cycling | Moderate [UNVALIDATED] |
| **Flooring** | **Bimodal: 0-2yr AND 10-15yr** | New owners + replacement cycle | Moderate [UNVALIDATED] |
| **Insurance** | **0-1yr peak (INVERTED)** | Recent movers are active insurance shoppers | **Negative** (long = inertia) [UNVALIDATED] |
| **Mortgage** | **5-15yr peak** | Equity built, original rate may be high | **Complex** — sweet spot [UNVALIDATED] |

---

## 7. recently_sold — Direction Flips

| Vertical | Direction | Points | Reasoning |
|----------|-----------|--------|-----------|
| **Solar** | Neutral | 0 | Not predictive |
| **Roofing** | Neutral | 0 | Not predictive |
| **Windows** | Moderate positive | +15 | New buyers update windows. Validated. |
| **HVAC** | Neutral | 0 | [UNVALIDATED] |
| **Siding** | Slight positive | +5 | New buyers may update exterior [UNVALIDATED] |
| **Gutters** | Neutral | 0 | [UNVALIDATED] |
| **Painting** | Moderate positive | +15 | New buyers paint [UNVALIDATED] |
| **Plumbing** | Neutral | 0 | [UNVALIDATED] |
| **Bath Remodel** | Moderate positive | +15 | New buyers remodel outdated bathrooms [UNVALIDATED] |
| **Kitchen Remodel** | **Moderate positive** | **+20** | Kitchen is #1 room new homeowners remodel [UNVALIDATED] |
| **Flooring** | Moderate positive | +15 | New buyers replace flooring [UNVALIDATED] |
| **Insurance** | **STRONG POSITIVE** | **+35** | New owner MUST get new policy (mortgage-required) [UNVALIDATED] |
| **Mortgage** | **Negative** | **-15** | Just bought = has new mortgage, won't refi [UNVALIDATED] |

---

## 8. Permits — Meaning FLIPS Between Home Services and Financial

| Permit | Home Services Meaning | Insurance Meaning | Mortgage Meaning |
|--------|----------------------|-------------------|------------------|
| **solar_permit** | **Bronze cap** (already has solar) | Neutral (+5, adds to replacement cost) | Neutral (0) |
| **roof_permit** | **Bronze cap for roofing** (already done) | **STRONG POSITIVE (+25)** — new roof = insurable | Slight positive (+5, property condition) |
| **electrical_permit** | Neutral | **Positive (+15)** — resolves fire risk concern | Slight positive (+5) |
| **hvac_permit** | Bronze cap for HVAC | Positive (+10) | Slight positive (+5) |
| **addition_permit** | Slight positive (home improvement mode) | Positive (+10, higher replacement cost) | Moderate positive (+10, value increase) |

---

## 9. Financial Distress Signals — Treatment Varies Dramatically

| Signal | Home Services | Insurance | Mortgage |
|--------|-------------|-----------|----------|
| **tax_lien** | Strong negative (-25 to -30) | Strong negative (-25) | **Moderate negative (-15)** — may NEED refi to pay off lien |
| **pre_foreclosure** | Hard kill / strong negative | **Bronze cap** | **Moderate negative (-10)** — paradoxically may need foreclosure prevention refi |
| **has_foreclosure** | Hard kill | **Bronze cap** | Strong negative (-25) but NOT hard kill — waiting periods exist |

---

## 10. Identity Strictness by Vertical

Higher-ticket and financial verticals need tighter identity verification.

| Vertical | Identity Pillar Weight | Both Name Matches Required for Gold? | Both False = ? |
|----------|----------------------|--------------------------------------|----------------|
| **Solar** | Standard (0.05) | No (strong predictor, not required) | Bronze cap |
| **Roofing** | Standard | **Yes** (validated) | Bronze cap |
| **Windows** | Standard | **Yes** (validated) | Bronze cap |
| **HVAC** | Standard | No | Bronze cap [UNVALIDATED] |
| **Siding** | Standard | No | Bronze cap [UNVALIDATED] |
| **Gutters** | Standard | No (lower ticket) | Silver cap [UNVALIDATED] |
| **Painting** | Standard | No (lower ticket) | Silver cap [UNVALIDATED] |
| **Plumbing** | Standard | No (emergency = speed matters more) | Silver cap [UNVALIDATED] |
| **Bath Remodel** | Standard | Yes | Bronze cap [UNVALIDATED] |
| **Kitchen Remodel** | Elevated | **Yes** (high-ticket decision-maker) | Bronze cap [UNVALIDATED] |
| **Flooring** | Standard | No | Bronze cap [UNVALIDATED] |
| **Insurance** | **Elevated (0.22)** | **Yes** ($80B+/yr insurance fraud) | Bronze cap [UNVALIDATED] |
| **Mortgage** | **Strictest (0.22)** | **Yes** (mortgage fraud is federal crime) | Bronze cap + phone.name_match=false = Silver cap [UNVALIDATED] |

---

## 11. Pillar Weight Recommendations

Current system uses LLM soft-signal approach (not numeric pillar weights), but these inform the relative emphasis in the prompt:

| Vertical | Contact. | Identity | Fraud/Legal | Behavioral | Property/Financial | Notes |
|----------|----------|----------|-------------|------------|-------------------|-------|
| **Solar** | 0.13 | 0.05 | 0.35 | 0.28 | 0.19 | Validated |
| **Roofing** | 0.13 | 0.12 | 0.35 | 0.28 | 0.12 | Validated |
| **Windows** | 0.13 | 0.05 | 0.35 | 0.28 | 0.19 | Validated |
| **HVAC** | 0.13 | 0.05 | 0.35 | 0.28 | 0.19 | Derived from windows [UNVALIDATED] |
| **Siding** | 0.13 | 0.05 | 0.35 | 0.28 | 0.19 | Derived from roofing [UNVALIDATED] |
| **Gutters** | 0.15 | 0.05 | 0.35 | 0.30 | 0.15 | Lower ticket = contactability matters more [UNVALIDATED] |
| **Painting** | 0.15 | 0.05 | 0.30 | 0.30 | 0.20 | [UNVALIDATED] |
| **Plumbing** | **0.20** | 0.05 | 0.30 | 0.30 | 0.15 | Emergency = contactability paramount [UNVALIDATED] |
| **Bath Remodel** | 0.13 | 0.10 | 0.25 | 0.20 | **0.32** | High-ticket, contactability at validated floor [UNVALIDATED] |
| **Kitchen Remodel** | 0.13 | 0.10 | 0.25 | 0.20 | **0.32** | Highest ticket, contactability at validated floor [UNVALIDATED] |
| **Flooring** | 0.13 | 0.05 | 0.30 | 0.27 | 0.25 | [UNVALIDATED] |
| **Insurance** | 0.15 | **0.22** | 0.25 | 0.20 | **0.18** | Identity critical (fraud), property = premium [UNVALIDATED] |
| **Mortgage** | 0.13 | **0.22** | 0.25 | 0.15 | **0.25** | Identity + property/financial both critical, contactability at validated floor [UNVALIDATED] |

---

## 12. Lead Freshness (age_seconds) Sensitivity

| Vertical | Urgency Category | Half-Life | 1hr+ Penalty | 24hr+ Treatment |
|----------|-----------------|-----------|--------------|-----------------|
| **Solar** | Semi-planned | ~4-6 hours | Moderate negative | Strong negative |
| **Roofing** | Semi-planned | ~4-6 hours | Moderate negative | Strong negative |
| **Windows** | Planned | ~12-24 hours | Slight negative | Moderate negative |
| **HVAC** | **Emergency** | **~7-14 minutes** | **Strong negative** | Hard kill [UNVALIDATED] |
| **Siding** | Planned | ~12-24 hours | Slight negative | Moderate negative [UNVALIDATED] |
| **Gutters** | Semi-planned | ~2-6 hours | Moderate negative | Strong negative [UNVALIDATED] |
| **Painting** | Planned | ~12-24 hours | Slight negative | Moderate negative [UNVALIDATED] |
| **Plumbing** | **Emergency** | **~7-14 minutes** | **Strong negative** | Near hard kill [UNVALIDATED] |
| **Bath Remodel** | Planned | ~12-24 hours | Slight negative | Moderate negative [UNVALIDATED] |
| **Kitchen Remodel** | Planned | ~12-24 hours | Slight negative | Moderate negative [UNVALIDATED] |
| **Flooring** | Planned | ~12-24 hours | Slight negative | Moderate negative [UNVALIDATED] |
| **Insurance** | Semi-planned | ~2-6 hours | Moderate negative | Strong negative [UNVALIDATED] |
| **Mortgage** | **Time-sensitive** | **~23-70 minutes** | **Moderate negative** | Strong negative [UNVALIDATED] |

---

## 13. Mobile/Manufactured Treatment

| Vertical | Treatment | Reasoning |
|----------|-----------|-----------|
| **Solar** | **HARD KILL** | Can't install solar on mobile home. Validated 0%. |
| **Roofing** | **HARD KILL** | Different roofing system, not served by residential roofers |
| **Windows** | **HARD KILL** | Different window systems |
| **HVAC** | **NOT hard kill (-20)** | Mobile homes have HVAC systems that need replacement [UNVALIDATED] |
| **Siding** | Strong negative (-25) | Different siding systems [UNVALIDATED] |
| **Gutters** | **NOT hard kill (-15)** | Mobile homes can have gutter systems [UNVALIDATED] |
| **Painting** | **NOT hard kill (-10)** | Mobile homes can be painted [UNVALIDATED] |
| **Plumbing** | **NOT hard kill (-15)** | Mobile homes have plumbing [UNVALIDATED] |
| **Bath Remodel** | Moderate negative (-20) | Scope limited but possible [UNVALIDATED] |
| **Kitchen Remodel** | **NOT hard kill (-20)** | Mobile home kitchens can be remodeled, limited scope [UNVALIDATED] |
| **Flooring** | **NOT hard kill (-15)** | Mobile homes can get new flooring [UNVALIDATED] |
| **Insurance** | Moderate negative (-20) | Mobile/manufactured = specialty insurance, harder to place [UNVALIDATED] |
| **Mortgage** | Strong negative (-40) | Manufactured homes have different (chattel) lending [UNVALIDATED] |

---

## 14. absentee_owner / inherited / fix_and_flip — Investor Signals

| Signal | Home Services | Insurance | Mortgage |
|--------|-------------|-----------|----------|
| **absentee_owner** | Neutral to slight negative | **Positive (+20)** — needs landlord DP-3 policy | **Positive (+15)** — investment property loans |
| **inherited** | Neutral | **STRONG positive (+30)** — deceased's policy is void | **Positive (+15)** — 100% equity, needs financial product |
| **fix_and_flip** | Negative for solar (hard kill), neutral others | Slight negative (-10) — specialty insurance | **Positive (+15)** — repeat borrower |
| **properties_count > 2** | Not strongly scored | **STRONGEST positive (+30-40)** — each property needs a policy | **Strong positive (+20-25)** — multiple loan opportunities |

---

## 15. Fields to ADD to VERTICAL_FIELDS Map

Based on research, these fields should be added to `prepareFieldsForLLM()`:

```javascript
const VERTICAL_FIELDS = {
  solar:             ['email.is_deliverable', 'solar_permit', 'estimated_value', 'bd_age', 'sale_propensity', 'mortgage_total_payment'],
  roofing:           ['roof_permit', 'year_built', 'estimated_value', 'bd_age', 'sale_propensity', 'length_of_residence_years', 'recently_sold'],
  windows:           ['email.is_deliverable', 'year_built', 'estimated_value', 'tax_lien', 'pre_foreclosure', 'sale_propensity', 'bd_age', 'length_of_residence_years'],
  hvac:              ['year_built', 'estimated_value', 'hvac_permit', 'length_of_residence_years', 'sale_propensity', 'recently_sold', 'tax_lien', 'pre_foreclosure'],
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
```

### New FIELD_SOURCES entries needed:

```javascript
// Add to existing FIELD_SOURCES map:
'hvac_permit':              'batchdata.hvac_permit',
'properties_count':         'batchdata.properties_count',
'inherited':                'batchdata.inherited',
'absentee_owner':           'batchdata.absentee_owner',
'active_listing':           'batchdata.active_listing',
'sq_ft':                    'batchdata.sq_ft',
```

---

## 16. Key Signal Inversions Summary

Fields that flip direction between vertical categories. These are the most critical to get right:

| Field | Structural Home Services | Pre-Sale Home Services | Financial Products |
|-------|-------------------------|----------------------|-------------------|
| | (Solar, Roofing, HVAC) | (Windows, Siding, Painting, Flooring) | (Insurance, Mortgage) |
| **sale_propensity** | NEGATIVE | **POSITIVE** | **STRONGLY POSITIVE** |
| **recently_sold** | Neutral | **Positive** | Insurance: **+35** / Mortgage: **-15** |
| **free_and_clear** | Neutral/Negative | Slight positive | Insurance: **-15** / Mortgage: **+40** |
| **year_built (old)** | Positive (needs work) | Positive (needs work) | Insurance: **Negative** / Mortgage: Neutral |
| **roof_permit** | Bronze cap (already done) | Neutral | Insurance: **+25** / Mortgage: +5 |
| **absentee_owner** | Neutral/Negative | Neutral | **Positive (+15 to +20)** |
| **confirmed_renter** | Hard kill to strong neg | Strong negative | Insurance: -30 / Mortgage: **Neutral** |
| **properties_count** | Not scored | Not scored | **STRONG POSITIVE (+20 to +40)** |

---

## 17. Vertical-Specific Hard Kill Rules (for checkQuickHardKills)

Beyond universal hard kills (phone.is_valid=false, Mobile/Manufactured for structural, bot_detected, pre-populated_only, income<$25K):

| Vertical | Additional Hard Kills | Reasoning |
|----------|----------------------|-----------|
| **Solar** | Condominium | Can't install on shared roof (validated 0%) |
| **Kitchen Remodel** | confirmed_renter, commercial, corporate_owned, pre_foreclosure | High-ticket, homeowner-only [UNVALIDATED] |
| **Siding** | Condominium | HOA manages all exterior [UNVALIDATED] |
| **Mortgage** | corporate_owned | Cannot get residential mortgage [UNVALIDATED] |
| All others | No additional hard kills beyond universal | Conservative — let LLM handle until we have data |

---

## 18. Combo Signals by Vertical (Bonuses/Penalties)

### Kitchen Remodel Combos [UNVALIDATED]
| Signal | Effect | Reason Code |
|--------|--------|-------------|
| `sale_propensity > 60 + estimated_value > $300K` | +20 bonus | PRE_SALE_KITCHEN_REMODEL |
| `recently_sold + year_built < 2000` | +15 bonus | NEW_BUYER_DATED_KITCHEN |
| `bd_income > $100K + high_equity + estimated_value > $300K` | +25 bonus | KITCHEN_FINANCING_CONFIDENCE |
| `bd_income < $50K + low_equity` | Bronze cap | LOW_INCOME_LOW_EQUITY |
| `new_construction` | -40 | NEW_CONSTRUCTION_NO_REMODEL |

### Insurance Combos [UNVALIDATED]
| Signal | Effect | Reason Code |
|--------|--------|-------------|
| `recently_sold + ltv > 60` | +25 bonus | MANDATORY_INSURANCE_BUYER |
| `properties_count >= 3 + absentee_owner` | +25 bonus | MULTI_POLICY_INVESTOR |
| `inherited + free_and_clear` | +20 bonus | INHERITED_UNINSURED |
| `year_built < 1960 + no roof_permit + no electrical_permit` | -20 penalty | OLD_HOME_UNUPDATED |
| `roof_permit + year_built < 1980` | +15 bonus | OLD_HOME_NEW_ROOF_INSURABLE |
| `estimated_value > $400K + bd_income > $100K + sq_ft > 2500` | +20 bonus | PREMIUM_INSURANCE_CLIENT |

### Mortgage Combos [UNVALIDATED]
| Signal | Effect | Reason Code |
|--------|--------|-------------|
| `free_and_clear + estimated_value > $500K` | +30 bonus | MASSIVE_HELOC_OPPORTUNITY |
| `active_listing + estimated_value > $400K` | +20 bonus | HIGH_VALUE_PURCHASE_MORTGAGE |
| `bd_income > $100K + ltv < 80%` | +20 bonus | PRIME_REFI_CANDIDATE |
| `properties_count >= 3 + absentee_owner` | +20 bonus | MULTI_PROPERTY_INVESTOR |
| `free_and_clear + senior_owner` | +20 bonus | REVERSE_MORTGAGE_CANDIDATE |
| `mailing_vacant + confirmed_renter` | -40 penalty | MORTGAGE_FRAUD_RISK |
| `has_foreclosure + tax_lien` | -35 penalty | MULTI_DISTRESS_SIGNALS |

---

## Data Sources

### Validated (real dispo data)
- Solar: 1,152 leads, 11 sales, 85.4% appointment retention
- Roofing: 201 leads, 1 sale, 100% appointment retention
- Windows: 170 leads, 13 appointments, 92.3% appointment retention

### Research-Based (market research agents, March 2026)
- HVAC: R-22 phaseout data, HVAC system lifespan data, contractor market research
- Siding: Material lifecycle data, Remodeling Magazine Cost vs Value, pre-sale improvement ROI
- Gutters: Lower-ticket market dynamics, HOA management patterns
- Painting: NAR pre-sale improvement recommendations, repaint cycle data
- Plumbing: Polybutylene pipe era data (6-10M homes), emergency vs planned service patterns
- Bathroom Remodel: NKBA data, Houzz studies, fixture lifecycle, financing patterns
- Kitchen Remodel: Houzz Kitchen Trends Study, NKBA, JCHS Harvard data, HELOC financing patterns, Remodeling Magazine Cost vs Value
- Flooring: Pre-sale ROI data (147% hardwood refinish), carpet era lifecycle, bimodal ownership patterns
- Insurance: III data, NAIC regulatory frameworks, J.D. Power Home Insurance Study, carrier underwriting guidelines, FBI fraud estimates
- Mortgage: Fannie Mae/Freddie Mac guidelines, CFPB data, FHFA conforming limits, RESPA/TILA/Dodd-Frank frameworks, NAR buyer/seller profiles
