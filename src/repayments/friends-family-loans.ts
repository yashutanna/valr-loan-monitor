import fs from 'fs';
import { TransactionDatabase } from '../database';

export interface FFRecipient {
  type: 'valrAccountId' | 'email' | 'cellNumber';
  value: string;
}

export interface FriendsAndFamilyLoan {
  id: string;
  name: string;
  principal: number;
  currency: string; // Always ZAR
  recipient: FFRecipient;
  interestRate: number; // Annual rate (0.07 = 7%)
  startDate: string; // ISO timestamp
  cryptoPreference: string; // USDC, BTC, etc.
  active: boolean;
  notes?: string;
}

export interface FFLoanConfig {
  version: string;
  loans: FriendsAndFamilyLoan[];
}

export interface FFLoanPayment {
  loanId: string;
  paymentDate: string;
  amountZAR: number;
  cryptoCurrency: string;
  cryptoAmount: number;
  transferId?: string;
  type: 'INTEREST' | 'PRINCIPAL';
}

export interface FFLoanSummary {
  loan: FriendsAndFamilyLoan;
  totalInterestPaid: number;
  totalPrincipalPaid: number;
  monthlyInterestDue: number;
  lastPaymentDate: string | null;
  daysSinceLastPayment: number;
  paymentsThisMonth: number;
}

export class FriendsFamilyLoanManager {
  private configPath: string;
  private loans: FriendsAndFamilyLoan[] = [];
  private db: TransactionDatabase;

  constructor(configPath: string, db: TransactionDatabase) {
    this.configPath = configPath;
    this.db = db;
    this.loadLoans();
  }

  /**
   * Load F&F loans from JSON config file
   */
  loadLoans(): void {
    try {
      if (!fs.existsSync(this.configPath)) {
        console.log(`F&F loans config not found at ${this.configPath}, using empty list`);
        this.loans = [];
        return;
      }

      const fileContent = fs.readFileSync(this.configPath, 'utf-8');
      const config: FFLoanConfig = JSON.parse(fileContent);

      // Validate schema
      if (!config.version || !Array.isArray(config.loans)) {
        throw new Error('Invalid F&F loans config schema');
      }

      // Validate each loan
      for (const loan of config.loans) {
        this.validateLoan(loan);
      }

      // Only load active loans
      this.loans = config.loans.filter(l => l.active);

      console.log(`Loaded ${this.loans.length} active F&F loan(s) from ${this.configPath}`);
    } catch (error) {
      console.error('Error loading F&F loans config:', (error as Error).message);
      this.loans = [];
    }
  }

  /**
   * Validate loan object structure
   */
  private validateLoan(loan: any): void {
    const required = ['id', 'name', 'principal', 'recipient', 'interestRate', 'startDate', 'cryptoPreference'];
    for (const field of required) {
      if (!loan[field] && loan[field] !== 0) {
        throw new Error(`Missing required field: ${field} in loan ${loan.id || 'unknown'}`);
      }
    }

    if (loan.principal <= 0) {
      throw new Error(`Invalid principal amount for loan ${loan.id}`);
    }

    if (loan.interestRate < 0 || loan.interestRate > 1) {
      throw new Error(`Invalid interest rate for loan ${loan.id} (must be between 0 and 1)`);
    }

    // Validate recipient
    if (!loan.recipient || typeof loan.recipient !== 'object') {
      throw new Error(`Invalid recipient for loan ${loan.id} (must be an object)`);
    }

    if (!loan.recipient.type || !loan.recipient.value) {
      throw new Error(`Recipient must have 'type' and 'value' fields for loan ${loan.id}`);
    }

    const validTypes = ['valrAccountId', 'email', 'cellNumber'];
    if (!validTypes.includes(loan.recipient.type)) {
      throw new Error(`Invalid recipient type '${loan.recipient.type}' for loan ${loan.id}. Must be one of: ${validTypes.join(', ')}`);
    }

    // Validate date
    const startDate = new Date(loan.startDate);
    if (isNaN(startDate.getTime())) {
      throw new Error(`Invalid start date for loan ${loan.id}`);
    }
  }

  /**
   * Reload loans from config file
   */
  reloadConfig(): void {
    this.loadLoans();
  }

  /**
   * Get all active loans
   */
  getLoans(): FriendsAndFamilyLoan[] {
    return [...this.loans];
  }

