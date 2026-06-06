import { createComposerState } from "./composer-state.js";
import {
  cloneDesktopAttachmentsMetadata,
  materializeDesktopAttachmentPayloads,
  releaseDesktopAttachmentPayloads,
} from "./attachment-payload-store.js";

const DEFAULT_DESKTOP_SESSION_KEY = "desktop:workbench";
const DESKTOP_SESSION_LIMIT = 20;
const DESKTOP_SESSION_TITLE_LIMIT = 32;

export function createDesktopChatState(options = {}) {
  return {
    composer: options.composer ?? createComposerState(),
    queue: Array.isArray(options.queue) ? [...options.queue] : [],
    runId: options.runId ?? null,
    sessionKey: readDesktopSessionKey(options.sessionKey) ?? DEFAULT_DESKTOP_SESSION_KEY,
    sessions: Array.isArray(options.sessions) ? [...options.sessions] : [],
    sessionTranscripts:
      options.sessionTranscripts && typeof options.sessionTranscripts === "object"
        ? { ...options.sessionTranscripts }
        : {},
    connected: options.connected !== false,
    lastError: null,
    lastSubmittedMessage: options.lastSubmittedMessage ?? null,
    runStatus: null,
    submitGuards: new Map(),
  };
}

export function isDesktopChatBusy(chat) {
  return Boolean(chat?.runId);
}

export function isChatStopCommand(text) {
  const normalized = String(text ?? "").trim().toLowerCase();
  if (!normalized) return false;
  return ["/stop", "stop", "esc", "abort", "wait", "exit"].includes(normalized);
}

export function isDesktopChatResetCommand(text) {
  const normalized = String(text ?? "").trim().toLowerCase();
  if (!normalized) return false;
  return normalized === "/new" || normalized === "/reset";
}

export function isDesktopChatRetryCommand(text) {
  const normalized = String(text ?? "").trim().toLowerCase();
  if (!normalized) return false;
  return ["/retry", "retry", "重试", "再试一次"].includes(normalized);
}

export async function handleDesktopChatSubmit(chat, handlers = {}) {
  if (!chat?.composer) {
    throw new Error("Desktop chat state requires a composer");
  }
  const message = chat.composer.input.trim();
  const attachmentsToSend = snapshotDesktopChatAttachments(chat.composer.attachments);
  const hasAttachments = attachmentsToSend.length > 0;
  if (!message && !hasAttachments) {
    return { action: "empty", message: "" };
  }
  chat.composer.pushHistory(message);
  chat.composer.clearInput();
  handlers.onInputCleared?.();

  if (isChatStopCommand(message)) {
    await handlers.abort?.(chat.runId);
    return { action: "aborted", message };
  }

  if (isDesktopChatResetCommand(message)) {
    releaseDesktopAttachmentPayloads(chat.queue.flatMap((item) => item.attachments ?? []));
    chat.queue = [];
    await handlers.resetConversation?.(message);
    return { action: "reset", message };
  }

  const retrying = isDesktopChatRetryCommand(message);
  const effectiveMessage = retrying ? String(chat.lastSubmittedMessage ?? "").trim() : message;
  if (retrying && !effectiveMessage) {
    chat.lastError = "没有可重试的上一条输入。";
    return { action: "retry-missing", message };
  }

  const submitKey = createDesktopChatSubmitKey(effectiveMessage);
  if (chat.submitGuards?.has(submitKey)) {
    return { action: "coalesced", message: effectiveMessage };
  }

  if (isDesktopChatBusy(chat)) {
    const item = {
      id: createDesktopChatQueueId(),
      text: effectiveMessage,
      createdAt: Date.now(),
      ...(hasAttachments ? { attachments: cloneDesktopAttachmentsMetadata(attachmentsToSend) } : {}),
    };
    chat.queue = [...chat.queue, item];
    return { action: "queued", message: effectiveMessage, item };
  }

  const provisionalRunId = createDesktopChatRunId();
  chat.runId = provisionalRunId;
  const releaseGuard = registerDesktopChatSubmitGuard(chat, submitKey);
  let result;
  try {
    result = await handlers.send?.(effectiveMessage, {
      ...(hasAttachments ? { attachments: materializeDesktopAttachmentPayloads(attachmentsToSend) } : {}),
    });
    if (result?.runId) {
      chat.runId = result.runId;
    } else if (chat.runId === provisionalRunId) {
      chat.runId = null;
    }
    chat.lastSubmittedMessage = effectiveMessage;
  } catch (error) {
    if (chat.runId === provisionalRunId) {
      chat.runId = null;
    }
    chat.composer.setInput(effectiveMessage);
    chat.composer.attachments = attachmentsToSend;
    handlers.onInputRestored?.(effectiveMessage, {
      ...(hasAttachments ? { attachments: attachmentsToSend } : {}),
    });
    throw error;
  } finally {
    releaseGuard();
  }
  return { action: retrying ? "retried" : "sent", message: effectiveMessage, result };
}

