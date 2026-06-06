export function createEvidenceDisclosureDetails(evidenceDisclosure, options = {}) {
  const lines = formatEvidenceDisclosureLines(evidenceDisclosure);
  const controls = createMediaAuthorizationControls(evidenceDisclosure, options);
  if (lines.length === 0 && controls === null) {
    return null;
  }
  const details = document.createElement("details");
  details.className = "result-evidence-disclosure";
  const summary = document.createElement("summary");
  summary.textContent = "查看读取证据";
  const body = document.createElement("div");
  body.className = "result-evidence-body";
  body.textContent = lines.join("\n");
  details.append(summary, body);
  if (controls !== null) {
    details.append(controls);
  }
  return details;
}

export function createMediaAuthorizationControls(evidenceDisclosure, options = {}) {
  const sources = Array.isArray(evidenceDisclosure?.sources)
    ? evidenceDisclosure.sources
    : evidenceDisclosure
      ? [evidenceDisclosure]
      : [];
  const actionableSource = sources.find((source) => {
    const mediaAdmission = source?.mediaAdmission && typeof source.mediaAdmission === "object" ? source.mediaAdmission : null;
    return (
      mediaAdmission !== null &&
      (mediaAdmission.requiredNextAction === "request_user_authorization" ||
        mediaAdmission.requiredNextAction === "run_media_understanding_plan")
    );
  });
  if (!actionableSource) {
    return null;
  }
  const mediaAuthorization =
    actionableSource?.mediaAuthorization && typeof actionableSource.mediaAuthorization === "object"
      ? actionableSource.mediaAuthorization
      : actionableSource?.mediaAuthorizationRequest &&
          typeof actionableSource.mediaAuthorizationRequest === "object"
        ? actionableSource.mediaAuthorizationRequest
        : {};
  const recommendedMode = readEvidenceDisclosureString(mediaAuthorization.recommendedMode);
  const authorizationOptions = Array.isArray(mediaAuthorization?.options)
    ? mediaAuthorization.options
    : [];
  const row = document.createElement("div");
  row.className = "media-authorization-actions";
  const question = document.createElement("p");
  question.className = "media-authorization-question";
  question.textContent = recommendedMode
    ? `媒体处理授权 · 推荐 ${formatMediaAuthorizationModeLabel(recommendedMode)}`
    : "媒体处理授权";
  row.append(
    question,
    createMediaAuthorizationButton(actionableSource, "media_inventory", "只记录清单", options, {
      recommendedMode,
      authorizationOptions,
    }),
    createMediaAuthorizationButton(actionableSource, "low_cost", "低成本理解", options, {
      recommendedMode,
      authorizationOptions,
    }),
    createMediaAuthorizationButton(actionableSource, "deep_multimodal", "深度理解", options, {
      recommendedMode,
      authorizationOptions,
    }),
  );
  return row;
}

function createMediaAuthorizationButton(source, mode, label, options = {}, metadata = {}) {
  const isRecommended = metadata.recommendedMode === mode;
  const option = metadata.authorizationOptions?.find?.((item) => item?.mode === mode);
  const payload = resolveMediaAuthorizationActionPayload(source, mode);
  const budgetSummary = formatMediaAuthorizationBudgetSummary(payload);
  const button = document.createElement("button");
  button.type = "button";
  button.className = "secondary-button compact media-authorization-button";
  button.dataset.mediaAuthorizationMode = mode;
  button.dataset.recommended = String(isRecommended);
  if (payload.tokenBudget !== undefined) {
    button.dataset.tokenBudget = String(payload.tokenBudget);
  }
  if (payload.maxAssets !== undefined) {
    button.dataset.maxAssets = String(payload.maxAssets);
  }
  button.textContent = [
    label,
    isRecommended ? "推荐" : "",
    budgetSummary,
  ].filter(Boolean).join(" · ");
  button.setAttribute(
    "aria-label",
    [
      `媒体授权：${label}`,
      isRecommended ? "推荐档位" : "",
      budgetSummary,
      readEvidenceDisclosureString(option?.description),
    ]
      .filter(Boolean)
      .join("；"),
  );
  button.addEventListener("click", async () => {
    await options.onAuthorizeMedia?.(source, mode, button);
  });
  return button;
}

