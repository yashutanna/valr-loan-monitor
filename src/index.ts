import express from 'express';
import dotenv from 'dotenv';
import { LoanMonitor, LoanConfig } from './loan-monitor';
import { MetricsExporter } from './metrics';
import { ValrClient } from 'valr-typescript-client';
import fs from 'fs';
import path from 'path';

dotenv.config();

const PORT = parseInt(process.env.PORT || '3000', 10);
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || '3600000', 10);

// Parse comma-separated transfer IDs to ignore for payment calculations
const paymentIgnoreTransferIds = process.env.PAYMENT_IGNORE_TRANSFER_IDS
  ? process.env.PAYMENT_IGNORE_TRANSFER_IDS.split(',').map(id => id.trim()).filter(id => id.length > 0)
  : undefined;

const config: LoanConfig = {
  principalSubaccount: process.env.LOAN_PRINCIPAL_SUBACCOUNT || '',
  paymentIgnoreTransferIds,
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

function getDirectorySize(dirPath: string): number {
  let totalSize = 0;

  try {
    if (!fs.existsSync(dirPath)) {
      return 0;
    }

    const items = fs.readdirSync(dirPath);

    for (const item of items) {
      const itemPath = path.join(dirPath, item);
      const stats = fs.statSync(itemPath);

      if (stats.isDirectory()) {
        totalSize += getDirectorySize(itemPath);
      } else {
        totalSize += stats.size;
      }
    }
  } catch (error) {
    console.error(`Error calculating size for ${dirPath}:`, (error as Error).message);
  }

  return totalSize;
}

function calculateDiskUsage(): { totalBytes: number; breakdown: Record<string, number> } {
  const breakdown: Record<string, number> = {};

  // SQLite database
  const dbPath = path.join('/app', 'data', 'loans.db');
  breakdown.database = fs.existsSync(dbPath) ? fs.statSync(dbPath).size : 0;

  // Prometheus data volume
  const prometheusPath = '/volumes/prometheus';
  breakdown.prometheus = getDirectorySize(prometheusPath);

  // Grafana data volume
  const grafanaPath = '/volumes/grafana';
  breakdown.grafana = getDirectorySize(grafanaPath);

  const totalBytes = Object.values(breakdown).reduce((sum, size) => sum + size, 0);

  return { totalBytes, breakdown };
}

async function updateData(monitor: LoanMonitor, metrics: MetricsExporter): Promise<void> {
  try {
    console.log(`[${new Date().toISOString()}] Updating metrics...`);

    await monitor.updateMetrics();

    // Calculate disk usage
    const diskUsage = calculateDiskUsage();
    metrics.updateDiskUsage(diskUsage.totalBytes, diskUsage.breakdown);

    metrics.updateMetrics();
    metrics.incrementUpdateCounter();

    const currentMetrics = monitor.getMetrics();
    console.log(`[${new Date().toISOString()}] Update complete. Disk usage: ${(diskUsage.totalBytes / 1024 / 1024).toFixed(2)} MB`);
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
  if (config.paymentIgnoreTransferIds && config.paymentIgnoreTransferIds.length > 0) {
    console.log(`  - Payment tracking: Ignoring ${config.paymentIgnoreTransferIds.length} transfer ID(s)`);
  }
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
      monthlyAccumulatedInterest: currentMetrics.monthlyAccumulatedInterest,
      monthlyAccumulatedInterestInZAR: currentMetrics.monthlyAccumulatedInterestInZAR,
      currentMonthStart: currentMetrics.currentMonthStart,
      totalPaymentsByCurrency: currentMetrics.totalPaymentsByCurrency,
      totalPaymentsInZAR: currentMetrics.totalPaymentsInZAR,
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
