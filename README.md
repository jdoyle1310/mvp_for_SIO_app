# GreenWatt Lead Scoring — Solar

LLM-powered lead scoring Lambda for residential solar. Enriches leads with 3 APIs, scores them with Claude Sonnet into Gold/Silver/Bronze/Reject tiers, and routes to buyers.

**Status**: Solar is production-ready (v4.1, validated on 1,227 leads). Roofing and Windows verticals coming soon.

**Validation Results (v4.1)**:
- 23.5% spend reduction vs baseline
- 84.1% appointment retention
- 100% sale retention
- See `docs/solar/v4.1-prompt-changes.md` for full data

---

## Architecture

```
Lead (SIO POST /validate)
  │
  ├── 1. Validate input (vertical, phone, contact fields)
  ├── 2. Normalize phone to E.164
  │
  ├── 3. Enrich — 3 API calls in parallel:
  │   ├── Trestle Real Contact
  │   │   └── phone grade, activity score, line type, name match, email validation
  │   ├── BatchData Property
  │   │   └── property type, owner name, solar permit, equity, free & clear
  │   └── TrustedForm Insights
  │       └── form input method, bot detection, owner verification, lead age
  │
  ├── 4. Hard-Kill Pre-Filter (saves ~$0.003/lead on obvious rejects)
  │   ├── Invalid phone → REJECT
  │   ├── Bot detected → REJECT
  │   ├── Pre-populated form → REJECT
  │   ├── Mobile/Manufactured home → REJECT
  │   └── Condominium (solar) → REJECT
  │
  ├── 5. LLM Scoring — Anthropic Claude Sonnet
  │   ├── 22 stripped fields sent as JSON
  │   ├── Locked v4.1 prompt scores 5 signal groups:
  │   │   Contactability → Identity → Property → Financial → Form Behavior
  │   └── Returns: tier, score (0-100), confidence, reasons, concerns
  │
  ├── 6. Route to buyer (tier + state + daily cap matching)
  └── 7. Log to DynamoDB + emit CloudWatch metrics
```

---

## API Keys Required

You need 5 services to run this system:

