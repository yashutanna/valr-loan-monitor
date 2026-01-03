import { TransactionDatabase } from './database';
import {ValrClient, Transaction } from "valr-typescript-client";

export interface LoanConfig {
  principalSubaccount: string;
  paymentIgnoreTransferIds?: string[];
}

export interface LoanPosition {
  currency: string;
  amount: number;
}

export interface CollateralPosition {
  currency: string;
  amount: number;
  valueInZAR: number;
}

export interface AccountStanding {
  marginFraction: number;
  collateralisedMarginFraction: number;
  initialMarginFraction: number;
  maintenanceMarginFraction: number;
  autoCloseMarginFraction: number;
  totalBorrowedInReference: number;
  collateralisedBalancesInReference: number;
  availableInReference: number;
  referenceCurrency: string;
  leverageMultiple: number;
  totalPositionsAtEntryInReference: number;
  totalUnrealisedFuturesPnlInReference: number;
}

export interface LoanMetrics {
  loans: LoanPosition[];
  collateral: CollateralPosition[];
  interestByLoanCurrency: Record<string, number>;
  interestInZAR: Record<string, number>;
  effectiveAPRByLoan: Record<string, number>;
  currentMarginRatio: number;
  interestPaymentCountByLoan: Record<string, number>;
  totalCollateralValueInZAR: number;
  totalLoanValueInZAR: number;
  hoursSinceFirstPayment: number;
  accountStanding?: AccountStanding;
  prices: Record<string, number>;
  pricesInZAR: Record<string, number>;
  monthlyAccumulatedInterest: Record<string, number>;
  monthlyAccumulatedInterestInZAR: Record<string, number>;
  currentMonthStart: string;
  totalPaymentsByCurrency: Record<string, number>;
  totalPaymentsInZAR: Record<string, number>;
}

export class LoanMonitor {
  private valrClient: ValrClient;
  private config: LoanConfig;
  private metrics: LoanMetrics;
  private firstPaymentTimestamp?: Date;
  private db: TransactionDatabase;

  constructor(valrClient: ValrClient, config: LoanConfig, dbPath?: string) {
    this.config = config;
    this.valrClient = valrClient;
    this.db = new TransactionDatabase(dbPath);
    this.valrClient.setSubaccountId(this.config.principalSubaccount);
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    this.metrics = {
      loans: [],
      collateral: [],
      interestByLoanCurrency: {},
      interestInZAR: {},
      effectiveAPRByLoan: {},
      currentMarginRatio: 0,
      interestPaymentCountByLoan: {},
      totalCollateralValueInZAR: 0,
      totalLoanValueInZAR: 0,
      hoursSinceFirstPayment: 0,
      prices: {},
      pricesInZAR: {},
      monthlyAccumulatedInterest: {},
      monthlyAccumulatedInterestInZAR: {},
      currentMonthStart: monthStart.toISOString(),
      totalPaymentsByCurrency: {},
      totalPaymentsInZAR: {},
    };
  }

  async updateMetrics(): Promise<void> {
    await this.detectLoansAndCalculateInterest();
    await this.getAccountStanding();
    await this.fetchPrices();
  }

  private async getAccountStanding(): Promise<void> {
    try {
      const marginStatus = await (this.valrClient as any).margin.getMarginStatus();

      this.metrics.accountStanding = {
        marginFraction: parseFloat(marginStatus.marginFraction),
        collateralisedMarginFraction: parseFloat(marginStatus.collateralisedMarginFraction),
        initialMarginFraction: parseFloat(marginStatus.initialMarginFraction),
        maintenanceMarginFraction: parseFloat(marginStatus.maintenanceMarginFraction),
        autoCloseMarginFraction: parseFloat(marginStatus.autoCloseMarginFraction),
        totalBorrowedInReference: parseFloat(marginStatus.totalBorrowedInReference),
        collateralisedBalancesInReference: parseFloat(marginStatus.collateralisedBalancesInReference),
        availableInReference: parseFloat(marginStatus.availableInReference),
        referenceCurrency: marginStatus.referenceCurrency,
        leverageMultiple: parseFloat(marginStatus.leverageMultiple),
        totalPositionsAtEntryInReference: parseFloat(marginStatus.totalPositionsAtEntryInReference || '0'),
        totalUnrealisedFuturesPnlInReference: parseFloat(marginStatus.totalUnrealisedFuturesPnlInReference || '0')
      };

      console.log(`Account standing: Collateral=${this.metrics.accountStanding.collateralisedBalancesInReference.toFixed(2)} ${this.metrics.accountStanding.referenceCurrency}, Borrowed=${this.metrics.accountStanding.totalBorrowedInReference.toFixed(2)} ${this.metrics.accountStanding.referenceCurrency}, Margin=${(this.metrics.accountStanding.marginFraction * 100).toFixed(2)}%, Leverage=${this.metrics.accountStanding.leverageMultiple.toFixed(2)}x`);
    } catch (error) {
      console.error('Error fetching account standing:', (error as Error).message);
      // Don't fail the whole update if account standing fails
    }
  }

