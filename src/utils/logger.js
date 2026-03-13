/**
 * DynamoDB logging + CloudWatch EMF metrics.
 *
 * Every scored lead gets written to greenwatt_score_log table.
 * Every invocation emits CloudWatch Embedded Metric Format (EMF) metrics.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { TABLE_NAMES, METRICS_NAMESPACE } from './constants.js';

// DynamoDB client (lazy init)
let docClient = null;

function getDocClient() {
  if (!docClient) {
    const client = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
    docClient = DynamoDBDocumentClient.from(client);
  }
  return docClient;
}

/**
 * Log a scored lead to DynamoDB.
 *
 * @param {object} result - Full scoring result (lead_id, score, tier, pillar_breakdown, etc.)
 * @param {object} apiPerformance - API response times { trestle: { response_time_ms, success }, ... }
 */
export async function logScoredLead(result, apiPerformance) {
  try {
    const client = getDocClient();
    const now = new Date().toISOString();

    const item = {
      lead_id: result.lead_id,
      scored_at: now,
      vertical: result.vertical || 'unknown',
      score: result.score,
      tier: result.tier,
      decision: result.decision,
      hard_kill: result.hard_kill,
      hard_kill_reason: result.hard_kill_reason || null,
      reason_codes: result.reason_codes || [],
      pillar_breakdown: result.pillar_breakdown || {},
      field_scores: result.field_scores || {},
      routing: result.routing || {},
      api_performance: apiPerformance || {},
      processing_time_ms: result.processing_time_ms || 0,
      publisher_id: result.publisher_id || null,
      publisher_name: result.publisher_name || null,
      // TTL: auto-delete after 90 days
      ttl: Math.floor(Date.now() / 1000) + (90 * 24 * 60 * 60),
    };

    await client.send(new PutCommand({
      TableName: TABLE_NAMES.SCORE_LOG,
      Item: item,
    }));
  } catch (err) {
    // Log error but don't crash the Lambda — scoring result is more important than logging
    console.error('Failed to log scored lead to DynamoDB:', err.message);
  }
}

/**
 * Emit CloudWatch EMF metrics.
 *
 * EMF format: JSON object printed to stdout with _aws metadata.
 * CloudWatch agent parses these and creates metrics automatically.
 *
 * @param {object} result - Scoring result
 * @param {object} apiPerformance - API timing data
 */
export function emitMetrics(result, apiPerformance) {
  const vertical = result.vertical || 'unknown';
  const tier = result.tier || 'unknown';

  // Core scoring metrics
  emitEMF({
    LeadScore: result.score || 0,
    ProcessingTime: result.processing_time_ms || 0,
    HardKillTriggered: result.hard_kill ? 1 : 0,
    TierAssignment: 1,
  }, {
    vertical,
    tier,
    hard_kill_reason: result.hard_kill_reason || 'none',
  });

  // API performance metrics (one per API)
  if (apiPerformance) {
    for (const [apiName, perf] of Object.entries(apiPerformance)) {
      emitEMF({
        APIResponseTime: perf.response_time_ms || 0,
        APIError: perf.success ? 0 : 1,
      }, {
        api_name: apiName,
        error_type: perf.error_type || 'none',
      });
    }
  }

  // Pillar score metrics
  if (result.pillar_breakdown) {
    for (const [pillar, data] of Object.entries(result.pillar_breakdown)) {
      emitEMF({
        PillarScore: data.weighted_score || 0,
      }, {
        pillar,
        vertical,
      });
    }
  }
}

/**
 * Emit a single CloudWatch EMF metric log line.
 */
function emitEMF(metrics, dimensions) {
  const emfLog = {
    _aws: {
      Timestamp: Date.now(),
      CloudWatchMetrics: [{
        Namespace: METRICS_NAMESPACE,
        Dimensions: [Object.keys(dimensions)],
        Metrics: Object.keys(metrics).map(name => ({
          Name: name,
          Unit: name.includes('Time') ? 'Milliseconds' : 'None',
        })),
      }],
    },
    ...dimensions,
    ...metrics,
  };

  // EMF logs go to stdout — CloudWatch agent picks them up
  console.log(JSON.stringify(emfLog));
}

/**
 * For testing — inject a mock DynamoDB client.
 */
export function setDocClient(client) {
  docClient = client;
}