  /**
   * Get loan by ID
   */
  getLoan(loanId: string): FriendsAndFamilyLoan | undefined {
    return this.loans.find(l => l.id === loanId);
  }

  /**
   * Calculate monthly interest for a loan
   * Simple interest: (principal * annual rate) / 12
   */
  calculateMonthlyInterest(loan: FriendsAndFamilyLoan): number {
    return (loan.principal * loan.interestRate) / 12;
  }

  /**
   * Get payments due this month for all loans
   * Payment is due if:
   * - No payment made this calendar month, OR
   * - >= 30 days since last payment
   */
  getPaymentsDueThisMonth(): FFLoanPayment[] {
    const payments: FFLoanPayment[] = [];
    const now = new Date();

    for (const loan of this.loans) {
      const lastPaymentDate = this.db.getFFLastPaymentDate(loan.id);
      const paymentsThisMonth = this.db.getFFPaymentsThisMonth(loan.id);

      let isDue = false;

      if (!lastPaymentDate) {
        // No payment ever made - check if loan has started
        const startDate = new Date(loan.startDate);
        const daysSinceStart = (now.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24);
        isDue = daysSinceStart >= 30; // First payment due after 30 days
      } else if (paymentsThisMonth.length === 0) {
        // No payment this calendar month
        isDue = true;
      } else {
        // Check if >= 30 days since last payment
        const lastPayment = new Date(lastPaymentDate);
        const daysSince = (now.getTime() - lastPayment.getTime()) / (1000 * 60 * 60 * 24);
        isDue = daysSince >= 30;
      }

      if (isDue) {
        payments.push({
          loanId: loan.id,
          paymentDate: now.toISOString(),
          amountZAR: this.calculateMonthlyInterest(loan),
          cryptoCurrency: loan.cryptoPreference,
          cryptoAmount: 0, // Will be filled in by trading service
          type: 'INTEREST'
        });
      }
    }

    return payments;
  }

  /**
   * Record a payment in the database
   */
  recordPayment(payment: FFLoanPayment): void {
    this.db.recordFFPayment({
      loanId: payment.loanId,
      paymentDate: payment.paymentDate,
      amountZAR: payment.amountZAR,
      cryptoCurrency: payment.cryptoCurrency,
      cryptoAmount: payment.cryptoAmount,
      transferId: payment.transferId,
      paymentType: payment.type
    });
  }

  /**
   * Get payment history for a loan
   */
  getPaymentHistory(loanId: string, limit?: number): any[] {
    return this.db.getFFPaymentHistory(loanId, limit);
  }

  /**
   * Get comprehensive summary for all loans
   */
  getLoanSummaries(): FFLoanSummary[] {
    return this.loans.map(loan => {
      const totalInterestPaid = this.db.getFFTotalInterestPaid(loan.id);
      const totalPrincipalPaid = this.db.getFFTotalPrincipalPaid(loan.id);
      const lastPaymentDate = this.db.getFFLastPaymentDate(loan.id);
      const paymentsThisMonth = this.db.getFFPaymentsThisMonth(loan.id);

      let daysSinceLastPayment = 0;
      if (lastPaymentDate) {
        const lastPayment = new Date(lastPaymentDate);
        const now = new Date();
        daysSinceLastPayment = Math.floor((now.getTime() - lastPayment.getTime()) / (1000 * 60 * 60 * 24));
      } else {
        const startDate = new Date(loan.startDate);
        const now = new Date();
        daysSinceLastPayment = Math.floor((now.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
      }

      return {
        loan,
        totalInterestPaid,
        totalPrincipalPaid,
        monthlyInterestDue: this.calculateMonthlyInterest(loan),
        lastPaymentDate,
        daysSinceLastPayment,
        paymentsThisMonth: paymentsThisMonth.length
      };
    });
  }

  /**
   * Get total monthly obligation across all loans
   */
  getTotalMonthlyObligation(): number {
    return this.loans.reduce((sum, loan) => {
      return sum + this.calculateMonthlyInterest(loan);
    }, 0);
  }

  /**
   * Get count of active loans
   */
  getLoanCount(): number {
    return this.loans.length;
  }

  /**
   * Get total principal across all loans
   */
  getTotalPrincipal(): number {
    return this.loans.reduce((sum, loan) => sum + loan.principal, 0);
  }
}