function formatMediaAuthorizationBudgetSummary(payload) {
  const fields = [];
  if (payload?.tokenBudget !== undefined) {
    fields.push(`${formatMediaAuthorizationNumber(payload.tokenBudget)} tokens`);
  }
  if (payload?.maxAssets !== undefined) {
    fields.push(`最多 ${formatMediaAuthorizationNumber(payload.maxAssets)} 个媒体`);
  }
  return fields.join(" · ");
}

function formatMediaAuthorizationNumber(value) {
  return Number.isFinite(value) ? Math.trunc(value).toLocaleString("en-US") : String(value);
}

function formatMediaAuthorizationModeLabel(mode) {
  if (mode === "media_inventory") {
    return "只记录清单";
  }
  if (mode === "low_cost") {
    return "低成本理解";
  }
  if (mode === "deep_multimodal") {
    return "深度理解";
  }
  return mode;
}

export function resolveMediaAuthorizationActionPayload(source, mode) {
  const mediaAdmission = source?.mediaAdmission && typeof source.mediaAdmission === "object" ? source.mediaAdmission : {};
  const mediaAuthorization =
    source?.mediaAuthorization && typeof source.mediaAuthorization === "object"
      ? source.mediaAuthorization
      : source?.mediaAuthorizationRequest && typeof source.mediaAuthorizationRequest === "object"
        ? source.mediaAuthorizationRequest
        : {};
  const mediaBudget = mediaAdmission?.budget && typeof mediaAdmission.budget === "object" ? mediaAdmission.budget : {};
  const estimatedTokenBudget =
    mediaAuthorization?.estimatedTokenBudget && typeof mediaAuthorization.estimatedTokenBudget === "object"
      ? mediaAuthorization.estimatedTokenBudget
      : mediaAdmission?.estimatedTokenBudget && typeof mediaAdmission.estimatedTokenBudget === "object"
        ? mediaAdmission.estimatedTokenBudget
        : {};
  const authorizationBudget = mediaAuthorization?.budget && typeof mediaAuthorization.budget === "object" ? mediaAuthorization.budget : {};
  const artifactId = readEvidenceDisclosureString(
    source?.artifactId ??
      source?.artifact_id ??
      source?.artifact?.artifactId ??
      source?.artifact?.artifact_id ??
      source?.artifact?.id ??
      source?.metadata?.artifactId ??
      source?.metadata?.artifact_id,
  );
  const candidateId = readEvidenceDisclosureString(
    source?.candidateId ??
      source?.candidate_id ??
      source?.candidate?.candidateId ??
      source?.candidate?.candidate_id ??
      source?.candidate?.id ??
      source?.candidate?.metadata?.id ??
      source?.metadata?.candidateId ??
      source?.metadata?.candidate_id,
  );
  const sourceRef = readEvidenceDisclosureString(
    source?.sourceRef ??
      source?.source_ref ??
      source?.url ??
      source?.sourceUrl ??
      source?.source_url ??
      source?.metadata?.sourceRef ??
      source?.metadata?.source_ref ??
      source?.metadata?.sourceUrl ??
      source?.metadata?.source_url ??
      source?.artifact?.sourceRef ??
      source?.artifact?.source_ref,
  );
  const lowCostTokenLimit = readEvidenceDisclosureFiniteNumber(
    estimatedTokenBudget.lowCost ?? authorizationBudget.lowCostTokenLimit ?? mediaBudget.lowCostTokenLimit,
  );
  const deepTokenLimit = readEvidenceDisclosureFiniteNumber(
    estimatedTokenBudget.deepMultimodal ?? authorizationBudget.tokenLimit ?? mediaBudget.tokenLimit,
  );
  const fileCountLimit = readEvidenceDisclosureFiniteNumber(
    authorizationBudget.fileCountLimit ?? mediaBudget.fileCountLimit,
  );
  let tokenBudget = 0;
  if (mode === "media_inventory") {
    tokenBudget = 0;
  }
  if (mode === "low_cost") {
    tokenBudget = lowCostTokenLimit ?? deepTokenLimit;
  }
  if (mode === "deep_multimodal") {
    tokenBudget = deepTokenLimit;
  }
  const maxAssets =
    fileCountLimit ?? readEvidenceDisclosureFiniteNumber(source?.mediaCount ?? source?.media_count) ?? undefined;
  return {
    ...(artifactId === undefined ? {} : { artifactId }),
    ...(candidateId === undefined ? {} : { candidateId }),
    ...(sourceRef === undefined ? {} : { sourceRef }),
    mode,
    userAuthorized: mode !== "media_inventory",
    ...(tokenBudget === undefined ? {} : { tokenBudget }),
    ...(maxAssets === undefined ? {} : { maxAssets }),
  };
}

