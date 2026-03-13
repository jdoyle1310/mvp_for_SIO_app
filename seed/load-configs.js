/**
 * Seed script — Load vertical configs from /config/*.json into DynamoDB.
 *
 * Usage: node seed/load-configs.js
 *
 * Requires AWS credentials configured and DynamoDB table created.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = join(__dirname, '..', 'config');
const TABLE_NAME = process.env.DYNAMO_CONFIG_TABLE || 'greenwatt_vertical_configs';

async function main() {
  const client = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
  const docClient = DynamoDBDocumentClient.from(client);

  const files = readdirSync(CONFIG_DIR).filter(f => f.endsWith('.json'));

  console.log(`Loading ${files.length} configs into ${TABLE_NAME}...\n`);

  for (const file of files) {
    const filePath = join(CONFIG_DIR, file);
    const config = JSON.parse(readFileSync(filePath, 'utf-8'));

    console.log(`  Loading ${file} (vertical: ${config.vertical})...`);

    await docClient.send(new PutCommand({
      TableName: TABLE_NAME,
      Item: config,
    }));

    console.log(`  ✓ ${config.vertical} loaded`);
  }

  console.log('\nDone. All configs loaded.');
}

main().catch(err => {
  console.error('Failed to load configs:', err);
  process.exit(1);
});
