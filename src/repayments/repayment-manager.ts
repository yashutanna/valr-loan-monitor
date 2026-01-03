import { ValrClient } from 'valr-typescript-client';
import { LoanMonitor } from '../loan-monitor';
import { FriendsFamilyLoanManager, FFLoanSummary } from './friends-family-loans';
import { TradingService } from './trading-service';
import { TransferService } from './transfer-service';
import { TransactionDatabase } from '../database';

export interface RepaymentConfig {
  repaymentSubaccount: string;
  loanPrincipalSubaccount: string;
  dryRun: boolean;
  minimumZARReserve: number;
}

export interface RepaymentAction {
  priority: number;
  type: 'FRIENDS_FAMILY' | 'VALR_LOAN';
  loanIdentifier: string;
  currency: string;
  amountNeeded: number;
  amountInZAR: number;
  apr?: number;
  recipientType?: 'valrAccountId' | 'email' | 'cellNumber';
  recipientValue?: string;
  recipientName?: string;
}

export interface RepaymentPlan {
  totalZARAvailable: number;
  totalZARNeeded: number;
  canExecute: boolean;
  payments: RepaymentAction[];
  skippedReason?: string;
}

export interface ExecutionResult {
  success: boolean;
  timestamp: string;
  dryRun: boolean;
  actionsPlanned: number;
  actionsExecuted: number;
  errors: string[];
  totalZARSpent: number;
  breakdown: {
    friendsFamilyPayments: number;
    valrLoanPayments: number;
  };
}

export class RepaymentManager {
  private loanMonitor: LoanMonitor;
  private ffLoanManager: FriendsFamilyLoanManager;
  private config: RepaymentConfig;
  private db: TransactionDatabase;
  private tradingService: TradingService;
  private transferService: TransferService;

  constructor(
    valrClient: ValrClient,
    loanMonitor: LoanMonitor,
    ffLoanManager: FriendsFamilyLoanManager,
    config: RepaymentConfig,
    db: TransactionDatabase
  ) {
    this.loanMonitor = loanMonitor;
    this.ffLoanManager = ffLoanManager;
    this.config = config;
    this.db = db;

    // Initialize services with valrClient
    this.tradingService = new TradingService(valrClient, { dryRun: config.dryRun });
    this.transferService = new TransferService(valrClient, { dryRun: config.dryRun });
  }

  /**
   * Main execution method - called every poll interval
   */
  async executeRepaymentCycle(): Promise<ExecutionResult> {
    const startTime = new Date();
    console.log(`\n${'='.repeat(80)}`);
    console.log(`Repayment Cycle Starting - ${startTime.toISOString()}`);
    console.log(`Mode: ${this.config.dryRun ? 'DRY RUN' : 'LIVE EXECUTION'}`);
    console.log('='.repeat(80));

    const result: ExecutionResult = {
      success: true,
      timestamp: startTime.toISOString(),
      dryRun: this.config.dryRun,
      actionsPlanned: 0,
      actionsExecuted: 0,
      errors: [],
      totalZARSpent: 0,
      breakdown: {
        friendsFamilyPayments: 0,
        valrLoanPayments: 0
      }
    };

    try {
      // Build repayment plan
      const plan = await this.buildRepaymentPlan();
      result.actionsPlanned = plan.payments.length;

      // Log plan
      this.logRepaymentPlan(plan);

      // If can't execute, skip
      if (!plan.canExecute) {
        console.log(`\nSkipping repayment cycle: ${plan.skippedReason}`);
        console.log('='.repeat(80));

        // Record the skip
        const executionId = this.db.recordRepaymentExecution({
          executionDate: result.timestamp,
          dryRun: this.config.dryRun,
          actionsPlanned: result.actionsPlanned,
          actionsExecuted: 0,
          totalZARSpent: 0,
          ffPaymentsCount: 0,
          valrPaymentsCount: 0,
          success: true,
          errors: [plan.skippedReason || 'Skipped'],
          executionDetails: plan
        });

        return result;
      }

      // Execute plan
      const executionResult = await this.executeRepaymentPlan(plan);

      // Update result
      result.actionsExecuted = executionResult.actionsExecuted;
      result.errors = executionResult.errors;
      result.totalZARSpent = executionResult.totalZARSpent;
      result.breakdown = executionResult.breakdown;
      result.success = executionResult.success;

      // Log summary
      this.logExecutionSummary(result);

    } catch (error) {
      console.error('Repayment cycle error:', (error as Error).message);
      result.success = false;
      result.errors.push((error as Error).message);
    }

    console.log('='.repeat(80));
    console.log('');

    return result;
  }

