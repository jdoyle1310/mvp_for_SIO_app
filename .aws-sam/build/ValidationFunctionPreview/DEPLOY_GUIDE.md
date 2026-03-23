# GreenWatt 13-Vertical Scorer — Production Deploy Guide

**For:** Development team
**Date:** 2026-03-17
**Status:** Code complete, 370/370 tests passing, ready for deploy
**Repo:** `jdoyle1310/mvp_for_SIO_app` (branch: main)

---

## Prerequisites

You need these installed before starting:

| Tool | Min Version | Install Command |
|------|-------------|-----------------|
| Node.js | 20.x+ | `nvm install 20` or download from nodejs.org |
| AWS CLI | 1.x or 2.x | `brew install awscli` or `pip3 install awscli --user` |
| SAM CLI | 1.100+ | `brew install aws-sam-cli` or `pip3 install aws-sam-cli --user` |
| Docker | 20.x+ | Download from docker.com (optional — needed only for `sam local invoke`) |

Verify:
```bash
node --version      # v20.x+
aws --version       # aws-cli/1.x or 2.x
sam --version       # SAM CLI, version 1.x
```

---

## Step 1: Clone & Verify Tests

```bash
git clone git@github.com:jdoyle1310/mvp_for_SIO_app.git greenwatt-solar
cd greenwatt-solar
npm install
npm test
# Expected: 370 passed, 0 failed
```

---

## Step 2: Configure AWS Credentials

```bash
aws configure
# AWS Access Key ID: <your-key>
# AWS Secret Access Key: <your-secret>
# Default region name: us-east-1
# Default output format: json
```

Verify with: `aws sts get-caller-identity`

The IAM user/role needs these permissions:
- `cloudformation:*` (stack management)
- `lambda:*` (function management)
- `apigateway:*` (API Gateway)
- `dynamodb:*` (table management)
- `s3:*` (SAM deployment artifacts)
- `iam:CreateRole`, `iam:AttachRolePolicy`, `iam:PassRole` (Lambda execution role)
- `cloudwatch:PutMetricAlarm` (alarms)
- `logs:*` (CloudWatch Logs)

Or use the `AdministratorAccess` managed policy for initial deploy.

---

## Step 3: Build

```bash
sam build
```

This uses the config in `samconfig.toml` (template path: `infrastructure/template.yaml`).

If you see `Error: NodejsNpmBuilder...` errors, make sure Node 20.x is in your PATH.

**What gets created:**
- `.aws-sam/build/ValidationFunction/` — bundled Lambda code + node_modules

---

## Step 4: Deploy

First-time deploy (interactive):
```bash
sam deploy --guided
```

Answer the prompts:
| Prompt | Value |
|--------|-------|
| Stack Name | `greenwatt-validation` |
| AWS Region | `us-east-1` |
| Confirm changes before deploy | `y` |
| Allow SAM CLI IAM role creation | `y` |
| Disable rollback | `n` |
| Save arguments to configuration file | `y` |

Subsequent deploys:
```bash
sam build && sam deploy
```

**What gets created:**
- Lambda function: `greenwatt-validation`
- API Gateway endpoint: `POST /validate`, `GET /health`
- DynamoDB tables: `greenwatt_vertical_configs`, `greenwatt_score_log`, `greenwatt_buyers`
- CloudWatch alarms: processing time p95, hard kill rate, Lambda errors

**Capture the API URL** from the stack outputs:
```bash
aws cloudformation describe-stacks \
  --stack-name greenwatt-validation \
  --query 'Stacks[0].Outputs[?OutputKey==`ApiUrl`].OutputValue' \
  --output text
```

---

## Step 5: Set API Keys (Lambda Environment Variables)

