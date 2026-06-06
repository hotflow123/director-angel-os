import type {
  CliOnboardingDirectorExecutionSummary,
  CliOnboardingNextStep,
  CliOnboardingPluginSummary,
} from "./control-plane.js";
import { type NormalizedDoctorReport, normalizeDoctorReport } from "./doctor.js";

export type OnboardOutputFormat = "json" | "text";
export type OnboardStatus = "pass" | "warn" | "fail";

type ParsedOnboardArgsResult =
  | {
      readonly ok: true;
      readonly value: {
        readonly format: OnboardOutputFormat;
        readonly help: boolean;
      };
    }
  | {
      readonly ok: false;
      readonly error: string;
    };

interface OnboardingControlPlaneResult {
  readonly ok: boolean;
  readonly data?: unknown;
  readonly error?: string;
}

interface OnboardingControlPlaneLike {
  dispatch(action: {
    readonly type: "onboarding";
    readonly sessionId: string;
  }): Promise<OnboardingControlPlaneResult> | OnboardingControlPlaneResult;
}

export interface RunCliOnboardViaControlPlaneOptions {
  readonly controlPlane: OnboardingControlPlaneLike;
  readonly sessionId?: string;
}

export interface NormalizedOnboardingEnvironment {
  readonly profile: string;
  readonly workspaceRoot: string;
  readonly workspaceExists: boolean;
  readonly dataDir: string;
  readonly dataDirExists: boolean;
  readonly sessionDir: string;
  readonly sessionDirExists: boolean;
  readonly sessionDbPath: string;
  readonly effectiveSessionDbPath: string;
  readonly defaultProvider: string;
  readonly defaultModel: string;
  readonly permissionMode: string;
  readonly outputStyle: string;
  readonly responseLanguage: string;
}

export interface NormalizedOnboardingRuntimeSummary {
  readonly providerIds: readonly string[];
  readonly defaultProviderAvailable: boolean;
  readonly internalPlugins: readonly CliOnboardingPluginSummary[];
  readonly approvedSkillSnapshotPath: string;
  readonly approvedSkillCount: number;
  readonly approvedSkillReadError?: string;
}

export interface NormalizedOnboardingDirectorExecutionSummary
  extends CliOnboardingDirectorExecutionSummary {}

export interface NormalizedOnboardingNextStep extends CliOnboardingNextStep {}

export interface NormalizedOnboardingReport {
  readonly sessionId: string;
  readonly status: OnboardStatus;
  readonly summaryText: string;
  readonly environment: NormalizedOnboardingEnvironment;
  readonly runtime: NormalizedOnboardingRuntimeSummary;
  readonly directorExecution: NormalizedOnboardingDirectorExecutionSummary;
  readonly guidance: readonly string[];
  readonly nextSteps: readonly NormalizedOnboardingNextStep[];
  readonly doctor: NormalizedDoctorReport;
}

class OnboardCliError extends Error {
  readonly code: "onboarding_contract_invalid" | "onboarding_run_failed";
  readonly details: readonly string[];

  constructor(code: OnboardCliError["code"], message: string, details: readonly string[] = []) {
    super(message);
    this.name = "OnboardCliError";
    this.code = code;
    this.details = details;
  }
}

export function renderOnboardUsage(): string {
  return "Usage: hotflow onboard [--json] [--help]";
}

