import express from 'express';
import dotenv from 'dotenv';
import { LoanMonitor, LoanConfig } from './loan-monitor';
import { MetricsExporter } from './metrics';
import { ValrClient } from 'valr-typescript-client';
import { RepaymentManager, RepaymentConfig } from './repayments/repayment-manager';
import { FriendsFamilyLoanManager } from './repayments/friends-family-loans';
import { TransactionDatabase } from './database';
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

// Repayment configuration (optional)
const repaymentEnabled = process.env.REPAYMENT_ENABLED === 'true';
const repaymentConfig: RepaymentConfig | undefined = repaymentEnabled ? {
  repaymentSubaccount: process.env.REPAYMENT_SUBACCOUNT || '',
  loanPrincipalSubaccount: process.env.LOAN_PRINCIPAL_SUBACCOUNT || '',
  dryRun: process.env.DRY_RUN === 'true',
  minimumZARReserve: parseFloat(process.env.MINIMUM_ZAR_RESERVE || '100'),
} : undefined;

const ffLoansConfigPath = process.env.FRIENDS_FAMILY_LOANS_PATH || './config/friends-family-loans.json';

function validateConfig(config: LoanConfig): void {
  const errors: string[] = [];

  if (!process.env.VALR_API_KEY) errors.push('VALR_API_KEY is required');
  if (!process.env.VALR_API_SECRET) errors.push('VALR_API_SECRET is required');
  if (!config.principalSubaccount) errors.push('LOAN_PRINCIPAL_SUBACCOUNT is required');

  // Validate repayment config if enabled
  if (repaymentEnabled && repaymentConfig) {
    if (!repaymentConfig.repaymentSubaccount) errors.push('REPAYMENT_SUBACCOUNT is required when REPAYMENT_ENABLED=true');
  }

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

function calculateDiskUsage(dbPath: string): { totalBytes: number; breakdown: Record<string, number> } {
  const breakdown: Record<string, number> = {};

  // SQLite database
  breakdown.database = fs.existsSync(dbPath) ? fs.statSync(dbPath).size : 0;

  // Prometheus data volume (only in Docker)
  const prometheusPath = process.env.PROMETHEUS_DATA_PATH || '/volumes/prometheus';
  breakdown.prometheus = getDirectorySize(prometheusPath);

  // Grafana data volume (only in Docker)
  const grafanaPath = process.env.GRAFANA_DATA_PATH || '/volumes/grafana';
  breakdown.grafana = getDirectorySize(grafanaPath);

  const totalBytes = Object.values(breakdown).reduce((sum, size) => sum + size, 0);

  return { totalBytes, breakdown };
}

async function updateData(monitor: LoanMonitor, metrics: MetricsExporter, dbPath: string, repaymentManager?: RepaymentManager): Promise<void> {
  try {
    console.log(`[${new Date().toISOString()}] Updating metrics...`);

    await monitor.updateMetrics();

    // Calculate disk usage
    const diskUsage = calculateDiskUsage(dbPath);
    metrics.updateDiskUsage(diskUsage.totalBytes, diskUsage.breakdown);

    metrics.updateMetrics();
    metrics.incrementUpdateCounter();

    // Execute repayment cycle if enabled
    if (repaymentManager) {
      const result = await repaymentManager.executeRepaymentCycle();
      const ffSummaries = repaymentManager.getFFLoanSummaries();
      metrics.updateRepaymentMetrics(result, ffSummaries, repaymentConfig?.dryRun || false);
    }

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
  if (repaymentEnabled && repaymentConfig) {
    console.log(`  - Repayment system: ENABLED`);
    console.log(`    - Mode: ${repaymentConfig.dryRun ? 'DRY RUN' : 'LIVE'}`);
    console.log(`    - Repayment subaccount: ${repaymentConfig.repaymentSubaccount}`);
    console.log(`    - Separate API keys: ${(process.env.REPAYMENT_API_KEY && process.env.REPAYMENT_API_SECRET) ? 'YES' : 'NO (using main API keys)'}`);
    console.log(`    - Minimum ZAR reserve: R${repaymentConfig.minimumZARReserve.toFixed(2)}`);
    console.log(`    - F&F loans config: ${ffLoansConfigPath}`);
  } else {
    console.log(`  - Repayment system: DISABLED`);
  }
  console.log('='.repeat(60));

  const valrClient = new ValrClient({
      apiKey: process.env.VALR_API_KEY!,
      apiSecret: process.env.VALR_API_SECRET!
  })

  // Create separate VALR client for repayment operations if separate API keys provided
  const repaymentValrClient = (process.env.REPAYMENT_API_KEY && process.env.REPAYMENT_API_SECRET)
    ? new ValrClient({
        apiKey: process.env.REPAYMENT_API_KEY,
        apiSecret: process.env.REPAYMENT_API_SECRET
      })
    : valrClient;

  if (repaymentValrClient !== valrClient) {
    console.log('Using separate API credentials for repayment operations');
  }

  // Initialize database
  const dataDir = process.env.DATA_DIR || path.resolve(__dirname, '../data');
  const dbPath = path.join(dataDir, 'loans.db');
  const database = new TransactionDatabase(dbPath);

  const monitor = new LoanMonitor(valrClient, config);
  const metrics = new MetricsExporter(monitor);

  // Initialize repayment manager if enabled
  let repaymentManager: RepaymentManager | undefined;
  if (repaymentEnabled && repaymentConfig) {
    const ffLoanManager = new FriendsFamilyLoanManager(ffLoansConfigPath, database);
    repaymentManager = new RepaymentManager(
      repaymentValrClient,
      monitor,
      ffLoanManager,
      repaymentConfig,
      database
    );
    console.log(`Repayment manager initialized with ${ffLoanManager.getLoanCount()} active F&F loan(s)`);
  }

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

    const response: any = {
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
    };

    // Add repayment information if enabled
    if (repaymentManager) {
      const ffSummaries = repaymentManager.getFFLoanSummaries();
      const repaymentHistory = database.getRepaymentHistory(10);
      const repaymentStats = database.getRepaymentStats();

      response.repayment = {
        enabled: true,
        dryRun: repaymentConfig?.dryRun || false,
        config: {
          repaymentSubaccount: repaymentConfig?.repaymentSubaccount,
          minimumZARReserve: repaymentConfig?.minimumZARReserve,
          separateApiKeys: !!(process.env.REPAYMENT_API_KEY && process.env.REPAYMENT_API_SECRET),
        },
        friendsFamilyLoans: {
          count: ffSummaries.length,
          totalPrincipal: ffSummaries.reduce((sum, s) => sum + s.loan.principal, 0),
          totalMonthlyObligation: ffSummaries.reduce((sum, s) => sum + s.monthlyInterestDue, 0),
          totalInterestPaid: ffSummaries.reduce((sum, s) => sum + s.totalInterestPaid, 0),
          loans: ffSummaries,
        },
        executionHistory: repaymentHistory,
        stats: repaymentStats,
      };
    } else {
      response.repayment = {
        enabled: false,
      };
    }

    res.json(response);
  });

  app.post('/refresh', async (req, res) => {
    try {
      console.log(`[${new Date().toISOString()}] Manual refresh triggered`);
      await updateData(monitor, metrics, dbPath, repaymentManager);
      res.json({ status: 'success', timestamp: new Date().toISOString() });
    } catch (error) {
      console.error('Manual refresh error:', error);
      res.status(500).json({ status: 'error', message: (error as Error).message });
    }
  });

  // Repayment endpoints
  app.get('/repayment/status', (req, res) => {
    if (!repaymentManager) {
      res.status(404).json({ error: 'Repayment system not enabled' });
      return;
    }

    const ffSummaries = repaymentManager.getFFLoanSummaries();
    res.json({
      enabled: true,
      dryRun: repaymentConfig?.dryRun || false,
      repaymentSubaccount: repaymentConfig?.repaymentSubaccount,
      minimumZARReserve: repaymentConfig?.minimumZARReserve,
      friendsFamilyLoans: ffSummaries,
    });
  });

  app.post('/repayment/execute', async (req, res) => {
    if (!repaymentManager) {
      res.status(404).json({ error: 'Repayment system not enabled' });
      return;
    }

    try {
      console.log(`[${new Date().toISOString()}] Manual repayment execution triggered`);
      const result = await repaymentManager.executeRepaymentCycle();
      const ffSummaries = repaymentManager.getFFLoanSummaries();
      metrics.updateRepaymentMetrics(result, ffSummaries, repaymentConfig?.dryRun || false);
      res.json({ status: 'success', result });
    } catch (error) {
      console.error('Manual repayment execution error:', error);
      res.status(500).json({ status: 'error', message: (error as Error).message });
    }
  });

  app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
    console.log(`  - Metrics: http://localhost:${PORT}/metrics`);
    console.log(`  - Health: http://localhost:${PORT}/health`);
    console.log(`  - Status: http://localhost:${PORT}/status`);
    console.log(`  - Refresh: POST http://localhost:${PORT}/refresh`);
    if (repaymentManager) {
      console.log(`  - Repayment Status: http://localhost:${PORT}/repayment/status`);
      console.log(`  - Repayment Execute: POST http://localhost:${PORT}/repayment/execute`);
    }
  });

  await updateData(monitor, metrics, dbPath, repaymentManager);

  setInterval(() => {
    updateData(monitor, metrics, dbPath, repaymentManager);
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
