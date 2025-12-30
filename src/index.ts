import express from 'express';
import dotenv from 'dotenv';
import { LoanMonitor, LoanConfig } from './loan-monitor';
import { MetricsExporter } from './metrics';
import { ValrClient } from 'valr-typescript-client'

dotenv.config();

const PORT = parseInt(process.env.PORT || '3000', 10);
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || '3600000', 10);

const config: LoanConfig = {
  principalSubaccount: process.env.LOAN_PRINCIPAL_SUBACCOUNT || '',
};

function validateConfig(config: LoanConfig): void {
  const errors: string[] = [];

  if (!process.env.VALR_API_KEY) errors.push('VALR_API_KEY is required');
  if (!process.env.VALR_API_SECRET) errors.push('VALR_API_SECRET is required');
  if (!config.principalSubaccount) errors.push('LOAN_PRINCIPAL_SUBACCOUNT is required');

  if (errors.length > 0) {
    console.error('Configuration errors:');
    errors.forEach(err => console.error(`  - ${err}`));
    process.exit(1);
  }
}

async function updateData(monitor: LoanMonitor, metrics: MetricsExporter): Promise<void> {
  try {
    console.log(`[${new Date().toISOString()}] Updating metrics...`);

    await monitor.updateMetrics();
    metrics.updateMetrics();
    metrics.incrementUpdateCounter();

    const currentMetrics = monitor.getMetrics();
    console.log(`[${new Date().toISOString()}] Update complete`);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Update error:`, error);
    metrics.incrementUpdateErrorCounter();
  }
}

async function main() {
  validateConfig(config);

  console.log('='.repeat(60));
  console.log('VALR Loan Monitor');
  console.log('='.repeat(60));
  console.log('Configuration:');
  console.log(`  - Principal subaccount: ${config.principalSubaccount}`);
  console.log(`  - Poll interval: ${POLL_INTERVAL_MS / 1000}s`);
  console.log(`  - Loans (negative balances) and collateral (positive balances) auto-detected`);
  console.log('='.repeat(60));

  const valrClient = new ValrClient({
      apiKey: process.env.VALR_API_KEY!,
      apiSecret: process.env.VALR_API_SECRET!
  })

  const monitor = new LoanMonitor(valrClient, config);
  const metrics = new MetricsExporter(monitor);

  const app = express();

  app.get('/metrics', async (req, res) => {
    try {
      res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
      const metricsOutput = await metrics.getMetrics();
      res.send(metricsOutput);
    } catch (error) {
      console.error('Error generating metrics:', error);
      res.status(500).send('Error generating metrics');
    }
  });

  app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.get('/status', (req, res) => {
    const currentMetrics = monitor.getMetrics();
    res.json({
      loans: currentMetrics.loans,
      collateral: currentMetrics.collateral,
      totalLoanValueInZAR: currentMetrics.totalLoanValueInZAR,
      totalCollateralValueInZAR: currentMetrics.totalCollateralValueInZAR,
      interestByLoanCurrency: currentMetrics.interestByLoanCurrency,
      interestInZAR: currentMetrics.interestInZAR,
      effectiveAPRByLoan: currentMetrics.effectiveAPRByLoan,
      interestPaymentCountByLoan: currentMetrics.interestPaymentCountByLoan,
      marginRatio: currentMetrics.currentMarginRatio,
      hoursSinceFirstPayment: currentMetrics.hoursSinceFirstPayment,
      accountStanding: currentMetrics.accountStanding,
      prices: currentMetrics.prices,
      pricesInZAR: currentMetrics.pricesInZAR,
    });
  });

  app.post('/refresh', async (req, res) => {
    try {
      console.log(`[${new Date().toISOString()}] Manual refresh triggered`);
      await updateData(monitor, metrics);
      res.json({ status: 'success', timestamp: new Date().toISOString() });
    } catch (error) {
      console.error('Manual refresh error:', error);
      res.status(500).json({ status: 'error', message: (error as Error).message });
    }
  });

  app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
    console.log(`  - Metrics: http://localhost:${PORT}/metrics`);
    console.log(`  - Health: http://localhost:${PORT}/health`);
    console.log(`  - Status: http://localhost:${PORT}/status`);
    console.log(`  - Refresh: POST http://localhost:${PORT}/refresh`);
  });

  await updateData(monitor, metrics);

  setInterval(() => {
    updateData(monitor, metrics);
  }, POLL_INTERVAL_MS);

  process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully...');
    monitor.close();
    process.exit(0);
  });

  process.on('SIGINT', () => {
    console.log('SIGINT received, shutting down gracefully...');
    monitor.close();
    process.exit(0);
  });
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
