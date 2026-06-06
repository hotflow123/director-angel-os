const COMPOSER_HISTORY_LIMIT = 80;
const PASTE_SNIP_MAX_COUNT = 32;
const PASTE_SNIP_MAX_TOTAL_BYTES = 4 * 1024 * 1024;
const COMPOSER_ATTACHMENT_LIMIT = 8;
const COMPOSER_ATTACHMENT_PAYLOAD_MAX_BYTES = 8 * 1024 * 1024;

export function createComposerState(options = {}) {
  return {
    input: String(options.input ?? ""),
    history: Array.isArray(options.history) ? options.history.map(String) : [],
    attachments: Array.isArray(options.attachments)
      ? options.attachments.map(normalizeComposerAttachment).filter(Boolean)
      : [],
    historyIndex: null,
    draftBeforeHistory: "",
    pasteSnips: [],
    setInput(value) {
      this.input = String(value ?? "");
      this.historyIndex = null;
      this.draftBeforeHistory = "";
    },
    clearInput() {
      this.input = "";
      this.attachments = [];
      this.pasteSnips = [];
      this.historyIndex = null;
      this.draftBeforeHistory = "";
    },
    pushHistory(value) {
      const text = String(value ?? "").trim();
      if (!text) return;
      const withoutDuplicate = this.history.filter((item) => item !== text);
      withoutDuplicate.push(text);
      this.history = withoutDuplicate.slice(-COMPOSER_HISTORY_LIMIT);
    },
    submitCurrentInput() {
      const submitted = this.input.trim();
      if (!submitted) return "";
      this.pushHistory(submitted);
      this.clearInput();
      return submitted;
    },
    navigateHistory(direction) {
      return navigateComposerHistory(this, direction);
    },
    addPasteSnippet(snippet) {
      this.pasteSnips = trimPasteSnips([...this.pasteSnips, snippet]);
    },
  };
}

export function addComposerAttachment(state, attachment) {
  if (!state) {
    return null;
  }
  const normalized = normalizeComposerAttachment(attachment);
  if (!normalized) {
    return null;
  }
  const attachments = Array.isArray(state.attachments) ? state.attachments : [];
  const existing = attachments.find(
    (item) => item.path && normalized.path && item.path === normalized.path,
  );
  if (existing) {
    state.attachments = attachments;
    return existing;
  }
  state.attachments = [...attachments, normalized].slice(-COMPOSER_ATTACHMENT_LIMIT);
  return normalized;
}

export function removeComposerAttachment(state, attachmentId) {
  if (!state || !Array.isArray(state.attachments)) {
    return false;
  }
  const before = state.attachments.length;
  state.attachments = state.attachments.filter((item) => item.id !== attachmentId);
  return state.attachments.length !== before;
}

export function clearComposerAttachments(state) {
  if (state) {
    state.attachments = [];
  }
}

export function createComposerAttachmentsFromFiles(files, options = {}) {
  const items = Array.from(files ?? []);
  const attachments = items.map(createComposerAttachmentFromFile).filter(Boolean);
  if (options.includePayloads !== true) {
    return attachments;
  }
  return Promise.all(
    attachments.map(async (attachment, index) => ({
      ...attachment,
      ...(await readComposerAttachmentDataUrl(items[index], attachment)),
    })),
  );
}

export function createComposerAttachmentsFromPastedFiles(files, options = {}) {
  const items = Array.from(files ?? []);
  const attachments = items.map(createComposerAttachmentFromPastedFile).filter(Boolean);
  return Promise.all(
    attachments.map(async (attachment, index) => ({
      ...attachment,
      ...(await readComposerAttachmentDataUrl(items[index], attachment, { allowPathless: true })),
    })),
  ).then((items) => items.filter((attachment) => attachment.dataUrl));
}

export function navigateComposerHistory(state, direction) {
  if (!state || state.history.length === 0) return false;
  if (direction === "up") {
    if (state.historyIndex === null) {
      state.draftBeforeHistory = state.input;
      state.historyIndex = state.history.length - 1;
    } else if (state.historyIndex > 0) {
      state.historyIndex -= 1;
    }
    state.input = state.history[state.historyIndex] ?? "";
    return true;
  }
  if (direction === "down") {
    if (state.historyIndex === null) return false;
    if (state.historyIndex < state.history.length - 1) {
      state.historyIndex += 1;
      state.input = state.history[state.historyIndex] ?? "";
    } else {
      state.historyIndex = null;
      state.input = state.draftBeforeHistory ?? "";
      state.draftBeforeHistory = "";
    }
    return true;
  }
  return false;
}

export function looksLikeDroppedPath(text) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed || trimmed.includes("\n")) return false;
  if (
    trimmed.startsWith("file://") ||
    trimmed.startsWith("~/") ||
    trimmed.startsWith("./") ||
    trimmed.startsWith("../") ||
    trimmed.startsWith('"/') ||
    trimmed.startsWith("'/") ||
    trimmed.startsWith('"~') ||
    trimmed.startsWith("'~") ||
    /^[A-Za-z]:[/\\]/u.test(trimmed) ||
    /^["'][A-Za-z]:[/\\]/u.test(trimmed)
  ) {
    return true;
  }
  if (trimmed.startsWith("/")) {
    const rest = trimmed.slice(1);
    return rest.includes("/") || rest.includes(".");
  }
  return false;
}

