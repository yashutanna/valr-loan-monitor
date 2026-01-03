#!/bin/bash

# Helper script to list all INTERNAL_TRANSFER transactions with credits (deposits)
# This helps you identify which transfer IDs to ignore for payment tracking

DB_PATH="${1:-./data/transactions.db}"

if [ ! -f "$DB_PATH" ]; then
    echo "Error: Database not found at $DB_PATH"
    echo "Usage: $0 [path/to/transactions.db]"
    exit 1
fi

echo ""
echo "================================================================================"
echo "INTERNAL_TRANSFER Transactions (Deposits)"
echo "================================================================================"

QUERY="
SELECT
  event_at,
  credit_currency,
  credit_value,
  transaction_description,
  additional_info
FROM transactions
WHERE transaction_type = 'INTERNAL_TRANSFER' AND credit_currency IS NOT NULL
ORDER BY event_at ASC;
"

# Get count
COUNT=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM transactions WHERE transaction_type = 'INTERNAL_TRANSFER' AND credit_currency IS NOT NULL;")
echo "Found $COUNT deposit transaction(s)"
echo ""

# List all transactions with formatted output
sqlite3 -json "$DB_PATH" "$QUERY" | jq -r '
  to_entries[] |
  .key as $index |
  .value |
  (
    "\($index + 1). Date: \(.event_at)",
    "   Amount: \(.credit_value) \(.credit_currency)",
    "   Transfer ID: \(if .additional_info then (.additional_info | fromjson | .transferId // "N/A") else "N/A" end)",
    "   Description: \(.transaction_description // "N/A")",
    ""
  )
'

echo "================================================================================"
echo "To ignore specific transfers, add their Transfer IDs to your .env file:"
echo "PAYMENT_IGNORE_TRANSFER_IDS=transfer-id-1,transfer-id-2,transfer-id-3"
echo "================================================================================"
echo ""
