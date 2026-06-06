import { createRuntimeDoctorMempalaceProbe } from "@hotflow/runtime-bootstrap";

import { resolveCliSessionDbPath } from "./bootstrap.js";
import { createCliOperatorControlPlane } from "./control-plane-adapter.js";

export type DoctorOutputFormat = "json" | "text";

type DoctorStatus = "pass" | "warn" | "fail";

interface DoctorCounts {
  readonly pass: number;
  readonly warn: number;
  readonly fail: number;
  readonly total: number;
}

export interface NormalizedDoctorCheck {
  readonly id: string;
  readonly status: DoctorStatus;
  readonly summary: string;
  readonly detailLines: readonly string[];
}

export interface NormalizedDoctorReport {
  readonly status: DoctorStatus;
  readonly counts: DoctorCounts;
  readonly summaryText?: string;
  readonly checks: readonly NormalizedDoctorCheck[];
}

type ParsedDoctorArgsResult =
  | {
      readonly ok: true;
      readonly value: {
        readonly format: DoctorOutputFormat;
        readonly help: boolean;
      };
    }
  | {
      readonly ok: false;
      readonly error: string;
    };

interface DoctorModuleLike {
  readonly runDoctor?: ((input?: unknown) => Promise<unknown>) | ((input?: unknown) => unknown);
  readonly default?: {
    readonly runDoctor?: ((input?: unknown) => Promise<unknown>) | ((input?: unknown) => unknown);
  };
}

export interface RunCliDoctorOptions {
  readonly loadModule?: () => Promise<unknown>;
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly resolveSessionDbPath?: (config: { dataDir: string; sessionDbPath: string }) => string;
}

interface DoctorControlPlaneResult {
  readonly ok: boolean;
  readonly data?: unknown;
  readonly error?: string;
}

interface DoctorControlPlaneLike {
  dispatch(action: {
    readonly type: "doctor";
    readonly sessionId: string;
  }): Promise<DoctorControlPlaneResult> | DoctorControlPlaneResult;
}

export interface RunCliDoctorViaControlPlaneOptions {
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly sessionId?: string;
  readonly createControlPlane?: (options: {
    readonly cwd?: string;
    readonly env?: NodeJS.ProcessEnv;
  }) => DoctorControlPlaneLike;
}

class DoctorCliError extends Error {
  readonly code: "doctor_contract_invalid" | "doctor_module_unavailable" | "doctor_run_failed";
  readonly details: readonly string[];

  constructor(code: DoctorCliError["code"], message: string, details: readonly string[] = []) {
    super(message);
    this.name = "DoctorCliError";
    this.code = code;
    this.details = details;
  }
}

const DOCTOR_PACKAGE_NAME = "@hotflow/doctor";

export function renderDoctorUsage(): string {
  return "Usage: hotflow doctor [--json] [--help]";
}

