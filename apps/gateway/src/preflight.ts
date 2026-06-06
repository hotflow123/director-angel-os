import { CONTRACTS_SCHEMA_VERSION } from "@hotflow/contracts";

import type { bootstrapGateway } from "./bootstrap.js";

type GatewayRuntime = ReturnType<typeof bootstrapGateway>;

export interface GatewayPreflightRouteHint {
  readonly method: "POST";
  readonly path: "/v1/channel/message";
}

export interface GatewayPreflightSurface {
  readonly status: "pass" | "warn" | "fail";
  readonly summaryText: string;
}

export interface GatewayPreflightProviderSurface extends GatewayPreflightSurface {
  readonly defaultProvider: string;
  readonly defaultProviderAvailable: boolean;
  readonly providerIds: readonly string[];
}

export interface GatewayPreflightResponse {
  readonly status: "pass" | "warn" | "fail";
  readonly readiness: "ready" | "needs-attention" | "blocked";
  readonly app: "@hotflow/gateway";
  readonly schemaVersion: typeof CONTRACTS_SCHEMA_VERSION;
  readonly summaryText: string;
  readonly recommendedAction: string;
  readonly recommendedCommand: "hotflow preflight" | "hotflow doctor";
  readonly recommendedRoute?: GatewayPreflightRouteHint;
  readonly commands: readonly string[];
  readonly surfaces: {
    readonly runtime: GatewayPreflightSurface;
    readonly provider: GatewayPreflightProviderSurface;
  };
}

export function createGatewayPreflightResponse(runtime: GatewayRuntime): GatewayPreflightResponse {
  const runtimeSurface = deriveRuntimeSurface();
  const providerSurface = deriveProviderSurface(runtime);
  const status = maxStatus(runtimeSurface.status, providerSurface.status);

  return {
    status,
    readiness: status === "fail" ? "blocked" : status === "warn" ? "needs-attention" : "ready",
    app: "@hotflow/gateway",
    schemaVersion: CONTRACTS_SCHEMA_VERSION,
    summaryText:
      status === "pass"
        ? "Gateway runtime looks ready for the next bounded message."
        : providerSurface.summaryText,
    recommendedAction:
      status === "pass"
        ? "POST /v1/channel/message when you are ready to send the next bounded message."
        : buildProviderRepairAction(providerSurface),
    recommendedCommand: status === "pass" ? "hotflow preflight" : "hotflow doctor",
    ...(status === "pass"
      ? {
          recommendedRoute: {
            method: "POST" as const,
            path: "/v1/channel/message" as const,
          },
        }
      : {}),
    commands: status === "pass" ? ["hotflow preflight"] : ["hotflow doctor", "hotflow preflight"],
    surfaces: {
      runtime: runtimeSurface,
      provider: providerSurface,
    },
  };
}

function deriveRuntimeSurface(): GatewayPreflightSurface {
  return {
    status: "pass",
    summaryText: "Gateway HTTP runtime is serving requests.",
  };
}

function deriveProviderSurface(runtime: GatewayRuntime): GatewayPreflightProviderSurface {
  const defaultProviderAvailable = runtime.providerIds.includes(runtime.config.defaultProvider);

  if (!defaultProviderAvailable && runtime.providerIds.length === 0) {
    return {
      status: "fail",
      summaryText: "No gateway providers are registered yet, so the message entry path is blocked.",
      defaultProvider: runtime.config.defaultProvider,
      defaultProviderAvailable,
      providerIds: runtime.providerIds,
    };
  }

  if (!defaultProviderAvailable) {
    return {
      status: "fail",
      summaryText:
        "The configured gateway default provider is not registered yet, so the message entry path is blocked.",
      defaultProvider: runtime.config.defaultProvider,
      defaultProviderAvailable,
      providerIds: runtime.providerIds,
    };
  }

  return {
    status: "pass",
    summaryText: `Gateway default provider ${runtime.config.defaultProvider} is registered.`,
    defaultProvider: runtime.config.defaultProvider,
    defaultProviderAvailable,
    providerIds: runtime.providerIds,
  };
}

function buildProviderRepairAction(providerSurface: GatewayPreflightProviderSurface): string {
  if (providerSurface.providerIds.length === 0) {
    return "Register a gateway provider first, then rerun preflight before sending a channel message.";
  }

  return `Register ${providerSurface.defaultProvider} or switch HOTFLOW_DEFAULT_PROVIDER to one of: ${providerSurface.providerIds.join(", ")}.`;
}

function maxStatus(
  left: GatewayPreflightSurface["status"],
  right: GatewayPreflightSurface["status"],
): GatewayPreflightSurface["status"] {
  const order: Record<GatewayPreflightSurface["status"], number> = {
    pass: 0,
    warn: 1,
    fail: 2,
  };

  return order[left] >= order[right] ? left : right;
}
