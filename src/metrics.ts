import { Registry, Gauge, Counter } from 'prom-client';
import { LoanMonitor } from './loan-monitor';

export class MetricsExporter {
  private register: Registry;
  private loanMonitor: LoanMonitor;

  private loanAmountGauge: Gauge;
  private totalInterestGauge: Gauge;
  private totalInterestZARGauge: Gauge;
  private effectiveAPRGauge: Gauge;
  private marginRatioGauge: Gauge;
  private hoursSinceFirstPaymentGauge: Gauge;
  private interestPaymentCountGauge: Gauge;
  private collateralAmountGauge: Gauge;
  private collateralValueZARGauge: Gauge;
  private totalLoanValueZARGauge: Gauge;
  private totalCollateralValueZARGauge: Gauge;
  private updateCounter: Counter;
  private updateErrorCounter: Counter;

  // Account standing gauges
  private marginFractionGauge: Gauge;
  private collateralisedMarginFractionGauge: Gauge;
  private initialMarginFractionGauge: Gauge;
  private maintenanceMarginFractionGauge: Gauge;
  private autoCloseMarginFractionGauge: Gauge;
  private totalBorrowedInReferenceGauge: Gauge;
  private collateralisedBalancesInReferenceGauge: Gauge;
  private availableInReferenceGauge: Gauge;
  private leverageMultipleGauge: Gauge;

  // Price gauges
  private priceGauge: Gauge;
  private priceInZARGauge: Gauge;

  // Disk usage gauges
  private diskUsageTotalGauge: Gauge;
  private diskUsageByComponentGauge: Gauge;

  // Monthly interest gauges
  private monthlyAccumulatedInterestGauge: Gauge;
  private monthlyAccumulatedInterestZARGauge: Gauge;

  // Payment gauges
  private totalPaymentsGauge: Gauge;
  private totalPaymentsZARGauge: Gauge;