export function parseDoctorArgs(args: readonly string[]): ParsedDoctorArgsResult {
  let format: DoctorOutputFormat = "text";
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
      error: `Unknown doctor option: ${String(token)}`,
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

export async function loadDoctorModule(): Promise<unknown> {
  try {
    const specifier = DOCTOR_PACKAGE_NAME;
    return await import(specifier);
  } catch (error) {
    throw new DoctorCliError(
      "doctor_module_unavailable",
      `Unable to load ${DOCTOR_PACKAGE_NAME}.`,
      [describeUnknownValue(error)],
    );
  }
}

export async function runCliDoctor(
  options: RunCliDoctorOptions = {},
): Promise<NormalizedDoctorReport> {
  const loadModule = options.loadModule ?? loadDoctorModule;

  let doctorModule: unknown;
  try {
    doctorModule = await loadModule();
  } catch (error) {
    throw normalizeDoctorFailure(error, "Unable to initialize doctor core.");
  }

  const runDoctor = resolveRunDoctor(doctorModule);
  if (!runDoctor) {
    throw new DoctorCliError(
      "doctor_contract_invalid",
      `${DOCTOR_PACKAGE_NAME} does not export runDoctor().`,
    );
  }

  let report: unknown;
  try {
    report = await runDoctor(createDoctorRunOptions(options));
  } catch (error) {
    throw new DoctorCliError("doctor_run_failed", "Doctor core execution failed.", [
      describeUnknownValue(error),
    ]);
  }

  return normalizeDoctorReport(report);
}

export async function runCliDoctorViaControlPlane(
  options: RunCliDoctorViaControlPlaneOptions = {},
): Promise<NormalizedDoctorReport> {
  const controlPlane =
    options.createControlPlane?.({
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      ...(options.env === undefined ? {} : { env: options.env }),
    }) ??
    createCliOperatorControlPlane({
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      ...(options.env === undefined ? {} : { env: options.env }),
    });

  let dispatchResult: DoctorControlPlaneResult;
  try {
    dispatchResult = await controlPlane.dispatch({
      type: "doctor",
      sessionId: options.sessionId ?? "operator",
    });
  } catch (error) {
    throw normalizeDoctorFailure(error, "Doctor control-plane execution failed.");
  }

  if (!dispatchResult.ok) {
    throw new DoctorCliError("doctor_run_failed", "Doctor control-plane execution failed.", [
      dispatchResult.error ?? "unknown control-plane failure",
    ]);
  }

  return normalizeDoctorReport(dispatchResult.data);
}

export function renderDoctorReport(
  report: NormalizedDoctorReport | unknown,
  format: DoctorOutputFormat = "text",
): string {
  const normalized = isNormalizedDoctorReport(report) ? report : normalizeDoctorReport(report);

  if (format === "json") {
    return `${JSON.stringify(normalized, null, 2)}\n`;
  }

  const lines = [
    "Hotflow Doctor",
    "",
    `Status: ${normalized.status.toUpperCase()}`,
    `Totals: ${normalized.counts.total} checks (${normalized.counts.pass} pass, ${normalized.counts.warn} warn, ${normalized.counts.fail} fail)`,
  ];

  if (normalized.summaryText) {
    lines.push(`Summary: ${normalized.summaryText}`);
  }

  lines.push("", "Checks:");

  if (normalized.checks.length === 0) {
    lines.push("  (no checks reported)");
  } else {
    for (const check of normalized.checks) {
      lines.push(`  [${check.status.toUpperCase()}] ${check.id}: ${check.summary}`);
      for (const detail of check.detailLines) {
        lines.push(indentBlock(detail, "    "));
      }
    }
  }

  return `${lines.join("\n")}\n`;
}

export function renderDoctorFailure(error: unknown, format: DoctorOutputFormat = "text"): string {
  const normalized = normalizeDoctorFailure(error, "Doctor command failed.");
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

  const lines = [
    "Hotflow Doctor",
    "",
    "Status: FAIL",
    "Totals: 1 checks (0 pass, 0 warn, 1 fail)",
    "",
    "Checks:",
    `  [FAIL] doctor-cli: ${normalized.message}`,
  ];

  for (const detail of normalized.details) {
    lines.push(indentBlock(detail, "    "));
  }

  return `${lines.join("\n")}\n`;
}

export function normalizeDoctorReport(report: unknown): NormalizedDoctorReport {
  if (!isRecord(report)) {
    return createInvalidReport(
      `Doctor core returned a non-object report. Received: ${describeUnknownValue(report)}`,
    );
  }

  const rawChecks = coerceCheckArray(report);
  const checks = rawChecks.map((check, index) => normalizeDoctorCheck(check, index));
  const summaryCounts = coerceCounts(report.summary);
  const counts =
    checks.length > 0
      ? computeCounts(checks)
      : (summaryCounts ?? {
          pass: 0,
          warn: 0,
          fail: 0,
          total: 0,
        });
  const status =
    coerceDoctorStatus(report.status) ??
    coerceDoctorStatus(report.overall) ??
    coerceDoctorStatus(report.result) ??
    inferOverallStatus(counts);
  const summaryText = coerceSummaryText(report);

  if (!status && checks.length === 0 && !summaryText) {
    return createInvalidReport("Doctor core returned a report without status, summary, or checks.");
  }

  return {
    status: status ?? "pass",
    counts,
    ...(summaryText ? { summaryText } : {}),
    checks,
  };
}

function normalizeDoctorCheck(check: unknown, index: number): NormalizedDoctorCheck {
  if (!isRecord(check)) {
    return {
      id: `check_${index + 1}`,
      status: "fail",
      summary: "Doctor core returned an invalid check entry.",
      detailLines: [`Received: ${describeUnknownValue(check)}`],
    };
  }

  const status =
    coerceDoctorStatus(check.status) ??
    coerceDoctorStatus(check.result) ??
    coerceDoctorStatus(check.level) ??
    "fail";
  const id =
    coerceNonEmptyString(check.id) ??
    coerceNonEmptyString(check.key) ??
    coerceNonEmptyString(check.name) ??
    coerceNonEmptyString(check.code) ??
    coerceNonEmptyString(check.label) ??
    `check_${index + 1}`;
  const summary =
    coerceNonEmptyString(check.summary) ??
    coerceNonEmptyString(check.message) ??
    coerceNonEmptyString(check.description) ??
    coerceNonEmptyString(check.title) ??
    defaultCheckSummary(id, status);
  const detailLines = collectCheckDetailLines(check);

  return {
    id,
    status,
    summary,
    detailLines,
  };
}

function collectCheckDetailLines(check: Record<string, unknown>): readonly string[] {
  const lines: string[] = [];

  for (const key of [
    "detail",
    "details",
    "reason",
    "remediation",
    "context",
    "data",
    "effective",
    "payload",
    "meta",
    "error",
  ] as const) {
    const value = check[key];
    if (value === undefined) {
      continue;
    }
    lines.push(...formatDetailValue(key, value));
  }

  return lines;
}

function formatDetailValue(label: string, value: unknown): readonly string[] {
  if (typeof value === "string") {
    return label === "detail" || label === "details" ? [value] : [`${label}: ${value}`];
  }

  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    return [`${label}: ${String(value)}`];
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return [];
    }
    if (
      (label === "detail" || label === "details") &&
      value.every(
        (item) => typeof item === "string" || typeof item === "number" || typeof item === "boolean",
      )
    ) {
      return value.map((item) => String(item));
    }
    const rendered = safeJsonStringify(value);
    return rendered ? [`${label}: ${rendered}`] : [];
  }

  if (isRecord(value)) {
    const entries = Object.entries(value);
    if (entries.length > 0 && entries.every(([, entryValue]) => isScalar(entryValue))) {
      return entries.map(([key, entryValue]) => `${key}: ${String(entryValue)}`);
    }
    const rendered = safeJsonStringify(value);
    return rendered ? [`${label}: ${rendered}`] : [];
  }

  return [`${label}: ${describeUnknownValue(value)}`];
}

