import {
  DIRECTOR_HOST_API_VERSION,
  type DirectorRuntimePreflightAdapterCounts,
  type DirectorRuntimePreflightAdapterSurface,
  type DirectorRuntimePreflightResponse,
  type DirectorRuntimePreflightRouteHint,
  type DirectorRuntimePreflightStatus,
  type DirectorRuntimePreflightSurface,
  type RuntimeCapabilityAdapter,
} from "@hotflow/director-host-contracts";

import type { DirectorHostRuntime } from "./bootstrap.js";

export function createRuntimePreflightResponse(
  runtime: DirectorHostRuntime,
): DirectorRuntimePreflightResponse {
  const adapters = runtime.runtimeCapabilitySnapshot.adapters;
  const runtimeSurface = deriveRuntimeSurface(runtime);
  const adapterSurface = deriveAdapterSurface(adapters);
  const status = maxPreflightStatus(runtimeSurface.status, adapterSurface.status);
  const readiness = deriveReadiness(status);
  const recommendedAction = deriveRecommendedAction(runtime, adapterSurface, runtimeSurface);
  const recommendedCommand = status === "pass" ? "hotflow preflight" : "hotflow doctor";
  const recommendedRoute =
    status === "pass"
      ? ({
          method: "POST",
          path: "/v1/entry/intake",
        } satisfies DirectorRuntimePreflightRouteHint)
      : undefined;

  return {
    apiVersion: DIRECTOR_HOST_API_VERSION,
    runtimeId: runtime.runtimeCapabilitySnapshot.runtimeId,
    status,
    readiness,
    summaryText: deriveSummaryText(runtimeSurface, adapterSurface, status),
    recommendedAction,
    recommendedCommand,
    ...(recommendedRoute === undefined ? {} : { recommendedRoute }),
    commands: status === "pass" ? ["hotflow preflight"] : ["hotflow doctor", "hotflow preflight"],
    notes: collectNotes(runtime),
    surfaces: {
      runtime: runtimeSurface,
      adapters: adapterSurface,
    },
  };
}

export interface DirectorRuntimePreflightHandoff {
  readonly preflightRoute: {
    readonly method: "GET";
    readonly path: "/v1/runtime/preflight";
  };
  readonly preflight: Pick<
    DirectorRuntimePreflightResponse,
    "status" | "readiness" | "summaryText" | "recommendedAction" | "recommendedCommand"
  >;
}

export function createRuntimePreflightHandoff(
  runtime: DirectorHostRuntime,
): DirectorRuntimePreflightHandoff {
  const preflight = createRuntimePreflightResponse(runtime);
  return {
    preflightRoute: {
      method: "GET",
      path: "/v1/runtime/preflight",
    },
    preflight: {
      status: preflight.status,
      readiness: preflight.readiness,
      summaryText: preflight.summaryText,
      recommendedAction: preflight.recommendedAction,
      ...(preflight.recommendedCommand === undefined
        ? {}
        : { recommendedCommand: preflight.recommendedCommand }),
    },
  };
}

function deriveRuntimeSurface(runtime: DirectorHostRuntime): DirectorRuntimePreflightSurface {
  if (runtime.runtimeCapabilitySnapshot.status === "offline") {
    return {
      status: "fail",
      summaryText: "Director host runtime is offline and cannot serve a bounded run yet.",
    };
  }

  if (runtime.providerIds.length === 0) {
    return {
      status: "warn",
      summaryText:
        "Director host runtime can still answer deterministic preflight, but no default provider is registered for the next real run.",
    };
  }

  if (runtime.runtimeCapabilitySnapshot.status === "degraded") {
    return {
      status: "warn",
      summaryText:
        "Director host runtime is up, but one or more runtime capabilities are degraded.",
    };
  }

  return {
    status: "pass",
    summaryText: `Director host runtime is serving requests with default provider ${runtime.config.defaultProvider}.`,
  };
}

