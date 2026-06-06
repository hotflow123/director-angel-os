export async function startDesktopProductionViaHostApi(options, input) {
  const fetchFn = options.fetchFn ?? globalThis.fetch;
  if (typeof fetchFn !== "function") {
    throw new Error("Desktop Host API client requires fetch.");
  }
  const hostApiUrl = normalizeHostApiUrl(options.hostApiUrl);
  const receivedAtMs = input.receivedAtMs ?? Date.now();
  const messageId = input.messageId ?? `desktop-${receivedAtMs}`;
  const peerId = options.peerId ?? "desktop-local";
  const agentId = options.agentId ?? "director";
  const channel = options.channel ?? "desktop";
  const hostId = options.hostId ?? "director-desktop";
  const bindingId = options.bindingId ?? `${channel}-main`;

  const binding = await postJson(fetchFn, hostApiUrl, "/v1/client-bindings", {
    bindingId,
    clientId: bindingId,
    displayName: options.displayName ?? "Director Desktop",
    hostId,
    channel,
    agentId,
  });

  const session = await postJson(fetchFn, hostApiUrl, "/v1/sessions", {
    bindingId,
    peerId,
    title: input.title ?? createDesktopSessionTitle(input.prompt),
  });
  const sessionId = session.session?.sessionId;
  if (typeof sessionId !== "string" || sessionId.length === 0) {
    throw new Error("Desktop Host API V1 session response did not include session.sessionId.");
  }

  const task = await postJson(fetchFn, hostApiUrl, "/v1/tasks", {
    sessionId,
    messageId,
    receivedAtMs,
    text: input.prompt,
    start: input.createRun !== false && input.previewRun !== false,
  });
  const taskId = task.task?.taskId ?? task.task?.runId ?? task.run?.runId;
  if (typeof taskId !== "string" || taskId.length === 0) {
    throw new Error("Desktop Host API V1 task response did not include task.taskId.");
  }
  const events = await getText(
    fetchFn,
    hostApiUrl,
    `/v1/tasks/${encodeURIComponent(taskId)}/events`,
  );
  const status = await getJson(fetchFn, hostApiUrl, `/v1/tasks/${encodeURIComponent(taskId)}`);

  return {
    source: "host-api-v1",
    binding,
    session,
    task,
    events,
    status,
  };
}

export async function readDesktopCatalogViaHostApi(options) {
  return getJson(
    options.fetchFn ?? globalThis.fetch,
    normalizeHostApiUrl(options.hostApiUrl),
    "/v1/catalog",
  );
}

export async function readDesktopLongTermMemoryStatusViaHostApi(options) {
  return getJson(
    options.fetchFn ?? globalThis.fetch,
    normalizeHostApiUrl(options.hostApiUrl),
    "/v1/memory/long-term/status",
  );
}

export async function readDesktopMemoryStatusViaHostApi(options) {
  return getJson(
    options.fetchFn ?? globalThis.fetch,
    normalizeHostApiUrl(options.hostApiUrl),
    "/v1/memory/status",
  );
}

export async function readDesktopCapabilitiesViaHostApi(options) {
  return getJson(
    options.fetchFn ?? globalThis.fetch,
    normalizeHostApiUrl(options.hostApiUrl),
    "/v1/capabilities",
  );
}

export async function listDesktopClientBindingsViaHostApi(options) {
  return getJson(
    options.fetchFn ?? globalThis.fetch,
    normalizeHostApiUrl(options.hostApiUrl),
    "/v1/client-bindings",
  );
}

export async function createDesktopClientBindingViaHostApi(options, input) {
  return postJson(
    options.fetchFn ?? globalThis.fetch,
    normalizeHostApiUrl(options.hostApiUrl),
    "/v1/client-bindings",
    input,
  );
}

export async function deleteDesktopClientBindingViaHostApi(options, input) {
  const fetchFn = options.fetchFn ?? globalThis.fetch;
  const hostApiUrl = normalizeHostApiUrl(options.hostApiUrl);
  const bindingId = input.bindingId;
  await deleteText(fetchFn, hostApiUrl, `/v1/client-bindings/${encodeURIComponent(bindingId)}`);
  return { bindingId, deleted: true };
}

export async function listDesktopSessionsViaHostApi(options) {
  return getJson(
    options.fetchFn ?? globalThis.fetch,
    normalizeHostApiUrl(options.hostApiUrl),
    "/v1/sessions",
  );
}

export async function createDesktopSessionViaHostApi(options, input) {
  return postJson(
    options.fetchFn ?? globalThis.fetch,
    normalizeHostApiUrl(options.hostApiUrl),
    "/v1/sessions",
    input,
  );
}

export async function createDesktopSessionMessageViaHostApi(options, input) {
  return postJson(
    options.fetchFn ?? globalThis.fetch,
    normalizeHostApiUrl(options.hostApiUrl),
    `/v1/sessions/${encodeURIComponent(input.sessionId)}/messages`,
    {
      ...(input.messageId === undefined ? {} : { messageId: input.messageId }),
      ...(input.receivedAtMs === undefined ? {} : { receivedAtMs: input.receivedAtMs }),
      text: input.text,
    },
  );
}

