import type { PolicyRuntime, ToolApprovalContext } from "@hotflow/policy-runtime";

import type { ConversationRuntimePolicyDecisionEnvelope } from "./policy-envelope.js";
import { createExternalKnowledgeTransferPolicyEnvelope } from "./policy-envelope.js";
import type {
  ScheduledLearningExternalKnowledgeConnector,
  ScheduledLearningExternalKnowledgeMode,
} from "./scheduled-learning-policy.js";

export type ExternalKnowledgeConnectorId =
  | ScheduledLearningExternalKnowledgeConnector
  | "internal_knowledge";

export type ExternalKnowledgeTargetKind = "internal_knowledge" | "export_package" | "external_api";

export type ExternalKnowledgeConnectorToolName =
  | "external_knowledge.write_internal"
  | "external_knowledge.generate_upload_package"
  | "external_knowledge.call_external_api";

export interface ExternalKnowledgeConnectorManifest {
  readonly schemaVersion: "conversation-runtime.external-knowledge-connector-manifest.v1";
  readonly id: ExternalKnowledgeConnectorId;
  readonly displayName: string;
  readonly targetKind: ExternalKnowledgeTargetKind;
  readonly contracts: {
    readonly tools: readonly ExternalKnowledgeConnectorToolName[];
  };
  readonly toolMetadata: Readonly<
    Partial<
      Record<
        ExternalKnowledgeConnectorToolName,
        {
          readonly readOnly: boolean;
          readonly optional: boolean;
          readonly approvalBoundary:
            | "internal_write"
            | "package_only"
            | "external_api_requires_auth";
          readonly authSignals: readonly string[];
          readonly configSignals: readonly string[];
          readonly aliases: readonly string[];
        }
      >
    >
  >;
}

export interface ExternalKnowledgeConnectorStrategy {
  readonly connectorId: ExternalKnowledgeConnectorId;
  readonly displayName: string;
  readonly targetKind: ExternalKnowledgeTargetKind;
  readonly stableApi: boolean;
  readonly requiresAuth: boolean;
  readonly uploadPackageRequired: boolean;
  readonly supportedModes: readonly ScheduledLearningExternalKnowledgeMode[];
  readonly operations: readonly string[];
  readonly checklist: readonly string[];
  readonly manifest: ExternalKnowledgeConnectorManifest;
}

export interface CreateExternalKnowledgeTransferPlanInput {
  readonly connectors: readonly ExternalKnowledgeConnectorId[];
  readonly mode: ScheduledLearningExternalKnowledgeMode;
  readonly source: {
    readonly title?: string;
    readonly sourceRef?: string;
    readonly artifactIds?: readonly string[];
    readonly evidenceRefIds?: readonly string[];
    readonly textCharacterCount?: number;
    readonly mediaUnderstandingStatus?: string;
  };
}

export interface CreateGovernedExternalKnowledgeTransferPlanInput
  extends CreateExternalKnowledgeTransferPlanInput {
  readonly actor?: string;
  readonly approvalByConnectorId?: Readonly<
    Partial<Record<ExternalKnowledgeConnectorId, ToolApprovalContext>>
  >;
  readonly policyRuntime?: Pick<PolicyRuntime, "decide">;
  readonly nowMs?: () => number;
}

export interface ExternalKnowledgeUploadPackageFile {
  readonly path: string;
  readonly kind: "json" | "markdown" | "directory";
  readonly description: string;
}

export interface ExternalKnowledgeUploadPackageManifest {
  readonly sourceTitle?: string;
  readonly sourceRef?: string;
  readonly artifactIds: readonly string[];
  readonly evidenceRefIds: readonly string[];
  readonly textCharacterCount?: number;
  readonly mediaUnderstandingStatus?: string;
  readonly mediaContentAdmitted: boolean;
  readonly mode: ScheduledLearningExternalKnowledgeMode;
}

export interface ExternalKnowledgeUploadPackagePlan {
  readonly schemaVersion: "conversation-runtime.external-knowledge-upload-package.v1";
  readonly connectorId: ExternalKnowledgeConnectorId;
  readonly packageId: string;
  readonly syncStatus: "not_synced_pending_user_upload";
  readonly files: readonly ExternalKnowledgeUploadPackageFile[];
  readonly manifest: ExternalKnowledgeUploadPackageManifest;
  readonly indexMarkdown: string;
  readonly operationChecklist: readonly string[];
}

