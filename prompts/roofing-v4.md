# Roofing Lead Scoring Prompt — v4.1

**Vertical**: Roofing
**Model**: Claude Sonnet (`claude-sonnet-4-20250514`)
**Date locked**: 2026-03-13
**Validated on**: 320 leads (201 with dispo), 2 buyers (Mr. Roofing + Trinity Solar)
**Cost**: ~$0.003/lead (~1,500 input + 200 output tokens)

## v4.1 Validation Results

| Metric | Value |
|--------|-------|
| Leads scored | 320 |
| Leads with dispo | 201 |
| Spend reduction | 31.3% (rejecting Bronze + Reject) |
| Appointment retention | 100% (10/10 appointments in Gold+Silver) |
| Conversion retention | 100% (11/11 conversions in Gold+Silver) |
| Contract retention | 100% (1/1 contract in Gold) |
| Bronze+Reject conversion rate | 0% (0/63) |
| Gold conversion rate | 13.0% |
| Silver conversion rate | 6.2% |

## Roofing-Specific Rules (vs Solar)

| Rule | Roofing Treatment | Solar Treatment | Why Different |
|------|-------------------|-----------------|---------------|
| confirmed_renter | STRONG NEGATIVE (Bronze cap) | NEUTRAL | Renters don't pay for roof replacement; solar renters can lease panels |
| Renter override | Silver at best (if high_equity + both name matches) | N/A (neutral) | BatchData ownership data can be wrong — false positive protection |
| Condominium | Moderate negative | INSTANT REJECT | HOA-managed roofs harder to close but not impossible |
| Commercial property | Strong negative | NEUTRAL | Residential roofers can't serve commercial properties |
| roof_permit | Bronze cap | N/A | Already had roof work — analogous to solar_permit |
| solar_permit | N/A | Bronze cap | Not relevant to roofing |
| year_built | Pre-1990 slight positive | N/A | Older homes more likely to need roofing work |
| Identity verification | CRITICAL — name match convergence required for Gold | Important but not as strict | Identity signals are strongest predictor of roofing lead quality |
| free_and_clear | Slight positive only | Strong positive | Doesn't predict roofing lead quality as strongly as solar |
| form_input_method typing_only | NEUTRAL | Normal | Doesn't predict quality for roofing |

## Cross-Vertical Signal Confirmations

These signals work identically in both solar and roofing:

| Signal | Both Verticals | Action |
|--------|---------------|--------|
| Grade F + Activity < 40 | 0% appointment rate | Bronze cap |
| NonFixedVOIP | 0% appointment rate | Bronze cap |
| Grade F + NonFixedVOIP | Severe negative combo | Reject |
| Permit on file | 0% conversion | Bronze cap |
| Pre-populated form | Bot/aggregator | Instant reject |
| Bot detected | Fraud | Instant reject |
| Grade A + confirmed_owner + no permit | Highest conversion | Gold eligible |

## Fields Sent to LLM (22 fields)

| Group | Field | Source |
|-------|-------|--------|
| Contactability | phone.is_valid | trestle.phone.is_valid |
| Contactability | phone.contact_grade | trestle.phone.contact_grade |
| Contactability | phone.activity_score | trestle.phone.activity_score |
| Contactability | phone.line_type | trestle.phone.line_type |
| Contactability | email.is_valid | trestle.email.is_valid |
| Identity | phone.name_match | trestle.phone.name_match |
| Identity | email.name_match | trestle.email.name_match |
| Identity | address.name_match | trestle.address.name_match |
| Identity | owner_name | _batchdata.owner_name |
| Property | owner_occupied | batchdata.owner_occupied |
| Property | property_type | batchdata.property_type |
| Property | free_and_clear | batchdata.free_and_clear |
| Property | high_equity | batchdata.high_equity |
| Property | roof_permit | batchdata.roof_permit |
| Property | address.is_valid | trestle.address.is_valid |
| Property | year_built | batchdata.year_built |
| Financial | household_income | fullcontact.household_income |
| Financial | living_status | fullcontact.living_status |
| Form | form_input_method | trustedform.form_input_method |
| Form | bot_detected | trustedform.bot_detected |
| Form | confirmed_owner | trustedform.confirmed_owner |
| Form | age_seconds | computed (Date.now() - trustedform.created_at) |

## Response Format

```json
[
  {
    "id": "L0",
    "tier": "Gold",
    "score": 85,
    "confidence": "high",
    "reasons": ["Phone grade A with mobile", "Full identity convergence", "Confirmed homeowner, no roof permit"],
    "concerns": []
  }
]
```
