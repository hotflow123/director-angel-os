import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { getBenchmarksPaths } from "./cli-command.mjs";

const suiteId = "director-phase-a3-agent-os-entry-projection-gate";
const pnpmBin = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const forbiddenVoiceSideEffectPatterns = [
  /navigator\.mediaDevices\.getUserMedia\s*\(/iu,
  /new\s+MediaRecorder\s*\(/iu,
  /new\s+AudioContext\s*\(/iu,
  /\bspeechSynthesis\.speak\s*\(/iu,
  /\b(?:SpeechRecognition|webkitSpeechRecognition)\b/iu,
  /\bmicrophoneAccessed:\s*true\b/iu,
  /\bwhisperStarted:\s*true\b/iu,
  /\bliveRunnerStarted:\s*true\b/iu,
  /\bspeechTranscribed:\s*true\b/iu,
  /\bspeechSynthesized:\s*true\b/iu,
  /\baudioBytesRead:\s*true\b/iu,
  /\brawAudioPersisted:\s*true\b/iu,
];
const nonVoiceTouchedFiles = [
  "packages/director-entry-contracts/src/types.ts",
  "packages/director-entry-contracts/tests/guards.test.ts",
  "apps/director-host-api/src/server.ts",
  "apps/director-host-api/tests/server.test.ts",
];

function preview(output, lines = 40) {
  return String(output ?? "")
    .split("\n")
    .slice(0, lines)
    .join("\n");
}

function runPnpm(repoRoot, label, args) {
  const started = process.hrtime.bigint();
  const result = spawnSync(pnpmBin, args, {
    cwd: repoRoot,
    encoding: "utf8",
    env: process.env,
  });
  const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;

  return {
    label,
    command: `pnpm ${args.join(" ")}`,
    status: result.status ?? -1,
    durationMs: Number(durationMs.toFixed(2)),
    stdoutPreview: preview(result.stdout),
    stderrPreview: preview(result.stderr),
  };
}

function runCase(label, fn) {
  const started = process.hrtime.bigint();
  try {
    fn();
    const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;
    return {
      label,
      command: "node assertion",
      status: 0,
      durationMs: Number(durationMs.toFixed(2)),
      stdoutPreview: "",
      stderrPreview: "",
    };
  } catch (error) {
    const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;
    return {
      label,
      command: "node assertion",
      status: 1,
      durationMs: Number(durationMs.toFixed(2)),
      stdoutPreview: "",
      stderrPreview: error instanceof Error ? error.message : String(error),
    };
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function readSource(repoRoot, relPath) {
  return readFileSync(resolve(repoRoot, relPath), "utf8");
}

function assertSourceContains(repoRoot, relPath, snippets) {
  const source = readSource(repoRoot, relPath);
  for (const snippet of snippets) {
    assert(source.includes(snippet), `${relPath} missing ${snippet}`);
  }
}

function assertEntryProjectionDeclaredInContracts(repoRoot) {
  assertSourceContains(repoRoot, "packages/director-entry-contracts/src/types.ts", [
    "DIRECTOR_ENTRY_AGENT_OS_PROJECTION_SCHEMA_ID",
    "DirectorEntryAgentOsProjection",
    "DirectorEntryAgentOsChannelProjection",
    "DirectorEntryAgentOsTimelineSummaryProjection",
    "readonly agentOsProjection?: DirectorEntryAgentOsProjection;",
    "isDirectorEntryAgentOsProjection",
    "isOptional(value.agentOsProjection, isDirectorEntryAgentOsProjection)",
    "isCount(value.totalEvents)",
  ]);
}

function assertHostApiUsesEntryContractProjection(repoRoot) {
  assertSourceContains(repoRoot, "apps/director-host-api/src/server.ts", [
    "DIRECTOR_ENTRY_AGENT_OS_PROJECTION_SCHEMA_ID",
    "DirectorEntryAgentOsProjection",
    "withEntryAgentOsProjection",
    "withSessionAgentOsProjection",
    "createEntryAgentOsProjectionFromMessage",
    "createEntryAgentOsProjectionFromSession",
    "createAgentOsTurnEnvelopeFromChannelTransport",
    "projectAgentOsTimelineSummary",
  ]);
}

function assertHostApiEntryProjectionStaysReadOnly(repoRoot) {
  const relPath = "apps/director-host-api/src/server.ts";
  const source = readSource(repoRoot, relPath);
  const start = source.indexOf("function withEntryAgentOsProjection");
  const end = source.indexOf("function createEntryAgentOsSessionTimeline", start);
  assert(start >= 0 && end > start, `${relPath} missing entry Agent OS projection section`);
  const section = source.slice(start, end);
  const forbiddenSnippets = [
    "child_process",
    "spawn(",
    "exec(",
    "submitStudioRunJob",
    "enqueueDelegation",
    "enqueueProposal",
    "writeFile",
    "mkdir",
    "append",
    "claimDelegation",
  ];
  const hits = forbiddenSnippets.filter((snippet) => section.includes(snippet));
  assert(
    hits.length === 0,
    `${relPath} entry projection must stay read-only; found ${hits.join(", ")}`,
  );
}

function assertHostApiResponseTestsCoverEntryProjection(repoRoot) {
  assertSourceContains(repoRoot, "apps/director-host-api/tests/server.test.ts", [
    "intakePayload.agentOsProjection",
    "intakePayload.session.agentOsProjection",
    "statusPayload.agentOsProjection",
    "statusPayload.session.agentOsProjection",
    'source: "channel-transport"',
    'source: "entry-session"',
    "totalEvents",
  ]);
}

function assertContractGuardTestsRejectMalformedProjection(repoRoot) {
  assertSourceContains(repoRoot, "packages/director-entry-contracts/tests/guards.test.ts", [
    "agentOsProjection: createAgentOsProjection()",
    "rejects malformed Agent OS entry projections",
    'totalEvents: "one"',
  ]);
}

function assertVoiceWorkStaysFailClosed(repoRoot) {
  const issues = [];
  for (const relPath of nonVoiceTouchedFiles) {
    const source = readSource(repoRoot, relPath);
    for (const pattern of forbiddenVoiceSideEffectPatterns) {
      if (pattern.test(source)) {
        issues.push(`${relPath} contains live voice side effect ${pattern}`);
      }
    }
  }

  assert(issues.length === 0, issues.join("\n"));
}

const { repoRoot, resultsDir } = getBenchmarksPaths();
const runs = [
  runPnpm(repoRoot, "director entry contracts guard tests", [
    "--filter",
    "@hotflow/director-entry-contracts",
    "test",
    "--",
    "tests/guards.test.ts",
  ]),
  runPnpm(repoRoot, "director host api entry projection tests", [
    "--filter",
    "@hotflow/director-host-api",
    "exec",
    "vitest",
    "run",
    "--config",
    "vitest.config.ts",
    "tests/server.test.ts",
    "-t",
    "continues an entry session through blueprint, run, and status surfaces",
  ]),
  runPnpm(repoRoot, "director entry contracts typecheck", [
    "--filter",
    "@hotflow/director-entry-contracts",
    "typecheck",
  ]),
  runPnpm(repoRoot, "director host api typecheck", [
    "--filter",
    "@hotflow/director-host-api",
    "typecheck",
  ]),
  runPnpm(repoRoot, "director entry contracts build", [
    "--filter",
    "@hotflow/director-entry-contracts",
    "build",
  ]),
  runPnpm(repoRoot, "director host api build", ["--filter", "@hotflow/director-host-api", "build"]),
  runCase("entry contracts declare optional Agent OS projection", () =>
    assertEntryProjectionDeclaredInContracts(repoRoot),
  ),
  runCase("host api projects entry responses through director-entry-contracts", () =>
    assertHostApiUsesEntryContractProjection(repoRoot),
  ),
  runCase("host api entry projection stays read-only", () =>
    assertHostApiEntryProjectionStaysReadOnly(repoRoot),
  ),
  runCase("host api tests cover top-level and session projection surfaces", () =>
    assertHostApiResponseTestsCoverEntryProjection(repoRoot),
  ),
  runCase("entry contract guards reject malformed Agent OS projection", () =>
    assertContractGuardTestsRejectMalformedProjection(repoRoot),
  ),
  runCase("Phase A.3 entry projection keeps voice/live audio fail-closed", () =>
    assertVoiceWorkStaysFailClosed(repoRoot),
  ),
];
const failedRuns = runs.filter((run) => run.status !== 0);

mkdirSync(resultsDir, { recursive: true });
const outputPath = resolve(resultsDir, `${suiteId}-latest.json`);
writeFileSync(
  outputPath,
  JSON.stringify(
    {
      summary: {
        suiteId,
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
  `Director Agent OS entry projection gate completed: ${runs.length} checks, failed ${failedRuns.length}\n`,
);
process.stdout.write(`Report: ${outputPath}\n`);

if (failedRuns.length > 0) {
  for (const failedRun of failedRuns) {
    process.stderr.write(
      [failedRun.label, failedRun.stderrPreview, failedRun.stdoutPreview]
        .filter(Boolean)
        .join("\n"),
    );
    process.stderr.write("\n");
  }
  process.exitCode = 1;
}
