const { join } = require("node:path");

const {
  ConversationRuntimeSessionQueue,
  createConversationRuntimeBackgroundJobTurnExecutor,
  createConversationRuntimeBackgroundJobSchedulerDaemon,
  createSQLiteConversationRuntimeBackgroundJobScheduleStore,
  createSQLiteConversationRuntimeBackgroundJobStore,
  runConversationRuntimeBackgroundJobSchedulerStep,
  runConversationRuntimeBackgroundJobWorkerLoop,
} = require("@hotflow/conversation-runtime");

function createDesktopBackgroundRuntime({
  dataDir,
  env = process.env,
  emitDesktopEvent = () => {},
  nowMs = Date.now,
  runTurn,
  scheduledLearningRunner,
} = {}) {
  const runtimeDir = join(dataDir ?? ".hotflow", "conversation-runtime");
  const dbPath =
    env.DIRECTOR_DESKTOP_BACKGROUND_RUNTIME_DB_PATH?.trim() ||
    join(runtimeDir, "background-runtime.sqlite");
  const scheduleStore = createSQLiteConversationRuntimeBackgroundJobScheduleStore({ dbPath });
  const backgroundJobStore = createSQLiteConversationRuntimeBackgroundJobStore({ dbPath });
  const queue = new ConversationRuntimeSessionQueue();
  const workerId =
    env.DIRECTOR_DESKTOP_BACKGROUND_WORKER_ID?.trim() || "director-desktop-background-worker";
  const workerMaxClaims = readPositiveInteger(
    env.DIRECTOR_DESKTOP_BACKGROUND_WORKER_MAX_CLAIMS,
    1,
  );
  const workerMinDelayMs = readPositiveInteger(
    env.DIRECTOR_DESKTOP_BACKGROUND_WORKER_MIN_DELAY_MS,
    250,
  );
  const workerMaxDelayMs = readPositiveInteger(
    env.DIRECTOR_DESKTOP_BACKGROUND_WORKER_MAX_DELAY_MS,
    10_000,
  );
  const workerExecutor =
    typeof runTurn === "function" || typeof scheduledLearningRunner === "function"
      ? createDesktopBackgroundWorkerExecutor({
          runTurn,
          scheduledLearningRunner,
          workerMaxDelayMs,
        })
      : createUnavailableDesktopBackgroundWorkerExecutor();
  let workerTimer = null;
  let workerRunning = false;
  let workerStepInFlight = false;
  const daemon = createConversationRuntimeBackgroundJobSchedulerDaemon({
    scheduleStore,
    backgroundJobStore,
    queue,
    nowMs,
    minDelayMs: readPositiveInteger(env.DIRECTOR_DESKTOP_BACKGROUND_SCHEDULER_MIN_DELAY_MS, 250),
    maxDelayMs: readPositiveInteger(env.DIRECTOR_DESKTOP_BACKGROUND_SCHEDULER_MAX_DELAY_MS, 60_000),
    maxDispatches: readPositiveInteger(env.DIRECTOR_DESKTOP_BACKGROUND_SCHEDULER_MAX_DISPATCHES, 1),
    onReport(report) {
      emitDesktopEvent({
        role: "system",
        title: "后台调度",
        body: `status=${report.status} dispatched=${report.dispatchedCount} blocked=${report.blockedCount}`,
        actionType: "background.scheduler",
        backgroundScheduler: report,
      });
      scheduleWorkerStep(0);
    },
    onError(error) {
      emitDesktopEvent({
        role: "system",
        title: "后台调度错误",
        body: error instanceof Error ? error.message : String(error),
        actionType: "background.scheduler.error",
      });
    },
  });

  const runWorkerOnce = async () => {
    const report = await runConversationRuntimeBackgroundJobWorkerLoop({
      store: backgroundJobStore,
      workerId,
      maxClaims: workerMaxClaims,
      nowMs,
      executor: workerExecutor,
    });
    emitDesktopEvent({
      role: "system",
      title: "后台执行",
      body: `status=${report.status} claimed=${report.claimedCount} completed=${report.completedCount} retry=${report.retryScheduledCount} failed=${report.failedCount}`,
      actionType: report.status === "failed" ? "background.worker.error" : "background.worker",
      backgroundWorker: report,
    });
    return report;
  };
  const scheduleOnce = () => {
    const report = runConversationRuntimeBackgroundJobSchedulerStep({
      scheduleStore,
      backgroundJobStore,
      queue,
      nowMs,
      maxDispatches: readPositiveInteger(
        env.DIRECTOR_DESKTOP_BACKGROUND_SCHEDULER_MAX_DISPATCHES,
        1,
      ),
    });
    emitDesktopEvent({
      role: "system",
      title: "后台调度",
      body: `status=${report.status} dispatched=${report.dispatchedCount} blocked=${report.blockedCount}`,
      actionType: "background.scheduler",
      backgroundScheduler: report,
    });
    return report;
  };

  const clearWorkerTimer = () => {
    if (workerTimer !== null) {
      clearTimeout(workerTimer);
      workerTimer = null;
    }
  };

  const scheduleWorkerStep = (delayMs) => {
    if (!workerRunning) {
      return;
    }
    clearWorkerTimer();
    workerTimer = setTimeout(() => {
      void runWorkerStep();
    }, Math.max(0, delayMs));
  };

  const runWorkerStep = async () => {
    if (!workerRunning || workerStepInFlight) {
      return;
    }
    workerStepInFlight = true;
    try {
      const report = await runWorkerOnce();
      const shouldPollSoon =
        report.claimedCount > 0 || report.stoppedReason === "executor-error";
      scheduleWorkerStep(shouldPollSoon ? workerMinDelayMs : workerMaxDelayMs);
    } catch (error) {
      emitDesktopEvent({
        role: "system",
        title: "后台执行错误",
        body: error instanceof Error ? error.message : String(error),
        actionType: "background.worker.error",
      });
      scheduleWorkerStep(workerMaxDelayMs);
    } finally {
      workerStepInFlight = false;
    }
  };

  return {
    dbPath,
    scheduleStore,
    backgroundJobStore,
    queue,
    scheduleOnce,
    runWorkerOnce,
    start() {
      daemon.start();
      if (!workerRunning) {
        workerRunning = true;
        scheduleWorkerStep(0);
      }
    },
    stop() {
      daemon.stop();
      workerRunning = false;
      clearWorkerTimer();
    },
    isRunning() {
      return daemon.isRunning() || workerRunning;
    },
  };
}

