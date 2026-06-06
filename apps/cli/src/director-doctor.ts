import { constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";
import { join } from "node:path";

import type {
  DirectorRuntimeCapabilitySnapshotResponse,
  RuntimeCapabilityAdapter,
} from "@hotflow/director-host-contracts";
import {
  type DirectorApiProviderAdapter,
  loadDirectorApiProviderConfig,
  loadDirectorSwitchState,
} from "@hotflow/director-runtime";
import { resolveDirectorWorkspace } from "@hotflow/director-workspace";

import { fetchDirectorRuntimeSnapshot } from "./director-evaluate.js";
import { summarizeDirectorRouteHealthForDoctor } from "./director-route-health.js";
import {
  type DirectorExecutionReportSummary,
  type DirectorStatusSummary,
  inspectDirectorStatus,
} from "./director-status.js";

export type DirectorDoctorOutputFormat = "json" | "text";
export type DirectorDoctorStatus = "pass" | "warn" | "fail";

export interface DirectorDoctorCheck {
  readonly id: string;
  readonly status: DirectorDoctorStatus;
  readonly summary: string;
  readonly detailLines: readonly string[];
}

export interface DirectorDoctorReport {
  readonly generatedAt: string;
  readonly status: DirectorDoctorStatus;
  readonly counts: {
    readonly pass: number;
    readonly warn: number;
    readonly fail: number;
    readonly total: number;
  };
  readonly checks: readonly DirectorDoctorCheck[];
}

type ParsedDirectorDoctorArgsResult =
  | {
      readonly ok: true;
      readonly value: {
        readonly format: DirectorDoctorOutputFormat;
        readonly help: boolean;
        readonly hostUrl?: string;
      };
    }
  | {
      readonly ok: false;
      readonly error: string;
    };

interface RuntimeSnapshotResult {
  readonly response?: DirectorRuntimeCapabilitySnapshotResponse;
  readonly error?: string;
}

interface RunDirectorDoctorOptions {
  readonly hostUrl?: string;
  readonly now?: () => string;
  readonly fetchRuntimeSnapshot?: (options?: {
    readonly hostUrl?: string;
  }) => Promise<DirectorRuntimeCapabilitySnapshotResponse>;
}

export function renderDirectorDoctorUsage(): string {
  return "Usage: hotflow director doctor [--host <url>] [--json] [--help]";
}

export function parseDirectorDoctorArgs(args: readonly string[]): ParsedDirectorDoctorArgsResult {
  let format: DirectorDoctorOutputFormat = "text";
  let help = false;
  let hostUrl: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token) {
      continue;
    }

    if (token === "--json") {
      format = "json";
      continue;
    }
    if (token === "--help" || token === "-h") {
      help = true;
      continue;
    }
    if (token === "--host" || token === "--url") {
      const value = args[index + 1];
      if (!value) {
        return { ok: false, error: `Missing value for ${token}.` };
      }
      hostUrl = value;
      index += 1;
      continue;
    }

    return {
      ok: false,
      error: `Unknown director doctor option: ${token}`,
    };
  }

  return {
    ok: true,
    value: {
      format,
      help,
      ...(hostUrl === undefined ? {} : { hostUrl }),
    },
  };
}

export async function runDirectorDoctor(
  workspaceRoot: string,
  options: RunDirectorDoctorOptions = {},
): Promise<DirectorDoctorReport> {
  const generatedAt = options.now?.() ?? new Date().toISOString();
  const [status, workspaceCheck, runtimeSnapshot] = await Promise.all([
    inspectDirectorStatus(workspaceRoot),
    inspectWorkspaceLayout(workspaceRoot),
    loadRuntimeSnapshot(options),
  ]);
  const workspace = resolveDirectorWorkspace({ root: workspaceRoot });
  const switchState = loadDirectorSwitchState(`${workspace.runtime}/switches.json`);
  const apiProviderConfig = loadDirectorApiProviderConfig(join(workspace.root, "providers"));

  const checks: DirectorDoctorCheck[] = [
    workspaceCheck,
    buildRuntimeCheck(runtimeSnapshot),
    buildBridgeCheck(runtimeSnapshot, switchState, apiProviderConfig.document.providers),
    buildChainRouteHealthCheck(status.latestReport),
    buildMemoryCheck(status),
    buildLaneCheck(status),
    buildLatestRunCheck(status.latestReport),
  ];

  return {
    generatedAt,
    status: deriveOverallStatus(checks),
    counts: countStatuses(checks),
    checks,
  };
}

