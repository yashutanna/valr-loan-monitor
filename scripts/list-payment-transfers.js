#!/usr/bin/env node

/**
 * Helper script to list all INTERNAL_TRANSFER transactions with credits (deposits)
 * This helps you identify which transfer IDs to ignore for payment tracking
 */

const Database = require('better-sqlite3');
const path = require('path');

const dbPath = process.argv[2] || path.join(__dirname, '..', 'data', 'transactions.db');

try {
  const db = new Database(dbPath, { readonly: true });

  const rows = db.prepare(`
    SELECT
      event_at,
      credit_currency,
      credit_value,
      transaction_description,
      additional_info
    FROM transactions
    WHERE transaction_type = 'INTERNAL_TRANSFER' AND credit_currency IS NOT NULL
    ORDER BY event_at ASC
  `).all();

  console.log('\n='.repeat(80));
  console.log('INTERNAL_TRANSFER Transactions (Deposits)');
  console.log('='.repeat(80));
  console.log(`Found ${rows.length} deposit transaction(s)\n`);

  rows.forEach((row, index) => {
    const additionalInfo = row.additional_info ? JSON.parse(row.additional_info) : {};
    const transferId = additionalInfo.transferId || 'N/A';

    console.log(`${index + 1}. Date: ${row.event_at}`);
    console.log(`   Amount: ${row.credit_value} ${row.credit_currency}`);
    console.log(`   Transfer ID: ${transferId}`);
    console.log(`   Description: ${row.transaction_description || 'N/A'}`);
    console.log('');
  });

  console.log('='.repeat(80));
  console.log('To ignore specific transfers, add their Transfer IDs to your .env file:');
  console.log('PAYMENT_IGNORE_TRANSFER_IDS=transfer-id-1,transfer-id-2,transfer-id-3');
  console.log('='.repeat(80));
  console.log('');

  db.close();
} catch (error) {
  console.error('Error reading database:', error.message);
  console.error('\nUsage: node scripts/list-payment-transfers.js [path/to/transactions.db]');
  process.exit(1);
}