function coerceCheckArray(report: Record<string, unknown>): readonly unknown[] {
  const candidate = report.checks ?? report.results ?? report.items;
  return Array.isArray(candidate) ? candidate : [];
}

function coerceCounts(summary: unknown): DoctorCounts | undefined {
  if (!isRecord(summary)) {
    return undefined;
  }

  const pass = coerceNonNegativeInteger(
    summary.pass ?? summary.passed ?? summary.ok ?? summary.success,
  );
  const warn = coerceNonNegativeInteger(summary.warn ?? summary.warning ?? summary.warnings);
  const fail = coerceNonNegativeInteger(
    summary.fail ?? summary.failed ?? summary.error ?? summary.errors,
  );
  const total = coerceNonNegativeInteger(summary.total);

  if (pass === undefined || warn === undefined || fail === undefined) {
    return undefined;
  }

  return {
    pass,
    warn,
    fail,
    total: total ?? pass + warn + fail,
  };
}

function computeCounts(checks: readonly NormalizedDoctorCheck[]): DoctorCounts {
  let pass = 0;
  let warn = 0;
  let fail = 0;

  for (const check of checks) {
    if (check.status === "pass") {
      pass += 1;
      continue;
    }
    if (check.status === "warn") {
      warn += 1;
      continue;
    }
    fail += 1;
  }

  return {
    pass,
    warn,
    fail,
    total: checks.length,
  };
}