  /**
   * Build repayment plan with prioritized actions
   */
  private async buildRepaymentPlan(): Promise<RepaymentPlan> {
    const actions: RepaymentAction[] = [];

    // 1. Get available ZAR
    const availableZAR = await this.getAvailableZAR();
    const usableZAR = availableZAR - this.config.minimumZARReserve;

    console.log(`\nZAR Balance: R${availableZAR.toFixed(2)} (Reserve: R${this.config.minimumZARReserve.toFixed(2)}, Usable: R${usableZAR.toFixed(2)})`);

    if (usableZAR <= 0) {
      return {
        totalZARAvailable: availableZAR,
        totalZARNeeded: 0,
        canExecute: false,
        payments: [],
        skippedReason: `Insufficient ZAR after reserve (have R${availableZAR.toFixed(2)}, reserve R${this.config.minimumZARReserve.toFixed(2)})`
      };
    }

    // 2. Calculate F&F payments needed (PRIORITY 1)
    const ffPayments = this.ffLoanManager.getPaymentsDueThisMonth();

    for (const payment of ffPayments) {
      const loan = this.ffLoanManager.getLoan(payment.loanId);
      if (!loan) continue;

      actions.push({
        priority: 1,
        type: 'FRIENDS_FAMILY',
        loanIdentifier: loan.id,
        currency: payment.cryptoCurrency,
        amountNeeded: payment.amountZAR, // This is the ZAR amount
        amountInZAR: payment.amountZAR,
        recipientType: loan.recipient.type,
        recipientValue: loan.recipient.value,
        recipientName: loan.name
      });
    }

    console.log(`\nF&F Payments Due: ${ffPayments.length}`);

    // 3. Check if we have enough ZAR for F&F payments
    const ffTotalNeeded = actions.reduce((sum, a) => sum + a.amountInZAR, 0);
    if (usableZAR < ffTotalNeeded) {
      return {
        totalZARAvailable: availableZAR,
        totalZARNeeded: ffTotalNeeded,
        canExecute: false,
        payments: actions,
        skippedReason: `Insufficient ZAR for F&F payments. Need: R${ffTotalNeeded.toFixed(2)}, Have: R${usableZAR.toFixed(2)}`
      };
    }

    // 4. Calculate remaining ZAR after F&F payments
    const remainingZAR = usableZAR - ffTotalNeeded;

    console.log(`Remaining ZAR after F&F: R${remainingZAR.toFixed(2)}`);

    // 5. If there's remaining ZAR, use it ALL to buy the highest APR currency
    if (remainingZAR > 0) {
      const metrics = this.loanMonitor.getMetrics();
      const loans = metrics.loans;
      const aprs = metrics.effectiveAPRByLoan;

      // Find the loan with highest APR
      const sortedLoans = loans
        .map(loan => ({
          currency: loan.currency,
          apr: aprs[loan.currency] || 0
        }))
        .sort((a, b) => b.apr - a.apr);

      if (sortedLoans.length > 0) {
        const highestAPRLoan = sortedLoans[0];
        console.log(`Allocating remaining R${remainingZAR.toFixed(2)} to ${highestAPRLoan.currency} (APR: ${highestAPRLoan.apr.toFixed(2)}%)`);

        actions.push({
          priority: 2,
          type: 'VALR_LOAN',
          loanIdentifier: highestAPRLoan.currency,
          currency: highestAPRLoan.currency,
          amountNeeded: 0, // We'll buy whatever we can with the ZAR
          amountInZAR: remainingZAR,
          apr: highestAPRLoan.apr
        });
      }
    }

    const totalNeeded = ffTotalNeeded + (remainingZAR > 0 ? remainingZAR : 0);

    return {
      totalZARAvailable: availableZAR,
      totalZARNeeded: totalNeeded,
      canExecute: true,
      payments: actions.sort((a, b) => a.priority - b.priority)
    };
  }

