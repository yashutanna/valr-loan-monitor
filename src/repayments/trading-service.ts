import { ValrClient } from 'valr-typescript-client';

export interface TradingConfig {
  dryRun: boolean;
}

export interface TradeResult {
  success: boolean;
  cryptoReceived: number;
  zarSpent: number;
  price: number;
  orderId?: string;
  error?: string;
}

export class TradingService {
  private valrClient: ValrClient;
  private config: TradingConfig;

  constructor(valrClient: ValrClient, config: TradingConfig) {
    this.valrClient = valrClient;
    this.config = config;
  }

  /**
   * Buy crypto using ZAR with market order
   * @param currency - Crypto to buy (USDC, XRP, BTC, etc.)
   * @param zarAmount - Amount of ZAR to spend
   * @returns Amount of crypto purchased
   */
  async buyWithZAR(currency: string, zarAmount: number): Promise<TradeResult> {
    try {
      const pair = `${currency}ZAR`;

      // Get current market price
      const price = await this.getPrice(pair);
      const estimatedCrypto = zarAmount / price;

      if (this.config.dryRun) {
        console.log(`[DRY RUN] Would buy ${estimatedCrypto.toFixed(8)} ${currency} with R${zarAmount.toFixed(2)} at price R${price.toFixed(2)}`);
        return {
          success: true,
          cryptoReceived: estimatedCrypto,
          zarSpent: zarAmount,
          price,
          orderId: 'dry-run-order-id'
        };
      }

      // Real execution - place market order
      console.log(`Placing market order: Buy ${currency} with R${zarAmount.toFixed(2)}`);

      const orderRequest: any = {
        pair,
        side: 'BUY',
        quoteAmount: zarAmount.toString(),
        customerOrderId: `repay-${Date.now()}-${Math.random().toString(36).substring(7)}`
      };

      const orderResponse = await this.valrClient.trading.placeMarketOrder(orderRequest);

      // Wait a bit for order to settle
      await this.sleep(2000);
      // Get order status to find actual crypto received
      const orderId = (orderResponse as any).id;
      const orderStatus = await this.valrClient.trading.getOrderStatus(pair, orderId);

      const baseReceived = parseFloat((orderStatus as any).baseReceived || '0');
      const quoteSpent = parseFloat((orderStatus as any).quoteSpent || '0');

      console.log(`Market order completed: Received ${baseReceived.toFixed(8)} ${currency}, Spent R${quoteSpent.toFixed(2)}`);

      return {
        success: true,
        cryptoReceived: baseReceived,
        zarSpent: quoteSpent,
        price: quoteSpent / baseReceived,
        orderId
      };

    } catch (error) {
      console.error(`Error buying ${currency} with ZAR:`, (error as Error).message);
      return {
        success: false,
        cryptoReceived: 0,
        zarSpent: 0,
        price: 0,
        error: (error as Error).message
      };
    }
  }

  /**
   * Get current market price for crypto in ZAR
   */
  async getPrice(pair: string): Promise<number> {
    try {
      const summary = await this.valrClient.public.getMarketSummaryForPair(pair);
      return parseFloat(summary.lastTradedPrice);
    } catch (error) {
      throw new Error(`Failed to get price for ${pair}: ${(error as Error).message}`);
    }
  }

  /**
   * Validate that market exists and has liquidity
   */
  async validateMarket(pair: string): Promise<boolean> {
    try {
      const summary = await this.valrClient.public.getMarketSummaryForPair(pair);
      const price = parseFloat(summary.lastTradedPrice);
      return price > 0;
    } catch (error) {
      console.error(`Market validation failed for ${pair}:`, (error as Error).message);
      return false;
    }
  }

  /**
   * Estimate costs for an order
   */
  async estimateCosts(pair: string, zarAmount: number): Promise<{
    estimatedCrypto: number;
    estimatedFee: number;
    currentPrice: number;
  }> {
    const price = await this.getPrice(pair);
    const estimatedCrypto = zarAmount / price;

    // VALR maker/taker fees are typically 0.1% - 0.25%
    // For market orders (taker), assume 0.15%
    const estimatedFee = zarAmount * 0.0015;

    return {
      estimatedCrypto,
      estimatedFee,
      currentPrice: price
    };
  }

  /**
   * Helper to sleep/wait
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Set dry run mode
   */
  setDryRun(dryRun: boolean): void {
    this.config.dryRun = dryRun;
  }
}
