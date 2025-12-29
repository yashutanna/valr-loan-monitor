# VALR Loan Monitor

A TypeScript-based monitoring service that automatically detects and tracks crypto loan interest payments and margin status from VALR exchange. Exposes metrics to Prometheus for visualization in Grafana.

## Features

- **Automatic Loan Detection**: Automatically detects all loans by identifying negative balances in the principal subaccount
- **Multi-Currency Support**: Tracks multiple loans across different currencies simultaneously
- **Interest Tracking**: Monitor total interest paid per loan in both native currency and ZAR
- **Effective APR Calculation**: Automatically calculates actual yearly APR based on interest payments for each loan
- **Margin Monitoring**: Track total collateral vs total loan value ratio to prevent margin calls
- **Prometheus Metrics**: All data exposed as Prometheus metrics with currency labels for historical tracking
- **Grafana Dashboard**: Pre-configured multi-currency dashboard for visualization
- **Docker Compose**: Complete stack with monitoring service, Prometheus, and Grafana

## How It Works

The monitor automatically:
1. **Detects loans** by finding all negative balances in your principal subaccount
2. **Tracks interest** by parsing INTEREST_PAYMENT transactions for each currency
3. **Calculates APR** using the formula: `(totalInterest / loanAmount) * (hoursPerYear / paymentCount) * 100`
4. **Monitors margin** by comparing total collateral value vs total loan value (both in ZAR)

No manual configuration of loan amounts or currencies needed!

## Metrics Tracked

All metrics with `currency` label support multiple loans:

- `valr_loan_amount{currency}` - Amount of each loan by currency
- `valr_loan_total_interest{currency}` - Total interest paid for each loan currency
- `valr_loan_total_interest_zar{currency}` - Total interest paid in ZAR for each loan
- `valr_loan_effective_apr_percent{currency}` - Calculated effective yearly APR per loan
- `valr_loan_interest_payment_count{currency}` - Number of interest payments per loan
- `valr_loan_margin_ratio` - Current total collateral/loan ratio
- `valr_loan_is_above_maintenance_margin` - Whether loans are safe (1) or at risk (0)
- `valr_loan_collateral_amount` - Amount of collateral
- `valr_loan_collateral_value_zar` - Collateral value in ZAR
- `valr_loan_total_value_zar` - Total value of all loans in ZAR
- `valr_loan_total_collateral_value_zar` - Total collateral value in ZAR
- `valr_loan_hours_since_first_payment` - Time since first payment
- `valr_loan_update_total` - Counter for successful updates
- `valr_loan_update_errors_total` - Counter for failed updates

## Prerequisites

- Docker and Docker Compose
- VALR API key and secret with permissions for:
  - Reading account balances
  - Reading subaccount transactions
- Active crypto loan(s) on VALR with:
  - Principal subaccount (where interest is paid from - will show negative balances)
  - Beneficiary subaccount (where collateral is held)

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd loan-monitor
```

2. Copy the example environment file:
```bash
cp .env.example .env
```

3. Edit `.env` with your VALR API credentials:
```bash
# VALR API Configuration
VALR_API_KEY=your_api_key_here
VALR_API_SECRET=your_api_secret_here

# Subaccount names
LOAN_PRINCIPAL_SUBACCOUNT=

# Loan Configuration
COLLATERAL_CURRENCY=ETH
MAINTENANCE_MARGIN_RATIO=0.8