export async function listDesktopTasksViaHostApi(options) {
  return getJson(
    options.fetchFn ?? globalThis.fetch,
    normalizeHostApiUrl(options.hostApiUrl),
    "/v1/tasks",
  );
}

export async function submitDesktopTaskViaHostApi(options, input) {
  return postJson(
    options.fetchFn ?? globalThis.fetch,
    normalizeHostApiUrl(options.hostApiUrl),
    "/v1/tasks",
    {
      sessionId: input.sessionId,
      ...(input.messageId === undefined ? {} : { messageId: input.messageId }),
      ...(input.receivedAtMs === undefined ? {} : { receivedAtMs: input.receivedAtMs }),
      text: input.text,
      start: input.start !== false,
    },
  );
}

export async function readDesktopTaskViaHostApi(options, input) {
  return getJson(
    options.fetchFn ?? globalThis.fetch,
    normalizeHostApiUrl(options.hostApiUrl),
    `/v1/tasks/${encodeURIComponent(input.taskId)}`,
  );
}

export async function cancelDesktopTaskViaHostApi(options, input) {
  return postJson(
    options.fetchFn ?? globalThis.fetch,
    normalizeHostApiUrl(options.hostApiUrl),
    `/v1/tasks/${encodeURIComponent(input.taskId)}/cancel`,
  );
}

export async function readDesktopTaskEventsViaHostApi(options, input) {
  return getText(
    options.fetchFn ?? globalThis.fetch,
    normalizeHostApiUrl(options.hostApiUrl),
    `/v1/tasks/${encodeURIComponent(input.taskId)}/events`,
  );
}

export async function readDesktopModelAdaptersViaHostApi(options) {
  return getJson(
    options.fetchFn ?? globalThis.fetch,
    normalizeHostApiUrl(options.hostApiUrl),
    "/v1/catalog/model-adapters",
  );
}

export async function readDesktopToolsCatalogViaHostApi(options, input = {}) {
  return getJson(
    options.fetchFn ?? globalThis.fetch,
    normalizeHostApiUrl(options.hostApiUrl),
    createToolsCatalogPath(input),
  );
}

export async function readDesktopToolsEffectiveViaHostApi(options, input = {}) {
  return getJson(
    options.fetchFn ?? globalThis.fetch,
    normalizeHostApiUrl(options.hostApiUrl),
    createToolsEffectivePath(input),
  );
}

export async function invokeDesktopToolViaHostApi(options, input) {
  return postJson(
    options.fetchFn ?? globalThis.fetch,
    normalizeHostApiUrl(options.hostApiUrl),
    "/v1/tools/invoke",
    input,
  );
}

export async function listDesktopLearningJobsViaHostApi(options) {
  return getJson(
    options.fetchFn ?? globalThis.fetch,
    normalizeHostApiUrl(options.hostApiUrl),
    "/v1/learning/jobs",
  );
}

export async function createDesktopLearningJobViaHostApi(options, input) {
  return postJson(
    options.fetchFn ?? globalThis.fetch,
    normalizeHostApiUrl(options.hostApiUrl),
    "/v1/learning/jobs",
    input,
  );
}

export async function runDesktopLearningJobCommandViaHostApi(options, input) {
  return postJson(
    options.fetchFn ?? globalThis.fetch,
    normalizeHostApiUrl(options.hostApiUrl),
    `/v1/learning/jobs/${encodeURIComponent(input.jobId)}/run`,
  );
}

export async function readDesktopRunViaHostApi(options, input) {
  return getJson(
    options.fetchFn ?? globalThis.fetch,
    normalizeHostApiUrl(options.hostApiUrl),
    `/v1/runs/${encodeURIComponent(input.runId)}`,
  );
}

export async function readDesktopRunReportViaHostApi(options, input) {
  return getJson(
    options.fetchFn ?? globalThis.fetch,
    normalizeHostApiUrl(options.hostApiUrl),
    `/v1/runs/${encodeURIComponent(input.runId)}/report`,
  );
}

export async function readDesktopRunDelegationsViaHostApi(options, input) {
  return getJson(
    options.fetchFn ?? globalThis.fetch,
    normalizeHostApiUrl(options.hostApiUrl),
    `/v1/runs/${encodeURIComponent(input.runId)}/delegations`,
  );
}

export async function runDesktopSchedulerExecutorViaHostApi(options, input) {
  return postJson(
    options.fetchFn ?? globalThis.fetch,
    normalizeHostApiUrl(options.hostApiUrl),
    `/v1/runs/${encodeURIComponent(input.runId)}/scheduler-executor`,
    {
      ...(input.maxDispatches === undefined ? {} : { maxDispatches: input.maxDispatches }),
    },
  );
}

