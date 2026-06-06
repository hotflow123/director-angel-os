import { describe, expect, it } from "vitest";

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyDirectorApprovalPolicy,
  loadDirectorSwitchState,
  resolveDirectorSwitchState,
  writeDirectorAdapterOverride,
  writeDirectorFeatureOverride,
} from "../src/switches.ts";

describe("director-runtime switches", () => {
  it("uses the Beta-1 defaults", () => {
    const state = resolveDirectorSwitchState();

    expect(state.features["director.enabled"]).toBe(true);
    expect(state.features["execution.enabled"]).toBe(true);
    expect(state.features["execution.pause_all"]).toBe(false);
    expect(state.features["knowledgeRecall.enabled"]).toBe(false);
    expect(state.features["learning.enabled"]).toBe(false);
    expect(state.features["heartbeat.enabled"]).toBe(false);
    expect(state.features["reflection.autoSuggest.enabled"]).toBe(true);
    expect(state.features["soul.enabled"]).toBe(true);
    expect(state.features["soul.autoCandidate.enabled"]).toBe(true);
    expect(state.features["care.enabled"]).toBe(false);
    expect(state.roleOverrides["asset-router"]).toBe(true);
  });

  it("loads role and adapter overrides from disk", () => {
    const root = mkdtempSync(join(tmpdir(), "director-switches-"));
    const path = join(root, "switches.json");
    writeFileSync(
      path,
      JSON.stringify({
        schemaId: "director.switches.v1",
        features: {
          "autoRoute.enabled": false,
          "execution.pause_all": true,
        },
        roleOverrides: {
          "asset-router": false,
        },
        adapterOverrides: {
          "mock-video": false,
        },
      }),
      "utf8",
    );

    try {
      const state = loadDirectorSwitchState(path);
      expect(state.source).toBe("file");
      expect(state.features["autoRoute.enabled"]).toBe(false);
      expect(state.features["execution.pause_all"]).toBe(true);
      expect(state.roleOverrides["asset-router"]).toBe(false);
      expect(state.adapterOverrides["mock-video"]).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("forces route and publish actions behind the switch policy floor", () => {
    const state = resolveDirectorSwitchState({
      features: {
        "autoRoute.enabled": false,
        "publish.enabled": false,
      },
    });

    expect(applyDirectorApprovalPolicy("auto-allow", "route", state)).toBe("forbidden-in-beta1");
    expect(applyDirectorApprovalPolicy("operator-approve", "publish", state)).toBe(
      "forbidden-in-beta1",
    );
  });

  it("writes adapter overrides back to disk", () => {
    const root = mkdtempSync(join(tmpdir(), "director-switch-write-"));
    const path = join(root, "switches.json");

    try {
      const state = writeDirectorAdapterOverride(path, "seedance-preview", false);

      expect(state.source).toBe("file");
      expect(state.adapterOverrides["seedance-preview"]).toBe(false);
      expect(loadDirectorSwitchState(path).adapterOverrides["seedance-preview"]).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("merges feature updates into the latest switch file", () => {
    const root = mkdtempSync(join(tmpdir(), "director-switch-feature-write-"));
    const path = join(root, "switches.json");
    writeFileSync(
      path,
      JSON.stringify({
        schemaId: "director.switches.v1",
        features: {
          "autoRoute.enabled": false,
        },
        adapterOverrides: {
          "mock-video": false,
        },
      }),
      "utf8",
    );

    try {
      const state = writeDirectorFeatureOverride(path, "heartbeat.enabled", true);

      expect(state.source).toBe("file");
      expect(state.features["autoRoute.enabled"]).toBe(false);
      expect(state.features["heartbeat.enabled"]).toBe(true);
      expect(state.adapterOverrides["mock-video"]).toBe(false);
      const diskState = loadDirectorSwitchState(path);
      expect(diskState.features["autoRoute.enabled"]).toBe(false);
      expect(diskState.features["heartbeat.enabled"]).toBe(true);
      expect(diskState.adapterOverrides["mock-video"]).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