export interface ExternalKnowledgeTransferTarget {
  readonly connectorId: ExternalKnowledgeConnectorId;
  readonly displayName: string;
  readonly targetKind: ExternalKnowledgeTargetKind;
  readonly stableApi: boolean;
  readonly requiresAuth: boolean;
  readonly uploadPackageRequired: boolean;
  readonly mode: ScheduledLearningExternalKnowledgeMode;
  readonly operations: readonly string[];
  readonly checklist: readonly string[];
  readonly manifest: ExternalKnowledgeConnectorManifest;
  readonly uploadPackagePlan?: ExternalKnowledgeUploadPackagePlan;
}

export interface ExternalKnowledgeTransferAdmission {
  readonly canExecute: boolean;
  readonly reason: string;
}

export interface GovernedExternalKnowledgeTransferTarget extends ExternalKnowledgeTransferTarget {
  readonly policyEnvelope: ConversationRuntimePolicyDecisionEnvelope;
  readonly transferAdmission: ExternalKnowledgeTransferAdmission;
}

export interface ExternalKnowledgeTransferPlan {
  readonly schemaVersion: "conversation-runtime.external-knowledge-transfer-plan.v1";
  readonly mode: ScheduledLearningExternalKnowledgeMode;
  readonly source: {
    readonly title?: string;
    readonly sourceRef?: string;
    readonly artifactIds: readonly string[];
  };
  readonly targets: readonly ExternalKnowledgeTransferTarget[];
  readonly summary: string;
}

export interface GovernedExternalKnowledgeTransferPlan
  extends Omit<ExternalKnowledgeTransferPlan, "schemaVersion" | "targets"> {
  readonly schemaVersion: "conversation-runtime.governed-external-knowledge-transfer-plan.v1";
  readonly targets: readonly GovernedExternalKnowledgeTransferTarget[];
}

export function resolveExternalKnowledgeConnectorStrategy(
  connectorId: ExternalKnowledgeConnectorId,
): ExternalKnowledgeConnectorStrategy {
  const normalized = normalizeConnectorId(connectorId);
  if (normalized === "internal_knowledge") {
    return {
      connectorId: normalized,
      displayName: "内部知识库",
      targetKind: "internal_knowledge",
      stableApi: true,
      requiresAuth: false,
      uploadPackageRequired: false,
      supportedModes: ["sync_summary", "sync_clean_text", "sync_original_files"],
      operations: ["write_internal_knowledge"],
      checklist: ["写入内部知识库前保留来源 URL、正文长度、媒体授权状态和 artifact id。"],
      manifest: createExternalKnowledgeConnectorManifest({
        connectorId: normalized,
        displayName: "内部知识库",
        targetKind: "internal_knowledge",
        toolName: "external_knowledge.write_internal",
        approvalBoundary: "internal_write",
        readOnly: false,
      }),
    };
  }
  if (normalized === "notion") {
    return {
      connectorId: normalized,
      displayName: "Notion",
      targetKind: "external_api",
      stableApi: true,
      requiresAuth: true,
      uploadPackageRequired: false,
      supportedModes: ["sync_summary", "sync_clean_text"],
      operations: ["call_external_api"],
      checklist: [
        "确认 Notion token 和目标 database/page。",
        "同步正文摘要或清洗正文，不上传未授权媒体内容。",
      ],
      manifest: createExternalKnowledgeConnectorManifest({
        connectorId: normalized,
        displayName: "Notion",
        targetKind: "external_api",
        toolName: "external_knowledge.call_external_api",
        approvalBoundary: "external_api_requires_auth",
        readOnly: false,
        authSignals: ["notion_token", "notion_database_or_page"],
        configSignals: ["target_database_id", "target_page_id"],
      }),
    };
  }
  if (normalized === "feishu") {
    return {
      connectorId: normalized,
      displayName: "飞书",
      targetKind: "external_api",
      stableApi: true,
      requiresAuth: true,
      uploadPackageRequired: false,
      supportedModes: ["sync_summary", "sync_clean_text"],
      operations: ["call_external_api"],
      checklist: ["确认飞书应用凭据和目标文档。", "把媒体理解状态作为单独字段写入。"],
      manifest: createExternalKnowledgeConnectorManifest({
        connectorId: normalized,
        displayName: "飞书",
        targetKind: "external_api",
        toolName: "external_knowledge.call_external_api",
        approvalBoundary: "external_api_requires_auth",
        readOnly: false,
        authSignals: ["feishu_app_id", "feishu_app_secret"],
        configSignals: ["target_document_id"],
      }),
    };
  }
  if (normalized === "obsidian") {
    return createExportPackageStrategy({
      connectorId: normalized,
      displayName: "Obsidian",
      checklist: [
        "生成 Markdown 文件和附件清单。",
        "由用户放入目标 vault，未授权媒体只写链接清单。",
      ],
    });
  }
  if (normalized === "notebooklm") {
    return createExportPackageStrategy({
      connectorId: normalized,
      displayName: "NotebookLM",
      checklist: [
        "生成待上传包。",
        "用户手动上传到 NotebookLM source；没有稳定 API 时不自动操作页面。",
      ],
    });
  }
  if (normalized === "ima") {
    return createExportPackageStrategy({
      connectorId: normalized,
      displayName: "ima",
      checklist: ["生成待上传包和操作清单。", "没有稳定 API 时只产出包，不声称已同步。"],
    });
  }
  return createExportPackageStrategy({
    connectorId: "custom",
    displayName: "自定义连接器",
    checklist: ["生成标准导出包。", "由外部适配器或人工上传到目标知识库。"],
  });
}

