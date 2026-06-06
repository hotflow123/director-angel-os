import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { createExternalToolProviderManifest } from "./external-tools.js";
import type {
  ExternalToolDoctorResult,
  ExternalToolDoctorStatus,
  ExternalToolHandlerInvokeOutput,
  ExternalToolHandlerInvokeRequest,
  ExternalToolManifest,
  ExternalToolProviderCapability,
  ExternalToolRegistration,
} from "./external-tools.js";

const execFileAsync = promisify(execFile);
const DEFAULT_OPENCLI_BINARY = "opencli";
const DEFAULT_OPENCLI_TIMEOUT_MS = 60_000;
const DEFAULT_OPENCLI_COMMAND_TIMEOUT_MS = 300_000;
const DEFAULT_OPENCLI_LIST_LIMIT = 50;
const DEFAULT_OPENCLI_EXPOSE_LIMIT = 80;
const OPENCLI_BACKGROUND_WINDOW_MODE = "background";
const OPENCLI_PROFILE_STATUS_OPERATION_ID = "opencli.profile-status";
const DESKTOP_APP_LAUNCH_DENY_RE =
  /moyin-creatorV0\.2\.3|\/Applications\/魔因漫创\.app|com\.manju2026\.moyin-creator|node_modules\/electron\/dist\/Electron\.app|Google Chrome for Testing\.app|chrome-for-testing|angel-chrome|--remote-debugging-port=/iu;

export interface OpenCliManifestArg {
  readonly name: string;
  readonly type?: string;
  readonly default?: unknown;
  readonly required?: boolean;
  readonly positional?: boolean;
  readonly help?: string;
  readonly choices?: readonly string[];
}

export interface OpenCliManifestEntry {
  readonly site: string;
  readonly name: string;
  readonly description: string;
  readonly access: "read" | "write" | (string & {});
  readonly domain?: string;
  readonly strategy?: string;
  readonly browser?: boolean;
  readonly args?: readonly OpenCliManifestArg[];
  readonly columns?: readonly string[];
  readonly type?: string;
  readonly modulePath?: string;
  readonly sourceFile?: string;
  readonly navigateBefore?: boolean | string;
  readonly aliases?: readonly string[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface OpenCliRunnerInput {
  readonly binary: string;
  readonly args: readonly string[];
  readonly timeoutMs?: number;
}

export interface OpenCliRunnerOutput {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly errorCode?: string;
  readonly signal?: NodeJS.Signals | null;
  readonly durationMs?: number;
}

export type OpenCliRunner = (
  input: OpenCliRunnerInput,
) => Promise<OpenCliRunnerOutput> | OpenCliRunnerOutput;

export function createOpenCliRunnerEnvironment(
  baseEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const configuredWindowMode = baseEnv.OPENCLI_WINDOW;
  return {
    ...baseEnv,
    OPENCLI_WINDOW:
      configuredWindowMode === "foreground" ||
      configuredWindowMode === OPENCLI_BACKGROUND_WINDOW_MODE
        ? configuredWindowMode
        : OPENCLI_BACKGROUND_WINDOW_MODE,
  };
}

export interface OpenCliBrowserBridgeProfile {
  readonly id: string;
  readonly connected: boolean;
  readonly version?: string;
  readonly label?: string;
  readonly raw?: string;
}

export interface OpenCliProfileStatus {
  readonly browserBridgeConnected: boolean;
  readonly profileCount: number;
  readonly connectedProfileCount: number;
  readonly profiles: readonly OpenCliBrowserBridgeProfile[];
  readonly nextActions: readonly string[];
  readonly rawText?: string;
  readonly runner?: OpenCliRunnerOutput;
}

export interface OpenCliExternalToolRegistrationOptions {
  readonly toolId?: string;
  readonly label?: string;
  readonly description?: string;
  readonly source?: "built-in" | "external" | "mcp" | "plugin" | (string & {});
  readonly providerId?: string;
  readonly openCliBinary?: string;
  readonly manifestPath?: string;
  readonly manifestEntries?: readonly OpenCliManifestEntry[];
  readonly runner?: OpenCliRunner;
  readonly timeoutMs?: number;
  readonly commandTimeoutMs?: number;
  readonly listLimit?: number;
  readonly maxCommandCapabilities?: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly allowInvokeWhenUnavailable?: boolean;
  readonly denyDesktopAppLaunch?: boolean;
}

export interface OpenCliAdapterFailureRecord {
  readonly url?: string;
  readonly site?: string;
  readonly domain?: string;
  readonly reason: string;
  readonly attemptedTool?: string;
  readonly desiredFields?: readonly string[];
  readonly sourceRef?: string;
}

export interface CreateOpenCliAdapterProposalFromFailuresInput {
  readonly failures: readonly OpenCliAdapterFailureRecord[];
  readonly existingManifestEntries?: readonly OpenCliManifestEntry[];
  readonly repeatedFailureThreshold?: number;
}

export interface OpenCliAdapterProposal {
  readonly schemaVersion: "director.opencli-adapter-proposal.v1";
  readonly status: "proposal";
  readonly source: "repeated-failure";
  readonly requiresApproval: true;
  readonly site: string;
  readonly domain?: string;
  readonly targetUrl: string;
  readonly failureCount: number;
  readonly failureReasons: readonly string[];
  readonly sourceRefs: readonly string[];
  readonly command: {
    readonly name: string;
    readonly description: string;
    readonly access: "read";
    readonly browser: boolean;
    readonly args: readonly OpenCliManifestArg[];
    readonly columns: readonly string[];
    readonly strategy: "public" | "cookie" | "browser";
  };
  readonly risk: {
    readonly level: "low" | "medium" | "high";
    readonly reasons: readonly string[];
  };
  readonly writePolicy: {
    readonly mode: "proposal-only";
    readonly autoWrite: false;
    readonly requiresUserConfirmation: true;
    readonly allowedTargets: readonly ("user-adapter" | "project-plugin")[];
    readonly refuses: readonly string[];
  };
  readonly writeTargets: readonly string[];
  readonly validation: {
    readonly requiredBeforeAvailability: true;
    readonly fixture: {
      readonly url: string;
      readonly args: readonly string[];
      readonly expectedColumns: readonly string[];
    };
    readonly commands: readonly string[];
  };
  readonly experienceRecord: {
    readonly recordAfterSuccessOnly: true;
    readonly verificationStatus: "pending";
    readonly record: {
      readonly site: string;
      readonly command: string;
      readonly fields: readonly string[];
      readonly scenarios: readonly string[];
      readonly validationStatus: "pending";
    };
  };
  readonly authoringGuide: readonly string[];
}

export function createOpenCliAdapterProposalFromFailures(
  input: CreateOpenCliAdapterProposalFromFailuresInput,
): OpenCliAdapterProposal | null {
  const threshold = clampPositiveInteger(input.repeatedFailureThreshold, 2);
  const candidates = input.failures.map(normalizeOpenCliAdapterFailureCandidate).filter(
    (
      candidate,
    ): candidate is {
      readonly site: string;
      readonly domain: string;
      readonly url: string;
      readonly commandName: string;
      readonly reason: string;
      readonly attemptedTool?: string;
      readonly desiredFields: readonly string[];
      readonly sourceRef?: string;
    } => candidate !== null,
  );
  const groups = new Map<
    string,
    {
      readonly site: string;
      readonly domain: string;
      readonly commandName: string;
      readonly failures: typeof candidates;
    }
  >();
  for (const candidate of candidates) {
    const key = `${candidate.site}/${candidate.commandName}`;
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, {
        site: candidate.site,
        domain: candidate.domain,
        commandName: candidate.commandName,
        failures: [candidate],
      });
    } else {
      groups.set(key, {
        ...group,
        failures: [...group.failures, candidate],
      });
    }
  }

  const selected = [...groups.values()]
    .filter((group) => group.failures.length >= threshold)
    .filter((group) => !hasCoveredOpenCliAdapter(group, input.existingManifestEntries ?? []))
    .sort((left, right) => right.failures.length - left.failures.length)[0];
  if (selected === undefined) {
    return null;
  }

