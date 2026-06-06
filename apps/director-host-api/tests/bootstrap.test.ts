import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  FileSystemDirectorAdapterRegistryStore,
  updateDirectorApiProviderSetting,
} from "@hotflow/director-runtime";

import { bootstrapDirectorHostApi } from "../src/bootstrap.js";

describe("bootstrapDirectorHostApi", () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    for (const root of tempRoots.splice(0, tempRoots.length)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("constructs switches, adapter registry, and a baseline runtime snapshot", () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-host-bootstrap-"));
    tempRoots.push(workspaceRoot);
    const dataDir = join(workspaceRoot, ".hotflow");
    const runtime = bootstrapDirectorHostApi({
      env: {
        HOTFLOW_DATA_DIR: dataDir,
        HOTFLOW_DEFAULT_MODEL: "director-alpha",
        HOTFLOW_DEFAULT_PROVIDER: "seedance",
        HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
      },
      internalPluginIds: ["plugin.seedance", "plugin.seedance"],
      now: () => "2026-04-12T00:00:00.000Z",
      providerIds: ["scripted", "seedance", "scripted"],
    });

    expect(runtime.providerIds).toEqual(["scripted", "seedance"]);
    expect(runtime.internalPluginIds).toEqual(["plugin.seedance"]);
    expect(runtime.switchState.source).toBe("defaults");
    expect(runtime.switchState.features["director.enabled"]).toBe(true);
    expect(runtime.switchState.features["learning.enabled"]).toBe(false);
    expect(runtime.switchPath).toContain(".director-angel/runtime/switches.json");
    expect(runtime.observationPath).toContain(".director-angel/runtime/observations.ndjson");
    expect(runtime.adapterRegistry.listAll().map((adapter) => adapter.adapterId)).toEqual([
      "director-host-api",
      "scripted",
      "seedance",
      "beta1-handoff-preview",
    ]);
    expect(runtime.runtimeCapabilitySnapshot.runtimeId).toBe("director-host-api");
    expect(runtime.runtimeCapabilitySnapshot.capturedAt).toBe("2026-04-12T00:00:00.000Z");
    expect(runtime.runtimeCapabilitySnapshot.adapters.map((adapter) => adapter.adapterId)).toEqual([
      "director-host-api",
      "scripted",
      "seedance",
      "beta1-handoff-preview",
    ]);
  });

  it("registers scripted and env-default providers for the real entrypoint path", () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-host-bootstrap-env-"));
    tempRoots.push(workspaceRoot);

    const runtime = bootstrapDirectorHostApi({
      env: {
        HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
        HOTFLOW_DEFAULT_PROVIDER: "seedance",
        DIRECTOR_HOST_API_PROVIDER_IDS: "veo3,seedance",
      },
      now: () => "2026-04-12T00:10:00.000Z",
    });

    expect(runtime.providerIds).toEqual(["scripted", "seedance", "veo3"]);
    expect(runtime.runtimeCapabilitySnapshot.status).toBe("ready");
    expect(runtime.adapterRegistry.listAll().map((adapter) => adapter.adapterId)).toEqual([
      "director-host-api",
      "scripted",
      "seedance",
      "veo3",
      "beta1-handoff-preview",
    ]);
  });

  it("loads persisted adapter manifests from the director workspace registry", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-host-bootstrap-registry-"));
    tempRoots.push(workspaceRoot);
    const store = new FileSystemDirectorAdapterRegistryStore({
      rootPath: join(workspaceRoot, ".director-angel", "adapters", "registry"),
      clock: () => "2026-04-13T10:00:00.000Z",
    });
    await store.upsertManifest({
      adapterId: "seedance-preview",
      adapterKind: "media",
      provider: "seedance",
      bindingId: "seedance-preview",
      healthStatus: "ready",
      dryRunSupported: true,
      mockOnly: true,
      supportedActionClasses: ["generate", "write"],
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
    });

    const runtime = bootstrapDirectorHostApi({
      env: {
        HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
      },
      now: () => "2026-04-13T10:05:00.000Z",
      providerIds: ["scripted"],
    });

    expect(runtime.adapterRegistry.listAll().map((adapter) => adapter.adapterId)).toEqual([
      "director-host-api",
      "scripted",
      "beta1-handoff-preview",
      "seedance-preview",
    ]);
    expect(
      runtime.runtimeCapabilitySnapshot.adapters.some(
        (adapter) => adapter.adapterId === "seedance-preview",
      ),
    ).toBe(true);
    expect(runtime.runtimeCapabilitySnapshot.notes?.join(" | ")).toContain(
      "Loaded 1 persisted adapter manifest(s).",
    );
  });

  it("exposes configured API media providers as real local bridge adapters", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-host-bootstrap-api-provider-"));
    tempRoots.push(workspaceRoot);
    const providersRoot = join(workspaceRoot, ".director-angel", "providers");
    await updateDirectorApiProviderSetting(providersRoot, {
      providerId: "memefast-api",
      key: "apiKey",
      value: "test-key",
      now: "2026-04-13T11:00:00.000Z",
    });

    const runtime = bootstrapDirectorHostApi({
      env: {
        HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
        DIRECTOR_API_PROVIDER_BRIDGE_BASE_URL: "http://127.0.0.1:4501",
      },
      now: () => "2026-04-13T11:05:00.000Z",
      providerIds: ["scripted"],
    });

    const adapter = runtime.runtimeCapabilitySnapshot.adapters.find(
      (entry) => entry.adapterId === "memefast-api",
    );
    expect(runtime.adapterRegistry.listAll().map((entry) => entry.adapterId)).toEqual([
      "director-host-api",
      "memefast-api",
      "scripted",
      "beta1-handoff-preview",
    ]);
    expect(adapter).toMatchObject({
      adapterId: "memefast-api",
      adapterKind: "media",
      provider: "memefast-api",
      mockOnly: false,
      approvalMode: "operator_approve",
      bridge: {
        kind: "http-json",
        endpointOrigin: "http://127.0.0.1:4501",
        endpointPath: "/v1/bridges/api-provider/media-submit",
        authMode: "none",
      },
    });
  });

  it("keeps configured API provider status separate from preview provider ids", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-host-bootstrap-api-summary-"));
    tempRoots.push(workspaceRoot);
    const providersRoot = join(workspaceRoot, ".director-angel", "providers");
    await updateDirectorApiProviderSetting(providersRoot, {
      providerId: "memefast-api",
      key: "apiKey",
      value: "test-key",
      now: "2026-04-13T12:00:00.000Z",
    });

    const runtime = bootstrapDirectorHostApi({
      env: {
        HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
      },
      now: () => "2026-04-13T12:05:00.000Z",
      providerIds: ["scripted"],
    });

    expect(runtime.providerIds).toEqual(["scripted"]);
    expect(runtime.apiProviders).toEqual([
      expect.objectContaining({
        id: "memefast-api",
        enabled: true,
        apiKeyConfigured: true,
        modelCount: expect.any(Number),
      }),
    ]);
    expect(runtime.apiProviders[0]?.modelCount).toBeGreaterThan(40);
    expect(JSON.stringify(runtime.apiProviders)).not.toContain("test-key");
  });
});