  private async fetchPrices(): Promise<void> {
    try {
      const prices: Record<string, number> = {};
      const pricesInZAR: Record<string, number> = {};

      // Collect all unique currencies from loans and collateral
      const currencies = new Set<string>();
      for (const loan of this.metrics.loans) {
        currencies.add(loan.currency);
      }
      for (const coll of this.metrics.collateral) {
        currencies.add(coll.currency);
      }

      // Fetch prices in USDC for each currency
      for (const currency of currencies) {
        if (currency === 'USDC') {
          prices[currency] = 1;
        } else {
          try {
            const currencyPair = `${currency}USDC`;
            const summary = await this.valrClient.public.getMarketSummaryForPair(currencyPair);
            prices[currency] = parseFloat(summary.lastTradedPrice);
          } catch (error) {
            console.error(`Error fetching price for ${currency}USDC:`, (error as Error).message);
            // Skip this currency - don't set to 0, leave it undefined so Grafana treats it as missing data
          }
        }
      }

      // Fetch prices in ZAR for loan currencies (for payoff planning)
      for (const loan of this.metrics.loans) {
        const currency = loan.currency;
        if (currency === 'ZAR') {
          pricesInZAR[currency] = 1;
        } else {
          try {
            const currencyPair = `${currency}ZAR`;
            const summary = await this.valrClient.public.getMarketSummaryForPair(currencyPair);
            pricesInZAR[currency] = parseFloat(summary.lastTradedPrice);
          } catch (error) {
            console.error(`Error fetching price for ${currency}ZAR:`, (error as Error).message);
            // Skip this currency - don't set to 0, leave it undefined so Grafana treats it as missing data
          }
        }
      }

      this.metrics.prices = prices;
      this.metrics.pricesInZAR = pricesInZAR;
      console.log(`Fetched prices for ${currencies.size} currencies:`, Object.entries(prices).map(([curr, price]) => `${curr}=${price.toFixed(6)} USDC`).join(', '));
      console.log(`Fetched ZAR prices for ${Object.keys(pricesInZAR).length} loan currencies:`, Object.entries(pricesInZAR).map(([curr, price]) => `${curr}=${price.toFixed(2)} ZAR`).join(', '));
    } catch (error) {
      console.error('Error fetching prices:', (error as Error).message);
      // Don't fail the whole update if price fetching fails
    }
  }

  private async convertCurrencyToZAR(amount: number, currency: string): Promise<number> {
      if (currency === 'ZAR') {
          return amount;
      }

      try {
          const currencyPair = `${currency}ZAR`;
          const summary = await this.valrClient.public.getMarketSummaryForPair(currencyPair);
          const price = parseFloat(summary.lastTradedPrice);
          return amount * price;
      } catch (error) {
          console.error(`Error converting ${currency} to ZAR:`, (error as Error).message);
          throw error;
      }
  }

