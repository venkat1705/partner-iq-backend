import { AdminJobsService } from '../modules/admin/jobs/admin-jobs.service';
import { dbStore } from '../database/store';

async function runTests() {
  console.log('🧪 Starting Admin Jobs & Queues Operations Center Test Suite...');
  let passed = 0;
  let failed = 0;

  const service = new AdminJobsService();

  // Test 1: Canonical queue and worker infrastructure seeding
  try {
    service.seedBaselineQueueInfrastructure();
    const queues = await service.getQueues();
    const workers = await service.getWorkers();
    const schedulers = await service.getScheduledJobs();

    if (
      queues.queues.length >= 6 &&
      workers.workers.length >= 6 &&
      schedulers.scheduledJobs.length >= 5
    ) {
      console.log(`  ✅ Test 1 Passed: Queue infrastructure seeded (${queues.queues.length} queues, ${workers.workers.length} workers, ${schedulers.scheduledJobs.length} schedulers)`);
      passed++;
    } else {
      throw new Error(`Insufficient baseline queues: ${queues.queues.length} queues, ${workers.workers.length} workers`);
    }
  } catch (err: any) {
    console.error('  ❌ Test 1 Failed:', err?.message || err);
    failed++;
  }

  // Test 2: Global Jobs Overview & KPI aggregation
  try {
    const overview = await service.getOverview('24h');
    if (
      overview.kpi.activeQueuesCount >= 6 &&
      overview.kpi.totalJobsProcessed > 0 &&
      overview.kpi.activeWorkersCount >= 6 &&
      overview.kpi.p95ProcessingDurationMs > 0 &&
      overview.kpi.statusExplanation.length > 0
    ) {
      console.log(`  ✅ Test 2 Passed: Global Overview computed (Total processed: ${overview.kpi.totalJobsProcessed}, P95: ${overview.kpi.p95ProcessingDurationMs}ms, Health: ${overview.kpi.overallQueueHealth})`);
      passed++;
    } else {
      throw new Error('Global overview did not produce expected KPIs');
    }
  } catch (err: any) {
    console.error('  ❌ Test 2 Failed:', err?.message || err);
    failed++;
  }

  // Test 3: Filterable Jobs Query
  try {
    const allJobs = await service.getJobs({});
    const webhookJobs = await service.getJobs({ queueName: 'webhook-dispatch-queue' });
    const searchJobs = await service.getJobs({ search: 'Razorpay' });

    if (allJobs.total > 0 && webhookJobs.total > 0 && searchJobs.total > 0) {
      console.log(`  ✅ Test 3 Passed: Jobs queried and filtered (Total: ${allJobs.total}, Webhooks: ${webhookJobs.total}, Search: ${searchJobs.total})`);
      passed++;
    } else {
      throw new Error(`Query filtering failed: Total=${allJobs.total}, Webhook=${webhookJobs.total}`);
    }
  } catch (err: any) {
    console.error('  ❌ Test 3 Failed:', err?.message || err);
    failed++;
  }

  // Test 4: Job Detail & Attempts workspace
  try {
    const firstJob = dbStore.jobRecords[0];
    const detail = await service.getJobDetail(firstJob.id);

    if (detail.job.id === firstJob.id && Array.isArray(detail.attempts) && detail.attempts.length > 0) {
      console.log(`  ✅ Test 4 Passed: Job detail workspace resolved (${detail.job.jobId}, ${detail.attempts.length} attempt(s))`);
      passed++;
    } else {
      throw new Error('Failed to resolve job detail or attempt history');
    }
  } catch (err: any) {
    console.error('  ❌ Test 4 Failed:', err?.message || err);
    failed++;
  }

  // Test 5: Idempotency-aware Retry Job
  try {
    const failedJob = dbStore.jobRecords.find((j) => j.status === 'FAILED');
    if (!failedJob) throw new Error('No failed job available for retry test');

    const previousAttempts = failedJob.attemptsMade || 0;
    const retried = await service.retryJob(failedJob.id);

    if (retried.status === 'WAITING' && retried.attemptsMade === previousAttempts + 1) {
      console.log(`  ✅ Test 5 Passed: Idempotent job retry verified (${retried.jobId} -> WAITING, attempts: ${retried.attemptsMade})`);
      passed++;
    } else {
      throw new Error('Retry did not reset status to WAITING or increment attempts');
    }
  } catch (err: any) {
    console.error('  ❌ Test 5 Failed:', err?.message || err);
    failed++;
  }

  // Test 6: Bulk Retry
  try {
    const jobIds = dbStore.jobRecords.slice(0, 2).map((j) => j.id);
    const bulkRes = await service.bulkRetryJobs(jobIds);

    if (bulkRes.retriedCount === 2) {
      console.log(`  ✅ Test 6 Passed: Bulk retry processed (${bulkRes.retriedCount} jobs retried)`);
      passed++;
    } else {
      throw new Error(`Bulk retry count mismatch: ${bulkRes.retriedCount}`);
    }
  } catch (err: any) {
    console.error('  ❌ Test 6 Failed:', err?.message || err);
    failed++;
  }

  // Test 7: Queue Controls (Pause, Resume, Concurrency, Drain)
  try {
    const queueName = 'webhook-dispatch-queue';
    const paused = await service.pauseQueue(queueName);
    if (!paused.isPaused) throw new Error('Queue pause failed');

    const resumed = await service.resumeQueue(queueName);
    if (resumed.isPaused) throw new Error('Queue resume failed');

    const updated = await service.updateQueueConcurrency(queueName, 12);
    if (updated.concurrency !== 12) throw new Error('Concurrency update failed');

    const drained = await service.drainQueue(queueName, 'WAITING');
    console.log(`  ✅ Test 7 Passed: Queue controls verified (Pause, Resume, Concurrency=12, Drained=${drained.drainedCount})`);
    passed++;
  } catch (err: any) {
    console.error('  ❌ Test 7 Failed:', err?.message || err);
    failed++;
  }

  // Test 8: Worker Fleet Management (Ping & Restart)
  try {
    const worker = dbStore.workerRecords[0];
    const ping = await service.pingWorker(worker.workerId);
    if (!ping.pingSuccess) throw new Error('Worker ping failed');

    const restart = await service.restartWorker(worker.workerId);
    if (!restart.restartSignalSent) throw new Error('Worker restart failed');

    console.log(`  ✅ Test 8 Passed: Worker fleet controls verified (Ping: ${ping.latencyMs}ms, Restart: OK)`);
    passed++;
  } catch (err: any) {
    console.error('  ❌ Test 8 Failed:', err?.message || err);
    failed++;
  }

  // Test 9: Scheduled Cron Jobs
  try {
    const sched = dbStore.scheduledJobRecords[0];
    const triggered = await service.triggerScheduledJob(sched.id);
    if (!triggered.enqueuedJobId) throw new Error('Manual schedule trigger failed');

    const previousPaused = sched.isPaused;
    const toggled = await service.toggleScheduledJob(sched.id);
    if (toggled.isPaused !== !previousPaused) throw new Error('Schedule toggle failed');

    console.log(`  ✅ Test 9 Passed: Cron scheduling verified (Manual trigger: ${triggered.enqueuedJobId}, Toggle: isPaused=${toggled.isPaused})`);
    passed++;
  } catch (err: any) {
    console.error('  ❌ Test 9 Failed:', err?.message || err);
    failed++;
  }

  // Test 10: Dead Letter Queue (DLQ) Management
  try {
    const dlqRes = await service.getDeadLetterRecords();
    if (dlqRes.deadLetterRecords.length === 0) throw new Error('No DLQ records available');

    const firstDlq = dlqRes.deadLetterRecords[0];
    const replayed = await service.replayDlqJob(firstDlq.id);

    if (replayed.replayedRecord.status === 'REPLAYED' && replayed.enqueuedJobId) {
      console.log(`  ✅ Test 10 Passed: DLQ operations verified (Replayed: ${replayed.enqueuedJobId} -> ${replayed.replayedRecord.queueName})`);
      passed++;
    } else {
      throw new Error('DLQ replay failed');
    }
  } catch (err: any) {
    console.error('  ❌ Test 10 Failed:', err?.message || err);
    failed++;
  }

  // Test 11: Anomaly Exceptions & Administrative Reconciliation
  try {
    const exRes = await service.getExceptions();
    if (exRes.exceptions.length === 0) throw new Error('No exceptions found');

    const firstEx = exRes.exceptions[0];
    const resolved = await service.resolveException(firstEx.id, 'Manually cleared by test runner');

    if (resolved.isResolved && resolved.resolutionNotes) {
      console.log(`  ✅ Test 11 Passed: Exception resolved & reconciled (${resolved.exceptionType} -> Resolved)`);
      passed++;
    } else {
      throw new Error('Exception resolution failed');
    }
  } catch (err: any) {
    console.error('  ❌ Test 11 Failed:', err?.message || err);
    failed++;
  }

  // Test 12: Performance Percentiles & Engine Settings
  try {
    const perf = await service.getPerformanceMetrics();
    const settings = await service.getSettings();
    const updatedSettings = await service.updateSettings({ defaultMaxRetries: 4 });

    if (
      perf.kpi.p50LatencyMs > 0 &&
      perf.kpi.p95LatencyMs > 0 &&
      settings.kpi.maxConcurrencyLimit > 0 &&
      updatedSettings.defaultMaxRetries === 4
    ) {
      console.log(`  ✅ Test 12 Passed: Performance & Settings verified (P50: ${perf.kpi.p50LatencyMs}ms, P95: ${perf.kpi.p95LatencyMs}ms, MaxRetries: ${updatedSettings.defaultMaxRetries})`);
      passed++;
    } else {
      throw new Error('Performance or settings verification failed');
    }
  } catch (err: any) {
    console.error('  ❌ Test 12 Failed:', err?.message || err);
    failed++;
  }

  console.log(`\n📊 Jobs & Queues Operations Tests Complete: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