export function createExternalKnowledgeTransferPlan(
  input: CreateExternalKnowledgeTransferPlanInput,
): ExternalKnowledgeTransferPlan {
  const targets = [...new Set(input.connectors.map(normalizeConnectorId))].map((connectorId) => {
    const strategy = resolveExternalKnowledgeConnectorStrategy(connectorId);
    const mode = strategy.supportedModes.includes(input.mode) ? input.mode : "sync_summary";
    const uploadPackagePlan = strategy.uploadPackageRequired
      ? createExternalKnowledgeUploadPackagePlan({
          connectorId: strategy.connectorId,
          mode,
          source: input.source,
          operationChecklist: strategy.checklist,
        })
      : undefined;
    return {
      connectorId: strategy.connectorId,
      displayName: strategy.displayName,
      targetKind: strategy.targetKind,
      stableApi: strategy.stableApi,
      requiresAuth: strategy.requiresAuth,
      uploadPackageRequired: strategy.uploadPackageRequired,
      mode,
      operations: strategy.operations,
      checklist: strategy.checklist,
      manifest: strategy.manifest,
      ...(uploadPackagePlan === undefined ? {} : { uploadPackagePlan }),
    };
  });
  return {
    schemaVersion: "conversation-runtime.external-knowledge-transfer-plan.v1",
    mode: input.mode,
    source: {
      ...(input.source.title === undefined ? {} : { title: input.source.title }),
      ...(input.source.sourceRef === undefined ? {} : { sourceRef: input.source.sourceRef }),
      artifactIds: [...(input.source.artifactIds ?? [])],
    },
    targets,
    summary: summarizeExternalKnowledgeTargets(targets),
  };
}

export async function createGovernedExternalKnowledgeTransferPlan(
  input: CreateGovernedExternalKnowledgeTransferPlanInput,
): Promise<GovernedExternalKnowledgeTransferPlan> {
  const basePlan = createExternalKnowledgeTransferPlan(input);
  const targets = await Promise.all(
    basePlan.targets.map(async (target) => {
      const operation = resolveExternalKnowledgePolicyOperation(target);
      const policyEnvelope = await createExternalKnowledgeTransferPolicyEnvelope({
        connectorId: target.connectorId,
        targetKind: target.targetKind,
        operation,
        ...(basePlan.source.sourceRef === undefined
          ? {}
          : { resourceRef: basePlan.source.sourceRef }),
        ...(input.actor === undefined ? {} : { actor: input.actor }),
        mode: target.mode,
        evidenceRefIds: input.source.evidenceRefIds ?? [],
        ...(input.approvalByConnectorId?.[target.connectorId] === undefined
          ? {}
          : { approval: input.approvalByConnectorId[target.connectorId] }),
        ...(input.policyRuntime === undefined ? {} : { policyRuntime: input.policyRuntime }),
        ...(input.nowMs === undefined ? {} : { nowMs: input.nowMs }),
      });
      return {
        ...target,
        policyEnvelope,
        transferAdmission: createExternalKnowledgeTransferAdmission(policyEnvelope),
      };
    }),
  );
  return {
    schemaVersion: "conversation-runtime.governed-external-knowledge-transfer-plan.v1",
    mode: basePlan.mode,
    source: basePlan.source,
    targets,
    summary: summarizeExternalKnowledgeTargets(targets),
  };
}

