/**
 * Sanitization utilities for removing PII from API responses and metrics
 */

import { FFLoanSummary } from '../repayments/friends-family-loans';

/**
 * Mask a string, keeping only the last N characters visible
 * @param value The string to mask
 * @param visibleChars Number of characters to keep visible at the end (default: 4)
 * @returns Masked string like "******2345"
 */
export function maskString(value: string, visibleChars: number = 4): string {
  if (!value || value.length <= visibleChars) {
    return '*'.repeat(value?.length || 0);
  }

  const maskedPart = '*'.repeat(value.length - visibleChars);
  const visiblePart = value.slice(-visibleChars);
  return maskedPart + visiblePart;
}

/**
 * Mask a name, keeping only the last 3 characters visible
 * @param name The name to mask
 * @returns Masked name like "******nna"
 */
export function maskName(name: string): string {
  return maskString(name, 3);
}

/**
 * Mask contact details (email, phone, etc), keeping last 4 characters
 * @param contact The contact detail to mask
 * @returns Masked contact like "******0002"
 */
export function maskContact(contact: string): string {
  return maskString(contact, 4);
}

/**
 * Sanitize F&F loan summary by masking PII
 * @param summary The loan summary to sanitize
 * @returns Sanitized summary with masked name and recipient
 */
export function sanitizeFFLoanSummary(summary: FFLoanSummary): FFLoanSummary {
  return {
    ...summary,
    loan: {
      ...summary.loan,
      name: maskName(summary.loan.name),
      recipient: {
        ...summary.loan.recipient,
        value: maskContact(summary.loan.recipient.value)
      },
      notes: summary.loan.notes ? '[REDACTED]' : undefined
    }
  };
}

/**
 * Sanitize an array of F&F loan summaries
 * @param summaries Array of loan summaries to sanitize
 * @returns Array of sanitized summaries
 */
export function sanitizeFFLoanSummaries(summaries: FFLoanSummary[]): FFLoanSummary[] {
  return summaries.map(sanitizeFFLoanSummary);
}