function deriveAdapterSurface(
  adapters: readonly RuntimeCapabilityAdapter[],
): DirectorRuntimePreflightAdapterSurface {
  const counts = countAdapters(adapters);
  const availableHost = adapters.filter((adapter) => isAvailableAdapter(adapter, "host"));
  const availableMedia = adapters.filter((adapter) => isAvailableAdapter(adapter, "media"));
  const availableExecution = adapters.filter((adapter) => isAvailableAdapter(adapter, "execution"));

  if (availableHost.length === 0) {
    return {
      status: "fail",
      summaryText:
        "No enabled host adapter is available, so the API cannot expose a safe bounded route.",
      counts,
    };
  }

  if (availableMedia.length === 0) {
    return {
      status: "fail",
      summaryText:
        "No enabled media adapter is available yet, so intake can align but cannot route a real bounded generation path.",
      counts,
    };
  }

  if (availableExecution.length === 0) {
    return {
      status: "fail",
      summaryText:
        "No enabled execution adapter is available yet, so the host cannot hand off a bounded run into the worker lane.",
      counts,
    };
  }

  if (adapters.some((adapter) => adapter.enabled && adapter.healthStatus === "degraded")) {
    return {
      status: "warn",
      summaryText:
        "Host, media, and execution adapters are visible, but at least one enabled adapter is degraded.",
      counts,
    };
  }

  return {
    status: "pass",
    summaryText: "Host, media, and execution adapters are visible for a bounded run.",
    counts,
  };
}

function countAdapters(
  adapters: readonly RuntimeCapabilityAdapter[],
): DirectorRuntimePreflightAdapterCounts {
  return {
    total: adapters.length,
    host: adapters.filter((adapter) => adapter.adapterKind === "host").length,
    media: adapters.filter((adapter) => adapter.adapterKind === "media").length,
    execution: adapters.filter((adapter) => adapter.adapterKind === "execution").length,
    enabled: adapters.filter((adapter) => adapter.enabled).length,
    ready: adapters.filter((adapter) => adapter.healthStatus === "ready").length,
    degraded: adapters.filter((adapter) => adapter.healthStatus === "degraded").length,
    offline: adapters.filter((adapter) => adapter.healthStatus === "offline").length,
    mockOnly: adapters.filter((adapter) => adapter.mockOnly).length,
    dryRunSupported: adapters.filter((adapter) => adapter.dryRunSupported).length,
  };
}

function isAvailableAdapter(
  adapter: RuntimeCapabilityAdapter,
  kind: RuntimeCapabilityAdapter["adapterKind"],
): boolean {
  return adapter.adapterKind === kind && adapter.enabled && adapter.healthStatus !== "offline";
}

function maxPreflightStatus(
  left: DirectorRuntimePreflightStatus,
  right: DirectorRuntimePreflightStatus,
): DirectorRuntimePreflightStatus {
  const order: Record<DirectorRuntimePreflightStatus, number> = {
    pass: 0,
    warn: 1,
    fail: 2,
  };

  return order[left] >= order[right] ? left : right;
}

function deriveReadiness(
  status: DirectorRuntimePreflightStatus,
): DirectorRuntimePreflightResponse["readiness"] {
  if (status === "fail") {
    return "blocked";
  }
  if (status === "warn") {
    return "needs-attention";
  }
  return "ready";
}

function deriveSummaryText(
  runtimeSurface: DirectorRuntimePreflightSurface,
  adapterSurface: DirectorRuntimePreflightAdapterSurface,
  status: DirectorRuntimePreflightStatus,
): string {
  if (status === "fail") {
    if (adapterSurface.status === "fail") {
      return adapterSurface.summaryText;
    }
    return runtimeSurface.summaryText;
  }

  if (status === "warn") {
    if (runtimeSurface.status === "warn") {
      return runtimeSurface.summaryText;
    }
    return adapterSurface.summaryText;
  }

  return "Director host runtime looks ready for a bounded first or next run.";
}

function deriveRecommendedAction(
  runtime: DirectorHostRuntime,
  adapterSurface: DirectorRuntimePreflightAdapterSurface,
  runtimeSurface: DirectorRuntimePreflightSurface,
): string {
  if (adapterSurface.status === "fail") {
    if (adapterSurface.counts.media === 0) {
      return "Register or enable at least one media adapter before starting intake or blueprint.";
    }
    if (adapterSurface.counts.execution === 0) {
      return "Register or enable at least one execution adapter before creating bounded runs.";
    }
    return "Repair the host adapter lane before exposing this runtime to the next bounded run.";
  }

  if (runtimeSurface.status === "warn" && runtime.providerIds.length === 0) {
    return "Configure the default provider, or keep this host in preview-only preflight mode until a real provider is ready.";
  }

  if (adapterSurface.status === "warn") {
    return "Inspect degraded adapters before the next non-preview run.";
  }

  return "POST /v1/entry/intake to start the first bounded host session.";
}

function collectNotes(runtime: DirectorHostRuntime): string[] {
  const notes = [
    ...(runtime.runtimeCapabilitySnapshot.notes ?? []),
    `Available providers: ${runtime.providerIds.join(", ") || "(none)"}.`,
    `Default model: ${runtime.config.defaultModel}.`,
  ];

  return [...new Set(notes.filter((note) => note.trim().length > 0))];
}