  const targetUrl = selected.failures[0]?.url;
  if (targetUrl === undefined) {
    return null;
  }
  const columns = uniqueNonEmptyStrings(
    selected.failures.flatMap((failure) => failure.desiredFields),
  );
  const expectedColumns = columns.length > 0 ? columns : ["title", "text", "url"];
  const browser = selected.failures.some(isBrowserBackedOpenCliAdapterFailure);
  const strategy = browser
    ? selected.failures.some(isAuthOpenCliAdapterFailure)
      ? "cookie"
      : "browser"
    : "public";
  const riskReasons = [
    ...(browser ? ["requires-browser-bridge"] : []),
    ...(selected.failures.some(isAuthOpenCliAdapterFailure)
      ? ["requires-authenticated-session"]
      : []),
    ...(expectedColumns.some((field) => field === "media" || field === "video" || field === "audio")
      ? ["may-contain-media"]
      : []),
  ];
  const riskLevel = riskReasons.length === 0 ? "low" : "medium";
  const sourceRefs = uniqueNonEmptyStrings(
    selected.failures.map((failure) => failure.sourceRef ?? failure.url),
  );
  const failureReasons = uniqueNonEmptyStrings(selected.failures.map((failure) => failure.reason));
  const adapterRef = `${selected.site}/${selected.commandName}`;

  return {
    schemaVersion: "director.opencli-adapter-proposal.v1",
    status: "proposal",
    source: "repeated-failure",
    requiresApproval: true,
    site: selected.site,
    domain: selected.domain,
    targetUrl,
    failureCount: selected.failures.length,
    failureReasons,
    sourceRefs,
    command: {
      name: selected.commandName,
      description: `Read ${selected.domain} ${selected.commandName} with a verified OpenCLI adapter.`,
      access: "read",
      browser,
      args: [
        {
          name: "url",
          type: "str",
          positional: true,
          required: true,
          help: "Target URL to extract.",
        },
      ],
      columns: expectedColumns,
      strategy,
    },
    risk: {
      level: riskLevel,
      reasons: riskReasons,
    },
    writePolicy: {
      mode: "proposal-only",
      autoWrite: false,
      requiresUserConfirmation: true,
      allowedTargets: ["user-adapter", "project-plugin"],
      refuses: [
        "auto-write-user-home",
        "auto-install-plugin",
        "shell-passthrough",
        "mark-available-before-validation",
      ],
    },
    writeTargets: [
      `~/.opencli/clis/${selected.site}/${selected.commandName}.js`,
      `project-plugin:opencli/${selected.site}/${selected.commandName}`,
    ],
    validation: {
      requiredBeforeAvailability: true,
      fixture: {
        url: targetUrl,
        args: [targetUrl],
        expectedColumns,
      },
      commands: [
        `opencli browser recon analyze ${targetUrl}`,
        `opencli browser recon init ${adapterRef}`,
        `opencli browser recon verify ${adapterRef}`,
        "opencli validate",
        `opencli ${selected.site} ${selected.commandName} ${targetUrl} -f json`,
      ],
    },
    experienceRecord: {
      recordAfterSuccessOnly: true,
      verificationStatus: "pending",
      record: {
        site: selected.site,
        command: selected.commandName,
        fields: expectedColumns,
        scenarios: ["repeated-deep-browsing-failure"],
        validationStatus: "pending",
      },
    },
    authoringGuide: [
      "Use OpenCLI recon to inspect the page/API shape.",
      "Create either a user adapter or a project plugin only after user approval.",
      "Validate the adapter with OpenCLI before exposing it as an available tool.",
      "Record the adapter experience only after a successful validation run.",
    ],
  };
}

export function createOpenCliExternalToolRegistration(
  options: OpenCliExternalToolRegistrationOptions = {},
): ExternalToolRegistration {
  const binary = options.openCliBinary ?? DEFAULT_OPENCLI_BINARY;
  const manifestPath = resolveOpenCliManifestPath(options.manifestPath);
  const allEntries = normalizeOpenCliManifestEntries(
    options.manifestEntries ?? loadOpenCliManifestEntries(manifestPath),
  );
  const exposedEntries = allEntries.slice(
    0,
    Math.max(0, options.maxCommandCapabilities ?? DEFAULT_OPENCLI_EXPOSE_LIMIT),
  );
  const runner = options.runner ?? createDefaultOpenCliRunner();
  const guardedRunner =
    options.denyDesktopAppLaunch === false ? runner : createOpenCliDesktopLaunchGuardRunner(runner);
  const timeoutMs = options.timeoutMs ?? DEFAULT_OPENCLI_TIMEOUT_MS;
  const commandTimeoutMs = options.commandTimeoutMs ?? resolveOpenCliCommandTimeoutMs();
  const listLimit = options.listLimit ?? DEFAULT_OPENCLI_LIST_LIMIT;

  const manifest = createExternalToolProviderManifest({
    id: options.toolId ?? "opencli.local",
    label: options.label ?? "OpenCLI",
    description:
      options.description ??
      "Controlled OpenCLI provider for local browser/session adapters and CLI command dispatch.",
    source: options.source ?? "external",
    providerId: options.providerId ?? "opencli",
    sourceTrust: {
      status: "trusted-local-config",
      label: "本机配置",
      reason:
        manifestPath === undefined
          ? "OpenCLI manifest is supplied from runtime configuration."
          : `Loaded from ${manifestPath}.`,
      ...(manifestPath === undefined ? {} : { sourceRef: manifestPath }),
    },
    installPolicy: {
      supported: true,
      defaultMode: "manual",
      requiresApproval: true,
      requiresExplicitExecute: true,
      allowedMethods: ["npm-global", "local-clone", "manifest-config"],
      refuses: ["shell-passthrough", "silent-install", "plugin-auto-install"],
    },
    approvalBoundary: {
      mode: "operator-confirm",
      summary:
        "OpenCLI can reach logged-in browser sessions and local adapters, so write commands stay approval-gated.",
      actionLabels: ["确认", "拒绝"],
      requiresOperator: true,
      riskLevel: "external-navigation",
    },
    capabilities: [
      buildOpenCliCapability("opencli.doctor", "Doctor", {
        readOnly: true,
        metadata: { operation: "doctor" },
      }),
      buildOpenCliCapability(OPENCLI_PROFILE_STATUS_OPERATION_ID, "Profile status", {
        readOnly: true,
        metadata: {
          operation: "profile-status",
          modelToolName: "director.opencli.profile_status",
        },
      }),
      buildOpenCliCapability("opencli.list", "List commands", {
        readOnly: true,
        metadata: { operation: "list", modelToolName: "director.opencli.list" },
      }),
      ...exposedEntries.map((entry) => buildOpenCliCommandCapability(entry)),
    ],
    metadata: {
      openCliBinary: binary,
      openCliManifestPath: manifestPath ?? null,
      openCliCommandCount: allEntries.length,
      openCliManifestCount: allEntries.length,
      openCliExposedCommandCount: exposedEntries.length,
      openCliReadCount: allEntries.filter((entry) => entry.access === "read").length,
      openCliWriteCount: allEntries.filter((entry) => entry.access === "write").length,
      openCliListLimit: listLimit,
      modelToolNames: ["director.opencli.list", "director.opencli.invoke"],
      ...(options.metadata ?? {}),
    },
  });

  return {
    manifest,
    allowInvokeWhenUnavailable: options.allowInvokeWhenUnavailable ?? true,
    check: async () =>
      runOpenCliDoctorProbe({
        binary,
        runner: guardedRunner,
        timeoutMs,
        manifestEntries: allEntries,
        ...(manifestPath === undefined ? {} : { manifestPath }),
      }),
    invoke: async (request) => {
      const capabilityId = request.capability?.id ?? request.operationId ?? "";
      if (capabilityId === "opencli.doctor") {
        const doctor = await runOpenCliDoctorProbe({
          binary,
          runner: guardedRunner,
          timeoutMs,
          manifestEntries: allEntries,
          ...(manifestPath === undefined ? {} : { manifestPath }),
        });
        return createOpenCliDoctorInvokeOutput(doctor);
      }
      if (capabilityId === "opencli.list") {
        return runOpenCliListOperation({
          manifest,
          entries: allEntries,
          request,
          limit: listLimit,
        });
      }
      if (capabilityId === OPENCLI_PROFILE_STATUS_OPERATION_ID) {
        return runOpenCliProfileStatusOperation({
          binary,
          runner: guardedRunner,
          timeoutMs,
        });
      }
      const entry = readOpenCliEntryFromCapability(request.capability);
      if (entry === undefined) {
        return {
          ok: false,
          content: `OpenCLI 命令不存在：${capabilityId || "(unknown)"}`,
          error: "opencli-command-not-found",
        };
      }
      return runOpenCliCommand({
        binary,
        runner: guardedRunner,
        timeoutMs: commandTimeoutMs,
        request,
        entry,
      });
    },
  };
}

