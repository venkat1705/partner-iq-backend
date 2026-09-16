import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PerformanceReconciliationService } from './performance-reconciliation.service';

const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const STARTUP_DELAY_MS = 30 * 1000; // let the app finish booting before the first pass

/**
 * Drives PerformanceReconciliationService on a recurring schedule. Without this, tiers
 * configured with TierDowngradeMode.DOWNGRADE_NEXT_PERIOD (the default mode) never actually
 * downgrade — evaluateAffiliateTier() only executes a deferred downgrade when
 * isPeriodBoundaryJob is true, and this reconciliation run is the only caller that sets it.
 *
 * Follows the same OnModuleInit/setInterval pattern already used by TrialSchedulerService
 * elsewhere in this codebase, rather than introducing a new @nestjs/schedule dependency.
 */
@Injectable()
export class GamificationSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GamificationSchedulerService.name);
  private intervalRef?: NodeJS.Timeout;
  private startupTimeoutRef?: NodeJS.Timeout;
  private isRunning = false;

  constructor(private readonly reconciliationService: PerformanceReconciliationService) {}

  onModuleInit() {
    const intervalMs = Number(process.env.GAMIFICATION_RECONCILIATION_INTERVAL_MS) || DEFAULT_INTERVAL_MS;

    this.intervalRef = setInterval(() => {
      this.runSafely().catch((err) => {
        this.logger.error(`Unhandled error scheduling gamification reconciliation: ${err?.message || err}`);
      });
    }, intervalMs);

    // Give the app a moment to finish booting (dbStore.initialize(), etc.) before the first run.
    this.startupTimeoutRef = setTimeout(() => {
      this.runSafely().catch((err) => {
        this.logger.error(`Unhandled error during startup gamification reconciliation: ${err?.message || err}`);
      });
    }, STARTUP_DELAY_MS);
  }

  onModuleDestroy() {
    if (this.intervalRef) clearInterval(this.intervalRef);
    if (this.startupTimeoutRef) clearTimeout(this.startupTimeoutRef);
  }

  private async runSafely() {
    if (this.isRunning) {
      this.logger.warn('Skipping gamification reconciliation tick — previous run still in progress.');
      return;
    }
    this.isRunning = true;
    try {
      const result = await this.reconciliationService.runPeriodicReconciliation();
      this.logger.log(
        `Gamification reconciliation tick complete: ${result.evaluatedCount} evaluated, ${result.transitionCount} tier transitions.`,
      );
    } catch (err: any) {
      this.logger.error(`Gamification reconciliation run failed: ${err?.message || err}`, err?.stack);
    } finally {
      this.isRunning = false;
    }
  }
}
