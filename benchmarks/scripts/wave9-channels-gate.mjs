import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  buildChannelSessionKey,
  createChannelDeliveryResult,
  createChannelTransportEnvelope,
  resolveChannelSessionTarget,
  validateChannelRoutingHint,
} from "../../packages/channels-core/dist/index.js";
import { getBenchmarksPaths } from "./cli-command.mjs";

function compareSubset(actual, expected, path = "value") {
  const failures = [];

  if (expected === null || typeof expected !== "object" || Array.isArray(expected)) {
    if (actual !== expected) {
      failures.push(
        `Expected ${path}=${JSON.stringify(expected)} but received ${JSON.stringify(actual)}.`,
      );
    }
    return failures;
  }

  if (actual === null || typeof actual !== "object" || Array.isArray(actual)) {
    failures.push(`Expected ${path} to be an object.`);
    return failures;
  }

  for (const [key, expectedValue] of Object.entries(expected)) {
    failures.push(...compareSubset(actual[key], expectedValue, `${path}.${key}`));
  }

  return failures;
}

function runCase(benchmarkCase) {
  const failures = [];

  try {
    if (benchmarkCase.routingHint) {
      validateChannelRoutingHint(benchmarkCase.routingHint);
      const sessionKey = buildChannelSessionKey(benchmarkCase.routingHint);
      const target = resolveChannelSessionTarget(benchmarkCase.routingHint);

      if (benchmarkCase.expectSessionKey && sessionKey !== benchmarkCase.expectSessionKey) {
        failures.push(
          `Expected session key ${benchmarkCase.expectSessionKey} but received ${sessionKey}.`,
        );
      }

      if (benchmarkCase.expectTarget) {
        failures.push(...compareSubset(target, benchmarkCase.expectTarget, "target"));
      }
    }

    if (benchmarkCase.envelope) {
      const envelope = createChannelTransportEnvelope({
        ...benchmarkCase.envelope,
        routingHint: benchmarkCase.routingHint,
      });
      if (benchmarkCase.expectEnvelope) {
        failures.push(...compareSubset(envelope, benchmarkCase.expectEnvelope, "envelope"));
      }
    }

    if (benchmarkCase.delivery) {
      const delivery = createChannelDeliveryResult(benchmarkCase.delivery);
      if (benchmarkCase.expectDelivery) {
        failures.push(...compareSubset(delivery, benchmarkCase.expectDelivery, "delivery"));
      }
    }

    if (benchmarkCase.expectError) {
      failures.push(
        `Expected error ${benchmarkCase.expectError.name} but case completed successfully.`,
      );
    }
  } catch (error) {
    if (!benchmarkCase.expectError) {
      failures.push(`Unexpected error: ${error instanceof Error ? error.message : String(error)}`);
    } else {
      const name = error instanceof Error ? error.name : typeof error;
      const message = error instanceof Error ? error.message : String(error);

      if (name !== benchmarkCase.expectError.name) {
        failures.push(`Expected error ${benchmarkCase.expectError.name} but received ${name}.`);
      }

      for (const needle of benchmarkCase.expectError.includes ?? []) {
        if (!message.includes(needle)) {
          failures.push(`Expected error message to include ${needle}.`);
        }
      }
    }
  }

  return {
    caseId: benchmarkCase.id,
    ok: failures.length === 0,
    failures,
  };
}

const { benchmarksDir, resultsDir } = getBenchmarksPaths();
const fixturePath = resolve(benchmarksDir, "fixtures", "wave9-channels-gate.json");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
const runs = fixture.cases.map((benchmarkCase) => runCase(benchmarkCase));
const failedRuns = runs.filter((run) => !run.ok);

mkdirSync(resultsDir, { recursive: true });
const outputPath = resolve(resultsDir, "wave9-channels-gate-latest.json");
writeFileSync(
  outputPath,
  JSON.stringify(
    {
      summary: {
        suiteId: fixture.suiteId ?? "wave9-channels-gate",
        timestamp: new Date().toISOString(),
        totalRuns: runs.length,
        failedRuns: failedRuns.length,
      },
      runs,
    },
    null,
    2,
  ),
);

process.stdout.write(
  `Wave 9 channels gate completed: ${runs.length} runs, failed ${failedRuns.length}\n`,
);
process.stdout.write(`Report: ${outputPath}\n`);

if (failedRuns.length > 0) {
  process.exitCode = 1;
}
