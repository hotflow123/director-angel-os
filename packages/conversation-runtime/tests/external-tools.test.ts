import { Buffer } from "node:buffer";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  createAgentOsExtensionMatrix,
  createBuiltInAgentOsExtensionManifests,
} from "@hotflow/agent-os-extensions";
import {
  type AgentOsSandboxBackendAdmission,
  type AgentOsSandboxCommandExecutionResult,
  type AgentOsSandboxExecutionPlan,
  createAgentOsHostSandboxBackendAdapter,
  summarizeAgentOsProcessCapabilityLedger,
} from "@hotflow/agent-os-sandbox";
import { PolicyRuntime } from "@hotflow/policy-runtime";

import {
  ExternalToolExecutionQueue,
  ExternalToolRegistry,
  createBuiltInMediaAnalysisProviderExternalToolRegistration,
  createBuiltInMediaUnderstandingExternalToolRegistration,
  createBuiltinBrowserTools,
  createBuiltinWebTools,
  createComfyUiProviderRegistration,
  createConversationRuntimeMcpTools,
  createExternalProviderInstallPlan,
  createExternalSystemControlRequest,
  createExternalToolCatalog,
  createExternalToolControlPlane,
  createExternalToolManifestFromModelTool,
  createExternalToolManifestsFromAgentOsExtensionMatrix,
  createExternalToolProviderCapabilities,
  createExternalToolProviderManifest,
  createExternalToolProviderManifestFromModelTools,
  createExternalToolRegistryFromModelTools,
  createExternalToolsCatalogRpcResult,
  createExternalToolsEffectiveRpcResult,
  createFileConversationRuntimeApprovalLedger,
  createFileConversationRuntimeExternalArtifactStore,
  createFutureCliProviderRegistrationFromManifest,
  createMoyinProviderRegistration,
  createOpenCliAdapterProposalFromFailures,
  createOpenCliExternalToolRegistration,
  createOpenCliRunnerEnvironment,
  createWorkflowInteropPackage,
  evaluateMoyinProductionReadiness,
  evaluateMoyinProjectReadiness,
  explainWorkflowInteropConversion,
  invokeExternalSystemControl,
  invokeExternalTool,
  invokeExternalToolControlPlane,
  resolveEffectiveModelTools,
  validateFutureCliProviderManifest,
  validateWorkflowInteropPackage,
} from "../src/index.js";
import { hashConversationRuntimeToolArgs } from "../src/tool-hooks.js";

