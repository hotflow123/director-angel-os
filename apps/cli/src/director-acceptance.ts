import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

export type DirectorAcceptanceOutputFormat = "json" | "text";
export type DirectorAcceptanceStatus = "pass" | "warn" | "fail";

export interface DirectorAcceptanceCheck {
  readonly id: string;
  readonly label: string;
  readonly status: DirectorAcceptanceStatus;
  readonly summary: string;
  readonly detailLines: readonly string[];
  readonly artifactPath?: string;
  readonly recordedAt?: string;
}

export interface DirectorAcceptanceReport {
  readonly generatedAt: string;
  readonly benchmarkResultsDir: string;
  readonly status: DirectorAcceptanceStatus;
  readonly counts: {
    readonly pass: number;
    readonly warn: number;
    readonly fail: number;
    readonly total: number;
  };
  readonly checks: readonly DirectorAcceptanceCheck[];
  readonly nextAction: string;
}

type ParsedDirectorAcceptanceArgsResult =
  | {
      readonly ok: true;
      readonly value: {
        readonly format: DirectorAcceptanceOutputFormat;
        readonly help: boolean;
      };
    }
  | {
      readonly ok: false;
      readonly error: string;
    };

interface GateArtifactDescriptor {
  readonly id: string;
  readonly label: string;
  readonly prefix: string;
}

interface AcceptanceArtifactSummary {
  readonly status: DirectorAcceptanceStatus;
  readonly summary: string;
  readonly detailLines: readonly string[];
  readonly recordedAt?: string;
}

const REQUIRED_GATE_ARTIFACTS: readonly GateArtifactDescriptor[] = [
  {
    id: "beta7-wave1",
    label: "Beta-7 Wave 1 adapter registry",
    prefix: "director-beta7-wave1-adapter-registry-gate",
  },
  {
    id: "beta7-wave2",
    label: "Beta-7 Wave 2 real adapter bridge",
    prefix: "director-beta7-wave2-real-adapter-bridge-gate",
  },
  {
    id: "beta8",
    label: "Beta-8 single vertical",
    prefix: "director-beta8-single-vertical-gate",
  },
  {
    id: "phase-p2-wave1",
    label: "Phase P2 Wave 1 real execution handoff",
    prefix: "director-phase-p2-wave1-real-execution-adapter-handoff-gate",
  },
  {
    id: "phase-p2-wave2",
    label: "Phase P2 Wave 2 dual execution chain",
    prefix: "director-phase-p2-wave2-dual-execution-chain-gate",
  },
  {
    id: "phase-p2-wave3",
    label: "Phase P2 Wave 3 retryable bridge failure",
    prefix: "director-phase-p2-wave3-retryable-bridge-failure-gate",
  },
  {
    id: "phase-p2-wave4",
    label: "Phase P2 Wave 4 non-retryable bridge failure",
    prefix: "director-phase-p2-wave4-non-retryable-bridge-failure-gate",
  },
  {
    id: "phase-p2-wave5",
    label: "Phase P2 Wave 5 retry policy boundary",
    prefix: "director-phase-p2-wave5-retry-policy-boundary-gate",
  },
  {
    id: "phase-p2-wave6",
    label: "Phase P2 Wave 6 failover boundary",
    prefix: "director-phase-p2-wave6-failover-boundary-gate",
  },
  {
    id: "phase-p2-wave7",
    label: "Phase P2 Wave 7 route recovery audit closure",
    prefix: "director-phase-p2-wave7-route-recovery-audit-closure-gate",
  },
  {
    id: "phase-p2-wave8",
    label: "Phase P2 Wave 8 chain route health snapshot",
    prefix: "director-phase-p2-wave8-chain-route-health-snapshot-gate",
  },
  {
    id: "phase-p2-wave9",
    label: "Phase P2 Wave 9 chain route doctor visibility",
    prefix: "director-phase-p2-wave9-chain-route-doctor-visibility-gate",
  },
  {
    id: "phase-p2-wave10",
    label: "Phase P2 Wave 10 worker once operator entry",
    prefix: "director-phase-p2-wave10-worker-once-operator-entry-gate",
  },
  {
    id: "phase-p2-wave11",
    label: "Phase P2 Wave 11 run once preflight guidance",
    prefix: "director-phase-p2-wave11-run-once-preflight-guidance-gate",
  },
  {
    id: "phase-p2-wave12",
    label: "Phase P2 Wave 12 run once exit surface",
    prefix: "director-phase-p2-wave12-run-once-exit-surface-gate",
  },
  {
    id: "phase-p2-wave13",
    label: "Phase P2 Wave 13 run once holding-state taxonomy",
    prefix: "director-phase-p2-wave13-run-once-holding-state-taxonomy-gate",
  },
  {
    id: "phase-p2-wave14",
    label: "Phase P2 Wave 14 run state surface alignment",
    prefix: "director-phase-p2-wave14-run-state-surface-alignment-gate",
  },
  {
    id: "phase-p2-wave15",
    label: "Phase P2 Wave 15 run state visibility closeout",
    prefix: "director-phase-p2-wave15-run-state-visibility-closeout-gate",
  },
  {
    id: "cycle1-wave83",
    label: "Cycle 1 Wave 83 prompt-inspect static runtime summary surface",
    prefix: "wave83-prompt-inspect-static-runtime-summary-surface",
  },
  {
    id: "cycle1-wave84",
    label: "Cycle 1 Wave 84 prompt-inspect dynamic runtime summary surface",
    prefix: "wave84-prompt-inspect-dynamic-runtime-summary-surface",
  },
  {
    id: "cycle1-wave85",
    label: "Cycle 1 Wave 85 prompt-inspect focus omission summary surface",
    prefix: "wave85-prompt-inspect-focus-omission-summary-surface",
  },
  {
    id: "cycle1-wave86",
    label: "Cycle 1 Wave 86 prompt-inspect change summary surface",
    prefix: "wave86-prompt-inspect-change-summary-surface",
  },
  {
    id: "cycle1-wave87",
    label: "Cycle 1 Wave 87 status prompt change summary closure",
    prefix: "wave87-status-prompt-change-summary-closure",
  },
  {
    id: "cycle1-wave88",
    label: "Cycle 1 Wave 88 prompt-explain summary vocabulary alignment",
    prefix: "wave88-prompt-explain-summary-vocabulary-alignment",
  },
  {
    id: "cycle1-wave89",
    label: "Cycle 1 Wave 89 status first-build wording alignment",
    prefix: "wave89-status-first-build-wording-alignment",
  },
  {
    id: "cycle1-wave90",
    label: "Cycle 1 Wave 90 prompt-inspect runtime degradations none surface",
    prefix: "wave90-prompt-inspect-runtime-degradations-none-surface",
  },
  {
    id: "cycle1-wave91",
    label: "Cycle 1 Wave 91 prompt-inspect explain prompt degradations none surface",
    prefix: "wave91-prompt-inspect-explain-prompt-degradations-none-surface",
  },
  {
    id: "cycle1-wave92",
    label: "Cycle 1 Wave 92 status prompt degradations none surface",
    prefix: "wave92-status-prompt-degradations-none-surface",
  },
  {
    id: "cycle1-wave93",
    label: "Cycle 1 Wave 93 status tool runtime guidance precedence",
    prefix: "wave93-status-tool-runtime-guidance-precedence",
  },
  {
    id: "recovery",
    label: "Wave-2 recovery benchmark",
    prefix: "wave2-recovery-gate",
  },
  {
    id: "doctor",
    label: "Wave-8 doctor benchmark",
    prefix: "wave8-doctor-gate",
  },
] as const;

