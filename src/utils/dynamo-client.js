/**
 * Shared DynamoDB document client — single instance per Lambda container.
 * Imported by config-loader.js and logger.js to avoid duplicate client init on cold start.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

let docClient = null;

export function getDocClient() {
  if (!docClient) {
    docClient = DynamoDBDocumentClient.from(
      new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' })
    );
  }
  return docClient;
}

/**
 * For testing — inject a mock DynamoDB client.
 */
export function setDocClient(client) {
  docClient = client;
}