function readEvidenceDisclosureString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readEvidenceDisclosureFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function formatEvidenceDisclosureLines(evidenceDisclosure) {
  const sources = Array.isArray(evidenceDisclosure?.sources)
    ? evidenceDisclosure.sources
    : evidenceDisclosure
      ? [evidenceDisclosure]
      : [];
  return sources
    .filter(Boolean)
    .slice(0, 8)
    .map((source, index) => {
      const fullBodyChars = Number.isFinite(source.fullBodyChars)
        ? source.fullBodyChars
        : Number.isFinite(source.full_body_chars)
          ? source.full_body_chars
          : 0;
      const mediaCount = Number.isFinite(source.mediaCount)
        ? source.mediaCount
        : Number.isFinite(source.media_count)
          ? source.media_count
          : 0;
      const admitted = source.admitted === true || source.persistedToKnowledge === true;
      const readStatus = readEvidenceDisclosureString(source.readStatus ?? source.read_status) ?? "";
      const sourceAccessStatus =
        readEvidenceDisclosureString(source.sourceAccessStatus ?? source.source_access_status) ?? "";
      const failedReason = readEvidenceDisclosureString(source.failedReason ?? source.failed_reason) ?? "";
      const evidenceId = readEvidenceDisclosureLedgerId(source);
      const summaryFields = [
        `${index + 1}. ${formatEvidenceDisclosureTitle(source)}`,
        `全文 ${fullBodyChars} 字符`,
        formatEvidenceDisclosureMediaCount(source, mediaCount),
        evidenceId === undefined ? "" : `证据：${evidenceId}`,
        admitted ? "已入库" : "待审",
        formatEvidenceDisclosureReadStatus(readStatus, sourceAccessStatus, failedReason),
      ];
      return summaryFields.filter(Boolean).join(" · ");
    });
}

function readEvidenceDisclosureLedgerId(source) {
  const contentRef =
    source?.contentRef && typeof source.contentRef === "object"
      ? source.contentRef
      : source?.content_ref && typeof source.content_ref === "object"
        ? source.content_ref
        : source?.metadata?.contentRef && typeof source.metadata.contentRef === "object"
          ? source.metadata.contentRef
          : source?.metadata?.content_ref && typeof source.metadata.content_ref === "object"
            ? source.metadata.content_ref
            : {};
  return readEvidenceDisclosureString(
    source?.evidenceId ??
      source?.evidence_id ??
      contentRef.evidenceId ??
      contentRef.evidence_id ??
      contentRef.id,
  );
}

export function formatEvidenceDisclosureMediaCount(source, mediaCount) {
  if (mediaCount <= 0) {
    return "媒体 0 个（未发现）";
  }
  const mediaAdmission = source?.mediaAdmission ?? source?.media_admission;
  const mediaUnderstandingStatus = readEvidenceDisclosureString(
    source?.mediaUnderstandingStatus ?? source?.media_understanding_status,
  );
  const mediaUnderstood =
    source?.mediaUnderstood === true ||
    source?.media_understood === true ||
    mediaAdmission?.canAdmitMediaContent === true ||
    /^(?:understood|understood_or_metadata_understood)$/iu.test(mediaUnderstandingStatus ?? "");
  return mediaUnderstood ? `媒体 ${mediaCount} 个（已理解）` : `媒体 ${mediaCount} 个（未授权理解）`;
}

export function formatEvidenceDisclosureTitle(source) {
  const rawTitle = readEvidenceDisclosureString(source?.title);
  const url = readEvidenceDisclosureString(source?.url);
  if (url !== undefined) {
    return `来源：${url}`;
  }
  if (rawTitle !== undefined && !/^OpenCLI\s+Twitter\/X\s+article$/iu.test(rawTitle)) {
    return rawTitle;
  }
  return "来源";
}

export function formatEvidenceDisclosureReadStatus(readStatus, sourceAccessStatus, failedReason) {
  if (failedReason) {
    return `失败原因：${failedReason}`;
  }
  if (/^read$/iu.test(readStatus)) {
    return "已读取";
  }
  if (/^(?:available|ok|success)$/iu.test(sourceAccessStatus)) {
    return "可访问";
  }
  if (readStatus) {
    return `读取状态：${readStatus}`;
  }
  if (sourceAccessStatus) {
    return `访问状态：${sourceAccessStatus}`;
  }
  return null;
}
