# Payment Tracking Configuration

The loan monitor tracks all deposits (INTERNAL_TRANSFER transactions with credits) to your account and compares them against total interest paid. However, you may want to exclude certain transfers from payment calculations, such as:

- Initial collateral deposits made before borrowing started
- Deposits unrelated to loan repayment
- Transfers you want to exclude for any other reason

## How to Configure

### Step 1: List All Payment Transfers

Run the helper script to see all deposit transactions:

```bash
npm run list-payment-transfers
```

This will display all INTERNAL_TRANSFER transactions with their:
- Date/time
- Amount and currency
- **Transfer ID** (this is what you need)
- Description

Example output:
```
1. Date: 2025-11-09T11:45:48.562Z
   Amount: 0.00303644704 BTC
   Transfer ID: 112001831
   Description: Transfer

2. Date: 2025-11-09T18:53:14.532Z
   Amount: 200 USDC
   Transfer ID: 112072993
   Description: Transfer
```

### Step 2: Identify Transfers to Ignore

Based on the dates and amounts, identify which transfer IDs correspond to:
- Initial collateral deposits (before your first loan/borrow)
- Any other transfers you don't want counted as loan repayments

### Step 3: Add to Environment Configuration

Edit your `.env` file and add the `PAYMENT_IGNORE_TRANSFER_IDS` variable with a comma-separated list of transfer IDs to ignore:

```bash
# Example: Ignore the first 5 deposits which were initial collateral
PAYMENT_IGNORE_TRANSFER_IDS=112001831,112072993,113737489,113737490,114716913
```

### Step 4: Reload the Application

Restart the loan monitor for the changes to take effect:

```bash
npm run docker:reload:monitor
```

Or rebuild if you haven't deployed the latest code yet:

```bash
npm run docker:rebuild
```

## Verification

After reloading, check the logs to confirm your configuration:

```bash
npm run docker:logs:monitor
```

You should see a line like:
```
Configuration:
  - Principal subaccount: your-subaccount-id
  - Poll interval: 60s
  - Loans (negative balances) and collateral (positive balances) auto-detected
  - Payment tracking: Ignoring 5 transfer ID(s)
```

And during metric updates:
```
Total payments: 0.00001176 BTC, ... (Total: R123.45, 5 transfer(s) ignored)
```

## Grafana Dashboard

The following panels show payment tracking data:
- **Total Payments (All Time, ZAR)** - Sum of all deposits (excluding ignored transfers)
- **Payments vs Interest (ZAR)** - Bar chart comparing total payments to total interest paid

## Future Use Cases

This approach is flexible for future scenarios:
- If you pay off the entire loan and start a new one, just add the old loan's transfers to the ignore list
- If you make deposits for other purposes (not loan repayment), add those transfer IDs
- You can modify the list at any time without code changes

## Troubleshooting

**Q: I updated the .env file but nothing changed**
A: Make sure to reload the container with `npm run docker:reload:monitor` after editing .env

**Q: How do I find the transfer ID for a specific date?**
A: Run `npm run list-payment-transfers` and look for the transaction by date/amount

**Q: Can I remove a transfer ID from the ignore list?**
A: Yes, just edit the .env file, remove it from the comma-separated list, and reload

**Q: What happens if I specify an invalid transfer ID?**
A: It will be safely ignored - only valid transfer IDs matching actual transactions are filtered