function snapshotDesktopChatAttachments(attachments) {
  return Array.isArray(attachments)
    ? attachments.map((attachment) => ({ ...attachment })).filter(isSendableDesktopChatAttachment)
    : [];
}

function isSendableDesktopChatAttachment(attachment) {
  return Boolean(
    attachment?.path ||
      attachment?.dataUrl ||
      attachment?.content ||
      attachment?.previewUrl ||
      attachment?.fileName,
  );
}

export function flushDesktopChatQueue(chat) {
  if (!chat || isDesktopChatBusy(chat) || chat.queue.length === 0) {
    return null;
  }
  const nextIndex = chat.queue.findIndex((item) => !item.pendingRunId);
  if (nextIndex < 0) {
    return null;
  }
  const item = chat.queue[nextIndex];
  chat.queue = chat.queue.filter((_, index) => index !== nextIndex);
  return item ?? null;
}

export function clearDesktopChatQueueItemsForRun(chat, runId) {
  if (!chat || !runId) {
    return [];
  }
  const removed = chat.queue.filter((item) => item.pendingRunId === runId);
  chat.queue = chat.queue.filter((item) => item.pendingRunId !== runId);
  releaseDesktopAttachmentPayloads(removed.flatMap((item) => item.attachments ?? []));
  return removed;
}

export function reconcileDesktopChatRunLifecycle(chat, options = {}) {
  if (!chat) {
    return false;
  }
  const sessionKey = readDesktopChatString(options.sessionKey) ?? chat.sessionKey;
  if (sessionKey !== chat.sessionKey) {
    return false;
  }
  const runId = readDesktopChatString(options.runId) ?? chat.runId;
  if (chat.runId && runId && chat.runId !== runId) {
    return false;
  }
  if (runId) {
    clearDesktopChatQueueItemsForRun(chat, runId);
  }
  chat.runId = null;
  if (options.outcome) {
    chat.runStatus = {
      phase: options.outcome,
      runId: runId ?? null,
      sessionKey,
      occurredAt: Date.now(),
    };
  }
  return true;
}

export function ensureDesktopChatSessions(chat, options = {}) {
  if (!chat) {
    return [];
  }
  const now = readFiniteNumber(options.now, Date.now());
  const currentKey = readDesktopSessionKey(chat.sessionKey) ?? DEFAULT_DESKTOP_SESSION_KEY;
  chat.sessionKey = currentKey;
  const sessions = normalizeDesktopChatSessions(chat.sessions, now);
  if (!sessions.some((session) => session.key === currentKey)) {
    sessions.unshift(createDesktopChatSessionRow(currentKey, { now }));
  }
  chat.sessions = sessions.slice(0, DESKTOP_SESSION_LIMIT);
  return chat.sessions;
}

export function createDesktopChatSession(chat, options = {}) {
  if (!chat) {
    return null;
  }
  const now = readFiniteNumber(options.now, Date.now());
  const key = readDesktopSessionKey(options.key) ?? createDesktopChatSessionKey();
  const title = normalizeDesktopSessionTitle(options.title, "新会话");
  const session = { key, title, updatedAt: now };
  const sessions = normalizeDesktopChatSessions(chat.sessions, now).filter((item) => item.key !== key);
  chat.sessions = [session, ...sessions].slice(0, DESKTOP_SESSION_LIMIT);
  chat.sessionKey = key;
  clearDesktopChatLocalRunState(chat);
  return session;
}

export function selectDesktopChatSession(chat, sessionKey, options = {}) {
  if (!chat) {
    return false;
  }
  const key = readDesktopSessionKey(sessionKey);
  if (!key) {
    return false;
  }
  const now = readFiniteNumber(options.now, Date.now());
  const sessions = normalizeDesktopChatSessions(chat.sessions, now);
  const existing = sessions.find((session) => session.key === key) ?? createDesktopChatSessionRow(key, { now });
  const selected = { ...existing, updatedAt: now };
  chat.sessions = [selected, ...sessions.filter((session) => session.key !== key)].slice(
    0,
    DESKTOP_SESSION_LIMIT,
  );
  chat.sessionKey = key;
  clearDesktopChatLocalRunState(chat);
  return true;
}

export function updateDesktopChatSessionFromPrompt(chat, prompt, options = {}) {
  if (!chat) {
    return null;
  }
  const now = readFiniteNumber(options.now, Date.now());
  const key = readDesktopSessionKey(chat.sessionKey) ?? DEFAULT_DESKTOP_SESSION_KEY;
  const title = normalizeDesktopSessionTitle(prompt, key === DEFAULT_DESKTOP_SESSION_KEY ? "工作台" : "新会话");
  const sessions = normalizeDesktopChatSessions(chat.sessions, now).filter((session) => session.key !== key);
  const updated = { key, title, updatedAt: now };
  chat.sessions = [updated, ...sessions].slice(0, DESKTOP_SESSION_LIMIT);
  chat.sessionKey = key;
  return updated;
}

