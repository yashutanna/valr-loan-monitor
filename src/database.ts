import Database from 'better-sqlite3';
import { Transaction } from 'valr-typescript-client';

export class TransactionDatabase {
  private db: Database.Database;

  constructor(dbPath: string = './data/transactions.db') {
    this.db = new Database(dbPath);
    this.initializeSchema();
    this.runMigrations();
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

      -- Friends & Family Payments
      CREATE TABLE IF NOT EXISTS ff_payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        loan_id TEXT NOT NULL,
        payment_date TEXT NOT NULL,
        amount_zar REAL NOT NULL,
        crypto_currency TEXT NOT NULL,
        crypto_amount REAL NOT NULL,
        transfer_id TEXT,
        payment_type TEXT CHECK(payment_type IN ('INTEREST', 'PRINCIPAL')),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_ff_payments_loan ON ff_payments(loan_id);
      CREATE INDEX IF NOT EXISTS idx_ff_payments_date ON ff_payments(payment_date DESC);

      -- Repayment Execution Log
      CREATE TABLE IF NOT EXISTS repayment_executions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        execution_date TEXT NOT NULL,
        actions_planned INTEGER NOT NULL,
        actions_executed INTEGER NOT NULL,
        total_zar_spent REAL NOT NULL,
        ff_payments_count INTEGER DEFAULT 0,
        valr_payments_count INTEGER DEFAULT 0,
        success INTEGER NOT NULL,
        errors TEXT,
        execution_details TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_repayment_exec_date ON repayment_executions(execution_date DESC);

      -- VALR Loan Repayments
      CREATE TABLE IF NOT EXISTS valr_loan_repayments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        execution_id INTEGER NOT NULL,
        currency TEXT NOT NULL,
        amount REAL NOT NULL,
        amount_zar REAL NOT NULL,
        transfer_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (execution_id) REFERENCES repayment_executions(id)
      );

      CREATE INDEX IF NOT EXISTS idx_valr_repayments_currency ON valr_loan_repayments(currency);
      CREATE INDEX IF NOT EXISTS idx_valr_repayments_exec ON valr_loan_repayments(execution_id);
    `);
  }

  private runMigrations(): void {
    // Migration 1: Add account_id column to transactions table
    const transactionsTableInfo = this.db.prepare("PRAGMA table_info(transactions)").all() as any[];
    const hasAccountId = transactionsTableInfo.some(col => col.name === 'account_id');

    if (!hasAccountId) {
      console.log('Running migration: Adding account_id column to transactions table');
      this.db.exec(`
        ALTER TABLE transactions ADD COLUMN account_id TEXT;
        CREATE INDEX IF NOT EXISTS idx_account_id ON transactions(account_id);
      `);
      console.log('Migration complete: account_id column added');
    }

    // Migration 2: Remove dry_run columns from repayment tables
    // SQLite doesn't support DROP COLUMN directly, so we need to recreate tables

    // Check if any of the repayment tables have dry_run column
    let needsMigration = false;

    try {
      const ffPaymentsTableInfo = this.db.prepare("PRAGMA table_info(ff_payments)").all() as any[];
      if (ffPaymentsTableInfo.some(col => col.name === 'dry_run')) {
        needsMigration = true;
      }
    } catch (e) {
      // Table doesn't exist yet, skip
    }

    try {
      const repaymentExecTableInfo = this.db.prepare("PRAGMA table_info(repayment_executions)").all() as any[];
      if (repaymentExecTableInfo.some(col => col.name === 'dry_run')) {
        needsMigration = true;
      }
    } catch (e) {
      // Table doesn't exist yet, skip
    }

    try {
      const valrRepaymentsTableInfo = this.db.prepare("PRAGMA table_info(valr_loan_repayments)").all() as any[];
      if (valrRepaymentsTableInfo.some(col => col.name === 'dry_run')) {
        needsMigration = true;
      }
    } catch (e) {
      // Table doesn't exist yet, skip
    }

    if (needsMigration) {
      console.log('Running migration: Removing dry_run columns from repayment tables');

      // Temporarily disable foreign key constraints for migration
      this.db.exec('PRAGMA foreign_keys = OFF;');

      // Remove dry_run from ff_payments
      this.db.exec(`
        CREATE TABLE ff_payments_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          loan_id TEXT NOT NULL,
          payment_date TEXT NOT NULL,
          amount_zar REAL NOT NULL,
          crypto_currency TEXT NOT NULL,
          crypto_amount REAL NOT NULL,
          transfer_id TEXT,
          payment_type TEXT CHECK(payment_type IN ('INTEREST', 'PRINCIPAL')),
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        INSERT INTO ff_payments_new (id, loan_id, payment_date, amount_zar, crypto_currency, crypto_amount, transfer_id, payment_type, created_at)
        SELECT id, loan_id, payment_date, amount_zar, crypto_currency, crypto_amount, transfer_id, payment_type, created_at
        FROM ff_payments
        WHERE dry_run = 0;