  /**
   * Execute the repayment plan
   */
  private async executeRepaymentPlan(plan: RepaymentPlan): Promise<ExecutionResult> {
    const result: ExecutionResult = {
      success: true,
      timestamp: new Date().toISOString(),
      dryRun: this.config.dryRun,
      actionsPlanned: plan.payments.length,
      actionsExecuted: 0,
      errors: [],
      totalZARSpent: 0,
      breakdown: {
        friendsFamilyPayments: 0,
        valrLoanPayments: 0
      }
    };

    // Record execution start
    const executionId = this.db.recordRepaymentExecution({
      executionDate: result.timestamp,
      dryRun: this.config.dryRun,
      actionsPlanned: plan.payments.length,
      actionsExecuted: 0,
      totalZARSpent: 0,
      ffPaymentsCount: 0,
      valrPaymentsCount: 0,
      success: false, // Will update at end
      errors: [],
      executionDetails: plan
    });

    console.log(`\n${'─'.repeat(80)}`);
    console.log('Executing Payments');
    console.log('─'.repeat(80));

    for (const action of plan.payments) {
      try {
        console.log(`\n[Priority ${action.priority}] ${action.type} - ${action.loanIdentifier}`);
        console.log(`  Amount: R${action.amountInZAR.toFixed(2)}`);

        if (action.type === 'FRIENDS_FAMILY') {
          await this.payFriendsFamily(action, executionId);
          result.breakdown.friendsFamilyPayments++;
        } else {
          await this.payVALRLoan(action, executionId);
          result.breakdown.valrLoanPayments++;
        }

        result.actionsExecuted++;
        result.totalZARSpent += action.amountInZAR;

        console.log(`  ✓ Completed`);

      } catch (error) {
        result.success = false;
        const errorMsg = `${action.loanIdentifier}: ${(error as Error).message}`;
        result.errors.push(errorMsg);
        console.error(`  ✗ Failed: ${(error as Error).message}`);
        // Continue with next payment (don't abort entire cycle)
      }
    }

    // Update execution record
    this.db.recordRepaymentExecution({
      executionDate: result.timestamp,
      dryRun: this.config.dryRun,
      actionsPlanned: result.actionsPlanned,
      actionsExecuted: result.actionsExecuted,
      totalZARSpent: result.totalZARSpent,
      ffPaymentsCount: result.breakdown.friendsFamilyPayments,
      valrPaymentsCount: result.breakdown.valrLoanPayments,
      success: result.success,
      errors: result.errors,
      executionDetails: { plan, result }
    });

    return result;
  }

  /**
   * Pay Friends & Family loan
   */
  private async payFriendsFamily(action: RepaymentAction, executionId: number): Promise<void> {
    const loan = this.ffLoanManager.getLoan(action.loanIdentifier);
    if (!loan) throw new Error(`Loan not found: ${action.loanIdentifier}`);

    // 1. Buy crypto with ZAR
    console.log(`  Buying ${action.currency}...`);
    const tradeResult = await this.tradingService.buyWithZAR(action.currency, action.amountInZAR);

    if (!tradeResult.success) {
      throw new Error(`Trade failed: ${tradeResult.error}`);
    }

    console.log(`  Bought: ${tradeResult.cryptoReceived.toFixed(8)} ${action.currency}`);

    // 2. Transfer to F&F VALR account
    console.log(`  Transferring to ${action.recipientName}...`);
    const transferResult = await this.transferService.transferToFriendsFamily(
      action.currency,
      tradeResult.cryptoReceived,
      this.config.repaymentSubaccount,
      action.recipientType!,
      action.recipientValue!,
      action.recipientName!
    );

    if (!transferResult.success) {
      throw new Error(`Transfer failed: ${transferResult.error}`);
    }

    console.log(`  Transfer ID: ${transferResult.transferId}`);

    // 3. Record payment
    this.ffLoanManager.recordPayment({
      loanId: loan.id,
      paymentDate: new Date().toISOString(),
      amountZAR: tradeResult.zarSpent,
      cryptoCurrency: action.currency,
      cryptoAmount: tradeResult.cryptoReceived,
      transferId: transferResult.transferId,
      type: 'INTEREST'
    }, this.config.dryRun);
  }

