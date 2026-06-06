import { describe, expect, it } from "vitest";

import {
  DirectorAdapterRegistry,
  createMockExecutionAdapter,
  createMockHostAdapter,
  createMockMediaAdapter,
} from "../src/adapters.ts";
import { resolveDirectorSwitchState } from "../src/switches.ts";

describe("director-runtime adapters", () => {
  it("builds a runtime snapshot with the three mock adapter kinds", () => {
    const registry = new DirectorAdapterRegistry([
      createMockHostAdapter(),
      createMockMediaAdapter({
        adapterId: "mock-video",
      }),
      createMockExecutionAdapter(),
    ]);

    const snapshot = registry.buildRuntimeCapabilitySnapshot({
      runtimeId: "director-host-api",
      switchState: resolveDirectorSwitchState(),
    });

    expect(snapshot.adapters.map((adapter) => adapter.adapterKind)).toEqual([
      "host",
      "media",
      "execution",
    ]);
    expect(snapshot.status).toBe("ready");
  });

  it("derives core runtime bindings from enabled media adapters only", () => {
    const registry = new DirectorAdapterRegistry([
      createMockHostAdapter(),
      createMockMediaAdapter({
        adapterId: "mock-image",
        supportedModes: ["text_to_image"],
      }),
      createMockMediaAdapter({
        adapterId: "mock-video",
        supportedModes: ["text_to_video"],
      }),
      createMockExecutionAdapter(),
    ]);

    const runtime = registry.deriveCoreRuntimeCapabilities({
      runtimeId: "director-host-api",
      maxPromptChars: 4096,
      switchState: resolveDirectorSwitchState({
        adapterOverrides: {
          "mock-image": false,
        },
      }),
    });

    expect(runtime.availableBindings).toEqual(["mock-video"]);
    expect(runtime.supportsVideo).toBe(true);
  });

  it("surfaces a safe bridge summary in runtime snapshots without leaking secrets", () => {
    const registry = new DirectorAdapterRegistry([
      {
        adapterId: "seedance-preview",
        adapterKind: "media",
        provider: "seedance",
        bindingId: "seedance-preview",
        enabled: true,
        healthStatus: "ready",
        dryRunSupported: true,
        mockOnly: false,
        supportedActionClasses: ["generate"],
        riskLevel: "high",
        approvalMode: "operator_approve",
        permissionScopes: ["media.generate"],
        dataRetentionPolicy: "vendor-retains-30-days",
        rateLimitPolicy: "10 requests/minute",
        budgetPolicy: "operator-budget-required",
        mediaCapability: {
          adapterId: "seedance-preview",
          adapterKind: "media",
          provider: "seedance",
          supportedModes: ["text_to_video"],
          inputModalities: ["text"],
          outputArtifactTypes: ["video"],
          supportsAsync: false,
          healthStatus: "ready",
        },
        bridge: {
          kind: "http-json",
          baseUrl: "https://bridge.example.test",
          submitPath: "/v1/jobs",
          timeoutMs: 30_000,
          authEnvVar: "SEEDANCE_API_KEY",
          headers: {
            "x-bridge-secret": "header-secret",
          },
        },
      } as never,
    ]);

    const snapshot = registry.buildRuntimeCapabilitySnapshot({
      runtimeId: "director-host-api",
      switchState: resolveDirectorSwitchState(),
    });

    expect(snapshot.adapters[0]).toMatchObject({
      adapterId: "seedance-preview",
      bridge: {
        kind: "http-json",
        endpointOrigin: "https://bridge.example.test",
        endpointPath: "/v1/jobs",
        timeoutMs: 30_000,
        authMode: "env",
        headerKeys: ["x-bridge-secret"],
      },
      riskLevel: "high",
      approvalMode: "operator_approve",
      permissionScopes: ["media.generate"],
      dataRetentionPolicy: "vendor-retains-30-days",
      rateLimitPolicy: "10 requests/minute",
      budgetPolicy: "operator-budget-required",
    });
    expect(JSON.stringify(snapshot)).not.toContain("SEEDANCE_API_KEY");
    expect(JSON.stringify(snapshot)).not.toContain("header-secret");
  });
});
