import { describe, expect, test } from "vitest";

import {
  type PluginRuntimeManifestV1,
  createPluginManifestRegistry,
  planPluginCatalogActivation,
  resolveEffectivePluginCatalog,
} from "../src/index.js";

describe("plugin manifest registry", () => {
  test("merges manifests by source priority and exposes effective catalog status", () => {
    const bundledProvider: PluginRuntimeManifestV1 = {
      schemaVersion: "hotflow.plugin-manifest.v1",
      id: "provider.openai",
      version: "1.0.0",
      displayName: "OpenAI Bundled",
      kind: "provider",
      enabledByDefault: true,
      sourceTrust: { status: "official", reason: "bundled with Director" },
      activation: { onStartup: true, capabilities: ["provider:chat"] },
      setup: {
        providers: [
          {
            id: "openai",
            authMethods: ["api_key"],
            envVars: ["OPENAI_API_KEY"],
          },
        ],
      },
      contracts: { providers: ["chat.completions"] },
      uiHints: { setupLabel: "OpenAI" },
    };
    const workspaceProvider: PluginRuntimeManifestV1 = {
      ...bundledProvider,
      version: "1.1.0",
      displayName: "OpenAI Workspace",
      origin: { kind: "workspace", path: "/workspace/plugins/openai/plugin.json" },
      sourceTrust: { status: "verified", reason: "workspace override" },
    };
    const userProvider: PluginRuntimeManifestV1 = {
      ...bundledProvider,
      version: "1.2.0",
      displayName: "OpenAI User",
      origin: { kind: "user", path: "/Users/example/.hotflow/plugins/openai/plugin.json" },
      sourceTrust: { status: "local", reason: "user override" },
    };
    const registry = createPluginManifestRegistry({
      bundled: [bundledProvider],
      workspace: [workspaceProvider],
      user: [userProvider],
      disabledPluginIds: ["tool.disabled"],
    });

    const catalog = resolveEffectivePluginCatalog(registry);

    expect(catalog.schemaVersion).toBe("hotflow.plugin-effective-catalog.v1");
    expect(catalog.items).toHaveLength(1);
    expect(catalog.items[0]).toMatchObject({
      pluginId: "provider.openai",
      status: "active",
      effectiveSource: "user",
      manifest: {
        displayName: "OpenAI User",
        version: "1.2.0",
      },
      overriddenSources: ["workspace", "bundled"],
      activation: expect.objectContaining({ onStartup: true }),
      setup: expect.objectContaining({
        providers: [
          expect.objectContaining({
            id: "openai",
            authMethods: ["api_key"],
            envVars: ["OPENAI_API_KEY"],
          }),
        ],
      }),
      contracts: { providers: ["chat.completions"] },
      uiHints: { setupLabel: "OpenAI" },
      sourceTrust: { status: "local", reason: "user override" },
    });
  });

  test("marks blocked manifests and keeps them out of the active effective view", () => {
    const validTool: PluginRuntimeManifestV1 = {
      schemaVersion: "hotflow.plugin-manifest.v1",
      id: "tool.read",
      version: "1.0.0",
      displayName: "Read Tool",
      kind: "tool",
      tools: [{ name: "tool.read", readOnly: true }],
      sandboxPolicy: { filesystem: "read-only" },
    };

    const registry = createPluginManifestRegistry({
      bundled: [
        validTool,
        {
          schemaVersion: "hotflow.plugin-manifest.v1",
          id: "bad plugin id",
          version: "1.0.0",
          displayName: "Bad",
          kind: "tool",
          directStoreAccess: true,
        },
      ],
    });

    const catalog = resolveEffectivePluginCatalog(registry);

    expect(catalog.items).toEqual([
      expect.objectContaining({
        pluginId: "bad plugin id",
        status: "blocked",
        issues: [
          expect.objectContaining({ code: "invalid-plugin-id" }),
          expect.objectContaining({ code: "direct-store-access-forbidden" }),
        ],
      }),
      expect.objectContaining({
        pluginId: "tool.read",
        status: "active",
        manifest: expect.objectContaining({
          tools: [{ name: "tool.read", readOnly: true }],
        }),
      }),
    ]);
    expect(catalog.activeItems.map((item) => item.pluginId)).toEqual(["tool.read"]);
  });

  test("creates an activation and setup readiness plan from the effective catalog", () => {
    const registry = createPluginManifestRegistry({
      bundled: [
        {
          schemaVersion: "hotflow.plugin-manifest.v1",
          id: "provider.ready",
          version: "1.0.0",
          displayName: "Ready Provider",
          kind: "provider",
          activation: { onStartup: true, providers: ["ready"] },
          setup: {
            providers: [
              {
                id: "ready",
                authMethods: ["api_key"],
                envVars: ["READY_API_KEY"],
              },
            ],
          },
        },
        {
          schemaVersion: "hotflow.plugin-manifest.v1",
          id: "provider.needs-setup",
          version: "1.0.0",
          displayName: "Needs Setup Provider",
          kind: "provider",
          activation: { onStartup: true, providers: ["needs-setup"] },
          setup: {
            providers: [
              {
                id: "needs-setup",
                authMethods: ["api_key"],
                envVars: ["NEEDS_SETUP_API_KEY"],
                configKeys: ["needsSetup.model"],
              },
            ],
          },
        },
        {
          schemaVersion: "hotflow.plugin-manifest.v1",
          id: "tool.disabled",
          version: "1.0.0",
          displayName: "Disabled Tool",
          kind: "tool",
          activation: { tools: ["tool.disabled"] },
        },
        {
          schemaVersion: "hotflow.plugin-manifest.v1",
          id: "bad plugin id",
          version: "1.0.0",
          displayName: "Bad Tool",
          kind: "tool",
          directStoreAccess: true,
          activation: { tools: ["bad.tool"] },
        },
      ],
      disabledPluginIds: ["tool.disabled"],
    });
    const catalog = resolveEffectivePluginCatalog(registry);

    const plan = planPluginCatalogActivation(catalog, {
      env: { READY_API_KEY: "set" },
      config: {},
    });

    expect(plan.schemaVersion).toBe("hotflow.plugin-activation-plan.v1");
    expect(plan.activatableItems.map((item) => item.pluginId)).toEqual(["provider.ready"]);
    expect(plan.items).toEqual([
      expect.objectContaining({
        pluginId: "bad plugin id",
        status: "blocked",
        canActivate: false,
        reasonCodes: ["blocked"],
      }),
      expect.objectContaining({
        pluginId: "provider.needs-setup",
        status: "needs_setup",
        canActivate: false,
        missingSetup: [
          {
            providerId: "needs-setup",
            envVars: ["NEEDS_SETUP_API_KEY"],
            configKeys: ["needsSetup.model"],
          },
        ],
        reasonCodes: ["missing_env", "missing_config"],
      }),
      expect.objectContaining({
        pluginId: "provider.ready",
        status: "ready",
        canActivate: true,
        activation: { onStartup: true, providers: ["ready"] },
        reasonCodes: [],
      }),
      expect.objectContaining({
        pluginId: "tool.disabled",
        status: "disabled",
        canActivate: false,
        reasonCodes: ["disabled"],
      }),
    ]);
  });
});
