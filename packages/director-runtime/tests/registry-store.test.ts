import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  FileSystemDirectorAdapterRegistryStore,
  loadDirectorAdapterRegistry,
} from "../src/registry-store.ts";

describe("director-runtime registry store", () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    for (const root of tempRoots.splice(0, tempRoots.length)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("stores manifests on disk and reloads them through the registry loader", async () => {
    const root = mkdtempSync(join(tmpdir(), "director-registry-store-"));
    tempRoots.push(root);
    const store = new FileSystemDirectorAdapterRegistryStore({
      rootPath: root,
      clock: () => "2026-04-13T10:00:00.000Z",
    });

    const result = await store.upsertManifest({
      adapterId: "seedance-preview",
      adapterKind: "media",
      provider: "seedance",
      bindingId: "seedance-preview",
      enabled: true,
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

    expect(result.status).toBe("ok");

    const loaded = loadDirectorAdapterRegistry(root);
    expect(loaded.documents).toHaveLength(1);
    expect(loaded.documents[0]?.adapterId).toBe("seedance-preview");
    expect(loaded.documents[0]?.version).toBe(1);
    expect(loaded.issues).toEqual([]);
  });

  it("increments manifest version when the same adapter is re-registered", async () => {
    const root = mkdtempSync(join(tmpdir(), "director-registry-version-"));
    tempRoots.push(root);
    let tick = 0;
    const store = new FileSystemDirectorAdapterRegistryStore({
      rootPath: root,
      clock: () => {
        tick += 1;
        return `2026-04-13T10:00:0${tick}.000Z`;
      },
    });

    await store.upsertManifest({
      adapterId: "seedance-preview",
      adapterKind: "media",
      provider: "seedance",
      healthStatus: "ready",
      dryRunSupported: true,
      mockOnly: true,
      supportedActionClasses: ["generate"],
    });
    const second = await store.upsertManifest({
      adapterId: "seedance-preview",
      adapterKind: "media",
      provider: "seedance",
      healthStatus: "ready",
      dryRunSupported: true,
      mockOnly: true,
      supportedActionClasses: ["generate", "write"],
    });

    expect(second.status).toBe("ok");

    const document = await store.getManifest("seedance-preview");
    expect(document?.version).toBe(2);
    expect(document?.supportedActionClasses).toEqual(["generate", "write"]);
  });

  it("stores real adapter approval and boundary metadata for review", async () => {
    const root = mkdtempSync(join(tmpdir(), "director-registry-policy-"));
    tempRoots.push(root);
    const store = new FileSystemDirectorAdapterRegistryStore({
      rootPath: root,
      clock: () => "2026-04-13T10:00:00.000Z",
    });

    await store.upsertManifest({
      adapterId: "seedance-real",
      adapterKind: "media",
      provider: "seedance",
      healthStatus: "ready",
      dryRunSupported: true,
      mockOnly: false,
      supportedActionClasses: ["generate", "write"],
      riskLevel: "high",
      approvalMode: "operator_approve",
      permissionScopes: ["media.generate", "media.write"],
      dataRetentionPolicy: "vendor-retains-30-days",
      rateLimitPolicy: "10 requests/minute",
      budgetPolicy: "operator-budget-required",
      bridge: {
        kind: "http-json",
        baseUrl: "https://bridge.example.test",
        submitPath: "/v1/jobs",
        authEnvVar: "SEEDANCE_API_KEY",
      },
    });

    const document = await store.getManifest("seedance-real");

    expect(document).toMatchObject({
      riskLevel: "high",
      approvalMode: "operator_approve",
      permissionScopes: ["media.generate", "media.write"],
      dataRetentionPolicy: "vendor-retains-30-days",
      rateLimitPolicy: "10 requests/minute",
      budgetPolicy: "operator-budget-required",
    });
  });

  it("rejects real side-effect bridge manifests without operator approval", async () => {
    const root = mkdtempSync(join(tmpdir(), "director-registry-unsafe-bridge-"));
    tempRoots.push(root);
    const store = new FileSystemDirectorAdapterRegistryStore({
      rootPath: root,
      clock: () => "2026-04-13T10:00:00.000Z",
    });

    const result = await store.upsertManifest({
      adapterId: "unsafe-real-bridge",
      adapterKind: "media",
      provider: "seedance",
      healthStatus: "ready",
      dryRunSupported: true,
      mockOnly: false,
      supportedActionClasses: ["generate"],
      riskLevel: "high",
      approvalMode: "auto_allow",
      permissionScopes: ["media.generate"],
      dataRetentionPolicy: "vendor-retains-30-days",
      rateLimitPolicy: "10 requests/minute",
      budgetPolicy: "operator-budget-required",
      bridge: {
        kind: "http-json",
        baseUrl: "https://bridge.example.test",
        submitPath: "/v1/jobs",
        authEnvVar: "SEEDANCE_API_KEY",
      },
    });

    expect(result.status).toBe("degraded");
    expect(result.notes.join("\n")).toContain("operator_approve");
    await expect(store.getManifest("unsafe-real-bridge")).resolves.toBeNull();
  });

  it("degrades safely when the registry index is invalid", () => {
    const root = mkdtempSync(join(tmpdir(), "director-registry-invalid-"));
    tempRoots.push(root);
    writeFileSync(
      join(root, "index.json"),
      JSON.stringify({
        schemaVersion: "broken",
        updatedAt: "2026-04-13T10:00:00.000Z",
        entries: [],
      }),
      "utf8",
    );

    const loaded = loadDirectorAdapterRegistry(root);

    expect(loaded.documents).toEqual([]);
    expect(loaded.notes[0]).toContain("falling back to built-in adapters");
    expect(loaded.issues.length).toBeGreaterThan(0);
  });
});
