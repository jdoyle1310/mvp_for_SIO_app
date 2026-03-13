/**
 * Fuzzy name matching using Levenshtein distance.
 * Used for comparing caller_name from Twilio against lead's submitted name.
 */

import { distance } from 'fastest-levenshtein';

/**
 * Compare two names with fuzzy matching.
 * Returns: 'exact' | 'partial_above_70' | 'no_match'
 *
 * @param {string} name1 - First name (e.g., lead's submitted name)
 * @param {string} name2 - Second name (e.g., Twilio caller_name)
 * @returns {string} Match level
 */
export function fuzzyNameMatch(name1, name2) {
  if (!name1 || !name2) return 'no_match';

  const n1 = name1.trim().toLowerCase();
  const n2 = name2.trim().toLowerCase();

  // Exact match (case-insensitive)
  if (n1 === n2) return 'exact';

  // Calculate similarity as percentage
  const maxLen = Math.max(n1.length, n2.length);
  if (maxLen === 0) return 'no_match';

  const dist = distance(n1, n2);
  const similarity = ((maxLen - dist) / maxLen) * 100;

  if (similarity >= 70) return 'partial_above_70';
  return 'no_match';
}

/**
 * Build a full name string from first + last for comparison.
 */
export function buildFullName(firstName, lastName) {
  const parts = [];
  if (firstName && typeof firstName === 'string') parts.push(firstName.trim());
  if (lastName && typeof lastName === 'string') parts.push(lastName.trim());
  return parts.join(' ') || null;
}
