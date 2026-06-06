import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DIRECTOR_HOST_API_VERSION } from "@hotflow/director-host-contracts";
import { describe, expect, test } from "vitest";

import {
  renderDirectorAdapterInventory,
  renderDirectorSwitchSummary,
} from "./director-runtime-report.js";

function createRuntimeSnapshotResponse() {
  return {
    apiVersion: DIRECTOR_HOST_API_VERSION,
    runtimeId: "director-host-api",
    capabilitySnapshot: {
      snapshotId: "capability-snapshot-runtime",
      runtimeId: "director-host-api",
      capturedAt: "2026-04-11T12:00:00.000Z",
      status: "ready",
      adapters: [
        {
          adapterId: "director-host-api",
          adapterKind: "host",
          provider: "director-host-api",
          enabled: true,
          healthStatus: "ready",
          dryRunSupported: true,
          mockOnly: true,
          supportedActionClasses: ["read", "write"],
        },
        {
          adapterId: "binding-a",
          adapterKind: "media",
          provider: "mock-media",
          enabled: true,
          healthStatus: "ready",
          dryRunSupported: true,
          mockOnly: true,
          supportedActionClasses: ["generate", "write"],
          mediaCapability: {
            adapterId: "binding-a",
            adapterKind: "media",
            provider: "mock-media",
            supportedModes: ["text_to_video"],
            inputModalities: ["text"],
            outputArtifactTypes: ["video"],
            supportsAsync: false,
            healthStatus: "ready",
          },
        },
        {
          adapterId: "beta1-handoff-preview",
          adapterKind: "execution",
          provider: "director-host-api",
          enabled: true,
          healthStatus: "ready",
          dryRunSupported: true,
          mockOnly: true,
          supportedActionClasses: ["write"],
        },
      ],
      notes: ["preview-safe"],
    },
  } as const;
}

describe("director runtime report", () => {
  test("renders readable adapter inventory", () => {
    const output = renderDirectorAdapterInventory(
      "/workspace/project",
      createRuntimeSnapshotResponse(),
    );

    expect(output).toContain("Director adapters:");
    expect(output).toContain("enabled adapters: 3/3");
    expect(output).toContain("binding-a [media]");
    expect(output).toContain("actions: generate, write");
    expect(output).toContain("media: modes=text_to_video inputs=text outputs=video async=no");
    expect(output).toContain("/workspace/project/.director-angel/adapters");
  });

  test("renders switch defaults with runtime hints", () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-runtime-report-"));
    const switchPath = join(workspaceRoot, ".director-angel", "runtime", "switches.json");
    mkdirSync(join(workspaceRoot, ".director-angel", "runtime"), { recursive: true });
    writeFileSync(
      switchPath,
      JSON.stringify({
        schemaId: "director.switches.v1",
        features: {
          "director.enabled": true,
          "autoRoute.enabled": false,
        },
        roleOverrides: {
          "asset-router": false,
        },
        adapterOverrides: {
          "beta1-handoff-preview": false,
        },
      }),
      "utf8",
    );

    const output = renderDirectorSwitchSummary(workspaceRoot, createRuntimeSnapshotResponse());

    try {
      expect(output).toContain("Director switches:");
      expect(output).toContain("source: file");
      expect(output).toContain("director.enabled: on");
      expect(output).toContain("autoRoute.enabled: off");
      expect(output).toContain("disabled roles: asset-router");
      expect(output).toContain("disabled adapters: beta1-handoff-preview");
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });
});
