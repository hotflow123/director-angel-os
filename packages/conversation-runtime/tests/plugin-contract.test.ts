import { describe, expect, it } from "vitest";

import {
  createConversationRuntimePluginContractPlan,
  validateConversationRuntimePluginManifest,
} from "../src/index.js";

describe("conversation runtime plugin contract", () => {
  it("projects one plugin manifest into tool, provider, memory, and export connector contracts", () => {
    const plan = createConversationRuntimePluginContractPlan({
      schemaVersion: "conversation-runtime.plugin-manifest.v1",
      id: "brave-memory-export",
      version: "1.0.0",
      displayName: "Brave Memory Export",
      sourceTrust: { status: "trusted-plugin", label: "Reviewed local plugin" },
      capabilities: [
        { id: "web.search", label: "Web search", readOnly: true },
        { id: "memory.write", label: "Memory write", readOnly: false, requiresApproval: true },
      ],
      tools: [
        {
          name: "brave_search",
          capabilityId: "web.search",
          readOnly: true,
        },
      ],
      providers: [
        {
          id: "brave",
          contracts: { webSearchProviders: ["brave"] },
          auth: { methods: ["api-key"], envVars: ["BRAVE_API_KEY"] },
          uiHints: {
            "webSearch.apiKey": {
              label: "Brave API Key",
              sensitive: true,
              placeholder: "env:BRAVE_API_KEY",
            },
          },
        },
      ],
      memory: {
        providers: [
          {
            id: "honcho",
            kind: "semantic-memory",
            sessionScoped: true,
            contracts: { memoryProviders: ["honcho"] },
          },
        ],
      },
      externalKnowledge: {
        connectors: [
          {
            id: "notebooklm",
            targetKind: "export_package",
            stableApi: false,
          },
        ],
      },
      installPolicy: { supported: true, defaultMode: "manual", requiresExplicitExecute: true },
    });

    expect(plan).toMatchObject({
      schemaVersion: "conversation-runtime.plugin-contract-plan.v1",
      pluginId: "brave-memory-export",
      status: "admissible",
      summary: expect.stringContaining("tools=1"),
      issueCount: 0,
      boundaries: expect.objectContaining({
        directStoreAccessAllowed: false,
        requiresPolicyGate: true,
        requiresApprovalForWrites: true,
      }),
      externalToolManifests: [
        expect.objectContaining({
          id: "brave-memory-export",
          source: "plugin",
          kind: "tool-source",
          capabilities: expect.arrayContaining([
            expect.objectContaining({ id: "web.search", readOnly: true }),
            expect.objectContaining({ id: "memory.write", readOnly: false }),
          ]),
          metadata: expect.objectContaining({
            pluginId: "brave-memory-export",
            pluginManifestSchemaVersion: "conversation-runtime.plugin-manifest.v1",
            pluginToolNames: ["brave_search"],
          }),
        }),
      ],
      externalProviderManifests: [
        expect.objectContaining({
          id: "brave",
          enabledByDefault: false,
          capabilities: expect.arrayContaining(["web.search", "provider.brave"]),
          auth: {
            methods: ["api-key"],
            envVars: ["BRAVE_API_KEY"],
          },
          contracts: { webSearchProviders: ["brave"] },
        }),
      ],
      memoryProviderContracts: [
        expect.objectContaining({
          id: "honcho",
          directStoreAccessAllowed: false,
          contracts: { memoryProviders: ["honcho"] },
        }),
      ],
      externalKnowledgeConnectorContracts: [
        expect.objectContaining({
          id: "notebooklm",
          targetKind: "export_package",
          stableApi: false,
          uploadPackageRequired: true,
        }),
      ],
    });
  });

  it("fails closed when a plugin declares direct internal store access", () => {
    const issues = validateConversationRuntimePluginManifest({
      schemaVersion: "conversation-runtime.plugin-manifest.v1",
      id: "bad-store-plugin",
      version: "1.0.0",
      displayName: "Bad Store Plugin",
      capabilities: [{ id: "memory.write", label: "Memory write", readOnly: false }],
      tools: [],
      internalStores: ["director-memory"],
      storeImports: ["src/stores/director-store.ts"],
      directStoreAccess: true,
    });
    const plan = createConversationRuntimePluginContractPlan({
      schemaVersion: "conversation-runtime.plugin-manifest.v1",
      id: "bad-store-plugin",
      version: "1.0.0",
      displayName: "Bad Store Plugin",
      capabilities: [{ id: "memory.write", label: "Memory write", readOnly: false }],
      tools: [],
      internalStores: ["director-memory"],
      directStoreAccess: true,
    });

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "direct-store-access-forbidden" }),
        expect.objectContaining({ code: "internal-store-import-forbidden" }),
      ]),
    );
    expect(plan).toMatchObject({
      status: "blocked",
      issueCount: expect.any(Number),
      externalToolManifests: [],
      externalProviderManifests: [],
      boundaries: expect.objectContaining({
        directStoreAccessAllowed: false,
      }),
    });
  });
});