API keys are NOT in the SAM template (they're secrets). Set them on the Lambda directly:

```bash
aws lambda update-function-configuration \
  --function-name greenwatt-validation \
  --environment "Variables={
    TRESTLE_API_KEY=<your-trestle-key>,
    BATCHDATA_API_KEY=<your-batchdata-key>,
    TRUSTEDFORM_API_KEY=<your-trustedform-key>,
    ANTHROPIC_API_KEY=<your-anthropic-key>,
    DYNAMO_CONFIG_TABLE=greenwatt_vertical_configs,
    DYNAMO_SCORE_LOG_TABLE=greenwatt_score_log,
    DYNAMO_BUYER_TABLE=greenwatt_buyers,
    CONFIG_CACHE_TTL=300,
    API_TIMEOUT_MS=3000
  }"
```

API key sources:
- **Trestle**: https://trestleiq.com (Real Contact API, $0.035/call)
- **BatchData**: https://batchdata.com (Property lookup, Quick List API key)
- **TrustedForm**: https://trustedform.com (Insights API, $0.02/call)
- **Anthropic**: https://console.anthropic.com (Claude Sonnet, ~$0.003/lead)

---

## Step 6: Seed DynamoDB Configs

Load the 13 vertical configs into DynamoDB:

```bash
node seed/load-configs.js
```

This reads all `config/*.json` files and PUTs them into the `greenwatt_vertical_configs` table.

Verify:
```bash
aws dynamodb scan \
  --table-name greenwatt_vertical_configs \
  --select COUNT
# Expected: Count = 13
```

---

## Step 7: Smoke Test

```bash
# Health check
curl -s https://<API_ID>.execute-api.us-east-1.amazonaws.com/Prod/health

# Score a test lead (solar — validated vertical)
curl -s -X POST \
  https://<API_ID>.execute-api.us-east-1.amazonaws.com/Prod/validate \
  -H 'Content-Type: application/json' \
  -d '{
    "lead_id": "test-001",
    "vertical": "solar",
    "publisher_id": "test",
    "publisher_name": "Smoke Test",
    "contact": {
      "first_name": "John",
      "last_name": "Smith",
      "phone": "2025551234",
      "email": "john@test.com",
      "address": "123 Main St",
      "city": "Arlington",
      "state": "VA",
      "zip": "22201"
    }
  }' | python3 -m json.tool

# Expected response includes: tier, score, decision, reason_codes, api_performance
```

---

## Step 8: Run Validation Script

Compare production scores against the 160-score reference:

```bash
node scripts/validate-production.mjs https://<API_ID>.execute-api.us-east-1.amazonaws.com/Prod/validate
```

**Note:** This script sends leads through the FULL pipeline (real API calls). It validates that the Lambda is wired up correctly and returns valid scoring responses. Due to live API data enrichment, exact score matches with the temp=0 reference aren't guaranteed — the script checks **tier match** for validated verticals and flags **>1 tier drift** for shadow verticals.

**Target:**
- Solar/Roofing/Windows: 90%+ tier match rate (some variance from live API data vs reference)
- Shadow verticals: No leads >1 tier off from reference (flags for investigation)

---

## Architecture Overview

```
Client (SIO) → API Gateway → Lambda (greenwatt-validation)
                                ├── Validate input
                                ├── Load config from DynamoDB (cached 5 min)
                                ├── Call 3 APIs in parallel:
                                │   ├── Trestle (phone/email/identity)
                                │   ├── BatchData (property/ownership)
                                │   └── TrustedForm (form behavior/bot)
                                ├── Quick hard-kill checks (save LLM cost)
                                ├── Anthropic Sonnet scoring (~$0.003/lead)
                                ├── Route to buyer (or HOLD for shadow mode)
                                ├── Log to DynamoDB score_log
                                └── Emit CloudWatch metrics
```

---

## Shadow Mode

10 new verticals are in **shadow mode** (`shadow_mode: true` in their config):
- HVAC, Siding, Gutters, Painting, Plumbing, Bathroom Remodel, Kitchen Remodel, Flooring, Insurance, Mortgage

Shadow mode means: leads get scored and logged to DynamoDB, but `routeLead()` returns `HOLD` instead of `POST`. This prevents unvalidated scoring from affecting live traffic.

**3 validated verticals** (Solar, Roofing, Windows) have `shadow_mode: false` and route normally.

### Promoting a vertical from shadow to live:

1. Collect 50+ scored leads with dispo data for the vertical
2. Compare LLM tier assignments against actual outcomes (appt rate, DQ rate, sale rate)
3. Confirm the model is filtering appropriately (Gold > Silver > Bronze conversion rates)
4. Update the vertical's config in DynamoDB: `shadow_mode: false`

```bash
aws dynamodb update-item \
  --table-name greenwatt_vertical_configs \
  --key '{"vertical": {"S": "hvac"}}' \
  --update-expression "SET shadow_mode = :val" \
  --expression-attribute-values '{":val": {"BOOL": false}}'
```

---

## Key Files

| File | Purpose |
|------|---------|
| `src/index.js` | Lambda handler — orchestrates the full flow |
| `src/llm-scorer.js` | Anthropic Sonnet scoring (v4.2 locked + v5.0 assembled) |
| `src/router.js` | Buyer routing with shadow mode |
| `src/config-loader.js` | DynamoDB config with 5-min cache |
| `src/api/trestle.js` | Trestle Real Contact API client |
| `src/api/batchdata.js` | BatchData Property API client |
| `src/api/trustedform.js` | TrustedForm Insights API client |
| `src/utils/constants.js` | 13 verticals, table names, endpoints |
| `config/*.json` | 13 vertical configs (seeded to DynamoDB) |
| `infrastructure/template.yaml` | SAM/CloudFormation template |
| `samconfig.toml` | SAM deploy configuration |
| `scripts/validate-production.mjs` | Production validation script |
| `docs/validation-reference-10-leads-13-verticals.json` | 160 reference scores |

---

## Monitoring

### CloudWatch Metrics (namespace: `GreenWatt/Validation`)

| Metric | Description | Alarm |
|--------|-------------|-------|
| `ProcessingTime` | End-to-end latency (ms) | p95 > 400ms |
| `HardKillTriggered` | Hard kill rate (0 or 1) | avg > 30% |
| `LeadScore` | Score 0-100 | — |
| `TierAssignment` | Count by tier | — |
| `APIResponseTime` | Per-API latency | — |
| `APIError` | Per-API error rate | — |

### DynamoDB Score Log

Every scored lead is written to `greenwatt_score_log` with:
- Lead ID, vertical, publisher
- Tier, score, decision
- Full enrichment data snapshot
- LLM response (confidence, reasons, concerns)
- API performance timings
- 90-day TTL (auto-delete)

Query by vertical:
```bash
aws dynamodb query \
  --table-name greenwatt_score_log \
  --index-name vertical-scored_at-index \
  --key-condition-expression "vertical = :v" \
  --expression-attribute-values '{":v": {"S": "solar"}}' \
  --limit 10
```

---

## Cost Estimates

Per-lead cost breakdown:
| Component | Cost |
|-----------|------|
| Trestle | $0.035 |
| BatchData | ~$0.01 |
| TrustedForm | $0.02 |
| Anthropic Sonnet | ~$0.003 |
| Lambda + API GW | ~$0.0001 |
| DynamoDB | ~$0.0001 |
| **Total** | **~$0.068/lead** |

At 1,000 leads/day: ~$68/day, ~$2,040/month.

---

## Troubleshooting

### Lambda timeout
Default: 30s. If APIs are slow, increase in `template.yaml` Globals.Function.Timeout.

### Missing configs
If `loadConfig()` throws "No config found", run `node seed/load-configs.js` to seed DynamoDB.

### API key not set
If enrichment APIs return null data, check Lambda env vars with:
```bash
aws lambda get-function-configuration --function-name greenwatt-validation \
  --query 'Environment.Variables' --output json
```

### Score drift from reference
LLM scoring at temp=0 should be deterministic, but live API data differs from reference enrichment data. Tier drift of 1 level is normal. Drift of 2+ levels for validated verticals warrants investigation.

### Promoting shadow verticals
Don't promote until you have 50+ leads with dispo data confirming the model's tier assignments correlate with actual outcomes.

---

## What's Next After Deploy

1. **Go live with solar/roofing/windows** — these are production-ready NOW
2. **Collect dispo data** — track appt rates, DQ rates, sales by tier for all verticals
3. **Run weight optimizer** on HVAC, Siding, Gutters, Bath Remodel (framework exists in `simulation_results/`)
4. **Promote shadow verticals** as dispo data validates each one
5. **Build buyer routing** — replace the stub in `router.js` with real DynamoDB buyer matching