export async function runDesktopSchedulerRecoveryViaHostApi(options, input) {
  return postJson(
    options.fetchFn ?? globalThis.fetch,
    normalizeHostApiUrl(options.hostApiUrl),
    `/v1/runs/${encodeURIComponent(input.runId)}/scheduler-recovery`,
    {
      ...(input.actionId === undefined ? {} : { actionId: input.actionId }),
      ...(input.confirmCancelObservedDrift === undefined
        ? {}
        : { confirmCancelObservedDrift: input.confirmCancelObservedDrift }),
    },
  );
}

export async function createDesktopRunExperienceViaHostApi(options, input) {
  return postJson(
    options.fetchFn ?? globalThis.fetch,
    normalizeHostApiUrl(options.hostApiUrl),
    `/v1/runs/${encodeURIComponent(input.runId)}/experience`,
    {
      ...(input.intent === undefined ? {} : { intent: input.intent }),
      ...(input.privacy === undefined ? {} : { privacy: input.privacy }),
      ...(input.now === undefined ? {} : { now: input.now }),
    },
  );
}

export async function createDesktopTraceProposalExperienceViaHostApi(options, input) {
  return postJson(
    options.fetchFn ?? globalThis.fetch,
    normalizeHostApiUrl(options.hostApiUrl),
    `/v1/trace-proposals/${encodeURIComponent(input.proposalId)}/experience`,
    {
      ...(input.intent === undefined ? {} : { intent: input.intent }),
      ...(input.privacy === undefined ? {} : { privacy: input.privacy }),
      ...(input.now === undefined ? {} : { now: input.now }),
    },
  );
}

export async function createDesktopRunReflectionViaHostApi(options, input) {
  return postJson(
    options.fetchFn ?? globalThis.fetch,
    normalizeHostApiUrl(options.hostApiUrl),
    `/v1/runs/${encodeURIComponent(input.runId)}/reflection`,
    {
      ...(input.privacy === undefined ? {} : { privacy: input.privacy }),
      ...(input.now === undefined ? {} : { now: input.now }),
      ...(input.writeExperienceCandidate === undefined
        ? {}
        : { writeExperienceCandidate: input.writeExperienceCandidate }),
      ...(input.writeSoulCandidate === undefined
        ? {}
        : { writeSoulCandidate: input.writeSoulCandidate }),
    },
  );
}

export async function controlDesktopRunViaHostApi(options, input) {
  const body =
    input.action === "retry" || input.action === "approve"
      ? { assignmentId: input.assignmentId }
      : input.action === "reroute"
        ? { assignmentId: input.assignmentId, adapterId: input.adapterId }
        : undefined;
  return postJson(
    options.fetchFn ?? globalThis.fetch,
    normalizeHostApiUrl(options.hostApiUrl),
    `/v1/runs/${encodeURIComponent(input.runId)}/${input.action}`,
    body,
  );
}

export async function learnDesktopDirectoryViaHostApi(options, input) {
  return runDesktopLearningJobViaHostApi(options, {
    kind: "directory",
    sourceId: input.sourceId ?? createDesktopSourceId("desktop-directory"),
    directory: input.directory,
    ...(input.privacy === undefined ? {} : { privacy: input.privacy }),
    ...(input.nowMs === undefined ? {} : { nowMs: input.nowMs }),
    ...(input.maxDepth === undefined ? {} : { maxDepth: input.maxDepth }),
    ...(input.maxFiles === undefined ? {} : { maxFiles: input.maxFiles }),
    ...(input.maxBytesPerFile === undefined ? {} : { maxBytesPerFile: input.maxBytesPerFile }),
    ...(input.includeExtensions === undefined
      ? {}
      : { includeExtensions: input.includeExtensions }),
  });
}

export async function learnDesktopUrlViaHostApi(options, input) {
  return runDesktopLearningJobViaHostApi(options, {
    kind: "url",
    sourceId: input.sourceId ?? createDesktopSourceId("desktop-url"),
    urls: [input.url],
    ...(input.privacy === undefined ? {} : { privacy: input.privacy }),
    ...(input.nowMs === undefined ? {} : { nowMs: input.nowMs }),
    ...(input.maxBytesPerPage === undefined ? {} : { maxBytesPerPage: input.maxBytesPerPage }),
  });
}

export async function learnDesktopQueryViaHostApi(options, input) {
  return runDesktopLearningJobViaHostApi(options, {
    kind: "query",
    sourceId: input.sourceId ?? createDesktopSourceId("desktop-query"),
    queries: [input.query],
    ...(input.privacy === undefined ? {} : { privacy: input.privacy }),
    ...(input.nowMs === undefined ? {} : { nowMs: input.nowMs }),
    ...(input.maxResultsPerQuery === undefined
      ? {}
      : { maxResultsPerQuery: input.maxResultsPerQuery }),
    ...(input.maxBytesPerPage === undefined ? {} : { maxBytesPerPage: input.maxBytesPerPage }),
  });
}