function createDefaultOpenCliRunner(): OpenCliRunner {
  return async (input) => {
    const startedAt = Date.now();
    try {
      const { stdout, stderr } = await execFileAsync(input.binary, [...input.args], {
        timeout: input.timeoutMs ?? DEFAULT_OPENCLI_TIMEOUT_MS,
        maxBuffer: 1024 * 1024,
        windowsHide: true,
        env: createOpenCliRunnerEnvironment(),
      });
      return {
        exitCode: 0,
        stdout: String(stdout ?? ""),
        stderr: String(stderr ?? ""),
        durationMs: Date.now() - startedAt,
      };
    } catch (error) {
      return normalizeExecFileError(error, Date.now() - startedAt);
    }
  };
}

function createOpenCliDesktopLaunchGuardRunner(runner: OpenCliRunner): OpenCliRunner {
  return async (input) => {
    const denied = inspectDeniedOpenCliDesktopLaunch(input);
    if (denied !== null) {
      return {
        exitCode: 126,
        stdout: "",
        stderr: denied.message,
        errorCode: denied.reason,
      };
    }
    return runner(input);
  };
}

function inspectDeniedOpenCliDesktopLaunch(input: OpenCliRunnerInput): {
  readonly reason: string;
  readonly message: string;
} | null {
  const commandLine = [input.binary, ...input.args]
    .map((part) => String(part ?? ""))
    .join(" ")
    .normalize("NFC");
  if (!DESKTOP_APP_LAUNCH_DENY_RE.test(commandLine)) {
    return null;
  }
  return {
    reason: "opencli-desktop-app-launch-blocked",
    message:
      "OpenCLI desktop guard blocked a local app/browser launch. Use an already connected Browser Bridge profile or a declared API adapter instead of launching Electron, Moyin, or private Chrome windows.",
  };
}

function normalizeExecFileError(error: unknown, durationMs: number): OpenCliRunnerOutput {
  if (isExecFileError(error)) {
    return {
      exitCode: typeof error.code === "number" ? error.code : null,
      stdout: stringFromUnknown(error.stdout),
      stderr: stringFromUnknown(error.stderr) || stringFromUnknown(error.message),
      ...(typeof error.code === "string" ? { errorCode: error.code } : {}),
      ...(typeof error.signal === "string" ? { signal: error.signal as NodeJS.Signals } : {}),
      durationMs,
    };
  }
  return {
    exitCode: null,
    stdout: "",
    stderr: error instanceof Error ? error.message : String(error),
    errorCode: "opencli-runner-error",
    durationMs,
  };
}

function isExecFileError(error: unknown): error is NodeJS.ErrnoException & {
  stdout?: string | Buffer;
  stderr?: string | Buffer;
  signal?: NodeJS.Signals | null;
} {
  return (
    typeof error === "object" &&
    error !== null &&
    ("stdout" in error || "stderr" in error || "code" in error)
  );
}

function resolveOpenCliManifestPath(manifestPath?: string): string | undefined {
  const candidates = [
    manifestPath,
    process.env.OPENCLI_MANIFEST_PATH,
    resolve(process.cwd(), "cli-manifest.json"),
    resolve(process.cwd(), "参考仓库", "OpenCLI", "cli-manifest.json"),
  ];
  for (const candidate of candidates) {
    if (typeof candidate !== "string" || candidate.trim().length === 0) {
      continue;
    }
    const normalized = candidate.trim();
    if (existsSync(normalized)) {
      return normalized;
    }
  }
  return undefined;
}

