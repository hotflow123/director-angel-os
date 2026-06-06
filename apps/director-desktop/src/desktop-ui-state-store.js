import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

export function resolveDesktopUiStateFilePath(dataDir) {
  const root = basename(dataDir) === ".hotflow" ? dataDir : join(dataDir, ".hotflow");
  return join(root, "director-desktop", "ui-state.json");
}

export function resolveConversationRuntimeRunsFilePath(dataDir) {
  const root = basename(dataDir) === ".hotflow" ? dataDir : join(dataDir, ".hotflow");
  return join(root, "conversation-runtime", "runs.json");
}

export function createDesktopUiStateFileStore({ dataDir }) {
  const filePath = resolveDesktopUiStateFilePath(dataDir);
  const runsPath = resolveConversationRuntimeRunsFilePath(dataDir);
  return {
    read() {
      if (!existsSync(filePath)) {
        return null;
      }
      try {
        const parsed = JSON.parse(readFileSync(filePath, "utf8"));
        if (!parsed || typeof parsed !== "object") {
          return null;
        }
        const repaired = repairDesktopTranscriptFromRuntimeRuns(parsed, readConversationRuntimeRuns(runsPath));
        if (repaired.changed) {
          writeDesktopUiStateSnapshot(filePath, repaired.snapshot);
        }
        return repaired.snapshot;
      } catch {
        return null;
      }
    },
    write(snapshot) {
      writeDesktopUiStateSnapshot(filePath, snapshot);
      return { ok: true, path: filePath };
    },
    writeRaw(text) {
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, String(text), "utf8");
    },
  };
}