export function renderDirectorAcceptanceUsage(): string {
  return "Usage: hotflow director acceptance [--json] [--help]";
}

export function parseDirectorAcceptanceArgs(
  args: readonly string[],
): ParsedDirectorAcceptanceArgsResult {
  let format: DirectorAcceptanceOutputFormat = "text";
  let help = false;

  for (const token of args) {
    if (token === "--json") {
      format = "json";
      continue;
    }
    if (token === "--help" || token === "-h") {
      help = true;
      continue;
    }
    return {
      ok: false,
      error: `Unknown director acceptance option: ${token}`,
    };
  }

  return {
    ok: true,
    value: {
      format,
      help,
    },
  };
}

export async function runDirectorAcceptance(
  workspaceRoot: string,
  options: { readonly now?: () => string } = {},
): Promise<DirectorAcceptanceReport> {
  const benchmarkResultsDir = join(workspaceRoot, "benchmarks", "results");
  const checks = await Promise.all(
    REQUIRED_GATE_ARTIFACTS.map((artifact) => inspectGateArtifact(benchmarkResultsDir, artifact)),
  );

  return {
    generatedAt: options.now?.() ?? new Date().toISOString(),
    benchmarkResultsDir,
    status: deriveOverallStatus(checks),
    counts: countStatuses(checks),
    checks,
    nextAction: deriveNextAction(checks),
  };
}