  constructor(loanMonitor: LoanMonitor) {
    this.register = new Registry();
    this.loanMonitor = loanMonitor;

    this.loanAmountGauge = new Gauge({
      name: 'valr_loan_amount',
      help: 'Amount of each loan by currency',
      labelNames: ['currency'],
      registers: [this.register],
    });

    this.totalInterestGauge = new Gauge({
      name: 'valr_loan_total_interest',
      help: 'Total interest paid for each loan currency',
      labelNames: ['currency'],
      registers: [this.register],
    });

    this.totalInterestZARGauge = new Gauge({
      name: 'valr_loan_total_interest_zar',
      help: 'Total interest paid in ZAR for each loan currency',
      labelNames: ['currency'],
      registers: [this.register],
    });

    this.effectiveAPRGauge = new Gauge({
      name: 'valr_loan_effective_apr_percent',
      help: 'Average effective yearly APR calculated from actual hourly rates across all interest payments',
      labelNames: ['currency'],
      registers: [this.register],
    });

    this.interestPaymentCountGauge = new Gauge({
      name: 'valr_loan_interest_payment_count',
      help: 'Total number of interest payments for each loan',
      labelNames: ['currency'],
      registers: [this.register],
    });

    this.marginRatioGauge = new Gauge({
      name: 'valr_loan_margin_ratio',
      help: 'Current margin ratio (total loan value / total collateral value in ZAR). Higher = more dangerous.',
      registers: [this.register],
    });

    this.hoursSinceFirstPaymentGauge = new Gauge({
      name: 'valr_loan_hours_since_first_payment',
      help: 'Hours since the first interest payment',
      registers: [this.register],
    });

    this.collateralAmountGauge = new Gauge({
      name: 'valr_loan_collateral_amount',
      help: 'Amount of collateral by currency',
      labelNames: ['currency'],
      registers: [this.register],
    });

    this.collateralValueZARGauge = new Gauge({
      name: 'valr_loan_collateral_value_zar',
      help: 'Value of collateral in ZAR by currency',
      labelNames: ['currency'],
      registers: [this.register],
    });

    this.totalLoanValueZARGauge = new Gauge({
      name: 'valr_loan_total_value_zar',
      help: 'Total value of all loans in ZAR',
      registers: [this.register],
    });

    this.totalCollateralValueZARGauge = new Gauge({
      name: 'valr_loan_total_collateral_value_zar',
      help: 'Total value of all collateral in ZAR',
      registers: [this.register],
    });

    this.updateCounter = new Counter({
      name: 'valr_loan_update_total',
      help: 'Total number of metric update operations',
      registers: [this.register],
    });

    this.updateErrorCounter = new Counter({
      name: 'valr_loan_update_errors_total',
      help: 'Total number of metric update errors',
      registers: [this.register],
    });

    // Account standing metrics
    this.marginFractionGauge = new Gauge({
      name: 'valr_account_margin_fraction',
      help: 'Current margin fraction (higher = safer)',
      registers: [this.register],
    });

    this.collateralisedMarginFractionGauge = new Gauge({
      name: 'valr_account_collateralised_margin_fraction',
      help: 'Collateralised margin fraction',
      registers: [this.register],
    });

    this.initialMarginFractionGauge = new Gauge({
      name: 'valr_account_initial_margin_fraction',
      help: 'Initial margin fraction requirement',
      registers: [this.register],
    });

    this.maintenanceMarginFractionGauge = new Gauge({
      name: 'valr_account_maintenance_margin_fraction',
      help: 'Maintenance margin fraction threshold',
      registers: [this.register],
    });

    this.autoCloseMarginFractionGauge = new Gauge({
      name: 'valr_account_auto_close_margin_fraction',
      help: 'Auto-close margin fraction threshold (liquidation level)',
      registers: [this.register],
    });

    this.totalBorrowedInReferenceGauge = new Gauge({
      name: 'valr_account_total_borrowed_in_reference',
      help: 'Total borrowed amount in reference currency',
      registers: [this.register],
    });

    this.collateralisedBalancesInReferenceGauge = new Gauge({
      name: 'valr_account_collateralised_balances_in_reference',
      help: 'Total collateralised balances in reference currency',
      registers: [this.register],
    });

    this.availableInReferenceGauge = new Gauge({
      name: 'valr_account_available_in_reference',
      help: 'Available margin in reference currency',
      registers: [this.register],
    });

    this.leverageMultipleGauge = new Gauge({
      name: 'valr_account_leverage_multiple',
      help: 'Current leverage multiple',
      registers: [this.register],
    });

    this.priceGauge = new Gauge({
      name: 'valr_currency_price_usdc',
      help: 'Current price of each currency in USDC',
      labelNames: ['currency'],
      registers: [this.register],
    });

    this.priceInZARGauge = new Gauge({
      name: 'valr_currency_price_zar',
      help: 'Current price of each loan currency in ZAR (for payoff planning)',
      labelNames: ['currency'],
      registers: [this.register],
    });

    this.diskUsageTotalGauge = new Gauge({
      name: 'valr_disk_usage_bytes',
      help: 'Total disk usage by the application in bytes',
      registers: [this.register],
    });

    this.diskUsageByComponentGauge = new Gauge({
      name: 'valr_disk_usage_by_component_bytes',
      help: 'Disk usage by component (database, prometheus, grafana) in bytes',
      labelNames: ['component'],
      registers: [this.register],
    });

    this.monthlyAccumulatedInterestGauge = new Gauge({
      name: 'valr_monthly_accumulated_interest',
      help: 'Interest accumulated this month (resets on 1st) by currency',
      labelNames: ['currency'],
      registers: [this.register],
    });

    this.monthlyAccumulatedInterestZARGauge = new Gauge({
      name: 'valr_monthly_accumulated_interest_zar',
      help: 'Interest accumulated this month in ZAR (resets on 1st) by currency',
      labelNames: ['currency'],
      registers: [this.register],
    });

    this.totalPaymentsGauge = new Gauge({
      name: 'valr_total_payments',
      help: 'Total payments (deposits) made to the account by currency',
      labelNames: ['currency'],
      registers: [this.register],
    });

    this.totalPaymentsZARGauge = new Gauge({
      name: 'valr_total_payments_zar',
      help: 'Total payments (deposits) made to the account in ZAR by currency',
      labelNames: ['currency'],
      registers: [this.register],
    });
  }