  private async detectLoansAndCalculateInterest(): Promise<void> {
    console.log('Detecting loans, collateral and calculating interest...');

    try {
      // Get current balances to detect loans (negative) and collateral (positive)
      const principalBalances = await this.valrClient.account.getBalances({ excludeZeroBalances: true });

      const loans: LoanPosition[] = [];
      const collateral: CollateralPosition[] = [];
      let totalLoanValueInZAR = 0;
      let totalCollateralValueInZAR = 0;

      for (const balance of principalBalances) {
        const total = parseFloat(balance.total);

        if (total < 0) {
          // Negative balance = loan
          const loanAmount = Math.abs(total);
          loans.push({
            currency: balance.currency,
            amount: loanAmount,
          });

          const loanValueInZAR = await this.convertCurrencyToZAR(loanAmount, balance.currency);
          totalLoanValueInZAR += loanValueInZAR;
        } else if (total > 0) {
          // Positive balance = collateral
          const collateralValueInZAR = await this.convertCurrencyToZAR(total, balance.currency);

          collateral.push({
            currency: balance.currency,
            amount: total,
            valueInZAR: collateralValueInZAR,
          });

          totalCollateralValueInZAR += collateralValueInZAR;
        }
      }

      this.metrics.loans = loans;
      this.metrics.collateral = collateral;
      this.metrics.totalLoanValueInZAR = totalLoanValueInZAR;
      this.metrics.totalCollateralValueInZAR = totalCollateralValueInZAR;

      // Calculate margin ratio (loan / collateral)
      // Higher ratio = more dangerous (approaching liquidation)
      const marginRatio = totalCollateralValueInZAR > 0
        ? totalLoanValueInZAR / totalCollateralValueInZAR
        : 0;
      this.metrics.currentMarginRatio = marginRatio;

      console.log(`Detected ${loans.length} loan(s): ${loans.map(l => `${l.amount.toFixed(8)} ${l.currency}`).join(', ')}`);
      console.log(`Detected ${collateral.length} collateral position(s): ${collateral.map(c => `${c.amount.toFixed(8)} ${c.currency}`).join(', ')}`);
      console.log(`Margin ratio: ${marginRatio.toFixed(4)}`);

      // Fetch new transactions incrementally
      await this.fetchAndStoreNewTransactions();

      console.log(`Total transactions in DB: ${this.db.getTransactionCount()}, Interest transactions: ${this.db.getInterestTransactionCount()}`);

      // Calculate interest from all stored transactions
      const interestByLoanCurrency: Record<string, number> = {};
      const interestInZAR: Record<string, number> = {};
      const paymentCountByLoan: Record<string, number> = {};
      const hourlyRatesByLoan: Record<string, number[]> = {};
      let firstPayment: Omit<Transaction, 'feeValue' | 'feeCurrency'> | undefined;

      const allInterestTransactions = this.db.getAllInterestTransactions();

      // Cache exchange rates to avoid repeated API calls
      const exchangeRates: Record<string, number> = {};

      for (const tx of allInterestTransactions) {
        if (tx.debitValue && tx.debitCurrency) {
          const amount = Math.abs(parseFloat(tx.debitValue));
          const currency = tx.debitCurrency;

          interestByLoanCurrency[currency] = (interestByLoanCurrency[currency] || 0) + amount;
          paymentCountByLoan[currency] = (paymentCountByLoan[currency] || 0) + 1;

          // Collect hourly rates for accurate APR calculation
          if (tx.additionalInfo?.hourlyRate) {
            if (!hourlyRatesByLoan[currency]) {
              hourlyRatesByLoan[currency] = [];
            }
            hourlyRatesByLoan[currency].push(parseFloat(tx.additionalInfo.hourlyRate));
          }

          // Set firstPayment only once (the first transaction in chronological order)
          if (!firstPayment) {
            firstPayment = tx;
          }
        }
      }

      // Convert totals to ZAR using cached exchange rates (one API call per currency)
      for (const [currency, amount] of Object.entries(interestByLoanCurrency)) {
        if (!exchangeRates[currency]) {
          exchangeRates[currency] = currency === 'ZAR' ? 1 : (await this.convertCurrencyToZAR(1, currency));
        }
        interestInZAR[currency] = amount * exchangeRates[currency];
      }

      this.metrics.interestByLoanCurrency = interestByLoanCurrency;
      this.metrics.interestInZAR = interestInZAR;
      this.metrics.interestPaymentCountByLoan = paymentCountByLoan;

      // Calculate effective APR for ALL currencies with interest payments (not just active loans)
      // This ensures APR is tracked historically even after loans are paid off or converted
      const effectiveAPRByLoan: Record<string, number> = {};
      console.log(`Hourly rates collected by currency:`, Object.keys(hourlyRatesByLoan).map(c => `${c}: ${hourlyRatesByLoan[c].length} rates`).join(', '));

      for (const [currency, rates] of Object.entries(hourlyRatesByLoan)) {
        if (rates && rates.length > 0) {
          // Calculate average hourly rate from all transactions for this currency
          const avgHourlyRate = rates.reduce((sum, rate) => sum + rate, 0) / rates.length;
          // Convert to yearly percentage
          const hoursPerYear = 365.25 * 24;
          effectiveAPRByLoan[currency] = avgHourlyRate * hoursPerYear * 100;
        }
      }

      this.metrics.effectiveAPRByLoan = effectiveAPRByLoan;

      if (firstPayment) {
        this.firstPaymentTimestamp = new Date(firstPayment.eventAt);
        this.metrics.hoursSinceFirstPayment = (Date.now() - this.firstPaymentTimestamp.getTime()) / (1000 * 60 * 60);
      }

      if (Object.keys(interestByLoanCurrency).length > 0) {
        console.log(`Interest summary: ${Object.entries(interestByLoanCurrency).map(([curr, amt]) => `${amt.toFixed(8)} ${curr}`).join(', ')}`);
      } else {
        console.log('No interest payments found in transaction history');
      }

      // Calculate monthly accumulated interest
      await this.calculateMonthlyAccumulatedInterest(exchangeRates);

      // Calculate total payments
      await this.calculatePayments(exchangeRates);
    } catch (error) {
      console.error('Error detecting loans and calculating interest:', (error as Error).message);
      throw error;
    }
  }