function loadOpenCliManifestEntries(
  manifestPath: string | undefined,
): readonly OpenCliManifestEntry[] {
  if (manifestPath === undefined) {
    return [];
  }
  try {
    const raw = readFileSync(manifestPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return normalizeOpenCliManifestEntries(readOpenCliManifestEntries(parsed));
  } catch {
    return [];
  }
}

function readOpenCliManifestEntries(value: unknown): readonly OpenCliManifestEntry[] {
  if (Array.isArray(value)) {
    return value as readonly OpenCliManifestEntry[];
  }
  if (isRecord(value) && Array.isArray(value.commands)) {
    return value.commands as readonly OpenCliManifestEntry[];
  }
  return [];
}

function normalizeOpenCliManifestEntries(
  entries: readonly OpenCliManifestEntry[],
): readonly OpenCliManifestEntry[] {
  const byId = new Map<string, OpenCliManifestEntry>();
  for (const raw of entries) {
    if (!isRecord(raw)) {
      continue;
    }
    const site = normalizeString(raw.site);
    const name = normalizeString(raw.name);
    const description = normalizeString(raw.description);
    const access = normalizeString(raw.access);
    if (!site || !name || !description || (access !== "read" && access !== "write")) {
      continue;
    }
    const entry: OpenCliManifestEntry = {
      site,
      name,
      description,
      access,
      ...(typeof raw.domain === "string" && raw.domain.trim().length > 0
        ? { domain: raw.domain.trim() }
        : {}),
      ...(typeof raw.strategy === "string" && raw.strategy.trim().length > 0
        ? { strategy: raw.strategy.trim() }
        : {}),
      ...(typeof raw.browser === "boolean" ? { browser: raw.browser } : {}),
      ...(Array.isArray(raw.args) ? { args: raw.args as readonly OpenCliManifestArg[] } : {}),
      ...(Array.isArray(raw.columns) ? { columns: raw.columns as readonly string[] } : {}),
      ...(typeof raw.type === "string" && raw.type.trim().length > 0
        ? { type: raw.type.trim() }
        : {}),
      ...(typeof raw.modulePath === "string" && raw.modulePath.trim().length > 0
        ? { modulePath: raw.modulePath.trim() }
        : {}),
      ...(typeof raw.sourceFile === "string" && raw.sourceFile.trim().length > 0
        ? { sourceFile: raw.sourceFile.trim() }
        : {}),
      ...(typeof raw.navigateBefore === "string" || typeof raw.navigateBefore === "boolean"
        ? { navigateBefore: raw.navigateBefore }
        : {}),
      ...(Array.isArray(raw.aliases) ? { aliases: raw.aliases as readonly string[] } : {}),
      ...(isRecord(raw.metadata)
        ? { metadata: raw.metadata as Readonly<Record<string, unknown>> }
        : {}),
    };
    byId.set(`${entry.site}/${entry.name}`, entry);
  }
  return [...byId.values()].sort((left, right) =>
    `${left.site}/${left.name}`.localeCompare(`${right.site}/${right.name}`),
  );
}

async function runOpenCliDoctorProbe(input: {
  readonly binary: string;
  readonly runner: OpenCliRunner;
  readonly timeoutMs: number;
  readonly manifestEntries: readonly OpenCliManifestEntry[];
  readonly manifestPath?: string;
}): Promise<ExternalToolDoctorResult> {
  const versionResult = await input.runner({
    binary: input.binary,
    args: ["--version"],
    timeoutMs: input.timeoutMs,
  });
  if (isMissingBinaryResult(versionResult)) {
    return createOpenCliDoctorResult("missing", `OpenCLI 未安装：找不到 ${input.binary}。`, [
      "npm install -g @jackwener/opencli",
    ]);
  }
  if (versionResult.exitCode !== 0) {
    return createOpenCliDoctorResult(
      "failed",
      `OpenCLI 版本检查失败：${trimOpenCliText(versionResult.stderr || versionResult.stdout) || String(versionResult.exitCode)}`,
      ["检查 opencli 是否可执行"],
      {
        versionProbe: versionResult,
        manifestPath: input.manifestPath ?? null,
      },
    );
  }
  if (input.manifestEntries.length === 0) {
    return createOpenCliDoctorResult(
      "misconfigured",
      "OpenCLI binary is present, but no CLI manifest entries are loaded.",
      input.manifestPath === undefined
        ? ["设置 OPENCLI_MANIFEST_PATH 或写入 cli-manifest.json"]
        : [`检查 ${input.manifestPath} 是否存在且为有效 JSON`],
      {
        versionProbe: versionResult,
        manifestPath: input.manifestPath ?? null,
      },
    );
  }
  let doctorResult = await input.runner({
    binary: input.binary,
    args: ["doctor", "--format", "json"],
    timeoutMs: input.timeoutMs,
  });
  if (
    doctorResult.exitCode !== 0 &&
    /unknown option ['"]?--format|unknown option|unrecognized option/iu.test(
      trimOpenCliText(doctorResult.stderr || doctorResult.stdout),
    )
  ) {
    doctorResult = await input.runner({
      binary: input.binary,
      args: ["doctor"],
      timeoutMs: input.timeoutMs,
    });
  }
  if (doctorResult.exitCode !== 0) {
    const text = trimOpenCliText(doctorResult.stderr || doctorResult.stdout);
    return createOpenCliDoctorResult(
      inferOpenCliDoctorStatusFromText(text),
      text || "OpenCLI doctor failed.",
      inferOpenCliNextActionsFromText(text),
      {
        versionProbe: versionResult,
        doctorProbe: doctorResult,
        manifestPath: input.manifestPath ?? null,
      },
    );
  }
  const parsed = parseOpenCliJson(doctorResult.stdout);
  if (parsed !== null && isRecord(parsed)) {
    const parsedSummary =
      typeof parsed.summary === "string" && parsed.summary.trim().length > 0
        ? parsed.summary.trim()
        : "OpenCLI doctor completed.";
    const parsedStatus = normalizeOpenCliDoctorStatus(parsed.status);
    const status =
      parsedStatus === "ready" && isOpenCliDoctorFailureText(parsedSummary)
        ? inferOpenCliDoctorStatusFromText(parsedSummary)
        : parsedStatus;
    const nextActions = Array.isArray(parsed.nextActions)
      ? parsed.nextActions.filter((value): value is string => typeof value === "string")
      : status === "ready"
        ? []
        : inferOpenCliNextActionsFromText(parsedSummary);
    return createOpenCliDoctorResult(status, parsedSummary, nextActions, {
      versionProbe: versionResult,
      doctorProbe: doctorResult,
      openCliDoctor: parsed,
      manifestPath: input.manifestPath ?? null,
    });
  }
  const text = trimOpenCliText(doctorResult.stdout);
  const status = isOpenCliDoctorFailureText(text)
    ? inferOpenCliDoctorStatusFromText(text)
    : "ready";
  return createOpenCliDoctorResult(
    status,
    text || "OpenCLI is ready.",
    status === "ready" ? [] : inferOpenCliNextActionsFromText(text),
    {
      versionProbe: versionResult,
      doctorProbe: doctorResult,
      manifestPath: input.manifestPath ?? null,
    },
  );
}

function createOpenCliDoctorResult(
  status: ExternalToolDoctorStatus,
  summary: string,
  nextActions: readonly string[],
  details?: Readonly<Record<string, unknown>>,
): ExternalToolDoctorResult {
  return {
    status,
    summary,
    nextActions,
    ...(details === undefined ? {} : { details }),
  };
}

function createOpenCliDoctorInvokeOutput(
  doctor: ExternalToolDoctorResult,
): ExternalToolHandlerInvokeOutput {
  const ok = doctor.status === "ready";
  return {
    ok,
    content: doctor.summary,
    output: doctor,
    ...(ok ? {} : { error: `opencli-doctor-${doctor.status}` }),
    metadata: {
      operation: "doctor",
      status: doctor.status,
    },
  };
}

function inferOpenCliDoctorStatusFromText(text: string): ExternalToolDoctorStatus {
  const normalized = text.toLowerCase();
  if (isOpenCliBrowserBridgeDisconnectedText(text)) {
    return "needs-auth";
  }
  if (
    normalized.includes("auth") ||
    normalized.includes("login") ||
    normalized.includes("browser bridge")
  ) {
    return "needs-auth";
  }
  if (normalized.includes("setup") || normalized.includes("configure")) {
    return "misconfigured";
  }
  if (
    normalized.includes("offline") ||
    normalized.includes("timeout") ||
    normalized.includes("unreachable")
  ) {
    return "unreachable";
  }
  return "failed";
}

function inferOpenCliNextActionsFromText(text: string): readonly string[] {
  const normalized = text.toLowerCase();
  if (isOpenCliBrowserBridgeDisconnectedText(text)) {
    return [
      "安装并启用 OpenCLI Browser Bridge Chrome 扩展",
      "确认浏览器扩展已连接后运行 opencli doctor",
      "如 daemon 状态异常，执行 opencli daemon restart",
    ];
  }
  if (
    normalized.includes("auth") ||
    normalized.includes("login") ||
    normalized.includes("browser bridge")
  ) {
    return ["启动 Browser Bridge 并确认 Chrome 扩展已连接"];
  }
  if (normalized.includes("setup") || normalized.includes("configure")) {
    return ["检查 cli-manifest.json 和 OpenCLI 配置"];
  }
  return ["查看 opencli doctor 输出"];
}

function normalizeOpenCliDoctorStatus(value: unknown): ExternalToolDoctorStatus {
  if (
    value === "ready" ||
    value === "disabled" ||
    value === "failed" ||
    value === "misconfigured" ||
    value === "missing" ||
    value === "needs-auth" ||
    value === "pending" ||
    value === "unreachable"
  ) {
    return value;
  }
  return "ready";
}

function isMissingBinaryResult(result: OpenCliRunnerOutput): boolean {
  return result.errorCode === "ENOENT" || result.exitCode === 127;
}

function isOpenCliDoctorFailureText(text: string): boolean {
  const normalized = text.toLowerCase();
  return (
    /\[(fail|missing|error)\]/iu.test(text) ||
    normalized.includes("not connected") ||
    normalized.includes("failed") ||
    normalized.includes("missing") ||
    normalized.includes("unreachable") ||
    normalized.includes("offline") ||
    normalized.includes("timeout")
  );
}

function isOpenCliBrowserBridgeDisconnectedText(text: string): boolean {
  const normalized = text.toLowerCase();
  return (
    normalized.includes("browser bridge") &&
    (normalized.includes("not connected") ||
      normalized.includes("extension: not connected") ||
      normalized.includes("extension not connected") ||
      normalized.includes("no browser bridge") ||
      normalized.includes("connectivity: failed"))
  );
}

function isOpenCliBrowserBridgeUnavailableDoctor(doctor: ExternalToolDoctorResult): boolean {
  const summary = doctor.summary;
  const nextActions = (doctor.nextActions ?? []).join("\n");
  return (
    doctor.status !== "ready" &&
    (isOpenCliBrowserBridgeDisconnectedText(summary) ||
      isOpenCliBrowserBridgeDisconnectedText(nextActions))
  );
}

function runOpenCliListOperation(input: {
  readonly manifest: ExternalToolManifest;
  readonly entries: readonly OpenCliManifestEntry[];
  readonly request: ExternalToolHandlerInvokeRequest;
  readonly limit: number;
}): ExternalToolHandlerInvokeOutput {
  const query = normalizeOpenCliListArgs(input.request.args);
  const filtered = filterOpenCliEntries(input.entries, query);
  const limit = clampPositiveInteger(query.limit ?? input.limit, input.limit);
  const shown = filtered.slice(0, limit);
  const truncated = filtered.length > shown.length;
  return {
    ok: true,
    content: truncated
      ? `OpenCLI 列出 ${shown.length}/${filtered.length} 条命令。`
      : `OpenCLI 列出 ${shown.length} 条命令。`,
    output: {
      manifestPath: input.manifest.metadata?.openCliManifestPath ?? null,
      count: filtered.length,
      truncated,
      entries: shown,
      query,
    },
    metadata: {
      providerId: input.manifest.providerId ?? "opencli",
      openCliListLimit: input.limit,
    },
  };
}

async function runOpenCliProfileStatusProbe(input: {
  readonly binary: string;
  readonly runner: OpenCliRunner;
  readonly timeoutMs: number;
}): Promise<OpenCliProfileStatus> {
  const result = await Promise.resolve(
    input.runner({
      binary: input.binary,
      args: ["profile", "list"],
      timeoutMs: input.timeoutMs,
    }),
  );
  if (result.exitCode !== 0) {
    const text = trimOpenCliText(result.stderr || result.stdout);
    return {
      browserBridgeConnected: false,
      profileCount: 0,
      connectedProfileCount: 0,
      profiles: [],
      nextActions: [
        "运行 opencli profile list 检查 Browser Bridge profile",
        "确认 OpenCLI Browser Bridge 扩展已连接",
      ],
      ...(text.length > 0 ? { rawText: text } : {}),
      runner: result,
    };
  }

  const status = parseOpenCliProfileStatus(result.stdout);
  return {
    ...status,
    runner: result,
  };
}

async function runOpenCliProfileStatusOperation(input: {
  readonly binary: string;
  readonly runner: OpenCliRunner;
  readonly timeoutMs: number;
}): Promise<ExternalToolHandlerInvokeOutput> {
  const status = await runOpenCliProfileStatusProbe(input);
  const connectedText = status.browserBridgeConnected ? "已连接" : "未连接";
  return {
    ok: true,
    status: "success",
    content: `OpenCLI Browser Bridge ${connectedText} ${status.connectedProfileCount}/${status.profileCount} 个 profile。`,
    output: status,
    metadata: {
      sourceKind: "opencli",
      sourceRef: "opencli:profile/list",
      sourceAccessStatus: status.browserBridgeConnected ? "available" : "unavailable",
      profileCount: status.profileCount,
      connectedProfileCount: status.connectedProfileCount,
      browserBridgeConnected: status.browserBridgeConnected,
      nextActions: status.nextActions,
    },
  };
}

function parseOpenCliProfileStatus(stdout: string): OpenCliProfileStatus {
  const text = trimOpenCliText(stdout);
  const parsed = parseOpenCliJson(text);
  if (parsed !== null) {
    const profiles = parseOpenCliProfileStatusJsonProfiles(parsed);
    const connectedProfileCount = profiles.filter((profile) => profile.connected).length;
    return {
      browserBridgeConnected: connectedProfileCount > 0,
      profileCount: profiles.length,
      connectedProfileCount,
      profiles,
      nextActions: createOpenCliProfileStatusNextActions(profiles),
      ...(text.length > 0 ? { rawText: text } : {}),
    };
  }

  const profiles = parseOpenCliProfileStatusTextProfiles(text);
  const connectedProfileCount = profiles.filter((profile) => profile.connected).length;
  return {
    browserBridgeConnected: connectedProfileCount > 0,
    profileCount: profiles.length,
    connectedProfileCount,
    profiles,
    nextActions: createOpenCliProfileStatusNextActions(profiles),
    ...(text.length > 0 ? { rawText: text } : {}),
  };
}

function parseOpenCliProfileStatusJsonProfiles(
  value: unknown,
): readonly OpenCliBrowserBridgeProfile[] {
  const candidates = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.profiles)
      ? value.profiles
      : isRecord(value) && Array.isArray(value.items)
        ? value.items
        : [];
  return candidates.map(parseOpenCliProfileStatusJsonProfile).filter(isOpenCliBrowserBridgeProfile);
}