export async function learnDesktopTextViaHostApi(options, input) {
  return runDesktopLearningJobViaHostApi(options, {
    kind: "text",
    sourceId: input.sourceId ?? createDesktopSourceId("desktop-text"),
    texts: [
      {
        ...(input.title === undefined ? {} : { title: input.title }),
        content: input.text,
        ...(input.sourceRef === undefined ? {} : { sourceRef: input.sourceRef }),
        ...(input.contentType === undefined ? {} : { contentType: input.contentType }),
      },
    ],
    ...(input.privacy === undefined ? {} : { privacy: input.privacy }),
    ...(input.nowMs === undefined ? {} : { nowMs: input.nowMs }),
  });
}

export async function learnDesktopAdmitViaHostApi(options, input) {
  return postJson(
    options.fetchFn ?? globalThis.fetch,
    normalizeHostApiUrl(options.hostApiUrl),
    "/v1/learning/admit",
    {
      source_id: input.sourceId ?? input.source_id ?? createDesktopSourceId("desktop-admit"),
      sources: input.sources.map((source) => ({
        ...(source.title === undefined ? {} : { title: source.title }),
        body: source.body,
        ...(source.sourceRef === undefined ? {} : { url: source.sourceRef }),
        ...(source.contentType === undefined ? {} : { content_type: source.contentType }),
      })),
      ...(input.privacy === undefined ? {} : { privacy: input.privacy }),
      ...(input.nowMs === undefined ? {} : { nowMs: input.nowMs }),
    },
  );
}

export async function createDesktopExperienceCategoryViaHostApi(options, input) {
  return postJson(
    options.fetchFn ?? globalThis.fetch,
    normalizeHostApiUrl(options.hostApiUrl),
    "/v1/experience/categories",
    createTaxonomyCategoryBody(input),
  );
}

export async function createDesktopExperienceTagViaHostApi(options, input) {
  return postJson(
    options.fetchFn ?? globalThis.fetch,
    normalizeHostApiUrl(options.hostApiUrl),
    "/v1/experience/tags",
    createTaxonomyTagBody(input),
  );
}

export async function classifyDesktopExperienceViaHostApi(options, input) {
  return postJson(
    options.fetchFn ?? globalThis.fetch,
    normalizeHostApiUrl(options.hostApiUrl),
    `/v1/experience/candidates/${encodeURIComponent(input.candidateId)}/taxonomy`,
    createTaxonomyBindingBody(input),
  );
}

export async function decideDesktopExperienceViaHostApi(options, input) {
  return postJson(
    options.fetchFn ?? globalThis.fetch,
    normalizeHostApiUrl(options.hostApiUrl),
    `/v1/experience/candidates/${encodeURIComponent(input.candidateId)}/${input.action}`,
    createOperatorBody(input),
  );
}

export async function updateDesktopExperienceViaHostApi(options, input) {
  return patchJson(
    options.fetchFn ?? globalThis.fetch,
    normalizeHostApiUrl(options.hostApiUrl),
    `/v1/experience/candidates/${encodeURIComponent(input.candidateId)}`,
    {
      ...(input.title === undefined ? {} : { title: input.title }),
      ...(input.summary === undefined ? {} : { summary: input.summary }),
      ...(input.applicability === undefined ? {} : { applicability: input.applicability }),
      ...(input.risks === undefined ? {} : { risks: input.risks }),
      ...(input.tags === undefined ? {} : { tags: input.tags }),
      ...(input.author === undefined ? {} : { author: input.author }),
    },
  );
}

export async function decideDesktopKnowledgeViaHostApi(options, input) {
  return postJson(
    options.fetchFn ?? globalThis.fetch,
    normalizeHostApiUrl(options.hostApiUrl),
    `/v1/knowledge/candidates/${encodeURIComponent(input.packId)}/${input.action}`,
    createOperatorBody(input),
  );
}

export async function previewDesktopKnowledgeRecallViaHostApi(options, input) {
  return postJson(
    options.fetchFn ?? globalThis.fetch,
    normalizeHostApiUrl(options.hostApiUrl),
    "/v1/knowledge/recall-preview",
    createKnowledgeRecallBody(input),
  );
}

export async function previewDesktopMemoryRecallViaHostApi(options, input) {
  return postJson(
    options.fetchFn ?? globalThis.fetch,
    normalizeHostApiUrl(options.hostApiUrl),
    "/v1/memory/recall-preview",
    createMemoryRecallBody(input),
  );
}

export async function listDesktopMemoryPublicationsViaHostApi(options, input = {}) {
  return getJson(
    options.fetchFn ?? globalThis.fetch,
    normalizeHostApiUrl(options.hostApiUrl),
    createMemoryPublicationsPath(input),
  );
}

export async function governDesktopMemoryPublicationViaHostApi(options, input) {
  return postJson(
    options.fetchFn ?? globalThis.fetch,
    normalizeHostApiUrl(options.hostApiUrl),
    `/v1/memory/publications/${encodeURIComponent(input.recordId)}/${input.action}`,
    createOperatorBody(input),
  );
}