export function createExternalKnowledgeUploadPackagePlan(input: {
  readonly connectorId: ExternalKnowledgeConnectorId;
  readonly mode: ScheduledLearningExternalKnowledgeMode;
  readonly source: CreateExternalKnowledgeTransferPlanInput["source"];
  readonly operationChecklist?: readonly string[];
}): ExternalKnowledgeUploadPackagePlan {
  const connectorId = normalizeConnectorId(input.connectorId);
  const manifest: ExternalKnowledgeUploadPackageManifest = {
    ...(input.source.title === undefined ? {} : { sourceTitle: input.source.title }),
    ...(input.source.sourceRef === undefined ? {} : { sourceRef: input.source.sourceRef }),
    artifactIds: [...(input.source.artifactIds ?? [])],
    evidenceRefIds: [...(input.source.evidenceRefIds ?? [])],
    ...(input.source.textCharacterCount === undefined
      ? {}
      : { textCharacterCount: input.source.textCharacterCount }),
    ...(input.source.mediaUnderstandingStatus === undefined
      ? {}
      : { mediaUnderstandingStatus: input.source.mediaUnderstandingStatus }),
    mediaContentAdmitted: input.source.mediaUnderstandingStatus === "understood",
    mode: input.mode,
  };
  return {
    schemaVersion: "conversation-runtime.external-knowledge-upload-package.v1",
    connectorId,
    packageId: createExternalKnowledgePackageId(connectorId, input.source),
    syncStatus: "not_synced_pending_user_upload",
    files: [
      {
        path: "manifest.json",
        kind: "json",
        description: "导出包清单，记录来源、证据、正文长度和媒体理解状态。",
      },
      {
        path: "index.md",
        kind: "markdown",
        description: "给目标知识库或人工上传使用的入口索引。",
      },
      {
        path: "evidence/source.md",
        kind: "markdown",
        description: "文本来源、artifact 和正文证据摘要。",
      },
      {
        path: "evidence/media.md",
        kind: "markdown",
        description: "媒体清单和授权状态；未理解媒体不能写成内容结论。",
      },
    ],
    manifest,
    indexMarkdown: renderExternalKnowledgeUploadPackageIndex({
      connectorId,
      manifest,
    }),
    operationChecklist: [
      ...normalizeChecklist(input.operationChecklist),
      "手动上传导出包到目标知识库后，再把目标侧链接回填到运行记录。",
    ],
  };
}

function createExportPackageStrategy(input: {
  readonly connectorId: ExternalKnowledgeConnectorId;
  readonly displayName: string;
  readonly checklist: readonly string[];
}): ExternalKnowledgeConnectorStrategy {
  return {
    connectorId: input.connectorId,
    displayName: input.displayName,
    targetKind: "export_package",
    stableApi: false,
    requiresAuth: false,
    uploadPackageRequired: true,
    supportedModes: ["sync_summary", "sync_clean_text", "sync_original_files"],
    operations: ["generate_upload_package"],
    checklist: input.checklist,
    manifest: createExternalKnowledgeConnectorManifest({
      connectorId: input.connectorId,
      displayName: input.displayName,
      targetKind: "export_package",
      toolName: "external_knowledge.generate_upload_package",
      approvalBoundary: "package_only",
      readOnly: true,
    }),
  };
}

function createExternalKnowledgeConnectorManifest(input: {
  readonly connectorId: ExternalKnowledgeConnectorId;
  readonly displayName: string;
  readonly targetKind: ExternalKnowledgeTargetKind;
  readonly toolName: ExternalKnowledgeConnectorToolName;
  readonly approvalBoundary: "internal_write" | "package_only" | "external_api_requires_auth";
  readonly readOnly: boolean;
  readonly authSignals?: readonly string[];
  readonly configSignals?: readonly string[];
}): ExternalKnowledgeConnectorManifest {
  return {
    schemaVersion: "conversation-runtime.external-knowledge-connector-manifest.v1",
    id: input.connectorId,
    displayName: input.displayName,
    targetKind: input.targetKind,
    contracts: {
      tools: [input.toolName],
    },
    toolMetadata: {
      [input.toolName]: {
        readOnly: input.readOnly,
        optional: input.targetKind !== "internal_knowledge",
        approvalBoundary: input.approvalBoundary,
        authSignals: [...(input.authSignals ?? [])],
        configSignals: [...(input.configSignals ?? [])],
        aliases: createExternalKnowledgeToolAliases(input.connectorId, input.toolName),
      },
    } as ExternalKnowledgeConnectorManifest["toolMetadata"],
  };
}

