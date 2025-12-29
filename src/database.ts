import Database from 'better-sqlite3';
import { Transaction } from 'valr-typescript-client';

export class TransactionDatabase {
  private db: Database.Database;

  constructor(dbPath: string = './data/transactions.db') {
    this.db = new Database(dbPath);
    this.initializeSchema();
  }

  private initializeSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS transactions (
        id TEXT PRIMARY KEY,
        transaction_type TEXT NOT NULL,
        transaction_description TEXT,
        debit_currency TEXT,
        debit_value TEXT,
        credit_currency TEXT,
        credit_value TEXT,
        event_at TEXT NOT NULL,
        additional_info TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_event_at ON transactions(event_at DESC);
      CREATE INDEX IF NOT EXISTS idx_transaction_type ON transactions(transaction_type);
      CREATE INDEX IF NOT EXISTS idx_debit_currency ON transactions(debit_currency);
    `);
  }

  storeTransactions(transactions: Transaction[]): number {
    const insert = this.db.prepare(`
      INSERT OR IGNORE INTO transactions (
        id, transaction_type, transaction_description,
        debit_currency, debit_value, credit_currency, credit_value,
        event_at, additional_info
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = this.db.transaction((txs: Transaction[]) => {
      let inserted = 0;
      for (const tx of txs) {
        const result = insert.run(
          tx.id,
          tx.transactionType.type,
          tx.transactionType.description,
          tx.debitCurrency || null,
          tx.debitValue || null,
          tx.creditCurrency || null,
          tx.creditValue || null,
          tx.eventAt,
          tx.additionalInfo ? JSON.stringify(tx.additionalInfo) : null
        );
        inserted += result.changes;
      }
      return inserted;
    });

    return insertMany(transactions);
  }

  getLatestTransactionDate(): string | null {
    const result = this.db.prepare('SELECT event_at FROM transactions ORDER BY event_at DESC LIMIT 1').get() as { event_at: string } | undefined;
    return result?.event_at || null;
  }

  getAllInterestTransactions(): Omit<Transaction, 'feeCurrency' | 'feeValue'>[] {
    const rows = this.db.prepare(`
      SELECT * FROM transactions
      WHERE transaction_type LIKE '%INTEREST%' OR transaction_type LIKE '%BORROW%'
      ORDER BY event_at ASC
    `).all() as any[];

    return rows.map(row => ({
      id: row.id,
      transactionType: {
        type: row.transaction_type,
        description: row.transaction_description || ''
      },
      debitCurrency: row.debit_currency || undefined,
      debitValue: row.debit_value || undefined,
      creditCurrency: row.credit_currency || undefined,
      creditValue: row.credit_value || undefined,
      eventAt: row.event_at,
      additionalInfo: row.additional_info ? JSON.parse(row.additional_info) : undefined
    }));
  }

  getTransactionCount(): number {
    const result = this.db.prepare('SELECT COUNT(*) as count FROM transactions').get() as { count: number };
    return result.count;
  }

  getInterestTransactionCount(): number {
    const result = this.db.prepare(`
      SELECT COUNT(*) as count FROM transactions
      WHERE transaction_type LIKE '%INTEREST%' OR transaction_type LIKE '%BORROW%'
    `).get() as { count: number };
    return result.count;
  }

  close(): void {
    this.db.close();
  }
}
