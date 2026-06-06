import { createCliOperatorControlPlane } from "./control-plane-adapter.js";
import { type NormalizedDoctorReport, normalizeDoctorReport } from "./doctor.js";
import {
  type NormalizedOnboardingDirectorExecutionSummary,
  type NormalizedOnboardingEnvironment,
  type NormalizedOnboardingNextStep,
  type NormalizedOnboardingReport,
  type NormalizedOnboardingRuntimeSummary,
  type OnboardStatus,
  normalizeOnboardingReport,
} from "./onboard.js";

export type PreflightOutputFormat = "json" | "text";
export type PreflightReadiness = "ready" | "needs-attention" | "blocked";

type ParsedPreflightArgsResult =
  | {
      readonly ok: true;
      readonly value: {
        readonly format: PreflightOutputFormat;
        readonly help: boolean;
      };
    }
  | {
      readonly ok: false;
      readonly error: string;
    };

interface PreflightControlPlaneResult {
  readonly ok: boolean;
  readonly data?: unknown;
  readonly error?: string;
}

interface PreflightControlPlaneLike {
  dispatch(action: {
    readonly type: "onboarding-status";
    readonly sessionId: string;
  }): Promise<PreflightControlPlaneResult> | PreflightControlPlaneResult;
}

export interface RunCliPreflightViaControlPlaneOptions {
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly sessionId?: string;
  readonly createControlPlane?: (options: {
    readonly cwd?: string;
    readonly env?: NodeJS.ProcessEnv;
  }) => PreflightControlPlaneLike;
}

interface NormalizedPreflightSurface {
  readonly status: OnboardStatus;
  readonly summaryText: string;
}

interface NormalizedPreflightDoctorSurface extends NormalizedPreflightSurface {
  readonly counts: NormalizedDoctorReport["counts"];
}

interface NormalizedPreflightDirectorExecutionSurface extends NormalizedPreflightSurface {
  readonly routeSummary?: string;
  readonly runId?: string;
  readonly reportId?: string;
  readonly runStatus?: string;
  readonly nextAction?: string;
  readonly routeCounts: NormalizedOnboardingDirectorExecutionSummary["routeCounts"];
}

export interface NormalizedPreflightReport {
  readonly sessionId: string;
  readonly status: OnboardStatus;
  readonly readiness: PreflightReadiness;
  readonly summaryText: string;
  readonly recommendedCommand?: string;
  readonly commands: readonly string[];
  readonly environment: NormalizedOnboardingEnvironment;
  readonly runtime: NormalizedOnboardingRuntimeSummary;
  readonly directorExecution: NormalizedOnboardingDirectorExecutionSummary;
  readonly guidance: readonly string[];
  readonly nextSteps: readonly NormalizedOnboardingNextStep[];
  readonly doctor: NormalizedDoctorReport;
  readonly surfaces: {
    readonly environment: NormalizedPreflightSurface;
    readonly doctor: NormalizedPreflightDoctorSurface;
    readonly directorExecution: NormalizedPreflightDirectorExecutionSurface;
  };
}

class PreflightCliError extends Error {
  readonly code: "preflight_contract_invalid" | "preflight_run_failed";
  readonly details: readonly string[];

  constructor(code: PreflightCliError["code"], message: string, details: readonly string[] = []) {
    super(message);
    this.name = "PreflightCliError";
    this.code = code;
    this.details = details;
  }
}

export function renderPreflightUsage(): string {
  return "Usage: hotflow preflight [--json] [--help]";
}