function parseOpenCliProfileStatusJsonProfile(value: unknown): OpenCliBrowserBridgeProfile | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = normalizeString(value.id ?? value.profileId ?? value.name ?? value.label);
  if (id.length === 0) {
    return null;
  }
  const status = normalizeString(value.status ?? value.state ?? value.connection).toLowerCase();
  const connected =
    typeof value.connected === "boolean"
      ? value.connected
      : status.includes("connected") && !status.includes("disconnected");
  const version = normalizeOpenCliProfileVersion(value.version);
  const label = normalizeString(value.label ?? value.name);
  return {
    id,
    connected,
    ...(version === undefined ? {} : { version }),
    ...(label.length > 0 && label !== id ? { label } : {}),
  };
}

function parseOpenCliProfileStatusTextProfiles(
  text: string,
): readonly OpenCliBrowserBridgeProfile[] {
  const profiles: OpenCliBrowserBridgeProfile[] = [];
  for (const line of text.split(/\r?\n/u)) {
    const profile = parseOpenCliProfileStatusTextLine(line);
    if (profile !== null) {
      profiles.push(profile);
    }
  }
  return profiles;
}

function parseOpenCliProfileStatusTextLine(line: string): OpenCliBrowserBridgeProfile | null {
  const trimmed = line.trim();
  if (trimmed.length === 0 || /profiles?$/iu.test(trimmed)) {
    return null;
  }
  const withoutBullet = trimmed.replace(/^[\s*•-]+/u, "").trim();
  const match =
    /^(.+?)\s+(?:[—–]|-)\s+(.+)$/u.exec(withoutBullet) ?? /^(\S+)\s+(.+)$/u.exec(withoutBullet);
  if (match === null) {
    return null;
  }
  const id = normalizeString(match[1]);
  const detail = normalizeString(match[2]);
  if (id.length === 0 || detail.length === 0) {
    return null;
  }
  const normalizedDetail = detail.toLowerCase();
  const connected =
    normalizedDetail.includes("connected") && !normalizedDetail.includes("disconnected");
  const version = normalizeOpenCliProfileVersion(detail);
  return {
    id,
    connected,
    ...(version === undefined ? {} : { version }),
    raw: trimmed,
  };
}

function normalizeOpenCliProfileVersion(value: unknown): string | undefined {
  const text = normalizeString(value);
  if (text.length === 0) {
    return undefined;
  }
  const versionMatch = /\bv?(\d+(?:\.\d+){1,3})\b/u.exec(text);
  return versionMatch?.[1];
}

function isOpenCliBrowserBridgeProfile(
  value: OpenCliBrowserBridgeProfile | null,
): value is OpenCliBrowserBridgeProfile {
  return value !== null && value.id.length > 0;
}

function createOpenCliProfileStatusNextActions(
  profiles: readonly OpenCliBrowserBridgeProfile[],
): readonly string[] {
  const hasConnectedProfile = profiles.some((profile) => profile.connected);
  if (hasConnectedProfile) {
    return [
      "如目标站点仍提示未登录，请在对应 OpenCLI Browser Bridge profile 中登录目标站点后重试",
      "或在已登录的系统 Chrome profile 中安装并连接 OpenCLI Browser Bridge，再选择该 profile",
    ];
  }
  return [
    "打开 OpenCLI Browser Bridge profile 并确认扩展已连接",
    "或在已登录的系统 Chrome profile 中安装并连接 OpenCLI Browser Bridge，再选择该 profile",
  ];
}

function formatOpenCliProfileStatusSummary(status: OpenCliProfileStatus): string {
  if (status.profileCount === 0) {
    return "未发现已连接 profile";
  }
  const connectedProfiles = status.profiles.filter((profile) => profile.connected);
  const visibleProfiles = (connectedProfiles.length > 0 ? connectedProfiles : status.profiles)
    .slice(0, 3)
    .map((profile) =>
      profile.version === undefined ? profile.id : `${profile.id} v${profile.version}`,
    );
  const suffix = status.profileCount > visibleProfiles.length ? " 等" : "";
  return `${status.connectedProfileCount}/${status.profileCount} 已连接（${visibleProfiles.join(", ")}${suffix}）`;
}