        DROP TABLE ff_payments;
        ALTER TABLE ff_payments_new RENAME TO ff_payments;

        CREATE INDEX IF NOT EXISTS idx_ff_payments_loan ON ff_payments(loan_id);
        CREATE INDEX IF NOT EXISTS idx_ff_payments_date ON ff_payments(payment_date DESC);
      `);

      // Remove dry_run from repayment_executions
      this.db.exec(`
        CREATE TABLE repayment_executions_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          execution_date TEXT NOT NULL,
          actions_planned INTEGER NOT NULL,
          actions_executed INTEGER NOT NULL,
          total_zar_spent REAL NOT NULL,
          ff_payments_count INTEGER DEFAULT 0,
          valr_payments_count INTEGER DEFAULT 0,
          success INTEGER NOT NULL,
          errors TEXT,
          execution_details TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        INSERT INTO repayment_executions_new (id, execution_date, actions_planned, actions_executed, total_zar_spent, ff_payments_count, valr_payments_count, success, errors, execution_details, created_at)
        SELECT id, execution_date, actions_planned, actions_executed, total_zar_spent, ff_payments_count, valr_payments_count, success, errors, execution_details, created_at
        FROM repayment_executions
        WHERE dry_run = 0;

        DROP TABLE repayment_executions;
        ALTER TABLE repayment_executions_new RENAME TO repayment_executions;