  private async calculateMonthlyAccumulatedInterest(exchangeRates: Record<string, number>): Promise<void> {
    const now = new Date();
    const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const currentMonthStartISO = currentMonthStart.toISOString();

    // Check if we're in a new month - reset if needed
    const storedMonthStart = new Date(this.metrics.currentMonthStart);
    if (storedMonthStart.getMonth() !== currentMonthStart.getMonth() ||
        storedMonthStart.getFullYear() !== currentMonthStart.getFullYear()) {
      console.log(`New month detected! Resetting monthly accumulated interest (was ${this.metrics.currentMonthStart}, now ${currentMonthStartISO})`);
      this.metrics.currentMonthStart = currentMonthStartISO;
      this.metrics.monthlyAccumulatedInterest = {};
      this.metrics.monthlyAccumulatedInterestInZAR = {};
    }

    // Get all interest transactions since start of current month
    const monthlyInterestTransactions = this.db.getInterestTransactionsSince(currentMonthStartISO);

    const monthlyInterest: Record<string, number> = {};
    const monthlyInterestInZAR: Record<string, number> = {};

    for (const tx of monthlyInterestTransactions) {
      if (tx.debitValue && tx.debitCurrency) {
        const amount = Math.abs(parseFloat(tx.debitValue));
        const currency = tx.debitCurrency;

        monthlyInterest[currency] = (monthlyInterest[currency] || 0) + amount;
      }
    }

    // Convert to ZAR
    for (const [currency, amount] of Object.entries(monthlyInterest)) {
      if (!exchangeRates[currency]) {
        exchangeRates[currency] = currency === 'ZAR' ? 1 : (await this.convertCurrencyToZAR(1, currency));
      }
      monthlyInterestInZAR[currency] = amount * exchangeRates[currency];
    }

    this.metrics.monthlyAccumulatedInterest = monthlyInterest;
    this.metrics.monthlyAccumulatedInterestInZAR = monthlyInterestInZAR;

    if (Object.keys(monthlyInterest).length > 0) {
      console.log(`Monthly interest (since ${currentMonthStart.toLocaleDateString()}): ${Object.entries(monthlyInterest).map(([curr, amt]) => `${amt.toFixed(8)} ${curr}`).join(', ')}`);
    } else {
      console.log(`No interest accumulated this month (since ${currentMonthStart.toLocaleDateString()})`);
    }
  }