export function renderDirectorDoctorReport(
  report: DirectorDoctorReport,
  format: DirectorDoctorOutputFormat = "text",
): string {
  if (format === "json") {
    return `${JSON.stringify(report, null, 2)}\n`;
  }

  const lines = [
    "Director Doctor",
    "",
    `Status: ${report.status.toUpperCase()}`,
    `Generated: ${report.generatedAt}`,
    `Totals: ${report.counts.total} checks (${report.counts.pass} pass, ${report.counts.warn} warn, ${report.counts.fail} fail)`,
    "",
    "Checks:",
  ];

  for (const check of report.checks) {
    lines.push(`  [${check.status.toUpperCase()}] ${check.id}: ${check.summary}`);
    for (const detail of check.detailLines) {
      lines.push(`    ${detail}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

async function inspectWorkspaceLayout(workspaceRoot: string): Promise<DirectorDoctorCheck> {
  const workspace = resolveDirectorWorkspace({ root: workspaceRoot });
  const requiredPaths = [
    { label: "director root", path: workspace.root },
    { label: "runtime", path: workspace.runtime },
    { label: "knowledge", path: workspace.knowledge },
    { label: "adapters registry", path: workspace.adaptersRegistry },
  ];
  const missing: string[] = [];

  for (const requiredPath of requiredPaths) {
    try {
      await access(requiredPath.path, fsConstants.F_OK);
    } catch {
      missing.push(`${requiredPath.label}=${requiredPath.path}`);
    }
  }

  if (missing.length > 0) {
    return {
      id: "workspace",
      status: "fail",
      summary: "Director workspace layout is incomplete.",
      detailLines: [
        `workspace root: ${workspaceRoot}`,
        `missing paths: ${missing.join(" | ")}`,
        "next action: run `hotflow director bootstrap` before diagnosing runtime lanes.",
      ],
    };
  }

  return {
    id: "workspace",
    status: "pass",
    summary: "Director workspace layout is present.",
    detailLines: [
      `workspace root: ${workspaceRoot}`,
      `runtime: ${workspace.runtime}`,
      `knowledge: ${workspace.knowledge}`,
      `adapters registry: ${workspace.adaptersRegistry}`,
    ],
  };
}

async function loadRuntimeSnapshot(
  options: RunDirectorDoctorOptions,
): Promise<RuntimeSnapshotResult> {
  const fetchRuntimeSnapshot = options.fetchRuntimeSnapshot ?? fetchDirectorRuntimeSnapshot;

  try {
    return {
      response: await fetchRuntimeSnapshot(
        options.hostUrl === undefined ? undefined : { hostUrl: options.hostUrl },
      ),
    };
  } catch (error) {
    return {
      error: describeUnknownValue(error),
    };
  }
}

function buildRuntimeCheck(result: RuntimeSnapshotResult): DirectorDoctorCheck {
  if (result.response === undefined) {
    return {
      id: "runtime",
      status: "fail",
      summary: "Runtime snapshot could not be loaded.",
      detailLines: [
        `error: ${result.error ?? "unknown error"}`,
        "next action: verify the director host API is running and reachable.",
      ],
    };
  }

  const snapshot = result.response.capabilitySnapshot;
  const enabledAdapters = snapshot.adapters.filter((adapter) => adapter.enabled);
  const summary =
    snapshot.status === "ready"
      ? `Runtime snapshot is ready with ${enabledAdapters.length} enabled adapter(s).`
      : snapshot.status === "degraded"
        ? `Runtime snapshot is degraded with ${enabledAdapters.length} enabled adapter(s).`
        : "Runtime snapshot is offline.";

  return {
    id: "runtime",
    status: snapshot.status === "ready" ? "pass" : snapshot.status === "degraded" ? "warn" : "fail",
    summary,
    detailLines: [
      `runtime id: ${result.response.runtimeId}`,
      `snapshot id: ${snapshot.snapshotId}`,
      `captured at: ${snapshot.capturedAt}`,
      `status: ${snapshot.status}`,
      `adapters: ${snapshot.adapters.length}`,
      ...(snapshot.notes && snapshot.notes.length > 0
        ? [`notes: ${snapshot.notes.join(" | ")}`]
        : []),
    ],
  };
}

function buildBridgeCheck(
  result: RuntimeSnapshotResult,
  switchState: ReturnType<typeof loadDirectorSwitchState>,
  apiProviders: readonly DirectorApiProviderAdapter[],
): DirectorDoctorCheck {
  if (result.response === undefined) {
    return {
      id: "bridge",
      status: "fail",
      summary: "Bridge eligibility could not be evaluated without a runtime snapshot.",
      detailLines: [
        `error: ${result.error ?? "unknown error"}`,
        "next action: restore runtime snapshot access first.",
      ],
    };
  }

  const adapters = result.response.capabilitySnapshot.adapters;
  const enabledMediaAdapters = adapters.filter(
    (adapter) => adapter.adapterKind === "media" && adapter.enabled,
  );
  const bridgeCapableAdapters = enabledMediaAdapters.filter(
    (adapter) => adapter.bridge !== undefined,
  );
  const realEligibleAdapters = bridgeCapableAdapters.filter(
    (adapter) =>
      adapter.mockOnly === false &&
      adapter.healthStatus === "ready" &&
      switchState.features["execution.sideEffects.enabled"],
  );
  const configuredMediaApiProviders = apiProviders.filter(isConfiguredMediaApiProvider);
  const detailLines = [
    `execution side effects: ${switchState.features["execution.sideEffects.enabled"] ? "on" : "off"}`,
    `enabled media adapters: ${formatAdapterIds(enabledMediaAdapters)}`,
    `bridge-capable media adapters: ${formatAdapterIds(bridgeCapableAdapters)}`,
    `real-eligible media adapters: ${formatAdapterIds(realEligibleAdapters)}`,
    `configured API media providers: ${formatApiProviderIds(configuredMediaApiProviders)}`,
  ];

  if (enabledMediaAdapters.length === 0) {
    return {
      id: "bridge",
      status: "fail",
      summary: "No enabled media adapter is visible to the director.",
      detailLines,
    };
  }

  if (bridgeCapableAdapters.length === 0) {
    if (configuredMediaApiProviders.length > 0) {
      return {
        id: "bridge",
        status: "warn",
        summary:
          "Configured API media provider exists, but no enabled media adapter exposes the execution bridge contract.",
        detailLines: [
          ...detailLines,
          "next action: register a real execution bridge manifest that translates Director assignments into the configured API provider request shape.",
        ],
      };
    }

    return {
      id: "bridge",
      status: "fail",
      summary: "No enabled media adapter exposes the current real bridge contract.",
      detailLines,
    };
  }

  if (realEligibleAdapters.length === 0) {
    return {
      id: "bridge",
      status: "warn",
      summary: "Bridge-capable media adapters exist, but the lane is currently preview-safe only.",
      detailLines,
    };
  }

  return {
    id: "bridge",
    status: "pass",
    summary: `Real bridge execution is eligible for ${realEligibleAdapters.length} media adapter(s).`,
    detailLines,
  };
}

function isConfiguredMediaApiProvider(provider: DirectorApiProviderAdapter): boolean {
  return (
    provider.enabled &&
    provider.apiKeyConfigured &&
    provider.capabilities.some(
      (capability) => capability === "image_generation" || capability === "video_generation",
    )
  );
}

function buildMemoryCheck(status: DirectorStatusSummary): DirectorDoctorCheck {
  const detailLines = [
    `memory enabled: ${status.memoryEnabled ? "yes" : "no"}`,
    `memory store: ${status.memoryStoreStatus}`,
    `memory records: ${status.memoryRecordCount}`,
    `observation records: ${status.observationRecordCount}`,
    `latest memory ingest: ${status.latestMemoryIngestStatus ?? "(none)"}`,
  ];

  if (status.memoryStoreStatus === "degraded" || status.latestMemoryIngestStatus === "degraded") {
    return {
      id: "memory",
      status: "fail",
      summary: "Observation or memory evidence is degraded.",
      detailLines,
    };
  }

  if (
    !status.memoryEnabled ||
    status.observationRecordCount === 0 ||
    status.latestMemoryIngestStatus === undefined ||
    status.latestMemoryIngestStatus === "disabled"
  ) {
    return {
      id: "memory",
      status: "warn",
      summary: "Observation and memory evidence is available only partially.",
      detailLines,
    };
  }

  return {
    id: "memory",
    status: "pass",
    summary: "Observation and memory evidence is flowing.",
    detailLines,
  };
}

function buildChainRouteHealthCheck(
  latestReport: DirectorExecutionReportSummary | undefined,
): DirectorDoctorCheck {
  if (latestReport === undefined) {
    return {
      id: "chain-route-health",
      status: "warn",
      summary: "No latest execution report is available for chain route diagnosis yet.",
      detailLines: [
        "execution report: (none)",
        "next action: run one bounded director flow so doctor can judge the execution chain health.",
      ],
    };
  }

  if (latestReport.routeHealth === undefined || latestReport.routeHealth.length === 0) {
    return {
      id: "chain-route-health",
      status: "warn",
      summary: "Latest execution report is missing the chain route health snapshot.",
      detailLines: [
        `run id: ${latestReport.runId}`,
        `report id: ${latestReport.reportId}`,
        `run status: ${latestReport.runStatus}`,
        "next action: regenerate the run report with the current route health surface enabled.",
      ],
    };
  }

  const diagnosis = summarizeDirectorRouteHealthForDoctor(latestReport.routeHealth);
  const detailLines = [
    `run id: ${latestReport.runId}`,
    `report id: ${latestReport.reportId}`,
    `run status: ${latestReport.runStatus}`,
    `route counts: healthy=${diagnosis.counts.healthy} degraded=${diagnosis.counts.degraded} reroutable=${diagnosis.counts.reroutable} exhausted=${diagnosis.counts.exhausted} blocked=${diagnosis.counts.blocked}`,
    ...diagnosis.entries.flatMap((entry) => {
      const fragments = [
        `${entry.assignmentId}`,
        `role=${entry.role}`,
        `status=${entry.status}`,
        `verdict=${entry.verdict}`,
        ...(entry.currentRoute === undefined ? [] : [`route=${entry.currentRoute}`]),
        ...(entry.lastBridgeRoute === undefined ? [] : [`last-bridge=${entry.lastBridgeRoute}`]),
        ...(entry.bridgeVerdict === undefined
          ? []
          : entry.bridgeVerdict === "failed"
            ? [
                `bridge=failed${entry.bridgeFailureReason === undefined ? "" : `(${entry.bridgeFailureReason})`}`,
              ]
            : [`bridge=${entry.bridgeVerdict}`]),
        ...(entry.bridgeFailureMessage === undefined
          ? []
          : [`message=${entry.bridgeFailureMessage}`]),
        ...(entry.bridgeStatus === undefined ? [] : [`status=${entry.bridgeStatus}`]),
        ...(entry.retryAllowed === undefined
          ? []
          : [`retry-allowed=${entry.retryAllowed ? "yes" : "no"}`]),
      ];
      return [
        fragments.join(" "),
        `  summary: ${entry.summary}`,
        ...(entry.nextAction === undefined ? [] : [`  next action: ${entry.nextAction}`]),
        ...(entry.rerouteCandidates.length === 0
          ? []
          : [`  reroute candidates: ${entry.rerouteCandidates.join(", ")}`]),
        ...(entry.blockingReason === undefined
          ? []
          : [`  blocking reason: ${entry.blockingReason}`]),
      ];
    }),
  ];

  return {
    id: "chain-route-health",
    status: diagnosis.status,
    summary: diagnosis.summary,
    detailLines,
  };
}

function buildLaneCheck(status: DirectorStatusSummary): DirectorDoctorCheck {
  const detailLines = [
    `proposal lane: ${status.proposalLaneStatus}`,
    `trace proposals: ${status.proposalCount}`,
    `published packs: ${status.publishedCount}`,
    `review queue: ${status.reviewQueueCount}`,
    `candidate ready: ${status.hasCandidate ? "yes" : "no"}`,
  ];

  if (status.proposalLaneStatus === "degraded") {
    return {
      id: "operator-lanes",
      status: "warn",
      summary: "Proposal or knowledge lanes are readable only in a degraded state.",
      detailLines,
    };
  }

  return {
    id: "operator-lanes",
    status: "pass",
    summary: "Proposal and knowledge lanes are readable.",
    detailLines,
  };
}

function buildLatestRunCheck(
  latestReport: DirectorExecutionReportSummary | undefined,
): DirectorDoctorCheck {
  if (latestReport === undefined) {
    return {
      id: "latest-run",
      status: "warn",
      summary: "No persisted execution report is available yet.",
      detailLines: [
        "execution report: (none)",
        "next action: run one bounded director flow and collect its report.",
      ],
    };
  }

  const detailLines = [
    `run id: ${latestReport.runId}`,
    `report id: ${latestReport.reportId}`,
    `run status: ${latestReport.runStatus}`,
    `operator surface: ${latestReport.hasOperatorSurface ? "yes" : "no"}`,
    `director goal: ${latestReport.directorGoal}`,
    ...(latestReport.bridgeVerdict === undefined
      ? []
      : [
          latestReport.bridgeVerdict === "failed" && latestReport.bridgeFailureReason !== undefined
            ? `bridge verdict: failed (${latestReport.bridgeFailureReason})`
            : `bridge verdict: ${latestReport.bridgeVerdict}`,
        ]),
    ...(latestReport.retryable === undefined
      ? []
      : [`retryable: ${latestReport.retryable ? "yes" : "no"}`]),
    ...(latestReport.retryAllowed === undefined
      ? []
      : [`retry allowed: ${latestReport.retryAllowed ? "yes" : "no"}`]),
    ...(latestReport.nextAction === undefined ? [] : [`next action: ${latestReport.nextAction}`]),
  ];

  if (!latestReport.hasOperatorSurface) {
    return {
      id: "latest-run",
      status: "warn",
      summary: "Latest run report exists, but it is missing the new operator-facing surface.",
      detailLines,
    };
  }

  if (latestReport.runStatus === "failed" && latestReport.nextAction === undefined) {
    return {
      id: "latest-run",
      status: "fail",
      summary: "Latest failed run report does not tell the operator what to do next.",
      detailLines,
    };
  }

  if (
    latestReport.runStatus === "failed" &&
    latestReport.bridgeVerdict === "failed" &&
    latestReport.retryable === undefined
  ) {
    return {
      id: "latest-run",
      status: "warn",
      summary: "Latest failed run report is readable, but retry guidance is incomplete.",
      detailLines,
    };
  }

  return {
    id: "latest-run",
    status: "pass",
    summary: "Latest run report is operator-readable.",
    detailLines,
  };
}

function formatAdapterIds(adapters: readonly RuntimeCapabilityAdapter[]): string {
  return adapters.length > 0 ? adapters.map((adapter) => adapter.adapterId).join(", ") : "(none)";
}

function formatApiProviderIds(providers: readonly DirectorApiProviderAdapter[]): string {
  return providers.length > 0 ? providers.map((provider) => provider.id).join(", ") : "(none)";
}

function deriveOverallStatus(checks: readonly DirectorDoctorCheck[]): DirectorDoctorStatus {
  if (checks.some((check) => check.status === "fail")) {
    return "fail";
  }
  if (checks.some((check) => check.status === "warn")) {
    return "warn";
  }
  return "pass";
}

function countStatuses(checks: readonly DirectorDoctorCheck[]): DirectorDoctorReport["counts"] {
  const pass = checks.filter((check) => check.status === "pass").length;
  const warn = checks.filter((check) => check.status === "warn").length;
  const fail = checks.filter((check) => check.status === "fail").length;

  return {
    pass,
    warn,
    fail,
    total: checks.length,
  };
}

function describeUnknownValue(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
