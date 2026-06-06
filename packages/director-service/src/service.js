import { buildDirectorControlResult, buildExecutionPlan } from "@hotflow/director-core";
import { DIRECTOR_HOST_API_VERSION } from "@hotflow/director-host-contracts";
import { recallPublishedKnowledge as buildPublishedKnowledgeRecallPacket } from "@hotflow/director-knowledge";
import { DIRECTOR_OBSERVATION_SCHEMA_ID } from "@hotflow/director-runtime";
import { materializeSnapshot } from "./materializer.js";
export class DirectorService {
  options;
  constructor(options = {}) {
    this.options = options;
  }
  async evaluateSnapshot(request) {
    const normalizedInput = this.normalizeInput(request);
    const recall = await this.recallMemory(normalizedInput);
    const publishedKnowledgeRecall = await this.recallPublishedKnowledge(normalizedInput);
    const enrichedInput = applyPublishedKnowledgeSignals(normalizedInput, publishedKnowledgeRecall);
    const recallContext = materializeRecall(recall, publishedKnowledgeRecall);
    const coreControl = buildDirectorControlResult(enrichedInput.context);
    const runtimeCapabilitySnapshot = await this.captureRuntimeCapabilitySnapshot(
      enrichedInput,
      coreControl.capabilitySnapshot,
    );
    const alignmentAssessment = this.assessAlignment(enrichedInput, coreControl.clarification);
    const alignmentLock = this.lockAlignment(
      enrichedInput,
      coreControl.alignmentLock,
      alignmentAssessment,
    );
    const review = this.buildReview(
      enrichedInput,
      runtimeCapabilitySnapshot,
      alignmentLock,
      coreControl,
      recallContext,
    );
    const crewAssignments = this.buildCrewAssignments(
      enrichedInput,
      runtimeCapabilitySnapshot,
      alignmentLock,
      review,
      coreControl.blueprint,
      recallContext,
    );
    const actionGraph = this.buildActionGraph(
      enrichedInput,
      review,
      crewAssignments,
      runtimeCapabilitySnapshot,
    );
    const executionHandoffEnvelope = this.buildExecutionHandoffEnvelope(
      enrichedInput,
      alignmentLock,
      review,
      actionGraph,
      recallContext,
    );
    const observation = this.buildEvaluationObservation(
      enrichedInput,
      runtimeCapabilitySnapshot,
      review,
      actionGraph,
      recall,
      publishedKnowledgeRecall,
    );
    const response = this.toEvaluateResponse(review, actionGraph, executionHandoffEnvelope);
    this.appendObservation(observation);
    return {
      normalizedInput,
      runtimeCapabilitySnapshot,
      alignmentAssessment,
      alignmentLock,
      review,
      crewAssignments,
      actionGraph,
      executionHandoffEnvelope,
      context: enrichedInput.context,
      plan: review.plan,
      executionPlan: review.executionPlan,
      reviewReport: review.reviewReport,
      recall,
      publishedKnowledgeRecall,
      observation,
      response,
    };
  }
  async recordOutcome(request, input) {
    const observation = this.buildOutcomeObservation(request, input.runtimeId);
    this.appendObservation(observation);
    return {
      stored: true,
      observation,
    };
  }
  async listKnowledgePacks(
    _request = {
      apiVersion: DIRECTOR_HOST_API_VERSION,
    },
  ) {
    const knowledgePacks = this.options.knowledgeStore
      ? (await this.options.knowledgeStore.listPublished()).map((record) =>
          this.toKnowledgePackEntry(record),
        )
      : [];
    return {
      apiVersion: DIRECTOR_HOST_API_VERSION,
      knowledgePacks,
    };
  }
  async getRuntimeSummary(input) {
    const knowledgeCatalog = await this.listKnowledgePacks();
    return {
      apiVersion: DIRECTOR_HOST_API_VERSION,
      runtimeId: input.runtimeId,
      status: input.status ?? (input.availableProviders.length > 0 ? "ready" : "degraded"),
      workspaceRoot: input.workspaceRoot,
      dataDir: input.dataDir,
      defaultProvider: input.defaultProvider,
      defaultModel: input.defaultModel,
      availableProviders: [...input.availableProviders],
      knowledgePackCount: knowledgeCatalog.knowledgePacks.length,
      notes: input.notes
        ? [...input.notes]
        : ["Director host API is ready for Beta-1 control-kernel preflight."],
    };
  }
  nowIso() {
    return this.options.now?.() ?? new Date().toISOString();
  }
  async recallMemory(normalizedInput) {
    const request = {
      workingContext: this.buildWorkingContext(normalizedInput),
      recallHints: this.buildRecallHints(normalizedInput),
    };
    if (this.options.memoryRecall === undefined) {
      return {
        status: "disabled",
        knowledgePacks: [],
        hits: [],
        notes: ["Memory recall port is not configured for Director Angel Beta-1."],
      };
    }
    try {
      const result = await this.options.memoryRecall.recall(request);
      return {
        status: result.status,
        knowledgePacks: result.knowledgePacks.map((pack) => ({
          knowledgePackId: pack.knowledgePackId,
          ...(pack.title === undefined ? {} : { title: pack.title }),
          ...(pack.version === undefined ? {} : { version: pack.version }),
          ...(pack.tags === undefined ? {} : { tags: [...pack.tags] }),
          ...(pack.reason === undefined ? {} : { reason: pack.reason }),
        })),
        hits: (result.hits ?? []).map((hit) => ({
          recordId: hit.recordId,
          summary: hit.summary,
          status: hit.status,
          recordedAt: hit.recordedAt,
          score: hit.score,
          reasons: [...hit.reasons],
          selectedAdapters: [...hit.selectedAdapters],
          provenance: {
            runId: hit.provenance.runId,
            reportId: hit.provenance.reportId,
            observationIds: [...hit.provenance.observationIds],
          },
        })),
        notes: [...result.notes],
      };
    } catch (error) {
      return {
        status: "degraded",
        knowledgePacks: [],
        hits: [],
        notes: [
          `Memory recall degraded safely: ${error instanceof Error ? error.message : "unknown error"}.`,
        ],
      };
    }
  }
  buildWorkingContext(normalizedInput) {
    const { context } = normalizedInput;
    return {
      snapshotId: normalizedInput.snapshotId,
      runtimeId: context.runtime.runtimeId,
      operatorId: normalizedInput.operatorId,
      goal: normalizedInput.goal,
      projectLabel: normalizedInput.projectLabel,
      projectId: context.request.projectId,
      groupId: context.request.groupId,
      generationType: context.group.generationType,
      ...(context.group.generationStyle === undefined
        ? {}
        : { generationStyle: context.group.generationStyle }),
      sceneCount: context.group.sceneCount,
      ...(context.project.continuityPriority === undefined
        ? {}
        : { continuityPriority: context.project.continuityPriority }),
      anchorIds: [...context.group.anchorIds],
    };
  }
  buildRecallHints(normalizedInput) {
    const { context } = normalizedInput;
    return {
      preferredBindings: dedupeStrings(
        [context.intent.preferredImageBinding, context.intent.preferredVideoBinding].filter(
          (binding) => binding !== undefined,
        ),
      ),
      requiredBindings: dedupeStrings(
        [context.intent.requiredImageBinding, context.intent.requiredVideoBinding].filter(
          (binding) => binding !== undefined,
        ),
      ),
      fallbackBindings: dedupeStrings(context.intent.fallbackBindings ?? []),
      continuityAnchorIds: [...context.group.anchorIds],
      knowledgeSignalTags: dedupeStrings(
        (context.knowledgeSignals ?? []).flatMap((signal) => signal.tags),
      ),
      deliverables: [normalizedInput.goal],
    };
  }
  buildEvaluationObservation(
    normalizedInput,
    runtimeCapabilitySnapshot,
    review,
    actionGraph,
    recall,
    publishedKnowledgeRecall,
  ) {
    const recordedAt = this.nowIso();
    return {
      schemaId: DIRECTOR_OBSERVATION_SCHEMA_ID,
      observationId: buildObservationId("evaluation", normalizedInput.snapshotId, recordedAt),
      recordedAt,
      source: "evaluation",
      snapshotId: normalizedInput.snapshotId,
      runtimeId: runtimeCapabilitySnapshot.runtimeId,
      workingContext: this.buildWorkingContext(normalizedInput),
      recallHints: this.buildRecallHints(normalizedInput),
      recalledKnowledgePacks: mergeKnowledgePackRefs(recall, publishedKnowledgeRecall),
      recallStatus: deriveObservationRecallStatus(recall, publishedKnowledgeRecall),
      recallNotes: mergeRecallNotes(recall, publishedKnowledgeRecall),
      evaluation: {
        decision: review.decision,
        actionGraphReadiness: actionGraph.readiness,
        selectedAdapters: dedupeStrings(
          [
            runtimeCapabilitySnapshot.selectedImageAdapter,
            runtimeCapabilitySnapshot.selectedVideoAdapter,
          ].filter((adapterId) => adapterId !== null),
        ),
        blockedReasons: [...actionGraph.blockedReasons],
        warnings: [...runtimeCapabilitySnapshot.warnings],
      },
      notes: dedupeStrings([`review=${review.decision}`, `readiness=${actionGraph.readiness}`]),
    };
  }
  buildOutcomeObservation(request, runtimeId) {
    const recordedAt = request.outcome.recordedAt;
    return {
      schemaId: DIRECTOR_OBSERVATION_SCHEMA_ID,
      observationId: buildObservationId("outcome", request.snapshotId, request.outcome.outcomeId),
      recordedAt,
      source: "outcome",
      snapshotId: request.snapshotId,
      runtimeId,
      blueprintId: request.blueprintId,
      handoffId: request.handoffId,
      recalledKnowledgePacks: [],
      recallStatus: "disabled",
      recallNotes: ["Outcome capture does not perform memory recall in Director Angel Beta-1."],
      outcome: {
        outcomeId: request.outcome.outcomeId,
        status: request.outcome.status,
        recordedAt: request.outcome.recordedAt,
        ...(request.outcome.operatorId === undefined
          ? {}
          : { operatorId: request.outcome.operatorId }),
        ...(request.outcome.notes === undefined ? {} : { notes: request.outcome.notes }),
        ...(request.outcome.editedFieldPaths === undefined
          ? {}
          : { editedFieldPaths: [...request.outcome.editedFieldPaths] }),
        ...(request.outcome.acceptedArtifacts === undefined
          ? {}
          : { acceptedArtifacts: [...request.outcome.acceptedArtifacts] }),
        ...(request.outcome.rejectionReasons === undefined
          ? {}
          : { rejectionReasons: [...request.outcome.rejectionReasons] }),
      },
      notes: dedupeStrings([
        `blueprint=${request.blueprintId}`,
        `handoff=${request.handoffId}`,
        `outcome=${request.outcome.status}`,
      ]),
    };
  }
  appendObservation(observation) {
    if (this.options.learningSink === undefined) {
      return;
    }
    try {
      const appendResult = this.options.learningSink.append(observation);
      void Promise.resolve(appendResult).catch(() => {
        // Observation recording must never block or crash the director control path.
      });
    } catch {
      // Observation recording must never block or crash the director control path.
    }
  }
  normalizeInput(request) {
    const context = materializeSnapshot(request.snapshot);
    const projectLabel =
      context.project.title ?? context.project.outline ?? context.request.projectId;
    const goal = [
      `${context.group.generationType} ${context.group.sceneCount} scene(s)`,
      `for ${projectLabel}`,
    ].join(" ");
    return {
      snapshotId: request.snapshot.snapshotId,
      operatorId: request.operatorId ?? null,
      goal,
      projectLabel,
      context,
    };
  }
  async recallPublishedKnowledge(normalizedInput) {
    if (!this.options.knowledgeRecall?.enabled) {
      return buildPublishedKnowledgeRecallPacket([], {
        ...this.buildPublishedKnowledgeRecallQuery(normalizedInput),
        queryId: `published-disabled-${normalizedInput.snapshotId}`,
      });
    }
    if (this.options.knowledgeStore?.listPublishedDocuments === undefined) {
      return {
        ...buildPublishedKnowledgeRecallPacket([], {
          ...this.buildPublishedKnowledgeRecallQuery(normalizedInput),
          queryId: `published-unavailable-${normalizedInput.snapshotId}`,
        }),
        status: "miss",
        notes: [
          "Published knowledge recall is enabled, but no document-capable knowledge store is configured.",
        ],
      };
    }
    try {
      const documents = await this.options.knowledgeStore.listPublishedDocuments();
      return buildPublishedKnowledgeRecallPacket(
        documents,
        {
          ...this.buildPublishedKnowledgeRecallQuery(normalizedInput),
          queryId: `published-${normalizedInput.snapshotId}`,
        },
        { now: this.nowIso() },
      );
    } catch (error) {
      return {
        ...buildPublishedKnowledgeRecallPacket([], {
          ...this.buildPublishedKnowledgeRecallQuery(normalizedInput),
          queryId: `published-degraded-${normalizedInput.snapshotId}`,
        }),
        status: "degraded",
        notes: [
          `Published knowledge recall degraded safely: ${error instanceof Error ? error.message : "unknown error"}.`,
        ],
      };
    }
  }
  buildPublishedKnowledgeRecallQuery(normalizedInput) {
    const workingContext = this.buildWorkingContext(normalizedInput);
    const recallHints = this.buildRecallHints(normalizedInput);
    return {
      ...(workingContext.projectId === undefined ? {} : { projectId: workingContext.projectId }),
      ...(workingContext.groupId === undefined ? {} : { groupId: workingContext.groupId }),
      anchorIds: [...workingContext.anchorIds],
      tags: [...recallHints.knowledgeSignalTags],
      preferredAdapters: dedupeStrings([
        ...recallHints.preferredBindings,
        ...recallHints.requiredBindings,
        ...recallHints.fallbackBindings,
      ]),
      ...(workingContext.generationType === undefined
        ? {}
        : { generationType: workingContext.generationType }),
      ...(workingContext.generationStyle === undefined
        ? {}
        : { generationStyle: workingContext.generationStyle }),
      maxHits: this.options.knowledgeRecall?.maxHits ?? 3,
      maxChars: this.options.knowledgeRecall?.maxChars ?? 900,
    };
  }
  async captureRuntimeCapabilitySnapshot(normalizedInput, coreSnapshot) {
    const adapters = await this.listRuntimeAdapters(normalizedInput, coreSnapshot);
    const switches = await this.resolveRuntimeSwitches(normalizedInput, coreSnapshot, adapters);
    const matchResult = await this.matchRuntimeAdapters(
      normalizedInput,
      coreSnapshot,
      adapters,
      switches,
    );
    const availableBindings = collectAvailableBindings(adapters);
    const availableAdapters = adapters.map((adapter) => adapter.adapterId);
    const eligibleExecutionAdapters = resolveEligibleExecutionAdapterIds(
      adapters,
      "script-planner",
      "generate",
      switches,
    );
    const eligibleImageBindings = dedupeStrings(
      matchResult.eligibleImageBindings ??
        matchResult.eligibleImageAdapters
          .map((adapterId) => resolveBindingForAdapter(adapters, adapterId))
          .filter((bindingId) => bindingId !== null),
    );
    const eligibleVideoBindings = dedupeStrings(
      matchResult.eligibleVideoBindings ??
        matchResult.eligibleVideoAdapters
          .map((adapterId) => resolveBindingForAdapter(adapters, adapterId))
          .filter((bindingId) => bindingId !== null),
    );
    const issues = [];
    if (coreSnapshot.runtimeStatus === "offline") {
      issues.push({
        code: "runtime-offline",
        severity: "block",
        message: "Runtime is offline, so no controlled execution handoff can be produced.",
      });
    } else if (coreSnapshot.runtimeStatus === "degraded") {
      issues.push({
        code: "runtime-degraded",
        severity: "warn",
        message: "Runtime is degraded, so operator approval is required before execution.",
      });
    }
    if (availableBindings.length === 0) {
      issues.push({
        code: "binding-missing",
        severity: "block",
        message: "No runtime bindings are available.",
      });
    }
    if (
      normalizedInput.context.intent.requiredImageBinding !== undefined &&
      !availableBindings.includes(normalizedInput.context.intent.requiredImageBinding)
    ) {
      issues.push({
        code: "required-image-binding-unavailable",
        severity: "block",
        message: `Required image binding ${normalizedInput.context.intent.requiredImageBinding} is unavailable.`,
      });
    }
    if (
      normalizedInput.context.intent.requiredVideoBinding !== undefined &&
      !availableBindings.includes(normalizedInput.context.intent.requiredVideoBinding)
    ) {
      issues.push({
        code: "required-video-binding-unavailable",
        severity: "block",
        message: `Required video binding ${normalizedInput.context.intent.requiredVideoBinding} is unavailable.`,
      });
    }
    if (
      !coreSnapshot.supportsVideo &&
      normalizedInput.context.group.generationStyle === "immersive"
    ) {
      issues.push({
        code: "immersive-video-unsupported",
        severity: "warn",
        message: "Immersive generation was requested, but the runtime does not support video.",
      });
    }
    if (!switches.autoRouteEnabled) {
      issues.push({
        code: "auto-route-disabled",
        severity: "block",
        message: "Auto-route is disabled by runtime switches.",
      });
    }
    for (const role of switches.disabledRoles) {
      issues.push({
        code: `role-disabled-${role}`,
        severity: "block",
        message: `Role ${role} is disabled by runtime switches.`,
      });
    }
    for (const reason of matchResult.blockedReasons) {
      issues.push({
        code: "runtime-match-blocked",
        severity: "block",
        message: reason,
      });
    }
    for (const warning of matchResult.warnings) {
      issues.push({
        code: "runtime-match-warning",
        severity: "warn",
        message: warning,
      });
    }
    return {
      runtimeId: coreSnapshot.runtimeId,
      status: coreSnapshot.runtimeStatus,
      availableBindings,
      availableAdapters,
      eligibleImageBindings,
      eligibleVideoBindings,
      eligibleImageAdapters: [...matchResult.eligibleImageAdapters],
      eligibleVideoAdapters: [...matchResult.eligibleVideoAdapters],
      eligibleExecutionAdapters,
      selectedImageAdapter: matchResult.selectedImageAdapterId ?? null,
      selectedVideoAdapter: matchResult.selectedVideoAdapterId ?? null,
      selectedExecutionAdapter: eligibleExecutionAdapters[0] ?? null,
      supportsVideo: coreSnapshot.supportsVideo,
      maxPromptChars: coreSnapshot.maxPromptChars,
      deterministicMode: coreSnapshot.deterministicMode ?? null,
      autoRouteEnabled: switches.autoRouteEnabled,
      disabledRoles: [...switches.disabledRoles],
      disabledAdapters: [...switches.disabledAdapters],
      blockedReasons: [...matchResult.blockedReasons],
      warnings: [...matchResult.warnings],
      issues,
    };
  }
  assessAlignment(normalizedInput, clarification) {
    const { context } = normalizedInput;
    const clarificationQuestions = [];
    const seenCodes = new Set();
    if (!context.project.title && !context.project.outline) {
      seenCodes.add("missing-project-brief");
      clarificationQuestions.push({
        code: "missing-project-brief",
        prompt: "Please describe the desired output or provide a project title before execution.",
      });
    }
    if (context.group.generationType !== "new" && context.group.anchorIds.length === 0) {
      seenCodes.add("missing-continuity-anchor");
      clarificationQuestions.push({
        code: "missing-continuity-anchor",
        prompt: "Extend/edit flows need at least one anchor ID to preserve continuity.",
      });
    }
    if (context.project.continuityPriority === "high" && context.group.anchorIds.length === 0) {
      seenCodes.add("continuity-needs-anchor");
      clarificationQuestions.push({
        code: "continuity-needs-anchor",
        prompt: "Continuity is high priority. Which anchor or reference should stay locked?",
      });
    }
    for (const question of clarification.questions) {
      if (seenCodes.has(question.questionId)) {
        continue;
      }
      clarificationQuestions.push({
        code: question.questionId,
        prompt: question.prompt,
      });
    }
    return {
      decision: clarification.alignmentState,
      summary: clarification.summary,
      reasons: [...clarification.blockingReasons],
      clarificationQuestions,
    };
  }
  lockAlignment(normalizedInput, coreAlignmentLock, alignmentAssessment) {
    return {
      status:
        coreAlignmentLock.status === "pending"
          ? "awaiting_clarification"
          : coreAlignmentLock.status,
      goal: normalizedInput.goal,
      lockedConstraints: coreAlignmentLock.lockedConstraints.map((constraint) => ({
        field: constraint.field,
        level: constraint.level,
        source: constraint.source === "user_lock" ? "snapshot" : "director",
        value: constraint.value,
        ...(constraint.reason === undefined ? {} : { reason: constraint.reason }),
      })),
      openQuestions: [...alignmentAssessment.clarificationQuestions],
      blockingReasons: [...alignmentAssessment.reasons],
    };
  }
  buildReview(
    normalizedInput,
    runtimeCapabilitySnapshot,
    alignmentLock,
    coreControl,
    recallContext,
  ) {
    const executionPlan = buildExecutionPlan(normalizedInput.context, coreControl.plan);
    const reviewReport = mergeReviewReport(
      coreControl.review,
      runtimeCapabilitySnapshot,
      alignmentLock,
    );
    const plan = applyReviewDecisionToPlan(coreControl.plan, reviewReport.overallDecision);
    return {
      decision: reviewReport.overallDecision,
      summary: buildReviewSummary(normalizedInput, reviewReport, alignmentLock, recallContext),
      recommendations: dedupeStrings([
        ...reviewReport.requiredFixes,
        ...recallContext.recommendations,
      ]),
      blockingReasons: reviewReport.blockingReasons,
      plan,
      executionPlan,
      reviewReport,
    };
  }
  buildCrewAssignments(
    normalizedInput,
    runtimeCapabilitySnapshot,
    alignmentLock,
    review,
    coreBlueprint,
    recallContext,
  ) {
    const selectedRoutingAdapters =
      review.plan.modeDecision.selectedGenerationStyle === "immersive"
        ? runtimeCapabilitySnapshot.eligibleVideoAdapters
        : runtimeCapabilitySnapshot.eligibleImageAdapters;
    const selectedExecutionAdapters = runtimeCapabilitySnapshot.eligibleExecutionAdapters;
    const baseStatus = decisionToAssignmentStatus(review.decision);
    const constraints = alignmentLock.lockedConstraints.map(
      (constraint) => `${constraint.field}=${constraint.value}`,
    );
    const assignments = [
      {
        assignmentId: "assignment-researcher",
        role: "researcher",
        objective: "Inspect workspace and continuity signals before planning.",
        assignedCapability: "workspace-research",
        inputs: ["host snapshot", "knowledge signals"],
        outputs: ["research brief"],
        deliverable: "Research brief with continuity notes and unknowns.",
        acceptanceCriteria: [
          "Continuity risks are explicitly called out.",
          "Missing references are surfaced before script planning.",
        ],
        constraints,
        dependsOn: [],
        allowedAdapters: [],
        actionClass: "read",
        approvalMode: "auto-allow",
        budgetLimit: 0,
        timeoutMs: 5_000,
        maxDelegationDepth: 0,
        fallbackPolicy: "Escalate to director if no continuity signal is usable.",
        escalationToDirector:
          "Escalate when workspace evidence is missing or contradicts locked constraints.",
        status: baseStatus,
      },
      {
        assignmentId: "assignment-script-planner",
        role: "script-planner",
        objective: "Turn the aligned brief into a deterministic scene script plan.",
        assignedCapability: "script-outline",
        inputs: ["research brief", "alignment lock"],
        outputs: ["script outline"],
        deliverable: "Script outline aligned with the locked director goal.",
        acceptanceCriteria: [
          "The script outline preserves the requested generation type.",
          "Locked constraints are echoed back without mutation.",
        ],
        constraints,
        dependsOn: ["assignment-researcher"],
        allowedAdapters: [...selectedExecutionAdapters],
        actionClass: "generate",
        approvalMode: review.decision === "pass" ? "auto-allow" : "operator-approve",
        budgetLimit: 0,
        timeoutMs: 8_000,
        maxDelegationDepth: 0,
        fallbackPolicy: "Return control to the director instead of improvising.",
        escalationToDirector:
          "Escalate when the brief cannot be converted into a script outline safely.",
        status: baseStatus,
        ...(selectedExecutionAdapters.length === 0
          ? {}
          : { selectedAdapter: runtimeCapabilitySnapshot.selectedExecutionAdapter }),
      },
      {
        assignmentId: "assignment-shot-planner",
        role: "shot-planner",
        objective: "Break the script outline into shot-ready assets and timing.",
        assignedCapability: "shot-breakdown",
        inputs: ["script outline"],
        outputs: ["shot breakdown"],
        deliverable: "Shot breakdown with scene timing and asset expectations.",
        acceptanceCriteria: [
          "Shot count stays consistent with the requested scene count.",
          "Each shot keeps the locked creative constraints visible.",
        ],
        constraints,
        dependsOn: ["assignment-script-planner"],
        allowedAdapters: [],
        actionClass: "generate",
        approvalMode: review.decision === "pass" ? "auto-allow" : "operator-approve",
        budgetLimit: 0,
        timeoutMs: 8_000,
        maxDelegationDepth: 0,
        fallbackPolicy: "Pause and return the partial shot breakdown to the director.",
        escalationToDirector: "Escalate when shot-level planning would violate locked constraints.",
        status: baseStatus,
      },
      {
        assignmentId: "assignment-asset-router",
        role: "asset-router",
        objective: "Match the requested output with an eligible runtime binding.",
        assignedCapability: "adapter-route-selection",
        inputs: ["script outline", "runtime capability snapshot"],
        outputs: ["adapter route"],
        deliverable: "Adapter route recommendation and readiness decision.",
        acceptanceCriteria: [
          "Selected adapter must satisfy the locked binding policy.",
          "No-match outcomes are returned as structured blocking reasons.",
        ],
        constraints,
        dependsOn: ["assignment-script-planner"],
        allowedAdapters: [...selectedRoutingAdapters],
        actionClass: "route",
        approvalMode: "operator-approve",
        budgetLimit: 0,
        timeoutMs: 4_000,
        maxDelegationDepth: 0,
        fallbackPolicy: "Block the handoff if no eligible adapter exists.",
        escalationToDirector: "Escalate when adapter capabilities do not satisfy the locked goal.",
        status:
          baseStatus === "blocked"
            ? "blocked"
            : selectedRoutingAdapters.length === 0
              ? "blocked"
              : baseStatus,
        selectedAdapter:
          review.plan.modeDecision.selectedGenerationStyle === "immersive"
            ? runtimeCapabilitySnapshot.selectedVideoAdapter
            : runtimeCapabilitySnapshot.selectedImageAdapter,
        ...(selectedRoutingAdapters.length === 0
          ? { blockingReason: "No eligible adapter matched the locked request." }
          : {}),
      },
      {
        assignmentId: "assignment-qc-reviewer",
        role: "qc-reviewer",
        objective: "Check that the crew output and adapter route still honor the locked brief.",
        assignedCapability: "quality-review",
        inputs: ["shot breakdown", "adapter route"],
        outputs: ["release recommendation"],
        deliverable: "Quality review before any external execution is allowed.",
        acceptanceCriteria: [
          "Every locked constraint is still present.",
          "Blocked or warning states are surfaced to the operator preview.",
        ],
        constraints,
        dependsOn: ["assignment-shot-planner", "assignment-asset-router"],
        allowedAdapters: [],
        actionClass: "review",
        approvalMode: "operator-approve",
        budgetLimit: 0,
        timeoutMs: 3_000,
        maxDelegationDepth: 0,
        fallbackPolicy: "Return review findings and stop before execution.",
        escalationToDirector:
          "Escalate when review finds drift between the plan and the locked goal.",
        status: baseStatus,
      },
    ];
    const baseAssignments =
      coreBlueprint !== undefined && coreBlueprint.assignments.length > 0
        ? mapCoreCrewAssignments(coreBlueprint.assignments, review.decision)
        : assignments;
    const recallAwareAssignments =
      recallContext === undefined
        ? baseAssignments
        : applyRecallCrewContext(baseAssignments, recallContext);
    return applyRuntimeCrewGates(recallAwareAssignments, runtimeCapabilitySnapshot, review);
  }
  buildActionGraph(normalizedInput, review, crewAssignments, runtimeCapabilitySnapshot) {
    const selectedMediaAdapter =
      review.plan.modeDecision.selectedGenerationStyle === "immersive"
        ? runtimeCapabilitySnapshot.selectedVideoAdapter
        : runtimeCapabilitySnapshot.selectedImageAdapter;
    const nodes = crewAssignments.map((assignment) => {
      const selectedAdapter =
        assignment.role === "asset-router"
          ? (assignment.selectedAdapter ?? selectedMediaAdapter)
          : (assignment.selectedAdapter ?? null);
      const blockingReason =
        assignment.blockingReason ??
        (assignment.role === "asset-router" && assignment.allowedAdapters.length === 0
          ? "No eligible adapter matched the locked request."
          : assignment.status === "blocked"
            ? "Director review blocked this assignment before handoff."
            : undefined);
      return {
        nodeId: `node-${assignment.assignmentId}`,
        assignmentId: assignment.assignmentId,
        role: assignment.role,
        objective: assignment.objective,
        deliverable: assignment.deliverable,
        actionClass: assignment.actionClass,
        approvalMode: assignment.approvalMode,
        status:
          blockingReason !== undefined
            ? "blocked"
            : assignment.status === "awaiting_approval"
              ? "awaiting_approval"
              : assignment.status,
        dependsOn: [...assignment.dependsOn],
        eligibleAdapters: [...assignment.allowedAdapters],
        selectedAdapter,
        acceptanceCriteria: [...assignment.acceptanceCriteria],
        ...(blockingReason === undefined ? {} : { blockingReason }),
      };
    });
    const edges = [
      {
        edgeId: "handoff-research-to-script",
        fromAssignmentId: "assignment-researcher",
        toAssignmentId: "assignment-script-planner",
        artifact: "research brief",
        handoffContract: "Research findings become the script outline input.",
        blocking: true,
      },
      {
        edgeId: "handoff-script-to-shot",
        fromAssignmentId: "assignment-script-planner",
        toAssignmentId: "assignment-shot-planner",
        artifact: "script outline",
        handoffContract: "Approved script outline becomes shot planning input.",
        blocking: true,
      },
      {
        edgeId: "handoff-script-to-router",
        fromAssignmentId: "assignment-script-planner",
        toAssignmentId: "assignment-asset-router",
        artifact: "route requirements",
        handoffContract: "Script output informs adapter routing in parallel with shot planning.",
        blocking: true,
      },
      {
        edgeId: "handoff-shot-to-qc",
        fromAssignmentId: "assignment-shot-planner",
        toAssignmentId: "assignment-qc-reviewer",
        artifact: "shot breakdown",
        handoffContract: "Shot plan must be reviewed before any execution handoff.",
        blocking: true,
      },
      {
        edgeId: "handoff-router-to-qc",
        fromAssignmentId: "assignment-asset-router",
        toAssignmentId: "assignment-qc-reviewer",
        artifact: "adapter route",
        handoffContract: "Adapter route must be reviewed before any execution handoff.",
        blocking: true,
      },
    ];
    const blockedReasons = dedupeStrings([
      ...runtimeCapabilitySnapshot.blockedReasons,
      ...nodes.flatMap((node) =>
        node.status === "blocked" && node.blockingReason !== undefined ? [node.blockingReason] : [],
      ),
    ]);
    const readiness =
      blockedReasons.length > 0 || review.decision === "block"
        ? "blocked"
        : nodes.some((node) => node.status === "awaiting_approval") || review.decision === "warn"
          ? "review_required"
          : "ready";
    return {
      graphId: `graph-${normalizedInput.snapshotId}`,
      goal: normalizedInput.goal,
      readiness,
      nodes,
      edges,
      blockedReasons,
    };
  }
  buildExecutionHandoffEnvelope(
    normalizedInput,
    alignmentLock,
    review,
    actionGraph,
    recallContext,
  ) {
    return {
      handoffId: `handoff-${normalizedInput.snapshotId}`,
      snapshotId: normalizedInput.snapshotId,
      runtimeId: normalizedInput.context.runtime.runtimeId,
      status: actionGraph.readiness,
      goal: normalizedInput.goal,
      lockedConstraints: alignmentLock.lockedConstraints.map(
        (constraint) => `${constraint.field}=${constraint.value}`,
      ),
      operatorPreview: {
        summary: review.summary,
        visiblePrompt: review.executionPlan.prompt.visible,
        selectedGenerationType: review.executionPlan.selectedGenerationType,
        selectedGenerationStyle: review.executionPlan.selectedGenerationStyle,
        selectedImageBinding: review.executionPlan.selectedImageBinding,
        selectedVideoBinding: review.executionPlan.selectedVideoBinding,
        actionCount: actionGraph.nodes.length,
        blockedReasons: [...actionGraph.blockedReasons],
      },
      entries: actionGraph.nodes.map((node) => ({
        assignmentId: node.assignmentId,
        role: node.role,
        deliverable: node.deliverable,
        actionClass: node.actionClass,
        approvalMode: node.approvalMode,
        selectedAdapter: node.selectedAdapter,
        status: node.status,
        ...(node.blockingReason === undefined ? {} : { blockingReason: node.blockingReason }),
      })),
      auditTrail: buildAuditTrail(normalizedInput, alignmentLock, actionGraph, recallContext),
    };
  }
  toEvaluateResponse(review, actionGraph, executionHandoffEnvelope) {
    const decision = readinessToDecision(actionGraph.readiness);
    const blockingReasons = dedupeStrings([
      ...review.blockingReasons,
      ...actionGraph.blockedReasons,
    ]);
    const recommendations = dedupeStrings([
      ...review.recommendations,
      ...(actionGraph.readiness === "review_required"
        ? ["Operator approval is required before execution handoff can continue."]
        : []),
      ...(actionGraph.readiness === "blocked"
        ? ["Resolve blocked action nodes before continuing to external execution."]
        : []),
    ]);
    return {
      apiVersion: DIRECTOR_HOST_API_VERSION,
      snapshotId: executionHandoffEnvelope.snapshotId,
      runtimeId: executionHandoffEnvelope.runtimeId,
      decision,
      summary: executionHandoffEnvelope.operatorPreview.summary,
      recommendations:
        recommendations.length > 0
          ? recommendations
          : ["Proceed with the current deterministic director handoff."],
      plan: {
        planId: review.plan.planId,
        status: readinessToPlanStatus(actionGraph.readiness),
        summary: review.plan.summary,
        confidence: review.plan.confidence,
        selectedGenerationStyle: review.plan.modeDecision.selectedGenerationStyle,
        selectedImageBinding: review.plan.modelRoutingDecision.selectedImageBinding,
        selectedVideoBinding: review.plan.modelRoutingDecision.selectedVideoBinding,
        riskFlags: dedupeStrings([
          ...review.plan.riskFlags,
          ...(actionGraph.blockedReasons.length > 0 ? ["action-graph-blocked"] : []),
        ]),
      },
      execution: {
        executionId: review.executionPlan.executionId,
        selectedGenerationType: review.executionPlan.selectedGenerationType,
        selectedGenerationStyle: review.executionPlan.selectedGenerationStyle,
        visiblePrompt: review.executionPlan.prompt.visible,
      },
      review: {
        overallDecision: decision,
        blockingReasons,
        requiredFixes: recommendations,
      },
    };
  }
  async listRuntimeAdapters(normalizedInput, coreSnapshot) {
    if (this.options.runtimeRegistry === undefined) {
      return defaultRuntimeAdaptersFromCore(coreSnapshot);
    }
    const adapters = await this.options.runtimeRegistry.listAdapters({
      normalizedInput,
      coreSnapshot,
    });
    return adapters.map((adapter) => normalizeRuntimeAdapterDescriptor(adapter));
  }
  async resolveRuntimeSwitches(normalizedInput, coreSnapshot, adapters) {
    if (this.options.switches === undefined) {
      return {
        autoRouteEnabled: true,
        disabledRoles: [],
        disabledAdapters: [],
      };
    }
    const snapshot = await this.options.switches.snapshot({
      normalizedInput,
      coreSnapshot,
      adapters,
    });
    return {
      autoRouteEnabled: snapshot.autoRouteEnabled ?? true,
      disabledRoles: [...(snapshot.disabledRoles ?? [])],
      disabledAdapters: [...(snapshot.disabledAdapters ?? [])],
    };
  }
  async matchRuntimeAdapters(normalizedInput, coreSnapshot, adapters, switches) {
    if (this.options.runtimeMatcher === undefined) {
      return defaultRuntimeMatchResult(normalizedInput, adapters, switches);
    }
    const matchResult = await this.options.runtimeMatcher.match({
      normalizedInput,
      coreSnapshot,
      adapters,
      switches,
    });
    const eligibleImageAdapters = dedupeStrings([...(matchResult.eligibleImageAdapters ?? [])]);
    const eligibleVideoAdapters = dedupeStrings([...(matchResult.eligibleVideoAdapters ?? [])]);
    return {
      eligibleImageAdapters,
      eligibleVideoAdapters,
      eligibleImageBindings: eligibleImageAdapters
        .map((adapterId) => resolveBindingForAdapter(adapters, adapterId))
        .filter((bindingId) => bindingId !== null),
      eligibleVideoBindings: eligibleVideoAdapters
        .map((adapterId) => resolveBindingForAdapter(adapters, adapterId))
        .filter((bindingId) => bindingId !== null),
      selectedImageAdapterId: matchResult.selectedImageAdapterId ?? null,
      selectedVideoAdapterId: matchResult.selectedVideoAdapterId ?? null,
      selectedImageBinding:
        matchResult.selectedImageBinding ??
        resolveBindingForAdapter(adapters, matchResult.selectedImageAdapterId ?? null),
      selectedVideoBinding:
        matchResult.selectedVideoBinding ??
        resolveBindingForAdapter(adapters, matchResult.selectedVideoAdapterId ?? null),
      blockedReasons: dedupeStrings([...(matchResult.blockedReasons ?? [])]),
      warnings: dedupeStrings([...(matchResult.warnings ?? [])]),
    };
  }
  toKnowledgePackEntry(record) {
    return {
      id: record.metadata.id,
      title: record.metadata.title,
      version: record.metadata.version,
      stage: "published",
      createdAt: record.metadata.createdAt,
      ...(record.metadata.description === undefined
        ? {}
        : { description: record.metadata.description }),
      ...(record.metadata.tags === undefined ? {} : { tags: [...record.metadata.tags] }),
    };
  }
}
function resolveEligibleBindings(
  availableBindings,
  requiredBinding,
  preferredBinding,
  fallbackBindings,
) {
  if (requiredBinding !== undefined) {
    return availableBindings.includes(requiredBinding) ? [requiredBinding] : [];
  }
  if (preferredBinding !== undefined && availableBindings.includes(preferredBinding)) {
    const rest = availableBindings.filter((binding) => binding !== preferredBinding);
    return [preferredBinding, ...rest];
  }
  if (fallbackBindings !== undefined && fallbackBindings.length > 0) {
    const fallbackMatches = fallbackBindings.filter((binding) =>
      availableBindings.includes(binding),
    );
    if (fallbackMatches.length > 0) {
      const remaining = availableBindings.filter((binding) => !fallbackMatches.includes(binding));
      return [...fallbackMatches, ...remaining];
    }
  }
  return [...availableBindings];
}
function defaultRuntimeAdaptersFromCore(coreSnapshot) {
  return coreSnapshot.capabilities.map((capability) =>
    normalizeRuntimeAdapterDescriptor({
      adapterId: capability.adapterId,
      adapterKind: capability.bindingId === "director-core.internal" ? "internal" : "media",
      bindingId: capability.bindingId,
      enabled: capability.status !== "blocked",
      healthy: capability.status === "ready",
      dryRunOnly: true,
      supportedActionClasses: capability.supportedActionClasses,
      mediaModes:
        capability.scope === "hybrid"
          ? ["image", "video"]
          : capability.scope === "video"
            ? ["video"]
            : capability.scope === "image"
              ? ["image"]
              : [],
      reason: capability.reason,
    }),
  );
}
function normalizeRuntimeAdapterDescriptor(adapter) {
  return {
    adapterId: adapter.adapterId,
    adapterKind: adapter.adapterKind,
    ...(adapter.bindingId === undefined ? {} : { bindingId: adapter.bindingId }),
    ...(adapter.enabled === undefined ? {} : { enabled: adapter.enabled }),
    ...(adapter.healthy === undefined ? {} : { healthy: adapter.healthy }),
    ...(adapter.dryRunOnly === undefined ? {} : { dryRunOnly: adapter.dryRunOnly }),
    ...(adapter.mockOnly === undefined ? {} : { mockOnly: adapter.mockOnly }),
    ...(adapter.bridgeKind === undefined ? {} : { bridgeKind: adapter.bridgeKind }),
    ...(adapter.supportedRoles === undefined
      ? {}
      : { supportedRoles: [...adapter.supportedRoles] }),
    ...(adapter.supportedActionClasses === undefined
      ? {}
      : { supportedActionClasses: [...adapter.supportedActionClasses] }),
    ...(adapter.mediaModes === undefined ? {} : { mediaModes: [...adapter.mediaModes] }),
    ...(adapter.reason === undefined ? {} : { reason: adapter.reason }),
  };
}
function collectAvailableBindings(adapters) {
  return dedupeStrings(
    adapters.map((adapter) => adapter.bindingId ?? null).filter((bindingId) => bindingId !== null),
  );
}
function resolveBindingForAdapter(adapters, adapterId) {
  if (adapterId === null || adapterId === undefined) {
    return null;
  }
  return adapters.find((adapter) => adapter.adapterId === adapterId)?.bindingId ?? null;
}
function supportsMediaMode(adapter, mode) {
  if (adapter.adapterKind !== "media") {
    return false;
  }
  if (adapter.mediaModes === undefined || adapter.mediaModes.length === 0) {
    return mode === "image";
  }
  return adapter.mediaModes.includes(mode);
}
function isAdapterEligibleForRoute(adapter, switches) {
  if (adapter.adapterKind !== "media") {
    return false;
  }
  if (switches.disabledAdapters.includes(adapter.adapterId)) {
    return false;
  }
  if (adapter.enabled === false || adapter.healthy === false) {
    return false;
  }
  if (
    adapter.supportedActionClasses !== undefined &&
    !adapter.supportedActionClasses.includes("route")
  ) {
    return false;
  }
  if (adapter.supportedRoles !== undefined && !adapter.supportedRoles.includes("asset-router")) {
    return false;
  }
  return true;
}
function supportsCrewRole(adapter, role) {
  return adapter.supportedRoles === undefined || adapter.supportedRoles.includes(role);
}
function supportsActionClass(adapter, actionClass) {
  return (
    adapter.supportedActionClasses === undefined ||
    adapter.supportedActionClasses.includes(actionClass)
  );
}
function isAdapterEligibleForExecutionHandoff(adapter, role, actionClass, switches) {
  if (adapter.adapterKind !== "execution") {
    return false;
  }
  if (switches.disabledAdapters.includes(adapter.adapterId)) {
    return false;
  }
  if (adapter.enabled === false || adapter.healthy === false) {
    return false;
  }
  if (adapter.mockOnly === true || adapter.bridgeKind !== "http-json") {
    return false;
  }
  return supportsCrewRole(adapter, role) && supportsActionClass(adapter, actionClass);
}
function resolveEligibleExecutionAdapterIds(adapters, role, actionClass, switches) {
  return adapters
    .filter((adapter) => isAdapterEligibleForExecutionHandoff(adapter, role, actionClass, switches))
    .map((adapter) => adapter.adapterId);
}
function resolveEligibleAdapterIds(
  adapters,
  mode,
  requiredBinding,
  preferredBinding,
  fallbackBindings,
  switches,
) {
  const eligibleAdapters = adapters.filter(
    (adapter) => isAdapterEligibleForRoute(adapter, switches) && supportsMediaMode(adapter, mode),
  );
  if (requiredBinding !== undefined) {
    return eligibleAdapters
      .filter((adapter) => adapter.bindingId === requiredBinding)
      .map((adapter) => adapter.adapterId);
  }
  const preferredAdapters =
    preferredBinding === undefined
      ? []
      : eligibleAdapters
          .filter((adapter) => adapter.bindingId === preferredBinding)
          .map((adapter) => adapter.adapterId);
  const fallbackAdapters =
    fallbackBindings === undefined || fallbackBindings.length === 0
      ? []
      : fallbackBindings.flatMap((bindingId) =>
          eligibleAdapters
            .filter((adapter) => adapter.bindingId === bindingId)
            .map((adapter) => adapter.adapterId),
        );
  const remainingAdapters = eligibleAdapters
    .map((adapter) => adapter.adapterId)
    .filter(
      (adapterId) =>
        !preferredAdapters.includes(adapterId) && !fallbackAdapters.includes(adapterId),
    );
  return dedupeStrings([...preferredAdapters, ...fallbackAdapters, ...remainingAdapters]);
}
function defaultRuntimeMatchResult(normalizedInput, adapters, switches) {
  const { context } = normalizedInput;
  const eligibleImageAdapters = resolveEligibleAdapterIds(
    adapters,
    "image",
    context.intent.requiredImageBinding,
    context.intent.preferredImageBinding,
    context.intent.fallbackBindings,
    switches,
  );
  const eligibleVideoAdapters = context.runtime.supportsVideo
    ? resolveEligibleAdapterIds(
        adapters,
        "video",
        context.intent.requiredVideoBinding,
        context.intent.preferredVideoBinding,
        context.intent.fallbackBindings,
        switches,
      )
    : [];
  const blockedReasons = [];
  const warnings = [];
  if (!switches.autoRouteEnabled) {
    blockedReasons.push("Auto-route is disabled by runtime switches.");
  }
  if (context.intent.requiredImageBinding !== undefined && eligibleImageAdapters.length === 0) {
    blockedReasons.push(
      `Required image binding ${context.intent.requiredImageBinding} is unavailable after runtime filtering.`,
    );
  }
  if (
    context.intent.requiredVideoBinding !== undefined &&
    eligibleVideoAdapters.length === 0 &&
    context.runtime.supportsVideo
  ) {
    blockedReasons.push(
      `Required video binding ${context.intent.requiredVideoBinding} is unavailable after runtime filtering.`,
    );
  }
  if (
    context.group.generationStyle === "immersive" &&
    context.runtime.supportsVideo &&
    eligibleVideoAdapters.length === 0
  ) {
    blockedReasons.push("No eligible adapter matched the locked request.");
  } else if (eligibleImageAdapters.length === 0) {
    blockedReasons.push("No eligible adapter matched the locked request.");
  }
  if (switches.disabledAdapters.length > 0) {
    warnings.push(`Runtime switches disabled adapter(s): ${switches.disabledAdapters.join(", ")}.`);
  }
  return {
    eligibleImageAdapters,
    eligibleVideoAdapters,
    eligibleImageBindings: eligibleImageAdapters
      .map((adapterId) => resolveBindingForAdapter(adapters, adapterId))
      .filter((bindingId) => bindingId !== null),
    eligibleVideoBindings: eligibleVideoAdapters
      .map((adapterId) => resolveBindingForAdapter(adapters, adapterId))
      .filter((bindingId) => bindingId !== null),
    selectedImageAdapterId: eligibleImageAdapters[0] ?? null,
    selectedVideoAdapterId: eligibleVideoAdapters[0] ?? null,
    selectedImageBinding: resolveBindingForAdapter(adapters, eligibleImageAdapters[0] ?? null),
    selectedVideoBinding: resolveBindingForAdapter(adapters, eligibleVideoAdapters[0] ?? null),
    blockedReasons: dedupeStrings(blockedReasons),
    warnings: dedupeStrings(warnings),
  };
}
function applyRuntimeCrewGates(assignments, runtimeCapabilitySnapshot, review) {
  const selectedRoutingAdapters =
    review.plan.modeDecision.selectedGenerationStyle === "immersive"
      ? runtimeCapabilitySnapshot.eligibleVideoAdapters
      : runtimeCapabilitySnapshot.eligibleImageAdapters;
  const selectedAdapter =
    review.plan.modeDecision.selectedGenerationStyle === "immersive"
      ? runtimeCapabilitySnapshot.selectedVideoAdapter
      : runtimeCapabilitySnapshot.selectedImageAdapter;
  return assignments.map((assignment) => {
    const prefersExecutionAdapter =
      isExecutionHandoffCandidate(assignment) &&
      runtimeCapabilitySnapshot.eligibleExecutionAdapters.length > 0;
    const filteredAllowedAdapters =
      assignment.role === "asset-router"
        ? assignment.allowedAdapters.length === 0
          ? [...selectedRoutingAdapters]
          : assignment.allowedAdapters.some((adapterId) =>
                selectedRoutingAdapters.includes(adapterId),
              )
            ? [
                ...assignment.allowedAdapters.filter((adapterId) =>
                  selectedRoutingAdapters.includes(adapterId),
                ),
                ...selectedRoutingAdapters.filter(
                  (adapterId) => !assignment.allowedAdapters.includes(adapterId),
                ),
              ]
            : [...selectedRoutingAdapters]
        : prefersExecutionAdapter
          ? [...runtimeCapabilitySnapshot.eligibleExecutionAdapters]
          : assignment.allowedAdapters.filter(
              (adapterId) => !runtimeCapabilitySnapshot.disabledAdapters.includes(adapterId),
            );
    const blockingReason = runtimeCapabilitySnapshot.disabledRoles.includes(assignment.role)
      ? `Role ${assignment.role} is disabled by runtime switches.`
      : assignment.role === "asset-router" && !runtimeCapabilitySnapshot.autoRouteEnabled
        ? "Auto-route is disabled by runtime switches."
        : assignment.role === "asset-router" && filteredAllowedAdapters.length === 0
          ? "No eligible adapter matched the locked request."
          : assignment.allowedAdapters.length > 0 && filteredAllowedAdapters.length === 0
            ? `All adapters for role ${assignment.role} are disabled by runtime switches.`
            : assignment.blockingReason;
    return {
      ...assignment,
      allowedAdapters: filteredAllowedAdapters,
      selectedAdapter:
        assignment.role === "asset-router"
          ? selectedAdapter
          : prefersExecutionAdapter
            ? (runtimeCapabilitySnapshot.selectedExecutionAdapter ??
              assignment.selectedAdapter ??
              null)
            : (assignment.selectedAdapter ?? null),
      status:
        assignment.status === "blocked" || blockingReason !== undefined
          ? "blocked"
          : assignment.status,
      ...(blockingReason === undefined ? {} : { blockingReason }),
    };
  });
}
function isExecutionHandoffCandidate(assignment) {
  return assignment.role === "script-planner" && assignment.actionClass === "generate";
}
function applyReviewDecisionToPlan(plan, decision) {
  return {
    ...plan,
    status:
      decision === "block" ? "blocked" : decision === "warn" ? "review_required" : plan.status,
    reviewStatus: decision,
  };
}
function mergeReviewReport(baseReviewReport, runtimeCapabilitySnapshot, alignmentLock) {
  const additionalReasons = [
    ...runtimeCapabilitySnapshot.issues
      .filter((issue) => issue.severity === "warn")
      .map((issue) => `runtime: ${issue.message}`),
    ...alignmentLock.blockingReasons.map((reason) => `alignment: ${reason}`),
    ...alignmentLock.openQuestions.map((question) => `alignment: ${question.prompt}`),
  ];
  const requiredFixes = [
    ...baseReviewReport.requiredFixes,
    ...alignmentLock.openQuestions.map((question) => question.prompt),
    ...runtimeCapabilitySnapshot.issues
      .filter((issue) => issue.severity === "block")
      .map((issue) => issue.message),
  ];
  const runtimeDecision = runtimeCapabilitySnapshot.issues.some(
    (issue) => issue.severity === "block",
  )
    ? "block"
    : runtimeCapabilitySnapshot.issues.some((issue) => issue.severity === "warn")
      ? "warn"
      : "pass";
  const alignmentDecision =
    alignmentLock.status === "blocked"
      ? "block"
      : alignmentLock.status === "awaiting_clarification"
        ? "warn"
        : "pass";
  const overallDecision = mergeDecisions(
    mergeDecisions(baseReviewReport.overallDecision, runtimeDecision),
    alignmentDecision,
  );
  return {
    overallDecision,
    gates: [...baseReviewReport.gates],
    blockingReasons: dedupeStrings([...baseReviewReport.blockingReasons, ...additionalReasons]),
    requiredFixes: dedupeStrings(requiredFixes),
  };
}
function buildReviewSummary(normalizedInput, reviewReport, alignmentLock, recallContext) {
  const baseSummary =
    reviewReport.overallDecision === "block"
      ? `${normalizedInput.goal} is blocked before external execution handoff.`
      : reviewReport.overallDecision === "warn"
        ? alignmentLock.status === "awaiting_clarification"
          ? `${normalizedInput.goal} needs clarification before the crew can proceed safely.`
          : `${normalizedInput.goal} needs operator review before execution handoff.`
        : `${normalizedInput.goal} is ready for deterministic crew delegation.`;
  if (recallContext.summary === undefined) {
    return baseSummary;
  }
  return `${baseSummary} ${recallContext.summary}`;
}
function materializeRecall(recall, publishedKnowledgeRecall) {
  const topHits = recall.hits.slice(0, 2);
  const topPublishedHits = publishedKnowledgeRecall.hits.slice(0, 2);
  const preferredAdapterIds = dedupeStrings([
    ...topHits.flatMap((hit) => hit.selectedAdapters),
    ...topPublishedHits.flatMap((hit) => hit.method.preferredAdapters),
  ]);
  const topHit = topHits[0];
  const topPublishedHit = topPublishedHits[0];
  return {
    status:
      recall.status === "hit" || publishedKnowledgeRecall.status === "hit" ? "hit" : recall.status,
    ...(topHit !== undefined || topPublishedHit !== undefined
      ? {
          summary: [
            topHit === undefined
              ? undefined
              : `Recall matched ${recall.hits.length} prior run(s); top hit: ${topHit.summary}`,
            topPublishedHit === undefined
              ? undefined
              : `Published knowledge matched ${publishedKnowledgeRecall.hits.length} pack(s); top pack: ${topPublishedHit.summary}`,
          ]
            .filter((value) => value !== undefined)
            .join(" "),
        }
      : {}),
    recommendations: dedupeStrings([
      ...(topHit === undefined
        ? []
        : [
            `Review recalled run ${topHit.provenance.runId} before changing continuity-sensitive decisions.`,
          ]),
      ...(topPublishedHit === undefined
        ? []
        : [
            `Review published knowledge pack ${topPublishedHit.knowledgePackId} before changing continuity-sensitive decisions.`,
          ]),
      ...topHits
        .filter((hit) => hit.status !== "completed")
        .map(
          (hit) =>
            `Check why recalled run ${hit.provenance.runId} ended as ${hit.status} before reusing its route.`,
        ),
    ]),
    sharedInputs:
      topHit === undefined && topPublishedHit === undefined
        ? []
        : dedupeStrings([
            ...(topHit === undefined ? [] : ["bounded recall brief"]),
            ...(topPublishedHit === undefined ? [] : ["published knowledge brief"]),
          ]),
    sharedConstraints:
      topHit === undefined && topPublishedHit === undefined
        ? []
        : dedupeStrings([
            ...(topHit === undefined ? [] : [`Recall continuity brief: ${topHit.summary}`]),
            ...(topPublishedHit === undefined
              ? []
              : [`Published method brief: ${topPublishedHit.summary}`]),
            ...(preferredAdapterIds.length === 0
              ? []
              : [`Prefer recalled adapters: ${preferredAdapterIds.join(", ")}`]),
          ]),
    preferredAdapterIds,
    auditTrail: dedupeStrings([
      `recall=${recall.status}`,
      `published-knowledge=${publishedKnowledgeRecall.status}`,
      ...topHits.map((hit) => `recall-hit=${hit.recordId}:${hit.status}:${hit.score.toFixed(2)}`),
      ...topHits.map((hit) => `recall-run=${hit.provenance.runId}`),
      ...topPublishedHits.map(
        (hit) => `published-pack=${hit.knowledgePackId}:${hit.score.toFixed(2)}`,
      ),
    ]),
  };
}
function applyPublishedKnowledgeSignals(normalizedInput, publishedKnowledgeRecall) {
  if (publishedKnowledgeRecall.hits.length === 0) {
    return normalizedInput;
  }
  const nextSignals = mergeKnowledgeSignals(
    normalizedInput.context.knowledgeSignals ?? [],
    publishedKnowledgeRecall.hits.map((hit) => ({
      id: `knowledge-pack:${hit.knowledgePackId}`,
      description: truncateText(
        `${hit.title} | ${hit.method.trigger} | ${hit.method.explanation}`,
        180,
      ),
      confidence: deriveSignalConfidence(hit.score),
      tags: dedupeStrings(hit.tags),
    })),
  );
  return {
    ...normalizedInput,
    context: {
      ...normalizedInput.context,
      knowledgeSignals: nextSignals,
    },
  };
}
function mergeKnowledgeSignals(current, next) {
  const byId = new Map();
  for (const signal of [...current, ...next]) {
    byId.set(signal.id, {
      id: signal.id,
      description: signal.description,
      confidence: signal.confidence,
      tags: dedupeStrings(signal.tags),
    });
  }
  return [...byId.values()];
}
function mergeKnowledgePackRefs(recall, publishedKnowledgeRecall) {
  const merged = new Map();
  for (const pack of recall.knowledgePacks) {
    merged.set(pack.knowledgePackId, {
      knowledgePackId: pack.knowledgePackId,
      ...(pack.title === undefined ? {} : { title: pack.title }),
      ...(pack.version === undefined ? {} : { version: pack.version }),
      ...(pack.tags === undefined ? {} : { tags: [...pack.tags] }),
      ...(pack.reason === undefined ? {} : { reason: pack.reason }),
    });
  }
  for (const hit of publishedKnowledgeRecall.hits) {
    merged.set(hit.knowledgePackId, {
      knowledgePackId: hit.knowledgePackId,
      title: hit.title,
      version: hit.version,
      tags: [...hit.tags],
      reason: hit.reasons.join(" | "),
    });
  }
  return [...merged.values()];
}
function deriveObservationRecallStatus(recall, publishedKnowledgeRecall) {
  if (recall.status === "degraded" || publishedKnowledgeRecall.status === "degraded") {
    return "degraded";
  }
  if (recall.status === "hit" || publishedKnowledgeRecall.status === "hit") {
    return "hit";
  }
  if (recall.status === "miss") {
    return "miss";
  }
  return publishedKnowledgeRecall.status === "miss" ? "miss" : recall.status;
}
function mergeRecallNotes(recall, publishedKnowledgeRecall) {
  return dedupeStrings([...recall.notes, ...publishedKnowledgeRecall.notes]);
}
function deriveSignalConfidence(score) {
  return Math.max(0.55, Math.min(0.98, Number((score / 100).toFixed(2))));
}
function truncateText(value, maxChars) {
  if (value.length <= maxChars) {
    return value;
  }
  const limit = Math.max(1, maxChars - 1);
  return `${value.slice(0, limit)}…`;
}
function prioritizeAdapters(allowedAdapters, preferredAdapterIds) {
  if (preferredAdapterIds.length === 0) {
    return [...allowedAdapters];
  }
  const preferred = preferredAdapterIds.filter((adapterId) => allowedAdapters.includes(adapterId));
  const remaining = allowedAdapters.filter((adapterId) => !preferred.includes(adapterId));
  return dedupeStrings([...preferred, ...remaining]);
}
function applyRecallCrewContext(assignments, recallContext) {
  if (recallContext.sharedInputs.length === 0 && recallContext.sharedConstraints.length === 0) {
    return assignments;
  }
  return assignments.map((assignment) => {
    const allowedAdapters =
      assignment.role === "asset-router"
        ? prioritizeAdapters(
            dedupeStrings([...assignment.allowedAdapters, ...recallContext.preferredAdapterIds]),
            recallContext.preferredAdapterIds,
          )
        : [...assignment.allowedAdapters];
    const sharedInputs =
      assignment.role === "researcher" || assignment.role === "script-planner"
        ? recallContext.sharedInputs
        : [];
    const sharedConstraints =
      assignment.role === "asset-router" || assignment.role === "qc-reviewer"
        ? recallContext.sharedConstraints
        : [];
    return {
      ...assignment,
      inputs: dedupeStrings([...assignment.inputs, ...sharedInputs]),
      constraints: dedupeStrings([...assignment.constraints, ...sharedConstraints]),
      allowedAdapters,
    };
  });
}
function mergeDecisions(left, right) {
  if (left === "block" || right === "block") {
    return "block";
  }
  if (left === "warn" || right === "warn") {
    return "warn";
  }
  return "pass";
}
function decisionToAssignmentStatus(decision) {
  return decision === "block" ? "blocked" : decision === "warn" ? "awaiting_approval" : "ready";
}
function buildAuditTrail(normalizedInput, alignmentLock, actionGraph, recallContext) {
  return dedupeStrings([
    `snapshot=${normalizedInput.snapshotId}`,
    `runtime=${normalizedInput.context.runtime.runtimeId}`,
    `alignment=${alignmentLock.status}`,
    `action-graph=${actionGraph.readiness}`,
    ...recallContext.auditTrail,
    ...(normalizedInput.operatorId === null ? [] : [`operator=${normalizedInput.operatorId}`]),
  ]);
}
function readinessToDecision(readiness) {
  return readiness === "blocked" ? "block" : readiness === "review_required" ? "warn" : "pass";
}
function readinessToPlanStatus(readiness) {
  return readiness === "blocked"
    ? "blocked"
    : readiness === "review_required"
      ? "review_required"
      : "ready";
}
function dedupeStrings(values) {
  return [...new Set(values)];
}
function buildObservationId(source, primaryKey, secondaryKey) {
  const sanitize = (value) => value.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return ["observation", source, sanitize(primaryKey), sanitize(secondaryKey)]
    .filter((segment) => segment.length > 0)
    .join("-");
}
function mapCoreCrewAssignments(assignments, decision) {
  const baseStatus = decisionToAssignmentStatus(decision);
  return assignments.map((assignment) => ({
    assignmentId: assignment.assignmentId,
    role: assignment.role,
    objective: assignment.objective,
    assignedCapability: assignment.assignedCapability,
    inputs: assignment.inputs.map((input) => input.name),
    outputs: assignment.outputs.map((output) => output.name),
    deliverable: assignment.deliverable,
    acceptanceCriteria: [...assignment.acceptanceCriteria],
    constraints: [...assignment.constraints],
    dependsOn: [...assignment.dependsOn],
    allowedAdapters: dedupeStrings(assignment.allowedAdapters),
    actionClass: assignment.actionClass,
    approvalMode: assignment.approvalMode,
    budgetLimit: assignment.budgetLimit ?? 0,
    timeoutMs: assignment.timeoutMs,
    maxDelegationDepth: assignment.maxDelegationDepth,
    fallbackPolicy: `${assignment.fallbackPolicy.strategy}: ${assignment.fallbackPolicy.reason}`,
    escalationToDirector: `${assignment.escalationToDirector.action}: ${assignment.escalationToDirector.reason}`,
    selectedAdapter: assignment.allowedAdapters[0] ?? null,
    status:
      baseStatus === "blocked"
        ? "blocked"
        : assignment.role === "asset-router" && assignment.allowedAdapters.length === 0
          ? "blocked"
          : baseStatus,
    ...(assignment.role === "asset-router" && assignment.allowedAdapters.length === 0
      ? { blockingReason: "No eligible adapter matched the locked request." }
      : {}),
  }));
}
//# sourceMappingURL=service.js.map
