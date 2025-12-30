# VALR Loan Monitor

A comprehensive TypeScript-based monitoring service that automatically detects and tracks crypto loans, interest payments, margin status, and market prices from VALR exchange. Exposes metrics to Prometheus for real-time visualization in Grafana.

## Features

### Loan & Interest Tracking
- **Automatic Loan Detection**: Automatically detects all loans by identifying negative balances in the principal subaccount
- **Multi-Currency Support**: Tracks multiple loans across different currencies simultaneously
- **Interest Tracking**: Monitor total interest paid per loan in both native currency and ZAR
- **Effective APR Calculation**: Automatically calculates actual yearly APR based on real hourly rates from interest payments
- **SQLite Database**: Incremental transaction storage - only fetches new transactions after initial sync

### Margin & Risk Monitoring
- **Account Standing**: Real-time VALR margin status including equity, borrowed amounts, and leverage
- **Margin Health Monitoring**: Track margin fraction with visual warnings at maintenance and liquidation thresholds
- **Liquidation Distance**: Calculate how close you are to auto-liquidation
- **Collateral Tracking**: Monitor all collateral positions with live valuations
- **Margin Ratio**: Track total collateral vs total loan value ratio to prevent margin calls

### Price Tracking & Payoff Planning
- **Live Price Feeds**: Real-time price tracking for all loan and collateral currencies
- **Dual Currency Pricing**: Prices in both USDC (reference) and ZAR (for payoff planning)
- **Historical Price Charts**: Track price movements over time to optimize loan payoff timing
- **Dynamic Updates**: All prices update every 30 seconds

### Visualization & Monitoring
- **Prometheus Metrics**: All data exposed as Prometheus metrics with currency labels for historical tracking
- **Grafana Dashboard**: Pre-configured dashboard with:
  - Organized sections (Margin Details, Interest, Price Charts)
  - Dynamic template variables (auto-detects loan and collateral currencies)
  - 15+ visualization panels
  - 30-second auto-refresh
- **Docker Compose**: Complete stack with monitoring service, Prometheus, and Grafana

## How It Works

The monitor automatically:
1. **Detects loans** by finding all negative balances in your principal subaccount
2. **Detects collateral** by finding all positive balances
3. **Tracks interest** by parsing INTEREST_PAYMENT transactions stored in SQLite database
4. **Calculates APR** using actual hourly rates: `avgHourlyRate * hoursPerYear * 100`
5. **Monitors margin** using VALR's official margin status API
6. **Fetches prices** for all currencies in USDC and ZAR
7. **Updates incrementally** - only fetches new transactions after initial sync

No manual configuration of loan amounts or currencies needed!

## Metrics Tracked

### Loan & Interest Metrics
All metrics with `currency` label support multiple loans:

- `valr_loan_amount{currency}` - Amount of each loan by currency
- `valr_loan_total_interest{currency}` - Total interest paid for each loan currency
- `valr_loan_total_interest_zar{currency}` - Total interest paid in ZAR for each loan
- `valr_loan_effective_apr_percent{currency}` - Calculated effective yearly APR per loan
- `valr_loan_interest_payment_count{currency}` - Number of interest payments per loan
- `valr_loan_collateral_amount{currency}` - Amount of collateral by currency
- `valr_loan_collateral_value_zar{currency}` - Collateral value in ZAR by currency
- `valr_loan_total_value_zar` - Total value of all loans in ZAR
- `valr_loan_total_collateral_value_zar` - Total collateral value in ZAR
- `valr_loan_margin_ratio` - Current total collateral/loan ratio
- `valr_loan_hours_since_first_payment` - Time since first payment

### Account Standing Metrics
Official VALR margin status metrics:

- `valr_account_margin_fraction` - Current margin fraction (higher = safer)
- `valr_account_collateralised_margin_fraction` - Collateralised margin fraction
- `valr_account_initial_margin_fraction` - Initial margin requirement threshold
- `valr_account_maintenance_margin_fraction` - Maintenance margin threshold (5%)
- `valr_account_auto_close_margin_fraction` - Auto-close/liquidation threshold (3%)
- `valr_account_total_borrowed_in_reference` - Total borrowed amount in reference currency
- `valr_account_collateralised_balances_in_reference` - Total collateral in reference currency
- `valr_account_available_in_reference` - Available margin remaining
- `valr_account_leverage_multiple` - Current leverage (e.g., 2.97x)

### Price Metrics
Real-time market prices:

- `valr_currency_price_usdc{currency}` - Price of each currency in USDC
- `valr_currency_price_zar{currency}` - Price of each loan currency in ZAR (for payoff planning)

### System Metrics
- `valr_loan_update_total` - Counter for successful updates
- `valr_loan_update_errors_total` - Counter for failed updates

## Prerequisites

