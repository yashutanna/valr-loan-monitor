import { ValrClient, Transaction } from 'valr-typescript-client';
import { TransactionDatabase } from './database';

/**
 * Utility class for fetching and storing transactions
 * Shared by LoanMonitor and RepaymentMonitor
 */
export class TransactionFetcher {
  private valrClient: ValrClient;
  private db: TransactionDatabase;
  private accountId: string;

  constructor(valrClient: ValrClient, db: TransactionDatabase, accountId: string) {
    this.valrClient = valrClient;
    this.db = db;
    this.accountId = accountId;
  }

  /**
   * Fetch and store new transactions incrementally
   */
  async fetchAndStoreNewTransactions(): Promise<void> {
    const latestDate = this.db.getLatestTransactionDate(this.accountId);

    if (latestDate) {
      console.log(`[${this.accountId}] Fetching transactions newer than ${latestDate}`);
      await this.fetchTransactionsWithPagination(latestDate);
    } else {
      console.log(`[${this.accountId}] No existing transactions, fetching all historical data...`);
      await this.fetchTransactionsWithPagination();
    }
  }

  /**
   * Fetch transactions with pagination
   */
  private async fetchTransactionsWithPagination(startTime?: string): Promise<void> {
    const limit = 200; // VALR API max
    let skip = 0;
    let totalFetched = 0;
    let newTransactionsStored = 0;
    let hasMore = true;

    while (hasMore) {
      const transactions = await this.valrClient.account.getTransactionHistory({
        skip,
        limit,
        startTime
      });

      if (transactions.length === 0) {
        hasMore = false;
        break;
      }

      // Filter transactions newer than startTime if provided
      let filteredTransactions = transactions;
      if (startTime) {
        filteredTransactions = transactions.filter(
          tx => new Date(tx.eventAt).getTime() >= new Date(startTime).getTime()
        );

        // If we found transactions older than startTime, we've reached our limit
        if (filteredTransactions.length < transactions.length) {
          hasMore = false;
        }
      }

      if (filteredTransactions.length > 0) {
        const stored = this.db.storeTransactions(filteredTransactions, this.accountId);
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
        console.log(`[${this.accountId}] Reached safety limit of 10,000 transactions`);
        hasMore = false;
      }
    }

    console.log(`[${this.accountId}] Fetched ${totalFetched} transactions, stored ${newTransactionsStored} new ones`);
  }

  /**
   * Get all transactions for this account from database
   */
  getTransactionsFromDB(filters?: { transactionType?: string; currency?: string }): Transaction[] {
    // This can be enhanced with actual filtering logic if needed
    return [];
  }
}