export async function listDesktopEvidenceViaHostApi(options, input = {}) {
  return getJson(
    options.fetchFn ?? globalThis.fetch,
    normalizeHostApiUrl(options.hostApiUrl),
    createEvidenceListPath(input),
  );
}

export async function readDesktopEvidenceViaHostApi(options, input) {
  return getJson(
    options.fetchFn ?? globalThis.fetch,
    normalizeHostApiUrl(options.hostApiUrl),
    `/v1/evidence/${encodeURIComponent(input.evidenceId)}`,
  );
}

export async function readDesktopEvidenceContentViaHostApi(options, input) {
  return getJson(
    options.fetchFn ?? globalThis.fetch,
    normalizeHostApiUrl(options.hostApiUrl),
    createEvidenceContentPath(input),
  );
}

export async function createDesktopSkillCategoryViaHostApi(options, input) {
  return postJson(
    options.fetchFn ?? globalThis.fetch,
    normalizeHostApiUrl(options.hostApiUrl),
    "/v1/skills/taxonomy/categories",
    createTaxonomyCategoryBody(input),
  );
}

export async function createDesktopSkillTagViaHostApi(options, input) {
  return postJson(
    options.fetchFn ?? globalThis.fetch,
    normalizeHostApiUrl(options.hostApiUrl),
    "/v1/skills/taxonomy/tags",
    createTaxonomyTagBody(input),
  );
}

export async function classifyDesktopSkillViaHostApi(options, input) {
  return postJson(
    options.fetchFn ?? globalThis.fetch,
    normalizeHostApiUrl(options.hostApiUrl),
    `/v1/skills/${encodeURIComponent(input.skillId)}/taxonomy`,
    createTaxonomyBindingBody(input),
  );
}

export async function setDesktopSkillEnablementViaHostApi(options, input) {
  return putJson(
    options.fetchFn ?? globalThis.fetch,
    normalizeHostApiUrl(options.hostApiUrl),
    `/v1/skills/${encodeURIComponent(input.skillId)}/enabled`,
    {
      enabled: input.enabled,
      ...(input.actor === undefined ? {} : { actor: input.actor }),
      ...(input.note === undefined ? {} : { note: input.note }),
      ...(input.nowMs === undefined ? {} : { nowMs: input.nowMs }),
    },
  );
}

export async function viewDesktopSkillViaHostApi(options, input) {
  if (input?.recordUsage === true) {
    return postJson(
      options.fetchFn ?? globalThis.fetch,
      normalizeHostApiUrl(options.hostApiUrl),
      `/v1/skills/${encodeURIComponent(input.skillId)}/view`,
      {
        ...(input.actor === undefined ? {} : { actor: input.actor }),
        ...(input.reason === undefined ? {} : { reason: input.reason }),
        ...(input.nowMs === undefined ? {} : { nowMs: input.nowMs }),
      },
    );
  }
  return getJson(
    options.fetchFn ?? globalThis.fetch,
    normalizeHostApiUrl(options.hostApiUrl),
    `/v1/skills/${encodeURIComponent(input.skillId)}`,
  );
}

export async function updateDesktopSkillViaHostApi(options, input) {
  return patchJson(
    options.fetchFn ?? globalThis.fetch,
    normalizeHostApiUrl(options.hostApiUrl),
    `/v1/skills/${encodeURIComponent(input.skillId)}`,
    {
      ...(input.title === undefined ? {} : { title: input.title }),
      ...(input.description === undefined ? {} : { description: input.description }),
      ...(input.content === undefined ? {} : { content: input.content }),
      ...(input.version === undefined ? {} : { version: input.version }),
      ...(input.tags === undefined ? {} : { tags: input.tags }),
      ...(input.toolNames === undefined ? {} : { toolNames: input.toolNames }),
      ...(input.priority === undefined ? {} : { priority: input.priority }),
      ...(input.actor === undefined ? {} : { actor: input.actor }),
      ...(input.nowMs === undefined ? {} : { nowMs: input.nowMs }),
    },
  );
}

export async function deleteDesktopSkillViaHostApi(options, input) {
  return deleteJson(
    options.fetchFn ?? globalThis.fetch,
    normalizeHostApiUrl(options.hostApiUrl),
    `/v1/skills/${encodeURIComponent(input.skillId)}`,
    {
      ...(input.actor === undefined ? {} : { actor: input.actor }),
      ...(input.note === undefined ? {} : { note: input.note }),
      ...(input.now === undefined ? {} : { now: input.now }),
    },
  );
}

export async function proposeDesktopSkillFromExperienceViaHostApi(options, input) {
  return postJson(
    options.fetchFn ?? globalThis.fetch,
    normalizeHostApiUrl(options.hostApiUrl),
    "/v1/skills/proposals/from-experience",
    {
      candidateId: input.candidateId,
      ...(input.author === undefined ? {} : { author: input.author }),
      ...(input.nowMs === undefined ? {} : { nowMs: input.nowMs }),
    },
  );
}