  /**
   * Pay VALR loan
   */
  private async payVALRLoan(action: RepaymentAction, executionId: number): Promise<void> {
    // 1. Buy loan currency with ZAR
    console.log(`  Buying ${action.currency}...`);
    const tradeResult = await this.tradingService.buyWithZAR(action.currency, action.amountInZAR);

    if (!tradeResult.success) {
      throw new Error(`Trade failed: ${tradeResult.error}`);
    }

    console.log(`  Bought: ${tradeResult.cryptoReceived.toFixed(8)} ${action.currency}`);

    // 2. Transfer to loan principal subaccount
    console.log(`  Transferring to loan account...`);
    const transferResult = await this.transferService.transferToLoanAccount(
      action.currency,
      tradeResult.cryptoReceived,
      this.config.repaymentSubaccount,
      this.config.loanPrincipalSubaccount
    );

    if (!transferResult.success) {
      throw new Error(`Transfer failed: ${transferResult.error}`);
    }

    console.log(`  Transfer ID: ${transferResult.transferId}`);

    // 3. Record repayment
    this.db.recordVALRRepayment({
      executionId,
      currency: action.currency,
      amount: tradeResult.cryptoReceived,
      amountZAR: tradeResult.zarSpent,
      transferId: transferResult.transferId,
      dryRun: this.config.dryRun
    });
  }

  /**
   * Get available ZAR from repayment subaccount
   */
  private async getAvailableZAR(): Promise<number> {
    try {
      return await this.transferService.getBalance('ZAR');
    } catch (error) {
      console.error('Error getting ZAR balance:', (error as Error).message);
      return 0;
    }
  }

  /**
   * Log repayment plan
   */
  private logRepaymentPlan(plan: RepaymentPlan): void {
    console.log(`\n${'─'.repeat(80)}`);
    console.log('Repayment Plan');
    console.log('─'.repeat(80));
    console.log(`Total ZAR Available: R${plan.totalZARAvailable.toFixed(2)}`);
    console.log(`Total ZAR Needed: R${plan.totalZARNeeded.toFixed(2)}`);
    console.log(`Can Execute: ${plan.canExecute ? 'YES' : 'NO'}`);

    if (plan.payments.length > 0) {
      console.log(`\nPayments (${plan.payments.length}):`);
      for (const action of plan.payments) {
        const typeLabel = action.type === 'FRIENDS_FAMILY' ? 'F&F' : 'VALR';
        const details = action.type === 'FRIENDS_FAMILY'
          ? `${action.recipientName} (${action.currency})`
          : `${action.currency} (APR: ${action.apr?.toFixed(2)}%)`;

        console.log(`  ${action.priority}. [${typeLabel}] ${details} - R${action.amountInZAR.toFixed(2)}`);
      }
    } else {
      console.log('\nNo payments needed');
    }
  }

  /**
   * Log execution summary
   */
  private logExecutionSummary(result: ExecutionResult): void {
    console.log(`\n${'─'.repeat(80)}`);
    console.log('Execution Summary');
    console.log('─'.repeat(80));
    console.log(`Status: ${result.success ? '✓ SUCCESS' : '✗ FAILED'}`);
    console.log(`Actions Executed: ${result.actionsExecuted}/${result.actionsPlanned}`);
    console.log(`Total ZAR Spent: R${result.totalZARSpent.toFixed(2)}`);
    console.log(`F&F Payments: ${result.breakdown.friendsFamilyPayments}`);
    console.log(`VALR Payments: ${result.breakdown.valrLoanPayments}`);

    if (result.errors.length > 0) {
      console.log(`\nErrors (${result.errors.length}):`);
      result.errors.forEach(err => console.log(`  - ${err}`));
    }
  }

  /**
   * Get F&F loan summaries
   */
  getFFLoanSummaries(): FFLoanSummary[] {
    return this.ffLoanManager.getLoanSummaries();
  }
}