        CREATE INDEX IF NOT EXISTS idx_repayment_exec_date ON repayment_executions(execution_date DESC);
      `);

      // Remove dry_run from valr_loan_repayments
      this.db.exec(`
        CREATE TABLE valr_loan_repayments_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          execution_id INTEGER NOT NULL,
          currency TEXT NOT NULL,
          amount REAL NOT NULL,
          amount_zar REAL NOT NULL,
          transfer_id TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (execution_id) REFERENCES repayment_executions(id)
        );

        INSERT INTO valr_loan_repayments_new (id, execution_id, currency, amount, amount_zar, transfer_id, created_at)
        SELECT id, execution_id, currency, amount, amount_zar, transfer_id, created_at
        FROM valr_loan_repayments
        WHERE dry_run = 0 AND execution_id IN (SELECT id FROM repayment_executions_new);

        DROP TABLE valr_loan_repayments;
        ALTER TABLE valr_loan_repayments_new RENAME TO valr_loan_repayments;

        CREATE INDEX IF NOT EXISTS idx_valr_repayments_currency ON valr_loan_repayments(currency);
        CREATE INDEX IF NOT EXISTS idx_valr_repayments_exec ON valr_loan_repayments(execution_id);
      `);

      // Re-enable foreign key constraints
      this.db.exec('PRAGMA foreign_keys = ON;');

      console.log('Migration complete: dry_run columns removed, dry run data discarded');
    }
  }

  storeTransactions(transactions: Transaction[], accountId?: string): number {
    const insert = this.db.prepare(`
      INSERT OR IGNORE INTO transactions (
        id, transaction_type, transaction_description,
        debit_currency, debit_value, credit_currency, credit_value,
        event_at, additional_info, account_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          tx.additionalInfo ? JSON.stringify(tx.additionalInfo) : null,
          accountId || null
        );
        inserted += result.changes;
      }
      return inserted;
    });

    return insertMany(transactions);
  }

  getLatestTransactionDate(accountId?: string): string | null {
    if (accountId) {
      const result = this.db.prepare('SELECT event_at FROM transactions WHERE account_id = ? ORDER BY event_at DESC LIMIT 1').get(accountId) as { event_at: string } | undefined;
      return result?.event_at || null;
    } else {
      const result = this.db.prepare('SELECT event_at FROM transactions ORDER BY event_at DESC LIMIT 1').get() as { event_at: string } | undefined;
      return result?.event_at || null;
    }
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

  getInterestTransactionsSince(sinceDate: string): Omit<Transaction, 'feeCurrency' | 'feeValue'>[] {
    const rows = this.db.prepare(`
      SELECT * FROM transactions
      WHERE (transaction_type LIKE '%INTEREST%' OR transaction_type LIKE '%BORROW%')
        AND event_at >= ?
      ORDER BY event_at ASC
    `).all(sinceDate) as any[];

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

  getAllPaymentTransactions(ignoreTransferIds?: string[]): Omit<Transaction, 'feeCurrency' | 'feeValue'>[] {
    const rows = this.db.prepare(`
      SELECT * FROM transactions
      WHERE transaction_type = 'INTERNAL_TRANSFER' AND credit_currency IS NOT NULL
      ORDER BY event_at ASC
    `).all() as any[];

    return rows
      .map(row => ({
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
      }))
      .filter(tx => {
        // Filter out transactions with transfer IDs in the ignore list
        if (!ignoreTransferIds || ignoreTransferIds.length === 0) {
          return true;
        }
        const transferId = tx.additionalInfo?.transferId;
        return !transferId || !ignoreTransferIds.includes(transferId);
      });
  }

  // Friends & Family Payment methods
  recordFFPayment(payment: {
    loanId: string;
    paymentDate: string;
    amountZAR: number;
    cryptoCurrency: string;
    cryptoAmount: number;
    transferId?: string;
    paymentType: 'INTEREST' | 'PRINCIPAL';
  }): number {
    const result = this.db.prepare(`
      INSERT INTO ff_payments (
        loan_id, payment_date, amount_zar, crypto_currency,
        crypto_amount, transfer_id, payment_type
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      payment.loanId,
      payment.paymentDate,
      payment.amountZAR,
      payment.cryptoCurrency,
      payment.cryptoAmount,
      payment.transferId || null,
      payment.paymentType
    );
    return result.lastInsertRowid as number;
  }

  getFFPaymentHistory(loanId: string, limit?: number): any[] {
    const query = limit
      ? `SELECT * FROM ff_payments WHERE loan_id = ? ORDER BY payment_date DESC LIMIT ?`
      : `SELECT * FROM ff_payments WHERE loan_id = ? ORDER BY payment_date DESC`;

    const params = limit ? [loanId, limit] : [loanId];
    return this.db.prepare(query).all(...params) as any[];
  }

  getFFPaymentsThisMonth(loanId: string): any[] {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    return this.db.prepare(`
      SELECT * FROM ff_payments
      WHERE loan_id = ? AND payment_date >= ?
      ORDER BY payment_date DESC
    `).all(loanId, monthStart) as any[];
  }

  getFFTotalInterestPaid(loanId: string): number {
    const result = this.db.prepare(`
      SELECT COALESCE(SUM(amount_zar), 0) as total
      FROM ff_payments
      WHERE loan_id = ? AND payment_type = 'INTEREST'
    `).get(loanId) as { total: number };
    return result.total;
  }

  getFFTotalPrincipalPaid(loanId: string): number {
    const result = this.db.prepare(`
      SELECT COALESCE(SUM(amount_zar), 0) as total
      FROM ff_payments
      WHERE loan_id = ? AND payment_type = 'PRINCIPAL'
    `).get(loanId) as { total: number };
    return result.total;
  }

  getFFLastPaymentDate(loanId: string): string | null {
    const result = this.db.prepare(`
      SELECT payment_date
      FROM ff_payments
      WHERE loan_id = ?
      ORDER BY payment_date DESC
      LIMIT 1
    `).get(loanId) as { payment_date: string } | undefined;
    return result?.payment_date || null;
  }

  // Repayment Execution methods
  recordRepaymentExecution(execution: {
    executionDate: string;
    actionsPlanned: number;
    actionsExecuted: number;
    totalZARSpent: number;
    ffPaymentsCount: number;
    valrPaymentsCount: number;
    success: boolean;
    errors: string[];
    executionDetails: any;
  }): number {
    const result = this.db.prepare(`
      INSERT INTO repayment_executions (
        execution_date, actions_planned, actions_executed,
        total_zar_spent, ff_payments_count, valr_payments_count,
        success, errors, execution_details
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      execution.executionDate,
      execution.actionsPlanned,
      execution.actionsExecuted,
      execution.totalZARSpent,
      execution.ffPaymentsCount,
      execution.valrPaymentsCount,
      execution.success ? 1 : 0,
      JSON.stringify(execution.errors),
      JSON.stringify(execution.executionDetails)
    );
    return result.lastInsertRowid as number;
  }

  getRepaymentHistory(limit: number = 10): any[] {
    return this.db.prepare(`
      SELECT * FROM repayment_executions
      ORDER BY execution_date DESC
      LIMIT ?
    `).all(limit) as any[];
  }

  getRepaymentStats(): {
    totalExecutions: number;
    successCount: number;
    failureCount: number;
    totalZARSpent: number;
    successRate: number;
  } {
    const result = this.db.prepare(`
      SELECT
        COUNT(*) as total_executions,
        SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as success_count,
        SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failure_count,
        COALESCE(SUM(total_zar_spent), 0) as total_zar_spent
      FROM repayment_executions
    `).get() as any;

    return {
      totalExecutions: result.total_executions || 0,
      successCount: result.success_count || 0,
      failureCount: result.failure_count || 0,
      totalZARSpent: result.total_zar_spent || 0,
      successRate: result.total_executions > 0
        ? (result.success_count / result.total_executions) * 100
        : 0
    };
  }

  // VALR Loan Repayment methods
  recordVALRRepayment(repayment: {
    executionId: number;
    currency: string;
    amount: number;
    amountZAR: number;
    transferId?: string;
  }): number {
    const result = this.db.prepare(`
      INSERT INTO valr_loan_repayments (
        execution_id, currency, amount, amount_zar, transfer_id
      ) VALUES (?, ?, ?, ?, ?)
    `).run(
      repayment.executionId,
      repayment.currency,
      repayment.amount,
      repayment.amountZAR,
      repayment.transferId || null
    );
    return result.lastInsertRowid as number;
  }

  getVALRRepaymentsForExecution(executionId: number): any[] {
    return this.db.prepare(`
      SELECT * FROM valr_loan_repayments
      WHERE execution_id = ?
      ORDER BY created_at ASC
    `).all(executionId) as any[];
  }

  getVALRRepaymentsByCurrency(currency: string, limit?: number): any[] {
    const query = limit
      ? `SELECT * FROM valr_loan_repayments WHERE currency = ? ORDER BY created_at DESC LIMIT ?`
      : `SELECT * FROM valr_loan_repayments WHERE currency = ? ORDER BY created_at DESC`;

    const params = limit ? [currency, limit] : [currency];
    return this.db.prepare(query).all(...params) as any[];
  }

  getTotalVALRRepayments(currency?: string): number {
    if (currency) {
      const result = this.db.prepare(`
        SELECT COALESCE(SUM(amount), 0) as total
        FROM valr_loan_repayments
        WHERE currency = ?
      `).get(currency) as { total: number };
      return result.total;
    } else {
      const result = this.db.prepare(`
        SELECT COALESCE(SUM(amount_zar), 0) as total
        FROM valr_loan_repayments
      `).get() as { total: number };
      return result.total;
    }
  }

  close(): void {
    this.db.close();
  }
}