export async function decideDesktopSkillProposalViaHostApi(options, input) {
  return postJson(
    options.fetchFn ?? globalThis.fetch,
    normalizeHostApiUrl(options.hostApiUrl),
    `/v1/skills/proposals/${encodeURIComponent(input.proposalId)}/${input.action}`,
    createOperatorBody(input),
  );
}

export async function listDesktopSoulCandidatesViaHostApi(options) {
  return getJson(
    options.fetchFn ?? globalThis.fetch,
    normalizeHostApiUrl(options.hostApiUrl),
    "/v1/soul/candidates",
  );
}

export async function readDesktopSoulCandidateViaHostApi(options, input) {
  return getJson(
    options.fetchFn ?? globalThis.fetch,
    normalizeHostApiUrl(options.hostApiUrl),
    `/v1/soul/candidates/${encodeURIComponent(input.candidateId)}`,
  );
}

export async function decideDesktopSoulCandidateViaHostApi(options, input) {
  return postJson(
    options.fetchFn ?? globalThis.fetch,
    normalizeHostApiUrl(options.hostApiUrl),
    `/v1/soul/candidates/${encodeURIComponent(input.candidateId)}/${input.action}`,
    createOperatorBody(input),
  );
}

export async function viewDesktopSoulViaHostApi(options) {
  return getJson(
    options.fetchFn ?? globalThis.fetch,
    normalizeHostApiUrl(options.hostApiUrl),
    "/v1/soul",
  );
}

export async function runDesktopHeartbeatViaHostApi(options, input = {}) {
  return postJson(
    options.fetchFn ?? globalThis.fetch,
    normalizeHostApiUrl(options.hostApiUrl),
    "/v1/heartbeat/status",
    {
      ...(input.now === undefined ? {} : { now: input.now }),
    },
  );
}

export async function runDesktopDailySelfReflectionViaHostApi(options, input = {}) {
  return postJson(
    options.fetchFn ?? globalThis.fetch,
    normalizeHostApiUrl(options.hostApiUrl),
    "/v1/self-reflection/daily",
    {
      ...(input.date === undefined ? {} : { date: input.date }),
      ...(input.now === undefined ? {} : { now: input.now }),
    },
  );
}

export async function previewDesktopMaintenanceViaHostApi(options, input = {}) {
  const query = createMaintenanceQuery(input);
  return getJson(
    options.fetchFn ?? globalThis.fetch,
    normalizeHostApiUrl(options.hostApiUrl),
    query.length > 0 ? `/v1/maintenance?${query}` : "/v1/maintenance",
  );
}

export async function applyDesktopMaintenanceViaHostApi(options, input = {}) {
  return postJson(
    options.fetchFn ?? globalThis.fetch,
    normalizeHostApiUrl(options.hostApiUrl),
    "/v1/maintenance",
    createMaintenanceBody(input),
  );
}