  updateMetrics(): void {
    const metrics = this.loanMonitor.getMetrics();

    // Reset all gauges with labels to avoid stale metrics
    this.loanAmountGauge.reset();
    this.totalInterestGauge.reset();
    this.totalInterestZARGauge.reset();
    this.effectiveAPRGauge.reset();
    this.interestPaymentCountGauge.reset();
    this.collateralAmountGauge.reset();
    this.collateralValueZARGauge.reset();

    // Update per-loan metrics for active loans
    for (const loan of metrics.loans) {
      this.loanAmountGauge.set({ currency: loan.currency }, loan.amount);
    }

    // Update interest metrics for ALL currencies (including paid-off loans)
    // This ensures historical interest data is always visible
    const allCurrenciesWithInterest = new Set([
      ...Object.keys(metrics.interestByLoanCurrency),
      ...Object.keys(metrics.interestInZAR),
      ...Object.keys(metrics.effectiveAPRByLoan),
      ...Object.keys(metrics.interestPaymentCountByLoan)
    ]);

    for (const currency of allCurrenciesWithInterest) {
      const interest = metrics.interestByLoanCurrency[currency] || 0;
      this.totalInterestGauge.set({ currency }, interest);

      const interestZAR = metrics.interestInZAR[currency] || 0;
      this.totalInterestZARGauge.set({ currency }, interestZAR);

      const apr = metrics.effectiveAPRByLoan[currency] || 0;
      this.effectiveAPRGauge.set({ currency }, apr);

      const paymentCount = metrics.interestPaymentCountByLoan[currency] || 0;
      this.interestPaymentCountGauge.set({ currency }, paymentCount);
    }

    // Update per-collateral metrics
    for (const coll of metrics.collateral) {
      this.collateralAmountGauge.set({ currency: coll.currency }, coll.amount);
      this.collateralValueZARGauge.set({ currency: coll.currency }, coll.valueInZAR);
    }

    // Update aggregate metrics
    this.marginRatioGauge.set(metrics.currentMarginRatio);
    this.hoursSinceFirstPaymentGauge.set(metrics.hoursSinceFirstPayment);
    this.totalLoanValueZARGauge.set(metrics.totalLoanValueInZAR);
    this.totalCollateralValueZARGauge.set(metrics.totalCollateralValueInZAR);

    // Update account standing metrics
    if (metrics.accountStanding) {
      this.marginFractionGauge.set(metrics.accountStanding.marginFraction);
      this.collateralisedMarginFractionGauge.set(metrics.accountStanding.collateralisedMarginFraction);
      this.initialMarginFractionGauge.set(metrics.accountStanding.initialMarginFraction);
      this.maintenanceMarginFractionGauge.set(metrics.accountStanding.maintenanceMarginFraction);
      this.autoCloseMarginFractionGauge.set(metrics.accountStanding.autoCloseMarginFraction);
      this.totalBorrowedInReferenceGauge.set(metrics.accountStanding.totalBorrowedInReference);
      this.collateralisedBalancesInReferenceGauge.set(metrics.accountStanding.collateralisedBalancesInReference);
      this.availableInReferenceGauge.set(metrics.accountStanding.availableInReference);
      this.leverageMultipleGauge.set(metrics.accountStanding.leverageMultiple);
    }

    // Update price metrics
    this.priceGauge.reset();
    for (const [currency, price] of Object.entries(metrics.prices)) {
      this.priceGauge.set({ currency }, price);
    }

    // Update ZAR price metrics
    this.priceInZARGauge.reset();
    for (const [currency, price] of Object.entries(metrics.pricesInZAR)) {
      this.priceInZARGauge.set({ currency }, price);
    }

    // Update monthly accumulated interest metrics
    this.monthlyAccumulatedInterestGauge.reset();
    this.monthlyAccumulatedInterestZARGauge.reset();
    for (const [currency, amount] of Object.entries(metrics.monthlyAccumulatedInterest)) {
      this.monthlyAccumulatedInterestGauge.set({ currency }, amount);
    }
    for (const [currency, amount] of Object.entries(metrics.monthlyAccumulatedInterestInZAR)) {
      this.monthlyAccumulatedInterestZARGauge.set({ currency }, amount);
    }

    // Update payment metrics
    this.totalPaymentsGauge.reset();
    this.totalPaymentsZARGauge.reset();
    for (const [currency, amount] of Object.entries(metrics.totalPaymentsByCurrency)) {
      this.totalPaymentsGauge.set({ currency }, amount);
    }
    for (const [currency, amount] of Object.entries(metrics.totalPaymentsInZAR)) {
      this.totalPaymentsZARGauge.set({ currency }, amount);
    }
  }

  incrementUpdateCounter(): void {
    this.updateCounter.inc();
  }

  incrementUpdateErrorCounter(): void {
    this.updateErrorCounter.inc();
  }

  updateDiskUsage(totalBytes: number, breakdown: Record<string, number>): void {
    this.diskUsageTotalGauge.set(totalBytes);

    this.diskUsageByComponentGauge.reset();
    for (const [component, bytes] of Object.entries(breakdown)) {
      this.diskUsageByComponentGauge.set({ component }, bytes);
    }
  }

  async getMetrics(): Promise<string> {
    return this.register.metrics();
  }

  getRegister(): Registry {
    return this.register;
  }
}