export function parsePreflightArgs(args: readonly string[]): ParsedPreflightArgsResult {
  let format: PreflightOutputFormat = "text";
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
      error: `Unknown preflight option: ${String(token)}`,
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

export async function runCliPreflightViaControlPlane(
  options: RunCliPreflightViaControlPlaneOptions = {},
): Promise<NormalizedPreflightReport> {
  const controlPlane =
    options.createControlPlane?.({
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      ...(options.env === undefined ? {} : { env: options.env }),
    }) ??
    createCliOperatorControlPlane({
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      ...(options.env === undefined ? {} : { env: options.env }),
    });

  let dispatchResult: PreflightControlPlaneResult;
  try {
    dispatchResult = await controlPlane.dispatch({
      type: "onboarding-status",
      sessionId: options.sessionId ?? "operator",
    });
  } catch (error) {
    throw normalizePreflightFailure(error, "Preflight control-plane execution failed.");
  }

  if (!dispatchResult.ok) {
    throw new PreflightCliError(
      "preflight_run_failed",
      "Preflight control-plane execution failed.",
      [dispatchResult.error ?? "unknown control-plane failure"],
    );
  }

  return normalizePreflightReport(dispatchResult.data);
}

export function normalizePreflightReport(report: unknown): NormalizedPreflightReport {
  const normalizedPreflight = readNormalizedPreflightReport(report);
  if (normalizedPreflight) {
    return normalizedPreflight;
  }

  const onboarding = normalizeOnboardingReport(report);
  const commands = collectPreflightCommands(onboarding);

  return {
    sessionId: onboarding.sessionId,
    status: onboarding.status,
    readiness: readPreflightReadiness(onboarding.status),
    summaryText: onboarding.summaryText,
    ...(commands[0] === undefined ? {} : { recommendedCommand: commands[0] }),
    commands,
    environment: onboarding.environment,
    runtime: onboarding.runtime,
    directorExecution: onboarding.directorExecution,
    guidance: onboarding.guidance,
    nextSteps: onboarding.nextSteps,
    doctor: onboarding.doctor,
    surfaces: {
      environment: deriveEnvironmentSurface(onboarding.environment),
      doctor: deriveDoctorSurface(onboarding.doctor),
      directorExecution: deriveDirectorExecutionSurface(onboarding.directorExecution),
    },
  };
}

export function renderPreflightReport(
  report: NormalizedPreflightReport | unknown,
  format: PreflightOutputFormat = "text",
): string {
  const normalized = normalizePreflightReport(report);

  if (format === "json") {
    return `${JSON.stringify(normalized, null, 2)}\n`;
  }

  const lines = [
    "Hotflow Preflight",
    "",
    `Readiness: ${normalized.readiness.toUpperCase()}`,
    `Status: ${normalized.status.toUpperCase()}`,
    `Summary: ${normalized.summaryText}`,
  ];

  if (normalized.recommendedCommand) {
    lines.push(`Recommended command: ${normalized.recommendedCommand}`);
  }

  lines.push(
    "",
    "Environment:",
    `  Status: ${normalized.surfaces.environment.status.toUpperCase()}`,
    `  Summary: ${normalized.surfaces.environment.summaryText}`,
    `  Profile: ${normalized.environment.profile}`,
    `  Workspace: ${normalized.environment.workspaceRoot}`,
    `  Default provider: ${normalized.environment.defaultProvider}`,
    `  Default model: ${normalized.environment.defaultModel}`,
    `  Response language: ${normalized.environment.responseLanguage}`,
  );

  lines.push(
    "",
    "Doctor:",
    `  Status: ${normalized.surfaces.doctor.status.toUpperCase()}`,
    `  Summary: ${normalized.surfaces.doctor.summaryText}`,
    `  Totals: ${normalized.surfaces.doctor.counts.total} checks (${normalized.surfaces.doctor.counts.pass} pass, ${normalized.surfaces.doctor.counts.warn} warn, ${normalized.surfaces.doctor.counts.fail} fail)`,
  );

  lines.push(
    "",
    "Director Execution:",
    `  Status: ${normalized.surfaces.directorExecution.status.toUpperCase()}`,
    `  Summary: ${normalized.surfaces.directorExecution.summaryText}`,
  );

  if (normalized.surfaces.directorExecution.routeSummary) {
    lines.push(`  Route summary: ${normalized.surfaces.directorExecution.routeSummary}`);
  }
  if (normalized.surfaces.directorExecution.nextAction) {
    lines.push(`  Next action: ${normalized.surfaces.directorExecution.nextAction}`);
  }
  if (normalized.surfaces.directorExecution.routeCounts.total > 0) {
    lines.push(
      `  Route counts: healthy=${normalized.surfaces.directorExecution.routeCounts.healthy} degraded=${normalized.surfaces.directorExecution.routeCounts.degraded} reroutable=${normalized.surfaces.directorExecution.routeCounts.reroutable} exhausted=${normalized.surfaces.directorExecution.routeCounts.exhausted} blocked=${normalized.surfaces.directorExecution.routeCounts.blocked}`,
    );
  }

  lines.push("", "Commands:");
  if (normalized.commands.length === 0) {
    lines.push("  (none)");
  } else {
    for (const command of normalized.commands) {
      lines.push(`  - ${command}`);
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

export function renderPreflightFailure(
  error: unknown,
  format: PreflightOutputFormat = "text",
): string {
  const normalized = normalizePreflightFailure(error, "Preflight command failed.");

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

  const lines = ["Hotflow Preflight", "", "Status: FAIL", `Summary: ${normalized.message}`];
  if (normalized.details.length > 0) {
    lines.push("", "Details:");
    for (const detail of normalized.details) {
      lines.push(`  - ${detail}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

function normalizePreflightFailure(error: unknown, fallbackMessage: string): PreflightCliError {
  if (error instanceof PreflightCliError) {
    return error;
  }
  if (error instanceof Error) {
    return new PreflightCliError("preflight_run_failed", fallbackMessage, [error.message]);
  }
  return new PreflightCliError("preflight_run_failed", fallbackMessage, [String(error)]);
}

function readNormalizedPreflightReport(report: unknown): NormalizedPreflightReport | null {
  if (!isRecord(report)) {
    return null;
  }

  const readiness = readPreflightReadinessValue(report.readiness);
  const surfaces = isRecord(report.surfaces) ? report.surfaces : null;
  if (!readiness || surfaces === null) {
    return null;
  }

  const rawDoctor = isRecord(report.doctor)
    ? report.doctor
    : isRecord(report.doctorReport)
      ? report.doctorReport
      : { status: readOnboardStatusValue(report.status) ?? "warn", checks: [] };
  const doctor = normalizeDoctorReport(rawDoctor);
  const onboarding = normalizeOnboardingReport({
    ...report,
    doctor: rawDoctor,
  });
  const environmentSurface = readRecordValue(surfaces, "environment");
  const doctorSurface = readRecordValue(surfaces, "doctor");
  const directorExecutionSurface = readRecordValue(surfaces, "directorExecution");
  const doctorCounts = readRecordValue(doctorSurface, "counts");
  const routeCounts = readRecordValue(directorExecutionSurface, "routeCounts");
  const recommendedCommand = readString(report.recommendedCommand);
  const environmentSummary = readString(readValue(environmentSurface, "summaryText"));
  const doctorStatus = readOnboardStatusValue(readValue(doctorSurface, "status"));
  const doctorSummary = readString(readValue(doctorSurface, "summaryText"));
  const normalizedDoctorCounts = {
    pass: readNumber(readValue(doctorCounts, "pass")) ?? doctor.counts.pass,
    warn: readNumber(readValue(doctorCounts, "warn")) ?? doctor.counts.warn,
    fail: readNumber(readValue(doctorCounts, "fail")) ?? doctor.counts.fail,
    total: readNumber(readValue(doctorCounts, "total")) ?? doctor.counts.total,
  };
  const normalizedDoctorSummary =
    doctorSummary ??
    doctor.summaryText ??
    `${normalizedDoctorCounts.total} checks (${normalizedDoctorCounts.pass} pass, ${normalizedDoctorCounts.warn} warn, ${normalizedDoctorCounts.fail} fail).`;
  const directorExecutionStatus = readOnboardStatusValue(
    readValue(directorExecutionSurface, "status"),
  );
  const directorExecutionSummary = readString(readValue(directorExecutionSurface, "summaryText"));
  const routeSummary = readString(readValue(directorExecutionSurface, "routeSummary"));
  const runId = readString(readValue(directorExecutionSurface, "runId"));
  const reportId = readString(readValue(directorExecutionSurface, "reportId"));
  const runStatus = readString(readValue(directorExecutionSurface, "runStatus"));
  const nextAction = readString(readValue(directorExecutionSurface, "nextAction"));

  return {
    sessionId: onboarding.sessionId,
    status: onboarding.status,
    readiness,
    summaryText: onboarding.summaryText,
    ...(recommendedCommand === undefined ? {} : { recommendedCommand }),
    commands: readStringArray(report.commands),
    environment: onboarding.environment,
    runtime: onboarding.runtime,
    directorExecution: onboarding.directorExecution,
    guidance: onboarding.guidance,
    nextSteps: onboarding.nextSteps,
    doctor: {
      status: doctorStatus ?? doctor.status,
      counts: normalizedDoctorCounts,
      summaryText: normalizedDoctorSummary,
      checks: doctor.checks,
    },
    surfaces: {
      environment: {
        status: readOnboardStatusValue(readValue(environmentSurface, "status")) ?? "warn",
        summaryText: environmentSummary ?? onboarding.summaryText,
      },
      doctor: {
        status: doctorStatus ?? doctor.status,
        summaryText: normalizedDoctorSummary,
        counts: normalizedDoctorCounts,
      },
      directorExecution: {
        status: directorExecutionStatus ?? onboarding.directorExecution.status,
        summaryText: directorExecutionSummary ?? onboarding.directorExecution.summaryText,
        ...(routeSummary === undefined ? {} : { routeSummary }),
        ...(runId === undefined ? {} : { runId }),
        ...(reportId === undefined ? {} : { reportId }),
        ...(runStatus === undefined ? {} : { runStatus }),
        ...(nextAction === undefined ? {} : { nextAction }),
        routeCounts: {
          healthy:
            readNumber(readValue(routeCounts, "healthy")) ??
            onboarding.directorExecution.routeCounts.healthy,
          degraded:
            readNumber(readValue(routeCounts, "degraded")) ??
            onboarding.directorExecution.routeCounts.degraded,
          reroutable:
            readNumber(readValue(routeCounts, "reroutable")) ??
            onboarding.directorExecution.routeCounts.reroutable,
          exhausted:
            readNumber(readValue(routeCounts, "exhausted")) ??
            onboarding.directorExecution.routeCounts.exhausted,
          blocked:
            readNumber(readValue(routeCounts, "blocked")) ??
            onboarding.directorExecution.routeCounts.blocked,
          total:
            readNumber(readValue(routeCounts, "total")) ??
            onboarding.directorExecution.routeCounts.total,
        },
      },
    },
  };
}

function collectPreflightCommands(report: NormalizedOnboardingReport): readonly string[] {
  const commands = [
    ...report.directorExecution.suggestedCommands,
    ...report.nextSteps.map((step) => step.command),
  ];

  return [...new Set(commands.filter((command) => command.trim().length > 0))];
}

function readPreflightReadiness(status: OnboardStatus): PreflightReadiness {
  if (status === "fail") {
    return "blocked";
  }
  if (status === "warn") {
    return "needs-attention";
  }
  return "ready";
}

function deriveEnvironmentSurface(
  environment: NormalizedOnboardingEnvironment,
): NormalizedPreflightSurface {
  if (!environment.workspaceExists) {
    return {
      status: "warn",
      summaryText:
        "Workspace root is not visible yet. Verify HOTFLOW_WORKSPACE_ROOT before the first real run.",
    };
  }

  if (!environment.dataDirExists || !environment.sessionDirExists) {
    return {
      status: "warn",
      summaryText:
        "Workspace is visible, but operator state directories are not fully materialized yet; the first bounded run will create them.",
    };
  }

  return {
    status: "pass",
    summaryText: "Workspace root and operator state paths are visible.",
  };
}

function deriveDoctorSurface(doctor: NormalizedDoctorReport): NormalizedPreflightDoctorSurface {
  return {
    status: doctor.status,
    summaryText:
      doctor.summaryText ??
      `${doctor.counts.total} checks (${doctor.counts.pass} pass, ${doctor.counts.warn} warn, ${doctor.counts.fail} fail).`,
    counts: doctor.counts,
  };
}

function deriveDirectorExecutionSurface(
  directorExecution: NormalizedOnboardingDirectorExecutionSummary,
): NormalizedPreflightDirectorExecutionSurface {
  return {
    status: directorExecution.status,
    summaryText: directorExecution.summaryText,
    ...(directorExecution.routeSummary === undefined
      ? {}
      : { routeSummary: directorExecution.routeSummary }),
    ...(directorExecution.runId === undefined ? {} : { runId: directorExecution.runId }),
    ...(directorExecution.reportId === undefined ? {} : { reportId: directorExecution.reportId }),
    ...(directorExecution.runStatus === undefined
      ? {}
      : { runStatus: directorExecution.runStatus }),
    ...(directorExecution.nextAction === undefined
      ? {}
      : { nextAction: directorExecution.nextAction }),
    routeCounts: directorExecution.routeCounts,
  };
}

function readPreflightReadinessValue(value: unknown): PreflightReadiness | undefined {
  if (value === "ready" || value === "needs-attention" || value === "blocked") {
    return value;
  }
  return undefined;
}

function readRecordValue(
  value: Record<string, unknown> | null,
  key: string,
): Record<string, unknown> | null {
  if (value === null) {
    return null;
  }
  const candidate = value[key];
  return isRecord(candidate) ? candidate : null;
}

function readValue(value: Record<string, unknown> | null, key: string): unknown {
  if (value === null) {
    return undefined;
  }
  return value[key];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
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

function readOnboardStatusValue(value: unknown): OnboardStatus | undefined {
  if (value === "pass" || value === "warn" || value === "fail") {
    return value;
  }
  return undefined;
}