function writeDesktopUiStateSnapshot(filePath, snapshot) {
  mkdirSync(dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  writeFileSync(tmpPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  renameSync(tmpPath, filePath);
}

function readConversationRuntimeRuns(runsPath) {
  if (!existsSync(runsPath)) {
    return [];
  }
  try {
    const parsed = JSON.parse(readFileSync(runsPath, "utf8"));
    return Array.isArray(parsed) ? parsed : Array.isArray(parsed?.runs) ? parsed.runs : [];
  } catch {
    return [];
  }
}

export function repairDesktopTranscriptFromRuntimeRuns(snapshot, runs) {
  if (!snapshot || typeof snapshot !== "object" || !Array.isArray(runs)) {
    return { snapshot, changed: false };
  }
  const transcripts = snapshot.chat?.sessionTranscripts;
  if (!transcripts || typeof transcripts !== "object") {
    return { snapshot, changed: false };
  }
  const runsBySession = groupRuntimeRunsBySession(runs);
  let changed = false;
  for (const [sessionKey, messages] of Object.entries(transcripts)) {
    if (!Array.isArray(messages)) {
      continue;
    }
    const sessionRuns = runsBySession.get(sessionKey) ?? [];
    let responseIndex = -1;
    for (let index = 0; index < messages.length; index += 1) {
      const message = messages[index];
      if (!message || typeof message !== "object") {
        continue;
      }
      if (message.role === "user") {
        continue;
      }
      responseIndex += 1;
      if (isStalePendingTranscriptMessage(message)) {
        const repaired =
          createTranscriptMessageFromRuntimeRun(sessionRuns[responseIndex]) ??
          createTranscriptMessageFromRuntimeRun(findRuntimeRunForNearbyUserMessage(runs, messages, index)) ??
          createEndedWithoutFinalTranscriptMessage();
        messages[index] = {
          ...message,
          ...repaired,
        };
        changed = true;
        continue;
      }
      if (isRawExperienceCandidateToolMessage(message)) {
        messages[index] = {
          ...message,
          role: "angel",
          title: "Angel 已回复",
          body: renderEmptyExperienceCandidateTranscriptReply(message.body),
        };
        changed = true;
        continue;
      }
      if (!isStaleRuntimeShellMessage(message)) {
        continue;
      }
      const repaired = createTranscriptMessageFromRuntimeRun(sessionRuns[responseIndex]);
      if (repaired === null) {
        continue;
      }
      messages[index] = {
        ...message,
        ...repaired,
      };
      changed = true;
    }
    if (collapseDuplicateAdjacentTranscriptTurns(messages)) {
      changed = true;
    }
  }
  if (clearSubmittedComposerDraft(snapshot)) {
    changed = true;
  }
  return { snapshot, changed };
}

function collapseDuplicateAdjacentTranscriptTurns(messages) {
  let changed = false;
  for (let index = 0; index <= messages.length - 4; index += 1) {
    const firstUser = messages[index];
    const firstReply = messages[index + 1];
    const secondUser = messages[index + 2];
    const secondReply = messages[index + 3];
    if (
      firstUser?.role === "user" &&
      secondUser?.role === "user" &&
      firstReply?.role !== "user" &&
      secondReply?.role !== "user" &&
      readNonEmptyString(firstUser.body) === readNonEmptyString(secondUser.body) &&
      readNonEmptyString(firstReply.body) === readNonEmptyString(secondReply.body)
    ) {
      messages.splice(index + 2, 2);
      changed = true;
      index -= 1;
    }
  }
  return changed;
}

function clearSubmittedComposerDraft(snapshot) {
  const chat = snapshot.chat;
  if (!chat || typeof chat !== "object") {
    return false;
  }
  const draft = readNonEmptyString(chat.composerDraft);
  if (draft === null || hasRunningDesktopTask(snapshot)) {
    return false;
  }
  if (draft !== findLatestTranscriptUserBody(chat.sessionTranscripts)) {
    return false;
  }
  chat.composerDraft = "";
  return true;
}

function hasRunningDesktopTask(snapshot) {
  const recentTasks = snapshot.taskRuntime?.recentTasks;
  if (!Array.isArray(recentTasks)) {
    return false;
  }
  return recentTasks.some((task) =>
    ["running", "queued", "pending", "needs_attention"].includes(String(task?.status ?? "")),
  );
}

function findLatestTranscriptUserBody(transcripts) {
  if (!transcripts || typeof transcripts !== "object") {
    return null;
  }
  let latest = null;
  for (const messages of Object.values(transcripts)) {
    if (!Array.isArray(messages)) {
      continue;
    }
    for (const message of messages) {
      if (message?.role !== "user") {
        continue;
      }
      const body = readNonEmptyString(message.body);
      if (body !== null) {
        latest = body;
      }
    }
  }
  return latest;
}

function isStalePendingTranscriptMessage(message) {
  if (message.role !== "angel" && message.role !== "system") {
    return false;
  }
  const title = readNonEmptyString(message.title) ?? "";
  const body = readNonEmptyString(message.body) ?? "";
  return (
    /(?:正在处理|等待已结束|执行未完成)/u.test(title) &&
    /正在等待工具或模型结果/u.test(body)
  );
}

function findRuntimeRunForNearbyUserMessage(runs, messages, messageIndex) {
  const userText = findPreviousUserMessageBody(messages, messageIndex);
  if (userText === null) {
    return null;
  }
  const urls = extractUrls(userText);
  const normalizedText = normalizeTextForMatch(userText);
  return [...runs]
    .reverse()
    .find((run) => {
      const haystack = JSON.stringify(run);
      if (urls.some((url) => haystack.includes(url))) {
        return true;
      }
      const runText = readNonEmptyString(run?.input?.text ?? run?.userText);
      return runText !== null && normalizeTextForMatch(runText) === normalizedText;
    }) ?? null;
}

function findPreviousUserMessageBody(messages, messageIndex) {
  for (let index = messageIndex - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "user") {
      continue;
    }
    return readNonEmptyString(message.body);
  }
  return null;
}

function extractUrls(text) {
  return typeof text === "string" ? text.match(/https?:\/\/\S+/gu) ?? [] : [];
}

function normalizeTextForMatch(text) {
  return String(text).replace(/\s+/gu, "").trim();
}

function createEndedWithoutFinalTranscriptMessage() {
  return {
    role: "system",
    title: "Angel 没有回复成功",
    body: "这次请求已经结束，但桌面端没有收到可展示的最终回复。请重新发送，或检查运行中心异常记录。",
  };
}

function groupRuntimeRunsBySession(runs) {
  const grouped = new Map();
  for (const run of runs) {
    const sessionKey = readNonEmptyString(run?.sessionKey ?? run?.metadata?.sessionKey);
    if (sessionKey === null) {
      continue;
    }
    const items = grouped.get(sessionKey) ?? [];
    items.push(run);
    grouped.set(sessionKey, items);
  }
  for (const items of grouped.values()) {
    items.sort((a, b) => readRunStartedAt(a) - readRunStartedAt(b));
  }
  return grouped;
}

function readRunStartedAt(run) {
  const value = Number(run?.startedAtMs ?? run?.createdAtMs ?? run?.updatedAtMs ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function isRawExperienceCandidateToolMessage(message) {
  if (message.role !== "angel" && message.role !== "system") {
    return false;
  }
  const body = readNonEmptyString(message.body);
  return (
    body !== null &&
    /^status:\s*success/im.test(body) &&
    /^summary:\s*当前没有匹配的待审经验候选。?$/im.test(body)
  );
}

function renderEmptyExperienceCandidateTranscriptReply(body) {
  const total = readToolField(body, "total_candidates");
  const pending = readToolField(body, "pending_learning_confirmations");
  const details = [
    total === null ? null : `当前经验候选总数 ${total}`,
    pending === null ? null : `待确认经验 ${pending}`,
  ].filter(Boolean);
  return [
    "当前没有可展示的待审经验候选。",
    "也就是说，刚才这轮没有留下可直接收录或展开的学习候选；如果你要继续学这条内容，需要重新学习链接，或先把原文/截图发进来。",
    details.length === 0 ? null : details.join(" · "),
  ]
    .filter(Boolean)
    .join("\n");
}

function readToolField(text, key) {
  if (typeof text !== "string") {
    return null;
  }
  const match = new RegExp(`^${key}\\s*:\\s*([^\\n]+)$`, "im").exec(text);
  return match?.[1]?.trim() || null;
}

function isStaleRuntimeShellMessage(message) {
  if (message.role !== "angel" && message.role !== "system") {
    return false;
  }
  const body = readNonEmptyString(message.body);
  return body === "模型调用完成。" || body === "ConversationRuntime 已完成本回合。";
}

function createTranscriptMessageFromRuntimeRun(run) {
  if (!run || typeof run !== "object") {
    return null;
  }
  const body =
    readNonEmptyString(run.userVisibleSummary) ??
    readNonEmptyString(run.finalText) ??
    readNonEmptyString(run.payload?.finalText) ??
    readNonEmptyString(run.summary?.finalText);
  if (body === null || isStaleRuntimeShellText(body)) {
    return null;
  }
  const failed = run.status === "failed" || run.status === "cancelled" || run.status === "interrupted";
  return {
    role: failed ? "system" : "angel",
    title: failed ? "Angel 没有回复成功" : "Angel 已回复",
    body,
  };
}

function isStaleRuntimeShellText(text) {
  return text === "模型调用完成。" || text === "ConversationRuntime 已完成本回合。";
}

function readNonEmptyString(value) {
  if (typeof value !== "string") {
    return null;
  }
  const text = value.trim();
  return text.length > 0 ? text : null;
}