describe("external tools", () => {
  it("registers Moyin as a P0-Alpha provider with structured health and gated submit", async () => {
    const calls: unknown[] = [];
    const registry = new ExternalToolRegistry({ nowMs: () => 1_778_000_000_000 });
    registry.register(
      createMoyinProviderRegistration({
        runner: ({ binary, args }) => {
          calls.push({ binary, args });
          return {
            exitCode: 0,
            stdout: JSON.stringify({
              service: "moyin-control-plane",
              cliVersion: "0.5.2",
              protocolVersion: "0.13.0",
              baseUrl: "http://127.0.0.1:4100",
            }),
            stderr: "",
          };
        },
      }),
    );

    const controlPlane = createExternalToolControlPlane(registry);
    await expect(createExternalToolsCatalogRpcResult(controlPlane)).resolves.toMatchObject({
      catalog: expect.arrayContaining([
        expect.objectContaining({
          id: "moyin.provider",
          providerId: "moyin",
          capabilities: expect.arrayContaining([
            expect.objectContaining({
              id: "health",
              readOnly: true,
              metadata: expect.objectContaining({ capability: "moyin.health" }),
            }),
            expect.objectContaining({
              id: "capabilities.handshake",
              readOnly: true,
              metadata: expect.objectContaining({ capability: "moyin.capabilities.handshake" }),
            }),
            expect.objectContaining({
              id: "discover.templates",
              readOnly: true,
              metadata: expect.objectContaining({ capability: "moyin.discover.templates" }),
            }),
            expect.objectContaining({
              id: "workflow.import",
              requiresApproval: true,
              metadata: expect.objectContaining({ capability: "moyin.workflow.import" }),
            }),
            expect.objectContaining({
              id: "workflow.draft",
              readOnly: true,
              metadata: expect.objectContaining({ capability: "moyin.workflow.draft" }),
            }),
            expect.objectContaining({
              id: "sealed.submit",
              readOnly: false,
              requiresApproval: true,
              metadata: expect.objectContaining({ capability: "moyin.sealed.submit" }),
            }),
            expect.objectContaining({
              id: "task.cancel",
              readOnly: false,
              requiresApproval: true,
              metadata: expect.objectContaining({ capability: "moyin.task.cancel" }),
            }),
            expect.objectContaining({
              id: "task.list",
              readOnly: true,
              metadata: expect.objectContaining({ capability: "moyin.task.list" }),
            }),
            expect.objectContaining({
              id: "workflow-run.list",
              readOnly: true,
              metadata: expect.objectContaining({ capability: "moyin.workflow_run.list" }),
            }),
            expect.objectContaining({
              id: "workflow-run.create",
              readOnly: true,
              metadata: expect.objectContaining({ capability: "moyin.workflow_run.create" }),
            }),
            expect.objectContaining({
              id: "workflow-run.get",
              readOnly: true,
              metadata: expect.objectContaining({ capability: "moyin.workflow_run.get" }),
            }),
            expect.objectContaining({
              id: "workflow-run.steps",
              readOnly: true,
              metadata: expect.objectContaining({ capability: "moyin.workflow_run.steps" }),
            }),
            expect.objectContaining({
              id: "workflow-run.advance",
              readOnly: false,
              requiresApproval: true,
              metadata: expect.objectContaining({ capability: "moyin.workflow_run.advance" }),
            }),
            expect.objectContaining({
              id: "workflow-run.cancel",
              readOnly: false,
              requiresApproval: true,
              metadata: expect.objectContaining({ capability: "moyin.workflow_run.cancel" }),
            }),
          ]),
          metadata: expect.objectContaining({
            schemaVersion: "director.moyin-provider.v1",
            phase: "p0-alpha",
            p0MvpOnly: false,
            supportsSubmit: true,
          }),
        }),
      ]),
    });
    await expect(
      createExternalToolsEffectiveRpcResult(controlPlane, { includeUnavailable: true }),
    ).resolves.toMatchObject({
      effectiveCount: 1,
      tools: [
        expect.objectContaining({
          id: "moyin.provider",
          status: "ready",
          canInvoke: true,
          doctor: expect.objectContaining({
            details: expect.objectContaining({
              version: expect.objectContaining({
                cli: "0.5.2",
                controlPlane: "0.13.0",
                compatibility: "compatible",
              }),
            }),
          }),
        }),
      ],
    });
    expect(calls).toEqual([{ binary: "moyin", args: ["status", "--json"] }]);
  });

  it("accepts the real Moyin control-plane status shape without degrading the provider", async () => {
    const registry = new ExternalToolRegistry({ nowMs: () => 1_778_000_000_000 });
    registry.register(
      createMoyinProviderRegistration({
        runner: () => ({
          exitCode: 0,
          stdout: JSON.stringify({
            session: {
              id: "session-1",
              token: "moyin-control-plane-secret-token",
            },
            health: {
              ok: true,
              service: "moyin-control-plane",
              protocolVersion: "0.13.0",
              appVersion: "0.2.7",
            },
          }),
          stderr: "",
        }),
      }),
    );

    const result = await createExternalToolsEffectiveRpcResult(
      createExternalToolControlPlane(registry),
      {
        includeUnavailable: true,
      },
    );
    expect(result).toMatchObject({
      effectiveCount: 1,
      tools: [
        expect.objectContaining({
          id: "moyin.provider",
          status: "ready",
          canInvoke: true,
          doctor: expect.objectContaining({
            details: expect.objectContaining({
              version: expect.objectContaining({
                app: "0.2.7",
                controlPlane: "0.13.0",
                compatibility: "compatible",
              }),
            }),
          }),
        }),
      ],
    });
    expect(JSON.stringify(result)).not.toContain("moyin-control-plane-secret-token");
  });

  it("declares Moyin operation policy metadata for every provider capability", async () => {
    const registry = new ExternalToolRegistry({ nowMs: () => 1_778_000_000_000 });
    registry.register(
      createMoyinProviderRegistration({
        runner: () => ({
          exitCode: 0,
          stdout: JSON.stringify({ cliVersion: "0.5.2", protocolVersion: "0.13.0" }),
          stderr: "",
        }),
      }),
    );

    const catalog = await createExternalToolsCatalogRpcResult(
      createExternalToolControlPlane(registry),
    );
    const moyin = catalog.catalog.find((entry) => entry.id === "moyin.provider");
    expect(moyin).toBeDefined();
    expect(moyin).toMatchObject({
      metadata: expect.objectContaining({
        operationManifest: expect.objectContaining({
          "adapter.resolve": expect.objectContaining({
            referencePatterns: expect.arrayContaining(["openclaw.provider-contract"]),
          }),
          "task.template.build": expect.objectContaining({
            riskLevel: "low",
            approvalPolicy: "none",
            outputPolicy: "preview-or-artifact-ref",
          }),
        }),
      }),
      capabilities: expect.arrayContaining([
        expect.objectContaining({
          id: "adapter.resolve",
          readOnly: true,
          metadata: expect.objectContaining({
            riskLevel: "low",
            approvalPolicy: "none",
            retryPolicy: expect.objectContaining({ executor: "orchestrator" }),
            referencePatterns: expect.arrayContaining(["openclaw.provider-contract"]),
          }),
        }),
        expect.objectContaining({
          id: "adapter.image-execution",
          readOnly: true,
          metadata: expect.objectContaining({
            riskLevel: "low",
            outputPolicy: "preview-or-artifact-ref",
          }),
        }),
        expect.objectContaining({
          id: "adapter.video-execution",
          readOnly: true,
          metadata: expect.objectContaining({
            riskLevel: "low",
            outputPolicy: "preview-or-artifact-ref",
          }),
        }),
        expect.objectContaining({
          id: "task.template.get",
          readOnly: true,
          metadata: expect.objectContaining({
            riskLevel: "low",
            artifactPolicy: "none",
          }),
        }),
        expect.objectContaining({
          id: "task.template.build",
          readOnly: true,
          metadata: expect.objectContaining({
            riskLevel: "low",
            outputPolicy: "preview-or-artifact-ref",
          }),
        }),
      ]),
    });

    for (const capability of moyin?.capabilities ?? []) {
      expect(capability.metadata).toEqual(
        expect.objectContaining({
          riskLevel: expect.any(String),
          approvalPolicy: expect.any(String),
          retryPolicy: expect.any(Object),
          concurrencyKey: expect.any(String),
          outputPolicy: expect.any(String),
          artifactPolicy: expect.any(String),
          referencePatterns: expect.any(Array),
        }),
      );
    }
  });

  it("invokes Moyin capability handshake through read-only discovery probes", async () => {
    const calls: unknown[] = [];
    const registry = new ExternalToolRegistry({ nowMs: () => 1_778_000_000_000 });
    registry.register(
      createMoyinProviderRegistration({
        runner: ({ binary, args }) => {
          calls.push({ binary, args });
          if (args.join(" ") === "status --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({ cliVersion: "0.5.2", protocolVersion: "0.13.0" }),
              stderr: "",
            };
          }
          if (args.join(" ") === "project list --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({ items: [{ projectId: "project-1" }], total: 1 }),
              stderr: "",
            };
          }
          if (args.join(" ") === "config providers --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({ items: [{ providerId: "seedance" }], total: 1 }),
              stderr: "",
            };
          }
          if (args.join(" ") === "config models --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({ items: [{ modelId: "seedance-pro" }], total: 1 }),
              stderr: "",
            };
          }
          if (args.join(" ") === "task template list --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({ items: [{ templateId: "director.scene-image" }], total: 1 }),
              stderr: "",
            };
          }
          return { exitCode: 1, stdout: "", stderr: "unexpected command" };
        },
      }),
    );

    const result = await invokeExternalTool(registry, {
      toolId: "moyin.provider",
      operationId: "capabilities.handshake",
    });

    expect(result).toMatchObject({
      ok: true,
      status: "success",
      content: "Moyin capability handshake ready.",
      output: {
        schemaVersion: "director.external-tool.v1",
        status: "success",
        provider: "moyin",
        operation: "capabilities.handshake",
        output: expect.objectContaining({
          schemaVersion: "director.moyin-capability-handshake.v1",
          status: "ready",
          availableCapabilities: [
            "health",
            "discover.projects",
            "discover.providers",
            "discover.models",
            "discover.templates",
          ],
          missingCapabilities: [],
        }),
      },
    });
    expect(calls).toEqual([
      { binary: "moyin", args: ["status", "--json"] },
      { binary: "moyin", args: ["status", "--json"] },
      { binary: "moyin", args: ["project", "list", "--json"] },
      { binary: "moyin", args: ["config", "providers", "--json"] },
      { binary: "moyin", args: ["config", "models", "--json"] },
      { binary: "moyin", args: ["task", "template", "list", "--json"] },
    ]);
  });

  it("keeps Moyin capability handshake usable when optional discovery probes degrade", async () => {
    const registry = new ExternalToolRegistry({ nowMs: () => 1_778_000_000_000 });
    registry.register(
      createMoyinProviderRegistration({
        runner: ({ args }) => {
          if (args.join(" ") === "config models --json") {
            return { exitCode: 1, stdout: "", stderr: "models are not configured" };
          }
          return {
            exitCode: 0,
            stdout: JSON.stringify({ cliVersion: "0.5.2", protocolVersion: "0.13.0", items: [] }),
            stderr: "",
          };
        },
      }),
    );

    const result = await invokeExternalTool(registry, {
      toolId: "moyin.provider",
      operationId: "capabilities.handshake",
    });

    expect(result).toMatchObject({
      ok: true,
      status: "success",
      content: "Moyin capability handshake degraded.",
      output: {
        schemaVersion: "director.external-tool.v1",
        status: "success",
        provider: "moyin",
        operation: "capabilities.handshake",
        output: expect.objectContaining({
          status: "degraded",
          availableCapabilities: expect.arrayContaining(["health", "discover.providers"]),
          missingCapabilities: ["discover.models"],
          checks: expect.arrayContaining([
            expect.objectContaining({
              capability: "discover.models",
              status: "degraded",
              error: expect.objectContaining({
                code: "MOYIN_CLI_COMMAND_FAILED",
                message: "models are not configured",
              }),
            }),
          ]),
        }),
      },
    });
  });

  it("reports Moyin production readiness at the approval gate without advancing or submitting", async () => {
    const calls: string[] = [];
    const root = mkdtempSync(join(tmpdir(), "angel-moyin-readiness-"));
    const readinessReportDirectory = join(root, "readiness");
    const artifactStore = createFileConversationRuntimeExternalArtifactStore({
      rootPath: join(root, "artifact-store"),
      nowMs: () => 1_778_000_000_000,
    });
    const registry = new ExternalToolRegistry({ nowMs: () => 1_778_000_000_000 });
    registry.register(
      createMoyinProviderRegistration({
        runner: ({ args }) => {
          const command = args.join(" ");
          calls.push(command);
          if (command === "status --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({ cliVersion: "0.5.2", protocolVersion: "0.13.0" }),
              stderr: "",
            };
          }
          if (command === "project list --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                activeProjectId: "project-1",
                items: [{ id: "project-1", name: "测试项目", active: true }],
                total: 1,
              }),
              stderr: "",
            };
          }
          if (command === "project get project-1 --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                id: "project-1",
                name: "测试项目",
                stores: [
                  { key: "_p/project-1/script", storeName: "script", sizeBytes: 4096 },
                  { key: "_p/project-1/sclass", storeName: "sclass", sizeBytes: 8192 },
                ],
              }),
              stderr: "",
            };
          }
          if (command === "project store get --project project-1 --store script --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                projectId: "project-1",
                key: "_p/project-1/script",
                storeName: "script",
                source: "storage-bridge",
                state: {
                  activeProjectId: "project-1",
                  projectData: {
                    parseStatus: "ready",
                    episodeRawScripts: [{ episodeIndex: 1, content: "第一集剧本" }],
                    scriptData: { scenes: [{ id: "scene-1" }] },
                    shots: [{ id: "shot-1" }],
                  },
                },
              }),
              stderr: "",
            };
          }
          if (command === "project store get --project project-1 --store sclass --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                projectId: "project-1",
                key: "_p/project-1/sclass",
                storeName: "sclass",
                source: "storage-bridge",
                state: {
                  activeProjectId: "project-1",
                  projectData: {
                    splitScenes: [{ id: 1 }],
                    shotGroups: [{ id: "group-1", sceneIds: [1] }],
                    sceneAnchors: [{ id: "anchor-1" }],
                    lastAdaptationSummary: {
                      profileSnapshot: {
                        rhythmEngine: { enabled: true, preferredStrategy: "auto" },
                      },
                    },
                  },
                },
              }),
              stderr: "",
            };
          }
          if (command === "config providers --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({ providers: [{ id: "provider-1", hasApiKey: true }] }),
              stderr: "",
            };
          }
          if (command === "config models --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({ items: [{ model: "video-model-1" }] }),
              stderr: "",
            };
          }
          if (command === "task template list --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({ items: [{ templateId: "script.generate-from-idea" }] }),
              stderr: "",
            };
          }
          if (command === "workflow list --project project-1 --json") {
            return { exitCode: 0, stdout: JSON.stringify({ items: [] }), stderr: "" };
          }
          if (command === "task list --project project-1 --json") {
            return { exitCode: 0, stdout: JSON.stringify({ items: [] }), stderr: "" };
          }
          if (command === "workflow-run list --project project-1 --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({ items: [{ runId: "run-1" }] }),
              stderr: "",
            };
          }
          if (command === "artifact list --project project-1 --json") {
            return { exitCode: 0, stdout: JSON.stringify({ items: [] }), stderr: "" };
          }
          if (command === "prompt list --project project-1 --json") {
            return { exitCode: 0, stdout: JSON.stringify({ items: [] }), stderr: "" };
          }
          if (command === "memory get --project project-1 --json") {
            return { exitCode: 0, stdout: JSON.stringify({ memory: {} }), stderr: "" };
          }
          if (command === "workflow-run steps run-1 --project project-1 --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                runId: "run-1",
                projectId: "project-1",
                steps: [
                  {
                    stepId: "character-1-portrait-image",
                    status: "ready",
                    requiresApproval: true,
                  },
                ],
              }),
              stderr: "",
            };
          }
          return { exitCode: 1, stdout: "", stderr: `unexpected command: ${command}` };
        },
      }),
    );

    const report = await evaluateMoyinProductionReadiness({
      registry,
      projectId: "project-1",
      runId: "run-1",
      turnId: "turn-readiness",
      sessionKey: "session-readiness",
      artifactStore,
      readinessReportDirectory,
    });

    expect(report).toMatchObject({
      schemaVersion: "director.moyin.production-readiness.v1",
      status: "waiting_for_approval",
      projectId: "project-1",
      runId: "run-1",
      effectiveNextAction: expect.objectContaining({
        kind: "build_sealed_request",
        stepId: "character-1-portrait-image",
        requiresApproval: true,
      }),
      mutation: {
        advanceAttempted: false,
        executeAttempted: false,
        submitAttempted: false,
      },
      metadata: expect.objectContaining({
        referencePatterns: expect.arrayContaining([
          "hermes.approval-queue",
          "openclaw.tool-policy",
        ]),
        approvalPacketAttempted: true,
        readinessArtifactPersisted: true,
      }),
      readinessArtifact: expect.objectContaining({
        id: "moyin-readiness:project-1:run-1",
        kind: "json",
        path: join(readinessReportDirectory, "project-1", "run-1.readiness.json"),
        metadata: expect.objectContaining({
          role: "production-readiness-report",
          status: "waiting_for_approval",
          effectiveNextAction: "build_sealed_request",
          advanceAttempted: false,
          executeAttempted: false,
          submitAttempted: false,
        }),
      }),
    });
    expect(report.gates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "provider-api-key", status: "passed" }),
        expect.objectContaining({ id: "model-catalog", status: "passed" }),
        expect.objectContaining({ id: "workflow-run", status: "passed" }),
        expect.objectContaining({ id: "run-next-action", status: "waiting" }),
        expect.objectContaining({ id: "artifact-package", status: "waiting" }),
      ]),
    );
    expect(calls).not.toContain(
      "workflow-run advance run-1 --project project-1 --step character-1-portrait-image --action build_sealed_request --json",
    );
    expect(calls.some((command) => command.includes("sealed submit"))).toBe(false);
    expect(artifactStore.listArtifacts({ providerId: "moyin", runId: "run-1" })).toEqual([
      expect.objectContaining({
        artifactId: "moyin-readiness:project-1:run-1",
        operationId: "workflow-run.production-readiness",
        projectId: "project-1",
        runId: "run-1",
        retention: "user_controlled",
        sensitivity: "internal",
      }),
    ]);
    expect(JSON.parse(readFileSync(report.readinessArtifact?.path ?? "", "utf8"))).toMatchObject({
      schemaVersion: "director.moyin.production-readiness.v1",
      status: "waiting_for_approval",
      mutation: {
        advanceAttempted: false,
        executeAttempted: false,
        submitAttempted: false,
      },
    });
  });

  it("surfaces missing Moyin provider API key in production readiness gates", async () => {
    const registry = new ExternalToolRegistry({ nowMs: () => 1_778_000_000_000 });
    registry.register(
      createMoyinProviderRegistration({
        runner: ({ args }) => {
          const command = args.join(" ");
          if (command === "config providers --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({ providers: [{ id: "provider-1", hasApiKey: false }] }),
              stderr: "",
            };
          }
          if (command === "project list --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                activeProjectId: "project-1",
                items: [{ id: "project-1", name: "测试项目", active: true }],
                total: 1,
              }),
              stderr: "",
            };
          }
          if (command === "project get project-1 --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({ id: "project-1", name: "测试项目", stores: [] }),
              stderr: "",
            };
          }
          if (command === "config models --json") {
            return { exitCode: 0, stdout: JSON.stringify({ items: [] }), stderr: "" };
          }
          return {
            exitCode: 0,
            stdout: JSON.stringify({ cliVersion: "0.5.2", protocolVersion: "0.13.0", items: [] }),
            stderr: "",
          };
        },
      }),
    );

    const report = await evaluateMoyinProductionReadiness({ registry });

    expect(report).toMatchObject({
      status: "blocked",
      blockerCode: "MOYIN_PROVIDER_API_KEY_REQUIRED",
      projectId: "project-1",
      mutation: {
        advanceAttempted: false,
        executeAttempted: false,
        submitAttempted: false,
      },
    });
    expect(report.gates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "provider-api-key", status: "blocked" }),
        expect.objectContaining({ id: "moyin-project", status: "passed" }),
        expect.objectContaining({ id: "model-catalog", status: "unknown" }),
      ]),
    );
  });

  it("blocks Moyin production readiness when no real Moyin project is selected", async () => {
    const registry = new ExternalToolRegistry({ nowMs: () => 1_778_000_000_000 });
    registry.register(
      createMoyinProviderRegistration({
        runner: ({ args }) => {
          const command = args.join(" ");
          if (command === "status --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({ cliVersion: "0.5.2", protocolVersion: "0.13.0" }),
              stderr: "",
            };
          }
          if (command === "project list --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({ activeProjectId: null, items: [], total: 0 }),
              stderr: "",
            };
          }
          if (command === "config providers --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({ providers: [{ id: "provider-1", hasApiKey: true }] }),
              stderr: "",
            };
          }
          if (command === "config models --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({ items: [{ modelId: "video-model-1" }] }),
              stderr: "",
            };
          }
          return {
            exitCode: 0,
            stdout: JSON.stringify({ items: [{ templateId: "script.generate-from-idea" }] }),
            stderr: "",
          };
        },
      }),
    );

    const report = await evaluateMoyinProductionReadiness({ registry });

    expect(report).toMatchObject({
      status: "blocked",
      blockerCode: "MOYIN_PROJECT_REQUIRED",
      mutation: {
        advanceAttempted: false,
        executeAttempted: false,
        submitAttempted: false,
      },
    });
    expect(report.gates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "moyin-project",
          status: "blocked",
          evidence: expect.objectContaining({
            blockerCode: "MOYIN_PROJECT_REQUIRED",
            activeProjectId: null,
            projectCount: 0,
          }),
        }),
      ]),
    );
  });

  it("blocks Moyin project readiness when the project lacks script and S-Class scoped stores", async () => {
    const calls: string[] = [];
    const registry = new ExternalToolRegistry({ nowMs: () => 1_778_000_000_000 });
    registry.register(
      createMoyinProviderRegistration({
        runner: ({ args }) => {
          const command = args.join(" ");
          calls.push(command);
          if (command === "status --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({ cliVersion: "0.5.2", protocolVersion: "0.13.0" }),
              stderr: "",
            };
          }
          if (command === "project list --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                activeProjectId: "project-1",
                items: [{ id: "project-1", name: "灌篮少女（演示）", active: true }],
                total: 1,
              }),
              stderr: "",
            };
          }
          if (command === "project get project-1 --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({ id: "project-1", name: "灌篮少女（演示）", stores: [] }),
              stderr: "",
            };
          }
          if (command === "config providers --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({ providers: [{ id: "provider-1", hasApiKey: true }] }),
              stderr: "",
            };
          }
          if (command === "config models --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({ items: [{ modelId: "video-model-1" }] }),
              stderr: "",
            };
          }
          if (command === "task template list --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({ items: [{ templateId: "script.generate-from-idea" }] }),
              stderr: "",
            };
          }
          if (command === "workflow-run list --project project-1 --json") {
            return { exitCode: 0, stdout: JSON.stringify({ items: [], total: 0 }), stderr: "" };
          }
          if (command === "task list --project project-1 --json") {
            return { exitCode: 0, stdout: JSON.stringify({ items: [], total: 0 }), stderr: "" };
          }
          if (command === "artifact list --project project-1 --json") {
            return { exitCode: 0, stdout: JSON.stringify({ items: [], total: 0 }), stderr: "" };
          }
          return { exitCode: 1, stdout: "", stderr: `unexpected command: ${command}` };
        },
      }),
    );

    const report = await evaluateMoyinProjectReadiness({ registry });

    expect(report).toMatchObject({
      schemaVersion: "director.moyin.project-readiness.v1",
      status: "blocked",
      blockerCode: "MOYIN_PROJECT_SCRIPT_REQUIRED",
      project: {
        projectId: "project-1",
        name: "灌篮少女（演示）",
        source: "active-project",
      },
      gates: expect.arrayContaining([
        expect.objectContaining({ id: "moyin-project", status: "passed" }),
        expect.objectContaining({ id: "provider-api-key", status: "passed" }),
        expect.objectContaining({ id: "model-catalog", status: "passed" }),
        expect.objectContaining({ id: "project-script", status: "blocked" }),
        expect.objectContaining({ id: "project-sclass", status: "blocked" }),
        expect.objectContaining({ id: "workflow-run", status: "passed" }),
        expect.objectContaining({ id: "task-ledger", status: "passed" }),
        expect.objectContaining({ id: "artifact-registry", status: "passed" }),
      ]),
      mutation: {
        projectCreateAttempted: false,
        workflowRunCreateAttempted: false,
        submitAttempted: false,
      },
    });
    expect(calls).toEqual([
      "status --json",
      "status --json",
      "project list --json",
      "config providers --json",
      "config models --json",
      "task template list --json",
      "project list --json",
      "project get project-1 --json",
      "workflow-run list --project project-1 --json",
      "task list --project project-1 --json",
      "artifact list --project project-1 --json",
    ]);
  });

  it("blocks Moyin project readiness when scoped store content cannot be read for hard validation", async () => {
    const calls: string[] = [];
    const registry = new ExternalToolRegistry({ nowMs: () => 1_778_000_000_000 });
    registry.register(
      createMoyinProviderRegistration({
        runner: ({ args }) => {
          const command = args.join(" ");
          calls.push(command);
          if (command === "status --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({ cliVersion: "0.5.2", protocolVersion: "0.13.0" }),
              stderr: "",
            };
          }
          if (command === "project list --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                activeProjectId: "project-1",
                items: [{ id: "project-1", name: "灌篮少女（演示）", active: true }],
                total: 1,
              }),
              stderr: "",
            };
          }
          if (command === "project get project-1 --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                id: "project-1",
                name: "灌篮少女（演示）",
                stores: [
                  { key: "_p/project-1/script", storeName: "script", sizeBytes: 4096 },
                  { key: "_p/project-1/sclass", storeName: "sclass", sizeBytes: 8192 },
                ],
              }),
              stderr: "",
            };
          }
          if (command === "config providers --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({ providers: [{ id: "provider-1", hasApiKey: true }] }),
              stderr: "",
            };
          }
          if (command === "config models --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({ items: [{ modelId: "video-model-1" }] }),
              stderr: "",
            };
          }
          if (command === "task template list --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({ items: [{ templateId: "script.generate-from-idea" }] }),
              stderr: "",
            };
          }
          if (command === "project store get --project project-1 --store script --json") {
            return {
              exitCode: 1,
              stdout: "",
              stderr: "project.store.get is not exposed by this Moyin control-plane",
            };
          }
          return { exitCode: 1, stdout: "", stderr: `unexpected command: ${command}` };
        },
      }),
    );

    const report = await evaluateMoyinProjectReadiness({ registry });

    expect(report).toMatchObject({
      status: "blocked",
      blockerCode: "MOYIN_PROJECT_STORE_READ_REQUIRED",
      gates: expect.arrayContaining([
        expect.objectContaining({
          id: "project-script",
          status: "blocked",
          summary: expect.stringContaining("script scoped store content could not be read"),
        }),
      ]),
      mutation: {
        projectCreateAttempted: false,
        workflowRunCreateAttempted: false,
        submitAttempted: false,
      },
    });
    expect(calls).toEqual([
      "status --json",
      "status --json",
      "project list --json",
      "config providers --json",
      "config models --json",
      "task template list --json",
      "project list --json",
      "project get project-1 --json",
      "project store get --project project-1 --store script --json",
    ]);
  });

  it("passes Moyin project readiness when script, S-Class, and read-only ledgers are available", async () => {
    const calls: string[] = [];
    const registry = new ExternalToolRegistry({ nowMs: () => 1_778_000_000_000 });
    registry.register(
      createMoyinProviderRegistration({
        runner: ({ args }) => {
          const command = args.join(" ");
          calls.push(command);
          if (command === "status --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({ cliVersion: "0.5.2", protocolVersion: "0.13.0" }),
              stderr: "",
            };
          }
          if (command === "project list --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                activeProjectId: "project-1",
                items: [{ id: "project-1", name: "灌篮少女（演示）", active: true }],
                total: 1,
              }),
              stderr: "",
            };
          }
          if (command === "project get project-1 --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                id: "project-1",
                name: "灌篮少女（演示）",
                stores: [
                  { key: "_p/project-1/script", storeName: "script", sizeBytes: 4096 },
                  { key: "_p/project-1/sclass", storeName: "sclass", sizeBytes: 8192 },
                ],
              }),
              stderr: "",
            };
          }
          if (command === "project store get --project project-1 --store script --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                projectId: "project-1",
                key: "_p/project-1/script",
                storeName: "script",
                source: "storage-bridge",
                state: {
                  activeProjectId: "project-1",
                  projectData: {
                    parseStatus: "ready",
                    scriptData: { scenes: [{ id: "scene-1" }] },
                    shots: [{ id: "shot-1" }],
                    episodeRawScripts: [{ episodeIndex: 1, content: "第一集剧本" }],
                  },
                },
              }),
              stderr: "",
            };
          }
          if (command === "project store get --project project-1 --store sclass --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                projectId: "project-1",
                key: "_p/project-1/sclass",
                storeName: "sclass",
                source: "storage-bridge",
                state: {
                  activeProjectId: "project-1",
                  projectData: {
                    splitScenes: [{ id: 1 }],
                    shotGroups: [{ id: "group-1", sceneIds: [1] }],
                    sceneAnchors: [{ id: "anchor-1" }],
                    lastAdaptationSummary: {
                      profileSnapshot: {
                        rhythmEngine: { enabled: true, preferredStrategy: "auto" },
                      },
                    },
                  },
                },
              }),
              stderr: "",
            };
          }
          if (command === "config providers --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({ providers: [{ id: "provider-1", hasApiKey: true }] }),
              stderr: "",
            };
          }
          if (command === "config models --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({ items: [{ modelId: "video-model-1" }] }),
              stderr: "",
            };
          }
          if (command === "task template list --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({ items: [{ templateId: "script.generate-from-idea" }] }),
              stderr: "",
            };
          }
          if (command === "workflow-run list --project project-1 --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                items: [{ runId: "run-1", status: "planned", steps: [], artifacts: [] }],
                total: 1,
              }),
              stderr: "",
            };
          }
          if (command === "task list --project project-1 --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({ items: [{ id: "task-1", status: "completed" }], total: 1 }),
              stderr: "",
            };
          }
          if (command === "artifact list --project project-1 --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                items: [{ artifactId: "artifact-1", type: "json" }],
                total: 1,
              }),
              stderr: "",
            };
          }
          return { exitCode: 1, stdout: "", stderr: `unexpected command: ${command}` };
        },
      }),
    );

    const report = await evaluateMoyinProjectReadiness({ registry });

    expect(report).toMatchObject({
      schemaVersion: "director.moyin.project-readiness.v1",
      status: "ready",
      project: {
        projectId: "project-1",
        name: "灌篮少女（演示）",
        source: "active-project",
      },
      gates: expect.arrayContaining([
        expect.objectContaining({
          id: "project-script",
          status: "passed",
          evidence: expect.objectContaining({
            hardValidation: expect.objectContaining({
              passed: true,
              episodeRawScriptCount: 1,
              sceneCount: 1,
              shotCount: 1,
            }),
          }),
        }),
        expect.objectContaining({
          id: "project-sclass",
          status: "passed",
          evidence: expect.objectContaining({
            hardValidation: expect.objectContaining({
              passed: true,
              splitSceneCount: 1,
              shotGroupCount: 1,
              sceneAnchorCount: 1,
              hasRhythmEngineProfile: true,
            }),
          }),
        }),
        expect.objectContaining({
          id: "workflow-run",
          status: "passed",
          evidence: expect.objectContaining({ itemCount: 1 }),
        }),
        expect.objectContaining({
          id: "task-ledger",
          status: "passed",
          evidence: expect.objectContaining({ itemCount: 1 }),
        }),
        expect.objectContaining({
          id: "artifact-registry",
          status: "passed",
          evidence: expect.objectContaining({ itemCount: 1 }),
        }),
      ]),
      mutation: {
        projectCreateAttempted: false,
        workflowRunCreateAttempted: false,
        submitAttempted: false,
      },
    });
    expect(calls).toEqual([
      "status --json",
      "status --json",
      "project list --json",
      "config providers --json",
      "config models --json",
      "task template list --json",
      "project list --json",
      "project get project-1 --json",
      "project store get --project project-1 --store script --json",
      "project store get --project project-1 --store sclass --json",
      "workflow-run list --project project-1 --json",
      "task list --project project-1 --json",
      "artifact list --project project-1 --json",
    ]);
  });

  it("invokes Moyin project list/get/create through provider operations and gates create behind approval", async () => {
    const calls: unknown[] = [];
    const registry = new ExternalToolRegistry({ nowMs: () => 1_778_000_000_000 });
    registry.register(
      createMoyinProviderRegistration({
        runner: ({ binary, args }) => {
          calls.push({ binary, args });
          if (args.join(" ") === "status --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({ cliVersion: "0.5.2", protocolVersion: "0.13.0" }),
              stderr: "",
            };
          }
          if (args.join(" ") === "project list --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                activeProjectId: "project-1",
                items: [{ id: "project-1", name: "已有项目", active: true }],
                total: 1,
              }),
              stderr: "",
            };
          }
          if (args.join(" ") === "project get project-1 --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({ id: "project-1", name: "已有项目", active: true }),
              stderr: "",
            };
          }
          if (args.join(" ") === "project store get --project project-1 --store script --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                projectId: "project-1",
                key: "_p/project-1/script",
                storeName: "script",
                source: "storage-bridge",
                state: { projectData: { parseStatus: "ready" } },
              }),
              stderr: "",
            };
          }
          if (args.join(" ") === "project create --name 新视频项目 --set-active --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                project: { id: "project-2", name: "新视频项目", active: true },
                activeProjectId: "project-2",
              }),
              stderr: "",
            };
          }
          return { exitCode: 1, stdout: "", stderr: `unexpected ${args.join(" ")}` };
        },
      }),
    );

    await expect(
      createExternalToolsCatalogRpcResult(createExternalToolControlPlane(registry)),
    ).resolves.toMatchObject({
      catalog: expect.arrayContaining([
        expect.objectContaining({
          id: "moyin.provider",
          capabilities: expect.arrayContaining([
            expect.objectContaining({
              id: "project.list",
              readOnly: true,
              metadata: expect.objectContaining({ capability: "moyin.project.list" }),
            }),
            expect.objectContaining({
              id: "project.get",
              readOnly: true,
              metadata: expect.objectContaining({ capability: "moyin.project.get" }),
            }),
            expect.objectContaining({
              id: "project.store.get",
              readOnly: true,
              metadata: expect.objectContaining({ capability: "moyin.project.store.get" }),
            }),
            expect.objectContaining({
              id: "project.create",
              readOnly: false,
              requiresApproval: true,
              metadata: expect.objectContaining({ capability: "moyin.project.create" }),
            }),
          ]),
        }),
      ]),
    });

    await expect(
      invokeExternalTool(registry, { toolId: "moyin.provider", operationId: "project.list" }),
    ).resolves.toMatchObject({
      ok: true,
      content: "Moyin projects: 1.",
      output: expect.objectContaining({
        operation: "project.list",
        output: expect.objectContaining({ activeProjectId: "project-1" }),
      }),
    });
    await expect(
      invokeExternalTool(registry, {
        toolId: "moyin.provider",
        operationId: "project.get",
        args: { projectId: "project-1" },
      }),
    ).resolves.toMatchObject({
      ok: true,
      content: "Moyin project retrieved.",
      output: expect.objectContaining({
        operation: "project.get",
        output: expect.objectContaining({ id: "project-1", name: "已有项目" }),
      }),
    });
    await expect(
      invokeExternalTool(registry, {
        toolId: "moyin.provider",
        operationId: "project.store.get",
        args: { projectId: "project-1", storeName: "script" },
      }),
    ).resolves.toMatchObject({
      ok: true,
      content: "Moyin project store retrieved.",
      output: expect.objectContaining({
        operation: "project.store.get",
        output: expect.objectContaining({
          projectId: "project-1",
          storeName: "script",
        }),
      }),
    });

    const approvalRequired = await invokeExternalTool(registry, {
      toolId: "moyin.provider",
      operationId: "project.create",
      args: { name: "新视频项目", setActive: true },
      turnId: "turn-project-create",
      sessionKey: "session-project-create",
    });
    expect(approvalRequired).toMatchObject({
      ok: false,
      status: "approval-required",
      error: "external-tool-approval-required",
      approval: expect.objectContaining({
        metadata: expect.objectContaining({
          toolId: "moyin.provider",
          operationId: "project.create",
          providerId: "moyin",
        }),
      }),
    });
    expect(calls).not.toContainEqual({
      binary: "moyin",
      args: ["project", "create", "--name", "新视频项目", "--set-active", "--json"],
    });

    await expect(
      invokeExternalTool(registry, {
        toolId: "moyin.provider",
        operationId: "project.create",
        args: { name: "新视频项目", setActive: true },
        turnId: "turn-project-create",
        sessionKey: "session-project-create",
        approval: { status: "approved", operatorId: "operator-1" },
        sandboxPreflight: {
          verdict: "allow",
          sandboxMode: "workspace-write",
          checkedAt: "2026-05-29T00:00:00.000Z",
          providerId: "moyin",
          reason: "trusted local Moyin project create",
        },
        sandboxRuntimePolicy: { enabledBackends: ["workspace-write"] },
      }),
    ).resolves.toMatchObject({
      ok: true,
      status: "success",
      content: "Moyin project created.",
      output: expect.objectContaining({
        operation: "project.create",
        output: expect.objectContaining({
          project: expect.objectContaining({ id: "project-2", name: "新视频项目" }),
          activeProjectId: "project-2",
        }),
      }),
    });
    expect(calls).toEqual([
      { binary: "moyin", args: ["status", "--json"] },
      { binary: "moyin", args: ["project", "list", "--json"] },
      { binary: "moyin", args: ["project", "get", "project-1", "--json"] },
      {
        binary: "moyin",
        args: ["project", "store", "get", "--project", "project-1", "--store", "script", "--json"],
      },
      {
        binary: "moyin",
        args: ["project", "create", "--name", "新视频项目", "--set-active", "--json"],
      },
    ]);
  });

  it("invokes Moyin P0 discover operations through JSON-only envelopes", async () => {
    const calls: unknown[] = [];
    const registry = new ExternalToolRegistry({ nowMs: () => 1_778_000_000_000 });
    registry.register(
      createMoyinProviderRegistration({
        runner: ({ binary, args }) => {
          calls.push({ binary, args });
          if (args.join(" ") === "status --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({ cliVersion: "0.5.2", protocolVersion: "0.13.0" }),
              stderr: "",
            };
          }
          if (args.join(" ") === "task template list --panel director --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                items: [{ templateId: "director.scene-image", panel: "director" }],
                total: 1,
              }),
              stderr: "",
            };
          }
          return { exitCode: 1, stdout: "", stderr: "unexpected command" };
        },
      }),
    );

    const result = await invokeExternalTool(registry, {
      toolId: "moyin.provider",
      operationId: "discover.templates",
      args: { panel: "director" },
    });

    expect(result).toMatchObject({
      ok: true,
      status: "success",
      content: "Moyin templates: 1.",
      output: {
        schemaVersion: "director.external-tool.v1",
        status: "success",
        provider: "moyin",
        operation: "discover.templates",
        summary: "Moyin templates: 1.",
        error: null,
      },
    });
    expect(calls).toEqual([
      { binary: "moyin", args: ["status", "--json"] },
      {
        binary: "moyin",
        args: ["task", "template", "list", "--panel", "director", "--json"],
      },
    ]);
  });

  it("moves oversized Moyin read-only outputs into artifact refs instead of inline context", async () => {
    const root = mkdtempSync(join(tmpdir(), "angel-moyin-result-budget-"));
    try {
      const tailMarker = "needle-at-end-should-not-be-inline";
      const artifactStore = createFileConversationRuntimeExternalArtifactStore({
        rootPath: root,
        nowMs: () => 1_778_000_000_000,
      });
      const registry = new ExternalToolRegistry({
        nowMs: () => 1_778_000_000_000,
        artifactStore,
      });
      registry.register(
        createMoyinProviderRegistration({
          runner: ({ args }) => {
            if (args.join(" ") === "status --json") {
              return {
                exitCode: 0,
                stdout: JSON.stringify({ cliVersion: "0.5.2", protocolVersion: "0.13.0" }),
                stderr: "",
              };
            }
            if (args.join(" ") === "task template list --json") {
              return {
                exitCode: 0,
                stdout: JSON.stringify({
                  items: Array.from({ length: 18 }, (_, index) => ({
                    templateId: `template-${index}`,
                    description:
                      index === 17
                        ? `${"large-template-output ".repeat(20)}${tailMarker}`
                        : "large-template-output ".repeat(20),
                  })),
                  total: 18,
                }),
                stderr: "",
              };
            }
            return { exitCode: 1, stdout: "", stderr: `unexpected ${args.join(" ")}` };
          },
        }),
      );

      const result = await invokeExternalTool(registry, {
        toolId: "moyin.provider",
        operationId: "discover.templates",
        metadata: {
          resultBudget: {
            maxInlineOutputChars: 240,
          },
        },
      });

      expect(result).toMatchObject({
        ok: true,
        status: "success",
        output: {
          schemaVersion: "director.external-tool.v1",
          status: "success",
          provider: "moyin",
          operation: "discover.templates",
          output: expect.objectContaining({
            schemaVersion: "director.moyin.output-preview.v1",
            truncated: true,
            artifactRef: expect.objectContaining({
              kind: "json",
            }),
          }),
          metadata: expect.objectContaining({
            resultBudget: expect.objectContaining({
              applied: true,
              maxInlineOutputChars: 240,
            }),
          }),
        },
        artifacts: [
          expect.objectContaining({
            kind: "json",
            metadata: expect.objectContaining({
              role: "moyin-result-output",
              operationId: "discover.templates",
              retention: "ephemeral",
            }),
          }),
        ],
        metadata: expect.objectContaining({
          artifactPersistence: expect.objectContaining({
            storeRef: "conversation-runtime.external-artifact-store",
          }),
        }),
      });
      expect(JSON.stringify(result.output)).not.toContain(tailMarker);
      expect(artifactStore.listArtifacts({ providerId: "moyin" })).toEqual([
        expect.objectContaining({
          kind: "json",
          retention: "ephemeral",
          sensitivity: "internal",
          cleanupPolicyRef: "artifactPolicy.moyin.result-budget.ephemeral",
        }),
      ]);
      const artifactPath = result.artifacts?.[0]?.path;
      expect(typeof artifactPath).toBe("string");
      expect(readFileSync(String(artifactPath), "utf8")).toContain(tailMarker);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("invokes Moyin P1 adapter, template, and workflow build operations without submitting", async () => {
    const calls: unknown[] = [];
    const registry = new ExternalToolRegistry({ nowMs: () => 1_778_000_000_000 });
    registry.register(
      createMoyinProviderRegistration({
        runner: ({ binary, args }) => {
          calls.push({ binary, args });
          if (args[0] === "adapter" && args[1]?.endsWith("-execution")) {
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                executable: true,
                operation: args[1] === "image-execution" ? "image" : "video",
                executionDraft: { providerId: "provider-1", model: "model-1" },
                warnings: [],
              }),
              stderr: "",
            };
          }
          if (args[0] === "task" && args[1] === "template" && args[2] === "build") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                templateId: args[3],
                request: { templateId: args[3], projectId: "project-1" },
                missingRequired: [],
              }),
              stderr: "",
            };
          }
          if (args[0] === "workflow" && args[1] === "build") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                valid: true,
                requests: [{ nodeId: "node-1", request: { projectId: "project-1" } }],
                issues: [],
              }),
              stderr: "",
            };
          }
          return {
            exitCode: 0,
            stdout: JSON.stringify({
              ok: true,
              items: [],
              command: args.join(" "),
            }),
            stderr: "",
          };
        },
      }),
    );

    const requests = [
      {
        operationId: "adapter.resolve",
        args: { panel: "director", media: "image", feature: "scene", model: "seedream" },
        content: "Moyin adapter resolved.",
      },
      {
        operationId: "adapter.image-execution",
        args: { file: "/tmp/moyin/image-request.json", out: "/tmp/moyin/image-draft.json" },
        content: "Moyin image execution draft built.",
      },
      {
        operationId: "adapter.video-execution",
        args: { file: "/tmp/moyin/video-request.json", out: "/tmp/moyin/video-draft.json" },
        content: "Moyin video execution draft built.",
      },
      {
        operationId: "task.template.get",
        args: { templateId: "director.scene-image" },
        content: "Moyin task template retrieved.",
      },
      {
        operationId: "task.template.build",
        args: {
          templateId: "director.scene-image",
          projectId: "project-1",
          values: "/tmp/moyin/values.json",
          overrides: "/tmp/moyin/overrides.json",
          out: "/tmp/moyin/request.json",
        },
        content: "Moyin task request built.",
      },
      {
        operationId: "workflow.schema",
        content: "Moyin workflow schema retrieved.",
      },
      {
        operationId: "workflow.get",
        args: { workflowId: "workflow-1", projectId: "project-1" },
        content: "Moyin workflow retrieved.",
      },
      {
        operationId: "workflow.build",
        args: {
          workflowId: "workflow-1",
          projectId: "project-1",
          values: "/tmp/moyin/workflow-values.json",
          overrides: "/tmp/moyin/workflow-overrides.json",
          outDir: "/tmp/moyin/build",
        },
        content: "Moyin workflow build completed.",
      },
    ] as const;

    for (const request of requests) {
      await expect(
        invokeExternalTool(registry, {
          toolId: "moyin.provider",
          operationId: request.operationId,
          args: request.args,
        }),
      ).resolves.toMatchObject({
        ok: true,
        status: "success",
        content: request.content,
        output: {
          schemaVersion: "director.external-tool.v1",
          status: "success",
          provider: "moyin",
          operation: request.operationId,
        },
      });
    }

    expect(calls).toEqual([
      { binary: "moyin", args: ["status", "--json"] },
      {
        binary: "moyin",
        args: [
          "adapter",
          "resolve",
          "--panel",
          "director",
          "--media",
          "image",
          "--feature",
          "scene",
          "--model",
          "seedream",
          "--json",
        ],
      },
      {
        binary: "moyin",
        args: [
          "adapter",
          "image-execution",
          "--file",
          "/tmp/moyin/image-request.json",
          "--out",
          "/tmp/moyin/image-draft.json",
          "--json",
        ],
      },
      {
        binary: "moyin",
        args: [
          "adapter",
          "video-execution",
          "--file",
          "/tmp/moyin/video-request.json",
          "--out",
          "/tmp/moyin/video-draft.json",
          "--json",
        ],
      },
      {
        binary: "moyin",
        args: ["task", "template", "get", "director.scene-image", "--json"],
      },
      {
        binary: "moyin",
        args: [
          "task",
          "template",
          "build",
          "director.scene-image",
          "--project",
          "project-1",
          "--values",
          "/tmp/moyin/values.json",
          "--overrides",
          "/tmp/moyin/overrides.json",
          "--out",
          "/tmp/moyin/request.json",
          "--json",
        ],
      },
      { binary: "moyin", args: ["workflow", "schema", "--json"] },
      {
        binary: "moyin",
        args: ["workflow", "get", "workflow-1", "--project", "project-1", "--json"],
      },
      {
        binary: "moyin",
        args: [
          "workflow",
          "build",
          "workflow-1",
          "--project",
          "project-1",
          "--values",
          "/tmp/moyin/workflow-values.json",
          "--overrides",
          "/tmp/moyin/workflow-overrides.json",
          "--out-dir",
          "/tmp/moyin/build",
          "--json",
        ],
      },
    ]);
  });

  it("fails closed when Moyin build surfaces are missing executable prerequisites", async () => {
    const registry = new ExternalToolRegistry({ nowMs: () => 1_778_000_000_000 });
    registry.register(
      createMoyinProviderRegistration({
        runner: ({ args }) => {
          if (args.join(" ") === "status --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({ cliVersion: "0.5.2", protocolVersion: "0.13.0" }),
              stderr: "",
            };
          }
          return {
            exitCode: 0,
            stdout: JSON.stringify({
              executable: false,
              missing: ["apiKey"],
              blockers: ["missing_provider_binding"],
              warnings: ["Resolve Moyin provider/model before build."],
            }),
            stderr: "",
          };
        },
      }),
    );

    await expect(
      invokeExternalTool(registry, {
        toolId: "moyin.provider",
        operationId: "adapter.image-execution",
        args: { file: "/tmp/moyin/image-request.json" },
      }),
    ).resolves.toMatchObject({
      ok: false,
      status: "error",
      error: "MOYIN_BUILD_NOT_EXECUTABLE",
      output: {
        schemaVersion: "director.external-tool.v1",
        status: "error",
        provider: "moyin",
        operation: "adapter.image-execution",
        output: expect.objectContaining({
          executable: false,
          missing: ["apiKey"],
          blockers: ["missing_provider_binding"],
          warnings: ["Resolve Moyin provider/model before build."],
        }),
        error: expect.objectContaining({
          code: "MOYIN_BUILD_NOT_EXECUTABLE",
          message: expect.stringContaining("apiKey"),
          failureKind: "provider_missing_key",
          recoverable: true,
          safeRetry: expect.objectContaining({
            strategy: "manual",
            executor: "operator",
          }),
          stopCondition: expect.objectContaining({
            type: "operator_action_required",
            action: "wait_for_operator",
          }),
          diagnostics: expect.objectContaining({
            provider: "moyin",
            redacted: true,
            suggestedOwner: "operator",
          }),
        }),
      },
    });
  });

  it("accepts Moyin adapter execution drafts with masked keys when prerequisites are resolved", async () => {
    const registry = new ExternalToolRegistry({ nowMs: () => 1_778_000_000_000 });
    registry.register(
      createMoyinProviderRegistration({
        runner: ({ args }) => {
          if (args.join(" ") === "status --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({ cliVersion: "0.5.2", protocolVersion: "0.13.0" }),
              stderr: "",
            };
          }
          return {
            exitCode: 0,
            stdout: JSON.stringify({
              executable: false,
              missing: [],
              blockers: [],
              operation: "t2i",
              executionDraft: {
                providerId: "moyin-api",
                model: "moyin-selected-image-model",
                apiKeys: ["__configured_key_1__"],
              },
              notes: [
                "Raw API keys are never returned, so this draft is not directly executable outside Moyin.",
              ],
            }),
            stderr: "",
          };
        },
      }),
    );

    await expect(
      invokeExternalTool(registry, {
        toolId: "moyin.provider",
        operationId: "adapter.image-execution",
        args: { file: "/tmp/moyin/image-request.json" },
      }),
    ).resolves.toMatchObject({
      ok: true,
      status: "success",
      content: "Moyin image execution draft built.",
      output: {
        schemaVersion: "director.external-tool.v1",
        status: "success",
        provider: "moyin",
        operation: "adapter.image-execution",
        output: expect.objectContaining({
          executable: false,
          executionDraft: expect.objectContaining({
            providerId: "moyin-api",
            model: "moyin-selected-image-model",
          }),
        }),
      },
    });
  });

  it("exposes Moyin prompt, memory, artifact mutation, and workflow lifecycle operations through policy", async () => {
    const calls: unknown[] = [];
    const registry = new ExternalToolRegistry({ nowMs: () => 1_778_000_000_000 });
    registry.register(
      createMoyinProviderRegistration({
        runner: ({ binary, args }) => {
          calls.push({ binary, args });
          return {
            exitCode: 0,
            stdout: JSON.stringify({ ok: true, command: args.join(" ") }),
            stderr: "",
          };
        },
      }),
    );

    await expect(
      createExternalToolsCatalogRpcResult(createExternalToolControlPlane(registry)),
    ).resolves.toMatchObject({
      catalog: [
        expect.objectContaining({
          id: "moyin.provider",
          capabilities: expect.arrayContaining([
            expect.objectContaining({
              id: "prompt.schema",
              readOnly: true,
              metadata: expect.objectContaining({ approvalPolicy: "none" }),
            }),
            expect.objectContaining({
              id: "memory.diff",
              readOnly: true,
              metadata: expect.objectContaining({ capability: "moyin.memory.diff" }),
            }),
            expect.objectContaining({
              id: "memory.upsert",
              readOnly: false,
              requiresApproval: true,
              metadata: expect.objectContaining({ approvalPolicy: "operator-confirm" }),
            }),
            expect.objectContaining({
              id: "artifact.attach",
              readOnly: false,
              requiresApproval: true,
            }),
            expect.objectContaining({
              id: "workflow.delete",
              readOnly: false,
              requiresApproval: true,
            }),
          ]),
        }),
      ],
    });

    await expect(
      invokeExternalTool(registry, {
        toolId: "moyin.provider",
        operationId: "prompt.schema",
      }),
    ).resolves.toMatchObject({
      ok: true,
      status: "success",
      content: "Moyin prompt schema retrieved.",
    });
    await expect(
      invokeExternalTool(registry, {
        toolId: "moyin.provider",
        operationId: "memory.diff",
        args: { projectId: "project-1", runId: "run-1" },
      }),
    ).resolves.toMatchObject({
      ok: true,
      status: "success",
      content: "Moyin memory diff retrieved.",
    });

    await expect(
      invokeExternalTool(registry, {
        toolId: "moyin.provider",
        operationId: "memory.upsert",
        args: { projectId: "project-1", file: "/tmp/moyin/memory.json" },
      }),
    ).resolves.toMatchObject({
      ok: false,
      status: "approval-required",
      error: "external-tool-approval-required",
    });

    const approved = await invokeExternalTool(registry, {
      toolId: "moyin.provider",
      operationId: "memory.upsert",
      args: { projectId: "project-1", file: "/tmp/moyin/memory.json", replace: true },
      approval: { status: "approved", operatorId: "operator-1" },
      sandboxPreflight: {
        verdict: "allow",
        sandboxMode: "workspace-write",
        checkedAt: "2026-05-28T00:00:00.000Z",
        providerId: "moyin",
        reason: "approved Moyin memory mutation",
      },
      sandboxRuntimePolicy: { enabledBackends: ["workspace-write"] },
    });

    expect(approved).toMatchObject({
      ok: true,
      status: "success",
      content: "Moyin memory upsert completed.",
    });
    expect(calls).toEqual([
      { binary: "moyin", args: ["status", "--json"] },
      { binary: "moyin", args: ["prompt", "schema", "--json"] },
      {
        binary: "moyin",
        args: ["memory", "diff", "--project", "project-1", "--run", "run-1", "--json"],
      },
      {
        binary: "moyin",
        args: [
          "memory",
          "upsert",
          "--project",
          "project-1",
          "--file",
          "/tmp/moyin/memory.json",
          "--replace",
          "--json",
        ],
      },
    ]);
  });

  it("fails closed with structured Moyin retry guidance when control-plane is missing", async () => {
    const registry = new ExternalToolRegistry({ nowMs: () => 1_778_000_000_000 });
    registry.register(
      createMoyinProviderRegistration({
        runner: () => ({
          exitCode: 1,
          stdout: "",
          stderr: "No running Moyin control plane was found. Start the desktop app first.",
        }),
      }),
    );

    await expect(
      createExternalToolsEffectiveRpcResult(createExternalToolControlPlane(registry), {
        includeUnavailable: true,
      }),
    ).resolves.toMatchObject({
      effectiveCount: 0,
      unavailableCount: 1,
      tools: [
        expect.objectContaining({
          id: "moyin.provider",
          status: "unreachable",
          canInvoke: false,
          doctor: expect.objectContaining({
            details: expect.objectContaining({
              error: expect.objectContaining({
                code: "CONTROL_PLANE_NOT_FOUND",
                failureKind: "tool_failed",
                recoverable: true,
                providerRawErrorSummary:
                  "No running Moyin control plane was found. Start the desktop app first.",
                safeRetry: expect.objectContaining({
                  strategy: "policy.exponential_backoff",
                  executor: "orchestrator",
                  maxAttemptsRef: "providerPolicy.moyin.retry.maxAttempts",
                }),
                stopCondition: expect.objectContaining({
                  type: "policy.max_attempts_reached",
                  action: "return_error_to_brain",
                }),
                diagnostics: expect.objectContaining({
                  provider: "moyin",
                  redacted: true,
                  suggestedOwner: "orchestrator",
                  rawSummaryHash: expect.any(String),
                }),
              }),
            }),
          }),
        }),
      ],
    });
  });

  it("classifies refused local Moyin control-plane sockets as missing control-plane", async () => {
    const registry = new ExternalToolRegistry({ nowMs: () => 1_778_000_000_000 });
    registry.register(
      createMoyinProviderRegistration({
        runner: () => ({
          exitCode: 1,
          stdout: "",
          stderr: "connect ECONNREFUSED 127.0.0.1:53317",
        }),
      }),
    );

    await expect(
      invokeExternalTool(registry, {
        toolId: "moyin.provider",
        operationId: "capabilities.handshake",
        args: {},
      }),
    ).resolves.toMatchObject({
      ok: false,
      status: "unavailable",
      error: "CONTROL_PLANE_NOT_FOUND",
      output: expect.objectContaining({
        error: expect.objectContaining({
          code: "CONTROL_PLANE_NOT_FOUND",
          rootCauseHint:
            "Moyin desktop may not be running, or the control-plane session file is missing.",
        }),
        nextActions: ["Start Moyin desktop, then retry the Moyin provider health check."],
      }),
    });
  });

  it("classifies Moyin provider binding failures as operator-recoverable without leaking secrets", async () => {
    const registry = new ExternalToolRegistry({ nowMs: () => 1_778_000_000_000 });
    registry.register(
      createMoyinProviderRegistration({
        runner: ({ args }) => {
          if (args.join(" ") === "status --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({ cliVersion: "0.5.2", protocolVersion: "0.13.0" }),
              stderr: "",
            };
          }
          return {
            exitCode: 1,
            stdout: "",
            stderr:
              "missing provider_model_binding: api_key=sk-secret-should-not-leak model not configured",
          };
        },
      }),
    );

    const result = await invokeExternalTool(registry, {
      toolId: "moyin.provider",
      operationId: "adapter.video-execution",
      args: { file: "/tmp/moyin/video-request.json" },
    });

    expect(result).toMatchObject({
      ok: false,
      status: "error",
      error: "MOYIN_PROVIDER_BINDING_MISSING",
      output: {
        schemaVersion: "director.external-tool.v1",
        status: "error",
        provider: "moyin",
        operation: "adapter.video-execution",
        error: expect.objectContaining({
          code: "MOYIN_PROVIDER_BINDING_MISSING",
          failureKind: "provider_missing_key",
          providerRawErrorSummary:
            "missing provider_model_binding: api_key=[redacted] model not configured",
          safeRetry: expect.objectContaining({
            strategy: "manual",
            executor: "operator",
            instruction:
              "Configure the Moyin provider/model/API key binding, then rebuild the request.",
          }),
          diagnostics: expect.objectContaining({
            redacted: true,
            suggestedOwner: "operator",
          }),
        }),
        nextActions: [
          "Configure the Moyin provider/model/API key binding, then rebuild the execution draft or sealed preview.",
        ],
      },
    });
    expect(JSON.stringify(result)).not.toContain("sk-secret-should-not-leak");
  });

  it("classifies transient Moyin upstream failures as orchestrator-retryable provider failures", async () => {
    const registry = new ExternalToolRegistry({ nowMs: () => 1_778_000_000_000 });
    registry.register(
      createMoyinProviderRegistration({
        runner: ({ args }) => {
          if (args.join(" ") === "status --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({ cliVersion: "0.5.2", protocolVersion: "0.13.0" }),
              stderr: "",
            };
          }
          return {
            exitCode: 1,
            stdout: "",
            stderr: "upstream provider timeout: HTTP 503 service unavailable",
          };
        },
      }),
    );

    await expect(
      invokeExternalTool(registry, {
        toolId: "moyin.provider",
        operationId: "sealed.video.preview",
        args: { file: "/tmp/moyin/video-request.json" },
      }),
    ).resolves.toMatchObject({
      ok: false,
      status: "error",
      error: "MOYIN_PROVIDER_UPSTREAM_FAILED",
      output: {
        error: expect.objectContaining({
          code: "MOYIN_PROVIDER_UPSTREAM_FAILED",
          failureKind: "provider_upstream_failed",
          safeRetry: expect.objectContaining({
            strategy: "policy.exponential_backoff",
            executor: "orchestrator",
          }),
          stopCondition: expect.objectContaining({
            action: "return_error_to_brain",
          }),
        }),
        nextActions: [
          "Retry after the upstream provider/network recovers; do not resubmit paid steps blindly.",
        ],
      },
    });
  });

  it("registers ComfyUI as a shared provider with health, workflow, watch, artifact, and gated lifecycle capabilities", async () => {
    const registry = new ExternalToolRegistry({ nowMs: () => 1_778_000_000_000 });
    registry.register(
      createComfyUiProviderRegistration({
        adapter: {
          health: () => ({
            ok: true,
            status: "ready",
            summary: "ComfyUI server is ready.",
            details: {
              mode: "local",
              baseUrl: "http://127.0.0.1:8188",
              queue: { runningCount: 0, pendingCount: 0 },
            },
          }),
        },
      }),
    );

    const controlPlane = createExternalToolControlPlane(registry);
    await expect(createExternalToolsCatalogRpcResult(controlPlane)).resolves.toMatchObject({
      catalog: expect.arrayContaining([
        expect.objectContaining({
          id: "comfyui.provider",
          providerId: "comfyui",
          source: "external",
          kind: "provider",
          capabilities: expect.arrayContaining([
            expect.objectContaining({
              id: "health",
              readOnly: true,
              metadata: expect.objectContaining({ capability: "comfyui.health" }),
            }),
            expect.objectContaining({
              id: "workflow.inspect",
              readOnly: true,
              metadata: expect.objectContaining({ capability: "comfyui.workflow.inspect" }),
            }),
            expect.objectContaining({
              id: "interop.draft",
              readOnly: true,
              metadata: expect.objectContaining({ capability: "comfyui.interop.draft" }),
            }),
            expect.objectContaining({
              id: "interop.buildSimple",
              readOnly: true,
              metadata: expect.objectContaining({ capability: "comfyui.interop.build_simple" }),
            }),
            expect.objectContaining({
              id: "workflow.run",
              readOnly: false,
              requiresApproval: true,
              metadata: expect.objectContaining({ capability: "comfyui.workflow.run" }),
            }),
            expect.objectContaining({
              id: "workflow.watch",
              readOnly: true,
              metadata: expect.objectContaining({
                capability: "comfyui.workflow.watch",
                lifecycle: "orchestrator-watch",
              }),
            }),
            expect.objectContaining({
              id: "artifact.fetch",
              readOnly: true,
              metadata: expect.objectContaining({ capability: "comfyui.artifact.fetch" }),
            }),
            expect.objectContaining({
              id: "lifecycle.install",
              readOnly: false,
              requiresApproval: true,
              metadata: expect.objectContaining({ capability: "comfyui.lifecycle.install" }),
            }),
            expect.objectContaining({
              id: "dependency.fix",
              readOnly: false,
              requiresApproval: true,
              metadata: expect.objectContaining({ capability: "comfyui.dependency.fix" }),
            }),
          ]),
          metadata: expect.objectContaining({
            schemaVersion: "director.comfyui-provider.v1",
            providerFamily: "workflow-production",
          }),
        }),
      ]),
    });
    await expect(
      createExternalToolsEffectiveRpcResult(controlPlane, { includeUnavailable: true }),
    ).resolves.toMatchObject({
      effectiveCount: 1,
      providerMatrix: {
        providers: [
          expect.objectContaining({
            providerId: "comfyui",
            status: "ready",
            health: expect.objectContaining({ summary: "ComfyUI server is ready." }),
          }),
        ],
      },
      tools: [
        expect.objectContaining({
          id: "comfyui.provider",
          status: "ready",
          canInvoke: true,
        }),
      ],
    });
  });

  it("maps ComfyUI health statuses into the external provider doctor contract without leaking secrets", async () => {
    const registry = new ExternalToolRegistry({ nowMs: () => 1_778_000_000_000 });
    registry.register(
      createComfyUiProviderRegistration({
        adapter: {
          health: () => ({
            ok: false,
            status: "needs-auth",
            summary: "Cloud ComfyUI needs API key.",
            details: {
              mode: "cloud",
              baseUrl: "https://cloud.comfy.org",
              apiKey: "sk-visible-test-secret",
              apiKeyMasked: "sk-...cret",
            },
            nextActions: ["Configure the ComfyUI API key."],
          }),
        },
      }),
    );

    const result = await createExternalToolsEffectiveRpcResult(
      createExternalToolControlPlane(registry),
      { includeUnavailable: true },
    );

    expect(result).toMatchObject({
      effectiveCount: 0,
      unavailableCount: 1,
      tools: [
        expect.objectContaining({
          id: "comfyui.provider",
          status: "needs-auth",
          canInvoke: false,
          doctor: expect.objectContaining({
            summary: "Cloud ComfyUI needs API key.",
            details: expect.objectContaining({
              schemaVersion: "director.comfyui-provider.v1",
              mode: "cloud",
              baseUrl: "https://cloud.comfy.org",
              apiKeyMasked: "sk-...cret",
            }),
          }),
        }),
      ],
    });
    expect(JSON.stringify(result)).not.toContain("sk-visible-test-secret");
  });

  it("keeps ComfyUI workflow run behind approval and maps run artifacts into external artifacts", async () => {
    const calls: unknown[] = [];
    const registry = new ExternalToolRegistry({ nowMs: () => 1_778_000_000_000 });
    registry.register(
      createComfyUiProviderRegistration({
        adapter: {
          health: () => ({ ok: true, status: "ready", summary: "ready" }),
          runWorkflow: (input) => {
            calls.push(input);
            return {
              ok: true,
              promptId: "prompt-1",
              summary: "ComfyUI workflow submitted.",
              progressEvents: [{ type: "execution_success", promptId: "prompt-1" }],
              artifacts: [
                {
                  id: "comfy-image-1",
                  kind: "image",
                  filename: "out.png",
                  url: "http://127.0.0.1:8188/view?filename=out.png&type=output",
                  localPath: "/tmp/director-comfy/out.png",
                  metadata: {
                    nodeId: "9",
                    promptId: "prompt-1",
                    apiKey: "sk-hidden-in-artifact",
                  },
                },
              ],
            };
          },
        },
      }),
    );

    const blocked = await invokeExternalTool(registry, {
      toolId: "comfyui.provider",
      operationId: "workflow.run",
      args: {
        prompt: "cinematic frame",
        workflowJson: {
          "1": { class_type: "CLIPTextEncode", inputs: { text: "" } },
          "2": { class_type: "SaveImage", inputs: { images: ["1", 0] } },
        },
        outputDir: "/tmp/director-comfy",
      },
    });
    expect(blocked).toMatchObject({
      ok: false,
      status: "approval-required",
      error: "external-tool-approval-required",
      approval: expect.objectContaining({
        metadata: expect.objectContaining({
          operationId: "workflow.run",
          providerId: "comfyui",
        }),
      }),
    });
    expect(calls).toEqual([]);

    const executed = await invokeExternalTool(registry, {
      toolId: "comfyui.provider",
      operationId: "workflow.run",
      args: {
        prompt: "cinematic frame",
        workflowJson: {
          "1": { class_type: "CLIPTextEncode", inputs: { text: "" } },
          "2": { class_type: "SaveImage", inputs: { images: ["1", 0] } },
        },
        outputDir: "/tmp/director-comfy",
      },
      approval: { status: "approved", operatorId: "operator-1" },
      sandboxPreflight: {
        verdict: "allow",
        sandboxMode: "workspace-write",
        checkedAt: "2026-05-27T00:00:00.000Z",
        providerId: "comfyui",
        reason: "trusted desktop sandbox granted ComfyUI workflow run",
      },
      sandboxRuntimePolicy: {
        enabledBackends: ["workspace-write"],
      },
    });

    expect(executed).toMatchObject({
      ok: true,
      status: "success",
      content: "ComfyUI workflow submitted.",
      output: {
        schemaVersion: "director.external-tool.v1",
        status: "success",
        provider: "comfyui",
        operation: "workflow.run",
        output: expect.objectContaining({
          promptId: "prompt-1",
          progressEvents: [{ type: "execution_success", promptId: "prompt-1" }],
        }),
      },
      artifacts: [
        {
          id: "comfy-image-1",
          kind: "image",
          path: "/tmp/director-comfy/out.png",
          url: "http://127.0.0.1:8188/view?filename=out.png&type=output",
          metadata: expect.objectContaining({
            provider: "comfyui",
            promptId: "prompt-1",
            nodeId: "9",
          }),
        },
      ],
    });
    expect(JSON.stringify(executed)).not.toContain("sk-hidden-in-artifact");
    expect(calls).toEqual([
      expect.objectContaining({
        prompt: "cinematic frame",
        workflowJson: expect.objectContaining({
          "1": expect.objectContaining({ class_type: "CLIPTextEncode" }),
          "2": expect.objectContaining({ class_type: "SaveImage" }),
        }),
        outputDir: "/tmp/director-comfy",
      }),
    ]);
  });

  it("fails closed when approved ComfyUI workflow run lacks an explicit workflow graph", async () => {
    const calls: unknown[] = [];
    const registry = new ExternalToolRegistry({ nowMs: () => 1_778_000_000_000 });
    registry.register(
      createComfyUiProviderRegistration({
        adapter: {
          health: () => ({ ok: true, status: "ready", summary: "ready" }),
          runWorkflow: (input) => {
            calls.push(input);
            return { ok: true, promptId: "prompt-1", summary: "should not run" };
          },
        },
      }),
    );

    const result = await invokeExternalTool(registry, {
      toolId: "comfyui.provider",
      operationId: "workflow.run",
      args: {
        prompt: "generic prompt without workflow",
        outputDir: "/tmp/director-comfy",
      },
      approval: { status: "approved", operatorId: "operator-1" },
      sandboxPreflight: {
        verdict: "allow",
        sandboxMode: "workspace-write",
        checkedAt: "2026-05-28T00:00:00.000Z",
        providerId: "comfyui",
        reason: "trusted desktop sandbox granted ComfyUI workflow run",
      },
      sandboxRuntimePolicy: { enabledBackends: ["workspace-write"] },
    });

    expect(result).toMatchObject({
      ok: false,
      status: "error",
      error: "COMFYUI_WORKFLOW_RUN_NOT_READY",
      output: {
        schemaVersion: "director.external-tool.v1",
        status: "error",
        provider: "comfyui",
        operation: "workflow.run",
        output: expect.objectContaining({
          readiness: expect.objectContaining({
            ready: false,
            blockers: expect.arrayContaining([
              expect.objectContaining({ code: "workflow_required" }),
            ]),
          }),
        }),
      },
    });
    expect(calls).toEqual([]);
  });

  it("fails closed when approved ComfyUI workflow run still has missing dependencies", async () => {
    const calls: unknown[] = [];
    const registry = new ExternalToolRegistry({ nowMs: () => 1_778_000_000_000 });
    registry.register(
      createComfyUiProviderRegistration({
        adapter: {
          health: () => ({ ok: true, status: "ready", summary: "ready" }),
          runWorkflow: (input) => {
            calls.push(input);
            return { ok: true, promptId: "prompt-1", summary: "should not run" };
          },
        },
      }),
    );

    const result = await invokeExternalTool(registry, {
      toolId: "comfyui.provider",
      operationId: "workflow.run",
      args: {
        prompt: "cinematic frame",
        workflowJson: {
          "1": {
            class_type: "CheckpointLoaderSimple",
            inputs: { ckpt_name: "missing.safetensors" },
          },
          "2": { class_type: "SaveImage", inputs: { images: ["1", 0] } },
        },
        outputDir: "/tmp/director-comfy",
        missingDependencies: ["CheckpointLoaderSimple:missing.safetensors"],
      },
      approval: { status: "approved", operatorId: "operator-1" },
      sandboxPreflight: {
        verdict: "allow",
        sandboxMode: "workspace-write",
        checkedAt: "2026-05-28T00:00:00.000Z",
        providerId: "comfyui",
        reason: "trusted desktop sandbox granted ComfyUI workflow run",
      },
      sandboxRuntimePolicy: { enabledBackends: ["workspace-write"] },
    });

    expect(result).toMatchObject({
      ok: false,
      status: "error",
      error: "COMFYUI_WORKFLOW_RUN_NOT_READY",
      output: {
        output: expect.objectContaining({
          readiness: expect.objectContaining({
            ready: false,
            blockers: expect.arrayContaining([
              expect.objectContaining({
                code: "missing_dependencies",
                items: ["CheckpointLoaderSimple:missing.safetensors"],
              }),
            ]),
          }),
        }),
      },
    });
    expect(calls).toEqual([]);
  });

  it("persists provider artifacts through the shared artifact store when registry is configured", async () => {
    const root = mkdtempSync(join(tmpdir(), "angel-external-tool-artifacts-"));
    try {
      const artifactStore = createFileConversationRuntimeExternalArtifactStore({
        rootPath: root,
        nowMs: () => 1_778_000_000_000,
        defaultTtlMs: 86_400_000,
      });
      const registry = new ExternalToolRegistry({
        nowMs: () => 1_778_000_000_000,
        artifactStore,
      });
      registry.register(
        createComfyUiProviderRegistration({
          adapter: {
            health: () => ({ ok: true, status: "ready", summary: "ready" }),
            runWorkflow: () => ({
              ok: true,
              promptId: "prompt-1",
              summary: "ComfyUI workflow submitted.",
              artifacts: [
                {
                  id: "comfy-image-1",
                  kind: "image",
                  localPath: "/tmp/director-comfy/out.png",
                  metadata: {
                    promptId: "prompt-1",
                    projectId: "project-1",
                    runId: "run-1",
                    stepId: "step-1",
                    retention: "user_controlled",
                    sensitivity: "internal",
                  },
                },
              ],
            }),
          },
        }),
      );

      const executed = await invokeExternalTool(registry, {
        toolId: "comfyui.provider",
        operationId: "workflow.run",
        turnId: "turn-1",
        sessionKey: "desktop:workbench",
        args: {
          prompt: "cinematic frame",
          workflowJson: {
            "1": { class_type: "CLIPTextEncode", inputs: { text: "" } },
            "2": { class_type: "SaveImage", inputs: { images: ["1", 0] } },
          },
          outputDir: "/tmp/director-comfy",
          projectId: "project-1",
          runId: "run-1",
        },
        approval: { status: "approved", operatorId: "operator-1" },
        sandboxPreflight: {
          verdict: "allow",
          sandboxMode: "workspace-write",
          checkedAt: "2026-05-27T00:00:00.000Z",
          providerId: "comfyui",
          reason: "trusted desktop sandbox granted ComfyUI workflow run",
        },
        sandboxRuntimePolicy: { enabledBackends: ["workspace-write"] },
      });

      expect(executed).toMatchObject({
        ok: true,
        status: "success",
        metadata: expect.objectContaining({
          artifactPersistence: {
            status: "ok",
            artifactIds: ["comfy-image-1"],
            storeRef: "conversation-runtime.external-artifact-store",
            notes: ["Stored 1 external artifact record(s)."],
          },
        }),
      });
      expect(executed.trace).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            stage: "artifact.persisted",
            metadata: expect.objectContaining({
              artifactIds: ["comfy-image-1"],
              status: "ok",
            }),
          }),
        ]),
      );
      expect(artifactStore.listArtifacts({ providerId: "comfyui", runId: "run-1" })).toEqual([
        expect.objectContaining({
          artifactId: "comfy-image-1",
          kind: "image",
          providerId: "comfyui",
          toolId: "comfyui.provider",
          operationId: "workflow.run",
          turnId: "turn-1",
          sessionKey: "desktop:workbench",
          projectId: "project-1",
          runId: "run-1",
          stepId: "step-1",
          localPath: "/tmp/director-comfy/out.png",
          retention: "user_controlled",
          sensitivity: "internal",
        }),
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("routes ComfyUI inspect, watch, and artifact fetch through structured provider outputs", async () => {
    const calls: unknown[] = [];
    const registry = new ExternalToolRegistry({ nowMs: () => 1_778_000_000_000 });
    registry.register(
      createComfyUiProviderRegistration({
        adapter: {
          health: () => ({ ok: true, status: "ready", summary: "ready" }),
          inspectWorkflow: (input) => {
            calls.push({ op: "inspect", input });
            return {
              ok: true,
              summary: "ComfyUI workflow inspected.",
              report: {
                summary: {
                  promptNodeCount: 1,
                  outputNodeCount: 1,
                  missingNodeCount: 0,
                  missingModelCount: 0,
                },
              },
            };
          },
          watchWorkflow: (input) => {
            calls.push({ op: "watch", input });
            return {
              ok: true,
              promptId: "prompt-1",
              summary: "ComfyUI workflow watch completed.",
              events: [{ type: "progress", promptId: "prompt-1", value: 1, max: 1 }],
              status: "completed",
            };
          },
          fetchArtifact: (input) => {
            calls.push({ op: "artifact", input });
            return {
              ok: true,
              summary: "ComfyUI artifact fetched.",
              artifact: {
                id: "artifact-1",
                kind: "video",
                filename: "clip.mp4",
                localPath: "/tmp/director-comfy/clip.mp4",
                metadata: { promptId: "prompt-1", nodeId: "10" },
              },
            };
          },
        },
      }),
    );

    await expect(
      invokeExternalTool(registry, {
        toolId: "comfyui.provider",
        operationId: "workflow.inspect",
        args: { workflowJson: { "1": { class_type: "SaveImage", inputs: {} } } },
      }),
    ).resolves.toMatchObject({
      ok: true,
      status: "success",
      content: "ComfyUI workflow inspected.",
      output: {
        schemaVersion: "director.external-tool.v1",
        status: "success",
        provider: "comfyui",
        operation: "workflow.inspect",
      },
    });

    await expect(
      invokeExternalTool(registry, {
        toolId: "comfyui.provider",
        operationId: "workflow.watch",
        args: { promptId: "prompt-1", timeoutMs: 300_000, heartbeatIntervalMs: 5_000 },
      }),
    ).resolves.toMatchObject({
      ok: true,
      status: "success",
      content: "ComfyUI workflow watch completed.",
      output: {
        output: expect.objectContaining({
          promptId: "prompt-1",
          status: "completed",
          events: [{ type: "progress", promptId: "prompt-1", value: 1, max: 1 }],
        }),
      },
      metadata: expect.objectContaining({
        lifecycle: "orchestrator-watch",
        resumable: true,
      }),
    });

    await expect(
      invokeExternalTool(registry, {
        toolId: "comfyui.provider",
        operationId: "artifact.fetch",
        args: { promptId: "prompt-1", filename: "clip.mp4", type: "output" },
      }),
    ).resolves.toMatchObject({
      ok: true,
      status: "success",
      content: "ComfyUI artifact fetched.",
      artifacts: [
        {
          id: "artifact-1",
          kind: "video",
          path: "/tmp/director-comfy/clip.mp4",
          metadata: expect.objectContaining({
            provider: "comfyui",
            promptId: "prompt-1",
            nodeId: "10",
          }),
        },
      ],
    });

    expect(calls).toEqual([
      { op: "inspect", input: expect.objectContaining({ workflowJson: expect.any(Object) }) },
      {
        op: "watch",
        input: expect.objectContaining({
          promptId: "prompt-1",
          timeoutMs: 300_000,
          heartbeatIntervalMs: 5_000,
        }),
      },
      {
        op: "artifact",
        input: expect.objectContaining({
          promptId: "prompt-1",
          filename: "clip.mp4",
          type: "output",
        }),
      },
    ]);
  });

  it("rejects unsafe ComfyUI structured args before provider invocation", async () => {
    const calls: unknown[] = [];
    const registry = new ExternalToolRegistry({ nowMs: () => 1_778_000_000_000 });
    registry.register(
      createComfyUiProviderRegistration({
        adapter: {
          health: () => ({ ok: true, status: "ready", summary: "ready" }),
          fetchArtifact: (input) => {
            calls.push(input);
            return {
              ok: true,
              summary: "should not execute",
            };
          },
        },
      }),
    );

    const result = await invokeExternalTool(registry, {
      toolId: "comfyui.provider",
      operationId: "artifact.fetch",
      args: { filename: "../secret.png", promptId: "prompt-1" },
    });

    expect(result).toMatchObject({
      ok: false,
      status: "permission-denied",
      error: "external-tool-arg-admission-denied",
      metadata: {
        argAdmission: expect.objectContaining({
          path: "filename",
        }),
      },
    });
    expect(calls).toEqual([]);
  });

  it("invokes Moyin workflow export as a read-only interop operation", async () => {
    const registry = new ExternalToolRegistry({ nowMs: () => 1_778_000_000_000 });
    registry.register(
      createMoyinProviderRegistration({
        runner: ({ args }) =>
          args[0] === "status"
            ? {
                exitCode: 0,
                stdout: JSON.stringify({ cliVersion: "0.5.2", protocolVersion: "0.13.0" }),
                stderr: "",
              }
            : {
                exitCode: 0,
                stdout: JSON.stringify({
                  id: "export-1",
                  workflow: { nodes: [], edges: [] },
                  conversion: { executable: false, lossiness: "lossless" },
                }),
                stderr: "",
              },
      }),
    );

    const result = await invokeExternalTool(registry, {
      toolId: "moyin.provider",
      operationId: "workflow.export",
      args: { projectId: "project-1", runId: "run-1", target: "comfyui-draft" },
    });

    expect(result).toMatchObject({
      ok: true,
      status: "success",
      output: {
        schemaVersion: "director.external-tool.v1",
        status: "success",
        provider: "moyin",
        operation: "workflow.export",
        output: expect.objectContaining({
          interopPackage: expect.objectContaining({
            schemaVersion: "director.workflow-interop.v1",
          }),
        }),
      },
    });
  });

  it("builds a Future CLI provider from a schema-first manifest without changing channel adapters", async () => {
    const calls: unknown[] = [];
    const manifest = validateFutureCliProviderManifest({
      schemaVersion: "director.external-cli-provider.v1",
      providerId: "storyboard",
      toolId: "storyboard.provider",
      label: "Storyboard CLI",
      command: "/usr/local/bin/storyboard",
      sourceTrust: {
        status: "trusted-local-config",
        reason: "Local operator configured this CLI.",
      },
      operations: [
        {
          id: "health",
          label: "health",
          readOnly: true,
          args: ["status", "--json"],
        },
        {
          id: "render",
          label: "render",
          readOnly: false,
          requiresApproval: true,
          args: ["render", "--file", "{{requestPath}}", "--json"],
          artifactParsers: [{ path: "artifacts" }],
          eventParsers: [{ path: "events" }],
          argAdmission: {
            blockedStringPatterns: ["(^|/)\\.\\.(?:/|$)", "[;&|`$]"],
          },
        },
      ],
    });
    const registry = new ExternalToolRegistry({ nowMs: () => 1_778_000_000_000 });
    registry.register(
      createFutureCliProviderRegistrationFromManifest(manifest, {
        runner: ({ command, args }) => {
          calls.push({ command, args });
          return {
            exitCode: 0,
            stdout: JSON.stringify({
              status: "ok",
              summary: "Storyboard rendered.",
              artifacts: [{ id: "frame-1", kind: "image", path: "/tmp/frame.png" }],
              events: [
                {
                  type: "progress",
                  timestamp: "2026-05-27T00:00:00.000Z",
                  message: "Rendered first frame.",
                },
              ],
            }),
            stderr: "",
          };
        },
      }),
    );

    await expect(
      createExternalToolsCatalogRpcResult(createExternalToolControlPlane(registry)),
    ).resolves.toMatchObject({
      catalog: [
        expect.objectContaining({
          id: "storyboard.provider",
          providerId: "storyboard",
          capabilities: expect.arrayContaining([
            expect.objectContaining({ id: "render", readOnly: false, requiresApproval: true }),
          ]),
        }),
      ],
    });

    await expect(
      invokeExternalTool(registry, {
        toolId: "storyboard.provider",
        operationId: "render",
        args: { requestPath: "/tmp/request.json" },
      }),
    ).resolves.toMatchObject({
      ok: false,
      status: "approval-required",
      error: "external-tool-approval-required",
    });

    const rendered = await invokeExternalTool(registry, {
      toolId: "storyboard.provider",
      operationId: "render",
      args: { requestPath: "/tmp/request.json" },
      approval: { status: "approved", operatorId: "operator-1" },
      sandboxPreflight: {
        verdict: "allow",
        sandboxMode: "workspace-write",
        checkedAt: "2026-05-27T00:00:00.000Z",
        providerId: "storyboard",
        reason: "trusted local CLI",
      },
      sandboxRuntimePolicy: {
        enabledBackends: ["workspace-write"],
      },
    });

    expect(rendered).toMatchObject({
      ok: true,
      status: "success",
      content: "Storyboard rendered.",
      artifacts: [
        expect.objectContaining({
          id: "frame-1",
          kind: "image",
          path: "/tmp/frame.png",
        }),
      ],
      output: expect.objectContaining({
        schemaVersion: "director.external-tool.v1",
        provider: "storyboard",
        operation: "render",
        events: [
          expect.objectContaining({
            type: "progress",
            message: "Rendered first frame.",
          }),
        ],
      }),
    });
    expect(calls).toEqual([
      {
        command: "/usr/local/bin/storyboard",
        args: ["render", "--file", "/tmp/request.json", "--json"],
      },
    ]);
  });

  it("parses Future CLI NDJSON stdout events without requiring channel adapter changes", async () => {
    const registry = new ExternalToolRegistry({ nowMs: () => 1_778_000_000_000 });
    registry.register(
      createFutureCliProviderRegistrationFromManifest(
        validateFutureCliProviderManifest({
          schemaVersion: "director.external-cli-provider.v1",
          providerId: "moyin-exporter",
          toolId: "moyin-exporter.provider",
          label: "Moyin Exporter CLI",
          command: "/usr/local/bin/moyin-exporter",
          operations: [
            {
              id: "watch",
              label: "watch",
              readOnly: true,
              args: ["watch", "{{runId}}", "--events", "ndjson"],
              eventParsers: [{ path: "stdout", source: "stdout", format: "ndjson" }],
            },
          ],
        }),
        {
          runner: () => ({
            exitCode: 0,
            stdout: [
              JSON.stringify({
                type: "progress",
                timestamp: "2026-05-27T00:00:00.000Z",
                message: "Export started.",
              }),
              "not json",
              JSON.stringify({
                type: "artifact",
                payload: { artifactId: "workflow-package" },
              }),
            ].join("\n"),
            stderr: "",
          }),
        },
      ),
    );

    await expect(
      invokeExternalTool(registry, {
        toolId: "moyin-exporter.provider",
        operationId: "watch",
        args: { runId: "run-1" },
      }),
    ).resolves.toMatchObject({
      ok: true,
      status: "success",
      output: {
        schemaVersion: "director.external-tool.v1",
        provider: "moyin-exporter",
        operation: "watch",
        events: [
          {
            type: "progress",
            timestamp: "2026-05-27T00:00:00.000Z",
            message: "Export started.",
          },
          {
            type: "artifact",
            payload: { artifactId: "workflow-package" },
          },
        ],
      },
    });
  });

  it("streams Future CLI runtime events through the provider SDK before final output parsing", async () => {
    const liveEvents: unknown[] = [];
    const registry = new ExternalToolRegistry({ nowMs: () => 1_778_000_000_000 });
    registry.register(
      createFutureCliProviderRegistrationFromManifest(
        validateFutureCliProviderManifest({
          schemaVersion: "director.external-cli-provider.v1",
          providerId: "moyin-live",
          toolId: "moyin-live.provider",
          label: "Moyin Live CLI",
          command: "/usr/local/bin/moyin-live",
          operations: [
            {
              id: "watch",
              label: "watch",
              readOnly: true,
              args: ["watch", "{{runId}}", "--json"],
              eventParsers: [{ path: "events" }],
            },
          ],
        }),
        {
          onEvent: (event) => liveEvents.push(event),
          runner: ({ emitEvent }) => {
            emitEvent({
              type: "progress",
              timestamp: "2026-05-27T00:00:00.000Z",
              message: "Live progress.",
            });
            emitEvent({ message: "ignored because type is missing" });
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                summary: "Live watch completed.",
                events: [{ type: "done", message: "Final event." }],
              }),
              stderr: "",
            };
          },
        },
      ),
    );

    await expect(
      invokeExternalTool(registry, {
        toolId: "moyin-live.provider",
        operationId: "watch",
        args: { runId: "run-1" },
      }),
    ).resolves.toMatchObject({
      ok: true,
      status: "success",
      content: "Live watch completed.",
      output: {
        schemaVersion: "director.external-tool.v1",
        provider: "moyin-live",
        operation: "watch",
        events: [
          {
            type: "progress",
            timestamp: "2026-05-27T00:00:00.000Z",
            message: "Live progress.",
          },
          { type: "done", message: "Final event." },
        ],
      },
      metadata: expect.objectContaining({
        streamedEventCount: 1,
      }),
    });
    expect(liveEvents).toEqual([
      {
        type: "progress",
        timestamp: "2026-05-27T00:00:00.000Z",
        message: "Live progress.",
      },
    ]);
  });

  it("rejects unsafe Future CLI manifest args before runner execution", async () => {
    const calls: unknown[] = [];
    const registry = new ExternalToolRegistry({ nowMs: () => 1_778_000_000_000 });
    registry.register(
      createFutureCliProviderRegistrationFromManifest(
        validateFutureCliProviderManifest({
          schemaVersion: "director.external-cli-provider.v1",
          providerId: "storyboard",
          toolId: "storyboard.provider",
          label: "Storyboard CLI",
          command: "/usr/local/bin/storyboard",
          operations: [
            {
              id: "render",
              label: "render",
              readOnly: true,
              args: ["render", "--file", "{{requestPath}}", "--json"],
              argAdmission: { blockedStringPatterns: ["(^|/)\\.\\.(?:/|$)", "[;&|`$]"] },
            },
          ],
        }),
        {
          runner: (input) => {
            calls.push(input);
            return { exitCode: 0, stdout: "{}", stderr: "" };
          },
        },
      ),
    );

    const result = await invokeExternalTool(registry, {
      toolId: "storyboard.provider",
      operationId: "render",
      args: { requestPath: "../secret.json" },
    });

    expect(result).toMatchObject({
      ok: false,
      status: "permission-denied",
      error: "external-tool-arg-admission-denied",
    });
    expect(calls).toEqual([]);
  });

  it("normalizes workflow interop packages and keeps lossy conversions non-executable", () => {
    const interop = createWorkflowInteropPackage({
      id: "interop-1",
      source: {
        provider: "moyin",
        format: "moyin.workflow-run.export",
        artifactId: "artifact-source",
      },
      target: {
        provider: "comfyui",
        format: "comfyui.api-workflow",
      },
      graph: {
        nodes: [{ id: "text-1", kind: "prompt", label: "Prompt" }],
        edges: [],
      },
      artifacts: [{ id: "artifact-source", kind: "json", uri: "file:///tmp/source.json" }],
      conversion: {
        executable: true,
        lossiness: "lossy",
        unmappedFields: ["timeline.beatTiming"],
        missingDependencies: ["CheckpointLoaderSimple:missing.safetensors"],
        logs: ["Moyin timeline timing cannot be represented as a plain ComfyUI API workflow."],
      },
    });

    expect(validateWorkflowInteropPackage(interop)).toMatchObject({
      ok: true,
      package: expect.objectContaining({
        schemaVersion: "director.workflow-interop.v1",
        conversion: expect.objectContaining({
          executable: false,
          requestedExecutable: true,
          lossiness: "lossy",
        }),
      }),
    });
    expect(explainWorkflowInteropConversion(interop)).toEqual(
      expect.objectContaining({
        executable: false,
        reason: expect.stringContaining("lossy"),
        missingDependencies: ["CheckpointLoaderSimple:missing.safetensors"],
        unmappedFields: ["timeline.beatTiming"],
      }),
    );
  });

  it("creates a ComfyUI draft conversion report from workflow interop packages", async () => {
    const registry = new ExternalToolRegistry({ nowMs: () => 1_778_000_000_000 });
    registry.register(
      createComfyUiProviderRegistration({
        adapter: {
          health: () => ({ ok: true, status: "ready", summary: "ready" }),
        },
      }),
    );
    const interop = createWorkflowInteropPackage({
      id: "moyin-run-1-comfyui-draft",
      source: {
        provider: "moyin",
        format: "moyin.workflow-run.export",
        uri: "/tmp/moyin/export.json",
      },
      target: {
        provider: "comfyui",
        format: "comfyui-draft",
      },
      graph: {
        nodes: [{ id: "prompt-1", kind: "prompt", label: "Prompt", payload: { text: "city" } }],
        edges: [],
      },
      artifacts: [{ id: "source-package", kind: "json", localPath: "/tmp/moyin/export.json" }],
      conversion: {
        executable: true,
        lossiness: "lossy",
        unmappedFields: ["timeline.beatTiming"],
        missingDependencies: ["CheckpointLoaderSimple:missing.safetensors"],
        logs: ["Moyin exported a ComfyUI draft."],
      },
    });

    await expect(
      invokeExternalTool(registry, {
        toolId: "comfyui.provider",
        operationId: "interop.draft",
        args: { interopPackage: interop },
      }),
    ).resolves.toMatchObject({
      ok: true,
      status: "success",
      content: "ComfyUI interop draft report created.",
      artifacts: [
        {
          id: "comfyui-draft-source-package",
          kind: "json",
          path: "/tmp/moyin/export.json",
          metadata: expect.objectContaining({
            provider: "comfyui",
            role: "interop-draft-source",
            sourcePackageId: "moyin-run-1-comfyui-draft",
          }),
        },
      ],
      output: {
        schemaVersion: "director.external-tool.v1",
        provider: "comfyui",
        operation: "interop.draft",
        output: expect.objectContaining({
          schemaVersion: "director.comfyui-interop-draft.v1",
          status: "draft",
          executable: false,
          conversion: expect.objectContaining({
            executable: false,
            lossiness: "lossy",
            unmappedFields: ["timeline.beatTiming"],
            missingDependencies: ["CheckpointLoaderSimple:missing.safetensors"],
          }),
          draftWorkflow: expect.objectContaining({
            schemaVersion: "comfyui.api-workflow.draft",
            executable: false,
            nodes: [
              expect.objectContaining({
                id: "prompt-1",
                class_type: "DirectorInterop.prompt",
              }),
            ],
          }),
        }),
      },
    });
  });

  it("builds a simple executable ComfyUI API workflow from lossless interop packages without running it", async () => {
    const registry = new ExternalToolRegistry({ nowMs: () => 1_778_000_000_000 });
    registry.register(
      createComfyUiProviderRegistration({
        adapter: {
          health: () => ({ ok: true, status: "ready", summary: "ready" }),
        },
      }),
    );
    const interop = createWorkflowInteropPackage({
      id: "moyin-run-simple-image",
      source: {
        provider: "moyin",
        format: "moyin.workflow-run.export",
        uri: "/tmp/moyin/simple.json",
      },
      target: {
        provider: "comfyui",
        format: "comfyui.api-workflow",
      },
      graph: {
        nodes: [
          {
            id: "model-1",
            kind: "checkpoint",
            payload: { checkpoint: "dream.safetensors" },
          },
          {
            id: "prompt-1",
            kind: "prompt",
            payload: {
              text: "cinematic city at sunrise",
              negativePrompt: "low quality",
              width: 768,
              height: 512,
              steps: 24,
              cfg: 6.5,
              seed: 42,
              samplerName: "dpmpp_2m",
              scheduler: "karras",
              filenamePrefix: "moyin_simple",
            },
          },
        ],
        edges: [{ from: "model-1", to: "prompt-1" }],
      },
      artifacts: [{ id: "source-package", kind: "json", localPath: "/tmp/moyin/simple.json" }],
      conversion: {
        executable: true,
        lossiness: "lossless",
        unmappedFields: [],
        missingDependencies: [],
        logs: ["Moyin simple image chain mapped to ComfyUI API workflow."],
      },
    });

    await expect(
      invokeExternalTool(registry, {
        toolId: "comfyui.provider",
        operationId: "interop.buildSimple",
        args: { interopPackage: interop },
      }),
    ).resolves.toMatchObject({
      ok: true,
      status: "success",
      content: "ComfyUI simple API workflow built.",
      output: {
        schemaVersion: "director.external-tool.v1",
        provider: "comfyui",
        operation: "interop.buildSimple",
        output: expect.objectContaining({
          schemaVersion: "director.comfyui-simple-build.v1",
          status: "executable",
          executable: true,
          workflowJson: expect.objectContaining({
            "1": expect.objectContaining({
              class_type: "CheckpointLoaderSimple",
              inputs: { ckpt_name: "dream.safetensors" },
            }),
            "2": expect.objectContaining({
              class_type: "CLIPTextEncode",
              inputs: { text: "cinematic city at sunrise", clip: ["1", 1] },
            }),
            "5": expect.objectContaining({
              class_type: "KSampler",
              inputs: expect.objectContaining({
                seed: 42,
                steps: 24,
                cfg: 6.5,
                sampler_name: "dpmpp_2m",
                scheduler: "karras",
              }),
            }),
            "7": expect.objectContaining({
              class_type: "SaveImage",
              inputs: { images: ["6", 0], filename_prefix: "moyin_simple" },
            }),
          }),
          nextActions: expect.arrayContaining([
            "Require operator approval before passing workflowJson to workflow.run.",
          ]),
        }),
      },
    });
  });

  it("blocks simple ComfyUI API workflow builds when interop conversion is not executable", async () => {
    const registry = new ExternalToolRegistry({ nowMs: () => 1_778_000_000_000 });
    registry.register(createComfyUiProviderRegistration());
    const interop = createWorkflowInteropPackage({
      id: "moyin-run-lossy-image",
      source: {
        provider: "moyin",
        format: "moyin.workflow-run.export",
        uri: "/tmp/moyin/lossy.json",
      },
      target: {
        provider: "comfyui",
        format: "comfyui.api-workflow",
      },
      graph: {
        nodes: [
          { id: "model-1", kind: "checkpoint", payload: { checkpoint: "dream.safetensors" } },
          { id: "prompt-1", kind: "prompt", payload: { text: "city" } },
        ],
        edges: [],
      },
      artifacts: [{ id: "source-package", kind: "json", localPath: "/tmp/moyin/lossy.json" }],
      conversion: {
        executable: true,
        lossiness: "lossy",
        unmappedFields: ["timeline.beatTiming"],
        missingDependencies: ["CheckpointLoaderSimple:dream.safetensors"],
        logs: ["Timing and dependency checks are not complete."],
      },
    });

    await expect(
      invokeExternalTool(registry, {
        toolId: "comfyui.provider",
        operationId: "interop.buildSimple",
        args: { interopPackage: interop },
      }),
    ).resolves.toMatchObject({
      ok: false,
      status: "error",
      error: "COMFYUI_INTEROP_BUILD_BLOCKED",
      output: {
        schemaVersion: "director.external-tool.v1",
        provider: "comfyui",
        operation: "interop.buildSimple",
        output: expect.objectContaining({
          schemaVersion: "director.comfyui-simple-build.v1",
          status: "blocked",
          executable: false,
          conversion: expect.objectContaining({
            executable: false,
            lossiness: "lossy",
            unmappedFields: ["timeline.beatTiming"],
            missingDependencies: ["CheckpointLoaderSimple:dream.safetensors"],
          }),
          reasons: expect.arrayContaining(["conversion is lossy"]),
        }),
      },
    });
  });

  it("exports Moyin workflow runs into workflow interop packages", async () => {
    const calls: unknown[] = [];
    const registry = new ExternalToolRegistry({ nowMs: () => 1_778_000_000_000 });
    registry.register(
      createMoyinProviderRegistration({
        runner: ({ binary, args }) => {
          calls.push({ binary, args });
          return {
            exitCode: 0,
            stdout: JSON.stringify({
              id: "export-1",
              projectId: "project-1",
              runId: "run-1",
              target: "comfyui-draft",
              packagePath: "/tmp/moyin/export.json",
              workflow: {
                nodes: [{ id: "prompt-1", kind: "prompt", label: "Prompt" }],
                edges: [],
              },
              artifacts: [
                { id: "source-package", kind: "json", localPath: "/tmp/moyin/export.json" },
              ],
              conversion: {
                executable: true,
                lossiness: "lossy",
                unmappedFields: ["timeline.beatTiming"],
                missingDependencies: ["CheckpointLoaderSimple:missing.safetensors"],
                logs: ["Exported as draft; verify before execution."],
              },
            }),
            stderr: "",
          };
        },
      }),
    );

    const exported = await invokeExternalTool(registry, {
      toolId: "moyin.provider",
      operationId: "workflow.export",
      args: {
        projectId: "project-1",
        runId: "run-1",
        target: "comfyui-draft",
        out: "/tmp/moyin/export.json",
      },
    });

    expect(exported).toMatchObject({
      ok: true,
      status: "success",
      content: "Moyin workflow export completed.",
      output: {
        schemaVersion: "director.external-tool.v1",
        provider: "moyin",
        operation: "workflow.export",
        output: expect.objectContaining({
          interopPackage: expect.objectContaining({
            schemaVersion: "director.workflow-interop.v1",
            conversion: expect.objectContaining({
              executable: false,
              requestedExecutable: true,
              lossiness: "lossy",
              missingDependencies: ["CheckpointLoaderSimple:missing.safetensors"],
            }),
          }),
        }),
      },
      artifacts: [
        expect.objectContaining({
          id: "source-package",
          kind: "json",
          path: "/tmp/moyin/export.json",
        }),
      ],
    });
    expect(calls.slice(1)).toEqual([
      {
        binary: "moyin",
        args: [
          "workflow-run",
          "export",
          "run-1",
          "--project",
          "project-1",
          "--target",
          "comfyui-draft",
          "--out",
          "/tmp/moyin/export.json",
          "--json",
        ],
      },
    ]);
  });

  it("keeps Moyin workflow import behind approval and validates workflows read-only", async () => {
    const calls: unknown[] = [];
    const registry = new ExternalToolRegistry({ nowMs: () => 1_778_000_000_000 });
    registry.register(
      createMoyinProviderRegistration({
        runner: ({ binary, args }) => {
          calls.push({ binary, args });
          return {
            exitCode: 0,
            stdout: JSON.stringify({ ok: true, workflowId: "workflow-1" }),
            stderr: "",
          };
        },
      }),
    );

    await expect(
      invokeExternalTool(registry, {
        toolId: "moyin.provider",
        operationId: "workflow.import",
        args: { projectId: "project-1", file: "/tmp/import.json" },
      }),
    ).resolves.toMatchObject({
      ok: false,
      status: "approval-required",
      error: "external-tool-approval-required",
    });

    const imported = await invokeExternalTool(registry, {
      toolId: "moyin.provider",
      operationId: "workflow.import",
      args: { projectId: "project-1", file: "/tmp/import.json" },
      approval: { status: "approved", operatorId: "operator-1" },
      sandboxPreflight: {
        verdict: "allow",
        sandboxMode: "workspace-write",
        checkedAt: "2026-05-27T00:00:00.000Z",
        providerId: "moyin",
        reason: "trusted local Moyin workflow import",
      },
      sandboxRuntimePolicy: { enabledBackends: ["workspace-write"] },
    });
    const validated = await invokeExternalTool(registry, {
      toolId: "moyin.provider",
      operationId: "workflow.validate",
      args: { projectId: "project-1", workflowId: "workflow-1" },
    });

    expect(imported).toMatchObject({
      ok: true,
      status: "success",
      content: "Moyin workflow import completed.",
    });
    expect(validated).toMatchObject({
      ok: true,
      status: "success",
      content: "Moyin workflow validate completed.",
    });
    expect(calls.slice(1)).toEqual([
      {
        binary: "moyin",
        args: [
          "workflow",
          "create",
          "--project",
          "project-1",
          "--file",
          "/tmp/import.json",
          "--json",
        ],
      },
      {
        binary: "moyin",
        args: ["workflow", "validate", "workflow-1", "--project", "project-1", "--json"],
      },
    ]);
  });

  it("creates a Moyin draft workflow package from a ComfyUI API workflow before approval-gated import", async () => {
    const calls: unknown[] = [];
    const registry = new ExternalToolRegistry({ nowMs: () => 1_778_000_000_000 });
    registry.register(
      createMoyinProviderRegistration({
        runner: ({ binary, args }) => {
          calls.push({ binary, args });
          return {
            exitCode: 0,
            stdout: JSON.stringify({ cliVersion: "0.5.2", protocolVersion: "0.13.0" }),
            stderr: "",
          };
        },
      }),
    );

    const draft = await invokeExternalTool(registry, {
      toolId: "moyin.provider",
      operationId: "workflow.draft",
      args: {
        projectId: "project-1",
        workflowId: "draft-from-comfyui",
        workflowPath: "/tmp/comfy/workflow.json",
        workflowJson: {
          "1": { class_type: "CLIPTextEncode", inputs: { text: "city" } },
          "2": { class_type: "KSampler", inputs: { positive: ["1", 0], steps: 20 } },
        },
        missingDependencies: ["CheckpointLoaderSimple:missing.safetensors"],
      },
    });

    expect(draft).toMatchObject({
      ok: true,
      status: "success",
      content: "Moyin workflow draft package created.",
      artifacts: [
        {
          id: "moyin-draft-comfyui-api-workflow",
          kind: "json",
          path: "/tmp/comfy/workflow.json",
          metadata: expect.objectContaining({
            provider: "moyin",
            role: "workflow-draft-source",
          }),
        },
      ],
      output: {
        schemaVersion: "director.external-tool.v1",
        provider: "moyin",
        operation: "workflow.draft",
        output: expect.objectContaining({
          schemaVersion: "director.moyin-workflow-draft.v1",
          status: "draft",
          executable: false,
          workflow: expect.objectContaining({
            schemaVersion: "moyin.workflow.draft.v1",
            id: "draft-from-comfyui",
            projectId: "project-1",
            executable: false,
            validationRequired: true,
            edges: [{ from: "1", to: "2", label: "positive" }],
          }),
          interopPackage: expect.objectContaining({
            schemaVersion: "director.workflow-interop.v1",
            source: expect.objectContaining({ provider: "comfyui" }),
            target: expect.objectContaining({ provider: "moyin" }),
            conversion: expect.objectContaining({
              executable: false,
              lossiness: "lossy",
              missingDependencies: ["CheckpointLoaderSimple:missing.safetensors"],
              unmappedFields: ["node.2.sampler.runtime"],
            }),
          }),
        }),
      },
    });
    expect(calls).toEqual([{ binary: "moyin", args: ["status", "--json"] }]);

    await expect(
      invokeExternalTool(registry, {
        toolId: "moyin.provider",
        operationId: "workflow.import",
        args: { projectId: "project-1", file: "/tmp/moyin/draft-from-comfyui.json" },
      }),
    ).resolves.toMatchObject({
      ok: false,
      status: "approval-required",
      error: "external-tool-approval-required",
    });
  });

  it("fails closed when Moyin workflow validation reports an invalid workflow", async () => {
    const registry = new ExternalToolRegistry({ nowMs: () => 1_778_000_000_000 });
    registry.register(
      createMoyinProviderRegistration({
        runner: ({ args }) =>
          args[0] === "status"
            ? {
                exitCode: 0,
                stdout: JSON.stringify({ cliVersion: "0.5.2", protocolVersion: "0.13.0" }),
                stderr: "",
              }
            : {
                exitCode: 0,
                stdout: JSON.stringify({
                  valid: false,
                  errors: [{ code: "missing_dependency", message: "Missing SDXL checkpoint." }],
                }),
                stderr: "",
              },
      }),
    );

    await expect(
      invokeExternalTool(registry, {
        toolId: "moyin.provider",
        operationId: "workflow.validate",
        args: { projectId: "project-1", workflowId: "workflow-1" },
      }),
    ).resolves.toMatchObject({
      ok: false,
      status: "error",
      error: "MOYIN_WORKFLOW_VALIDATION_FAILED",
      output: {
        schemaVersion: "director.external-tool.v1",
        status: "error",
        provider: "moyin",
        operation: "workflow.validate",
        error: expect.objectContaining({
          code: "MOYIN_WORKFLOW_VALIDATION_FAILED",
          message: expect.stringContaining("Missing SDXL checkpoint."),
        }),
      },
    });
  });

  it("fails closed when Moyin CLI or control-plane contract is below the required version", async () => {
    const registry = new ExternalToolRegistry({ nowMs: () => 1_778_000_000_000 });
    registry.register(
      createMoyinProviderRegistration({
        runner: () => ({
          exitCode: 0,
          stdout: JSON.stringify({ cliVersion: "0.4.9", protocolVersion: "0.12.9" }),
          stderr: "",
        }),
      }),
    );

    await expect(
      createExternalToolsEffectiveRpcResult(createExternalToolControlPlane(registry), {
        includeUnavailable: true,
      }),
    ).resolves.toMatchObject({
      effectiveCount: 0,
      unavailableCount: 1,
      tools: [
        expect.objectContaining({
          id: "moyin.provider",
          status: "failed",
          canInvoke: false,
          doctor: expect.objectContaining({
            summary: expect.stringContaining("version is incompatible"),
            details: expect.objectContaining({
              version: expect.objectContaining({
                cli: "0.4.9",
                controlPlane: "0.12.9",
                compatibility: "incompatible",
                required: expect.objectContaining({
                  cli: ">=0.5.0",
                  controlPlane: ">=0.13.0",
                }),
              }),
            }),
          }),
        }),
      ],
    });
  });

  it("invokes Moyin sealed preview through structured JSON argv", async () => {
    const calls: unknown[] = [];
    const registry = new ExternalToolRegistry({ nowMs: () => 1_778_000_000_000 });
    registry.register(
      createMoyinProviderRegistration({
        runner: ({ binary, args }) => {
          calls.push({ binary, args });
          if (args.join(" ") === "status --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({ cliVersion: "0.5.2", protocolVersion: "0.13.0" }),
              stderr: "",
            };
          }
          if (
            args.join(" ") ===
            "sealed image --file /tmp/moyin/request.json --out /tmp/moyin/preview.json --json"
          ) {
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                sealedRequestId: "sealed-image-1",
                previewPath: "/tmp/moyin/preview.json",
              }),
              stderr: "",
            };
          }
          return { exitCode: 1, stdout: "", stderr: "unexpected command" };
        },
      }),
    );

    const result = await invokeExternalTool(registry, {
      toolId: "moyin.provider",
      operationId: "sealed.image.preview",
      args: {
        file: "/tmp/moyin/request.json",
        out: "/tmp/moyin/preview.json",
      },
    });

    expect(result).toMatchObject({
      ok: true,
      status: "success",
      content: "Moyin sealed image preview created.",
      output: {
        schemaVersion: "director.external-tool.v1",
        status: "success",
        provider: "moyin",
        operation: "sealed.image.preview",
        summary: "Moyin sealed image preview created.",
        output: expect.objectContaining({
          sealedRequestId: "sealed-image-1",
        }),
      },
    });
    expect(calls).toEqual([
      { binary: "moyin", args: ["status", "--json"] },
      {
        binary: "moyin",
        args: [
          "sealed",
          "image",
          "--file",
          "/tmp/moyin/request.json",
          "--out",
          "/tmp/moyin/preview.json",
          "--json",
        ],
      },
    ]);
  });

  it("materializes Moyin sealed preview requests from structured JSON without submitting", async () => {
    const root = mkdtempSync(join(tmpdir(), "angel-moyin-preview-"));
    try {
      const calls: unknown[] = [];
      const registry = new ExternalToolRegistry({ nowMs: () => 1_778_000_000_000 });
      registry.register(
        createMoyinProviderRegistration({
          runner: ({ binary, args }) => {
            calls.push({ binary, args });
            if (args.join(" ") === "status --json") {
              return {
                exitCode: 0,
                stdout: JSON.stringify({ cliVersion: "0.5.2", protocolVersion: "0.13.0" }),
                stderr: "",
              };
            }
            const fileIndex = args.indexOf("--file");
            const outIndex = args.indexOf("--out");
            const requestFile = fileIndex === -1 ? undefined : args[fileIndex + 1];
            const previewFile = outIndex === -1 ? undefined : args[outIndex + 1];
            expect(args.slice(0, 2)).toEqual(["sealed", "image"]);
            expect(requestFile).toBeDefined();
            expect(previewFile).toBeDefined();
            expect(existsSync(String(requestFile))).toBe(true);
            expect(JSON.parse(readFileSync(String(requestFile), "utf-8"))).toEqual({
              projectId: "project-1",
              prompt: "cinematic product shot",
            });
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                sealedRequestId: "sealed-image-json-1",
                executable: true,
                previewPath: previewFile,
              }),
              stderr: "",
            };
          },
        }),
      );

      const result = await invokeExternalTool(registry, {
        toolId: "moyin.provider",
        operationId: "sealed.image.preview",
        args: {
          requestJson: {
            projectId: "project-1",
            prompt: "cinematic product shot",
          },
          scratchDir: root,
        },
      });

      expect(result).toMatchObject({
        ok: true,
        status: "success",
        content: "Moyin sealed image preview created.",
        output: {
          schemaVersion: "director.external-tool.v1",
          status: "success",
          provider: "moyin",
          operation: "sealed.image.preview",
          output: expect.objectContaining({
            sealedRequestId: "sealed-image-json-1",
          }),
          metadata: expect.objectContaining({
            preparedRequest: expect.objectContaining({
              source: "requestJson",
            }),
          }),
        },
      });
      expect(calls).toHaveLength(2);
      expect(calls[1]).toMatchObject({
        binary: "moyin",
        args: expect.arrayContaining(["sealed", "image", "--file", "--out", "--json"]),
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not claim Moyin sealed preview was created when Moyin returns a non-executable preview", async () => {
    const registry = new ExternalToolRegistry({ nowMs: () => 1_778_000_000_000 });
    registry.register(
      createMoyinProviderRegistration({
        runner: ({ args }) => {
          if (args.join(" ") === "status --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({ cliVersion: "0.5.2", protocolVersion: "0.13.0" }),
              stderr: "",
            };
          }
          return {
            exitCode: 0,
            stdout: JSON.stringify({
              sealedRequestId: null,
              executable: false,
              missing: ["provider_model_binding", "apiKey"],
              blockers: [],
            }),
            stderr: "",
          };
        },
      }),
    );

    const result = await invokeExternalTool(registry, {
      toolId: "moyin.provider",
      operationId: "sealed.image.preview",
      args: {
        file: "/tmp/moyin/request.json",
      },
    });

    expect(result).toMatchObject({
      ok: false,
      status: "error",
      content: expect.stringContaining("not executable"),
      error: "MOYIN_SEALED_PREVIEW_NOT_EXECUTABLE",
      output: {
        schemaVersion: "director.external-tool.v1",
        status: "error",
        provider: "moyin",
        operation: "sealed.image.preview",
        summary: expect.stringContaining("not executable"),
        output: expect.objectContaining({
          executable: false,
          missing: ["provider_model_binding", "apiKey"],
        }),
      },
    });
    expect(result.content).not.toContain("created");
  });

  it("keeps Moyin sealed submit behind approval before invoking the CLI", async () => {
    const calls: unknown[] = [];
    const registry = new ExternalToolRegistry({ nowMs: () => 1_778_000_000_000 });
    registry.register(
      createMoyinProviderRegistration({
        runner: ({ binary, args }) => {
          calls.push({ binary, args });
          return {
            exitCode: 0,
            stdout: JSON.stringify({ cliVersion: "0.5.2", protocolVersion: "0.13.0" }),
            stderr: "",
          };
        },
      }),
    );

    const result = await invokeExternalTool(registry, {
      toolId: "moyin.provider",
      operationId: "sealed.submit",
      args: { sealedRequestId: "sealed-123" },
    });

    expect(result).toMatchObject({
      ok: false,
      status: "approval-required",
      operationId: "sealed.submit",
      error: "external-tool-approval-required",
      approval: expect.objectContaining({
        metadata: expect.objectContaining({
          operationId: "sealed.submit",
        }),
      }),
    });
    expect(calls).toEqual([{ binary: "moyin", args: ["status", "--json"] }]);
  });

  it("persists Moyin approval requests into the shared approval ledger with expiry", async () => {
    const root = mkdtempSync(join(tmpdir(), "angel-external-tool-approval-"));
    try {
      const calls: unknown[] = [];
      const approvalLedger = createFileConversationRuntimeApprovalLedger({
        rootPath: root,
        nowMs: () => 1_778_000_000_000,
      });
      const registry = new ExternalToolRegistry({
        nowMs: () => 1_778_000_000_000,
        approvalLedger,
        approvalTtlMs: 300_000,
      });
      registry.register(
        createMoyinProviderRegistration({
          runner: ({ binary, args }) => {
            calls.push({ binary, args });
            return {
              exitCode: 0,
              stdout: JSON.stringify({ cliVersion: "0.5.2", protocolVersion: "0.13.0" }),
              stderr: "",
            };
          },
        }),
      );

      const result = await invokeExternalTool(registry, {
        toolId: "moyin.provider",
        operationId: "sealed.submit",
        args: { sealedRequestId: "sealed-123" },
        turnId: "turn-moyin-submit",
        sessionKey: "desktop:workbench",
        idempotencyKey: "submit-sealed-123",
      });

      expect(result).toMatchObject({
        ok: false,
        status: "approval-required",
        approval: expect.objectContaining({
          id: "external-tool:turn-moyin-submit:moyin.provider:sealed.submit:submit-sealed-123",
        }),
      });
      expect(approvalLedger.listApprovals()).toEqual([
        expect.objectContaining({
          approvalId:
            "external-tool:turn-moyin-submit:moyin.provider:sealed.submit:submit-sealed-123",
          status: "pending",
          scope: "single_operation",
          operationId: "sealed.submit",
          turnId: "turn-moyin-submit",
          sessionKey: "desktop:workbench",
          toolCallId: "moyin.provider:sealed.submit",
          requestedByChannel: "runtime",
          requestedAtMs: 1_778_000_000_000,
          expiresAtMs: 1_778_000_300_000,
          redactedPayloadHash: expect.any(String),
        }),
      ]);
      const [approval] = approvalLedger.listApprovals();
      expect(approval?.redactedPayloadHash).toHaveLength(64);
      expect(approval?.redactedPayloadHash).not.toBe(
        hashConversationRuntimeToolArgs({ sealedRequestId: "sealed-123" }),
      );
      expect(calls).toEqual([{ binary: "moyin", args: ["status", "--json"] }]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("persists Moyin artifact refs with source-owned lifecycle metadata", async () => {
    const root = mkdtempSync(join(tmpdir(), "angel-moyin-artifact-lifecycle-"));
    try {
      const artifactStore = createFileConversationRuntimeExternalArtifactStore({
        rootPath: root,
        nowMs: () => 1_778_000_000_000,
      });
      const registry = new ExternalToolRegistry({
        nowMs: () => 1_778_000_000_000,
        artifactStore,
      });
      registry.register(
        createMoyinProviderRegistration({
          runner: ({ args }) => {
            if (args.join(" ") === "status --json") {
              return {
                exitCode: 0,
                stdout: JSON.stringify({ cliVersion: "0.5.2", protocolVersion: "0.13.0" }),
                stderr: "",
              };
            }
            if (
              args.join(" ") ===
              "artifact list --project project-1 --run run-1 --step step-1 --type video --json"
            ) {
              return {
                exitCode: 0,
                stdout: JSON.stringify({
                  items: [
                    {
                      artifactId: "moyin-video-1",
                      type: "video",
                      role: "generated-video",
                      uri: "file:///tmp/moyin/video.mp4",
                      localPath: "/tmp/moyin/video.mp4",
                      projectId: "project-1",
                      runId: "run-1",
                      stepId: "step-1",
                    },
                  ],
                }),
                stderr: "",
              };
            }
            return { exitCode: 1, stdout: "", stderr: `unexpected ${args.join(" ")}` };
          },
        }),
      );

      const result = await invokeExternalTool(registry, {
        toolId: "moyin.provider",
        operationId: "artifact.list",
        turnId: "turn-1",
        sessionKey: "desktop:workbench",
        args: {
          projectId: "project-1",
          runId: "run-1",
          stepId: "step-1",
          type: "video",
        },
      });

      expect(result).toMatchObject({
        ok: true,
        status: "success",
        artifacts: [
          expect.objectContaining({
            id: "moyin-video-1",
            kind: "video",
            path: "/tmp/moyin/video.mp4",
            metadata: expect.objectContaining({
              provider: "moyin",
              role: "generated-video",
              retention: "user_controlled",
              sensitivity: "internal",
              cleanupPolicyRef: "artifactPolicy.moyin.source-owned.user-controlled",
              lifecycle: expect.objectContaining({
                owner: "moyin",
                sourceOfTruth: "moyin-control-plane",
              }),
            }),
          }),
        ],
        metadata: expect.objectContaining({
          artifactPersistence: expect.objectContaining({
            artifactIds: ["moyin-video-1"],
            storeRef: "conversation-runtime.external-artifact-store",
          }),
        }),
      });
      expect(artifactStore.listArtifacts({ providerId: "moyin", runId: "run-1" })).toEqual([
        expect.objectContaining({
          artifactId: "moyin-video-1",
          retention: "user_controlled",
          sensitivity: "internal",
          cleanupPolicyRef: "artifactPolicy.moyin.source-owned.user-controlled",
          localPath: "/tmp/moyin/video.mp4",
          url: "file:///tmp/moyin/video.mp4",
        }),
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("invokes Moyin sealed submit only after approval with explicit confirmation argv", async () => {
    const calls: unknown[] = [];
    const registry = new ExternalToolRegistry({ nowMs: () => 1_778_000_000_000 });
    registry.register(
      createMoyinProviderRegistration({
        runner: ({ binary, args }) => {
          calls.push({ binary, args });
          if (args.join(" ") === "status --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({ cliVersion: "0.5.2", protocolVersion: "0.13.0" }),
              stderr: "",
            };
          }
          if (args.join(" ") === "sealed submit sealed-123 --confirm SUBMIT --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                sealedRequestId: "sealed-123",
                task: { id: "task-123", status: "queued" },
              }),
              stderr: "",
            };
          }
          return { exitCode: 1, stdout: "", stderr: "unexpected command" };
        },
      }),
    );

    const result = await invokeExternalTool(registry, {
      toolId: "moyin.provider",
      operationId: "sealed.submit",
      args: { sealedRequestId: "sealed-123" },
      approval: { status: "approved", operatorId: "operator-1" },
      sandboxPreflight: {
        verdict: "allow",
        sandboxMode: "workspace-write",
        checkedAt: "2026-05-27T00:00:00.000Z",
        providerId: "moyin",
        reason: "trusted desktop sandbox granted Moyin sealed submit",
      },
      sandboxRuntimePolicy: {
        enabledBackends: ["workspace-write"],
      },
    });

    expect(result).toMatchObject({
      ok: true,
      status: "success",
      content: "Moyin sealed request submitted.",
      output: {
        schemaVersion: "director.external-tool.v1",
        status: "success",
        provider: "moyin",
        operation: "sealed.submit",
      },
    });
    expect(calls).toEqual([
      { binary: "moyin", args: ["status", "--json"] },
      {
        binary: "moyin",
        args: ["sealed", "submit", "sealed-123", "--confirm", "SUBMIT", "--json"],
      },
    ]);
  });

  it("rejects approved Moyin submit when the shared approval ledger entry is expired", async () => {
    const root = mkdtempSync(join(tmpdir(), "angel-external-tool-approval-expired-"));
    try {
      const calls: unknown[] = [];
      const approvalLedger = createFileConversationRuntimeApprovalLedger({
        rootPath: root,
        nowMs: () => 1_778_000_400_000,
      });
      approvalLedger.upsertApproval({
        approval: {
          schemaVersion: "conversation-runtime.approval-ledger-record.v1",
          approvalId:
            "external-tool:turn-moyin-submit:moyin.provider:sealed.submit:submit-sealed-123",
          status: "pending",
          turnId: "turn-moyin-submit",
          sessionKey: "desktop:workbench",
          toolCallId: "moyin.provider:sealed.submit",
          argsHash: hashConversationRuntimeToolArgs({ sealedRequestId: "sealed-123" }),
          requestedByChannel: "runtime",
          requestedAtMs: 1_778_000_000_000,
          expiresAtMs: 1_778_000_300_000,
        },
      });
      const registry = new ExternalToolRegistry({
        nowMs: () => 1_778_000_400_000,
        approvalLedger,
      });
      registry.register(
        createMoyinProviderRegistration({
          runner: ({ binary, args }) => {
            calls.push({ binary, args });
            return {
              exitCode: 0,
              stdout: JSON.stringify({ cliVersion: "0.5.2", protocolVersion: "0.13.0" }),
              stderr: "",
            };
          },
        }),
      );

      const result = await invokeExternalTool(registry, {
        toolId: "moyin.provider",
        operationId: "sealed.submit",
        args: { sealedRequestId: "sealed-123" },
        turnId: "turn-moyin-submit",
        sessionKey: "desktop:workbench",
        idempotencyKey: "submit-sealed-123",
        approval: { status: "approved", operatorId: "operator-1" },
        sandboxPreflight: {
          verdict: "allow",
          sandboxMode: "workspace-write",
          checkedAt: "2026-05-27T00:00:00.000Z",
          providerId: "moyin",
          reason: "trusted desktop sandbox granted Moyin sealed submit",
        },
        sandboxRuntimePolicy: {
          enabledBackends: ["workspace-write"],
        },
      });

      expect(result).toMatchObject({
        ok: false,
        status: "permission-denied",
        error: "external-tool-approval-ledger-expired",
      });
      expect(calls).toEqual([{ binary: "moyin", args: ["status", "--json"] }]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("invokes Moyin task watch and artifact reads through read-only operations", async () => {
    const calls: unknown[] = [];
    const registry = new ExternalToolRegistry({ nowMs: () => 1_778_000_000_000 });
    registry.register(
      createMoyinProviderRegistration({
        runner: ({ binary, args }) => {
          calls.push({ binary, args });
          if (args.join(" ") === "status --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({ cliVersion: "0.5.2", protocolVersion: "0.13.0" }),
              stderr: "",
            };
          }
          if (args.join(" ") === "task list --project project-1 --status running --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                items: [{ taskId: "task-123", status: "running" }],
                total: 1,
              }),
              stderr: "",
            };
          }
          if (args.join(" ") === "task watch task-123 --project project-1 --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({ taskId: "task-123", status: "succeeded", progress: 1 }),
              stderr: "",
            };
          }
          if (args.join(" ") === "task watch task-ndjson --project project-1 --json") {
            return {
              exitCode: 0,
              stdout: [
                JSON.stringify({
                  eventId: "event-1",
                  type: "task.upsert",
                  payload: { task: { id: "task-ndjson", status: "running", progress: 20 } },
                }),
                JSON.stringify({
                  eventId: "event-2",
                  type: "task.upsert",
                  payload: { task: { id: "task-ndjson", status: "completed", progress: 100 } },
                }),
              ].join("\n"),
              stderr: "",
            };
          }
          if (
            args.join(" ") ===
            "artifact list --project project-1 --run run-1 --step step-1 --type image --json"
          ) {
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                items: [
                  {
                    artifactId: "artifact-1",
                    type: "image",
                    uri: "file:///tmp/moyin/out.png",
                    localPath: "/tmp/moyin/out.png",
                    role: "generated-frame",
                    projectId: "project-1",
                    runId: "run-1",
                    stepId: "step-1",
                  },
                ],
              }),
              stderr: "",
            };
          }
          if (args.join(" ") === "workflow-run list --project project-1 --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                items: [{ runId: "run-1", status: "draft" }],
                total: 1,
              }),
              stderr: "",
            };
          }
          if (args.join(" ") === "artifact get artifact-1 --project project-1 --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({ artifactId: "artifact-1", type: "image" }),
              stderr: "",
            };
          }
          if (args.join(" ") === "artifact backfill --project project-1 --task task-123 --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                items: [
                  {
                    artifactId: "artifact-backfilled-1",
                    type: "image",
                    uri: "file:///tmp/moyin/backfilled.png",
                    localPath: "/tmp/moyin/backfilled.png",
                    role: "director-keyframe-frame-image",
                    projectId: "project-1",
                    taskId: "task-123",
                    source: "task-summary-auto-backfill",
                  },
                ],
                total: 1,
                taskCount: 1,
                warnings: [
                  "Artifact backfill indexes completed task summaries only; it does not submit jobs or rerun generation.",
                ],
              }),
              stderr: "",
            };
          }
          return { exitCode: 1, stdout: "", stderr: "unexpected command" };
        },
      }),
    );

    await expect(
      invokeExternalTool(registry, {
        toolId: "moyin.provider",
        operationId: "task.list",
        args: { projectId: "project-1", status: "running" },
      }),
    ).resolves.toMatchObject({
      ok: true,
      status: "success",
      content: "Moyin tasks: 1.",
    });
    await expect(
      invokeExternalTool(registry, {
        toolId: "moyin.provider",
        operationId: "task.watch",
        args: { taskId: "task-123", projectId: "project-1" },
      }),
    ).resolves.toMatchObject({
      ok: true,
      status: "success",
      content: "Moyin task watch completed.",
    });
    await expect(
      invokeExternalTool(registry, {
        toolId: "moyin.provider",
        operationId: "task.watch",
        args: { taskId: "task-ndjson", projectId: "project-1" },
      }),
    ).resolves.toMatchObject({
      ok: true,
      status: "success",
      content: "Moyin task watch completed.",
      output: {
        schemaVersion: "director.external-tool.v1",
        status: "success",
        output: expect.objectContaining({
          taskId: "task-ndjson",
          status: "completed",
          progress: 100,
        }),
      },
    });
    await expect(
      invokeExternalTool(registry, {
        toolId: "moyin.provider",
        operationId: "artifact.list",
        args: { projectId: "project-1", runId: "run-1", stepId: "step-1", type: "image" },
      }),
    ).resolves.toMatchObject({
      ok: true,
      status: "success",
      content: "Moyin artifacts: 1.",
      artifacts: [
        {
          id: "artifact-1",
          kind: "image",
          path: "/tmp/moyin/out.png",
          url: "file:///tmp/moyin/out.png",
          metadata: expect.objectContaining({
            provider: "moyin",
            role: "generated-frame",
            projectId: "project-1",
            runId: "run-1",
            stepId: "step-1",
          }),
        },
      ],
    });
    await expect(
      invokeExternalTool(registry, {
        toolId: "moyin.provider",
        operationId: "artifact.get",
        args: { projectId: "project-1", artifactId: "artifact-1" },
      }),
    ).resolves.toMatchObject({
      ok: true,
      status: "success",
      content: "Moyin artifact retrieved.",
    });
    await expect(
      invokeExternalTool(registry, {
        toolId: "moyin.provider",
        operationId: "artifact.backfill",
        args: { projectId: "project-1", taskId: "task-123" },
      }),
    ).resolves.toMatchObject({
      ok: true,
      status: "success",
      content: "Moyin artifact backfill recovered 1 artifact.",
      artifacts: [
        {
          id: "artifact-backfilled-1",
          kind: "image",
          path: "/tmp/moyin/backfilled.png",
          url: "file:///tmp/moyin/backfilled.png",
          metadata: expect.objectContaining({
            provider: "moyin",
            role: "director-keyframe-frame-image",
            projectId: "project-1",
            taskId: "task-123",
            source: "task-summary-auto-backfill",
          }),
        },
      ],
    });
    await expect(
      invokeExternalTool(registry, {
        toolId: "moyin.provider",
        operationId: "workflow-run.list",
        args: { projectId: "project-1" },
      }),
    ).resolves.toMatchObject({
      ok: true,
      status: "success",
      content: "Moyin workflow runs: 1.",
    });

    expect(calls).toEqual([
      { binary: "moyin", args: ["status", "--json"] },
      {
        binary: "moyin",
        args: ["task", "list", "--project", "project-1", "--status", "running", "--json"],
      },
      {
        binary: "moyin",
        args: ["task", "watch", "task-123", "--project", "project-1", "--json"],
      },
      {
        binary: "moyin",
        args: ["task", "watch", "task-ndjson", "--project", "project-1", "--json"],
      },
      {
        binary: "moyin",
        args: [
          "artifact",
          "list",
          "--project",
          "project-1",
          "--run",
          "run-1",
          "--step",
          "step-1",
          "--type",
          "image",
          "--json",
        ],
      },
      {
        binary: "moyin",
        args: ["artifact", "get", "artifact-1", "--project", "project-1", "--json"],
      },
      {
        binary: "moyin",
        args: ["artifact", "backfill", "--project", "project-1", "--task", "task-123", "--json"],
      },
      {
        binary: "moyin",
        args: ["workflow-run", "list", "--project", "project-1", "--json"],
      },
    ]);
  });

  it("lets Moyin task watch override the provider command timeout", async () => {
    const calls: unknown[] = [];
    const registry = new ExternalToolRegistry({ nowMs: () => 1_778_000_000_000 });
    registry.register(
      createMoyinProviderRegistration({
        timeoutMs: 30_000,
        runner: ({ binary, args, timeoutMs }) => {
          calls.push({ binary, args, timeoutMs });
          if (args.join(" ") === "status --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({ cliVersion: "0.5.2", protocolVersion: "0.13.0" }),
              stderr: "",
            };
          }
          if (args.join(" ") === "task watch task-long --project project-1 --json") {
            return {
              exitCode: 0,
              stdout: [
                JSON.stringify({
                  type: "task.upsert",
                  payload: { task: { id: "task-long", status: "running", progress: 10 } },
                }),
                JSON.stringify({
                  type: "task.upsert",
                  payload: { task: { id: "task-long", status: "completed", progress: 100 } },
                }),
              ].join("\n"),
              stderr: "",
            };
          }
          return { exitCode: 1, stdout: "", stderr: "unexpected command" };
        },
      }),
    );

    await expect(
      invokeExternalTool(registry, {
        toolId: "moyin.provider",
        operationId: "task.watch",
        args: { taskId: "task-long", projectId: "project-1", timeoutMs: 600_000 },
      }),
    ).resolves.toMatchObject({
      ok: true,
      status: "success",
      content: "Moyin task watch completed.",
      output: {
        status: "success",
        output: expect.objectContaining({
          taskId: "task-long",
          status: "completed",
          progress: 100,
        }),
      },
    });

    expect(calls).toEqual([
      { binary: "moyin", args: ["status", "--json"], timeoutMs: 30_000 },
      {
        binary: "moyin",
        args: ["task", "watch", "task-long", "--project", "project-1", "--json"],
        timeoutMs: 600_000,
      },
    ]);
  });

  it("invokes Moyin workflow-run create/get/steps and gates advance behind approval", async () => {
    const calls: unknown[] = [];
    const registry = new ExternalToolRegistry({ nowMs: () => 1_778_000_000_000 });
    registry.register(
      createMoyinProviderRegistration({
        runner: ({ binary, args }) => {
          calls.push({ binary, args });
          if (args.join(" ") === "status --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({ cliVersion: "0.5.2", protocolVersion: "0.13.0" }),
              stderr: "",
            };
          }
          if (
            args.join(" ") === "workflow-run create --project project-1 --file /tmp/run.json --json"
          ) {
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                runId: "run-1",
                projectId: "project-1",
                status: "draft",
                steps: [{ stepId: "step-1", status: "ready" }],
              }),
              stderr: "",
            };
          }
          if (args.join(" ") === "workflow-run get run-1 --project project-1 --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                runId: "run-1",
                projectId: "project-1",
                status: "ready",
              }),
              stderr: "",
            };
          }
          if (args.join(" ") === "workflow-run steps run-1 --project project-1 --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                items: [
                  {
                    stepId: "step-1",
                    status: "ready",
                    sealedRequestId: "sealed-1",
                    taskId: "task-1",
                    warnings: ["approval needed before execute"],
                    artifacts: [{ artifactId: "artifact-1", type: "image" }],
                  },
                ],
                total: 1,
              }),
              stderr: "",
            };
          }
          if (
            args.join(" ") ===
            "workflow-run advance run-1 --project project-1 --step step-1 --action build_request --file /tmp/values.json --execution /tmp/execution.json --json"
          ) {
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                runId: "run-1",
                projectId: "project-1",
                stepId: "step-1",
                action: "build_request",
                status: "advanced",
                step: {
                  stepId: "step-1",
                  status: "approval_required",
                  sealedRequestId: "sealed-1",
                  warnings: ["operator approval required before execute"],
                },
                artifacts: [{ artifactId: "artifact-1", type: "image" }],
              }),
              stderr: "",
            };
          }
          return { exitCode: 1, stdout: "", stderr: "unexpected command" };
        },
      }),
    );

    await expect(
      invokeExternalTool(registry, {
        toolId: "moyin.provider",
        operationId: "workflow-run.create",
        args: { projectId: "project-1", file: "/tmp/run.json" },
      }),
    ).resolves.toMatchObject({
      ok: true,
      status: "success",
      content: "Moyin workflow run created.",
    });
    await expect(
      invokeExternalTool(registry, {
        toolId: "moyin.provider",
        operationId: "workflow-run.get",
        args: { projectId: "project-1", runId: "run-1" },
      }),
    ).resolves.toMatchObject({
      ok: true,
      status: "success",
      content: "Moyin workflow run retrieved.",
    });
    await expect(
      invokeExternalTool(registry, {
        toolId: "moyin.provider",
        operationId: "workflow-run.steps",
        args: { projectId: "project-1", runId: "run-1" },
      }),
    ).resolves.toMatchObject({
      ok: true,
      status: "success",
      content: "Moyin workflow run steps retrieved.",
    });

    await expect(
      invokeExternalTool(registry, {
        toolId: "moyin.provider",
        operationId: "workflow-run.advance",
        args: {
          projectId: "project-1",
          runId: "run-1",
          stepId: "step-1",
          action: "build_request",
          file: "/tmp/values.json",
          execution: "/tmp/execution.json",
        },
      }),
    ).resolves.toMatchObject({
      ok: false,
      status: "approval-required",
      error: "external-tool-approval-required",
    });
    expect(calls).toEqual([
      { binary: "moyin", args: ["status", "--json"] },
      {
        binary: "moyin",
        args: [
          "workflow-run",
          "create",
          "--project",
          "project-1",
          "--file",
          "/tmp/run.json",
          "--json",
        ],
      },
      {
        binary: "moyin",
        args: ["workflow-run", "get", "run-1", "--project", "project-1", "--json"],
      },
      {
        binary: "moyin",
        args: ["workflow-run", "steps", "run-1", "--project", "project-1", "--json"],
      },
    ]);

    const advanced = await invokeExternalTool(registry, {
      toolId: "moyin.provider",
      operationId: "workflow-run.advance",
      args: {
        projectId: "project-1",
        runId: "run-1",
        stepId: "step-1",
        action: "build_request",
        file: "/tmp/values.json",
        execution: "/tmp/execution.json",
      },
      approval: { status: "approved", operatorId: "operator-1" },
      sandboxPreflight: {
        verdict: "allow",
        sandboxMode: "workspace-write",
        checkedAt: "2026-05-27T00:00:00.000Z",
        providerId: "moyin",
        reason: "trusted local Moyin workflow run advance",
      },
      sandboxRuntimePolicy: { enabledBackends: ["workspace-write"] },
    });

    expect(advanced).toMatchObject({
      ok: true,
      status: "success",
      content: "Moyin workflow run advanced.",
      output: {
        schemaVersion: "director.external-tool.v1",
        provider: "moyin",
        operation: "workflow-run.advance",
        events: [
          {
            kind: "external.provider.workflow_run_advanced",
            providerId: "moyin",
            operationId: "workflow-run.advance",
            projectId: "project-1",
            runId: "run-1",
            stepId: "step-1",
            action: "build_request",
            status: "advanced",
          },
        ],
        output: expect.objectContaining({
          runId: "run-1",
          status: "advanced",
          step: expect.objectContaining({
            stepId: "step-1",
            status: "approval_required",
            sealedRequestId: "sealed-1",
          }),
        }),
      },
    });
    expect(calls.at(-1)).toEqual({
      binary: "moyin",
      args: [
        "workflow-run",
        "advance",
        "run-1",
        "--project",
        "project-1",
        "--step",
        "step-1",
        "--action",
        "build_request",
        "--file",
        "/tmp/values.json",
        "--execution",
        "/tmp/execution.json",
        "--json",
      ],
    });
  });

  it("treats Moyin workflow-run advance JSON failed state as provider failure", async () => {
    const calls: unknown[] = [];
    const registry = new ExternalToolRegistry({ nowMs: () => 1_778_000_000_000 });
    registry.register(
      createMoyinProviderRegistration({
        runner: ({ binary, args }) => {
          calls.push({ binary, args });
          if (args.join(" ") === "status --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({ cliVersion: "0.5.2", protocolVersion: "0.13.0" }),
              stderr: "",
            };
          }
          if (
            args.join(" ") ===
            "workflow-run advance run-1 --project project-1 --step step-1 --action build_sealed_request --json"
          ) {
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                run: {
                  runId: "run-1",
                  projectId: "project-1",
                  status: "failed",
                },
                step: {
                  stepId: "step-1",
                  status: "failed",
                  error: {
                    code: "WORKFLOW_RUN_STEP_NOT_READY",
                    message: "WORKFLOW_RUN_STEP_NOT_READY: step step-1 is approval_required.",
                    recoverable: true,
                  },
                },
                warnings: ["WORKFLOW_RUN_STEP_NOT_READY: step step-1 is approval_required."],
              }),
              stderr: "",
            };
          }
          return { exitCode: 1, stdout: "", stderr: "unexpected command" };
        },
      }),
    );

    const result = await invokeExternalTool(registry, {
      toolId: "moyin.provider",
      operationId: "workflow-run.advance",
      args: {
        projectId: "project-1",
        runId: "run-1",
        stepId: "step-1",
        action: "build_sealed_request",
      },
      approval: { status: "approved", operatorId: "operator-1" },
      sandboxPreflight: {
        verdict: "allow",
        sandboxMode: "workspace-write",
        checkedAt: "2026-05-27T00:00:00.000Z",
        providerId: "moyin",
        reason: "trusted local Moyin workflow run advance",
      },
      sandboxRuntimePolicy: { enabledBackends: ["workspace-write"] },
    });

    expect(result).toMatchObject({
      ok: false,
      status: "error",
      error: "WORKFLOW_RUN_STEP_NOT_READY",
      output: {
        schemaVersion: "director.external-tool.v1",
        status: "error",
        provider: "moyin",
        operation: "workflow-run.advance",
        error: {
          code: "WORKFLOW_RUN_STEP_NOT_READY",
          rootCauseHint:
            "Moyin accepted the advance command but marked the workflow-run or target step as failed; do not treat this mutation as successful.",
        },
        output: expect.objectContaining({
          step: expect.objectContaining({
            stepId: "step-1",
            status: "failed",
          }),
        }),
      },
    });
    expect(calls.at(-1)).toEqual({
      binary: "moyin",
      args: [
        "workflow-run",
        "advance",
        "run-1",
        "--project",
        "project-1",
        "--step",
        "step-1",
        "--action",
        "build_sealed_request",
        "--json",
      ],
    });
  });

  it("keeps Moyin task and workflow-run cancellation behind approval and emits cancellation events", async () => {
    const calls: unknown[] = [];
    const registry = new ExternalToolRegistry({ nowMs: () => 1_778_000_000_000 });
    registry.register(
      createMoyinProviderRegistration({
        runner: ({ binary, args }) => {
          calls.push({ binary, args });
          if (args.join(" ") === "status --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({ cliVersion: "0.5.2", protocolVersion: "0.13.0" }),
              stderr: "",
            };
          }
          if (args.join(" ") === "task cancel task-123 --project project-1 --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                taskId: "task-123",
                projectId: "project-1",
                status: "cancelled",
                reason: "operator stopped task",
              }),
              stderr: "",
            };
          }
          if (args.join(" ") === "workflow-run cancel run-1 --project project-1 --json") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                runId: "run-1",
                projectId: "project-1",
                status: "cancelled",
              }),
              stderr: "",
            };
          }
          return { exitCode: 1, stdout: "", stderr: "unexpected command" };
        },
      }),
    );

    await expect(
      invokeExternalTool(registry, {
        toolId: "moyin.provider",
        operationId: "task.cancel",
        args: { taskId: "task-123", projectId: "project-1" },
      }),
    ).resolves.toMatchObject({
      ok: false,
      status: "approval-required",
      error: "external-tool-approval-required",
    });
    expect(calls).toEqual([{ binary: "moyin", args: ["status", "--json"] }]);

    const taskCancelled = await invokeExternalTool(registry, {
      toolId: "moyin.provider",
      operationId: "task.cancel",
      args: { taskId: "task-123", projectId: "project-1" },
      approval: { status: "approved", operatorId: "operator-1" },
      sandboxPreflight: {
        verdict: "allow",
        sandboxMode: "workspace-write",
        checkedAt: "2026-05-27T00:00:00.000Z",
        providerId: "moyin",
        reason: "trusted local Moyin task cancellation",
      },
      sandboxRuntimePolicy: { enabledBackends: ["workspace-write"] },
    });
    const runCancelled = await invokeExternalTool(registry, {
      toolId: "moyin.provider",
      operationId: "workflow-run.cancel",
      args: { runId: "run-1", projectId: "project-1" },
      approval: { status: "approved", operatorId: "operator-1" },
      sandboxPreflight: {
        verdict: "allow",
        sandboxMode: "workspace-write",
        checkedAt: "2026-05-27T00:00:00.000Z",
        providerId: "moyin",
        reason: "trusted local Moyin workflow run cancellation",
      },
      sandboxRuntimePolicy: { enabledBackends: ["workspace-write"] },
    });

    expect(taskCancelled).toMatchObject({
      ok: true,
      status: "success",
      content: "Moyin task cancelled.",
      output: {
        schemaVersion: "director.external-tool.v1",
        provider: "moyin",
        operation: "task.cancel",
        events: [
          {
            kind: "external.provider.cancelled",
            providerId: "moyin",
            operationId: "task.cancel",
            taskId: "task-123",
            projectId: "project-1",
            reason: "operator stopped task",
          },
        ],
      },
    });
    expect(runCancelled).toMatchObject({
      ok: true,
      status: "success",
      content: "Moyin workflow run cancelled.",
      output: {
        schemaVersion: "director.external-tool.v1",
        provider: "moyin",
        operation: "workflow-run.cancel",
        events: [
          {
            kind: "external.provider.cancelled",
            providerId: "moyin",
            operationId: "workflow-run.cancel",
            runId: "run-1",
            projectId: "project-1",
          },
        ],
      },
    });
    expect(calls.slice(1)).toEqual([
      {
        binary: "moyin",
        args: ["task", "cancel", "task-123", "--project", "project-1", "--json"],
      },
      {
        binary: "moyin",
        args: ["workflow-run", "cancel", "run-1", "--project", "project-1", "--json"],
      },
    ]);
  });

  it("routes Moyin-style external system control through one session and approval envelope", async () => {
    const registry = new ExternalToolRegistry({ nowMs: () => 1_776_000_000_000 });
    registry.register({
      manifest: createExternalToolProviderManifest({
        id: "moyin.control",
        label: "Moyin",
        description: "Future Moyin workspace control surface.",
        source: "external",
        providerId: "moyin",
        capabilities: [
          {
            id: "project.create",
            label: "Create project",
            readOnly: false,
            requiresApproval: true,
            metadata: { capability: "moyin.project.create" },
          },
          {
            id: "project.status",
            label: "Project status",
            readOnly: true,
            metadata: { capability: "moyin.project.status" },
          },
        ],
        approvalBoundary: {
          mode: "operator-confirm",
          actionLabels: ["确认", "拒绝"],
          requiresOperator: true,
          riskLevel: "medium",
        },
      }),
      invoke: ({ args, operationId }) => ({
        ok: true,
        content: `Moyin ${operationId} accepted: ${String(args.objective ?? "")}`,
        output: { operationId, args },
        metadata: { acceptedBy: "moyin-adapter" },
      }),
    });
    const controlPlane = createExternalToolControlPlane(registry);
    const angelRoleProfile = {
      roleId: "director-angel",
      title: "导演 Angel",
      domain: "影视制作",
      responsibilities: ["持续学习影视制作经验", "编排制作系统"],
      learningScope: ["短剧制作"],
      controllableSystems: ["moyin"],
    };
    const request = createExternalSystemControlRequest({
      systemId: "moyin",
      toolId: "moyin.control",
      operationId: "project.create",
      objective: "创建一个 15 秒短剧项目",
      sessionKey: "weixin:user-1",
      turnId: "turn-1",
      args: { projectName: "短剧分镜测试" },
      angelRoleProfile,
      userFacingProjection: {
        userText: "我会先确认再让 Moyin 创建项目。",
        briefStatus: "等待确认",
        canRetry: true,
        suggestedNextStep: "确认后继续执行",
      },
    });

    expect(request).toMatchObject({
      toolId: "moyin.control",
      operationId: "project.create",
      sessionKey: "weixin:user-1",
      turnId: "turn-1",
      args: {
        objective: "创建一个 15 秒短剧项目",
        projectName: "短剧分镜测试",
      },
      metadata: {
        externalSystemControl: {
          schemaVersion: "director.external-system-control.v1",
          systemId: "moyin",
          objective: "创建一个 15 秒短剧项目",
          sessionKey: "weixin:user-1",
          turnId: "turn-1",
          angelRoleProfile,
          userFacingProjection: {
            briefStatus: "等待确认",
          },
        },
      },
    });

    const approval = await invokeExternalSystemControl(controlPlane, request);
    expect(approval).toMatchObject({
      schemaVersion: "director.external-tools.invoke.v1",
      status: "approval-required",
      requiresApproval: true,
      approval: {
        metadata: {
          toolId: "moyin.control",
          operationId: "project.create",
          providerId: "moyin",
          approvalBoundary: expect.objectContaining({
            mode: "operator-confirm",
          }),
        },
      },
      metadata: {
        externalSystemControl: expect.objectContaining({
          schemaVersion: "director.external-system-control.v1",
          systemId: "moyin",
          angelRoleProfile,
        }),
      },
    });

    const executed = await invokeExternalSystemControl(controlPlane, {
      ...request,
      approval: { status: "approved", operatorId: "operator-1" },
      sandboxRuntimePolicy: {
        enabledBackends: ["workspace-write"],
        readableRoots: ["/workspace/director-angel-os"],
        writableRoots: ["/workspace/director-angel-os/.hotflow"],
        networkPolicy: "none",
      },
      sandboxPreflight: {
        verdict: "allow",
        sandboxMode: "workspace-write",
        checkedAt: "2026-05-12T11:45:00.000Z",
        providerId: "moyin",
      },
    });
    expect(executed).toMatchObject({
      ok: true,
      status: "success",
      content: "Moyin project.create accepted: 创建一个 15 秒短剧项目",
      metadata: {
        externalSystemControl: expect.objectContaining({
          systemId: "moyin",
          userFacingProjection: expect.objectContaining({
            userText: "我会先确认再让 Moyin 创建项目。",
          }),
        }),
      },
    });
  });

  it("represents web, browser, MCP, and ComfyUI through one catalog contract", async () => {
    const [webSearch] = createBuiltinWebTools();
    const [browserNavigate] = createBuiltinBrowserTools();
    const [mcpSearch] = await createConversationRuntimeMcpTools({
      provider: {
        listTools: () => [
          {
            serverName: "exa.search",
            toolName: "web search",
            description: "Neural search",
            readOnly: true,
          },
        ],
      },
    });

    const catalog = createExternalToolCatalog([
      createExternalToolManifestFromModelTool(webSearch),
      createExternalToolManifestFromModelTool(browserNavigate),
      createExternalToolManifestFromModelTool(mcpSearch),
      {
        id: "comfyui",
        label: "ComfyUI",
        description: "Control an external ComfyUI server through workflow adapters.",
        source: "external",
        kind: "provider",
        providerId: "comfyui",
        capabilities: [
          { id: "workflow", label: "Workflow", readOnly: false, requiresApproval: true },
          { id: "image", label: "Image", readOnly: false, requiresApproval: true },
          { id: "video", label: "Video", readOnly: false, requiresApproval: true },
        ],
        metadata: {
          boundary: "external-provider",
        },
      },
    ]);

    expect(catalog.map((entry) => entry.id)).toEqual([
      "browser_navigate",
      "comfyui",
      "mcp__exa_search__web_search",
      "web_search",
    ]);
    expect(catalog.find((entry) => entry.id === "comfyui")).toMatchObject({
      source: "external",
      kind: "provider",
      providerId: "comfyui",
      capabilities: expect.arrayContaining([
        expect.objectContaining({ id: "workflow", requiresApproval: true }),
      ]),
      metadata: expect.objectContaining({
        boundary: "external-provider",
      }),
    });
    expect(catalog.find((entry) => entry.id === "mcp__exa_search__web_search")).toMatchObject({
      source: "mcp",
      kind: "model-tool",
      capabilities: [expect.objectContaining({ id: "mcp.tool", readOnly: true })],
    });
  });

  it("builds media, notebook, and browser providers from one capability matrix", () => {
    const catalog = createExternalToolCatalog([
      createExternalToolProviderManifest({
        id: "media-suite",
        label: "Media Suite",
        description: "External image, video, audio, and media-understanding provider.",
        source: "external",
        providerId: "media-suite",
        capabilityPreset: "media",
        enabled: true,
        sourceTrust: { status: "user-configured", label: "用户配置" },
        approvalBoundary: {
          mode: "operator-confirm",
          actionLabels: ["确认", "拒绝"],
          requiresOperator: true,
        },
      }),
      createExternalToolProviderManifest({
        id: "notebooklm",
        label: "NotebookLM",
        description: "External notebook research workspace controlled through browser/MCP/API.",
        source: "external",
        providerId: "notebooklm",
        capabilityPreset: "notebook",
        enabled: false,
      }),
      createExternalToolProviderManifest({
        id: "desktop-browser",
        label: "Desktop Browser",
        description: "Shared desktop browser provider.",
        source: "built-in",
        providerId: "desktop-browser",
        capabilityPreset: "browser",
      }),
    ]);

    expect(catalog.find((entry) => entry.id === "media-suite")).toMatchObject({
      kind: "provider",
      source: "external",
      providerId: "media-suite",
      capabilities: expect.arrayContaining([
        expect.objectContaining({
          id: "media.generate_image",
          readOnly: false,
          requiresApproval: true,
        }),
        expect.objectContaining({
          id: "media.generate_video",
          readOnly: false,
          requiresApproval: true,
        }),
        expect.objectContaining({
          id: "audio.synthesize",
          readOnly: false,
          requiresApproval: true,
        }),
        expect.objectContaining({
          id: "audio.transcribe",
          readOnly: false,
          requiresApproval: true,
        }),
        expect.objectContaining({
          id: "audio.realtime.talk",
          readOnly: false,
          requiresApproval: true,
        }),
        expect.objectContaining({ id: "media.understand_image", readOnly: true }),
        expect.objectContaining({ id: "media.understand_video", readOnly: true }),
      ]),
      metadata: expect.objectContaining({
        capabilityPreset: "media",
        providerBoundary: "external-provider",
      }),
    });
    expect(catalog.find((entry) => entry.id === "notebooklm")).toMatchObject({
      enabled: false,
      capabilities: expect.arrayContaining([
        expect.objectContaining({ id: "notebook.create", requiresApproval: true }),
        expect.objectContaining({ id: "notebook.upload_source", requiresApproval: true }),
        expect.objectContaining({ id: "notebook.query", readOnly: true }),
      ]),
    });
    expect(catalog.find((entry) => entry.id === "desktop-browser")).toMatchObject({
      capabilities: expect.arrayContaining([
        expect.objectContaining({ id: "browser.navigate", requiresApproval: true }),
        expect.objectContaining({ id: "browser.snapshot", readOnly: true }),
        expect.objectContaining({ id: "browser.images", readOnly: true }),
      ]),
    });
    expect(createExternalToolProviderCapabilities("media").map((item) => item.id)).toEqual([
      "media.generate_image",
      "media.generate_video",
      "audio.synthesize",
      "audio.transcribe",
      "audio.realtime.transcribe",
      "audio.realtime.talk",
      "media.understand_image",
      "media.understand_video",
      "media.workflow",
    ]);
  });

  it("adds Browser.next hardening metadata to browser and notebook provider presets", () => {
    const browserManifest = createExternalToolProviderManifest({
      id: "desktop-browser",
      label: "Desktop Browser",
      description: "Built-in browser automation provider.",
      source: "built-in",
      providerId: "browser",
      capabilityPreset: "browser",
    });
    const notebookManifest = createExternalToolProviderManifest({
      id: "notebooklm",
      label: "NotebookLM",
      description: "External notebook research workspace controlled through browser/MCP/API.",
      source: "external",
      providerId: "notebooklm",
      capabilityPreset: "notebook",
    });

    expect(browserManifest.metadata).toMatchObject({
      capabilityPreset: "browser",
      automationHardening: {
        credentialProfileAccess: "operator-scope-required",
        unmanagedPlaywrightChromiumProcess: false,
        providerRunnerStatus: "sandbox-owned",
        operatorScopeRequired: true,
        processLedgerRequiredForExternalRunner: true,
      },
    });
    expect(notebookManifest.metadata).toMatchObject({
      capabilityPreset: "notebook",
      automationHardening: {
        credentialProfileAccess: "operator-scope-required",
        unmanagedPlaywrightChromiumProcess: false,
        providerRunnerStatus: "not-configured",
        operatorScopeRequired: true,
        processLedgerRequiredForExternalRunner: true,
      },
    });
  });

  it("groups built-in web and browser tools as provider manifests without losing model tools", () => {
    const webProvider = createExternalToolProviderManifestFromModelTools({
      id: "web",
      label: "Web",
      description: "Built-in web search and extraction provider.",
      providerId: "web",
      tools: createBuiltinWebTools(),
      sourceTrust: {
        status: "built-in",
        label: "内置",
      },
      installPolicy: {
        supported: false,
        defaultMode: "none",
      },
      approvalBoundary: {
        mode: "runtime-policy",
        actionLabels: ["确认", "拒绝"],
      },
    });
    const browserProvider = createExternalToolProviderManifestFromModelTools({
      id: "browser",
      label: "Browser",
      description: "Built-in browser automation provider.",
      providerId: "browser",
      tools: createBuiltinBrowserTools(),
      sourceTrust: {
        status: "built-in",
        label: "内置",
      },
      installPolicy: {
        supported: false,
        defaultMode: "none",
      },
      approvalBoundary: {
        mode: "runtime-policy",
        actionLabels: ["确认", "拒绝"],
        requiresOperator: true,
      },
    });
    const catalog = createExternalToolCatalog([
      webProvider,
      browserProvider,
      ...createBuiltinWebTools().map(createExternalToolManifestFromModelTool),
      ...createBuiltinBrowserTools().map(createExternalToolManifestFromModelTool),
    ]);

    expect(catalog.find((entry) => entry.id === "web")).toMatchObject({
      source: "built-in",
      kind: "provider",
      providerId: "web",
      capabilities: [
        expect.objectContaining({ id: "web.search", readOnly: true }),
        expect.objectContaining({ id: "web.extract", readOnly: true }),
        expect.objectContaining({ id: "web.extract.artifact.read", readOnly: true }),
      ],
      metadata: expect.objectContaining({
        modelToolNames: ["web_search", "web_extract", "web_extract_artifact_read"],
        groupedProvider: true,
      }),
    });
    expect(catalog.find((entry) => entry.id === "browser")).toMatchObject({
      source: "built-in",
      kind: "provider",
      providerId: "browser",
      capabilities: expect.arrayContaining([
        expect.objectContaining({ id: "browser.navigate", readOnly: false }),
        expect.objectContaining({ id: "browser.snapshot", readOnly: true }),
      ]),
      metadata: expect.objectContaining({
        groupedProvider: true,
      }),
    });
    expect(catalog.find((entry) => entry.id === "web_search")).toMatchObject({
      kind: "model-tool",
      providerId: "web",
    });
    expect(catalog.find((entry) => entry.id === "browser_navigate")).toMatchObject({
      kind: "model-tool",
      providerId: "browser",
    });
  });

  it("projects Agent OS extension manifests into the external tools control plane", async () => {
    const extensionMatrix = createAgentOsExtensionMatrix(createBuiltInAgentOsExtensionManifests());
    const registry = new ExternalToolRegistry({ nowMs: () => 1_776_000_000_000 });
    for (const manifest of createExternalToolManifestsFromAgentOsExtensionMatrix(extensionMatrix)) {
      registry.register({ manifest });
    }
    const controlPlane = createExternalToolControlPlane(registry);

    await expect(createExternalToolsCatalogRpcResult(controlPlane)).resolves.toMatchObject({
      catalogCount: 8,
      agentOsExtensionMatrix: {
        summary: {
          total: 8,
          ready: 3,
          needsAuth: 2,
          needsSetup: 1,
          disabled: 1,
          problem: 1,
        },
        entries: expect.arrayContaining([
          expect.objectContaining({
            id: "comfyui.local",
            providerId: "comfyui",
            capabilityIds: expect.arrayContaining(["media.generate_image"]),
            health: expect.objectContaining({ status: "needs-setup" }),
            sandbox: expect.objectContaining({
              defaultMode: "host",
              requiresCommandPattern: true,
            }),
          }),
          expect.objectContaining({
            id: "x-twitter",
            providerId: "x-twitter",
            health: expect.objectContaining({ status: "needs-auth" }),
          }),
          expect.objectContaining({
            id: "memefast.api",
            providerId: "memefast-api",
            capabilityIds: expect.arrayContaining([
              "model.chat",
              "media.generate_image",
              "media.generate_video",
            ]),
            health: expect.objectContaining({ status: "needs-auth" }),
          }),
          expect.objectContaining({
            id: "voice.live-audio",
            providerId: "voice-live-audio",
            capabilityIds: expect.arrayContaining([
              "audio.capture",
              "audio.transcribe",
              "audio.synthesize",
              "audio.realtime.talk",
            ]),
            health: expect.objectContaining({ status: "disabled" }),
            metadata: expect.objectContaining({
              failClosed: true,
              microphoneAccessed: false,
              providerCredentialsUsed: false,
              liveRunnerStarted: false,
            }),
          }),
        ]),
        byCapability: expect.objectContaining({
          "media.generate_image": [
            expect.objectContaining({
              id: "comfyui.local",
            }),
            expect.objectContaining({
              id: "memefast.api",
            }),
          ],
          "model.chat": [
            expect.objectContaining({
              id: "memefast.api",
            }),
          ],
          "audio.transcribe": [
            expect.objectContaining({
              id: "voice.live-audio",
            }),
          ],
          "media.understand_image": [
            expect.objectContaining({
              id: "media-understanding.local",
              toolId: "media-understanding.local",
            }),
          ],
        }),
      },
      catalog: expect.arrayContaining([
        expect.objectContaining({
          id: "comfyui.local",
          providerId: "comfyui",
          metadata: expect.objectContaining({
            agentOsExtensionId: "comfyui.local",
            agentOsHealthStatus: "needs-setup",
          }),
          installPolicy: expect.objectContaining({
            supported: true,
            defaultMode: "plan",
            requiresExplicitExecute: true,
          }),
        }),
        expect.objectContaining({
          id: "media-understanding.local",
          providerId: "media-understanding",
          capabilities: expect.arrayContaining([
            expect.objectContaining({ id: "media.understand_image", readOnly: true }),
          ]),
          metadata: expect.objectContaining({
            agentOsExtensionId: "media-understanding.local",
            agentOsHealthStatus: "ready",
          }),
          approvalBoundary: expect.objectContaining({
            mode: "runtime-policy",
            riskLevel: "low",
            requiresOperator: false,
          }),
        }),
      ]),
    });

    await expect(
      createExternalToolsEffectiveRpcResult(controlPlane, { includeUnavailable: true }),
    ).resolves.toMatchObject({
      effectiveCount: 3,
      unavailableCount: 5,
      agentOsExtensionMatrix: expect.objectContaining({
        summary: expect.objectContaining({
          total: 8,
          ready: 3,
          needsAuth: 2,
          needsSetup: 1,
          disabled: 1,
          problem: 1,
        }),
      }),
      tools: expect.arrayContaining([
        expect.objectContaining({
          id: "web.builtin",
          status: "ready",
          canInvoke: true,
          doctor: expect.objectContaining({
            metadata: expect.objectContaining({
              agentOsExtensionId: "web.builtin",
            }),
          }),
        }),
        expect.objectContaining({
          id: "media-understanding.local",
          status: "ready",
          canInvoke: true,
          doctor: expect.objectContaining({
            metadata: expect.objectContaining({
              agentOsExtensionId: "media-understanding.local",
            }),
          }),
        }),
        expect.objectContaining({
          id: "comfyui.local",
          status: "missing",
          canInvoke: false,
          doctor: expect.objectContaining({
            metadata: expect.objectContaining({
              agentOsExtensionHealthStatus: "needs-setup",
            }),
          }),
        }),
        expect.objectContaining({
          id: "mcp.local",
          status: "failed",
          canInvoke: false,
        }),
      ]),
    });
  });

  it("invokes the built-in media-understanding runner through readonly Agent OS sandbox evidence", async () => {
    const registry = new ExternalToolRegistry({ nowMs: () => 1_776_000_000_000 });
    registry.register(createBuiltInMediaUnderstandingExternalToolRegistration());
    const queue = new ExternalToolExecutionQueue({
      registry,
      nowMs: () => 1_776_000_000_000,
    });

    const execution = await queue.enqueue({
      toolId: "media-understanding.local",
      operationId: "media.understand_image",
      turnId: "turn-media",
      sessionKey: "desktop-main",
      args: {
        artifact: {
          id: "sample-png",
          kind: "image",
          mimeType: "image/png",
          dataUrl:
            "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
          path: "/workspace/assets/sample.png",
        },
      },
      cwd: "/workspace/assets",
      sandboxRuntimePolicy: {
        enabledBackends: ["readonly"],
        readableRoots: ["/workspace/assets"],
        networkPolicy: "none",
      },
      requestedNetworkPolicy: "none",
    });

    expect(execution).toMatchObject({
      status: "completed",
      result: {
        ok: true,
        status: "success",
        toolId: "media-understanding.local",
        operationId: "media.understand_image",
        output: {
          status: "success",
          media: expect.objectContaining({
            id: "sample-png",
            kind: "image",
            mimeType: "image/png",
            byteLength: expect.any(Number),
            dimensions: { width: 1, height: 1 },
          }),
          observations: expect.arrayContaining([
            expect.objectContaining({
              id: "media.format",
              summary: "PNG image artifact",
              confidence: 1,
            }),
            expect.objectContaining({
              id: "media.dimensions",
              summary: "1 x 1 pixels",
              confidence: 1,
            }),
          ]),
          sandbox: expect.objectContaining({
            backend: "readonly",
            networkPolicy: "none",
          }),
        },
        metadata: expect.objectContaining({
          mediaUnderstandingRunner: expect.objectContaining({
            providerId: "media-understanding",
            mode: "local-metadata",
          }),
          agentOsSandboxBackendAdmission: expect.objectContaining({
            ok: true,
            backend: "readonly",
            enforcement: expect.objectContaining({
              process: "in-process-adapter",
            }),
          }),
        }),
        trace: expect.arrayContaining([
          expect.objectContaining({ stage: "sandbox.preflight" }),
          expect.objectContaining({ stage: "sandbox.execution_plan" }),
          expect.objectContaining({ stage: "sandbox.backend_admission" }),
          expect.objectContaining({ stage: "tool.completed" }),
        ]),
      },
    });
  });

  it("extracts local video container metadata through the media-understanding runner", async () => {
    const registry = new ExternalToolRegistry({ nowMs: () => 1_776_000_000_000 });
    registry.register(createBuiltInMediaUnderstandingExternalToolRegistration());

    const execution = await invokeExternalTool(registry, {
      toolId: "media-understanding.local",
      operationId: "media.understand_video",
      args: {
        artifact: {
          id: "sample-mp4",
          base64: createMinimalMp4Base64(),
          path: "/workspace/assets/sample.mp4",
        },
      },
      cwd: "/workspace/assets",
      sandboxRuntimePolicy: {
        enabledBackends: ["readonly"],
        readableRoots: ["/workspace/assets"],
        networkPolicy: "none",
      },
      requestedNetworkPolicy: "none",
    });

    expect(execution).toMatchObject({
      ok: true,
      status: "success",
      operationId: "media.understand_video",
      output: {
        status: "success",
        media: expect.objectContaining({
          id: "sample-mp4",
          kind: "video",
          mimeType: "video/mp4",
          durationMs: 2000,
          metadata: expect.objectContaining({
            container: "mp4",
            majorBrand: "isom",
            timescale: 1000,
          }),
        }),
        observations: expect.arrayContaining([
          expect.objectContaining({
            id: "media.container",
            summary: "MP4 container",
            confidence: 1,
          }),
          expect.objectContaining({
            id: "media.duration",
            summary: "2000 ms",
            confidence: 0.95,
          }),
        ]),
      },
      metadata: expect.objectContaining({
        mediaUnderstandingRunner: expect.objectContaining({
          mode: "local-container-metadata",
          container: "mp4",
          pathContentRead: false,
        }),
      }),
    });
  });

  it("infers local WebM video metadata without reading path content through the media-understanding runner", async () => {
    const registry = new ExternalToolRegistry({ nowMs: () => 1_776_000_000_000 });
    registry.register(createBuiltInMediaUnderstandingExternalToolRegistration());

    const execution = await invokeExternalTool(registry, {
      toolId: "media-understanding.local",
      operationId: "media.understand_video",
      args: {
        artifact: {
          id: "sample-webm",
          path: "/workspace/assets/sample.webm",
        },
      },
      cwd: "/workspace/assets",
      sandboxRuntimePolicy: {
        enabledBackends: ["readonly"],
        readableRoots: ["/workspace/assets"],
        networkPolicy: "none",
      },
      requestedNetworkPolicy: "none",
    });

    expect(execution).toMatchObject({
      ok: true,
      status: "success",
      operationId: "media.understand_video",
      output: {
        status: "success",
        media: expect.objectContaining({
          id: "sample-webm",
          kind: "video",
          mimeType: "video/webm",
        }),
        observations: expect.arrayContaining([
          expect.objectContaining({
            id: "media.format",
            summary: "WebM video artifact",
            confidence: 1,
          }),
          expect.objectContaining({
            id: "runner.boundary",
            metadata: { pathContentRead: false },
          }),
        ]),
        sandbox: expect.objectContaining({
          mode: "metadata-only",
          networkPolicy: "none",
          pathContentRead: false,
        }),
      },
      metadata: expect.objectContaining({
        mediaUnderstandingRunner: expect.objectContaining({
          mode: "local-metadata",
          inlineBytesInspected: 0,
          pathContentRead: false,
        }),
      }),
    });
  });

  it("extracts local audio container metadata through the media-understanding runner", async () => {
    const registry = new ExternalToolRegistry({ nowMs: () => 1_776_000_000_000 });
    registry.register(createBuiltInMediaUnderstandingExternalToolRegistration());

    const execution = await invokeExternalTool(registry, {
      toolId: "media-understanding.local",
      operationId: "media.understand_audio",
      args: {
        artifact: {
          id: "sample-wav",
          dataUrl: `data:audio/wav;base64,${createMinimalWavBase64()}`,
          path: "/workspace/assets/sample.wav",
        },
      },
      cwd: "/workspace/assets",
      sandboxRuntimePolicy: {
        enabledBackends: ["readonly"],
        readableRoots: ["/workspace/assets"],
        networkPolicy: "none",
      },
      requestedNetworkPolicy: "none",
    });

    expect(execution).toMatchObject({
      ok: true,
      status: "success",
      operationId: "media.understand_audio",
      output: {
        status: "success",
        media: expect.objectContaining({
          id: "sample-wav",
          kind: "audio",
          mimeType: "audio/wav",
          durationMs: 1000,
          sampleRateHz: 8000,
          channels: 1,
          metadata: expect.objectContaining({
            bitsPerSample: 16,
            container: "wav",
          }),
        }),
        observations: expect.arrayContaining([
          expect.objectContaining({
            id: "media.container",
            summary: "WAV container",
            confidence: 1,
          }),
          expect.objectContaining({
            id: "media.audio",
            summary: "1 channel(s) at 8000 Hz",
            confidence: 1,
          }),
        ]),
      },
      metadata: expect.objectContaining({
        mediaUnderstandingRunner: expect.objectContaining({
          mode: "local-container-metadata",
          container: "wav",
          pathContentRead: false,
        }),
      }),
    });
  });

  it("extracts local FLAC audio metadata through the media-understanding runner", async () => {
    const registry = new ExternalToolRegistry({ nowMs: () => 1_776_000_000_000 });
    registry.register(createBuiltInMediaUnderstandingExternalToolRegistration());

    const execution = await invokeExternalTool(registry, {
      toolId: "media-understanding.local",
      operationId: "media.understand_audio",
      args: {
        artifact: {
          id: "sample-flac",
          base64: createMinimalFlacBase64(),
          path: "/workspace/assets/sample.flac",
        },
      },
      cwd: "/workspace/assets",
      sandboxRuntimePolicy: {
        enabledBackends: ["readonly"],
        readableRoots: ["/workspace/assets"],
        networkPolicy: "none",
      },
      requestedNetworkPolicy: "none",
    });

    expect(execution).toMatchObject({
      ok: true,
      status: "success",
      operationId: "media.understand_audio",
      output: {
        status: "success",
        media: expect.objectContaining({
          id: "sample-flac",
          kind: "audio",
          mimeType: "audio/flac",
          durationMs: 2000,
          sampleRateHz: 44100,
          channels: 2,
          metadata: expect.objectContaining({
            bitsPerSample: 16,
            container: "flac",
            totalSamples: 88200,
          }),
        }),
        observations: expect.arrayContaining([
          expect.objectContaining({
            id: "media.container",
            summary: "FLAC container",
            confidence: 1,
          }),
          expect.objectContaining({
            id: "media.audio",
            summary: "2 channel(s) at 44100 Hz",
            confidence: 1,
          }),
        ]),
      },
      metadata: expect.objectContaining({
        mediaUnderstandingRunner: expect.objectContaining({
          mode: "local-container-metadata",
          container: "flac",
          pathContentRead: false,
        }),
      }),
    });
  });

  it("blocks media-understanding runner access outside the declared readonly scope before invoke", async () => {
    const registry = new ExternalToolRegistry({ nowMs: () => 1_776_000_000_000 });
    registry.register(createBuiltInMediaUnderstandingExternalToolRegistration());

    await expect(
      invokeExternalTool(registry, {
        toolId: "media-understanding.local",
        operationId: "media.understand_image",
        args: {
          artifact: {
            id: "secret-image",
            kind: "image",
            mimeType: "image/png",
            path: "/private/secret.png",
          },
        },
        cwd: "/private",
        sandboxRuntimePolicy: {
          enabledBackends: ["readonly"],
          readableRoots: ["/workspace/assets"],
          networkPolicy: "none",
        },
        requestedNetworkPolicy: "none",
      }),
    ).resolves.toMatchObject({
      ok: false,
      status: "permission-denied",
      error: "external-tool-sandbox-plan-denied",
      trace: expect.arrayContaining([
        expect.objectContaining({ stage: "sandbox.preflight" }),
        expect.objectContaining({
          stage: "sandbox.execution_plan",
          metadata: expect.objectContaining({
            status: "blocked",
            error: "sandbox-cwd-outside-scope",
          }),
        }),
      ]),
      metadata: expect.objectContaining({
        agentOsSandboxExecutionPlan: expect.objectContaining({
          ok: false,
          error: "sandbox-cwd-outside-scope",
        }),
      }),
    });
  });

  it("executes the built-in real non-voice media-analysis provider runner through sandbox command execution", async () => {
    const runnerCalls: unknown[] = [];
    const registry = new ExternalToolRegistry({
      nowMs: () => 1_776_000_000_000,
      sandboxBackends: {
        enabledBackends: ["host"],
        adapters: [
          createAgentOsHostSandboxBackendAdapter({
            allowHostExecution: true,
            allowedCommandPatterns: [
              {
                executable: "media-analysis-runner",
                argv: ["inspect", "--fixture", "dry-run"],
                operationId: "media.analysis.local_dry_run",
              },
            ],
            networkPolicy: "none",
            commandRunner: (request) => {
              runnerCalls.push(request);
              return {
                exitCode: 0,
                stdout: JSON.stringify({
                  status: "success",
                  providerCredentialsUsed: false,
                  networkUsed: false,
                  liveRunnerStarted: false,
                  mode: "local-command-dry-run",
                }),
                metadata: {
                  providerCredentialsUsed: false,
                  networkUsed: false,
                  liveRunnerStarted: false,
                  process: {
                    pid: 4242,
                    ownedProcess: true,
                  },
                },
                artifacts: [
                  {
                    id: "media-analysis-dry-run-report",
                    kind: "provider-runner-report",
                    path: "/workspace/project/.hotflow/media-analysis/report.json",
                    metadata: {
                      providerId: "media-analysis",
                      runnerMode: "local-command-dry-run",
                    },
                  },
                ],
              };
            },
          }),
        ],
      },
    });
    registry.register(createBuiltInMediaAnalysisProviderExternalToolRegistration());
    const queue = new ExternalToolExecutionQueue({
      registry,
      nowMs: () => 1_776_000_000_000,
    });

    const execution = await queue.enqueue({
      toolId: "media-analysis.local",
      operationId: "media.analysis.local_dry_run",
      turnId: "turn-media-analysis",
      sessionKey: "desktop-main",
      command: "media-analysis-runner inspect --fixture dry-run",
      cwd: "/workspace/project",
      approval: {
        status: "approved",
        operatorId: "operator-local",
        metadata: { scope: "local-provider-runner-dry-run" },
      },
      sandboxPolicy: {
        defaultMutatingSandboxMode: "host",
        commandAllowlist: ["media-analysis-runner"],
        filesystemScope: ["/workspace/project"],
        networkAccess: "none",
      },
      requestedNetworkPolicy: "none",
    });

    expect(execution).toMatchObject({
      status: "completed",
      result: {
        ok: true,
        status: "success",
        toolId: "media-analysis.local",
        operationId: "media.analysis.local_dry_run",
        output: {
          exitCode: 0,
          stdout: expect.stringContaining('"mode":"local-command-dry-run"'),
        },
        artifacts: [
          expect.objectContaining({
            id: "media-analysis-dry-run-report",
            kind: "provider-runner-report",
          }),
        ],
        trace: expect.arrayContaining([
          expect.objectContaining({ stage: "permission.approved" }),
          expect.objectContaining({ stage: "sandbox.preflight" }),
          expect.objectContaining({ stage: "sandbox.execution_plan" }),
          expect.objectContaining({ stage: "sandbox.backend_admission" }),
          expect.objectContaining({ stage: "sandbox.command_execution" }),
        ]),
        metadata: expect.objectContaining({
          agentOsSandboxBackendAdmission: expect.objectContaining({
            ok: true,
            status: "admitted",
            backend: "host",
            networkPolicy: "none",
            enforcement: expect.objectContaining({
              process: "host-process",
            }),
          }),
          agentOsSandboxCommandExecution: expect.objectContaining({
            ok: true,
            status: "completed",
            backend: "host",
            process: {
              pid: 4242,
              ownedProcess: true,
            },
          }),
        }),
      },
    });

    if (execution.result === undefined) {
      throw new Error("Expected media-analysis queue execution to finish with a result.");
    }
    const metadata = execution.result.metadata as {
      readonly agentOsSandboxExecutionPlan: AgentOsSandboxExecutionPlan;
      readonly agentOsSandboxBackendAdmission: AgentOsSandboxBackendAdmission;
      readonly agentOsSandboxCommandExecution: AgentOsSandboxCommandExecutionResult;
    };
    const processCapabilityLedger = summarizeAgentOsProcessCapabilityLedger({
      generatedAt: "2026-05-09T00:00:00.000Z",
      entries: [
        {
          owner: "media-analysis.local",
          runnerKind: "other",
          plan: metadata.agentOsSandboxExecutionPlan,
          admission: metadata.agentOsSandboxBackendAdmission,
          execution: metadata.agentOsSandboxCommandExecution,
        },
      ],
    });

    expect(processCapabilityLedger).toMatchObject({
      totalEntries: 1,
      riskyHostEntries: 1,
      entries: [
        expect.objectContaining({
          owner: "media-analysis.local",
          runnerKind: "other",
          toolName: "media-analysis.local",
          operationId: "media.analysis.local_dry_run",
          providerId: "media-analysis",
          backend: "host",
          status: "completed",
          networkPolicy: "none",
          command: "media-analysis-runner inspect --fixture dry-run",
          commandPattern: {
            executable: "media-analysis-runner",
            argv: ["inspect", "--fixture", "dry-run"],
            operationId: "media.analysis.local_dry_run",
          },
          process: {
            pid: 4242,
            ownedProcess: true,
          },
        }),
      ],
    });
    expect(runnerCalls).toEqual([
      {
        backend: "host",
        executable: "media-analysis-runner",
        argv: ["inspect", "--fixture", "dry-run"],
        cwd: "/workspace/project",
      },
    ]);
  });

  it("uses check_fn TTL and generation to resolve effective tools without stale probes", async () => {
    let nowMs = 1_000;
    let checkCount = 0;
    let ready = true;
    const registry = new ExternalToolRegistry({
      nowMs: () => nowMs,
      doctorTtlMs: 500,
    });
    registry.register({
      manifest: {
        id: "comfyui",
        label: "ComfyUI",
        description: "External ComfyUI provider.",
        source: "external",
        kind: "provider",
        providerId: "comfyui",
        capabilities: [{ id: "workflow", label: "Workflow", readOnly: false }],
      },
      check: () => {
        checkCount += 1;
        return ready
          ? { status: "ready", summary: "ComfyUI is reachable." }
          : { status: "unreachable", summary: "ComfyUI server is offline." };
      },
    });

    await expect(registry.resolveEffective()).resolves.toMatchObject([
      { id: "comfyui", status: "ready", canInvoke: true },
    ]);
    await registry.resolveEffective();
    expect(checkCount).toBe(1);

    nowMs += 600;
    ready = false;
    await expect(registry.resolveEffective()).resolves.toEqual([]);
    expect(checkCount).toBe(2);

    ready = true;
    registry.refresh("comfyui");
    await expect(registry.resolveEffective()).resolves.toMatchObject([
      { id: "comfyui", status: "ready", canInvoke: true },
    ]);
    expect(checkCount).toBe(3);
  });

  it("keeps doctor cache when the same external tool registration is synced again", async () => {
    let nowMs = 1_000;
    let checkCount = 0;
    const registry = new ExternalToolRegistry({
      nowMs: () => nowMs,
      doctorTtlMs: 10_000,
    });
    const registration = {
      manifest: {
        id: "opencli.local",
        label: "OpenCLI",
        description: "OpenCLI local read-only command registry.",
        source: "external" as const,
        kind: "provider" as const,
        providerId: "opencli",
        capabilities: [{ id: "opencli.list", label: "List commands", readOnly: true }],
      },
      check: () => {
        checkCount += 1;
        return { status: "ready" as const, summary: "OpenCLI ready." };
      },
    };

    registry.register(registration);
    await registry.resolveEffective({ includeUnavailable: true });
    registry.register(registration);
    await registry.resolveEffective({ includeUnavailable: true });

    expect(checkCount).toBe(1);

    nowMs += 10_001;
    await registry.resolveEffective({ includeUnavailable: true });
    expect(checkCount).toBe(2);
  });

  it("keeps doctor cache when a sync recreates handlers for the same manifest", async () => {
    let checkCount = 0;
    const registry = new ExternalToolRegistry({
      nowMs: () => 2_000,
      doctorTtlMs: 10_000,
    });
    const createRegistration = () => ({
      manifest: {
        id: "opencli.local",
        label: "OpenCLI",
        description: "OpenCLI local read-only command registry.",
        source: "external" as const,
        kind: "provider" as const,
        providerId: "opencli",
        capabilities: [{ id: "opencli.list", label: "List commands", readOnly: true }],
      },
      check: () => {
        checkCount += 1;
        return { status: "ready" as const, summary: "OpenCLI ready." };
      },
    });

    registry.register(createRegistration());
    await registry.resolveEffective({ includeUnavailable: true });
    registry.register(createRegistration());
    await registry.resolveEffective({ includeUnavailable: true });

    expect(checkCount).toBe(1);
  });

  it("filters model tool schemas through the same effective doctor contract", async () => {
    const [webSearch] = createBuiltinWebTools();
    const [browserNavigate] = createBuiltinBrowserTools();
    const tools = [webSearch, browserNavigate];

    await expect(
      resolveEffectiveModelTools({
        tools,
        check: new Map([
          ["web_search", () => ({ status: "ready", summary: "Web search ready." })],
          [
            "browser_navigate",
            () => ({ status: "needs-auth", summary: "Browser provider needs login." }),
          ],
        ]),
      }),
    ).resolves.toEqual([expect.objectContaining({ name: "web_search" })]);
  });

  it("does not expose unavailable cross-tool names in projected model tool descriptions", async () => {
    const [webSearch, webExtract] = createBuiltinWebTools();
    const [browserNavigate] = createBuiltinBrowserTools();
    const tools = [webSearch, webExtract, browserNavigate];

    const projected = await resolveEffectiveModelTools({
      tools,
      check: new Map([
        ["web_search", () => ({ status: "ready", summary: "Web search ready." })],
        ["web_extract", () => ({ status: "needs-auth", summary: "Extractor disabled." })],
        ["browser_navigate", () => ({ status: "ready", summary: "Browser ready." })],
      ]),
    });

    const webSearchDescription = projected.find((tool) => tool.name === "web_search")?.description;
    const browserDescription = projected.find(
      (tool) => tool.name === "browser_navigate",
    )?.description;

    expect(projected.map((tool) => tool.name)).toEqual(["web_search", "browser_navigate"]);
    expect(webSearchDescription).not.toContain("web_extract");
    expect(browserDescription).not.toContain("web_extract");
    expect(browserDescription).not.toContain("prefer web_search");
    expect(browserDescription).toContain("Available companion tools in this turn: web_search.");
  });

  it("keeps base built-in tool schema descriptions free of hardcoded cross-tool references", async () => {
    const tools = [
      ...createBuiltinWebTools(),
      ...createBuiltinBrowserTools(),
      ...(await import("../src/index.js")).createBuiltinXTools(),
    ];
    const descriptions = new Map(tools.map((tool) => [tool.name, tool.description]));

    expect(descriptions.get("web_search")).not.toMatch(
      /\b(web_extract|browser_|director\.learning\.admit)\b/u,
    );
    expect(descriptions.get("x_search")).not.toMatch(/\b(web_extract|browser_)/u);
    for (const [name, description] of descriptions.entries()) {
      if (name.startsWith("browser_")) {
        expect(description).not.toMatch(/\b(web_search|web_extract)\b/u);
      }
      if (name !== "browser_navigate") {
        expect(description).not.toContain("Requires browser_navigate");
      }
    }
  });

  it("adds cross-tool guidance only for tools that are effective in the current turn", async () => {
    const [webSearch, webExtract] = createBuiltinWebTools();
    const [browserNavigate] = createBuiltinBrowserTools();
    const [xSearch] = (await import("../src/index.js")).createBuiltinXTools();
    const learningAdmit = {
      name: "director.learning.admit",
      description: "Admit a source as a reviewable learning candidate.",
      readOnly: false,
      metadata: {
        capability: "learning",
        source: "director",
      },
    };
    const tools = [webSearch, webExtract, browserNavigate, xSearch, learningAdmit];

    const projected = await resolveEffectiveModelTools({
      tools,
      check: new Map([
        ["web_search", () => ({ status: "ready", summary: "Web search ready." })],
        ["web_extract", () => ({ status: "ready", summary: "Extractor ready." })],
        ["browser_navigate", () => ({ status: "ready", summary: "Browser ready." })],
        ["x_search", () => ({ status: "ready", summary: "X/Twitter ready." })],
        [
          "director.learning.admit",
          () => ({ status: "ready", summary: "Learning admission ready." }),
        ],
      ]),
    });

    const byName = new Map(projected.map((tool) => [tool.name, tool.description]));

    expect(byName.get("x_search")).toContain(
      "Available companion tools in this turn: web_extract, browser_navigate.",
    );
    expect(byName.get("web_search")).toContain(
      "Available companion tools in this turn: web_extract, director.learning.admit",
    );
    expect(byName.get("browser_navigate")).toContain(
      "Available companion tools in this turn: web_search, web_extract",
    );
  });

  it("keeps the built dist resolver in sync for provider-ready metadata consumers", async () => {
    const distEntry = join(process.cwd(), "dist", "index.js");
    if (!existsSync(distEntry)) {
      return;
    }
    const distRuntime = (await import("../dist/index.js")) as typeof import("../src/index.js");
    const [xSearch] = distRuntime.createBuiltinXTools();

    const [effective] = await distRuntime.resolveEffectiveModelTools({
      tools: [xSearch],
      check: new Map([
        [
          "x_search",
          () => ({
            status: "ready",
            summary: "X/Twitter provider is ready.",
            nextActions: ["provider can be used by matching runtime tools"],
          }),
        ],
      ]),
    });

    expect(effective).toMatchObject({
      name: "x_search",
      metadata: expect.objectContaining({
        externalToolStatus: "ready",
        externalToolCanInvoke: true,
        externalProviderStatus: "ready",
        externalToolNextActions: ["provider can be used by matching runtime tools"],
      }),
    });
    expect(effective.description).not.toMatch(/\b(web_extract|browser_)/u);
  }, 15_000);

  it("exposes catalog, effective, and invoke through an OpenClaw-style control plane", async () => {
    const registry = new ExternalToolRegistry({ nowMs: () => 1_776_000_000_000 });
    registry.register({
      manifest: {
        id: "web_search",
        label: "web_search",
        description: "Search the web.",
        source: "built-in",
        kind: "model-tool",
        providerId: "web",
        capabilities: [{ id: "web.search", label: "Search", readOnly: true }],
      },
      check: () => ({ status: "ready", summary: "Web search is ready." }),
      invoke: (request) => ({
        ok: true,
        content: `searched ${String(request.args?.query ?? "")}`,
        output: { results: [{ title: "Seedance tutorial" }] },
      }),
    });
    registry.register({
      manifest: {
        id: "x_search",
        label: "x_search",
        description: "Search X/Twitter.",
        source: "external",
        kind: "model-tool",
        providerId: "x",
        capabilities: [{ id: "x.search", label: "Search", readOnly: true }],
      },
      check: () => ({ status: "needs-auth", summary: "X provider needs an API key." }),
    });
    const controlPlane = createExternalToolControlPlane(registry);

    await expect(
      createExternalToolsCatalogRpcResult(controlPlane, { agentId: "director" }),
    ).resolves.toMatchObject({
      schemaVersion: "director.external-tools.catalog.v1",
      agentId: "director",
      catalogCount: 2,
      groups: expect.arrayContaining([
        expect.objectContaining({
          id: "web",
          tools: [expect.objectContaining({ id: "web_search" })],
        }),
      ]),
    });
    await expect(
      createExternalToolsEffectiveRpcResult(controlPlane, {
        sessionKey: "desktop-main",
        includeUnavailable: true,
      }),
    ).resolves.toMatchObject({
      schemaVersion: "director.external-tools.effective.v1",
      sessionKey: "desktop-main",
      effectiveCount: 1,
      unavailableCount: 1,
      tools: expect.arrayContaining([
        expect.objectContaining({ id: "web_search", canInvoke: true }),
        expect.objectContaining({ id: "x_search", status: "needs-auth", canInvoke: false }),
      ]),
    });
    await expect(
      invokeExternalToolControlPlane(controlPlane, {
        toolId: "web_search",
        operationId: "web.search",
        args: { query: "seedance" },
      }),
    ).resolves.toMatchObject({
      schemaVersion: "director.external-tools.invoke.v1",
      ok: true,
      toolName: "web_search",
      status: "success",
      output: { results: [{ title: "Seedance tutorial" }] },
    });
  });

  it("projects provider-level budget and health summary in the effective matrix", async () => {
    const registry = new ExternalToolRegistry({ nowMs: () => 1_776_000_000_000 });
    registry.register({
      manifest: {
        id: "gpt_image_generate",
        label: "GPT Image",
        description: "Generate images through a model provider.",
        source: "external",
        kind: "model-tool",
        providerId: "openai-image",
        capabilities: [
          {
            id: "model.image.generate",
            label: "Image generation",
            readOnly: false,
            requiresApproval: true,
          },
        ],
        metadata: {
          budget: {
            tokenLimit: 24_000,
            fileCountLimit: 4,
            estimatedCostTier: "medium",
            estimatedCostUsd: 0.42,
          },
        },
      },
      check: () => ({
        status: "ready",
        summary: "OpenAI image provider ready.",
        details: { region: "us" },
      }),
    });
    registry.register({
      manifest: {
        id: "gpt_video_generate",
        label: "GPT Video",
        description: "Generate videos through a model provider.",
        source: "external",
        kind: "model-tool",
        providerId: "openai-image",
        capabilities: [
          {
            id: "model.video.generate",
            label: "Video generation",
            readOnly: false,
            requiresApproval: true,
          },
        ],
        metadata: {
          budget: {
            tokenLimit: 48_000,
            videoMinuteLimit: 2,
            estimatedCostTier: "high",
            estimatedCostUsd: 1.8,
          },
        },
      },
      check: () => ({ status: "unreachable", summary: "Video provider route offline." }),
    });
    const controlPlane = createExternalToolControlPlane(registry);

    await expect(
      createExternalToolsEffectiveRpcResult(controlPlane, { includeUnavailable: true }),
    ).resolves.toMatchObject({
      providerMatrix: {
        providers: [
          expect.objectContaining({
            providerId: "openai-image",
            status: "unreachable",
            healthSummary: {
              readyToolCount: 1,
              unavailableToolCount: 1,
              statusCounts: {
                ready: 1,
                unreachable: 1,
              },
            },
            budget: {
              tokenLimit: 24_000,
              fileCountLimit: 4,
              videoMinuteLimit: 2,
              estimatedCostTier: "high",
              estimatedCostUsd: 1.8,
            },
            budgetSources: [
              expect.objectContaining({
                toolId: "gpt_image_generate",
                budget: expect.objectContaining({ estimatedCostTier: "medium" }),
              }),
              expect.objectContaining({
                toolId: "gpt_video_generate",
                budget: expect.objectContaining({ estimatedCostTier: "high" }),
              }),
            ],
          }),
        ],
      },
    });
  });

  it("registers OpenCLI as a missing local provider without auto-installing it", async () => {
    const registry = new ExternalToolRegistry({ nowMs: () => 1_776_000_000_000 });
    registry.register(
      createOpenCliExternalToolRegistration({
        manifestEntries: [
          {
            site: "hackernews",
            name: "top",
            description: "Read Hacker News top stories.",
            access: "read",
            args: [{ name: "limit", type: "int", required: false }],
          },
        ],
        runner: async () => ({
          exitCode: 127,
          stdout: "",
          stderr: "spawn opencli ENOENT",
          errorCode: "ENOENT",
        }),
      }),
    );

    await expect(registry.diagnose("opencli.local")).resolves.toMatchObject({
      status: "missing",
      summary: expect.stringContaining("OpenCLI 未安装"),
      nextActions: expect.arrayContaining(["npm install -g @jackwener/opencli"]),
    });
    await expect(registry.resolveEffective({ includeUnavailable: true })).resolves.toEqual([
      expect.objectContaining({
        id: "opencli.local",
        status: "missing",
        canInvoke: false,
      }),
    ]);
  });

  it("defaults OpenCLI browser commands to a background window unless explicitly overridden", () => {
    expect(createOpenCliRunnerEnvironment({ PATH: "/usr/bin" })).toMatchObject({
      PATH: "/usr/bin",
      OPENCLI_WINDOW: "background",
    });
    expect(createOpenCliRunnerEnvironment({ OPENCLI_WINDOW: "foreground" })).toMatchObject({
      OPENCLI_WINDOW: "foreground",
    });
    expect(createOpenCliRunnerEnvironment({ OPENCLI_WINDOW: "floating" })).toMatchObject({
      OPENCLI_WINDOW: "background",
    });
  });

  it("projects OpenCLI manifest entries into bounded provider capabilities", () => {
    const registration = createOpenCliExternalToolRegistration({
      manifestEntries: [
        {
          site: "hackernews",
          name: "top",
          description: "Read Hacker News top stories.",
          access: "read",
          domain: "news.ycombinator.com",
          args: [{ name: "limit", type: "int", required: false }],
          columns: ["title", "url"],
        },
        {
          site: "github",
          name: "issue-create",
          description: "Create an issue.",
          access: "write",
          domain: "github.com",
          args: [{ name: "title", type: "str", required: true }],
        },
      ],
      maxCommandCapabilities: 10,
    });

    expect(registration.manifest).toMatchObject({
      id: "opencli.local",
      providerId: "opencli",
      source: "external",
      kind: "provider",
      capabilities: expect.arrayContaining([
        expect.objectContaining({
          id: "opencli.doctor",
          readOnly: true,
        }),
        expect.objectContaining({
          id: "opencli.profile-status",
          readOnly: true,
        }),
        expect.objectContaining({
          id: "opencli.list",
          readOnly: true,
        }),
        expect.objectContaining({
          id: "opencli.hackernews.top",
          readOnly: true,
          requiresApproval: false,
          metadata: expect.objectContaining({
            site: "hackernews",
            name: "top",
            access: "read",
            columns: ["title", "url"],
          }),
        }),
        expect.objectContaining({
          id: "opencli.github.issue-create",
          readOnly: false,
          requiresApproval: true,
        }),
      ]),
      metadata: expect.objectContaining({
        openCliCommandCount: 2,
        openCliExposedCommandCount: 2,
      }),
    });
  });

  it("invokes OpenCLI read commands with schema-validated argv and parsed JSON output", async () => {
    const calls: Array<{ binary: string; args: readonly string[]; timeoutMs?: number }> = [];
    const registry = new ExternalToolRegistry({ nowMs: () => 1_776_000_000_000 });
    registry.register(
      createOpenCliExternalToolRegistration({
        openCliBinary: "opencli",
        manifestEntries: [
          {
            site: "hackernews",
            name: "top",
            description: "Read Hacker News top stories.",
            access: "read",
            args: [{ name: "limit", type: "int", required: false }],
            columns: ["title"],
          },
        ],
        runner: async (input) => {
          calls.push({ binary: input.binary, args: input.args, timeoutMs: input.timeoutMs });
          if (input.args[0] === "--version") {
            return { exitCode: 0, stdout: "1.2.3\n", stderr: "" };
          }
          if (input.args[0] === "doctor") {
            return { exitCode: 0, stdout: JSON.stringify({ status: "ready" }), stderr: "" };
          }
          return {
            exitCode: 0,
            stdout: JSON.stringify([{ title: "A useful story" }]),
            stderr: "",
          };
        },
      }),
    );

    await expect(
      invokeExternalTool(registry, {
        toolId: "opencli.local",
        operationId: "opencli.hackernews.top",
        args: { limit: 5 },
      }),
    ).resolves.toMatchObject({
      ok: true,
      status: "success",
      content: expect.stringContaining("OpenCLI 执行完成"),
      output: {
        json: [{ title: "A useful story" }],
      },
      metadata: expect.objectContaining({
        argv: ["hackernews", "top", "--limit", "5", "--format", "json"],
        sourceKind: "opencli",
        sourceRef: "opencli:hackernews/top",
        sourceAccessStatus: "available",
      }),
    });

    expect(calls.at(-1)).toEqual({
      binary: "opencli",
      args: ["hackernews", "top", "--limit", "5", "--format", "json"],
      timeoutMs: 60_000,
    });
  });

  it("reports OpenCLI Browser Bridge profile status without assuming a hardcoded profile", async () => {
    const calls: Array<readonly string[]> = [];
    const registry = new ExternalToolRegistry({ nowMs: () => 1_776_000_000_000 });
    registry.register(
      createOpenCliExternalToolRegistration({
        openCliBinary: "opencli",
        manifestEntries: [
          {
            site: "hackernews",
            name: "top",
            description: "Read Hacker News top stories.",
            access: "read",
          },
        ],
        runner: async (input) => {
          calls.push(input.args);
          if (input.args[0] === "--version") {
            return { exitCode: 0, stdout: "1.7.21\n", stderr: "" };
          }
          if (input.args[0] === "doctor") {
            return { exitCode: 0, stdout: JSON.stringify({ status: "ready" }), stderr: "" };
          }
          if (input.args[0] === "profile" && input.args[1] === "list") {
            return {
              exitCode: 0,
              stdout: [
                "Connected Browser Bridge profiles",
                "",
                "  enetsk95 — connected v1.0.15",
                "  research-work — disconnected v1.0.14",
              ].join("\n"),
              stderr: "",
            };
          }
          return { exitCode: 1, stdout: "", stderr: "unexpected command" };
        },
      }),
    );

    await expect(
      invokeExternalTool(registry, {
        toolId: "opencli.local",
        operationId: "opencli.profile-status",
        args: {},
      }),
    ).resolves.toMatchObject({
      ok: true,
      status: "success",
      content: expect.stringContaining("OpenCLI Browser Bridge 已连接 1/2 个 profile"),
      output: expect.objectContaining({
        browserBridgeConnected: true,
        profileCount: 2,
        connectedProfileCount: 1,
        profiles: [
          expect.objectContaining({
            id: "enetsk95",
            connected: true,
            version: "1.0.15",
          }),
          expect.objectContaining({
            id: "research-work",
            connected: false,
            version: "1.0.14",
          }),
        ],
      }),
      metadata: expect.objectContaining({
        sourceKind: "opencli",
        sourceRef: "opencli:profile/list",
        sourceAccessStatus: "available",
        profileCount: 2,
        connectedProfileCount: 1,
      }),
    });

    expect(calls).toEqual([["--version"], ["doctor", "--format", "json"], ["profile", "list"]]);
  });

  it("uses a longer timeout for long-running OpenCLI download commands while keeping doctor probes short", async () => {
    const calls: Array<{ args: readonly string[]; timeoutMs?: number }> = [];
    const registry = new ExternalToolRegistry({ nowMs: () => 1_776_000_000_000 });
    registry.register(
      createOpenCliExternalToolRegistration({
        timeoutMs: 11_000,
        commandTimeoutMs: 222_000,
        manifestEntries: [
          {
            site: "bilibili",
            name: "download",
            description: "下载B站视频（需要 yt-dlp）",
            access: "read",
            args: [
              { name: "bvid", type: "str", required: true, positional: true },
              { name: "output", type: "str", required: false },
            ],
          },
        ],
        runner: async (input) => {
          calls.push({ args: input.args, timeoutMs: input.timeoutMs });
          if (input.args[0] === "--version") {
            return { exitCode: 0, stdout: "1.7.21\n", stderr: "" };
          }
          if (input.args[0] === "doctor") {
            return { exitCode: 0, stdout: JSON.stringify({ status: "ready" }), stderr: "" };
          }
          return {
            exitCode: 0,
            stdout: JSON.stringify({ files: ["video.mp4"] }),
            stderr: "",
            durationMs: 61_000,
          };
        },
      }),
    );

    await expect(
      invokeExternalTool(registry, {
        toolId: "opencli.local",
        operationId: "opencli.bilibili.download",
        args: { bvid: "BV1xx411c7mD", output: "/tmp/opencli-download" },
      }),
    ).resolves.toMatchObject({
      ok: true,
      output: {
        timeoutMs: 222_000,
      },
      metadata: expect.objectContaining({
        timeoutMs: 222_000,
      }),
    });

    expect(calls).toEqual([
      { args: ["--version"], timeoutMs: 11_000 },
      { args: ["doctor", "--format", "json"], timeoutMs: 11_000 },
      {
        args: [
          "bilibili",
          "download",
          "BV1xx411c7mD",
          "--output",
          "/tmp/opencli-download",
          "--format",
          "json",
        ],
        timeoutMs: 222_000,
      },
    ]);
  });

  it("blocks OpenCLI attempts to launch desktop apps before the runner is called", async () => {
    const calls: Array<readonly string[]> = [];
    const registry = new ExternalToolRegistry({ nowMs: () => 1_776_000_000_000 });
    registry.register(
      createOpenCliExternalToolRegistration({
        manifestEntries: [
          {
            site: "desktop",
            name: "inspect",
            description: "Inspect a desktop app path.",
            access: "read",
            args: [{ name: "path", type: "str", required: true }],
          },
        ],
        runner: async (input) => {
          calls.push(input.args);
          if (input.args[0] === "--version") {
            return { exitCode: 0, stdout: "1.7.21\n", stderr: "" };
          }
          if (input.args[0] === "doctor") {
            return { exitCode: 0, stdout: JSON.stringify({ status: "ready" }), stderr: "" };
          }
          return { exitCode: 0, stdout: "{}", stderr: "" };
        },
      }),
    );

    await expect(
      invokeExternalTool(registry, {
        toolId: "opencli.local",
        operationId: "opencli.desktop.inspect",
        args: { path: "/Applications/魔因漫创.app" },
      }),
    ).resolves.toMatchObject({
      ok: false,
      status: "error",
      error: "opencli-desktop-app-launch-blocked",
    });
    expect(calls).toEqual([["--version"], ["doctor", "--format", "json"]]);
  });

  it("blocks OpenCLI attempts to spawn private Chrome bridge windows before the runner is called", async () => {
    const calls: Array<readonly string[]> = [];
    const registry = new ExternalToolRegistry({ nowMs: () => 1_776_000_000_000 });
    registry.register(
      createOpenCliExternalToolRegistration({
        manifestEntries: [
          {
            site: "desktop",
            name: "inspect",
            description: "Inspect a desktop launch command.",
            access: "read",
            args: [{ name: "path", type: "str", required: true }],
          },
        ],
        runner: async (input) => {
          calls.push(input.args);
          if (input.args[0] === "--version") {
            return { exitCode: 0, stdout: "1.7.21\n", stderr: "" };
          }
          if (input.args[0] === "doctor") {
            return { exitCode: 0, stdout: JSON.stringify({ status: "ready" }), stderr: "" };
          }
          return { exitCode: 0, stdout: "{}", stderr: "" };
        },
      }),
    );

    await expect(
      invokeExternalTool(registry, {
        toolId: "opencli.local",
        operationId: "opencli.desktop.inspect",
        args: {
          path: "/Volumes/work/.director-angel/external-tools/opencli/chrome-for-testing/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing --remote-debugging-port=9333 about:blank",
        },
      }),
    ).resolves.toMatchObject({
      ok: false,
      status: "error",
      error: "opencli-desktop-app-launch-blocked",
    });
    expect(calls).toEqual([["--version"], ["doctor", "--format", "json"]]);
  });

  it("classifies a disconnected OpenCLI Browser Bridge as needs-auth instead of ready", async () => {
    const registry = new ExternalToolRegistry({ nowMs: () => 1_776_000_000_000 });
    registry.register(
      createOpenCliExternalToolRegistration({
        manifestEntries: [
          {
            site: "hackernews",
            name: "top",
            description: "Read Hacker News top stories.",
            access: "read",
          },
        ],
        runner: async (input) => {
          if (input.args[0] === "--version") {
            return { exitCode: 0, stdout: "1.7.21\n", stderr: "" };
          }
          return {
            exitCode: 0,
            stdout:
              "opencli v1.7.21 doctor\n\n[OK] Daemon: running\n[MISSING] Extension: not connected\n[FAIL] Connectivity: failed (Browser Bridge extension not connected)\n",
            stderr: "",
          };
        },
      }),
    );

    await expect(registry.diagnose("opencli.local")).resolves.toMatchObject({
      status: "needs-auth",
      summary: expect.stringContaining("Browser Bridge extension not connected"),
      nextActions: expect.arrayContaining([expect.stringContaining("Browser Bridge")]),
    });
  });

  it("fails Browser-backed OpenCLI commands before spawning when the Browser Bridge is disconnected", async () => {
    const calls: Array<readonly string[]> = [];
    const registry = new ExternalToolRegistry({ nowMs: () => 1_776_000_000_000 });
    registry.register(
      createOpenCliExternalToolRegistration({
        manifestEntries: [
          {
            site: "bilibili",
            name: "download",
            description: "下载B站视频（需要 yt-dlp）",
            access: "read",
            browser: true,
            args: [
              { name: "bvid", type: "str", required: true, positional: true },
              { name: "output", type: "str", required: false, default: "./bilibili-downloads" },
            ],
          },
        ],
        runner: async (input) => {
          calls.push(input.args);
          if (input.args[0] === "--version") {
            return { exitCode: 0, stdout: "1.7.21\n", stderr: "" };
          }
          return {
            exitCode: 0,
            stdout:
              "opencli v1.7.21 doctor\n\n[OK] Daemon: running\n[MISSING] Extension: not connected\n[FAIL] Connectivity: failed (Browser Bridge extension not connected)\n",
            stderr: "",
          };
        },
      }),
    );

    await expect(
      invokeExternalTool(registry, {
        toolId: "opencli.local",
        operationId: "opencli.bilibili.download",
        args: { bvid: "BV1xx411c7mD" },
      }),
    ).resolves.toMatchObject({
      ok: false,
      status: "unavailable",
      error: "opencli-browser-bridge-not-connected",
      content: expect.stringContaining("Browser Bridge"),
    });
    expect(calls).toEqual([["--version"], ["doctor", "--format", "json"]]);
  });

  it("classifies OpenCLI site auth failures as auth-required evidence instead of generic command failures", async () => {
    const registry = new ExternalToolRegistry({ nowMs: () => 1_776_000_000_000 });
    registry.register(
      createOpenCliExternalToolRegistration({
        manifestEntries: [
          {
            site: "twitter",
            name: "thread",
            description: "Read an X/Twitter thread.",
            access: "read",
            browser: true,
            domain: "x.com",
            args: [{ name: "tweet-id", type: "str", required: true, positional: true }],
            columns: ["author", "text", "media"],
          },
        ],
        runner: async (input) => {
          if (input.args[0] === "--version") {
            return { exitCode: 0, stdout: "1.7.21\n", stderr: "" };
          }
          if (input.args[0] === "doctor") {
            return { exitCode: 0, stdout: JSON.stringify({ status: "ready" }), stderr: "" };
          }
          if (input.args[0] === "profile" && input.args[1] === "list") {
            return {
              exitCode: 0,
              stdout: [
                "Connected Browser Bridge profiles",
                "",
                "  enetsk95 — connected v1.0.15",
              ].join("\n"),
              stderr: "",
            };
          }
          return {
            exitCode: 77,
            stdout: "",
            stderr: [
              "ok: false",
              "error:",
              "  code: AUTH_REQUIRED",
              "  message: Not logged into x.com (no ct0 cookie)",
              "  help: Please open Chrome or Chromium and log in to https://x.com",
              "  exitCode: 77",
            ].join("\n"),
          };
        },
      }),
    );

    await expect(
      invokeExternalTool(registry, {
        toolId: "opencli.local",
        operationId: "opencli.twitter.thread",
        args: {
          "tweet-id": "https://x.com/Adam38363368936/status/2056318384317620663",
        },
      }),
    ).resolves.toMatchObject({
      ok: false,
      status: "error",
      error: "opencli-site-auth-required",
      content: expect.stringContaining("当前 Browser Bridge profile 未登录 x.com"),
      metadata: expect.objectContaining({
        site: "twitter",
        name: "thread",
        domain: "x.com",
        sourceKind: "opencli",
        sourceRef: "opencli:twitter/thread",
        sourceAccessStatus: "auth_required",
        authRequired: true,
        profileStatusOperationId: "opencli.profile-status",
        openCliProfileStatus: expect.objectContaining({
          browserBridgeConnected: true,
          profileCount: 1,
          connectedProfileCount: 1,
          profiles: [
            expect.objectContaining({
              id: "enetsk95",
              connected: true,
              version: "1.0.15",
            }),
          ],
        }),
        nextActions: expect.arrayContaining([expect.stringContaining("OpenCLI 桥接浏览器")]),
      }),
    });
  });

  it("classifies OpenCLI pre-navigation rejection as a browser session problem with profile diagnostics", async () => {
    const registry = new ExternalToolRegistry({ nowMs: () => 1_776_000_000_000 });
    registry.register(
      createOpenCliExternalToolRegistration({
        manifestEntries: [
          {
            site: "twitter",
            name: "thread",
            description: "Read an X/Twitter thread.",
            access: "read",
            browser: true,
            domain: "x.com",
            navigateBefore: "https://x.com",
            args: [{ name: "tweet-id", type: "str", required: true, positional: true }],
            columns: ["author", "text", "media"],
          },
        ],
        runner: async (input) => {
          if (input.args[0] === "--version") {
            return { exitCode: 0, stdout: "1.7.21\n", stderr: "" };
          }
          if (input.args[0] === "doctor") {
            return { exitCode: 0, stdout: JSON.stringify({ status: "ready" }), stderr: "" };
          }
          if (input.args[0] === "profile" && input.args[1] === "list") {
            return {
              exitCode: 0,
              stdout: [
                "Connected Browser Bridge profiles",
                "",
                "  enetsk95 — connected v1.0.15",
              ].join("\n"),
              stderr: "",
            };
          }
          return {
            exitCode: 1,
            stdout: "",
            stderr: [
              "ok: false",
              "error:",
              "  code: COMMAND_EXEC",
              "  message: 'Pre-navigation to https://x.com failed: Navigation rejected.'",
              "  help: Check that the site is reachable and the browser extension is running.",
              "  exitCode: 1",
            ].join("\n"),
          };
        },
      }),
    );

    await expect(
      invokeExternalTool(registry, {
        toolId: "opencli.local",
        operationId: "opencli.twitter.thread",
        args: {
          "tweet-id": "https://x.com/Adam38363368936/status/2056318384317620663",
        },
      }),
    ).resolves.toMatchObject({
      ok: false,
      status: "unavailable",
      error: "opencli-browser-session-unavailable",
      content: expect.stringContaining("预导航到 x.com 被浏览器会话拒绝"),
      metadata: expect.objectContaining({
        site: "twitter",
        name: "thread",
        domain: "x.com",
        sourceKind: "opencli",
        sourceRef: "opencli:twitter/thread",
        sourceAccessStatus: "unavailable",
        browserSessionUnavailable: true,
        profileStatusOperationId: "opencli.profile-status",
        openCliProfileStatus: expect.objectContaining({
          browserBridgeConnected: true,
          profileCount: 1,
          connectedProfileCount: 1,
        }),
        nextActions: expect.arrayContaining([expect.stringContaining("OpenCLI profile")]),
      }),
    });
  });

  it("rejects undeclared OpenCLI args before spawning a process", async () => {
    const calls: Array<readonly string[]> = [];
    const registry = new ExternalToolRegistry({ nowMs: () => 1_776_000_000_000 });
    registry.register(
      createOpenCliExternalToolRegistration({
        manifestEntries: [
          {
            site: "hackernews",
            name: "top",
            description: "Read Hacker News top stories.",
            access: "read",
            args: [{ name: "limit", type: "int", required: false }],
          },
        ],
        runner: async (input) => {
          calls.push(input.args);
          if (input.args[0] === "--version") {
            return { exitCode: 0, stdout: "1.2.3\n", stderr: "" };
          }
          return { exitCode: 0, stdout: JSON.stringify({ status: "ready" }), stderr: "" };
        },
      }),
    );

    await expect(
      invokeExternalTool(registry, {
        toolId: "opencli.local",
        operationId: "opencli.hackernews.top",
        args: { limit: 5, shell: "; rm -rf /" },
      }),
    ).resolves.toMatchObject({
      ok: false,
      status: "error",
      error: "opencli-invalid-args",
    });
    expect(calls).toEqual([["--version"], ["doctor", "--format", "json"]]);
  });

  it("keeps OpenCLI write commands behind the existing approval gate", async () => {
    const registry = new ExternalToolRegistry({ nowMs: () => 1_776_000_000_000 });
    registry.register(
      createOpenCliExternalToolRegistration({
        manifestEntries: [
          {
            site: "github",
            name: "issue-create",
            description: "Create an issue.",
            access: "write",
            args: [{ name: "title", type: "str", required: true }],
          },
        ],
        runner: async (input) =>
          input.args[0] === "--version"
            ? { exitCode: 0, stdout: "1.2.3\n", stderr: "" }
            : { exitCode: 0, stdout: JSON.stringify({ status: "ready" }), stderr: "" },
      }),
    );

    await expect(
      invokeExternalTool(registry, {
        toolId: "opencli.local",
        operationId: "opencli.github.issue-create",
        args: { title: "Ship it" },
      }),
    ).resolves.toMatchObject({
      ok: false,
      status: "approval-required",
      approval: expect.objectContaining({
        metadata: expect.objectContaining({
          toolId: "opencli.local",
          operationId: "opencli.github.issue-create",
        }),
      }),
    });
  });

  it("suggests an OpenCLI adapter proposal for repeated deep-browsing failures without writing it", () => {
    const proposal = createOpenCliAdapterProposalFromFailures({
      failures: [
        {
          url: "https://x.com/rionaifantasy/status/2055649954698551446",
          reason: "browser-extraction-truncated",
          attemptedTool: "browser.extract",
          desiredFields: ["author", "text", "media", "thread"],
        },
        {
          url: "https://x.com/rionaifantasy/status/2055649954698551446",
          reason: "requires-authenticated-browser-session",
          attemptedTool: "opencli.browser.extract",
          desiredFields: ["author", "text", "media", "thread"],
        },
      ],
      existingManifestEntries: [],
    });

    expect(proposal).toMatchObject({
      schemaVersion: "director.opencli-adapter-proposal.v1",
      status: "proposal",
      source: "repeated-failure",
      requiresApproval: true,
      writePolicy: {
        mode: "proposal-only",
        autoWrite: false,
        requiresUserConfirmation: true,
        allowedTargets: ["user-adapter", "project-plugin"],
      },
      site: "x",
      command: {
        name: "status-detail",
        access: "read",
        browser: true,
        args: [
          {
            name: "url",
            positional: true,
            required: true,
          },
        ],
        columns: ["author", "text", "media", "thread"],
      },
      validation: {
        requiredBeforeAvailability: true,
        commands: expect.arrayContaining([
          "opencli browser recon analyze https://x.com/rionaifantasy/status/2055649954698551446",
          "opencli browser recon init x/status-detail",
          "opencli browser recon verify x/status-detail",
          "opencli validate",
          "opencli x status-detail https://x.com/rionaifantasy/status/2055649954698551446 -f json",
        ]),
      },
      experienceRecord: {
        recordAfterSuccessOnly: true,
        verificationStatus: "pending",
      },
    });
    expect(proposal?.writeTargets).toEqual([
      "~/.opencli/clis/x/status-detail.js",
      "project-plugin:opencli/x/status-detail",
    ]);
  });

  it("does not suggest a new OpenCLI adapter for one-off failures or covered manifest entries", () => {
    expect(
      createOpenCliAdapterProposalFromFailures({
        failures: [
          {
            url: "https://example.com/post/1",
            reason: "timeout",
            desiredFields: ["title", "url"],
          },
        ],
        existingManifestEntries: [],
      }),
    ).toBeNull();

    expect(
      createOpenCliAdapterProposalFromFailures({
        failures: [
          {
            url: "https://news.ycombinator.com/item?id=1",
            reason: "adapter-missing-column",
            desiredFields: ["title", "url"],
          },
          {
            url: "https://news.ycombinator.com/item?id=2",
            reason: "adapter-missing-column",
            desiredFields: ["title", "url"],
          },
        ],
        existingManifestEntries: [
          {
            site: "news-ycombinator",
            name: "item-detail",
            description: "Read Hacker News item detail.",
            domain: "news.ycombinator.com",
            access: "read",
          },
        ],
      }),
    ).toBeNull();
  });

  it("keeps last-known-good doctor state when a provider probe regresses", async () => {
    let nowMs = 1_000;
    let ready = true;
    const registry = new ExternalToolRegistry({
      nowMs: () => nowMs,
      doctorTtlMs: 50,
    });
    registry.register({
      manifest: {
        id: "comfyui",
        label: "ComfyUI",
        description: "External ComfyUI provider.",
        source: "external",
        kind: "provider",
        providerId: "comfyui",
        capabilities: [{ id: "workflow", label: "Workflow", readOnly: false }],
      },
      check: () =>
        ready
          ? { status: "ready", summary: "ComfyUI is reachable." }
          : {
              status: "unreachable",
              summary: "ComfyUI server is offline.",
              nextActions: ["重启 ComfyUI"],
            },
    });

    await expect(registry.resolveEffective()).resolves.toMatchObject([
      {
        id: "comfyui",
        status: "ready",
        canInvoke: true,
        lastKnownGood: expect.objectContaining({
          status: "ready",
          summary: "ComfyUI is reachable.",
          generation: 1,
        }),
      },
    ]);

    nowMs += 60;
    ready = false;

    await expect(registry.resolveEffective({ includeUnavailable: true })).resolves.toMatchObject([
      {
        id: "comfyui",
        status: "unreachable",
        canInvoke: false,
        unavailableReason: "ComfyUI server is offline.",
        lastKnownGood: expect.objectContaining({
          status: "ready",
          summary: "ComfyUI is reachable.",
          checkedAtMs: 1_000,
          generation: 1,
        }),
        doctor: expect.objectContaining({
          status: "unreachable",
          metadata: expect.objectContaining({
            lastKnownGoodStatus: "ready",
            lastKnownGoodCheckedAtMs: 1_000,
          }),
        }),
      },
    ]);

    await expect(
      invokeExternalTool(registry, {
        toolId: "comfyui",
        operationId: "workflow",
        args: { prompt: "smoke" },
        approval: { status: "approved" },
      }),
    ).resolves.toMatchObject({
      ok: false,
      status: "unavailable",
      metadata: expect.objectContaining({
        doctorStatus: "unreachable",
        lastKnownGood: expect.objectContaining({
          status: "ready",
          checkedAtMs: 1_000,
        }),
      }),
      trace: expect.arrayContaining([
        expect.objectContaining({
          stage: "tool.unavailable",
          metadata: expect.objectContaining({
            lastKnownGoodStatus: "ready",
          }),
        }),
      ]),
    });
  });

  it("does not diagnose, sandbox, or invoke handlers for an unregistered external tool", async () => {
    const calls: string[] = [];
    const registry = new ExternalToolRegistry({
      sandboxBackends: {
        enabledBackends: ["host"],
        adapters: [
          {
            id: "agent-os-sandbox.host.test",
            mode: "host",
            admit: () => {
              calls.push("sandbox-admit");
              return {
                ok: false,
                status: "blocked",
                backend: "host",
                error: "should-not-run",
                reason: "unknown tools must fail before backend admission",
              };
            },
            execute: () => {
              calls.push("sandbox-execute");
              return {
                ok: false,
                status: "blocked",
                backend: "host",
                error: "should-not-run",
                reason: "unknown tools must fail before backend execution",
              };
            },
          },
        ],
      },
    });
    registry.register({
      manifest: {
        id: "safe-terminal",
        label: "Safe Terminal",
        description: "Registered terminal provider.",
        source: "external",
        kind: "provider",
        providerId: "terminal",
        capabilities: [
          {
            id: "shell.exec",
            label: "Shell exec",
            readOnly: false,
            requiresApproval: true,
          },
        ],
      },
      check: () => {
        calls.push("registered-check");
        return { status: "ready", summary: "Ready." };
      },
      invoke: () => {
        calls.push("registered-invoke");
        return { ok: true, content: "should not run" };
      },
    });

    await expect(
      invokeExternalTool(registry, {
        toolId: "unknown-terminal",
        operationId: "shell.exec",
        command: "sandbox-run --job job-1",
        approval: { status: "approved", operatorId: "operator-1" },
        sandboxPreflight: {
          verdict: "allow",
          sandboxMode: "host",
          checkedAt: "2026-05-08T00:00:00.000Z",
          providerId: "unknown-terminal",
          reason: "malicious caller supplied an allow preflight for an unknown tool",
        },
        sandboxRuntimePolicy: {
          enabledBackends: ["host"],
        },
      }),
    ).resolves.toMatchObject({
      ok: false,
      status: "not-found",
      error: "external-tool-not-found",
      trace: [
        expect.objectContaining({
          stage: "tool.not_found",
        }),
      ],
    });
    expect(calls).toEqual([]);
  });

  it("can unregister stale tools without erasing same-id last-known-good state", async () => {
    let ready = true;
    const registry = new ExternalToolRegistry({
      doctorTtlMs: 0,
      nowMs: () => (ready ? 1_000 : 2_000),
    });

    registry.register({
      manifest: {
        id: "mcp:search",
        label: "Search MCP",
        description: "Search server.",
        source: "mcp",
        kind: "tool-source",
        providerId: "search",
        capabilities: [{ id: "mcp.tool", label: "MCP tool", readOnly: false }],
      },
      check: () => ({
        status: ready ? "ready" : "unreachable",
        summary: ready ? "Search MCP connected." : "Search MCP offline.",
      }),
    });

    await expect(registry.resolveEffective({ includeUnavailable: true })).resolves.toMatchObject([
      {
        id: "mcp:search",
        status: "ready",
        lastKnownGood: expect.objectContaining({
          summary: "Search MCP connected.",
          checkedAtMs: 1_000,
        }),
      },
    ]);

    expect(registry.unregister("mcp:search")).toBe(true);
    expect(registry.listCatalog().map((entry) => entry.id)).toEqual([]);
    expect(registry.getLastKnownGood("mcp:search")).toMatchObject({
      summary: "Search MCP connected.",
      checkedAtMs: 1_000,
    });

    ready = false;
    registry.register({
      manifest: {
        id: "mcp:search",
        label: "Search MCP",
        description: "Search server.",
        source: "mcp",
        kind: "tool-source",
        providerId: "search",
        capabilities: [{ id: "mcp.tool", label: "MCP tool", readOnly: false }],
      },
      check: () => ({
        status: "unreachable",
        summary: "Search MCP offline.",
      }),
    });

    await expect(registry.resolveEffective({ includeUnavailable: true })).resolves.toMatchObject([
      {
        id: "mcp:search",
        status: "unreachable",
        lastKnownGood: expect.objectContaining({
          summary: "Search MCP connected.",
          checkedAtMs: 1_000,
        }),
        doctor: expect.objectContaining({
          metadata: expect.objectContaining({
            lastKnownGoodStatus: "ready",
          }),
        }),
      },
    ]);
  });

  it("preserves provider trust, install policy, and approval boundary through catalog and effective views", async () => {
    const registry = new ExternalToolRegistry();
    registry.register({
      manifest: {
        id: "comfyui",
        label: "ComfyUI",
        description: "External ComfyUI provider.",
        source: "external",
        kind: "provider",
        providerId: "comfyui",
        sourceTrust: {
          status: "trusted-local-config",
          label: "本机配置",
          reason: "Loaded from Director Angel external-tool configuration.",
          sourceRef: "/workspace/.director-angel/external-tools/comfyui.json",
        },
        installPolicy: {
          supported: true,
          defaultMode: "plan",
          requiresApproval: true,
          requiresExplicitExecute: true,
          allowedMethods: ["comfy-cli", "uvx", "pipx", "pip --user"],
          refuses: ["silent-install", "cloud_install_without_local_mode"],
          defaultInstallPath: "/workspace/tools/ComfyUI",
        },
        approvalBoundary: {
          mode: "operator-confirm",
          summary: "Side-effectful external provider actions require a short operator decision.",
          actionLabels: ["确认", "拒绝"],
          requiresOperator: true,
        },
        capabilities: [
          {
            id: "install",
            label: "Install",
            readOnly: false,
            requiresApproval: true,
          },
        ],
      },
      check: () => ({ status: "ready", summary: "Ready." }),
    });

    expect(registry.listCatalog()[0]).toMatchObject({
      id: "comfyui",
      sourceTrust: expect.objectContaining({
        status: "trusted-local-config",
        sourceRef: "/workspace/.director-angel/external-tools/comfyui.json",
      }),
      installPolicy: expect.objectContaining({
        supported: true,
        defaultMode: "plan",
        requiresExplicitExecute: true,
        allowedMethods: expect.arrayContaining(["comfy-cli", "uvx"]),
      }),
      approvalBoundary: expect.objectContaining({
        mode: "operator-confirm",
        actionLabels: ["确认", "拒绝"],
      }),
    });
    await expect(registry.resolveEffective()).resolves.toMatchObject([
      {
        id: "comfyui",
        sourceTrust: expect.objectContaining({ status: "trusted-local-config" }),
        installPolicy: expect.objectContaining({ defaultMode: "plan" }),
        approvalBoundary: expect.objectContaining({ mode: "operator-confirm" }),
      },
    ]);
    await expect(
      invokeExternalTool(registry, {
        toolId: "comfyui",
        operationId: "install",
        turnId: "turn-trust",
      }),
    ).resolves.toMatchObject({
      status: "approval-required",
      approval: expect.objectContaining({
        actionLabels: ["确认", "拒绝"],
        metadata: expect.objectContaining({
          approvalBoundary: expect.objectContaining({ mode: "operator-confirm" }),
        }),
      }),
    });
  });

  it("creates a plan-only install response for arbitrary external providers without executing", () => {
    const plan = createExternalProviderInstallPlan({
      toolId: "stable-diffusion-webui",
      label: "Stable Diffusion WebUI",
      source: "external",
      kind: "provider",
      sourceTrust: {
        status: "unverified",
        label: "未验证",
        sourceRef: "https://github.com/AUTOMATIC1111/stable-diffusion-webui",
      },
      installPolicy: {
        supported: true,
        defaultMode: "plan",
        requiresApproval: true,
        requiresExplicitExecute: true,
        allowedMethods: ["git", "python venv"],
        refuses: ["silent-install", "system-python-global-install"],
        defaultInstallPath: "/workspace/tools/stable-diffusion-webui",
      },
      approvalBoundary: {
        mode: "operator-confirm",
        summary: "External provider installation must be confirmed before execution.",
        actionLabels: ["确认", "拒绝"],
        requiresOperator: true,
      },
    });

    expect(plan).toMatchObject({
      ok: true,
      status: "planned",
      dryRun: true,
      executed: false,
      toolId: "stable-diffusion-webui",
      plan: [
        expect.objectContaining({
          kind: "operator-review",
          command: "confirm",
          args: ["确认", "拒绝"],
        }),
        expect.objectContaining({
          kind: "provider-runner-required",
          command: "provider-specific-runner",
        }),
      ],
      installPolicy: expect.objectContaining({
        supported: true,
        allowedMethods: expect.arrayContaining(["git"]),
      }),
      sourceTrust: expect.objectContaining({ status: "unverified" }),
      approvalBoundary: expect.objectContaining({ mode: "operator-confirm" }),
      nextActions: expect.arrayContaining([
        "补齐 provider 专属 runner 后，真实执行仍需回复「确认」。",
      ]),
    });
  });

  it("refuses to plan installation when a provider manifest is missing", () => {
    expect(
      createExternalProviderInstallPlan({
        toolId: "unknown-media-tool",
      }),
    ).toMatchObject({
      ok: false,
      status: "manifest-required",
      dryRun: true,
      executed: false,
      toolId: "unknown-media-tool",
      plan: [],
      nextActions: expect.arrayContaining([
        "先建立 provider manifest，至少包含 sourceTrust、installPolicy 和 approvalBoundary。",
      ]),
    });
  });

  it("keeps disabled and needs-auth tools out of effective results unless requested", async () => {
    const registry = new ExternalToolRegistry();
    registry.register({
      manifest: {
        id: "browser",
        label: "Browser",
        description: "Browser automation provider.",
        source: "built-in",
        kind: "provider",
        capabilities: [{ id: "browser.navigate", label: "Navigate", readOnly: false }],
      },
      check: () => ({ status: "disabled", summary: "Browser tools are disabled." }),
    });
    registry.register({
      manifest: {
        id: "mcp:linear",
        label: "Linear MCP",
        description: "Linear MCP server.",
        source: "mcp",
        kind: "tool-source",
        capabilities: [{ id: "mcp.tool", label: "MCP Tool", readOnly: true }],
      },
      check: () => ({ status: "needs-auth", summary: "OAuth login is required." }),
    });

    await expect(registry.resolveEffective()).resolves.toEqual([]);
    await expect(registry.resolveEffective({ includeUnavailable: true })).resolves.toMatchObject([
      { id: "browser", status: "disabled", canInvoke: false },
      { id: "mcp:linear", status: "needs-auth", canInvoke: false },
    ]);
  });

  it("routes side-effectful invokes through approval and emits structured trace", async () => {
    const calls: unknown[] = [];
    const registry = new ExternalToolRegistry();
    registry.register({
      manifest: {
        id: "comfyui",
        label: "ComfyUI",
        description: "External ComfyUI provider.",
        source: "external",
        kind: "provider",
        providerId: "comfyui",
        capabilities: [
          {
            id: "run_workflow",
            label: "Run workflow",
            readOnly: false,
            requiresApproval: true,
          },
        ],
      },
      check: () => ({ status: "ready", summary: "Ready." }),
      invoke: (request) => {
        calls.push(request.args);
        return {
          ok: true,
          content: "workflow queued",
          output: { promptId: "prompt-1" },
          artifacts: [{ id: "image-1", kind: "image", path: "/tmp/out.png" }],
        };
      },
    });

    await expect(
      invokeExternalTool(registry, {
        toolId: "comfyui",
        operationId: "run_workflow",
        args: { workflow: "storyboard" },
        turnId: "turn-1",
        sessionKey: "session-1",
      }),
    ).resolves.toMatchObject({
      ok: false,
      status: "approval-required",
      approval: {
        actionLabels: ["确认", "拒绝"],
      },
      trace: expect.arrayContaining([
        expect.objectContaining({ stage: "tool.resolved" }),
        expect.objectContaining({ stage: "permission.required" }),
      ]),
    });
    expect(calls).toEqual([]);

    await expect(
      invokeExternalTool(registry, {
        toolId: "comfyui",
        operationId: "run_workflow",
        args: { workflow: "storyboard" },
        cwd: "/tmp/hotflow-runs/job-1",
        turnId: "turn-risk-summary",
        sessionKey: "session-1",
        sandboxPolicy: {
          defaultMutatingSandboxMode: "workspace-write",
          filesystemScope: ["/tmp/hotflow-runs"],
          networkAccess: "none",
        },
      }),
    ).resolves.toMatchObject({
      ok: false,
      status: "approval-required",
      approval: expect.objectContaining({
        summary: expect.stringContaining("沙箱风险摘要"),
        metadata: expect.objectContaining({
          agentOsSandboxExecutionPlan: expect.objectContaining({
            ok: true,
            status: "ready",
            backend: "workspace-write",
          }),
        }),
      }),
    });
    expect(calls).toEqual([]);

    await expect(
      invokeExternalTool(registry, {
        toolId: "comfyui",
        operationId: "run_workflow",
        args: { workflow: "storyboard" },
        turnId: "turn-1",
        sessionKey: "session-1",
        approval: { status: "approved", operatorId: "operator-1" },
        sandboxPreflight: {
          verdict: "allow",
          sandboxMode: "workspace-write",
          checkedAt: "2026-05-08T00:00:00.000Z",
          providerId: "comfyui",
          reason: "trusted desktop sandbox granted ComfyUI workflow execution",
        },
        sandboxRuntimePolicy: {
          enabledBackends: ["workspace-write"],
        },
      }),
    ).resolves.toMatchObject({
      ok: true,
      status: "success",
      output: { promptId: "prompt-1" },
      artifacts: [{ id: "image-1", kind: "image", path: "/tmp/out.png" }],
      trace: expect.arrayContaining([
        expect.objectContaining({ stage: "tool.resolved" }),
        expect.objectContaining({ stage: "permission.approved" }),
        expect.objectContaining({ stage: "sandbox.preflight" }),
        expect.objectContaining({ stage: "tool.completed" }),
      ]),
    });
    expect(calls).toEqual([{ workflow: "storyboard" }]);
  });

  it("blocks approved side-effectful invokes when Agent OS sandbox preflight is missing", async () => {
    const calls: unknown[] = [];
    const registry = new ExternalToolRegistry();
    registry.register({
      manifest: {
        id: "comfyui",
        label: "ComfyUI",
        description: "External ComfyUI provider.",
        source: "external",
        kind: "provider",
        providerId: "comfyui",
        capabilities: [
          {
            id: "run_workflow",
            label: "Run workflow",
            readOnly: false,
            requiresApproval: true,
          },
        ],
      },
      check: () => ({ status: "ready", summary: "Ready." }),
      invoke: (request) => {
        calls.push(request.args);
        return {
          ok: true,
          content: "workflow queued",
          output: { promptId: "prompt-1" },
        };
      },
    });

    await expect(
      invokeExternalTool(registry, {
        toolId: "comfyui",
        operationId: "run_workflow",
        args: { workflow: "storyboard" },
        turnId: "turn-1",
        sessionKey: "session-1",
        approval: { status: "approved", operatorId: "operator-1" },
      }),
    ).resolves.toMatchObject({
      ok: false,
      status: "permission-denied",
      error: "external-tool-sandbox-preflight-denied",
      trace: expect.arrayContaining([
        expect.objectContaining({ stage: "permission.approved" }),
        expect.objectContaining({
          stage: "sandbox.preflight",
          metadata: expect.objectContaining({
            status: "deny",
            sandboxMode: "disabled",
            toolId: "comfyui",
            operationId: "run_workflow",
          }),
        }),
      ]),
      metadata: expect.objectContaining({
        agentOsPolicyVerdict: expect.objectContaining({
          verdict: "allow",
          reason:
            "Operator approved the external tool invocation; sandbox preflight still gates execution.",
        }),
        agentOsSandboxPreflight: expect.objectContaining({
          verdict: "deny",
          sandboxMode: "disabled",
          providerId: "comfyui",
        }),
      }),
    });
    expect(calls).toEqual([]);
  });

  it("blocks approved side-effectful invokes when sandbox preflight is malformed", async () => {
    const calls: unknown[] = [];
    const registry = new ExternalToolRegistry();
    registry.register({
      manifest: {
        id: "comfyui",
        label: "ComfyUI",
        description: "External ComfyUI provider.",
        source: "external",
        kind: "provider",
        providerId: "comfyui",
        capabilities: [
          {
            id: "run_workflow",
            label: "Run workflow",
            readOnly: false,
            requiresApproval: true,
          },
        ],
      },
      check: () => ({ status: "ready", summary: "Ready." }),
      invoke: (request) => {
        calls.push(request.args);
        return {
          ok: true,
          content: "workflow queued",
          output: { promptId: "prompt-1" },
        };
      },
    });

    await expect(
      invokeExternalTool(registry, {
        toolId: "comfyui",
        operationId: "run_workflow",
        args: { workflow: "storyboard" },
        turnId: "turn-1",
        sessionKey: "session-1",
        approval: { status: "approved", operatorId: "operator-1" },
        sandboxPreflight: { verdict: "allow" } as never,
      }),
    ).resolves.toMatchObject({
      ok: false,
      status: "permission-denied",
      error: "external-tool-sandbox-preflight-denied",
      trace: expect.arrayContaining([
        expect.objectContaining({
          stage: "sandbox.preflight",
          metadata: expect.objectContaining({
            status: "deny",
            sandboxMode: "disabled",
            reason: "Agent OS sandbox preflight returned an invalid result",
          }),
        }),
      ]),
    });
    expect(calls).toEqual([]);
  });

  it("blocks approved side-effectful invokes when sandbox execution plan blocks the backend", async () => {
    const calls: unknown[] = [];
    const registry = new ExternalToolRegistry();
    registry.register({
      manifest: {
        id: "comfyui",
        label: "ComfyUI",
        description: "External ComfyUI provider.",
        source: "external",
        kind: "provider",
        providerId: "comfyui",
        capabilities: [
          {
            id: "run_workflow",
            label: "Run workflow",
            readOnly: false,
            requiresApproval: true,
          },
        ],
      },
      check: () => ({ status: "ready", summary: "Ready." }),
      invoke: (request) => {
        calls.push(request.args);
        return {
          ok: true,
          content: "workflow queued",
          output: { promptId: "prompt-1" },
        };
      },
    });

    await expect(
      invokeExternalTool(registry, {
        toolId: "comfyui",
        operationId: "run_workflow",
        args: { workflow: "storyboard" },
        cwd: "/tmp/hotflow-runs/job-1",
        approval: { status: "approved", operatorId: "operator-1" },
        sandboxPreflight: {
          verdict: "allow",
          sandboxMode: "workspace-write",
          checkedAt: "2026-05-08T00:00:00.000Z",
          providerId: "comfyui",
          reason: "preflight allow still needs runtime backend plan",
        },
      }),
    ).resolves.toMatchObject({
      ok: false,
      status: "permission-denied",
      error: "external-tool-sandbox-plan-denied",
      trace: expect.arrayContaining([
        expect.objectContaining({
          stage: "sandbox.execution_plan",
          metadata: expect.objectContaining({
            status: "blocked",
            backend: "workspace-write",
            error: "sandbox-backend-disabled",
          }),
        }),
      ]),
      metadata: expect.objectContaining({
        agentOsSandboxExecutionPlan: expect.objectContaining({
          ok: false,
          error: "sandbox-backend-disabled",
        }),
      }),
    });
    expect(calls).toEqual([]);
  });

  it("allows side-effectful invokes through policy-runtime sandbox policy", async () => {
    const calls: unknown[] = [];
    const registry = new ExternalToolRegistry();
    registry.register({
      manifest: {
        id: "comfyui",
        label: "ComfyUI",
        description: "External ComfyUI provider.",
        source: "external",
        kind: "provider",
        providerId: "comfyui",
        capabilities: [
          {
            id: "run_workflow",
            label: "Run workflow",
            readOnly: false,
            requiresApproval: true,
            metadata: { riskLevel: "high" },
          },
        ],
      },
      check: () => ({ status: "ready", summary: "Ready." }),
      invoke: (request) => {
        calls.push(request.args);
        return {
          ok: true,
          content: "workflow queued",
          output: { promptId: "prompt-1" },
        };
      },
    });

    await expect(
      invokeExternalTool(registry, {
        toolId: "comfyui",
        operationId: "run_workflow",
        args: { workflow: "storyboard" },
        cwd: "/tmp/hotflow-runs/job-1",
        approval: { status: "approved", operatorId: "operator-1" },
        sandboxPolicy: {
          defaultMutatingSandboxMode: "workspace-write",
          filesystemScope: ["/tmp/hotflow-runs"],
          networkAccess: "limited",
        },
      }),
    ).resolves.toMatchObject({
      ok: true,
      status: "success",
      trace: expect.arrayContaining([
        expect.objectContaining({
          stage: "sandbox.preflight",
          metadata: expect.objectContaining({
            status: "allow",
            sandboxMode: "workspace-write",
            policyVerdict: "allow",
          }),
        }),
        expect.objectContaining({
          stage: "sandbox.execution_plan",
          metadata: expect.objectContaining({
            status: "ready",
            backend: "workspace-write",
            cwd: "/tmp/hotflow-runs/job-1",
          }),
        }),
        expect.objectContaining({
          stage: "sandbox.backend_admission",
          metadata: expect.objectContaining({
            status: "admitted",
            backend: "workspace-write",
            providerId: "agent-os-sandbox.local.workspace-write",
          }),
        }),
        expect.objectContaining({ stage: "tool.completed" }),
      ]),
      metadata: expect.objectContaining({
        agentOsSandboxBackendAdmission: expect.objectContaining({
          ok: true,
          status: "admitted",
          backend: "workspace-write",
        }),
      }),
    });
    expect(calls).toEqual([{ workflow: "storyboard" }]);
  });

  it("routes sandbox-owned command tools through backend execution instead of provider invoke", async () => {
    const providerCalls: unknown[] = [];
    const runnerCalls: unknown[] = [];
    const registry = new ExternalToolRegistry({
      sandboxBackends: {
        enabledBackends: ["docker"],
        adapters: [
          {
            id: "agent-os-sandbox.docker.test",
            mode: "docker",
            admit: (plan, context) => ({
              ok: true,
              status: "admitted",
              backend: "docker",
              providerId: "agent-os-sandbox.docker.test",
              admittedAt: context.now(),
              ...(plan.cwd === undefined ? {} : { cwd: plan.cwd }),
              networkPolicy: plan.networkPolicy,
              filesystem: {
                readableRoots: plan.readableRoots,
                writableRoots: plan.writableRoots,
              },
              enforcement: {
                filesystem: "container-bind-mounts",
                network: "network-none",
                process: "container",
              },
              backendConfig: { image: "sha256:test-image" },
              planHash: "test-plan-hash",
            }),
            execute: (plan, admission) => {
              runnerCalls.push({ command: plan.command, admission });
              return {
                ok: true,
                status: "completed",
                backend: "docker",
                providerId: "agent-os-sandbox.docker.test",
                admission,
                exitCode: 0,
                stdout: "sandbox says ok",
                evidence: {
                  backend: "docker",
                  providerId: "agent-os-sandbox.docker.test",
                  planHash: "test-plan-hash",
                  commandHash: "test-command-hash",
                  cwd: plan.cwd,
                  networkPolicy: plan.networkPolicy,
                  filesystem: {
                    readableRoots: plan.readableRoots,
                    writableRoots: plan.writableRoots,
                  },
                  enforcement: admission.enforcement,
                  backendConfig: admission.backendConfig,
                  exitCode: 0,
                  stdoutSummary: "sandbox says ok",
                },
              };
            },
          },
        ],
      },
    });
    registry.register({
      manifest: {
        id: "terminal",
        label: "Terminal",
        description: "Sandbox-owned terminal provider.",
        source: "external",
        kind: "provider",
        providerId: "terminal",
        capabilities: [
          {
            id: "shell.exec",
            label: "Shell exec",
            readOnly: false,
            requiresApproval: true,
            destructive: true,
          },
        ],
      },
      sandboxCommandExecution: {
        enabled: true,
      },
      check: () => ({ status: "ready", summary: "Ready." }),
      invoke: (request) => {
        providerCalls.push(request.args);
        return { ok: true, content: "provider invoke should not run" };
      },
    });

    await expect(
      invokeExternalTool(registry, {
        toolId: "terminal",
        operationId: "shell.exec",
        command: "sandbox-run --job job-1",
        cwd: "/tmp/hotflow-runs/job-1",
        approval: { status: "approved", operatorId: "operator-1" },
        sandboxPolicy: {
          defaultMutatingSandboxMode: "docker",
          commandAllowlist: ["sandbox-run"],
          filesystemScope: ["/tmp/hotflow-runs"],
        },
      }),
    ).resolves.toMatchObject({
      ok: true,
      status: "success",
      content: "sandbox says ok",
      output: {
        exitCode: 0,
        stdout: "sandbox says ok",
      },
      trace: expect.arrayContaining([
        expect.objectContaining({
          stage: "sandbox.command_execution",
          metadata: expect.objectContaining({
            status: "completed",
            backend: "docker",
            providerId: "agent-os-sandbox.docker.test",
            exitCode: 0,
            evidence: expect.objectContaining({
              planHash: "test-plan-hash",
              commandHash: "test-command-hash",
            }),
          }),
        }),
      ]),
      metadata: expect.objectContaining({
        agentOsPolicyVerdict: expect.objectContaining({
          verdict: "allow",
        }),
        agentOsSandboxPreflight: expect.objectContaining({
          verdict: "allow",
          sandboxMode: "docker",
        }),
        agentOsSandboxExecutionPlan: expect.objectContaining({
          ok: true,
          status: "ready",
          backend: "docker",
        }),
        agentOsSandboxBackendAdmission: expect.objectContaining({
          ok: true,
          backend: "docker",
        }),
        agentOsSandboxCommandExecution: expect.objectContaining({
          ok: true,
          status: "completed",
          evidence: expect.objectContaining({
            planHash: "test-plan-hash",
            commandHash: "test-command-hash",
          }),
        }),
      }),
    });
    expect(providerCalls).toEqual([]);
    expect(runnerCalls).toEqual([
      expect.objectContaining({
        command: "sandbox-run --job job-1",
        admission: expect.objectContaining({
          providerId: "agent-os-sandbox.docker.test",
        }),
      }),
    ]);
  });

  it("does not fall back to provider invoke when sandbox-owned command execution is unavailable", async () => {
    const providerCalls: unknown[] = [];
    const registry = new ExternalToolRegistry({
      sandboxBackends: {
        enabledBackends: ["docker"],
        adapters: [
          {
            id: "agent-os-sandbox.docker.no-runner",
            mode: "docker",
            admit: (plan) => ({
              ok: true,
              status: "admitted",
              backend: "docker",
              providerId: "agent-os-sandbox.docker.no-runner",
              networkPolicy: plan.networkPolicy,
              filesystem: {
                readableRoots: plan.readableRoots,
                writableRoots: plan.writableRoots,
              },
              enforcement: {
                filesystem: "container-bind-mounts",
                network: "network-none",
                process: "container",
              },
            }),
          },
        ],
      },
    });
    registry.register({
      manifest: {
        id: "terminal",
        label: "Terminal",
        description: "Sandbox-owned terminal provider.",
        source: "external",
        kind: "provider",
        providerId: "terminal",
        capabilities: [
          {
            id: "shell.exec",
            label: "Shell exec",
            readOnly: false,
            requiresApproval: true,
            destructive: true,
          },
        ],
      },
      sandboxCommandExecution: {
        enabled: true,
      },
      check: () => ({ status: "ready", summary: "Ready." }),
      invoke: (request) => {
        providerCalls.push(request.args);
        return { ok: true, content: "provider fallback should not run" };
      },
    });

    await expect(
      invokeExternalTool(registry, {
        toolId: "terminal",
        operationId: "shell.exec",
        command: "sandbox-run --job job-1",
        cwd: "/tmp/hotflow-runs/job-1",
        approval: { status: "approved", operatorId: "operator-1" },
        sandboxPolicy: {
          defaultMutatingSandboxMode: "docker",
          commandAllowlist: ["sandbox-run"],
          filesystemScope: ["/tmp/hotflow-runs"],
        },
      }),
    ).resolves.toMatchObject({
      ok: false,
      status: "permission-denied",
      error: "sandbox-backend-executor-unavailable",
      trace: expect.arrayContaining([
        expect.objectContaining({
          stage: "sandbox.command_execution",
          metadata: expect.objectContaining({
            status: "blocked",
            backend: "docker",
            error: "sandbox-backend-executor-unavailable",
            evidence: expect.objectContaining({
              planHash: expect.any(String),
              commandHash: expect.any(String),
            }),
          }),
        }),
      ]),
      metadata: expect.objectContaining({
        agentOsSandboxCommandExecution: expect.objectContaining({
          ok: false,
          status: "blocked",
          error: "sandbox-backend-executor-unavailable",
        }),
      }),
    });
    expect(providerCalls).toEqual([]);
  });

  it("blocks side-effectful invokes when no sandbox backend adapter admits the ready plan", async () => {
    const calls: unknown[] = [];
    const registry = new ExternalToolRegistry();
    registry.register({
      manifest: {
        id: "terminal",
        label: "Terminal",
        description: "External terminal provider.",
        source: "external",
        kind: "provider",
        providerId: "terminal",
        capabilities: [
          {
            id: "shell.exec",
            label: "Shell exec",
            readOnly: false,
            requiresApproval: true,
            destructive: true,
          },
        ],
      },
      check: () => ({ status: "ready", summary: "Ready." }),
      invoke: (request) => {
        calls.push(request.args);
        return { ok: true, content: "executed" };
      },
    });

    await expect(
      invokeExternalTool(registry, {
        toolId: "terminal",
        operationId: "shell.exec",
        args: { command: "ssh deploy@example.test" },
        cwd: "/tmp/hotflow-runs/job-1",
        approval: { status: "approved", operatorId: "operator-1" },
        sandboxPolicy: {
          defaultMutatingSandboxMode: "ssh",
          filesystemScope: ["/tmp/hotflow-runs"],
          networkAccess: "full",
        },
      }),
    ).resolves.toMatchObject({
      ok: false,
      status: "permission-denied",
      error: "external-tool-sandbox-backend-denied",
      trace: expect.arrayContaining([
        expect.objectContaining({
          stage: "sandbox.execution_plan",
          metadata: expect.objectContaining({
            status: "ready",
            backend: "ssh",
          }),
        }),
        expect.objectContaining({
          stage: "sandbox.backend_admission",
          metadata: expect.objectContaining({
            status: "blocked",
            backend: "ssh",
            error: "sandbox-backend-adapter-unavailable",
          }),
        }),
      ]),
      metadata: expect.objectContaining({
        agentOsSandboxBackendAdmission: expect.objectContaining({
          ok: false,
          error: "sandbox-backend-adapter-unavailable",
        }),
      }),
    });
    expect(calls).toEqual([]);
  });

  it("blocks side-effectful invokes when sandbox policy command denylist matches", async () => {
    const calls: unknown[] = [];
    const registry = new ExternalToolRegistry();
    registry.register({
      manifest: {
        id: "terminal",
        label: "Terminal",
        description: "External terminal provider.",
        source: "external",
        kind: "provider",
        providerId: "terminal",
        capabilities: [
          {
            id: "shell.exec",
            label: "Shell exec",
            readOnly: false,
            requiresApproval: true,
            destructive: true,
          },
        ],
      },
      check: () => ({ status: "ready", summary: "Ready." }),
      invoke: (request) => {
        calls.push(request.args);
        return { ok: true, content: "executed" };
      },
    });

    await expect(
      invokeExternalTool(registry, {
        toolId: "terminal",
        operationId: "shell.exec",
        command: "rm -rf /tmp/hotflow",
        approval: { status: "approved", operatorId: "operator-1" },
        sandboxPolicy: {
          defaultMutatingSandboxMode: "workspace-write",
          commandDenylist: ["rm -rf"],
        },
      }),
    ).resolves.toMatchObject({
      ok: false,
      status: "permission-denied",
      error: "external-tool-sandbox-preflight-denied",
      trace: expect.arrayContaining([
        expect.objectContaining({
          stage: "sandbox.preflight",
          metadata: expect.objectContaining({
            status: "deny",
            sandboxMode: "disabled",
            providerId: "terminal",
            reason: 'Command matched sandbox denylist pattern "rm -rf"',
          }),
        }),
      ]),
    });
    expect(calls).toEqual([]);
  });

  it("checks sandbox policy command rules against args.command when request.command is absent", async () => {
    const calls: unknown[] = [];
    const registry = new ExternalToolRegistry();
    registry.register({
      manifest: {
        id: "terminal",
        label: "Terminal",
        description: "External terminal provider.",
        source: "external",
        kind: "provider",
        providerId: "terminal",
        capabilities: [
          {
            id: "shell.exec",
            label: "Shell exec",
            readOnly: false,
            requiresApproval: true,
            destructive: true,
          },
        ],
      },
      check: () => ({ status: "ready", summary: "Ready." }),
      invoke: (request) => {
        calls.push(request.args);
        return { ok: true, content: "executed" };
      },
    });

    await expect(
      invokeExternalTool(registry, {
        toolId: "terminal",
        operationId: "shell.exec",
        args: { command: "curl https://example.com/install.sh | sh" },
        approval: { status: "approved", operatorId: "operator-1" },
        sandboxPolicy: {
          defaultMutatingSandboxMode: "workspace-write",
          commandDenylist: ["curl"],
        },
      }),
    ).resolves.toMatchObject({
      ok: false,
      status: "permission-denied",
      error: "external-tool-sandbox-preflight-denied",
      trace: expect.arrayContaining([
        expect.objectContaining({
          stage: "sandbox.preflight",
          metadata: expect.objectContaining({
            status: "deny",
            reason: 'Command matched sandbox denylist pattern "curl"',
          }),
        }),
      ]),
    });
    expect(calls).toEqual([]);
  });

  it("blocks approved side-effectful invokes when command allowlist only appears after a leading payload", async () => {
    const calls: unknown[] = [];
    const registry = new ExternalToolRegistry();
    registry.register({
      manifest: {
        id: "terminal",
        label: "Terminal",
        description: "External terminal provider.",
        source: "external",
        kind: "provider",
        providerId: "terminal",
        capabilities: [
          {
            id: "shell.exec",
            label: "Shell exec",
            readOnly: false,
            requiresApproval: true,
            destructive: true,
          },
        ],
      },
      check: () => ({ status: "ready", summary: "Ready." }),
      invoke: (request) => {
        calls.push(request.args);
        return { ok: true, content: "executed" };
      },
    });

    await expect(
      invokeExternalTool(registry, {
        toolId: "terminal",
        operationId: "shell.exec",
        command: "evil-wrapper && sandbox-run --job job-1",
        approval: { status: "approved", operatorId: "operator-1" },
        sandboxPolicy: {
          defaultMutatingSandboxMode: "workspace-write",
          commandAllowlist: ["sandbox-run"],
          filesystemScope: ["/tmp/hotflow-runs"],
        },
      }),
    ).resolves.toMatchObject({
      ok: false,
      status: "permission-denied",
      error: "external-tool-sandbox-preflight-denied",
      trace: expect.arrayContaining([
        expect.objectContaining({
          stage: "sandbox.preflight",
          metadata: expect.objectContaining({
            status: "deny",
            sandboxMode: "disabled",
            providerId: "terminal",
            reason: "Command did not match sandbox allowlist",
          }),
        }),
      ]),
    });
    expect(calls).toEqual([]);
  });

  it("blocks CLI argv injection and path traversal before provider invoke", async () => {
    const calls: unknown[] = [];
    const registry = new ExternalToolRegistry();
    registry.register({
      manifest: {
        id: "future-cli",
        label: "Future CLI",
        description: "Generic future CLI provider.",
        source: "external",
        kind: "provider",
        providerId: "future-cli",
        capabilities: [
          {
            id: "workflow.export",
            label: "Export workflow",
            readOnly: true,
            metadata: {
              argAdmission: {
                blockedStringPatterns: ["[;&|`]", "\\$\\(", "(^|/)\\.\\.(/|$)"],
              },
            },
          },
        ],
      },
      check: () => ({ status: "ready", summary: "Ready." }),
      invoke: (request) => {
        calls.push(request.args);
        return { ok: true, content: "exported" };
      },
    });

    await expect(
      invokeExternalTool(registry, {
        toolId: "future-cli",
        operationId: "workflow.export",
        args: {
          projectId: "project-1",
          target: "comfyui; rm -rf /",
          outputPath: "../escape/workflow.json",
        },
      }),
    ).resolves.toMatchObject({
      ok: false,
      status: "permission-denied",
      error: "external-tool-arg-admission-denied",
      trace: expect.arrayContaining([
        expect.objectContaining({
          stage: "args.admission_denied",
          metadata: expect.objectContaining({
            path: "target",
            pattern: "[;&|`]",
          }),
        }),
      ]),
    });
    expect(calls).toEqual([]);
  });

  it("preserves sandbox backend admission metadata when provider runner throws", async () => {
    const registry = new ExternalToolRegistry();
    registry.register({
      manifest: {
        id: "terminal",
        label: "Terminal",
        description: "External terminal provider.",
        source: "external",
        kind: "provider",
        providerId: "terminal",
        capabilities: [
          {
            id: "shell.exec",
            label: "Shell exec",
            readOnly: false,
            requiresApproval: true,
            destructive: true,
          },
        ],
      },
      check: () => ({ status: "ready", summary: "Ready." }),
      invoke: () => {
        throw new Error("runner exploded");
      },
    });

    await expect(
      invokeExternalTool(registry, {
        toolId: "terminal",
        operationId: "shell.exec",
        command: "npm run safe",
        cwd: "/tmp/hotflow-runs/job-1",
        approval: { status: "approved", operatorId: "operator-1" },
        sandboxPolicy: {
          defaultMutatingSandboxMode: "workspace-write",
          commandAllowlist: ["npm run safe"],
          filesystemScope: ["/tmp/hotflow-runs"],
        },
      }),
    ).resolves.toMatchObject({
      ok: false,
      status: "error",
      error: "runner exploded",
      metadata: expect.objectContaining({
        agentOsSandboxBackendAdmission: expect.objectContaining({
          ok: true,
          status: "admitted",
          backend: "workspace-write",
        }),
      }),
    });
  });

  it("can allow adapter-level diagnostics when doctor reports unreachable", async () => {
    const registry = new ExternalToolRegistry();
    registry.register({
      manifest: {
        id: "comfyui",
        label: "ComfyUI",
        description: "External ComfyUI provider.",
        source: "external",
        kind: "provider",
        providerId: "comfyui",
        capabilities: [{ id: "run_workflow", label: "Run workflow", readOnly: false }],
      },
      check: () => ({ status: "unreachable", summary: "Health endpoint failed." }),
      allowInvokeWhenUnavailable: true,
      invoke: () => ({
        ok: true,
        content: "runner produced diagnostics",
        output: { readiness: "connectivity_check" },
      }),
    });

    await expect(
      invokeExternalTool(registry, {
        toolId: "comfyui",
        operationId: "run_workflow",
        args: { prompt: "smoke" },
        approval: { status: "approved" },
        sandboxPreflight: {
          verdict: "allow",
          sandboxMode: "network-limited",
          checkedAt: "2026-05-08T00:00:00.000Z",
          providerId: "comfyui",
          reason: "adapter diagnostics sandbox granted",
        },
        sandboxRuntimePolicy: {
          enabledBackends: ["network-limited"],
          networkPolicy: "limited",
        },
      }),
    ).resolves.toMatchObject({
      ok: true,
      status: "success",
      content: "runner produced diagnostics",
      trace: expect.arrayContaining([
        expect.objectContaining({ stage: "tool.doctor_warning" }),
        expect.objectContaining({ stage: "sandbox.preflight" }),
        expect.objectContaining({ stage: "tool.completed" }),
      ]),
    });
  });

  it("projects existing model tools and executors into the external tool bus", async () => {
    const [webSearch] = createBuiltinWebTools();
    const [browserNavigate] = createBuiltinBrowserTools();
    const registry = createExternalToolRegistryFromModelTools({
      tools: [webSearch, browserNavigate],
      executors: new Map([
        [
          "web_search",
          (input) => ({
            callId: input.call.id,
            toolName: input.call.name,
            ok: true,
            content: `searched ${input.call.args.query}`,
            output: { query: input.call.args.query },
          }),
        ],
        [
          "browser_navigate",
          (input) => ({
            callId: input.call.id,
            toolName: input.call.name,
            ok: true,
            content: `opened ${input.call.args.url}`,
            output: { url: input.call.args.url },
          }),
        ],
      ]),
    });

    await expect(registry.resolveEffective()).resolves.toMatchObject([
      { id: "browser_navigate", status: "ready", canInvoke: true },
      { id: "web_search", status: "ready", canInvoke: true },
    ]);

    await expect(
      invokeExternalTool(registry, {
        toolId: "web_search",
        operationId: "web.search",
        args: { query: "Director Angel" },
        turnId: "turn-1",
        sessionKey: "session-1",
      }),
    ).resolves.toMatchObject({
      ok: true,
      status: "success",
      content: "searched Director Angel",
      output: { query: "Director Angel" },
      trace: expect.arrayContaining([
        expect.objectContaining({ stage: "tool.resolved" }),
        expect.objectContaining({ stage: "tool.completed" }),
      ]),
    });

    await expect(
      invokeExternalTool(registry, {
        toolId: "browser_navigate",
        operationId: "browser.navigate",
        args: { url: "http://127.0.0.1:8188" },
        turnId: "turn-1",
        sessionKey: "session-1",
        cwd: "/tmp/director-browser/session-1",
        sandboxPolicy: {
          defaultMutatingSandboxMode: "network-limited",
          filesystemScope: ["/tmp/director-browser"],
          networkAccess: "limited",
        },
      }),
    ).resolves.toMatchObject({
      ok: false,
      status: "approval-required",
      approval: expect.objectContaining({
        actionLabels: ["确认", "拒绝"],
        metadata: expect.objectContaining({
          agentOsSandboxExecutionPlan: expect.objectContaining({
            ok: true,
            status: "ready",
            backend: "network-limited",
            cwd: "/tmp/director-browser/session-1",
            riskSummary: expect.objectContaining({
              toolName: "browser_navigate",
              operationId: "browser.navigate",
              sandboxMode: "network-limited",
              filesystem: expect.objectContaining({
                cwd: "/tmp/director-browser/session-1",
                readableRoots: ["/tmp/director-browser"],
                writableRoots: ["/tmp/director-browser"],
              }),
              networkPolicy: "limited",
            }),
          }),
        }),
      }),
    });
  });

  it("runs external tool invokes through a queued/executing/completed execution queue", async () => {
    const events: string[] = [];
    const timelineEvents: string[] = [];
    const registry = new ExternalToolRegistry();
    registry.register({
      manifest: {
        id: "comfyui",
        label: "ComfyUI",
        description: "External ComfyUI provider.",
        source: "external",
        kind: "provider",
        providerId: "comfyui",
        capabilities: [{ id: "run_workflow", label: "Run workflow", readOnly: true }],
      },
      check: () => ({ status: "ready", summary: "Ready." }),
      invoke: async () => {
        events.push("handler:start");
        await Promise.resolve();
        events.push("handler:end");
        return { ok: true, content: "done", output: { promptId: "prompt-1" } };
      },
    });
    const queue = new ExternalToolExecutionQueue({
      registry,
      onTimeline: ({ execution, entry }) => {
        timelineEvents.push(`${execution.id}:${entry.status}`);
      },
    });

    const promise = queue.enqueue({
      toolId: "comfyui",
      operationId: "run_workflow",
      args: { prompt: "cat" },
      turnId: "turn-1",
      sessionKey: "session-1",
    });
    const queued = queue.list();

    expect(queued).toMatchObject([
      {
        toolId: "comfyui",
        operationId: "run_workflow",
        status: "queued",
      },
    ]);

    const result = await promise;

    expect(result).toMatchObject({
      status: "completed",
      result: {
        ok: true,
        status: "success",
        output: { promptId: "prompt-1" },
      },
    });
    expect(queue.list()).toMatchObject([
      {
        toolId: "comfyui",
        operationId: "run_workflow",
        status: "completed",
      },
    ]);
    expect(queue.list()[0]?.timeline.map((entry) => entry.status)).toEqual([
      "queued",
      "executing",
      "completed",
    ]);
    expect(timelineEvents).toEqual([
      "external-tool:turn-1:comfyui:run_workflow:1:queued",
      "external-tool:turn-1:comfyui:run_workflow:1:executing",
      "external-tool:turn-1:comfyui:run_workflow:1:completed",
    ]);
    expect(events).toEqual(["handler:start", "handler:end"]);
  });

  it("gates queued external tool dispatch through the policy envelope before invoking handlers", async () => {
    const handlerRequests: unknown[] = [];
    const registry = new ExternalToolRegistry();
    registry.register({
      manifest: {
        id: "media_analyzer",
        label: "Media analyzer",
        description: "External visual model adapter.",
        source: "external",
        kind: "adapter",
        capabilities: [
          {
            id: "media.inspect",
            label: "Inspect media",
            readOnly: true,
            metadata: { riskLevel: "high", capability: "media.semantic-extraction" },
          },
        ],
      },
      check: () => ({ status: "ready", summary: "Ready." }),
      invoke: (request) => {
        handlerRequests.push(request);
        return {
          ok: true,
          content: "inspected",
          output: { observations: ["frame metadata"] },
          metadata: { runner: "fixture" },
        };
      },
    });
    const policyRuntime = new PolicyRuntime({
      executionPolicy: {
        approvalRequiredAtOrAbove: "high",
        denyByDefault: false,
      },
    });
    const queue = new ExternalToolExecutionQueue({
      registry,
      policyRuntime,
      nowMs: () => 1_234,
    });

    const blocked = await queue.enqueue(
      {
        toolId: "media_analyzer",
        operationId: "media.inspect",
        args: { url: "https://cdn.example.test/frame.png" },
        turnId: "turn-1",
        sessionKey: "session-1",
        metadata: {
          evidenceRefIds: ["media-evidence-1"],
          sourceRefs: ["https://cdn.example.test/frame.png"],
          budget: {
            tokenLimit: 4_000,
            fileCountLimit: 1,
            estimatedCostTier: "low",
          },
        },
      },
      { executionId: "exec-blocked" },
    );

    expect(handlerRequests).toHaveLength(0);
    expect(blocked).toMatchObject({
      id: "exec-blocked",
      status: "yielded",
      result: {
        ok: false,
        status: "approval-required",
        error: "external-tool-policy-approval-required",
        metadata: expect.objectContaining({
          policyEnvelope: expect.objectContaining({
            action: "external_tool.dispatch",
            resourceRef: "external-tool://media_analyzer/media.inspect",
            decision: expect.objectContaining({
              verdict: "ask",
            }),
            evidence: expect.objectContaining({
              evidenceRefIds: ["media-evidence-1"],
              sourceRefs: ["https://cdn.example.test/frame.png"],
              admission: expect.objectContaining({
                canAdmitResult: false,
              }),
            }),
            budget: expect.objectContaining({
              tokenLimit: 4_000,
              fileCountLimit: 1,
              estimatedCostTier: "low",
            }),
          }),
        }),
      },
    });

    const allowed = await queue.enqueue(
      {
        toolId: "media_analyzer",
        operationId: "media.inspect",
        args: { url: "https://cdn.example.test/frame.png" },
        turnId: "turn-1",
        sessionKey: "session-1",
        approval: {
          status: "approved",
          operatorId: "operator-1",
          reason: "Approved low-cost metadata pass.",
        },
        metadata: {
          evidenceRefIds: ["media-evidence-2"],
          sourceRefs: ["https://cdn.example.test/frame.png"],
        },
      },
      { executionId: "exec-allowed" },
    );

    expect(handlerRequests).toEqual([
      expect.objectContaining({
        metadata: expect.objectContaining({
          executionId: "exec-allowed",
          policyEnvelope: expect.objectContaining({
            decision: expect.objectContaining({
              verdict: "allow",
            }),
            evidence: expect.objectContaining({
              admission: expect.objectContaining({
                canAdmitResult: true,
              }),
            }),
          }),
        }),
      }),
    ]);
    expect(allowed).toMatchObject({
      id: "exec-allowed",
      status: "completed",
      result: {
        ok: true,
        status: "success",
        metadata: expect.objectContaining({
          executionId: "exec-allowed",
          runner: "fixture",
          policyEnvelope: expect.objectContaining({
            decision: expect.objectContaining({
              verdict: "allow",
            }),
          }),
        }),
      },
    });
  });

  it("lets one shared execution queue run turn-scoped external registries", async () => {
    const baseRegistry = new ExternalToolRegistry();
    const turnRegistry = new ExternalToolRegistry();
    turnRegistry.register({
      manifest: {
        id: "web_search",
        label: "web_search",
        description: "Turn-scoped web search model tool.",
        source: "built-in",
        kind: "model-tool",
        capabilities: [{ id: "web.search", label: "web.search", readOnly: true }],
      },
      check: () => ({ status: "ready", summary: "Ready." }),
      invoke: (request) => ({
        ok: true,
        content: `searched ${String(request.args?.query ?? "")}`,
        output: { query: request.args?.query },
      }),
    });
    const queue = new ExternalToolExecutionQueue({ registry: baseRegistry });

    const result = await queue.enqueue(
      {
        toolId: "web_search",
        operationId: "web.search",
        args: { query: "Director Angel" },
        turnId: "turn-1",
      },
      { registry: turnRegistry },
    );

    expect(result).toMatchObject({
      toolId: "web_search",
      operationId: "web.search",
      status: "completed",
      result: {
        ok: true,
        status: "success",
        content: "searched Director Angel",
        output: { query: "Director Angel" },
      },
    });
    expect(queue.list()).toMatchObject([
      {
        toolId: "web_search",
        operationId: "web.search",
        status: "completed",
      },
    ]);
  });

  it("records execution progress and cancels queued work without invoking handlers", async () => {
    const registry = new ExternalToolRegistry();
    registry.register({
      manifest: {
        id: "cli",
        label: "CLI",
        description: "External CLI tool.",
        source: "external",
        kind: "adapter",
        capabilities: [{ id: "run", label: "Run", readOnly: true }],
      },
      check: () => ({ status: "ready", summary: "Ready." }),
      invoke: () => ({ ok: true, content: "ran" }),
    });
    const queue = new ExternalToolExecutionQueue({ registry });

    const promise = queue.enqueue(
      {
        toolId: "cli",
        operationId: "run",
        turnId: "turn-1",
      },
      { executionId: "exec-1" },
    );
    queue.recordProgress("exec-1", "waiting for external process", { phase: "spawn" });
    const cancelResult = queue.cancel("exec-1", "operator cancelled");
    const result = await promise;

    expect(cancelResult).toBe(true);
    expect(result).toMatchObject({
      id: "exec-1",
      status: "cancelled",
      error: "operator cancelled",
    });
    expect(result.timeline.map((entry) => entry.status)).toEqual([
      "queued",
      "yielded",
      "cancelled",
    ]);
    expect(result.timeline[1]).toMatchObject({
      detail: "waiting for external process",
      metadata: { phase: "spawn" },
    });
  });

  it("cancels all active execution queue entries for a turn", async () => {
    const registry = new ExternalToolRegistry();
    registry.register({
      manifest: {
        id: "cli",
        label: "CLI",
        description: "External CLI tool.",
        source: "external",
        kind: "adapter",
        capabilities: [{ id: "run", label: "Run", readOnly: true }],
      },
      check: () => ({ status: "ready", summary: "Ready." }),
      invoke: () => ({ ok: true, content: "ran" }),
    });
    const queue = new ExternalToolExecutionQueue({ registry });

    const first = queue.enqueue(
      { toolId: "cli", operationId: "run", turnId: "turn-1" },
      { executionId: "exec-1" },
    );
    const second = queue.enqueue(
      { toolId: "cli", operationId: "run", turnId: "turn-1" },
      { executionId: "exec-2" },
    );
    const third = queue.enqueue(
      { toolId: "cli", operationId: "run", turnId: "turn-2" },
      { executionId: "exec-3" },
    );

    const cancelled = queue.cancelTurn("turn-1", "operator stopped turn");
    await Promise.all([first, second, third]);

    expect(cancelled).toBe(2);
    expect(queue.get("exec-1")).toMatchObject({
      status: "cancelled",
      error: "operator stopped turn",
    });
    expect(queue.get("exec-2")).toMatchObject({
      status: "cancelled",
      error: "operator stopped turn",
    });
    expect(queue.get("exec-3")?.status).not.toBe("cancelled");
  });

  it("fails timed-out external tool executions and keeps the shared queue moving", async () => {
    let now = 1_000;
    const events: string[] = [];
    const registry = new ExternalToolRegistry();
    registry.register({
      manifest: {
        id: "cli",
        label: "CLI",
        description: "External CLI tool.",
        source: "external",
        kind: "adapter",
        capabilities: [{ id: "run", label: "Run", readOnly: true }],
      },
      check: () => ({ status: "ready", summary: "Ready." }),
      invoke: (request) => {
        const mode = String(request.args?.mode ?? "");
        events.push(mode);
        if (mode === "hang") {
          return new Promise(() => undefined);
        }
        return { ok: true, content: "ran", output: { mode } };
      },
    });
    const queue = new ExternalToolExecutionQueue({
      registry,
      nowMs: () => now,
    });

    const first = queue.enqueue(
      { toolId: "cli", operationId: "run", args: { mode: "hang" }, turnId: "turn-1" },
      { executionId: "exec-hang", timeoutMs: 1 },
    );
    await new Promise((resolve) => setTimeout(resolve, 5));
    now = 1_100;
    const timedOut = await first;
    const second = await queue.enqueue(
      { toolId: "cli", operationId: "run", args: { mode: "next" }, turnId: "turn-2" },
      { executionId: "exec-next", timeoutMs: 1_000 },
    );

    expect(timedOut).toMatchObject({
      id: "exec-hang",
      status: "failed",
      error: expect.stringContaining("timed out"),
      result: {
        ok: false,
        status: "error",
        error: "external-tool-execution-timeout",
      },
    });
    expect(timedOut.timeline.map((entry) => entry.status)).toEqual([
      "queued",
      "executing",
      "failed",
    ]);
    expect(second).toMatchObject({
      id: "exec-next",
      status: "completed",
      result: {
        ok: true,
        status: "success",
        output: { mode: "next" },
      },
    });
    expect(events).toEqual(["hang", "next"]);
  });

  it("returns partial result for timed-out watch executions without blocking the queue", async () => {
    let now = 2_000;
    const events: string[] = [];
    const registry = new ExternalToolRegistry();
    registry.register({
      manifest: {
        id: "moyin.provider",
        label: "Moyin",
        description: "Moyin provider.",
        source: "external",
        kind: "provider",
        providerId: "moyin",
        capabilities: [
          {
            id: "task.watch",
            label: "Watch task",
            readOnly: true,
            metadata: { lifecycle: "orchestrator-watch" },
          },
          { id: "health", label: "Health", readOnly: true },
        ],
      },
      check: () => ({ status: "ready", summary: "Ready." }),
      invoke: (request) => {
        events.push(String(request.operationId ?? ""));
        if (request.operationId === "task.watch") {
          return new Promise(() => undefined);
        }
        return { ok: true, content: "ready", output: { ok: true } };
      },
    });
    const queue = new ExternalToolExecutionQueue({
      registry,
      nowMs: () => now,
    });

    const first = queue.enqueue(
      {
        toolId: "moyin.provider",
        operationId: "task.watch",
        args: { taskId: "task-123", projectId: "project-1" },
        turnId: "turn-watch",
      },
      {
        executionId: "watch-task-123",
        timeoutMs: 1,
        metadata: { lifecycle: "orchestrator-watch" },
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 5));
    now = 2_500;
    const timedOut = await first;
    const second = await queue.enqueue(
      { toolId: "moyin.provider", operationId: "health", turnId: "turn-watch" },
      { executionId: "watch-next", timeoutMs: 1_000 },
    );

    expect(timedOut).toMatchObject({
      id: "watch-task-123",
      status: "yielded",
      error: expect.stringContaining("timed out"),
      result: {
        ok: false,
        status: "error",
        error: "external-tool-watch-timeout",
        metadata: expect.objectContaining({
          partial: true,
          timeoutMs: 1,
          lifecycle: "orchestrator-watch",
        }),
      },
    });
    expect(timedOut.timeline.map((entry) => entry.status)).toEqual([
      "queued",
      "executing",
      "yielded",
    ]);
    expect(second).toMatchObject({
      id: "watch-next",
      status: "completed",
      result: {
        ok: true,
        status: "success",
      },
    });
    expect(events).toEqual(["task.watch", "health"]);
  });

  it("resumes yielded watch executions through the orchestrator queue state", async () => {
    let now = 3_000;
    const calls: Array<Readonly<Record<string, unknown>>> = [];
    const registry = new ExternalToolRegistry();
    registry.register({
      manifest: {
        id: "moyin.provider",
        label: "Moyin",
        description: "Moyin provider.",
        source: "external",
        kind: "provider",
        providerId: "moyin",
        capabilities: [
          {
            id: "task.watch",
            label: "Watch task",
            readOnly: true,
            metadata: { lifecycle: "orchestrator-watch" },
          },
        ],
      },
      check: () => ({ status: "ready", summary: "Ready." }),
      invoke: (request) => {
        calls.push({
          operationId: request.operationId,
          args: request.args ?? {},
          metadata: request.metadata ?? {},
        });
        if (calls.length === 1) {
          return new Promise(() => undefined);
        }
        return {
          ok: true,
          content: "watch resumed",
          output: { resumed: true, args: request.args, metadata: request.metadata },
        };
      },
    });
    const queue = new ExternalToolExecutionQueue({
      registry,
      nowMs: () => now,
    });

    const first = queue.enqueue(
      {
        toolId: "moyin.provider",
        operationId: "task.watch",
        args: { taskId: "task-123", resumeToken: "resume-token-1" },
        metadata: { lifecycle: "orchestrator-watch" },
        turnId: "turn-watch",
      },
      {
        executionId: "watch-task-123",
        timeoutMs: 1,
        metadata: { lifecycle: "orchestrator-watch" },
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 5));
    now = 3_500;
    await expect(first).resolves.toMatchObject({
      id: "watch-task-123",
      status: "yielded",
      result: {
        metadata: expect.objectContaining({
          partial: true,
          lifecycle: "orchestrator-watch",
        }),
      },
    });

    const resumed = await queue.resumeWatch("watch-task-123", {
      executionId: "watch-task-123-resume",
      timeoutMs: 1_000,
    });

    expect(resumed).toMatchObject({
      id: "watch-task-123-resume",
      status: "completed",
      result: {
        ok: true,
        content: "watch resumed",
        output: {
          resumed: true,
          args: { taskId: "task-123", resumeToken: "resume-token-1" },
          metadata: {
            lifecycle: "orchestrator-watch",
            resumedFromExecutionId: "watch-task-123",
          },
        },
      },
      metadata: {
        lifecycle: "orchestrator-watch",
        resumedFromExecutionId: "watch-task-123",
      },
    });
    expect(calls).toEqual([
      {
        operationId: "task.watch",
        args: { taskId: "task-123", resumeToken: "resume-token-1" },
        metadata: expect.objectContaining({
          executionId: "watch-task-123",
          lifecycle: "orchestrator-watch",
        }),
      },
      {
        operationId: "task.watch",
        args: { taskId: "task-123", resumeToken: "resume-token-1" },
        metadata: expect.objectContaining({
          executionId: "watch-task-123-resume",
          lifecycle: "orchestrator-watch",
          resumedFromExecutionId: "watch-task-123",
        }),
      },
    ]);
  });

  it("retries safe read-only external tool failures with retry history and stop condition", async () => {
    let now = 3_000;
    const calls: number[] = [];
    const registry = new ExternalToolRegistry();
    registry.register({
      manifest: {
        id: "moyin.provider",
        label: "Moyin",
        description: "Moyin provider.",
        source: "external",
        kind: "provider",
        providerId: "moyin",
        capabilities: [{ id: "health", label: "Health", readOnly: true }],
      },
      check: () => ({ status: "ready", summary: "Ready." }),
      invoke: () => {
        calls.push(calls.length + 1);
        if (calls.length < 3) {
          return {
            ok: false,
            status: "unavailable",
            content: "Moyin control-plane is not ready.",
            error: "CONTROL_PLANE_NOT_FOUND",
            metadata: {
              error: {
                code: "CONTROL_PLANE_NOT_FOUND",
                safeRetry: {
                  strategy: "policy.exponential_backoff",
                  executor: "orchestrator",
                  maxAttempts: 3,
                  initialDelayMs: 0,
                },
                stopCondition: {
                  type: "max_attempts_reached",
                  threshold: 3,
                  action: "return_error_to_brain",
                },
              },
            },
          };
        }
        return { ok: true, content: "ready", output: { healthy: true } };
      },
    });
    const queue = new ExternalToolExecutionQueue({
      registry,
      nowMs: () => now++,
    });

    const result = await queue.enqueue(
      { toolId: "moyin.provider", operationId: "health", turnId: "turn-retry" },
      { executionId: "retry-health" },
    );

    expect(result).toMatchObject({
      id: "retry-health",
      status: "completed",
      result: {
        ok: true,
        status: "success",
        output: { healthy: true },
        metadata: expect.objectContaining({
          retryHistory: [
            expect.objectContaining({ attempt: 1, result: "failed" }),
            expect.objectContaining({ attempt: 2, result: "failed" }),
            expect.objectContaining({ attempt: 3, result: "succeeded" }),
          ],
          stopCondition: expect.objectContaining({
            action: "return_error_to_brain",
          }),
        }),
      },
    });
    expect(result.timeline.map((entry) => entry.status)).toEqual([
      "queued",
      "executing",
      "yielded",
      "yielded",
      "completed",
    ]);
    expect(calls).toEqual([1, 2, 3]);
  });

  it("does not automatically retry side-effectful external tool operations", async () => {
    const calls: string[] = [];
    const registry = new ExternalToolRegistry();
    registry.register({
      manifest: {
        id: "moyin.provider",
        label: "Moyin",
        description: "Moyin provider.",
        source: "external",
        kind: "provider",
        providerId: "moyin",
        capabilities: [
          {
            id: "sealed.submit",
            label: "Submit sealed request",
            readOnly: false,
            requiresApproval: true,
          },
        ],
      },
      check: () => ({ status: "ready", summary: "Ready." }),
      invoke: () => {
        calls.push("submit");
        return {
          ok: false,
          status: "error",
          content: "submit failed",
          error: "SUBMIT_FAILED",
          metadata: {
            error: {
              code: "SUBMIT_FAILED",
              safeRetry: {
                strategy: "policy.exponential_backoff",
                executor: "orchestrator",
                maxAttempts: 3,
                initialDelayMs: 0,
              },
            },
          },
        };
      },
    });
    const queue = new ExternalToolExecutionQueue({ registry });

    const result = await queue.enqueue(
      {
        toolId: "moyin.provider",
        operationId: "sealed.submit",
        turnId: "turn-submit",
        approval: { status: "approved", operatorId: "operator-1" },
        sandboxPreflight: {
          verdict: "allow",
          sandboxMode: "workspace-write",
          checkedAt: "2026-05-08T00:00:00.000Z",
          providerId: "moyin",
          reason: "approved fixture",
        },
        cwd: "/tmp/hotflow-runs/job-submit",
        sandboxPolicy: {
          defaultMutatingSandboxMode: "workspace-write",
          filesystemScope: ["/tmp/hotflow-runs"],
        },
        command: "moyin",
        args: { sealedRequestId: "sealed-1" },
      },
      { executionId: "submit-no-retry" },
    );

    expect(result).toMatchObject({
      id: "submit-no-retry",
      status: "completed",
      result: {
        ok: false,
        status: "error",
        error: "SUBMIT_FAILED",
        metadata: expect.not.objectContaining({
          retryHistory: expect.anything(),
        }),
      },
    });
    expect(calls).toEqual(["submit"]);
  });

  it("rejects queue admission when concurrency or resource policy is exceeded", async () => {
    let releaseFirst: (() => void) | undefined;
    const registry = new ExternalToolRegistry();
    registry.register({
      manifest: {
        id: "comfyui",
        label: "ComfyUI",
        description: "External ComfyUI provider.",
        source: "external",
        kind: "provider",
        providerId: "comfyui",
        capabilities: [{ id: "workflow.run", label: "Run workflow", readOnly: true }],
      },
      check: () => ({ status: "ready", summary: "Ready." }),
      invoke: () =>
        new Promise((resolve) => {
          releaseFirst = () => resolve({ ok: true, content: "done" });
        }),
    });
    const queue = new ExternalToolExecutionQueue({
      registry,
      concurrencyPolicy: {
        maxActiveExecutions: 1,
        maxActivePerProvider: { comfyui: 1 },
      },
      resourceLimits: {
        maxMemoryMb: 1024,
        maxDiskMb: 2048,
      },
    });

    const first = queue.enqueue(
      { toolId: "comfyui", operationId: "workflow.run", turnId: "turn-concurrency" },
      { executionId: "comfyui-running" },
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(releaseFirst).toBeDefined();
    const rejectedByConcurrency = await queue.enqueue(
      { toolId: "comfyui", operationId: "workflow.run", turnId: "turn-concurrency" },
      { executionId: "comfyui-rejected-concurrency" },
    );
    const rejectedByResource = await queue.enqueue(
      {
        toolId: "comfyui",
        operationId: "workflow.run",
        turnId: "turn-resource",
        metadata: {
          resourceEstimate: {
            memoryMb: 2048,
            diskMb: 64,
          },
        },
      },
      { executionId: "comfyui-rejected-resource" },
    );
    releaseFirst?.();
    const completedFirst = await first;

    expect(rejectedByConcurrency).toMatchObject({
      id: "comfyui-rejected-concurrency",
      status: "failed",
      result: {
        ok: false,
        status: "permission-denied",
        error: "external-tool-queue-limit-exceeded",
        metadata: expect.objectContaining({
          concurrencyPolicy: expect.objectContaining({
            maxActiveExecutions: 1,
            activeExecutions: 1,
          }),
        }),
      },
    });
    expect(rejectedByResource).toMatchObject({
      id: "comfyui-rejected-resource",
      status: "failed",
      result: {
        ok: false,
        status: "permission-denied",
        error: "RESOURCE_LIMIT_EXCEEDED",
        metadata: expect.objectContaining({
          resourceLimits: expect.objectContaining({
            maxMemoryMb: 1024,
          }),
          resourceEstimate: expect.objectContaining({
            memoryMb: 2048,
          }),
        }),
      },
    });
    expect(completedFirst).toMatchObject({
      id: "comfyui-running",
      status: "completed",
    });
  });
});