  private async calculatePayments(exchangeRates: Record<string, number>): Promise<void> {
    // Get payment transactions, excluding those with transfer IDs in the ignore list
    // (e.g., initial collateral deposits before borrowing started)
    const ignoreTransferIds = this.config.paymentIgnoreTransferIds;
    const paymentTransactions = this.db.getAllPaymentTransactions(ignoreTransferIds);

    const totalPayments: Record<string, number> = {};
    const totalPaymentsInZAR: Record<string, number> = {};

    for (const tx of paymentTransactions) {
      if (tx.creditValue && tx.creditCurrency) {
        const amount = parseFloat(tx.creditValue);
        const currency = tx.creditCurrency;

        totalPayments[currency] = (totalPayments[currency] || 0) + amount;
      }
    }

    // Convert to ZAR
    for (const [currency, amount] of Object.entries(totalPayments)) {
      if (!exchangeRates[currency]) {
        exchangeRates[currency] = currency === 'ZAR' ? 1 : (await this.convertCurrencyToZAR(1, currency));
      }
      totalPaymentsInZAR[currency] = amount * exchangeRates[currency];
    }

    this.metrics.totalPaymentsByCurrency = totalPayments;
    this.metrics.totalPaymentsInZAR = totalPaymentsInZAR;

    if (Object.keys(totalPayments).length > 0) {
      const totalInZAR = Object.values(totalPaymentsInZAR).reduce((sum, val) => sum + val, 0);
      const ignoredCount = ignoreTransferIds?.length || 0;
      console.log(`Total payments: ${Object.entries(totalPayments).map(([curr, amt]) => `${amt.toFixed(8)} ${curr}`).join(', ')} (Total: R${totalInZAR.toFixed(2)}, ${ignoredCount} transfer(s) ignored)`);
    } else {
      console.log('No payment transactions found');
    }
  }

  private async fetchAndStoreNewTransactions(): Promise<void> {
    const latestDate = this.db.getLatestTransactionDate();

    if (latestDate) {
      console.log(`Fetching transactions newer than ${latestDate}`);
      // Fetch only new transactions
      await this.fetchTransactionsWithPagination(latestDate);
    } else {
      console.log('No existing transactions, fetching all historical data...');
      // First run - fetch all transactions
      await this.fetchTransactionsWithPagination();
    }
  }

  private async fetchTransactionsWithPagination(startTime?: string): Promise<void> {
    const limit = 200; // VALR API max
    let skip = 0;
    let totalFetched = 0;
    let newTransactionsStored = 0;
    let hasMore = true;

    while (hasMore) {
      const transactions = await this.valrClient.account.getTransactionHistory( {
          skip,
          limit,
          startTime
      });

      if (transactions.length === 0) {
        hasMore = false;
        break;
      }

      // Filter transactions newer than sinceDate if provided
      let filteredTransactions = transactions;
      if (startTime) {
        filteredTransactions = transactions.filter(tx => (new Date(tx.eventAt)).getTime() >= (new Date(startTime)).getTime());

        // If we found transactions older than sinceDate, we've reached our limit
        if (filteredTransactions.length < transactions.length) {
          hasMore = false;
        }
      }

      if (filteredTransactions.length > 0) {
        const stored = this.db.storeTransactions(filteredTransactions);
        newTransactionsStored += stored;
      }

      totalFetched += transactions.length;

      // If we got less than limit, no more transactions available
      if (transactions.length < limit) {
        hasMore = false;
      }

      skip += limit;

      // Safety limit: don't fetch more than 10,000 transactions in one go
      if (skip >= 10000) {
        console.log('Reached safety limit of 10,000 transactions');
        hasMore = false;
      }
    }

    console.log(`Fetched ${totalFetched} transactions, stored ${newTransactionsStored} new ones`);
  }

  getMetrics(): LoanMetrics {
    return {
      ...this.metrics,
      interestByLoanCurrency: { ...this.metrics.interestByLoanCurrency },
      interestInZAR: { ...this.metrics.interestInZAR },
      effectiveAPRByLoan: { ...this.metrics.effectiveAPRByLoan },
      interestPaymentCountByLoan: { ...this.metrics.interestPaymentCountByLoan },
      loans: [...this.metrics.loans],
      collateral: [...this.metrics.collateral],
      prices: { ...this.metrics.prices },
      pricesInZAR: { ...this.metrics.pricesInZAR },
      monthlyAccumulatedInterest: { ...this.metrics.monthlyAccumulatedInterest },
      monthlyAccumulatedInterestInZAR: { ...this.metrics.monthlyAccumulatedInterestInZAR },
      totalPaymentsByCurrency: { ...this.metrics.totalPaymentsByCurrency },
      totalPaymentsInZAR: { ...this.metrics.totalPaymentsInZAR },
    };
  }

  close(): void {
    this.db.close();
  }
}