export function parseOnboardArgs(args: readonly string[]): ParsedOnboardArgsResult {
  let format: OnboardOutputFormat = "text";
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
      error: `Unknown onboard option: ${String(token)}`,
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

export async function runCliOnboardViaControlPlane(
  options: RunCliOnboardViaControlPlaneOptions,
): Promise<NormalizedOnboardingReport> {
  let dispatchResult: OnboardingControlPlaneResult;
  try {
    dispatchResult = await options.controlPlane.dispatch({
      type: "onboarding",
      sessionId: options.sessionId ?? "operator",
    });
  } catch (error) {
    throw normalizeOnboardFailure(error, "Onboarding control-plane execution failed.");
  }

  if (!dispatchResult.ok) {
    throw new OnboardCliError(
      "onboarding_run_failed",
      "Onboarding control-plane execution failed.",
      [dispatchResult.error ?? "unknown control-plane failure"],
    );
  }

  return normalizeOnboardingReport(dispatchResult.data);
}

export function normalizeOnboardingReport(report: unknown): NormalizedOnboardingReport {
  if (isNormalizedOnboardingReport(report)) {
    return report;
  }

  const candidate = isRecord(report) ? report : {};
  const rawEnvironment = isRecord(candidate.environment) ? candidate.environment : {};
  const rawRuntime = isRecord(candidate.runtime) ? candidate.runtime : {};
  const rawDirectorExecution = isRecord(candidate.directorExecution)
    ? candidate.directorExecution
    : {};
  const rawDoctor = candidate.doctorReport ??
    candidate.doctor ?? {
      status: readOnboardStatus(candidate.status) ?? "warn",
      checks: [],
    };
  const doctor = normalizeDoctorReport(rawDoctor);
  const status = readOnboardStatus(candidate.status) ?? doctor.status;

  return {
    sessionId: readString(candidate.sessionId) ?? "operator",
    status,
    summaryText:
      readString(candidate.summaryText) ??
      readString(candidate.summary) ??
      defaultOnboardingSummary(status),
    environment: {
      profile: readString(rawEnvironment.profile) ?? "development",
      workspaceRoot: readString(rawEnvironment.workspaceRoot) ?? process.cwd(),
      workspaceExists: readBoolean(rawEnvironment.workspaceExists) ?? false,
      dataDir: readString(rawEnvironment.dataDir) ?? "",
      dataDirExists: readBoolean(rawEnvironment.dataDirExists) ?? false,
      sessionDir: readString(rawEnvironment.sessionDir) ?? "",
      sessionDirExists: readBoolean(rawEnvironment.sessionDirExists) ?? false,
      sessionDbPath: readString(rawEnvironment.sessionDbPath) ?? "",
      effectiveSessionDbPath: readString(rawEnvironment.effectiveSessionDbPath) ?? "",
      defaultProvider: readString(rawEnvironment.defaultProvider) ?? "scripted",
      defaultModel: readString(rawEnvironment.defaultModel) ?? "hotflow-phase1",
      permissionMode: readString(rawEnvironment.permissionMode) ?? "ask",
      outputStyle: readString(rawEnvironment.outputStyle) ?? "normal",
      responseLanguage: readString(rawEnvironment.responseLanguage) ?? "follow-user",
    },
    runtime: {
      providerIds: readStringArray(rawRuntime.providerIds),
      defaultProviderAvailable: readBoolean(rawRuntime.defaultProviderAvailable) ?? false,
      internalPlugins: normalizePlugins(rawRuntime.internalPlugins),
      approvedSkillSnapshotPath: readString(rawRuntime.approvedSkillSnapshotPath) ?? "",
      approvedSkillCount: readNumber(rawRuntime.approvedSkillCount) ?? 0,
      ...(() => {
        const approvedSkillReadError = readString(rawRuntime.approvedSkillReadError);
        return approvedSkillReadError === undefined ? {} : { approvedSkillReadError };
      })(),
    },
    directorExecution: normalizeDirectorExecutionSummary(rawDirectorExecution),
    guidance: readStringArray(candidate.guidance),
    nextSteps: normalizeNextSteps(candidate.nextSteps),
    doctor,
  };
}

export function renderOnboardingReport(
  report: NormalizedOnboardingReport | unknown,
  format: OnboardOutputFormat = "text",
): string {
  const normalized = isNormalizedOnboardingReport(report)
    ? report
    : normalizeOnboardingReport(report);

  if (format === "json") {
    return `${JSON.stringify(normalized, null, 2)}\n`;
  }

  const lines = [
    "Hotflow Onboarding",
    "",
    `Status: ${normalized.status.toUpperCase()}`,
    `Summary: ${normalized.summaryText}`,
    "",
    "Environment:",
    `  Profile: ${normalized.environment.profile}`,
    `  Workspace: ${normalized.environment.workspaceRoot}`,
    `  Workspace ready: ${formatYesNo(normalized.environment.workspaceExists)}`,
    `  Data dir: ${normalized.environment.dataDir}`,
    `  Data dir ready: ${formatYesNo(normalized.environment.dataDirExists)}`,
    `  Session dir: ${normalized.environment.sessionDir}`,
    `  Session dir ready: ${formatYesNo(normalized.environment.sessionDirExists)}`,
    `  Session DB (default): ${normalized.environment.sessionDbPath}`,
    `  Session DB (effective): ${normalized.environment.effectiveSessionDbPath}`,
    `  Default provider: ${normalized.environment.defaultProvider}`,
    `  Default model: ${normalized.environment.defaultModel}`,
    `  Permission mode: ${normalized.environment.permissionMode}`,
    `  Output style: ${normalized.environment.outputStyle}`,
    `  Response language: ${normalized.environment.responseLanguage}`,
    "",
    "Runtime:",
    `  Providers: ${joinOrFallback(normalized.runtime.providerIds)}`,
    `  Default provider available: ${formatYesNo(normalized.runtime.defaultProviderAvailable)}`,
    `  Internal plugins: ${normalized.runtime.internalPlugins.length}`,
  ];

  if (normalized.runtime.internalPlugins.length > 0) {
    for (const plugin of normalized.runtime.internalPlugins) {
      lines.push(
        `    - ${plugin.id} (${plugin.kind}) capabilities=${joinOrFallback(plugin.capabilities)}`,
      );
    }
  }

  lines.push(
    `  Approved skills snapshot: ${normalized.runtime.approvedSkillSnapshotPath || "(not configured)"}`,
    `  Approved skills: ${normalized.runtime.approvedSkillCount}`,
  );

  if (normalized.runtime.approvedSkillReadError) {
    lines.push(`  Approved skill read error: ${normalized.runtime.approvedSkillReadError}`);
  }

  lines.push(
    "",
    "Director Execution:",
    `  Status: ${normalized.directorExecution.status.toUpperCase()}`,
    `  Summary: ${normalized.directorExecution.summaryText}`,
  );
  if (normalized.directorExecution.routeSummary) {
    lines.push(`  Route summary: ${normalized.directorExecution.routeSummary}`);
  }
  if (normalized.directorExecution.runId) {
    lines.push(`  Latest run: ${normalized.directorExecution.runId}`);
  }
  if (normalized.directorExecution.reportId) {
    lines.push(`  Latest report: ${normalized.directorExecution.reportId}`);
  }
  if (normalized.directorExecution.runStatus) {
    lines.push(`  Run status: ${normalized.directorExecution.runStatus}`);
  }
  if (normalized.directorExecution.routeCounts.total > 0) {
    lines.push(
      `  Route counts: healthy=${normalized.directorExecution.routeCounts.healthy} degraded=${normalized.directorExecution.routeCounts.degraded} reroutable=${normalized.directorExecution.routeCounts.reroutable} exhausted=${normalized.directorExecution.routeCounts.exhausted} blocked=${normalized.directorExecution.routeCounts.blocked}`,
    );
  }
  if (normalized.directorExecution.nextAction) {
    lines.push(`  Next action: ${normalized.directorExecution.nextAction}`);
  }
  lines.push("  Suggested commands:");
  if (normalized.directorExecution.suggestedCommands.length === 0) {
    lines.push("    (none)");
  } else {
    for (const command of normalized.directorExecution.suggestedCommands) {
      lines.push(`    - ${command}`);
    }
  }

  lines.push(
    "",
    "Doctor:",
    `  Status: ${normalized.doctor.status.toUpperCase()}`,
    `  Totals: ${normalized.doctor.counts.total} checks (${normalized.doctor.counts.pass} pass, ${normalized.doctor.counts.warn} warn, ${normalized.doctor.counts.fail} fail)`,
  );

  if (normalized.doctor.summaryText) {
    lines.push(`  Summary: ${normalized.doctor.summaryText}`);
  }

  for (const check of normalized.doctor.checks) {
    lines.push(`  [${check.status.toUpperCase()}] ${check.id}: ${check.summary}`);
    for (const detail of check.detailLines) {
      lines.push(`    ${detail}`);
    }
  }

  lines.push("", "Guidance:");
  if (normalized.guidance.length === 0) {
    lines.push("  (no extra guidance)");
  } else {
    for (const item of normalized.guidance) {
      lines.push(`  - ${item}`);
    }
  }

  lines.push("", "Next Steps:");
  if (normalized.nextSteps.length === 0) {
    lines.push("  (no next steps)");
  } else {
    normalized.nextSteps.forEach((step, index) => {
      lines.push(`  ${index + 1}. ${step.title}: ${step.command}`);
      lines.push(`     ${step.detail}`);
    });
  }

  return `${lines.join("\n")}\n`;
}

export function renderOnboardingFailure(
  error: unknown,
  format: OnboardOutputFormat = "text",
): string {
  const normalized = normalizeOnboardFailure(error, "Onboarding command failed.");

  if (format === "json") {
    return `${JSON.stringify(
      {
        status: "fail",
        error: {
          code: normalized.code,
          message: normalized.message,
          details: normalized.details,
        },
      },
      null,
      2,
    )}\n`;
  }

  const lines = ["Hotflow Onboarding", "", "Status: FAIL", `Summary: ${normalized.message}`];
  if (normalized.details.length > 0) {
    lines.push("", "Details:");
    for (const detail of normalized.details) {
      lines.push(`  - ${detail}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

function normalizeOnboardFailure(error: unknown, fallbackMessage: string): OnboardCliError {
  if (error instanceof OnboardCliError) {
    return error;
  }
  if (error instanceof Error) {
    return new OnboardCliError("onboarding_run_failed", fallbackMessage, [error.message]);
  }
  return new OnboardCliError("onboarding_run_failed", fallbackMessage, [String(error)]);
}

function normalizePlugins(value: unknown): readonly CliOnboardingPluginSummary[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const plugins: CliOnboardingPluginSummary[] = [];
  for (const item of value) {
    if (!isRecord(item)) {
      continue;
    }
    const id = readString(item.id);
    const kind = readString(item.kind);
    const displayName = readString(item.displayName);
    if (!id || !kind || !displayName) {
      continue;
    }
    plugins.push({
      id,
      kind,
      displayName,
      capabilities: readStringArray(item.capabilities),
    });
  }

  return plugins;
}

function normalizeNextSteps(value: unknown): readonly NormalizedOnboardingNextStep[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const steps: NormalizedOnboardingNextStep[] = [];
  for (const item of value) {
    if (!isRecord(item)) {
      continue;
    }
    const title = readString(item.title);
    const command = readString(item.command);
    const detail = readString(item.detail);
    if (!title || !command || !detail) {
      continue;
    }
    steps.push({
      title,
      command,
      detail,
    });
  }

  return steps;
}

function normalizeDirectorExecutionSummary(
  value: Record<string, unknown>,
): NormalizedOnboardingDirectorExecutionSummary {
  const routeSummary = readString(value.routeSummary);
  const runId = readString(value.runId);
  const reportId = readString(value.reportId);
  const runStatus = readString(value.runStatus);
  const nextAction = readString(value.nextAction);

  return {
    status: readOnboardStatus(value.status) ?? "pass",
    summaryText:
      readString(value.summaryText) ??
      "No persisted director execution report exists yet. / 当前还没有持久化的导演执行报告。",
    ...(routeSummary === undefined ? {} : { routeSummary }),
    ...(runId === undefined ? {} : { runId }),
    ...(reportId === undefined ? {} : { reportId }),
    ...(runStatus === undefined ? {} : { runStatus }),
    ...(nextAction === undefined ? {} : { nextAction }),
    suggestedCommands: readStringArray(value.suggestedCommands),
    routeCounts: normalizeDirectorRouteCounts(value.routeCounts),
  };
}

function normalizeDirectorRouteCounts(
  value: unknown,
): NormalizedOnboardingDirectorExecutionSummary["routeCounts"] {
  const counts = isRecord(value) ? value : {};
  return {
    healthy: readNumber(counts.healthy) ?? 0,
    degraded: readNumber(counts.degraded) ?? 0,
    reroutable: readNumber(counts.reroutable) ?? 0,
    exhausted: readNumber(counts.exhausted) ?? 0,
    blocked: readNumber(counts.blocked) ?? 0,
    total: readNumber(counts.total) ?? 0,
  };
}

function defaultOnboardingSummary(status: OnboardStatus): string {
  if (status === "fail") {
    return "Hotflow found a blocking configuration issue before the first run.";
  }
  if (status === "warn") {
    return "Hotflow can start, but some optional or recommended capabilities need attention.";
  }
  return "Hotflow runtime looks ready. You can run the first prompt now.";
}

function formatYesNo(value: boolean): string {
  return value ? "yes" : "no";
}

function joinOrFallback(values: readonly string[]): string {
  return values.length > 0 ? values.join(", ") : "(none)";
}

function readOnboardStatus(value: unknown): OnboardStatus | undefined {
  if (value === "pass" || value === "warn" || value === "fail") {
    return value;
  }
  return undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNormalizedOnboardingReport(report: unknown): report is NormalizedOnboardingReport {
  if (!isRecord(report)) {
    return false;
  }

  return (
    readOnboardStatus(report.status) !== undefined &&
    isRecord(report.environment) &&
    isRecord(report.runtime) &&
    isRecord(report.directorExecution) &&
    Array.isArray(report.guidance) &&
    Array.isArray(report.nextSteps) &&
    isRecord(report.doctor)
  );
}
