import { ValrClient } from 'valr-typescript-client';
import { TransactionDatabase } from './database';
import { TransactionFetcher } from './transaction-fetcher';

export interface RepaymentMonitorConfig {
  repaymentSubaccount: string;
}

/**
 * Monitors the repayment subaccount
 * Tracks transactions for cost basis and tax reporting
 */
export class RepaymentMonitor {
  private valrClient: ValrClient;
  private db: TransactionDatabase;
  private config: RepaymentMonitorConfig;
  private transactionFetcher: TransactionFetcher;

  constructor(valrClient: ValrClient, db: TransactionDatabase, config: RepaymentMonitorConfig) {
    this.valrClient = valrClient;
    this.db = db;
    this.config = config;
    this.transactionFetcher = new TransactionFetcher(
      valrClient,
      db,
      config.repaymentSubaccount
    );
  }

  /**
   * Update repayment subaccount data
   */
  async updateMetrics(): Promise<void> {
    console.log(`\nUpdating repayment subaccount metrics (${this.config.repaymentSubaccount})...`);

    // Fetch new transactions
    await this.transactionFetcher.fetchAndStoreNewTransactions();

    // Future: Add repayment-specific metrics here
    // - Total ZAR deposited
    // - Total crypto purchased
    // - Cost basis tracking
    // - Repayment history
  }

  /**
   * Get repayment metrics
   */
  getMetrics(): RepaymentMetrics {
    return {
      subaccountId: this.config.repaymentSubaccount,
      // Future: Add calculated metrics
    };
  }
}

export interface RepaymentMetrics {
  subaccountId: string;
  // Future metrics:
  // totalZARDeposited?: number;
  // totalCryptoPurchased?: Record<string, number>;
  // costBasis?: Record<string, number>;
}
