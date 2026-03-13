/**
 * Structural constants ONLY — no scoring thresholds, weights, or business logic.
 * All scoring values live in per-vertical config JSONs loaded from DynamoDB.
 */

// Valid verticals — reject anything not in this list with 400
// Add 'roofing', 'windows' when those verticals are validated and ready
export const VALID_VERTICALS = ['solar'];

// Tier names (for output schema)
export const TIERS = {
  GOLD: 'Gold',
  SILVER: 'Silver',
  BRONZE: 'Bronze',
  REJECT: 'Reject',
};

// Decision values (for SIO response)
export const DECISIONS = {
  POST: 'post',
  REJECT: 'reject',
  HOLD: 'hold',
};

// Pillar names
export const PILLARS = [
  'contactability',
  'identity',
  'fraud_legal',
  'behavioral',
  'property_financial',
];

// API endpoints (3 enrichment APIs + Anthropic LLM scorer)
// FullContact dropped (zero marginal value). Twilio dropped (overlaps Trestle).
export const API_ENDPOINTS = {
  TRESTLE: 'https://api.trestleiq.com/1.1/real_contact',
  BATCHDATA: 'https://api.batchdata.com/api/v1/property/lookup/all-attributes',
  TRUSTEDFORM: 'https://cert.trustedform.com',
  ANTHROPIC: 'https://api.anthropic.com/v1/messages',
};

// API names (for logging + metrics)
export const API_NAMES = ['trestle', 'batchdata', 'trustedform', 'anthropic'];

// DynamoDB table names (from env or defaults)
export const TABLE_NAMES = {
  CONFIG: process.env.DYNAMO_CONFIG_TABLE || 'greenwatt_vertical_configs',
  SCORE_LOG: process.env.DYNAMO_SCORE_LOG_TABLE || 'greenwatt_score_log',
  BUYERS: process.env.DYNAMO_BUYER_TABLE || 'greenwatt_buyers',
};

// Config cache TTL (seconds)
export const CONFIG_CACHE_TTL = parseInt(process.env.CONFIG_CACHE_TTL || '300', 10);

// API timeout (milliseconds)
export const API_TIMEOUT_MS = parseInt(process.env.API_TIMEOUT_MS || '3000', 10);

// Special field_score values that trigger hard kills
export const HARD_KILL_SENTINEL = 'HARD_KILL';

// Special field_score values that depend on vertical config
export const VERTICAL_DEPENDENT_SENTINEL = 'VERTICAL_DEPENDENT';

// CloudWatch EMF namespace
export const METRICS_NAMESPACE = 'GreenWatt/Validation';