export function renameDesktopChatSession(chat, sessionKey, title, options = {}) {
  if (!chat) {
    return false;
  }
  const key = readDesktopSessionKey(sessionKey);
  if (!key) {
    return false;
  }
  const now = readFiniteNumber(options.now, Date.now());
  const sessions = ensureDesktopChatSessions(chat, { now });
  const index = sessions.findIndex((session) => session.key === key);
  if (index < 0) {
    return false;
  }
  const previous = sessions[index];
  const nextTitle = normalizeDesktopSessionTitle(title, previous.title);
  chat.sessions = sessions.map((session) =>
    session.key === key ? { ...session, title: nextTitle, updatedAt: now } : session,
  );
  return true;
}

export function deleteDesktopChatSession(chat, sessionKey, options = {}) {
  if (!chat) {
    return false;
  }
  const key = readDesktopSessionKey(sessionKey);
  if (!key) {
    return false;
  }
  const now = readFiniteNumber(options.now, Date.now());
  const sessions = ensureDesktopChatSessions(chat, { now });
  if (!sessions.some((session) => session.key === key)) {
    return false;
  }
  const remaining = sessions.filter((session) => session.key !== key);
  if (remaining.length === 0) {
    const fallback = createDesktopChatSessionRow(DEFAULT_DESKTOP_SESSION_KEY, { now });
    chat.sessions = [fallback];
    chat.sessionKey = fallback.key;
    clearDesktopChatLocalRunState(chat);
    return true;
  }
  if (chat.sessionKey === key) {
    const next = { ...remaining[0], updatedAt: now };
    chat.sessionKey = next.key;
    chat.sessions = [next, ...remaining.slice(1)].slice(0, DESKTOP_SESSION_LIMIT);
    clearDesktopChatLocalRunState(chat);
    return true;
  }
  chat.sessions = remaining.slice(0, DESKTOP_SESSION_LIMIT);
  return true;
}

function clearDesktopChatLocalRunState(chat) {
  releaseDesktopAttachmentPayloads(chat.queue.flatMap((item) => item.attachments ?? []));
  chat.runId = null;
  chat.queue = [];
  chat.runStatus = null;
}

function createDesktopChatQueueId() {
  if (typeof crypto?.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `desktop-chat-queue-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function createDesktopChatRunId() {
  if (typeof crypto?.randomUUID === "function") {
    return `desktop-chat-run-${crypto.randomUUID()}`;
  }
  return `desktop-chat-run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function createDesktopChatSessionKey() {
  if (typeof crypto?.randomUUID === "function") {
    return `desktop:workbench:${crypto.randomUUID()}`;
  }
  return `desktop:workbench:${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function createDesktopChatSubmitKey(message) {
  return JSON.stringify(["message", String(message ?? "").trim()]);
}

function registerDesktopChatSubmitGuard(chat, key) {
  const guards = (chat.submitGuards ??= new Map());
  guards.set(key, true);
  return () => {
    guards.delete(key);
  };
}

function readDesktopChatString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function normalizeDesktopChatSessions(value, now) {
  if (!Array.isArray(value)) {
    return [];
  }
  const sessions = [];
  const seen = new Set();
  for (const item of value) {
    const key = readDesktopSessionKey(item?.key);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    sessions.push({
      key,
      title: normalizeDesktopSessionTitle(item?.title, key === DEFAULT_DESKTOP_SESSION_KEY ? "工作台" : "新会话"),
      updatedAt: readFiniteNumber(item?.updatedAt, now),
    });
  }
  return sessions.slice(0, DESKTOP_SESSION_LIMIT);
}

function createDesktopChatSessionRow(key, options = {}) {
  const now = readFiniteNumber(options.now, Date.now());
  return {
    key,
    title: key === DEFAULT_DESKTOP_SESSION_KEY ? "工作台" : "新会话",
    updatedAt: now,
  };
}

function normalizeDesktopSessionTitle(value, fallback) {
  const text = typeof value === "string" ? value.trim().replace(/\s+/gu, " ") : "";
  const title = text || fallback;
  if (title.length <= DESKTOP_SESSION_TITLE_LIMIT) {
    return title;
  }
  return `${title.slice(0, DESKTOP_SESSION_TITLE_LIMIT - 3)}...`;
}

function readDesktopSessionKey(value) {
  const text = typeof value === "string" ? value.trim() : "";
  return /^desktop:workbench(?::[A-Za-z0-9_-]+)?$/u.test(text) ? text : null;
}

function readFiniteNumber(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