function inferOverallStatus(counts: DoctorCounts): DoctorStatus | undefined {
  if (counts.fail > 0) {
    return "fail";
  }
  if (counts.warn > 0) {
    return "warn";
  }
  if (counts.pass > 0) {
    return "pass";
  }
  return undefined;
}

function coerceSummaryText(report: Record<string, unknown>): string | undefined {
  const topLevel =
    coerceNonEmptyString(report.summaryText) ??
    coerceNonEmptyString(report.message) ??
    coerceNonEmptyString(report.summary);
  if (topLevel) {
    return topLevel;
  }

  if (!isRecord(report.summary)) {
    return undefined;
  }

  return (
    coerceNonEmptyString(report.summary.message) ??
    coerceNonEmptyString(report.summary.text) ??
    coerceNonEmptyString(report.summary.description)
  );
}

function coerceDoctorStatus(value: unknown): DoctorStatus | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  switch (value.toLowerCase()) {
    case "pass":
    case "passed":
    case "ok":
    case "success":
      return "pass";
    case "warn":
    case "warning":
      return "warn";
    case "fail":
    case "failed":
    case "error":
      return "fail";
    default:
      return undefined;
  }
}

function createDoctorRunOptions(options: RunCliDoctorOptions): Record<string, unknown> {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const resolveSessionDbPath =
    options.resolveSessionDbPath ?? ((config) => resolveCliSessionDbPath(config, env));

  return {
    cwd,
    env,
    probeMempalace: createRuntimeDoctorMempalaceProbe({ env }),
    resolveSessionDbPath(input: { config: { dataDir: string; sessionDbPath: string } }): string {
      return resolveSessionDbPath(input.config);
    },
  };
}

function normalizeDoctorFailure(error: unknown, fallbackMessage: string): DoctorCliError {
  if (error instanceof DoctorCliError) {
    return error;
  }

  return new DoctorCliError("doctor_run_failed", fallbackMessage, [describeUnknownValue(error)]);
}

function createInvalidReport(detail: string): NormalizedDoctorReport {
  return {
    status: "fail",
    counts: {
      pass: 0,
      warn: 0,
      fail: 1,
      total: 1,
    },
    checks: [
      {
        id: "doctor-contract",
        status: "fail",
        summary: "Doctor core returned an invalid report.",
        detailLines: [detail],
      },
    ],
  };
}

function isNormalizedDoctorReport(report: unknown): report is NormalizedDoctorReport {
  return (
    isRecord(report) &&
    typeof report.status === "string" &&
    isRecord(report.counts) &&
    Array.isArray(report.checks)
  );
}

function defaultCheckSummary(id: string, status: DoctorStatus): string {
  return `${id} completed with status ${status}.`;
}

function coerceNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function coerceNonNegativeInteger(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    return undefined;
  }
  return value;
}

function resolveRunDoctor(
  doctorModule: unknown,
): ((input?: unknown) => Promise<unknown>) | ((input?: unknown) => unknown) | undefined {
  if (isRecord(doctorModule) && isRunDoctorFunction(doctorModule.runDoctor)) {
    return doctorModule.runDoctor;
  }
  if (
    isRecord(doctorModule) &&
    isRecord(doctorModule.default) &&
    isRunDoctorFunction(doctorModule.default.runDoctor)
  ) {
    return doctorModule.default.runDoctor;
  }
  return undefined;
}

function isRunDoctorFunction(
  value: unknown,
): value is ((input?: unknown) => Promise<unknown>) | ((input?: unknown) => unknown) {
  return typeof value === "function";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isScalar(value: unknown): value is boolean | null | number | string {
  return (
    typeof value === "boolean" ||
    value === null ||
    typeof value === "number" ||
    typeof value === "string"
  );
}

function safeJsonStringify(value: unknown): string | undefined {
  try {
    return JSON.stringify(value, null, 2) ?? undefined;
  } catch {
    return undefined;
  }
}

function describeUnknownValue(value: unknown): string {
  if (value instanceof Error) {
    return value.message;
  }

  if (typeof value === "string") {
    return value;
  }

  const rendered = safeJsonStringify(value);
  return rendered ?? String(value);
}

function indentBlock(block: string, prefix: string): string {
  return block
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}