function runOpenCliCommand(input: {
  readonly binary: string;
  readonly runner: OpenCliRunner;
  readonly timeoutMs: number;
  readonly request: ExternalToolHandlerInvokeRequest;
  readonly entry: OpenCliManifestEntry;
}): Promise<ExternalToolHandlerInvokeOutput> {
  if (
    input.entry.browser === true &&
    isOpenCliBrowserBridgeUnavailableDoctor(input.request.doctor)
  ) {
    return Promise.resolve({
      ok: false,
      status: "unavailable",
      content: [
        `OpenCLI 命令 ${input.entry.site}/${input.entry.name} 需要 Browser Bridge，但当前浏览器扩展未连接。`,
        "请先安装/启用 OpenCLI Browser Bridge Chrome 扩展，并确认 opencli doctor 通过后再重试。",
      ].join("\n"),
      error: "opencli-browser-bridge-not-connected",
      metadata: {
        site: input.entry.site,
        name: input.entry.name,
        sourceKind: "opencli",
        sourceRef: `opencli:${input.entry.site}/${input.entry.name}`,
        sourceAccessStatus: "unavailable",
        doctorStatus: input.request.doctor.status,
        nextActions: input.request.doctor.nextActions ?? [],
      },
    });
  }
  const validation = normalizeOpenCliCommandArgs(input.request.args, input.entry);
  if (!validation.ok) {
    return Promise.resolve({
      ok: false,
      content: validation.message,
      error: validation.error,
    });
  }
  const argv = buildOpenCliArgv(input.entry, validation.params);
  const timeoutMs = resolveOpenCliEntryTimeoutMs(input.entry, input.timeoutMs);
  return Promise.resolve(
    input.runner({
      binary: input.binary,
      args: argv,
      timeoutMs,
    }),
  ).then((result) => {
    if (result.exitCode !== 0) {
      if (isOpenCliSiteAuthRequiredResult(result)) {
        const domain = resolveOpenCliAuthRequiredDomain(input.entry, validation.params, result);
        const nextActions = createOpenCliSiteAuthRequiredNextActions(domain);
        return Promise.resolve(
          runOpenCliProfileStatusProbe({
            binary: input.binary,
            runner: input.runner,
            timeoutMs: Math.min(input.timeoutMs, DEFAULT_OPENCLI_TIMEOUT_MS),
          }),
        ).then((profileStatus) => ({
          ok: false,
          status: "error",
          content: [
            `OpenCLI 已连接，但当前 Browser Bridge profile 未登录 ${domain}。`,
            `当前 OpenCLI profile：${formatOpenCliProfileStatusSummary(profileStatus)}。`,
            "本次未读取到可信正文；媒体、图片、视频或页面内容不能当作结论。",
            `下一步：${nextActions.join("；")}`,
          ].join("\n"),
          error: "opencli-site-auth-required",
          metadata: {
            site: input.entry.site,
            name: input.entry.name,
            domain,
            argv,
            timeoutMs,
            runner: result,
            sourceKind: "opencli",
            sourceRef: `opencli:${input.entry.site}/${input.entry.name}`,
            sourceAccessStatus: "auth_required",
            authRequired: true,
            profileStatusOperationId: OPENCLI_PROFILE_STATUS_OPERATION_ID,
            openCliProfileStatus: profileStatus,
            nextActions,
          },
        }));
      }
      if (isOpenCliBrowserSessionUnavailableResult(input.entry, result)) {
        const domain = resolveOpenCliAuthRequiredDomain(input.entry, validation.params, result);
        const nextActions = createOpenCliBrowserSessionUnavailableNextActions(domain);
        return Promise.resolve(
          runOpenCliProfileStatusProbe({
            binary: input.binary,
            runner: input.runner,
            timeoutMs: Math.min(input.timeoutMs, DEFAULT_OPENCLI_TIMEOUT_MS),
          }),
        ).then((profileStatus) => ({
          ok: false,
          status: "unavailable",
          content: [
            `OpenCLI 预导航到 ${domain} 被浏览器会话拒绝。`,
            `当前 OpenCLI profile：${formatOpenCliProfileStatusSummary(profileStatus)}。`,
            "本次未读取到可信正文；媒体、图片、视频或页面内容不能当作结论。",
            `下一步：${nextActions.join("；")}`,
          ].join("\n"),
          error: "opencli-browser-session-unavailable",
          metadata: {
            site: input.entry.site,
            name: input.entry.name,
            domain,
            argv,
            timeoutMs,
            runner: result,
            sourceKind: "opencli",
            sourceRef: `opencli:${input.entry.site}/${input.entry.name}`,
            sourceAccessStatus: "unavailable",
            browserSessionUnavailable: true,
            profileStatusOperationId: OPENCLI_PROFILE_STATUS_OPERATION_ID,
            openCliProfileStatus: profileStatus,
            nextActions,
          },
        }));
      }
      const error =
        result.errorCode ??
        trimOpenCliText(result.stderr || result.stdout) ??
        `exit code ${String(result.exitCode ?? "null")}`;
      return {
        ok: false,
        content: `OpenCLI 命令执行失败：${input.entry.site}/${input.entry.name}`,
        error,
        metadata: {
          site: input.entry.site,
          name: input.entry.name,
          argv,
          timeoutMs,
          runner: result,
          sourceKind: "opencli",
          sourceRef: `opencli:${input.entry.site}/${input.entry.name}`,
          sourceAccessStatus: "failed",
        },
      };
    }
    const parsed = parseOpenCliJson(result.stdout);
    const outputPreview = formatOpenCliOutputPreview(
      parsed === null ? trimOpenCliText(result.stdout) : parsed,
    );
    return {
      ok: true,
      content: [
        `OpenCLI 执行完成：${input.entry.site}/${input.entry.name}`,
        ...(outputPreview.length === 0 ? [] : [`结果预览：${outputPreview}`]),
      ].join("\n"),
      output: {
        argv,
        timeoutMs,
        site: input.entry.site,
        name: input.entry.name,
        entry: input.entry,
        exitCode: result.exitCode,
        durationMs: result.durationMs,
        stderr: trimOpenCliText(result.stderr),
        ...(parsed === null ? { text: trimOpenCliText(result.stdout) } : { json: parsed }),
      },
      metadata: {
        site: input.entry.site,
        name: input.entry.name,
        argv,
        timeoutMs,
        runner: result,
        sourceKind: "opencli",
        sourceRef: `opencli:${input.entry.site}/${input.entry.name}`,
        sourceAccessStatus: "available",
      },
    };
  });
}

function isOpenCliBrowserSessionUnavailableResult(
  entry: OpenCliManifestEntry,
  result: OpenCliRunnerOutput,
): boolean {
  if (entry.browser !== true) {
    return false;
  }
  const text = `${result.errorCode ?? ""}\n${result.stderr}\n${result.stdout}`.toLowerCase();
  return (
    text.includes("pre-navigation") &&
    (text.includes("navigation rejected") ||
      text.includes("browser extension is running") ||
      text.includes("extension is running"))
  );
}

function isOpenCliSiteAuthRequiredResult(result: OpenCliRunnerOutput): boolean {
  const text = `${result.errorCode ?? ""}\n${result.stderr}\n${result.stdout}`.toLowerCase();
  return (
    result.exitCode === 77 ||
    /\bauth[_-]?required\b/iu.test(text) ||
    text.includes("not logged into") ||
    text.includes("no ct0 cookie") ||
    text.includes("please open chrome") ||
    text.includes("please open chromium")
  );
}

function resolveOpenCliAuthRequiredDomain(
  entry: OpenCliManifestEntry,
  params: Readonly<Record<string, unknown>>,
  result: OpenCliRunnerOutput,
): string {
  const declaredDomain = normalizeOpenCliAdapterDomain(entry.domain);
  if (declaredDomain.length > 0) {
    return declaredDomain;
  }
  const text = `${result.stderr}\n${result.stdout}`;
  const loggedOutMatch = /not logged into\s+([a-z0-9.-]+\.[a-z]{2,})/iu.exec(text);
  if (loggedOutMatch?.[1] !== undefined) {
    return normalizeOpenCliAdapterDomain(loggedOutMatch[1]);
  }
  const urlDomain = Object.values(params)
    .map((value) => parseOpenCliFailureUrl(value)?.hostname)
    .map(normalizeOpenCliAdapterDomain)
    .find((domain) => domain.length > 0);
  if (urlDomain !== undefined) {
    return urlDomain;
  }
  return entry.site;
}

function createOpenCliSiteAuthRequiredNextActions(domain: string): readonly string[] {
  return [
    `在 OpenCLI 桥接浏览器中登录 ${domain} 后重试`,
    "或在已登录的系统 Chrome profile 中安装并连接 OpenCLI Browser Bridge，再选择该 profile",
    "未授权前只能把公共 DOM 兜底结果标注为非登录深读",
  ];
}

function createOpenCliBrowserSessionUnavailableNextActions(domain: string): readonly string[] {
  return [
    `检查当前 OpenCLI profile 是否能打开 ${domain}`,
    "运行 opencli.profile-status 查看 Browser Bridge profile",
    "必要时重连 OpenCLI Browser Bridge，或切换到已登录且扩展连接的 Chrome profile",
  ];
}