function createExternalKnowledgeToolAliases(
  connectorId: ExternalKnowledgeConnectorId,
  toolName: ExternalKnowledgeConnectorToolName,
): readonly string[] {
  return [`${connectorId}.${toolName.split(".").at(-1) ?? toolName}`];
}

function normalizeChecklist(value: readonly string[] | undefined): readonly string[] {
  return [...new Set((value ?? []).map((item) => item.trim()).filter((item) => item.length > 0))];
}

function createExternalKnowledgePackageId(
  connectorId: ExternalKnowledgeConnectorId,
  source: CreateExternalKnowledgeTransferPlanInput["source"],
): string {
  const base =
    slugifyExternalKnowledgePackagePart(readSourceRefPackageName(source.sourceRef)) ??
    slugifyExternalKnowledgePackagePart(source.title) ??
    slugifyExternalKnowledgePackagePart(source.artifactIds?.[0]) ??
    "knowledge-export";
  return `${connectorId}-${base}`;
}

function readSourceRefPackageName(sourceRef: string | undefined): string | undefined {
  if (sourceRef === undefined) {
    return undefined;
  }
  try {
    const url = new URL(sourceRef);
    const host = url.hostname.replace(/^www\./iu, "");
    const pathParts = url.pathname
      .split("/")
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    return [host, ...pathParts].join("-");
  } catch {
    return sourceRef;
  }
}

function slugifyExternalKnowledgePackagePart(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const slug = value
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/giu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 80);
  return slug.length > 0 ? slug : undefined;
}

function renderExternalKnowledgeUploadPackageIndex(input: {
  readonly connectorId: ExternalKnowledgeConnectorId;
  readonly manifest: ExternalKnowledgeUploadPackageManifest;
}): string {
  const lines = [
    "# External Knowledge Upload Package",
    "",
    `- Connector: ${input.connectorId}`,
    `- Mode: ${input.manifest.mode}`,
    `- Source: ${input.manifest.sourceRef ?? "unknown"}`,
    `- Artifacts: ${input.manifest.artifactIds.join(", ") || "none"}`,
    `- Evidence refs: ${input.manifest.evidenceRefIds.join(", ") || "none"}`,
    `- Text characters: ${input.manifest.textCharacterCount ?? "unknown"}`,
    `- Media understanding: ${input.manifest.mediaUnderstandingStatus ?? "unknown"}`,
    `- Media content admitted: ${input.manifest.mediaContentAdmitted ? "yes" : "no"}`,
    "",
    "## Files",
    "",
    "- `manifest.json`",
    "- `evidence/source.md`",
    "- `evidence/media.md`",
  ];
  return lines.join("\n");
}

function summarizeExternalKnowledgeTargets(
  targets: readonly ExternalKnowledgeTransferTarget[],
): string {
  const internal = targets.filter((target) => target.targetKind === "internal_knowledge").length;
  const exportPackage = targets.filter((target) => target.targetKind === "export_package").length;
  const externalApi = targets.filter((target) => target.targetKind === "external_api").length;
  return `targets=${targets.length} internal=${internal} export_package=${exportPackage} external_api=${externalApi}`;
}

function resolveExternalKnowledgePolicyOperation(
  target: ExternalKnowledgeTransferTarget,
): ExternalKnowledgeConnectorToolName {
  const [operation] = target.manifest.contracts.tools;
  if (operation !== undefined) {
    return operation;
  }
  if (target.targetKind === "external_api") {
    return "external_knowledge.call_external_api";
  }
  if (target.targetKind === "internal_knowledge") {
    return "external_knowledge.write_internal";
  }
  return "external_knowledge.generate_upload_package";
}

function createExternalKnowledgeTransferAdmission(
  policyEnvelope: ConversationRuntimePolicyDecisionEnvelope,
): ExternalKnowledgeTransferAdmission {
  if (policyEnvelope.decision.verdict === "allow") {
    return {
      canExecute: true,
      reason: "policy_decision_allows_transfer",
    };
  }
  return {
    canExecute: false,
    reason: "policy_decision_must_be_allow_before_transfer",
  };
}

function normalizeConnectorId(
  connectorId: ExternalKnowledgeConnectorId,
): ExternalKnowledgeConnectorId {
  return connectorId.trim().toLocaleLowerCase() as ExternalKnowledgeConnectorId;
}