function createDesktopBackgroundWorkerExecutor({
  runTurn,
  scheduledLearningRunner,
  workerMaxDelayMs,
}) {
  const genericExecutor =
    typeof runTurn === "function"
      ? createConversationRuntimeBackgroundJobTurnExecutor({
          surface: "desktop",
          channel: "desktop-background",
          runTurn,
          classifyError: ({ error, context }) => ({
            status: "retry",
            reason: error instanceof Error ? error.message : String(error),
            nextAttemptAtMs: context.nowMs + workerMaxDelayMs,
            failureTaxonomy: ["desktop_background_runtime_error"],
          }),
        })
      : createUnavailableDesktopBackgroundWorkerExecutor();
  return async (job, context) => {
    if (isRoleScopedScheduledLearningJob(job) && typeof scheduledLearningRunner === "function") {
      try {
        return await scheduledLearningRunner({ job, context });
      } catch (error) {
        return {
          status: "retry",
          reason: error instanceof Error ? error.message : String(error),
          nextAttemptAtMs: context.nowMs + workerMaxDelayMs,
          failureTaxonomy: ["desktop_background_scheduled_learning_error"],
        };
      }
    }
    return genericExecutor(job, context);
  };
}

function isRoleScopedScheduledLearningJob(job) {
  return (
    job?.metadata?.scheduledLearning === true &&
    typeof job?.metadata?.roleId === "string" &&
    job.metadata.roleId.trim().length > 0 &&
    job?.metadata?.candidateOnly === true &&
    job?.metadata?.autoPublish === false &&
    job?.metadata?.memorySync === "skip-auto-write"
  );
}

function createUnavailableDesktopBackgroundWorkerExecutor() {
  return async (_job, context) => ({
    status: "retry",
    reason: "Desktop background conversation turn runner is not ready.",
    nextAttemptAtMs: context.nowMs + 10_000,
    failureTaxonomy: ["desktop_background_runner_unavailable"],
  });
}

function readPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

module.exports = {
  createDesktopBackgroundRuntime,
};