# Monitoring Configuration
POLL_INTERVAL_MS=3600000  # 1 hour
PORT=3000
```

Note: You don't need to specify loan currencies or amounts - they're auto-detected!

## Usage

### Start the Full Stack

```bash
docker-compose up -d
```

This starts:
- **Loan Monitor** on port 3000
- **Prometheus** on port 9090
- **Grafana** on port 3001

### Access the Services

- **Loan Monitor Status**: http://localhost:3000/status
- **Prometheus Metrics**: http://localhost:3000/metrics
- **Prometheus UI**: http://localhost:9090
- **Grafana Dashboard**: http://localhost:3001 (login: admin/admin)

### View Logs

```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f loan-monitor
```

### Stop the Stack

```bash
docker-compose down
```

### Stop and Remove Data

```bash
docker-compose down -v
```

## Development

### Build Locally

```bash
npm install
npm run build
```

### Run in Development Mode

```bash
npm run dev
```

### Environment Variables

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `VALR_API_KEY` | VALR API key | Yes | - |
| `VALR_API_SECRET` | VALR API secret | Yes | - |
| `LOAN_PRINCIPAL_SUBACCOUNT` | Subaccount with loans (negative balances) | Yes | - |
| `COLLATERAL_CURRENCY` | Currency of collateral | Yes | `ETH` |
| `MAINTENANCE_MARGIN_RATIO` | Minimum safe margin ratio | No | `1.3` |
| `POLL_INTERVAL_MS` | Update interval in milliseconds | No | `3600000` |
| `PORT` | HTTP server port | No | `3000` |

## API Endpoints

### GET /metrics
Returns Prometheus-formatted metrics with currency labels

### GET /health
Returns service health status
```json
{
  "status": "ok",
  "timestamp": "2025-12-07T12:00:00.000Z"
}
```

### GET /status
Returns current loan status and metrics for all detected loans
```json
{
  "collateral": {
    "currency": "ETH",
    "amount": 12.5,
    "valueInZAR": 625000,
    "maintenanceMarginRatio": 0.8
  },
  "loans": [
    { "currency": "USDC", "amount": 25000 },
    { "currency": "BTC", "amount": 0.5 }
  ],
  "totalLoanValueInZAR": 500000,
  "interestByLoanCurrency": {
    "USDC": 125.50,
    "BTC": 0.00125
  },
  "interestInZAR": {
    "USDC": 2350.25,
    "BTC": 1500.00
  },
  "effectiveAPRByLoan": {
    "USDC": 8.45,
    "BTC": 7.25
  },
  "interestPaymentCountByLoan": {
    "USDC": 720,
    "BTC": 360
  },
  "marginRatio": 1.25,
  "isAboveMaintenanceMargin": true,
  "hoursSinceFirstPayment": 720
}
```

## Grafana Dashboard

The included Grafana dashboard displays:

1. **Loan Distribution**: Pie chart showing all loans by currency
2. **Total Interest**: Combined interest paid across all loans in ZAR
3. **APR by Loan**: Bar gauge comparing effective APR for each loan
4. **Maintenance Margin Status**: Real-time safety indicator

5. **Time Series Graphs**:
   - Margin ratio over time
   - Interest accumulation by currency (ZAR)
   - Interest paid by currency (native amounts)
   - Loans vs collateral comparison (ZAR)

The dashboard auto-refreshes every 30 seconds and uses Prometheus labels to separate metrics by currency.

## How It Works

1. **Loan Detection**: Every hour (configurable), the service:
   - Fetches all balances from the principal subaccount
   - Identifies loans as any negative balance
   - Converts each loan value to ZAR for aggregation

2. **Interest Tracking**:
   - Fetches transaction history from the principal subaccount
   - Filters for INTEREST_PAYMENT transactions
   - Groups interest by currency
   - Converts to ZAR for total tracking

3. **Metric Calculation**:
   - **Total Interest**: Sums all INTEREST_PAYMENT amounts per currency
   - **ZAR Conversion**: Uses current VALR exchange rates
   - **Effective APR**: `(totalInterest / loanAmount) * (hoursPerYear / paymentCount) * 100`
   - **Margin Ratio**: `(total collateral value in ZAR) / (total loan value in ZAR)`

4. **Storage & Visualization**:
   - Prometheus scrapes `/metrics` every 30 seconds
   - Stores time-series data with currency labels
   - Grafana queries and displays the data

## Troubleshooting

### API Authentication Errors
- Verify VALR_API_KEY and VALR_API_SECRET are correct
- Ensure API key has permission to access subaccounts and transaction history

### No Loans Detected
- Check that your principal subaccount actually has negative balances
- Verify the subaccount name in LOAN_PRINCIPAL_SUBACCOUNT is exact
- Check loan monitor logs: `docker-compose logs loan-monitor`

### No Data in Grafana
- Verify Prometheus is scraping: http://localhost:9090/targets
- Check metrics are exposed: http://localhost:3000/metrics
- Look for errors in logs: `docker-compose logs`

### Margin Ratio Shows 0
- Ensure COLLATERAL_CURRENCY matches what's in your beneficiary subaccount
- Verify the currency pair exists on VALR for ZAR conversion
- Check for API errors in the logs

### Interest Not Showing
- Confirm you have INTEREST_PAYMENT transactions in your history
- The monitor looks back up to 1000 transactions
- If you have more than 1000 total transactions, older interest payments won't be counted

## License

MIT

## References

- [VALR API Documentation](https://docs.valr.com/)
- [Prometheus](https://prometheus.io/docs/)
- [Grafana](https://grafana.com/docs/)