export function createDirectorConsolePanel(consoleProjection) {
  const panel = document.createElement("section");
  panel.className = "director-console-panel";
  panel.dataset.directorConsole = "v1";

  const header = document.createElement("div");
  header.className = "director-console-header";
  const title = document.createElement("h3");
  title.textContent = consoleProjection?.title ?? "总导演计划";
  const status = document.createElement("span");
  status.className = `director-console-status ${consoleProjection?.status ?? "idle"}`;
  status.textContent = formatDirectorConsoleStatus(consoleProjection?.status);
  header.append(title, status);

  const summary = document.createElement("p");
  summary.className = "director-console-summary";
  summary.textContent = consoleProjection?.summary ?? "还没有生成前总导演计划。";

  panel.append(
    header,
    summary,
    createDirectorConsoleRecommendation(consoleProjection),
    createDirectorConsoleReviewGates(consoleProjection),
    createDirectorConsoleExecutionPreview(consoleProjection),
    createDirectorConsoleDecisionActions(consoleProjection),
  );
  return panel;
}

function createDirectorConsoleRecommendation(consoleProjection) {
  const section = document.createElement("div");
  section.className = "director-console-section";
  section.append(createDirectorConsoleSectionTitle("导演摘要"));
  const grid = document.createElement("div");
  grid.className = "director-console-metrics";
  grid.append(
    createDirectorConsoleMetric("推荐模式", consoleProjection?.recommendation?.mode?.id),
    createDirectorConsoleMetric("推荐模型", formatDirectorConsoleModel(consoleProjection)),
    createDirectorConsoleMetric("风险等级", consoleProjection?.risk?.level),
    createDirectorConsoleMetric(
      "用户锁定",
      consoleProjection?.lockImpact?.touchesUserLocks ? "触碰，需要确认" : "未触碰",
    ),
  );
  const reason = document.createElement("p");
  reason.className = "director-console-reason";
  reason.textContent = [
    consoleProjection?.recommendation?.mode?.reason,
    consoleProjection?.recommendation?.model?.reason,
  ]
    .filter(Boolean)
    .join(" ");
  section.append(grid, reason);
  return section;
}

function createDirectorConsoleReviewGates(consoleProjection) {
  const section = document.createElement("div");
  section.className = "director-console-section";
  section.append(createDirectorConsoleSectionTitle("审核结果"));
  const list = document.createElement("div");
  list.className = "director-console-gates";
  for (const gate of consoleProjection?.reviewGates ?? []) {
    const row = document.createElement("div");
    row.className = `director-console-gate ${gate.status}`;
    row.dataset.directorGate = gate.id;
    const label = document.createElement("strong");
    label.textContent = gate.label ?? gate.id;
    const score = document.createElement("span");
    score.textContent = `${gate.status} · ${gate.score}`;
    const reason = document.createElement("p");
    reason.textContent = gate.requiredFix ? `${gate.reason} ${gate.requiredFix}` : gate.reason;
    row.append(label, score, reason);
    list.append(row);
  }
  if (list.childElementCount === 0) {
    const empty = document.createElement("p");
    empty.className = "director-console-empty";
    empty.textContent = "等待总导演审核门结果。";
    list.append(empty);
  }
  section.append(list);
  return section;
}

function createDirectorConsoleExecutionPreview(consoleProjection) {
  const section = document.createElement("div");
  section.className = "director-console-section";
  section.append(createDirectorConsoleSectionTitle("执行预览"));
  const preview = consoleProjection?.executionPreview ?? {};
  const rows = document.createElement("div");
  rows.className = "director-console-preview";
  rows.append(
    createDirectorConsolePreviewRow("最终模式", preview.selectedGenerationStyle),
    createDirectorConsolePreviewRow("生成类型", preview.selectedGenerationType),
    createDirectorConsolePreviewRow("图片模型", preview.selectedImageBinding),
    createDirectorConsolePreviewRow("视频模型", preview.selectedVideoBinding),
    createDirectorConsolePreviewRow("隐藏增强", preview.hiddenPromptEnhanced ? "会增强" : "不增强"),
    createDirectorConsolePreviewRow("锁定字段", preview.willTouchUserLocks ? "需要确认" : "不触碰"),
  );
  section.append(rows);
  return section;
}

function createDirectorConsoleDecisionActions(consoleProjection) {
  const section = document.createElement("div");
  section.className = "director-console-actions";
  for (const action of consoleProjection?.decisionActions ?? []) {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("data-director-console-action", action.id);
    button.dataset.directorConsoleAction = action.id;
    button.disabled = action.enabled === false;
    button.textContent = action.label;
    button.title = action.requiresConfirmation ? "需要人工确认" : "可直接执行";
    section.append(button);
  }
  return section;
}

function createDirectorConsoleSectionTitle(text) {
  const heading = document.createElement("h4");
  heading.textContent = text;
  return heading;
}

function createDirectorConsoleMetric(label, value) {
  const metric = document.createElement("div");
  metric.className = "director-console-metric";
  const name = document.createElement("span");
  name.textContent = label;
  const body = document.createElement("strong");
  body.textContent = value ?? "待定";
  metric.append(name, body);
  return metric;
}

function createDirectorConsolePreviewRow(label, value) {
  const row = document.createElement("div");
  row.className = "director-console-preview-row";
  const name = document.createElement("span");
  name.textContent = label;
  const body = document.createElement("strong");
  body.textContent = value ?? "无";
  row.append(name, body);
  return row;
}

function formatDirectorConsoleModel(consoleProjection) {
  const model = consoleProjection?.recommendation?.model ?? {};
  return [model.videoBindingId, model.imageBindingId].filter(Boolean).join(" / ") || null;
}

function formatDirectorConsoleStatus(status) {
  const labels = {
    clarification_required: "需补充",
    blocked: "阻断",
    ready_for_preview: "可预览",
    ready_for_handoff: "可交接",
    idle: "待运行",
  };
  return labels[status] ?? status ?? "待运行";
}