async function postJson(fetchFn, hostApiUrl, path, body) {
  const response = await fetchFn(buildUrl(hostApiUrl, path), {
    method: "POST",
    headers: createDesktopHostApiRequestHeaders({ "content-type": "application/json" }),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return readJsonResponse(response, path);
}

async function patchJson(fetchFn, hostApiUrl, path, body) {
  const response = await fetchFn(buildUrl(hostApiUrl, path), {
    method: "PATCH",
    headers: createDesktopHostApiRequestHeaders({ "content-type": "application/json" }),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return readJsonResponse(response, path);
}

async function putJson(fetchFn, hostApiUrl, path, body) {
  const response = await fetchFn(buildUrl(hostApiUrl, path), {
    method: "PUT",
    headers: createDesktopHostApiRequestHeaders({ "content-type": "application/json" }),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return readJsonResponse(response, path);
}

async function deleteJson(fetchFn, hostApiUrl, path, body) {
  const response = await fetchFn(buildUrl(hostApiUrl, path), {
    method: "DELETE",
    headers: createDesktopHostApiRequestHeaders({ "content-type": "application/json" }),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return readJsonResponse(response, path);
}

async function deleteText(fetchFn, hostApiUrl, path) {
  const response = await fetchFn(buildUrl(hostApiUrl, path), {
    method: "DELETE",
    headers: createDesktopHostApiRequestHeaders(),
  });
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`Director Host API ${path} HTTP ${response.status}: ${raw.slice(0, 300)}`);
  }
  return raw;
}

async function getJson(fetchFn, hostApiUrl, path) {
  const response = await fetchFn(buildUrl(hostApiUrl, path), {
    method: "GET",
    headers: createDesktopHostApiRequestHeaders(),
  });
  return readJsonResponse(response, path);
}

async function getText(fetchFn, hostApiUrl, path) {
  const response = await fetchFn(buildUrl(hostApiUrl, path), {
    method: "GET",
    headers: createDesktopHostApiRequestHeaders(),
  });
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`Director Host API ${path} HTTP ${response.status}: ${raw.slice(0, 300)}`);
  }
  return raw;
}

async function runDesktopLearningJobViaHostApi(options, request) {
  const fetchFn = options.fetchFn ?? globalThis.fetch;
  const hostApiUrl = normalizeHostApiUrl(options.hostApiUrl);
  const created = await postJson(fetchFn, hostApiUrl, "/v1/learning/jobs", request);
  const jobId = created?.job?.jobId ?? request.jobId;
  if (typeof jobId !== "string" || jobId.length === 0) {
    throw new Error("Desktop Host API V1 learning job response did not include job.jobId.");
  }
  const run = await postJson(
    fetchFn,
    hostApiUrl,
    `/v1/learning/jobs/${encodeURIComponent(jobId)}/run`,
  );
  const result = run?.result ?? {};
  return {
    ...run,
    createdJob: created?.job ?? null,
    result,
    candidates: Array.isArray(result?.candidates) ? result.candidates : [],
    quarantineCount: Number.isFinite(result?.quarantineCount) ? result.quarantineCount : 0,
  };
}

async function readJsonResponse(response, path) {
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`Director Host API ${path} HTTP ${response.status}: ${raw.slice(0, 300)}`);
  }
  return raw.length === 0 ? {} : JSON.parse(raw);
}

function buildUrl(hostApiUrl, path) {
  return new URL(path, `${hostApiUrl}/`).toString();
}

function createDesktopHostApiRequestHeaders(headers = {}) {
  const token = readDesktopHostApiBearerToken();
  return token === undefined
    ? headers
    : {
        ...headers,
        authorization: `Bearer ${token}`,
      };
}

function readDesktopHostApiBearerToken() {
  if (typeof process === "undefined") {
    return undefined;
  }
  const token = process.env?.DIRECTOR_HOST_API_BEARER_TOKEN?.trim();
  return token === undefined || token.length === 0 ? undefined : token;
}

function createToolsCatalogPath(input) {
  const params = new URLSearchParams();
  appendOptionalSearchParam(params, "agentId", input.agentId);
  const query = params.toString();
  return query.length > 0 ? `/v1/tools/catalog?${query}` : "/v1/tools/catalog";
}

function createToolsEffectivePath(input) {
  const params = new URLSearchParams();
  appendOptionalSearchParam(params, "agentId", input.agentId);
  appendOptionalSearchParam(params, "sessionKey", input.sessionKey);
  appendOptionalSearchParam(params, "profile", input.profile);
  if (input.includeUnavailable !== undefined) {
    params.set("includeUnavailable", input.includeUnavailable ? "true" : "false");
  }
  const query = params.toString();
  return query.length > 0 ? `/v1/tools/effective?${query}` : "/v1/tools/effective";
}

function createMemoryPublicationsPath(input) {
  const params = new URLSearchParams();
  appendOptionalSearchParam(params, "status", input.status);
  if (input.limit !== undefined) {
    params.set("limit", String(input.limit));
  }
  const query = params.toString();
  return query.length > 0 ? `/v1/memory/publications?${query}` : "/v1/memory/publications";
}

function createEvidenceListPath(input) {
  const params = new URLSearchParams();
  appendOptionalSearchParam(params, "sessionKey", input.sessionKey);
  appendOptionalSearchParam(params, "runId", input.runId);
  appendOptionalSearchParam(params, "taskId", input.taskId);
  appendOptionalSearchParam(params, "sourceRef", input.sourceRef);
  appendOptionalSearchParam(params, "sourceSnapshotId", input.sourceSnapshotId);
  if (input.limit !== undefined) {
    params.set("limit", String(input.limit));
  }
  const query = params.toString();
  return query.length > 0 ? `/v1/evidence?${query}` : "/v1/evidence";
}

function createEvidenceContentPath(input) {
  const params = new URLSearchParams();
  if (input.maxChars !== undefined) {
    params.set("maxChars", String(input.maxChars));
  }
  const query = params.toString();
  const basePath = `/v1/evidence/${encodeURIComponent(input.evidenceId)}/content`;
  return query.length > 0 ? `${basePath}?${query}` : basePath;
}

function appendOptionalSearchParam(params, key, value) {
  if (typeof value === "string" && value.trim().length > 0) {
    params.set(key, value.trim());
  }
}

function normalizeHostApiUrl(value) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("Desktop Host API client requires hostApiUrl.");
  }
  return value.trim().replace(/\/+$/u, "");
}

function createDesktopSourceId(prefix) {
  return `${prefix}-${Date.now()}`;
}

function createDesktopSessionTitle(prompt) {
  const normalized = String(prompt ?? "")
    .trim()
    .replace(/\s+/gu, " ");
  return normalized.length > 48 ? `${normalized.slice(0, 48)}...` : normalized || "Desktop task";
}