function normalizeOpenCliCommandArgs(
  args: Readonly<Record<string, unknown>> | undefined,
  entry: OpenCliManifestEntry,
):
  | {
      readonly ok: true;
      readonly params: Readonly<Record<string, unknown>>;
    }
  | {
      readonly ok: false;
      readonly error: string;
      readonly message: string;
    } {
  const params = args ?? {};
  const allowed = new Set((entry.args ?? []).map((arg) => arg.name));
  const extraKeys = Object.keys(params).filter((key) => !allowed.has(key));
  if (extraKeys.length > 0) {
    return {
      ok: false,
      error: "opencli-invalid-args",
      message: `OpenCLI 命令 ${entry.site}/${entry.name} 不接受这些参数：${extraKeys.join(", ")}`,
    };
  }
  for (const arg of entry.args ?? []) {
    const value = params[arg.name];
    if (arg.required === true && (value === undefined || value === null || value === "")) {
      return {
        ok: false,
        error: "opencli-invalid-args",
        message: `OpenCLI 命令 ${entry.site}/${entry.name} 需要参数 ${arg.name}。`,
      };
    }
    if (
      value !== undefined &&
      value !== null &&
      arg.choices !== undefined &&
      arg.choices.length > 0
    ) {
      const stringValue = String(value);
      if (!arg.choices.map(String).includes(stringValue)) {
        return {
          ok: false,
          error: "opencli-invalid-args",
          message: `OpenCLI 参数 ${arg.name} 必须是：${arg.choices.join(", ")}。`,
        };
      }
    }
  }
  return { ok: true, params };
}

function buildOpenCliArgv(
  entry: OpenCliManifestEntry,
  params: Readonly<Record<string, unknown>>,
): readonly string[] {
  const argv = [entry.site, entry.name];
  const positionalArgs = (entry.args ?? []).filter((arg) => arg.positional === true);
  const flagArgs = (entry.args ?? []).filter((arg) => arg.positional !== true);

  for (const arg of positionalArgs) {
    const value = params[arg.name];
    if (value === undefined || value === null || value === "") {
      continue;
    }
    argv.push(coerceOpenCliArgValue(arg, value));
  }
  for (const arg of flagArgs) {
    const value = params[arg.name];
    if (value === undefined || value === null || value === "") {
      continue;
    }
    if (isBooleanArg(arg)) {
      argv.push(`--${arg.name}`, coerceOpenCliBooleanValue(value) ? "true" : "false");
      continue;
    }
    argv.push(`--${arg.name}`, coerceOpenCliArgValue(arg, value));
  }
  argv.push("--format", "json");
  return argv;
}

function resolveOpenCliCommandTimeoutMs(): number {
  return clampPositiveInteger(
    process.env.OPENCLI_COMMAND_TIMEOUT_MS,
    DEFAULT_OPENCLI_COMMAND_TIMEOUT_MS,
  );
}

function resolveOpenCliEntryTimeoutMs(entry: OpenCliManifestEntry, fallback: number): number {
  if (isLongRunningOpenCliEntry(entry)) {
    return fallback;
  }
  return Math.min(fallback, DEFAULT_OPENCLI_TIMEOUT_MS);
}

function isLongRunningOpenCliEntry(entry: OpenCliManifestEntry): boolean {
  const name = entry.name.trim().toLowerCase();
  const type = entry.type?.trim().toLowerCase();
  const description = entry.description.trim().toLowerCase();
  return (
    name === "download" ||
    name === "export" ||
    name.includes("download") ||
    name.includes("export") ||
    type === "download" ||
    type === "export" ||
    description.includes("下载") ||
    description.includes("导出") ||
    description.includes("download") ||
    description.includes("export")
  );
}

function coerceOpenCliArgValue(arg: OpenCliManifestArg, value: unknown): string {
  if (arg.type === "int" || arg.type === "number") {
    const num = Number(value);
    if (Number.isNaN(num)) {
      throw new Error(`OpenCLI 参数 ${arg.name} 需要数字。`);
    }
    return String(num);
  }
  if (isBooleanArg(arg)) {
    return coerceOpenCliBooleanValue(value) ? "true" : "false";
  }
  return Array.isArray(value) ? value.map((item) => String(item)).join(",") : String(value);
}

function isBooleanArg(arg: OpenCliManifestArg): boolean {
  return arg.type === "bool" || arg.type === "boolean";
}

function coerceOpenCliBooleanValue(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1") {
      return true;
    }
    if (normalized === "false" || normalized === "0") {
      return false;
    }
  }
  return Boolean(value);
}

function normalizeOpenCliListArgs(args: Readonly<Record<string, unknown>> | undefined): {
  readonly query?: string;
  readonly site?: string;
  readonly access?: string;
  readonly limit?: number;
} {
  if (args === undefined) {
    return {};
  }
  const query: {
    query?: string;
    site?: string;
    access?: string;
    limit?: number;
  } = {};
  if (typeof args.query === "string") {
    query.query = args.query;
  }
  if (typeof args.site === "string") {
    query.site = args.site;
  }
  if (typeof args.access === "string") {
    query.access = args.access;
  }
  const rawLimit =
    typeof args.limit === "number"
      ? args.limit
      : typeof args.limit === "string"
        ? Number(args.limit)
        : undefined;
  if (typeof rawLimit === "number" && Number.isFinite(rawLimit)) {
    query.limit = rawLimit;
  }
  return query;
}

function normalizeOpenCliAdapterFailureCandidate(failure: OpenCliAdapterFailureRecord): {
  readonly site: string;
  readonly domain: string;
  readonly url: string;
  readonly commandName: string;
  readonly reason: string;
  readonly attemptedTool?: string;
  readonly desiredFields: readonly string[];
  readonly sourceRef?: string;
} | null {
  const parsedUrl = parseOpenCliFailureUrl(failure.url ?? failure.sourceRef);
  const domain = normalizeOpenCliAdapterDomain(failure.domain ?? parsedUrl?.hostname);
  const site = normalizeOpenCliAdapterSite(failure.site ?? domain);
  const url = parsedUrl?.href ?? normalizeString(failure.url ?? failure.sourceRef);
  const reason = normalizeString(failure.reason);
  if (!site || !domain || !url || !reason) {
    return null;
  }
  return {
    site,
    domain,
    url,
    commandName: inferOpenCliAdapterCommandName(parsedUrl),
    reason,
    ...(typeof failure.attemptedTool === "string" && failure.attemptedTool.trim().length > 0
      ? { attemptedTool: failure.attemptedTool.trim() }
      : {}),
    desiredFields: uniqueNonEmptyStrings(failure.desiredFields ?? []),
    ...(typeof failure.sourceRef === "string" && failure.sourceRef.trim().length > 0
      ? { sourceRef: failure.sourceRef.trim() }
      : {}),
  };
}

function parseOpenCliFailureUrl(value: unknown): URL | null {
  const text = normalizeString(value);
  if (text.length === 0) {
    return null;
  }
  try {
    return new URL(text);
  } catch {
    return null;
  }
}

function normalizeOpenCliAdapterDomain(value: unknown): string {
  const raw = normalizeString(value).toLowerCase();
  if (raw.length === 0) {
    return "";
  }
  return raw.replace(/^www\./u, "");
}

function normalizeOpenCliAdapterSite(value: unknown): string {
  const domain = normalizeOpenCliAdapterDomain(value);
  if (domain.length === 0) {
    return "";
  }
  const parts = domain.split(".").filter(Boolean);
  const significantParts = parts.length <= 2 ? parts.slice(0, 1) : parts.slice(0, -1);
  return toOpenCliSlug(significantParts.join("-"));
}

function inferOpenCliAdapterCommandName(url: URL | null): string {
  if (url === null) {
    return "page-detail";
  }
  const segments = url.pathname
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);
  const detailSegment = [...segments]
    .reverse()
    .find((segment) => !isIdLikeOpenCliPathSegment(segment));
  if (detailSegment !== undefined) {
    return `${toOpenCliSlug(detailSegment)}-detail`;
  }
  const idKey = [...url.searchParams.keys()].find((key) => /(^id$|_id$|-id$)/iu.test(key));
  if (idKey !== undefined) {
    return `${toOpenCliSlug(idKey.replace(/[_-]?id$/iu, "") || "item")}-detail`;
  }
  return "page-detail";
}

function isIdLikeOpenCliPathSegment(segment: string): boolean {
  const normalized = segment.trim();
  return (
    /^\d{4,}$/u.test(normalized) ||
    /^[a-f0-9]{8,}$/iu.test(normalized) ||
    /^[A-Z]{1,4}\d[A-Za-z0-9_-]{6,}$/u.test(normalized)
  );
}

