/**
 * Loads vertical configs from DynamoDB with in-memory caching.
 * Cache TTL is configurable via CONFIG_CACHE_TTL env var (default 300s / 5 min).
 * For local dev/testing, falls back to reading JSON files from /config directory.
 */

import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { TABLE_NAMES, CONFIG_CACHE_TTL, VALID_VERTICALS } from './utils/constants.js';
import { getDocClient, setDocClient } from './utils/dynamo-client.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// In-memory cache
const cache = new Map();

/**
 * Load config for a vertical. Checks cache first, then DynamoDB, then local files.
 *
 * @param {string} vertical - One of VALID_VERTICALS
 * @returns {object} The vertical config object
 */
export async function loadConfig(vertical) {
  if (!VALID_VERTICALS.includes(vertical)) {
    throw new Error(`Invalid vertical: ${vertical}. Must be one of: ${VALID_VERTICALS.join(', ')}`);
  }

  // Check cache
  const cached = cache.get(vertical);
  if (cached && (Date.now() - cached.loadedAt) < CONFIG_CACHE_TTL * 1000) {
    return cached.config;
  }

  let config;

  // Try DynamoDB first
  try {
    config = await loadFromDynamoDB(vertical);
  } catch (err) {
    // DynamoDB not available (local dev) — fall back to local files
    config = loadFromFile(vertical);
  }

  // Cache it
  cache.set(vertical, { config, loadedAt: Date.now() });

  return config;
}

/**
 * Load config from DynamoDB.
 */
async function loadFromDynamoDB(vertical) {
  const client = getDocClient();
  const result = await client.send(new GetCommand({
    TableName: TABLE_NAMES.CONFIG,
    Key: { vertical },
  }));

  if (!result.Item) {
    throw new Error(`No config found in DynamoDB for vertical: ${vertical}`);
  }

  return result.Item;
}

/**
 * Load config from local JSON file (fallback for local dev).
 */
function loadFromFile(vertical) {
  const filePath = join(__dirname, '..', 'config', `${vertical}.json`);
  try {
    const raw = readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`Failed to load config file for ${vertical}: ${err.message}`);
  }
}

/**
 * Bust the cache for a specific vertical or all verticals.
 */
export function bustCache(vertical = null) {
  if (vertical) {
    cache.delete(vertical);
  } else {
    cache.clear();
  }
}

export { setDocClient };