function createMinimalMp4Base64(): string {
  const ftypPayload = Buffer.concat([
    Buffer.from("isom", "ascii"),
    Buffer.from([0, 0, 0, 1]),
    Buffer.from("isommp42", "ascii"),
  ]);
  const mvhdPayload = Buffer.alloc(20);
  mvhdPayload.writeUInt32BE(0, 0);
  mvhdPayload.writeUInt32BE(0, 4);
  mvhdPayload.writeUInt32BE(0, 8);
  mvhdPayload.writeUInt32BE(1000, 12);
  mvhdPayload.writeUInt32BE(2000, 16);
  return Buffer.concat([
    createMp4Box("ftyp", ftypPayload),
    createMp4Box("moov", createMp4Box("mvhd", mvhdPayload)),
  ]).toString("base64");
}

function createMp4Box(type: string, payload: Buffer): Buffer {
  const box = Buffer.alloc(8 + payload.byteLength);
  box.writeUInt32BE(box.byteLength, 0);
  box.write(type, 4, 4, "ascii");
  payload.copy(box, 8);
  return box;
}

function createMinimalWavBase64(): string {
  const sampleRate = 8000;
  const channels = 1;
  const bitsPerSample = 16;
  const dataBytes = sampleRate * channels * (bitsPerSample / 8);
  const bytes = Buffer.alloc(44 + dataBytes);
  bytes.write("RIFF", 0, "ascii");
  bytes.writeUInt32LE(bytes.byteLength - 8, 4);
  bytes.write("WAVE", 8, "ascii");
  bytes.write("fmt ", 12, "ascii");
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(channels, 22);
  bytes.writeUInt32LE(sampleRate, 24);
  bytes.writeUInt32LE(sampleRate * channels * (bitsPerSample / 8), 28);
  bytes.writeUInt16LE(channels * (bitsPerSample / 8), 32);
  bytes.writeUInt16LE(bitsPerSample, 34);
  bytes.write("data", 36, "ascii");
  bytes.writeUInt32LE(dataBytes, 40);
  return bytes.toString("base64");
}

function createMinimalFlacBase64(): string {
  const sampleRate = 44100;
  const channels = 2;
  const bitsPerSample = 16;
  const totalSamples = sampleRate * 2;
  const streamInfo = Buffer.alloc(34);
  streamInfo.writeUInt16BE(4096, 0);
  streamInfo.writeUInt16BE(4096, 2);
  streamInfo.writeUIntBE(4096, 4, 3);
  streamInfo.writeUIntBE(4096, 7, 3);
  const streamInfoBits =
    (BigInt(sampleRate) << 44n) |
    (BigInt(channels - 1) << 41n) |
    (BigInt(bitsPerSample - 1) << 36n) |
    BigInt(totalSamples);
  streamInfo.writeBigUInt64BE(streamInfoBits, 10);

  const marker = Buffer.alloc(4);
  marker[0] = 0x80;
  marker.writeUIntBE(streamInfo.byteLength, 1, 3);
  return Buffer.concat([Buffer.from("fLaC", "ascii"), marker, streamInfo]).toString("base64");
}