function isBrowserBackedOpenCliAdapterFailure(failure: {
  readonly reason: string;
  readonly attemptedTool?: string;
  readonly desiredFields: readonly string[];
}): boolean {
  const haystack = [failure.reason, failure.attemptedTool ?? "", ...failure.desiredFields]
    .join(" ")
    .toLowerCase();
  return (
    haystack.includes("browser") ||
    haystack.includes("session") ||
    haystack.includes("cookie") ||
    haystack.includes("media") ||
    haystack.includes("video") ||
    haystack.includes("audio") ||
    haystack.includes("truncated")
  );
}

function isAuthOpenCliAdapterFailure(failure: {
  readonly reason: string;
  readonly attemptedTool?: string;
}): boolean {
  const haystack = [failure.reason, failure.attemptedTool ?? ""].join(" ").toLowerCase();
  return (
    haystack.includes("auth") ||
    haystack.includes("login") ||
    haystack.includes("cookie") ||
    haystack.includes("session")
  );
}

function hasCoveredOpenCliAdapter(
  candidate: { readonly site: string; readonly domain: string; readonly commandName: string },
  entries: readonly OpenCliManifestEntry[],
): boolean {
  return normalizeOpenCliManifestEntries(entries).some((entry) => {
    const entryDomain = normalizeOpenCliAdapterDomain(entry.domain);
    return (
      (normalizeOpenCliAdapterSite(entry.site) === candidate.site &&
        entry.name === candidate.commandName) ||
      (entryDomain === candidate.domain && entry.name === candidate.commandName)
    );
  });
}

function uniqueNonEmptyStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
}

function toOpenCliSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

function filterOpenCliEntries(
  entries: readonly OpenCliManifestEntry[],
  query: { readonly query?: string; readonly site?: string; readonly access?: string },
): readonly OpenCliManifestEntry[] {
  const normalizedQuery = query.query?.trim().toLowerCase();
  const normalizedSite = query.site?.trim().toLowerCase();
  const normalizedAccess = query.access?.trim().toLowerCase();
  return entries.filter((entry) => {
    if (normalizedSite !== undefined && entry.site.toLowerCase() !== normalizedSite) {
      return false;
    }
    if (normalizedAccess !== undefined && entry.access.toLowerCase() !== normalizedAccess) {
      return false;
    }
    if (normalizedQuery === undefined || normalizedQuery.length === 0) {
      return true;
    }
    const haystack = [
      entry.site,
      entry.name,
      entry.description,
      entry.domain ?? "",
      entry.strategy ?? "",
      entry.modulePath ?? "",
      entry.sourceFile ?? "",
      ...(entry.aliases ?? []),
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(normalizedQuery);
  });
}

function readOpenCliEntryFromCapability(
  capability: ExternalToolProviderCapability | undefined,
): OpenCliManifestEntry | undefined {
  const metadata = capability?.metadata;
  if (!isRecord(metadata)) {
    return undefined;
  }
  const site = normalizeString(metadata.site);
  const name = normalizeString(metadata.name);
  const description = normalizeString(metadata.description);
  const access = normalizeString(metadata.access);
  if (!site || !name || !description || (access !== "read" && access !== "write")) {
    return undefined;
  }
  return {
    site,
    name,
    description,
    access,
    ...(typeof metadata.domain === "string" && metadata.domain.trim().length > 0
      ? { domain: metadata.domain.trim() }
      : {}),
    ...(typeof metadata.strategy === "string" && metadata.strategy.trim().length > 0
      ? { strategy: metadata.strategy.trim() }
      : {}),
    ...(typeof metadata.browser === "boolean" ? { browser: metadata.browser } : {}),
    ...(Array.isArray(metadata.args)
      ? { args: metadata.args as readonly OpenCliManifestArg[] }
      : {}),
    ...(Array.isArray(metadata.columns) ? { columns: metadata.columns as readonly string[] } : {}),
    ...(typeof metadata.type === "string" && metadata.type.trim().length > 0
      ? { type: metadata.type.trim() }
      : {}),
    ...(typeof metadata.modulePath === "string" && metadata.modulePath.trim().length > 0
      ? { modulePath: metadata.modulePath.trim() }
      : {}),
    ...(typeof metadata.sourceFile === "string" && metadata.sourceFile.trim().length > 0
      ? { sourceFile: metadata.sourceFile.trim() }
      : {}),
    ...(typeof metadata.navigateBefore === "string" || typeof metadata.navigateBefore === "boolean"
      ? { navigateBefore: metadata.navigateBefore }
      : {}),
    ...(Array.isArray(metadata.aliases) ? { aliases: metadata.aliases as readonly string[] } : {}),
  };
}

function parseOpenCliJson(value: string): unknown | null {
  const text = trimOpenCliText(value);
  if (text.length === 0) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function trimOpenCliText(value: string | undefined | null): string {
  return typeof value === "string" ? value.trim() : "";
}

function formatOpenCliOutputPreview(value: unknown): string {
  if (typeof value === "string") {
    return trimOpenCliPreviewText(value);
  }
  if (Array.isArray(value)) {
    return trimOpenCliPreviewText(
      value
        .slice(0, 5)
        .map((item, index) => `${index + 1}. ${formatOpenCliPreviewItem(item)}`)
        .join("\n"),
    );
  }
  return trimOpenCliPreviewText(formatOpenCliPreviewItem(value));
}

function formatOpenCliPreviewItem(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const title = normalizeString(record.title ?? record.name ?? record.text ?? record.summary);
    const url = normalizeString(record.url ?? record.href ?? record.link);
    if (title.length > 0 && url.length > 0) {
      return `${title} (${url})`;
    }
    if (title.length > 0) {
      return title;
    }
    try {
      return JSON.stringify(value);
    } catch (_error) {
      return String(value);
    }
  }
  return String(value);
}

function trimOpenCliPreviewText(value: string): string {
  const text = trimOpenCliText(value).replace(/\s+\n/gu, "\n");
  return text.length <= 1200 ? text : `${text.slice(0, 1180).trimEnd()}\n...（已截断）`;
}

function clampPositiveInteger(value: unknown, fallback: number): number {
  const num =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : fallback;
  if (!Number.isFinite(num) || num <= 0) {
    return fallback;
  }
  return Math.floor(num);
}

function buildOpenCliCapability(
  id: string,
  label: string,
  options: {
    readonly readOnly: boolean;
    readonly metadata?: Readonly<Record<string, unknown>>;
  },
): ExternalToolProviderCapability {
  return {
    id,
    label,
    readOnly: options.readOnly,
    ...(options.readOnly ? {} : { requiresApproval: true }),
    ...(options.metadata === undefined ? {} : { metadata: options.metadata }),
  };
}

function buildOpenCliCommandCapability(
  entry: OpenCliManifestEntry,
): ExternalToolProviderCapability {
  return {
    id: `opencli.${entry.site}.${entry.name}`,
    label: `${entry.site}/${entry.name}`,
    description: entry.description,
    readOnly: entry.access === "read",
    requiresApproval: entry.access === "write",
    metadata: {
      site: entry.site,
      name: entry.name,
      description: entry.description,
      access: entry.access,
      ...(entry.domain === undefined ? {} : { domain: entry.domain }),
      ...(entry.strategy === undefined ? {} : { strategy: entry.strategy }),
      ...(entry.browser === undefined ? {} : { browser: entry.browser }),
      ...(entry.args === undefined ? {} : { args: entry.args }),
      ...(entry.columns === undefined ? {} : { columns: entry.columns }),
      ...(entry.type === undefined ? {} : { type: entry.type }),
      ...(entry.modulePath === undefined ? {} : { modulePath: entry.modulePath }),
      ...(entry.sourceFile === undefined ? {} : { sourceFile: entry.sourceFile }),
      ...(entry.navigateBefore === undefined ? {} : { navigateBefore: entry.navigateBefore }),
      ...(entry.aliases === undefined ? {} : { aliases: entry.aliases }),
      ...(entry.access === "read" ? { modelToolName: "director.opencli.invoke" } : {}),
    },
  };
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stringFromUnknown(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (Buffer.isBuffer(value)) {
    return value.toString("utf8");
  }
  return "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
