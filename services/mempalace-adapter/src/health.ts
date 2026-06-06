import { runMempalaceCommandSync } from "./command-client.js";
import { loadMempalaceAdapterConfig } from "./config.js";
import {
  MEMPALACE_MISCONFIGURED_REASON,
  type MempalaceHealthProbeResult,
  type ProbeMempalaceHealthOptions,
} from "./types.js";

export function probeMempalaceHealthSync(
  options: ProbeMempalaceHealthOptions = {},
): MempalaceHealthProbeResult {
  const config =
    options.config ?? loadMempalaceAdapterConfig({ ...(options.env ? { env: options.env } : {}) });

  if (config.mode === "disabled") {
    return {
      status: "pass",
      summary: "Mempalace adapter disabled by configuration.",
      mode: config.mode,
      configured: false,
      reachable: false,
      details: {
        mode: config.mode,
        configured: false,
        degradeOnFailure: config.degradeOnFailure,
      },
    };
  }

  if (!config.configured || !config.palacePath) {
    return {
      status: "warn",
      summary: `Mempalace adapter is ${config.mode} but not fully configured.`,
      mode: config.mode,
      configured: false,
      reachable: false,
      degraded: {
        reason: MEMPALACE_MISCONFIGURED_REASON,
        message: config.issues.join(" "),
      },
      details: {
        mode: config.mode,
        configured: false,
        issues: config.issues,
      },
    };
  }

  const result = runMempalaceCommandSync(
    config,
    {
      action: "health",
      palacePath: config.palacePath,
      ...(config.wing ? { wing: config.wing } : {}),
      ...(config.room ? { room: config.room } : {}),
    },
    options.runCommand,
  );
  if (!result.ok) {
    return {
      status: "warn",
      summary: "Mempalace adapter configured but unreachable.",
      mode: config.mode,
      configured: true,
      reachable: false,
      ...(result.degraded ? { degraded: result.degraded } : {}),
      details: {
        mode: config.mode,
        configured: true,
        ...result.diagnostics,
      },
    };
  }

  const payload = result.payload;
  if (payload && typeof payload === "object" && "ok" in payload && payload.ok === false) {
    const payloadRecord = payload as Record<string, unknown>;
    const message = payloadRecord.message;
    return {
      status: "warn",
      summary: "Mempalace health probe returned an unhealthy status.",
      mode: config.mode,
      configured: true,
      reachable: true,
      degraded: {
        reason: "mempalace-health-unhealthy",
        message:
          typeof message === "string" && message.trim().length > 0
            ? message
            : "Mempalace health response marked as unhealthy.",
      },
      details: {
        mode: config.mode,
        configured: true,
        ...result.diagnostics,
      },
    };
  }

  return {
    status: "pass",
    summary: "Mempalace adapter configured and reachable.",
    mode: config.mode,
    configured: true,
    reachable: true,
    details: {
      mode: config.mode,
      configured: true,
      ...result.diagnostics,
    },
  };
}