function createOperatorBody(input) {
  return {
    ...(input.actor === undefined ? {} : { actor: input.actor }),
    ...(input.author === undefined ? {} : { author: input.author }),
    ...(input.note === undefined ? {} : { note: input.note }),
    ...(input.now === undefined ? {} : { now: input.now }),
  };
}

function createKnowledgeRecallBody(input) {
  return {
    ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
    ...(input.groupId === undefined ? {} : { groupId: input.groupId }),
    ...(input.anchorIds === undefined ? {} : { anchorIds: input.anchorIds }),
    ...(input.tags === undefined ? {} : { tags: input.tags }),
    ...(input.preferredAdapters === undefined
      ? {}
      : { preferredAdapters: input.preferredAdapters }),
    ...(input.generationType === undefined ? {} : { generationType: input.generationType }),
    ...(input.generationStyle === undefined ? {} : { generationStyle: input.generationStyle }),
    ...(input.includeGlobalExperience === undefined
      ? {}
      : { includeGlobalExperience: input.includeGlobalExperience }),
    ...(input.maxHits === undefined ? {} : { maxHits: input.maxHits }),
    ...(input.maxChars === undefined ? {} : { maxChars: input.maxChars }),
  };
}

function createMemoryRecallBody(input) {
  return {
    projectId: input.projectId,
    ...(input.groupId === undefined ? {} : { groupId: input.groupId }),
    ...(input.anchorId === undefined ? {} : { anchorIds: [input.anchorId] }),
    ...(input.anchorIds === undefined ? {} : { anchorIds: input.anchorIds }),
    ...(input.adapterId === undefined ? {} : { selectedAdapters: [input.adapterId] }),
    ...(input.selectedAdapters === undefined ? {} : { selectedAdapters: input.selectedAdapters }),
    ...(input.generationType === undefined ? {} : { generationType: input.generationType }),
    ...(input.generationStyle === undefined ? {} : { generationStyle: input.generationStyle }),
    ...(input.tags === undefined ? {} : { knowledgeSignalTags: input.tags }),
    ...(input.knowledgeSignalTags === undefined
      ? {}
      : { knowledgeSignalTags: input.knowledgeSignalTags }),
    ...(input.maxHits === undefined ? {} : { maxHits: input.maxHits }),
  };
}

function createMaintenanceBody(input) {
  return {
    ...(input.nowMs === undefined ? {} : { nowMs: input.nowMs }),
    ...(createMaintenancePolicy(input) === undefined
      ? {}
      : { policy: createMaintenancePolicy(input) }),
  };
}

function createMaintenanceQuery(input) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({
    ...(input.nowMs === undefined ? {} : { nowMs: input.nowMs }),
    ...(createMaintenancePolicy(input) ?? {}),
  })) {
    if (value !== undefined && value !== null && value !== "") {
      params.set(key, String(value));
    }
  }
  return params.toString();
}

function createMaintenancePolicy(input) {
  const policy = {};
  for (const key of [
    "logRetentionDays",
    "logMaxBytes",
    "archivePromotedExperienceAfterDays",
    "archiveRejectedExperienceAfterDays",
    "archiveQuarantineAfterDays",
    "archiveUnreferencedArtifactsAfterDays",
    "staleUnreviewedExperienceDays",
    "staleUnreviewedMinimumScore",
    "archiveRejectedKnowledgeAfterDays",
    "staleUnreviewedKnowledgeDays",
    "archiveOrphanKnowledgeReviewsAfterDays",
    "knowledgeHistoryRetentionVersions",
    "archiveKnowledgeRollbackAfterDays",
  ]) {
    if (input[key] !== undefined) {
      policy[key] = input[key];
    }
  }
  return Object.keys(policy).length === 0 ? undefined : policy;
}

function createTaxonomyCategoryBody(input) {
  return {
    ...(input.categoryId === undefined ? {} : { categoryId: input.categoryId }),
    name: input.name,
    ...(input.description === undefined ? {} : { description: input.description }),
    ...(input.parentId === undefined ? {} : { parentId: input.parentId }),
    ...(input.color === undefined ? {} : { color: input.color }),
    ...(input.nowMs === undefined ? {} : { nowMs: input.nowMs }),
  };
}

function createTaxonomyTagBody(input) {
  return {
    ...(input.tagId === undefined ? {} : { tagId: input.tagId }),
    name: input.name,
    ...(input.description === undefined ? {} : { description: input.description }),
    ...(input.color === undefined ? {} : { color: input.color }),
    ...(input.nowMs === undefined ? {} : { nowMs: input.nowMs }),
  };
}

function createTaxonomyBindingBody(input) {
  return {
    ...(input.categoryId === undefined ? {} : { categoryId: input.categoryId }),
    tagIds: input.tagIds ?? [],
    ...(input.updatedBy === undefined ? {} : { updatedBy: input.updatedBy }),
    ...(input.nowMs === undefined ? {} : { nowMs: input.nowMs }),
  };
}
