import { describe, expect, it } from "vitest";

import {
  createConversationRuntimeExecutablePluginLoader,
  createConversationRuntimePluginHotLoadPlan,
  createConversationRuntimePluginSdkRegistration,
} from "../src/index.js";

describe("conversation runtime plugin SDK and hot-load contract", () => {
  it("creates an SDK registration from an internal provider/tool manifest without direct store access", () => {
    const registration = createConversationRuntimePluginSdkRegistration({
      manifest: {
        id: "tool.filesystem-read",
        kind: "tool",
        version: "0.1.0",
        entrypoint: "./dist/index.js",
        displayName: "Filesystem Read Tool",
        description: "Registers the workspace-scoped filesystem.read_text tool.",
        capabilities: ["tool.register", "filesystem.read"],
      },
      tools: [
        {
          name: "filesystem.read_text",
          capabilityId: "filesystem.read",
          readOnly: true,
        },
      ],
    });

    expect(registration).toMatchObject({
      schemaVersion: "conversation-runtime.plugin-sdk-registration.v1",
      pluginId: "tool-filesystem-read",
      sourceManifestKind: "internal-plugin",
      entrypoint: "./dist/index.js",
      contractPlan: {
        status: "admissible",
        boundaries: {
          directStoreAccessAllowed: false,
          requiresPolicyGate: false,
          requiresApprovalForWrites: false,
        },
        externalToolManifests: [
          expect.objectContaining({
            id: "tool-filesystem-read",
            source: "plugin",
            metadata: expect.objectContaining({
              pluginToolNames: ["filesystem.read_text"],
              directStoreAccessAllowed: false,
            }),
          }),
        ],
      },
      loadPlan: {
        status: "ready",
        mode: "hot-load",
        requiresOperatorApproval: false,
        registryTargets: ["tool-registry"],
        directCodeExecutionAllowed: false,
      },
    });
  });

  it("blocks hot-load when the plugin asks for internal store access", () => {
    const registration = createConversationRuntimePluginSdkRegistration({
      manifest: {
        id: "bad.memory",
        kind: "provider",
        version: "0.1.0",
        entrypoint: "./dist/index.js",
        displayName: "Bad Memory Provider",
        capabilities: ["provider.register", "memory.write"],
      },
      directStoreAccess: true,
      storeImports: ["src/stores/director-store.ts"],
    });
    const loadPlan = createConversationRuntimePluginHotLoadPlan(registration.contractPlan, {
      entrypoint: "./dist/index.js",
    });

    expect(registration.contractPlan).toMatchObject({
      status: "blocked",
      issues: expect.arrayContaining([
        expect.objectContaining({ code: "direct-store-access-forbidden" }),
        expect.objectContaining({ code: "internal-store-import-forbidden" }),
      ]),
    });
    expect(loadPlan).toMatchObject({
      status: "blocked",
      directCodeExecutionAllowed: false,
      blockers: expect.arrayContaining([expect.objectContaining({ code: "contract-blocked" })]),
    });
  });

  it("requires operator approval for write-capable hot-load plans and keeps registry targets explicit", () => {
    const registration = createConversationRuntimePluginSdkRegistration({
      manifest: {
        id: "provider.scripted",
        kind: "provider",
        version: "0.1.0",
        entrypoint: "./dist/index.js",
        displayName: "Scripted Golden Path Provider",
        capabilities: ["provider.register", "provider.scripted", "memory.write"],
      },
      providers: [
        {
          id: "scripted",
          contracts: {
            modelProviders: ["scripted"],
          },
        },
      ],
      memoryProviders: [
        {
          id: "scripted-memory",
          kind: "semantic-memory",
          sessionScoped: true,
          directStoreAccessAllowed: false,
        },
      ],
      capabilities: [
        {
          id: "memory.write",
          label: "Memory write",
          readOnly: false,
          requiresApproval: true,
        },
      ],
    });

    expect(registration.loadPlan).toMatchObject({
      status: "requires-approval",
      registryTargets: ["provider-registry", "memory-port"],
      requiresOperatorApproval: true,
      directCodeExecutionAllowed: false,
      approvalReasons: ["write-capability"],
    });
  });

  it("loads an executable plugin through a sandboxed registration boundary", async () => {
    const loader = createConversationRuntimeExecutablePluginLoader({
      trustedEntrypointRoots: ["/workspace/plugins"],
      loadModule: async (entrypoint) => ({
        register: async (context) => {
          context.registerTool({
            name: "filesystem.read_text",
            capabilityId: "filesystem.read",
            readOnly: true,
          });
          return {
            manifest: {
              id: "tool.filesystem-read",
              kind: "tool",
              version: "0.1.0",
              entrypoint,
              displayName: "Filesystem Read Tool",
              capabilities: ["tool.register", "filesystem.read"],
            },
          };
        },
      }),
    });

    const result = await loader.load({
      manifest: {
        id: "tool.filesystem-read",
        kind: "tool",
        version: "0.1.0",
        entrypoint: "/workspace/plugins/filesystem-read/index.js",
        displayName: "Filesystem Read Tool",
        capabilities: ["tool.register", "filesystem.read"],
      },
      sourceTrust: { status: "trusted-plugin", label: "Reviewed local plugin" },
    });

    expect(result).toMatchObject({
      ok: true,
      schemaVersion: "conversation-runtime.executable-plugin-load-result.v1",
      pluginId: "tool-filesystem-read",
      entrypoint: "/workspace/plugins/filesystem-read/index.js",
      sandboxBoundary: {
        directStoreAccessAllowed: false,
        allowedRegistryTargets: ["tool-registry"],
        trustedEntrypoint: true,
      },
      registration: {
        loadPlan: {
          status: "ready",
          directCodeExecutionAllowed: false,
          registryTargets: ["tool-registry"],
        },
        contractPlan: {
          status: "admissible",
          externalToolManifests: [
            expect.objectContaining({
              source: "plugin",
              metadata: expect.objectContaining({
                pluginToolNames: ["filesystem.read_text"],
                directStoreAccessAllowed: false,
              }),
            }),
          ],
        },
      },
      registryPatch: {
        toolManifests: expect.arrayContaining([
          expect.objectContaining({ id: "tool-filesystem-read", source: "plugin" }),
        ]),
        providerManifests: [],
        memoryProviders: [],
        externalKnowledgeConnectors: [],
      },
    });
  });

  it("blocks executable plugin load outside trusted roots or with direct store access", async () => {
    const loader = createConversationRuntimeExecutablePluginLoader({
      trustedEntrypointRoots: ["/workspace/plugins"],
      loadModule: async () => {
        throw new Error("loader must not import untrusted entrypoint");
      },
    });

    const untrusted = await loader.load({
      manifest: {
        id: "bad.memory",
        kind: "memory",
        version: "0.1.0",
        entrypoint: "/tmp/bad-plugin/index.js",
        displayName: "Bad Memory",
        capabilities: ["memory.write"],
      },
      directStoreAccess: true,
      storeImports: ["src/stores/director-store.ts"],
    });

    expect(untrusted).toMatchObject({
      ok: false,
      pluginId: "bad-memory",
      registration: {
        contractPlan: {
          status: "blocked",
          issues: expect.arrayContaining([
            expect.objectContaining({ code: "direct-store-access-forbidden" }),
            expect.objectContaining({ code: "internal-store-import-forbidden" }),
          ]),
        },
      },
      sandboxBoundary: {
        directStoreAccessAllowed: false,
        trustedEntrypoint: false,
      },
      blockers: expect.arrayContaining([
        expect.objectContaining({ code: "untrusted-entrypoint" }),
        expect.objectContaining({ code: "contract-blocked" }),
      ]),
    });
  });
});
