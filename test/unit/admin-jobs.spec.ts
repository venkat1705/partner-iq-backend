import { describe, it, expect, beforeEach } from '@jest/globals';
import { AdminJobsService } from '../../src/modules/admin/jobs/admin-jobs.service';
import { dbStore } from '../../src/database/store';

describe('AdminJobsService', () => {
  let service: AdminJobsService;

  beforeEach(() => {
    service = new AdminJobsService();
    service.seedBaselineQueueInfrastructure();
  });

  it('seeds canonical queue and worker infrastructure', async () => {
    const queues = await service.getQueues();
    const workers = await service.getWorkers();
    const schedulers = await service.getScheduledJobs();

    expect(queues.queues.length).toBeGreaterThanOrEqual(6);
    expect(workers.workers.length).toBeGreaterThanOrEqual(6);
    expect(schedulers.scheduledJobs.length).toBeGreaterThanOrEqual(5);
  });

  it('computes global jobs overview and KPI aggregation', async () => {
    const overview = await service.getOverview('24h');
    expect(overview.kpi.activeQueuesCount).toBeGreaterThanOrEqual(6);
    expect(overview.kpi.totalJobsProcessed).toBeGreaterThan(0);
    expect(overview.kpi.activeWorkersCount).toBeGreaterThanOrEqual(6);
    expect(overview.kpi.p95ProcessingDurationMs).toBeGreaterThan(0);
    expect(overview.kpi.statusExplanation.length).toBeGreaterThan(0);
  });

  it('filters and queries jobs by queue name and search string', async () => {
    const allJobs = await service.getJobs({});
    const webhookJobs = await service.getJobs({ queueName: 'webhook-dispatch-queue' });
    const searchJobs = await service.getJobs({ search: 'Razorpay' });

    expect(allJobs.total).toBeGreaterThan(0);
    expect(webhookJobs.total).toBeGreaterThan(0);
    expect(searchJobs.total).toBeGreaterThan(0);
  });

  it('retrieves job detail and attempts history', async () => {
    const firstJob = dbStore.jobRecords[0];
    const detail = await service.getJobDetail(firstJob.id);

    expect(detail.job.id).toBe(firstJob.id);
    expect(Array.isArray(detail.attempts)).toBe(true);
    expect(detail.attempts.length).toBeGreaterThan(0);
  });

  it('retries failed jobs idempotently and supports bulk retry', async () => {
    const failedJob = dbStore.jobRecords.find((j) => j.status === 'FAILED');
    expect(failedJob).toBeDefined();

    const previousAttempts = failedJob!.attemptsMade || 0;
    const retried = await service.retryJob(failedJob!.id);

    expect(retried.status).toBe('WAITING');
    expect(retried.attemptsMade).toBe(previousAttempts + 1);

    const jobIds = dbStore.jobRecords.slice(0, 2).map((j) => j.id);
    const bulkRes = await service.bulkRetryJobs(jobIds);
    expect(bulkRes.retriedCount).toBe(2);
  });

  it('executes queue controls (pause, resume, concurrency update, and drain)', async () => {
    const queueName = 'webhook-dispatch-queue';
    const paused = await service.pauseQueue(queueName);
    expect(paused.isPaused).toBe(true);

    const resumed = await service.resumeQueue(queueName);
    expect(resumed.isPaused).toBe(false);

    const updated = await service.updateQueueConcurrency(queueName, 12);
    expect(updated.concurrency).toBe(12);

    const drained = await service.drainQueue(queueName, 'WAITING');
    expect(drained).toHaveProperty('drainedCount');
  });

  it('manages worker fleet with ping and restart signals', async () => {
    const worker = dbStore.workerRecords[0];
    const ping = await service.pingWorker(worker.workerId);
    expect(ping.pingSuccess).toBe(true);

    const restart = await service.restartWorker(worker.workerId);
    expect(restart.restartSignalSent).toBe(true);
  });

  it('manages scheduled cron jobs and DLQ replay', async () => {
    const sched = dbStore.scheduledJobRecords[0];
    const triggered = await service.triggerScheduledJob(sched.id);
    expect(triggered.enqueuedJobId).toBeDefined();

    const previousPaused = sched.isPaused;
    const toggled = await service.toggleScheduledJob(sched.id);
    expect(toggled.isPaused).toBe(!previousPaused);

    const dlqRes = await service.getDeadLetterRecords();
    expect(dlqRes.deadLetterRecords.length).toBeGreaterThan(0);

    const firstDlq = dlqRes.deadLetterRecords[0];
    const replayed = await service.replayDlqJob(firstDlq.id);
    expect(replayed.replayedRecord.status).toBe('REPLAYED');
    expect(replayed.enqueuedJobId).toBeDefined();
  });

  it('reconciles anomaly exceptions and updates settings', async () => {
    const exRes = await service.getExceptions();
    expect(exRes.exceptions.length).toBeGreaterThan(0);

    const firstEx = exRes.exceptions[0];
    const resolved = await service.resolveException(firstEx.id, 'Manually cleared by test runner');
    expect(resolved.isResolved).toBe(true);
    expect(resolved.resolutionNotes).toBeDefined();

    const perf = await service.getPerformanceMetrics();
    const settings = await service.getSettings();
    const updatedSettings = await service.updateSettings({ defaultMaxRetries: 4 });

    expect(perf.kpi.p50LatencyMs).toBeGreaterThan(0);
    expect(perf.kpi.p95LatencyMs).toBeGreaterThan(0);
    expect(settings.kpi.maxConcurrencyLimit).toBeGreaterThan(0);
    expect(updatedSettings.defaultMaxRetries).toBe(4);
  });
});