| Service | What It Does | Env Variable | Where to Sign Up |
|---------|-------------|--------------|-----------------|
| **Trestle Real Contact** | Phone validation, contact grade (A-F), activity score, line type (Mobile/Landline/VOIP), name matching | `TRESTLE_API_KEY` | [trestleiq.com](https://trestleiq.com) |
| **BatchData Property** | Property type (SFR/Condo/etc), owner name, solar permit status, equity, free & clear | `BATCHDATA_API_KEY` | [batchdata.com](https://batchdata.com) |
| **TrustedForm Insights** | Form input method (typing/paste/autofill), bot detection, confirmed owner, lead age in seconds | `TRUSTEDFORM_API_KEY` | [trustedform.com](https://trustedform.com) |
| **Anthropic Claude Sonnet** | LLM scoring — takes 22 enrichment fields, returns tier + score + reasons | `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) |
| **AWS** | Lambda hosting, DynamoDB (config + score log + buyers), CloudWatch metrics | AWS credentials via IAM | [aws.amazon.com](https://aws.amazon.com) |

**Note**: eHawk handles upstream phone/email/IP fraud detection BEFORE leads reach this system. This scorer focuses on property-level qualification and enrichment-based scoring.

---

## Quick Start

```bash
# 1. Clone the repo
git clone https://github.com/jdoyle1310/mvp_for_SIO_app.git
cd mvp_for_SIO_app

# 2. Install dependencies
npm install

# 3. Set up environment variables
cp .env.example .env
# Edit .env and fill in your API keys (see table above)

# 4. Deploy to AWS (Lambda + DynamoDB tables + CloudWatch alarms)
sam build
sam deploy --guided
# This creates:
#   - greenwatt-validation Lambda function
#   - 3 DynamoDB tables: configs, score_log, buyers
#   - CloudWatch alarms for errors, latency, hard-kill rate

# 5. Load solar config + buyers into DynamoDB
npm run load-configs

# 6. Test it
curl -X POST https://YOUR_API_GATEWAY_URL/validate \
  -H "Content-Type: application/json" \
  -d @test-lead.json
```

---

## Input Format

POST to `/validate` with this JSON structure:

```json
{
  "lead_id": "LEAD-001",
  "vertical": "solar",
  "publisher_id": "PUB-001",
  "publisher_name": "Facebook Solar",
  "contact": {
    "first_name": "John",
    "last_name": "Smith",
    "phone": "3015551234",
    "email": "john@example.com",
    "address": "123 Main St",
    "city": "Rockville",
    "state": "MD",
    "zip": "20850"
  },
  "trustedform_cert_url": "https://cert.trustedform.com/abc123"
}
```

**Required fields**: `lead_id`, `vertical`, `contact.phone`
**Recommended**: `contact.first_name`, `contact.last_name`, `contact.email`, `contact.address`, `contact.city`, `contact.state`, `contact.zip`, `trustedform_cert_url`

---

## Output Format

```json
{
  "lead_id": "LEAD-001",
  "vertical": "solar",
  "publisher_id": "PUB-001",
  "publisher_name": "Facebook Solar",
  "decision": "post",
  "score": 78,
  "tier": "Gold",
  "hard_kill": false,
  "hard_kill_reason": null,
  "reason_codes": [
    "Phone grade A, activity 95 — highly contactable",
    "Address name match confirmed — verified homeowner",
    "SFR property, confirmed owner — qualified for solar"
  ],
  "llm_response": {
    "confidence": "high",
    "reasons": ["Phone grade A, activity 95", "Address name match", "SFR confirmed owner"],
    "concerns": []
  },
  "routing": {
    "buyer_id": "BUYER-SEW-001",
    "buyer_name": "Solar Energy World",
    "endpoint_url": "https://example.com/sew/post",
    "cpl": 95
  },
  "api_performance": {
    "trestle": { "response_time_ms": 245, "success": true },
    "batchdata": { "response_time_ms": 312, "success": true },
    "trustedform": { "response_time_ms": 189, "success": true },
    "anthropic": { "response_time_ms": 1842, "success": true, "input_tokens": 1523, "output_tokens": 187 }
  },
  "processing_time_ms": 2103
}
```

---

## How Scoring Works

The LLM scores leads across 5 signal groups. See `prompts/solar-v4.md` for the full locked prompt.

### Tier Definitions

| Tier | Score | What It Means | Action |
|------|-------|---------------|--------|
| **Gold** | 70-100 | Real homeowner, reachable, qualified. 3+ signal groups positive. | Call first |
| **Silver** | 45-69 | Looks real, some data gaps. 2+ groups solid. | Worth calling |
| **Bronze** | 20-44 | Notable concerns (bad phone, permit, sparse data). | Call if capacity |
| **Reject** | 0-19 | Junk — instant reject trigger or severe fraud signals. | Don't call |

### Instant Reject Triggers (any one = Reject)
- `phone.is_valid = false`
- `property_type = "Condominium"` or `"Mobile/Manufactured"`
- `form_input_method = "pre-populated_only"`
- `bot_detected = true`
- `household_income < $25,000`

### Key Solar-Specific Rules
- **solar_permit = true** → Cap at Bronze (already has solar, 0% appointment rate)
- **confirmed_renter** → NEUTRAL (renters convert at 16.4% vs owners 14.2% — don't penalize)
- **Commercial property** → NEUTRAL (21.4% conversion vs 14.3% base — BatchData often wrong)
- **Grade F + activity < 40** → Bronze cap (0% appointments in historical data)
- **NonFixedVOIP** → Bronze cap (0% appointments in historical data)

---

## Cost Per Lead

| Component | Cost | Notes |
|-----------|------|-------|
| Trestle Real Contact | ~$0.01 | Phone + identity enrichment |
| BatchData Property | ~$0.005 | Property data lookup |
| TrustedForm Insights | ~$0.01 | Form behavior analysis |
| Anthropic Sonnet | ~$0.003 | ~1,500 input + 200 output tokens |
| **Total** | **~$0.028/lead** | Hard-kill pre-filter saves Anthropic cost on ~15% of leads |

---

## Project Structure

```
├── src/                    # Shared application code (all verticals)
│   ├── index.js            # Lambda handler — orchestrates the full flow
│   ├── llm-scorer.js       # Anthropic Sonnet scorer — prompt + field prep + API call
│   ├── config-loader.js    # DynamoDB config loader with cache
│   ├── router.js           # Buyer routing (tier + state + cap matching)
│   ├── api/
│   │   ├── trestle.js      # Trestle Real Contact API client
│   │   ├── batchdata.js    # BatchData Property API client
│   │   └── trustedform.js  # TrustedForm Insights API client
│   └── utils/
│       ├── constants.js    # Valid verticals, tier names, table names, endpoints
│       ├── logger.js       # DynamoDB logging + CloudWatch metric emission
│       ├── hardkill.js     # Hard-kill rule evaluator
│       ├── phone-normalizer.js  # Phone → E.164 normalization
│       └── name-match.js   # Levenshtein name matching
│
├── config/                 # Vertical-specific scoring configs
│   └── solar.json          # Solar tier thresholds + pillar weights
│
├── prompts/                # Vertical-specific LLM prompt documentation
│   └── solar-v4.md         # Locked v4.1 solar prompt — DO NOT MODIFY without re-validation
│
├── docs/                   # Vertical-specific documentation
│   └── solar/
│       └── v4.1-prompt-changes.md  # All v4.1 changes with data backing
│
├── infrastructure/
│   └── template.yaml       # SAM/CloudFormation — Lambda + DynamoDB + CloudWatch
│
├── seed/
│   ├── load-configs.js     # Script to load config JSON into DynamoDB
│   └── buyers.json         # Solar buyer definitions (3 buyers)
│
├── tests/
│   ├── config.test.js      # Config loader tests
│   └── hardkill.test.js    # Hard-kill logic tests
│
├── .env.example            # All required environment variables with descriptions
├── package.json            # Node 18+, ES modules
└── SCORING_SPEC.md         # Full scoring specification
```

---

## Deployment

### Infrastructure (SAM Template)

The `infrastructure/template.yaml` creates everything you need:

- **Lambda Function**: `greenwatt-validation` (Node 18, 512MB, 10s timeout)
- **API Gateway**: POST `/validate` + GET `/health`
- **DynamoDB Tables**:
  - `greenwatt_vertical_configs` — scoring config per vertical
  - `greenwatt_score_log` — every scored lead (with TTL)
  - `greenwatt_buyers` — buyer definitions (tiers, caps, states, endpoints)
- **CloudWatch Alarms**:
  - High processing time (p95 > 400ms)
  - High hard-kill rate (> 30% — bad traffic source)
  - Lambda errors (> 1%)

### Deploy Steps

```bash
# Build
sam build

# Deploy (first time — guided will ask for stack name, region, etc.)
sam deploy --guided

# Subsequent deploys
sam deploy

# Load config + buyers into DynamoDB
npm run load-configs
```

---

## Testing

```bash
# Run tests
npm test

# Run specific test
npx jest tests/hardkill.test.js
```

---

## Adding New Verticals

When roofing or windows is ready:

1. Add the vertical to `VALID_VERTICALS` in `src/utils/constants.js`
2. Add the prompt constant in `src/llm-scorer.js` (follow the `SOLAR_PROMPT` pattern)
3. Add vertical-specific fields in `prepareFieldsForLLM()` in `src/llm-scorer.js`
4. Add routing in `getPromptForVertical()` in `src/llm-scorer.js`
5. Create `config/<vertical>.json` with scoring thresholds
6. Create `prompts/<vertical>-v1.md` with prompt documentation
7. Create `docs/<vertical>/` for validation docs
8. Add buyers to `seed/buyers.json`
9. Run `npm run load-configs` to push new config to DynamoDB
