import { ValrClient } from 'valr-typescript-client';

export interface TransferConfig {
  dryRun: boolean;
}

export interface TransferResult {
  success: boolean;
  transferId?: string;
  error?: string;
}

export class TransferService {
  private valrClient: ValrClient;
  private config: TransferConfig;

  constructor(valrClient: ValrClient, config: TransferConfig) {
    this.valrClient = valrClient;
    this.config = config;
  }

  /**
   * Transfer from repayment subaccount to loan principal subaccount
   */
  async transferToLoanAccount(
    currency: string,
    amount: number,
    fromSubaccount: string,
    toSubaccount: string
  ): Promise<TransferResult> {
    try {
      if (this.config.dryRun) {
        console.log(`[DRY RUN] Would transfer ${amount.toFixed(8)} ${currency} from ${fromSubaccount} to ${toSubaccount}`);
        return {
          success: true,
          transferId: 'dry-run-transfer-id'
        };
      }

      console.log(`Transferring ${amount.toFixed(8)} ${currency} to loan account`);

      // Set context to the from subaccount

      const transferRequest: any = {
        currency,
        amount: amount.toString(),
        fromId: fromSubaccount,
        toId: toSubaccount
      };

      const response = await this.valrClient.account.transferBetweenAccounts(transferRequest);
      const transferId = (response as any).id || (response as any).transferId || 'unknown';

      console.log(`Transfer completed: ${transferId}`);

      return {
        success: true,
        transferId
      };

    } catch (error) {
      console.error(`Error transferring ${currency} to loan account:`, (error as Error).message);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Transfer to Friends & Family VALR account
   */
  async transferToFriendsFamily(
    currency: string,
    amount: number,
    fromSubaccount: string,
    recipientType: 'valrAccountId' | 'email' | 'cellNumber',
    recipientValue: string,
    recipientName: string
  ): Promise<TransferResult> {
    try {
      if (this.config.dryRun) {
        console.log(`[DRY RUN] Would transfer ${amount.toFixed(8)} ${currency} from ${fromSubaccount} to ${recipientName} (${recipientType}: ${recipientValue})`);
        return {
          success: true,
          transferId: `dry-run-ff-transfer-${recipientName}`
        };
      }

      console.log(`Transferring ${amount.toFixed(8)} ${currency} to F&F: ${recipientName} (${recipientType}: ${recipientValue})`);

      // Set context to the from subaccount

      // Build transfer request based on recipient type
      const transferRequest: any = {
        currency,
        amount: amount.toString(),
        fromId: fromSubaccount
      };

      // Add recipient field based on type
      switch (recipientType) {
        case 'valrAccountId':
          transferRequest.toId = recipientValue;
          break;
        case 'email':
          transferRequest.toEmail = recipientValue;
          break;
        case 'cellNumber':
          transferRequest.toMobileNumber = recipientValue;
          break;
      }

      const response = await this.valrClient.account.transferBetweenAccounts(transferRequest);
      const transferId = (response as any).id || (response as any).transferId || 'unknown';

      console.log(`F&F transfer completed: ${transferId}`);

      return {
        success: true,
        transferId
      };

    } catch (error) {
      console.error(`Error transferring ${currency} to F&F ${recipientName}:`, (error as Error).message);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Get balance for specific currency in subaccount
   */
  async getBalance(currency: string): Promise<number> {
    try {

      const balances = await this.valrClient.account.getBalances({ excludeZeroBalances: false });
      const balance = balances.find(b => b.currency === currency);

      if (!balance) {
        return 0;
      }

      return parseFloat(balance.total);

    } catch (error) {
      console.error(`Error getting ${currency} balance`, (error as Error).message);
      throw error;
    }
  }

  /**
   * Get all balances for a subaccount
   */
  async getAllBalances(): Promise<{ currency: string; amount: number }[]> {
    try {
      const balances = await this.valrClient.account.getBalances({ excludeZeroBalances: true });

      return balances.map(b => ({
        currency: b.currency,
        amount: parseFloat(b.total)
      }));

    } catch (error) {
      console.error(`Error getting balances account`, (error as Error).message);
      throw error;
    }
  }

  /**
   * Set dry run mode
   */
  setDryRun(dryRun: boolean): void {
    this.config.dryRun = dryRun;
  }
}