- Docker and Docker Compose
- VALR API key and secret with permissions for:
  - Reading account balances
  - Reading subaccount transactions
  - Reading margin status
  - Reading market data
- Active crypto loan(s) on VALR with:
  - Principal subaccount (where interest is paid from - will show negative balances)
  - Collateral in the same subaccount (positive balances)

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

# Subaccount ID (get this from VALR)
LOAN_PRINCIPAL_SUBACCOUNT=1234567890123456789

# Monitoring Configuration
POLL_INTERVAL_MS=3600000  # 1 hour
PORT=3000
```

Note: You don't need to specify loan currencies or amounts - they're auto-detected!

## Usage

### Quick Start with NPM Scripts

```bash
# Build and start all Docker containers
npm run docker:build
npm run docker:up

# View logs
npm run docker:logs

# Stop all containers
npm run docker:down
```

### Manual Docker Commands

Start the full stack:
```bash
docker-compose up -d
```

This starts:
- **Loan Monitor** on port 3000
- **Prometheus** on port 9090
- **Grafana** on port 3001

### Access the Services

- **Loan Monitor Status**: http://localhost:3030/status
- **Prometheus Metrics**: http://localhost:3030/metrics
- **Prometheus UI**: http://localhost:9090
- **Grafana Dashboard**: http://localhost:3001 (login: admin/admin)

### View Logs

```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f loan-monitor
```

### Trigger Manual Refresh

```bash
curl -X POST http://localhost:3030/refresh
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
| `LOAN_PRINCIPAL_SUBACCOUNT` | Subaccount ID with loans (negative balances) | Yes | - |
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
  "timestamp": "2025-12-30T04:00:00.000Z"
}
```

### GET /status
Returns current loan status, metrics, account standing, and prices
```json
{
  "loans": [
    { "currency": "USDC", "amount": 2608.54 },
    { "currency": "XRP", "amount": 12044.31 }
  ],
  "collateral": [
    { "currency": "BTC", "amount": 0.00673, "valueInZAR": 5871.45 },
    { "currency": "ETH", "amount": 12.002, "valueInZAR": 35233.67 },
    { "currency": "USDT", "amount": 156.03, "valueInZAR": 2645.23 }
  ],
  "totalLoanValueInZAR": 42500.50,
  "totalCollateralValueInZAR": 43750.35,
  "interestByLoanCurrency": {
    "USDT": 113.74,
    "USDC": 98.48,
    "XRP": 0.42
  },
  "interestInZAR": {
    "USDT": 1928.50,
    "USDC": 1670.25,
    "XRP": 13.25
  },
  "effectiveAPRByLoan": {
    "USDT": 8.45,
    "USDC": 7.92,
    "XRP": 9.15
  },
  "interestPaymentCountByLoan": {
    "USDT": 521,
    "USDC": 536,
    "XRP": 19
  },
  "marginRatio": 0.6911,
  "hoursSinceFirstPayment": 1440,
  "accountStanding": {
    "marginFraction": 0.3373,
    "collateralisedMarginFraction": 0.0999,
    "initialMarginFraction": 0.1,
    "maintenanceMarginFraction": 0.05,
    "autoCloseMarginFraction": 0.03,
    "totalBorrowedInReference": 24853.58,
    "collateralisedBalancesInReference": 27338.40,
    "availableInReference": 5897.38,
    "referenceCurrency": "USDC",
    "leverageMultiple": 2.96,
    "totalPositionsAtEntryInReference": 0,
    "totalUnrealisedFuturesPnlInReference": 0
  },
  "prices": {
    "USDC": 1,
    "XRP": 1.8577,
    "BTC": 87260,
    "ETH": 2934.77,
    "USDT": 0.99921
  },
  "pricesInZAR": {
    "USDC": 16.95,
    "XRP": 31.55
  }
}
```

### POST /refresh
Manually trigger a metrics update
```json
{
  "status": "success",
  "message": "Metrics updated successfully"
}
```

## Grafana Dashboard

The included Grafana dashboard is organized into sections:

### Margin Details Row
1. **Current Leverage**: Shows your leverage multiple (e.g., 2.97x)
2. **Margin Fraction (Health)**: Circular gauge with color-coded thresholds
   - Red: 0-3% (Liquidation zone)
   - Orange: 3-5% (Danger)
   - Yellow: 5-10% (Warning)
   - Green: 10%+ (Healthy)
3. **Available Margin**: Amount available to borrow more
4. **Total Interest Paid**: All-time interest across all loans in ZAR
5. **Margin Fraction with Thresholds**: Time series showing current margin vs liquidation thresholds
6. **Loan to Collateral Ratio**: Progress bar visualization
7. **Distance to Liquidation**: How far you are from auto-liquidation
8. **Borrowed vs Collateral Over Time**: Track the relationship between your debt and collateral
9. **Loan Distribution by Currency**: Pie chart

### Interest Row (Collapsible)
1. **Interest Accumulation by Currency (ZAR)**: Time series of cumulative interest
2. **Interest Distribution by Currency (ZAR)**: Pie chart breakdown
3. **Effective APR by Loan**: Bar gauge comparing rates
4. **Interest Paid by Currency (Native)**: Time series in original currencies

### Price Charts Row (Collapsible)
1. **Loan Currency Prices in ZAR (Payoff Planning)**: Full-width chart for timing loan payoffs
   - Shows current, average, min, and max prices
   - Lower prices = better time to pay off loans with ZAR
2. **Collateral Prices in USDC**: Track collateral value changes
3. **Loan Currency Prices in USDC**: Monitor loan currency movements

### Dynamic Features
- **Template Variables**: Auto-populated dropdowns for filtering:
  - Loan Currencies (from active loans)
  - Collateral Currencies (from active collateral)
- **Auto-refresh**: Dashboard updates every 30 seconds
- **Responsive**: All charts adapt to available currencies

## Database

The service uses SQLite to store transaction history:
- **Location**: `./volumes/sqlite/transactions.db` (persisted in Docker volume)
- **Incremental Sync**: Only fetches new transactions after initial load
- **Automatic Management**: Database is created and managed automatically
- **No Maintenance**: Reset by deleting the volume: `docker-compose down -v`

## How Metrics Are Calculated

### Effective APR
Uses actual hourly rates from VALR interest payments:
```
avgHourlyRate = sum(hourlyRates) / count(payments)
effectiveAPR = avgHourlyRate * (365.25 * 24) * 100
```

### Margin Ratio
Compares total loan value to total collateral value:
```
marginRatio = totalLoanValueInZAR / totalCollateralValueInZAR
```
Higher ratio = more dangerous (approaching maintenance margin)

### Account Standing
Fetched directly from VALR's margin status API:
- **Margin Fraction**: `collateral / borrowed` - higher is safer
- **Leverage Multiple**: How much you're borrowing relative to equity
- **Available Margin**: Additional borrowing capacity

## Payoff Planning with ZAR Prices

The "Loan Currency Prices in ZAR" chart helps you optimize when to pay off loans:

**Strategy**: Pay off loans when the price is LOW
- Lower price = Your ZAR buys more of the loan currency
- Example: If XRP drops from R32 to R28, you save R4 per XRP when paying off

**When to Avoid**: Don't pay off when prices are HIGH
- Higher price = Your ZAR buys less of the loan currency
- Wait for dips to maximize your ZAR value

The chart shows:
- **Current**: Latest price
- **Mean**: Average over time period
- **Min**: Best price seen (ideal payoff time)
- **Max**: Worst price seen (avoid paying off)

## Troubleshooting

### API Authentication Errors
- Verify VALR_API_KEY and VALR_API_SECRET are correct
- Ensure API key has permissions for subaccounts, transactions, margin status, and market data

### No Loans Detected
- Check that your principal subaccount has negative balances
- Verify the subaccount ID in LOAN_PRINCIPAL_SUBACCOUNT is correct
- Check loan monitor logs: `docker-compose logs loan-monitor`

### No Data in Grafana
- Verify Prometheus is scraping: http://localhost:9090/targets
- Check metrics are exposed: http://localhost:3030/metrics
- Look for errors in logs: `docker-compose logs`
- Ensure all containers are running: `docker-compose ps`

### Account Standing Shows Zeros
- Verify your account has margin trading enabled on VALR
- Check API key has permission to read margin status
- Look for API errors in logs

### Price Data Missing
- Ensure currency pairs exist on VALR (e.g., XRPUSDC, XRPZAR)
- Check for API rate limiting in logs
- Verify network connectivity from container

### Database Issues
- Reset database: `docker-compose down -v` (WARNING: loses historical data)
- Check disk space for SQLite database
- View database: `sqlite3 ./volumes/sqlite/transactions.db`

## Performance Notes

- **Initial Sync**: First run fetches up to 10,000 transactions (may take 1-2 minutes)
- **Incremental Updates**: Subsequent runs only fetch new transactions (seconds)
- **API Calls**: ~20 API calls per update (prices, balances, transactions, margin status)
- **Memory**: ~100MB for container
- **Storage**: SQLite database grows ~1MB per 10,000 transactions

## License

MIT

## References

- [VALR API Documentation](https://docs.valr.com/)
- [Prometheus](https://prometheus.io/docs/)
- [Grafana](https://grafana.com/docs/)
- [prom-client](https://github.com/siimon/prom-client)
- [valr-typescript-client](https://www.npmjs.com/package/valr-typescript-client)
