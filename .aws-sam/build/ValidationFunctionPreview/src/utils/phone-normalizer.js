/**
 * Normalize phone numbers to E.164 format for API calls.
 * Input may be: "5551234567", "(555) 123-4567", "+15551234567", "1-555-123-4567"
 * Output: "+15551234567"
 */

export function normalizePhone(phone) {
  if (!phone || typeof phone !== 'string') return null;

  // Strip everything except digits
  const digits = phone.replace(/\D/g, '');

  // Already has country code (11 digits starting with 1)
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+${digits}`;
  }

  // 10-digit US number
  if (digits.length === 10) {
    return `+1${digits}`;
  }

  // Already in E.164 with + prefix
  if (phone.startsWith('+') && digits.length >= 10) {
    return `+${digits}`;
  }

  // Can't normalize — return null, scoring will apply null_penalty
  return null;
}