export function insertComposerTextAtCursor(value, cursor, text) {
  const current = String(value ?? "");
  const position = Math.max(0, Math.min(Number(cursor) || 0, current.length));
  const lead = position > 0 && !/\s/u.test(current[position - 1] ?? "") ? " " : "";
  const tail = position < current.length && !/\s/u.test(current[position] ?? "") ? " " : "";
  const insert = `${lead}${String(text ?? "")}${tail}`;
  return {
    cursor: position + insert.length,
    value: current.slice(0, position) + insert + current.slice(position),
  };
}

export function resolveComposerKeyAction(event) {
  if (!event || event.key !== "Enter") {
    return "ignore";
  }
  if (event.isComposing === true || event.keyCode === 229) {
    return "ignore";
  }
  if (event.shiftKey === true) {
    return "newline";
  }
  return "submit";
}

export function insertComposerNewline(value, selectionStart, selectionEnd = selectionStart) {
  const current = String(value ?? "");
  const start = Math.max(0, Math.min(Number(selectionStart) || 0, current.length));
  const end = Math.max(start, Math.min(Number(selectionEnd) || start, current.length));
  return {
    value: `${current.slice(0, start)}\n${current.slice(end)}`,
    cursor: start + 1,
  };
}

function trimPasteSnips(snips) {
  let total = 0;
  const out = [];
  for (let index = snips.length - 1; index >= 0; index -= 1) {
    const snip = snips[index];
    const size = String(snip?.text ?? "").length;
    if (out.length >= PASTE_SNIP_MAX_COUNT || total + size > PASTE_SNIP_MAX_TOTAL_BYTES) {
      break;
    }
    total += size;
    out.unshift(snip);
  }
  return out.length === snips.length ? snips : out;
}

function createComposerAttachmentFromFile(file) {
  return normalizeComposerAttachment({
    path: readAttachmentString(file?.path),
    fileName: readAttachmentString(file?.name),
    mimeType: readAttachmentString(file?.type),
    sizeBytes: readFiniteNumber(file?.size),
  });
}

function createComposerAttachmentFromPastedFile(file) {
  const fileName = readAttachmentString(file?.name) ?? "pasted-file";
  const mimeType = readAttachmentString(file?.type) ?? "application/octet-stream";
  const sizeBytes = readFiniteNumber(file?.size);
  return {
    id: `composer-paste-${hashAttachmentPath([fileName, mimeType, sizeBytes ?? 0].join(":"))}`,
    type: "file",
    fileName,
    mimeType,
    ...(sizeBytes === null ? {} : { sizeBytes }),
  };
}

async function readComposerAttachmentDataUrl(file, attachment, options = {}) {
  const size = readFiniteNumber(file?.size) ?? 0;
  if (
    (!attachment?.path && options.allowPathless !== true) ||
    typeof file?.arrayBuffer !== "function" ||
    size > COMPOSER_ATTACHMENT_PAYLOAD_MAX_BYTES
  ) {
    return {};
  }
  try {
    const buffer = await file.arrayBuffer();
    const base64 = encodeArrayBufferAsBase64(buffer);
    const mimeType = attachment.mimeType || "application/octet-stream";
    return { dataUrl: `data:${mimeType};base64,${base64}` };
  } catch {
    return {};
  }
}

function encodeArrayBufferAsBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  if (typeof btoa === "function") {
    return btoa(binary);
  }
  return Buffer.from(binary, "binary").toString("base64");
}

function normalizeComposerAttachment(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  const path = readAttachmentString(value.path);
  const dataUrl = readAttachmentString(value.dataUrl);
  const previewUrl = readAttachmentString(value.previewUrl);
  if (!path && !dataUrl && !previewUrl) {
    return null;
  }
  const fileName = readAttachmentString(value.fileName) ?? deriveAttachmentFileName(path);
  return {
    id: readAttachmentString(value.id) ?? createComposerAttachmentId(path),
    type: readAttachmentString(value.type) ?? "file",
    ...(path ? { path } : {}),
    fileName,
    ...(readAttachmentString(value.mimeType) ? { mimeType: readAttachmentString(value.mimeType) } : {}),
    ...(readFiniteNumber(value.sizeBytes) === null
      ? {}
      : { sizeBytes: readFiniteNumber(value.sizeBytes) }),
    ...(dataUrl ? { dataUrl } : {}),
    ...(previewUrl ? { previewUrl } : {}),
  };
}

function createComposerAttachmentId(path) {
  return `composer-attachment-${hashAttachmentPath(path ?? "attachment")}`;
}

function hashAttachmentPath(path) {
  let hash = 0;
  for (const char of String(path)) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return hash.toString(36);
}

function deriveAttachmentFileName(path) {
  const withoutScheme = String(path).replace(/^file:\/\//u, "");
  const parts = withoutScheme.split(/[\\/]/u).filter(Boolean);
  return parts.at(-1) ?? "attachment";
}

function readAttachmentString(value) {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length > 0 ? text : null;
}

function readFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
