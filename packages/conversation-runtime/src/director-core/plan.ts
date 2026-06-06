import type {
  DirectorContext,
  DirectorControlResult,
  ExecutionPlan,
  ReviewStatus,
} from "@hotflow/director-core";

export type DirectorConsoleRiskLevel = "low" | "medium" | "high";
export type DirectorConsoleDecisionActionId =
  | "accept_and_generate"
  | "accept_mode_model"
  | "ignore_and_continue"
  | "rerun_director";

export interface DirectorConsoleRecommendation {
  mode: {
    id: string;
    reason: string;
  };
  model: {
    imageBindingId: string | null;
    videoBindingId: string | null;
    reason: string;
  };
}

export interface DirectorConsoleReviewGate {
  id: string;
  label: string;
  status: ReviewStatus;
  score: number;
  reason: string;
  requiredFix: string | null;
}

export interface DirectorConsoleDecisionAction {
  id: DirectorConsoleDecisionActionId;
  label: string;
  enabled: boolean;
  requiresConfirmation: boolean;
}

export interface DirectorConsoleProjection {
  title: string;
  summary: string;
  status: DirectorControlResult["status"];
  recommendation: DirectorConsoleRecommendation;
  reviewGates: DirectorConsoleReviewGate[];
  risk: {
    level: DirectorConsoleRiskLevel;
    flags: string[];
  };
  lockImpact: {
    touchesUserLocks: boolean;
    lockedFields: string[];
  };
  executionPreview: {
    selectedGenerationStyle: string;
    selectedGenerationType: string;
    selectedImageBinding: string | null;
    selectedVideoBinding: string | null;
    hiddenPromptEnhanced: boolean;
    willTouchUserLocks: boolean;
    handoffStatus: string | null;
  };
  manualConfirmationRequired: boolean;
  autoApplyAllowed: boolean;
  blockingReasons: string[];
  decisionActions: DirectorConsoleDecisionAction[];
}

const REVIEW_GATE_LABELS = Object.freeze({
  runtime: "运行环境",
  alignment: "目标对齐",
  continuity: "连戏连续性",
  binding: "模型路由",
  locks: "用户锁定",
});

function resolveRiskLevel(control: DirectorControlResult): DirectorConsoleRiskLevel {
  if (control.review.overallDecision === "block" || control.plan.status === "blocked") {
    return "high";
  }
  if (
    control.review.overallDecision === "warn" ||
    control.plan.status === "review_required" ||
    control.plan.riskFlags.length > 0
  ) {
    return "medium";
  }
  return "low";
}

function hasBlockingDecision(control: DirectorControlResult): boolean {
  return control.review.overallDecision === "block" || control.plan.status === "blocked";
}

function collectLockedFields(context: DirectorContext, control: DirectorControlResult): string[] {
  const fields = new Set<string>();
  for (const lock of context.locks?.lockedFields ?? []) {
    fields.add(lock.field);
  }
  for (const constraint of control.alignmentLock.lockedConstraints) {
    if (constraint.source === "user_lock") {
      fields.add(constraint.field);
    }
  }
  return [...fields];
}

function buildDecisionActions(params: {
  blocked: boolean;
  requiresConfirmation: boolean;
}): DirectorConsoleDecisionAction[] {
  return [
    {
      id: "accept_and_generate",
      label: "接受导演计划并生成",
      enabled: !params.blocked,
      requiresConfirmation: params.requiresConfirmation,
    },
    {
      id: "accept_mode_model",
      label: "只接受模式/模型建议",
      enabled: !params.blocked,
      requiresConfirmation: params.requiresConfirmation,
    },
    {
      id: "ignore_and_continue",
      label: "忽略导演建议继续原链路",
      enabled: true,
      requiresConfirmation: params.blocked || params.requiresConfirmation,
    },
    {
      id: "rerun_director",
      label: "重新运行总导演",
      enabled: true,
      requiresConfirmation: false,
    },
  ];
}

function formatModelRecommendationReason(params: {
  coreReason: string;
  imageBindingId: string | null;
  videoBindingId: string | null;
}): string {
  const modelParts = [
    params.videoBindingId ? `视频 ${params.videoBindingId}` : null,
    params.imageBindingId ? `图片 ${params.imageBindingId}` : null,
  ].filter(Boolean);
  if (modelParts.length === 0) {
    return params.coreReason;
  }
  return `${params.coreReason} 推荐模型：${modelParts.join("，")}。`;
}

export function buildDirectorConsoleProjection(params: {
  context: DirectorContext;
  control: DirectorControlResult;
  executionPlan: ExecutionPlan;
}): DirectorConsoleProjection {
  const lockedFields = collectLockedFields(params.context, params.control);
  const touchesUserLocks = lockedFields.length > 0;
  const blocked = hasBlockingDecision(params.control);
  const manualConfirmationRequired =
    blocked || touchesUserLocks || params.control.review.overallDecision === "warn";
  const selectedVideo = params.control.plan.modelRoutingDecision.selectedVideoBinding;
  const selectedImage = params.control.plan.modelRoutingDecision.selectedImageBinding;

  return {
    title: "总导演计划",
    summary: `${params.context.project.title ?? params.context.request.projectId} · ${params.context.group.groupId}`,
    status: params.control.status,
    recommendation: {
      mode: {
        id: params.control.plan.modeDecision.selectedGenerationStyle,
        reason: params.control.plan.modeDecision.whySelected,
      },
      model: {
        imageBindingId: selectedImage,
        videoBindingId: selectedVideo,
        reason: formatModelRecommendationReason({
          coreReason: params.control.plan.modelRoutingDecision.whySelected,
          imageBindingId: selectedImage,
          videoBindingId: selectedVideo,
        }),
      },
    },
    reviewGates: params.control.review.gates.map((gate) => ({
      id: gate.gate,
      label: REVIEW_GATE_LABELS[gate.gate] ?? gate.gate,
      status: gate.status,
      score: gate.score,
      reason: gate.reason,
      requiredFix: gate.requiredFix ?? null,
    })),
    risk: {
      level: resolveRiskLevel(params.control),
      flags: [...params.control.plan.riskFlags],
    },
    lockImpact: {
      touchesUserLocks,
      lockedFields,
    },
    executionPreview: {
      selectedGenerationStyle: params.executionPlan.selectedGenerationStyle,
      selectedGenerationType: params.executionPlan.selectedGenerationType,
      selectedImageBinding: params.executionPlan.selectedImageBinding,
      selectedVideoBinding: params.executionPlan.selectedVideoBinding,
      hiddenPromptEnhanced: Boolean(params.executionPlan.prompt.hidden),
      willTouchUserLocks: touchesUserLocks,
      handoffStatus: params.control.handoffEnvelope?.status ?? null,
    },
    manualConfirmationRequired,
    autoApplyAllowed: !manualConfirmationRequired,
    blockingReasons: [...params.control.review.blockingReasons],
    decisionActions: buildDecisionActions({
      blocked,
      requiresConfirmation: manualConfirmationRequired,
    }),
  };
}