export function renderDirectorAcceptanceReport(
  report: DirectorAcceptanceReport,
  format: DirectorAcceptanceOutputFormat = "text",
): string {
  if (format === "json") {
    return `${JSON.stringify(report, null, 2)}\n`;
  }

  const lines = [
    "Director Acceptance",
    "",
    `Status: ${report.status.toUpperCase()}`,
    `Generated: ${report.generatedAt}`,
    `Results dir: ${report.benchmarkResultsDir}`,
    `Totals: ${report.counts.total} checks (${report.counts.pass} pass, ${report.counts.warn} warn, ${report.counts.fail} fail)`,
    `Next action: ${report.nextAction}`,
    "",
    "Checks:",
  ];

  for (const check of report.checks) {
    lines.push(`  [${check.status.toUpperCase()}] ${check.label}: ${check.summary}`);
    if (check.artifactPath !== undefined) {
      lines.push(`    artifact: ${check.artifactPath}`);
    }
    if (check.recordedAt !== undefined) {
      lines.push(`    recorded: ${check.recordedAt}`);
    }
    for (const detail of check.detailLines) {
      lines.push(`    ${detail}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

async function inspectGateArtifact(
  benchmarkResultsDir: string,
  descriptor: GateArtifactDescriptor,
): Promise<DirectorAcceptanceCheck> {
  const artifactPath = await resolveLatestArtifactPath(benchmarkResultsDir, descriptor.prefix);
  if (artifactPath === undefined) {
    return {
      id: descriptor.id,
      label: descriptor.label,
      status: "fail",
      summary: "Benchmark artifact is missing.",
      detailLines: [
        `expected prefix: ${descriptor.prefix}`,
        "next action: run the benchmark and persist a fresh result artifact.",
      ],
    };
  }

  try {
    const [raw, stats] = await Promise.all([readFile(artifactPath, "utf8"), stat(artifactPath)]);
    const parsed = JSON.parse(raw) as unknown;
    const summary = summarizeArtifact(parsed, stats.mtime.toISOString());

    return {
      id: descriptor.id,
      label: descriptor.label,
      status: summary.status,
      summary: summary.summary,
      detailLines: summary.detailLines,
      artifactPath,
      ...(summary.recordedAt === undefined ? {} : { recordedAt: summary.recordedAt }),
    };
  } catch (error) {
    return {
      id: descriptor.id,
      label: descriptor.label,
      status: "fail",
      summary: "Benchmark artifact could not be read.",
      detailLines: [describeUnknownValue(error)],
      artifactPath,
    };
  }
}

async function resolveLatestArtifactPath(
  benchmarkResultsDir: string,
  prefix: string,
): Promise<string | undefined> {
  const exactLatestPath = join(benchmarkResultsDir, `${prefix}-latest.json`);

  try {
    await stat(exactLatestPath);
    return exactLatestPath;
  } catch {
    // Fall back to the latest timestamped artifact.
  }

  let entries: string[];
  try {
    entries = await readdir(benchmarkResultsDir);
  } catch {
    return undefined;
  }

  const candidates = entries
    .filter((entry) => !entry.startsWith("._"))
    .filter((entry) => entry.startsWith(`${prefix}-`) && entry.endsWith(".json"))
    .sort();

  const latestEntry = candidates.at(-1);
  return latestEntry === undefined ? undefined : join(benchmarkResultsDir, latestEntry);
}

function summarizeArtifact(value: unknown, fallbackRecordedAt: string): AcceptanceArtifactSummary {
  const record = asRecord(value);
  if (record === undefined) {
    return {
      status: "fail",
      summary: "Artifact JSON is not an object.",
      detailLines: ["next action: regenerate the artifact with a supported benchmark runner."],
      recordedAt: fallbackRecordedAt,
    };
  }

  const topLevelSummary = summarizeTopLevelGate(record, fallbackRecordedAt);
  if (topLevelSummary !== undefined) {
    return topLevelSummary;
  }

  const benchmarkSuiteSummary = summarizeBenchmarkSuite(record, fallbackRecordedAt);
  if (benchmarkSuiteSummary !== undefined) {
    return benchmarkSuiteSummary;
  }

  return {
    status: "warn",
    summary: "Artifact format is not recognized.",
    detailLines: ["next action: review the benchmark output shape before using it for acceptance."],
    recordedAt: fallbackRecordedAt,
  };
}

function summarizeTopLevelGate(
  record: Readonly<Record<string, unknown>>,
  fallbackRecordedAt: string,
): AcceptanceArtifactSummary | undefined {
  if (typeof record.passed === "boolean" && Array.isArray(record.failures)) {
    const failures = record.failures.filter(
      (failure): failure is string => typeof failure === "string",
    );
    const gateId =
      typeof record.gate === "string"
        ? record.gate
        : typeof record.gateId === "string"
          ? record.gateId
          : "gate";
    const passed = record.passed && failures.length === 0;

    return {
      status: passed ? "pass" : "fail",
      summary: `${gateId} passed=${record.passed ? "true" : "false"} failures=${failures.length}`,
      detailLines: [
        `failures: ${failures.length === 0 ? "(none)" : failures.slice(0, 3).join(" | ")}`,
      ],
      recordedAt: fallbackRecordedAt,
    };
  }

  if (typeof record.status !== "string" || !Array.isArray(record.failures)) {
    return undefined;
  }

  const failures = record.failures.filter(
    (failure): failure is string => typeof failure === "string",
  );
  const commandRuns = Array.isArray(record.commandRuns) ? record.commandRuns.length : 0;
  const gateId = typeof record.gateId === "string" ? record.gateId : "gate";
  const normalizedStatus = normalizeGateStatus(record.status);

  return {
    status: normalizedStatus,
    summary: `${gateId} status=${record.status} failures=${failures.length}`,
    detailLines: [
      `command runs: ${commandRuns}`,
      `failures: ${failures.length === 0 ? "(none)" : failures.slice(0, 3).join(" | ")}`,
    ],
    recordedAt: fallbackRecordedAt,
  };
}

function summarizeBenchmarkSuite(
  record: Readonly<Record<string, unknown>>,
  fallbackRecordedAt: string,
): AcceptanceArtifactSummary | undefined {
  const summary = asRecord(record.summary);
  if (summary === undefined) {
    return undefined;
  }

  if (isFiniteNumber(summary.failedRuns) && isFiniteNumber(summary.totalRuns)) {
    const runs = Array.isArray(record.runs) ? record.runs.map(asRecord).filter(isPresent) : [];
    const failingCaseIds = runs
      .filter((run) => run.ok === false)
      .map((run) => (typeof run.caseId === "string" ? run.caseId : undefined))
      .filter(isPresent);

    return {
      status: summary.failedRuns > 0 ? "fail" : "pass",
      summary: `runs=${summary.totalRuns} failed=${summary.failedRuns}`,
      detailLines: [
        `suite id: ${typeof summary.suiteId === "string" ? summary.suiteId : "(unknown)"}`,
        `failing cases: ${failingCaseIds.length === 0 ? "(none)" : failingCaseIds.slice(0, 5).join(" | ")}`,
      ],
      recordedAt: typeof summary.timestamp === "string" ? summary.timestamp : fallbackRecordedAt,
    };
  }

  if (isFiniteNumber(summary.failed) && isFiniteNumber(summary.total)) {
    const caseResults = Array.isArray(record.caseResults)
      ? record.caseResults.map(asRecord).filter(isPresent)
      : [];
    const failingCaseIds = caseResults
      .filter((caseResult) => caseResult.status !== "passed")
      .map((caseResult) => (typeof caseResult.id === "string" ? caseResult.id : undefined))
      .filter(isPresent);

    return {
      status: summary.failed > 0 ? "fail" : "pass",
      summary: `cases=${summary.total} passed=${isFiniteNumber(summary.passed) ? summary.passed : 0} failed=${summary.failed}`,
      detailLines: [
        `suite id: ${typeof record.suiteId === "string" ? record.suiteId : "(unknown)"}`,
        `failing cases: ${failingCaseIds.length === 0 ? "(none)" : failingCaseIds.slice(0, 5).join(" | ")}`,
      ],
      recordedAt:
        typeof record.generatedAt === "string"
          ? record.generatedAt
          : typeof summary.timestamp === "string"
            ? summary.timestamp
            : fallbackRecordedAt,
    };
  }

  return undefined;
}

function deriveOverallStatus(checks: readonly DirectorAcceptanceCheck[]): DirectorAcceptanceStatus {
  if (checks.some((check) => check.status === "fail")) {
    return "fail";
  }
  if (checks.some((check) => check.status === "warn")) {
    return "warn";
  }
  return "pass";
}

function countStatuses(checks: readonly DirectorAcceptanceCheck[]) {
  return {
    pass: checks.filter((check) => check.status === "pass").length,
    warn: checks.filter((check) => check.status === "warn").length,
    fail: checks.filter((check) => check.status === "fail").length,
    total: checks.length,
  };
}

function deriveNextAction(checks: readonly DirectorAcceptanceCheck[]): string {
  const missingChecks = checks.filter((check) => check.artifactPath === undefined);
  if (missingChecks.length > 0) {
    return "generate the missing benchmark artifacts before boundary review.";
  }
  const failingChecks = checks.filter((check) => check.status === "fail");
  if (failingChecks.length > 0) {
    return "rerun or repair the failing gates before boundary review.";
  }
  if (checks.some((check) => check.status === "warn")) {
    return "review the warned artifacts before boundary review relies on them.";
  }
  return "acceptance evidence is present; boundary review can consume this checklist.";
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isPresent<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function describeUnknownValue(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

function normalizeGateStatus(status: string): DirectorAcceptanceStatus {
  const normalized = status.trim().toLowerCase();
  if (normalized === "pass" || normalized === "passed" || normalized === "ok") {
    return "pass";
  }
  if (normalized === "fail" || normalized === "failed" || normalized === "error") {
    return "fail";
  }
  return "warn";
}
