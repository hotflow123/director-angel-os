const payloads = new Map();
const releasedAttachmentIds = new Set();

export function registerDesktopAttachmentPayload(options) {
  const attachment = normalizeAttachment(options?.attachment);
  if (attachment === null) {
    return null;
  }
  const previous = payloads.get(attachment.id);
  releasedAttachmentIds.delete(attachment.id);
  revokeDesktopObjectUrl(previous?.previewUrl);
  const objectUrl = createDesktopObjectUrl(options?.file);
  const previewUrl = objectUrl ?? readNonEmptyString(options?.previewUrl) ?? attachment.previewUrl;
  const dataUrl = readNonEmptyString(options?.dataUrl);
  payloads.set(attachment.id, {
    ...(dataUrl === null ? {} : { dataUrl }),
    ...(previewUrl === undefined ? {} : { previewUrl }),
  });
  return {
    ...attachment,
    ...(previewUrl === undefined ? {} : { previewUrl }),
  };
}

export function getDesktopAttachmentDataUrl(attachment) {
  const id = readNonEmptyString(attachment?.id);
  if (id !== null && releasedAttachmentIds.has(id)) {
    return null;
  }
  return readNonEmptyString(attachment?.dataUrl) ?? (id === null ? null : payloads.get(id)?.dataUrl) ?? null;
}

export function getDesktopAttachmentPreviewUrl(attachment) {
  const id = readNonEmptyString(attachment?.id);
  if (id !== null && releasedAttachmentIds.has(id)) {
    return null;
  }
  return (
    readNonEmptyString(attachment?.previewUrl) ??
    (id === null ? null : payloads.get(id)?.previewUrl) ??
    getDesktopAttachmentDataUrl(attachment)
  );
}

export function cloneDesktopAttachmentMetadata(attachment) {
  const { dataUrl: _dataUrl, content: _content, contentEncoding: _encoding, ...metadata } =
    normalizeAttachment(attachment) ?? {};
  return metadata;
}

export function cloneDesktopAttachmentsMetadata(attachments = []) {
  return attachments.map(cloneDesktopAttachmentMetadata).filter((attachment) => attachment.id);
}

export function materializeDesktopAttachmentPayloads(attachments = []) {
  return attachments.map(materializeDesktopAttachmentPayload).filter(Boolean);
}

export function discardDesktopAttachmentDataUrls(attachments = []) {
  for (const attachment of attachments) {
    const id = readNonEmptyString(attachment?.id);
    if (id === null) {
      continue;
    }
    const payload = payloads.get(id);
    if (!payload) {
      continue;
    }
    if (payload.previewUrl) {
      payloads.set(id, { previewUrl: payload.previewUrl });
    } else {
      payloads.delete(id);
    }
  }
}

export function releaseDesktopAttachmentPayloads(attachments = []) {
  for (const attachment of attachments) {
    const id = readNonEmptyString(attachment?.id);
    if (id === null) {
      continue;
    }
    const payload = payloads.get(id);
    if (!payload) {
      continue;
    }
    revokeDesktopObjectUrl(payload.previewUrl);
    payloads.delete(id);
    releasedAttachmentIds.add(id);
  }
}

export function resetDesktopAttachmentPayloadStoreForTest() {
  for (const payload of payloads.values()) {
    revokeDesktopObjectUrl(payload.previewUrl);
  }
  payloads.clear();
  releasedAttachmentIds.clear();
}

function materializeDesktopAttachmentPayload(attachment) {
  const existingContent = readNonEmptyString(attachment?.content);
  const existingEncoding = readNonEmptyString(attachment?.contentEncoding);
  if (existingContent !== null && existingEncoding === "base64") {
    return {
      ...cloneDesktopAttachmentMetadata(attachment),
      contentEncoding: "base64",
      content: existingContent,
    };
  }
  const metadata = cloneDesktopAttachmentMetadata(attachment);
  const dataUrl = getDesktopAttachmentDataUrl(attachment);
  if (dataUrl === null) {
    return metadata.id ? metadata : null;
  }
  const parsed = parseDataUrl(dataUrl);
  if (parsed === null) {
    return metadata.id ? metadata : null;
  }
  return {
    ...metadata,
    ...(metadata.mimeType ? {} : { mimeType: parsed.mimeType }),
    contentEncoding: "base64",
    content: parsed.content,
  };
}

function normalizeAttachment(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  const id = readNonEmptyString(value.id);
  if (id === null) {
    return null;
  }
  const metadata = {
    id,
    type: readNonEmptyString(value.type) ?? "file",
    ...(readNonEmptyString(value.path) === null ? {} : { path: readNonEmptyString(value.path) }),
    ...(readNonEmptyString(value.fileName) === null ? {} : { fileName: readNonEmptyString(value.fileName) }),
    ...(readNonEmptyString(value.mimeType) === null ? {} : { mimeType: readNonEmptyString(value.mimeType) }),
    ...(readFiniteNumber(value.sizeBytes) === null ? {} : { sizeBytes: readFiniteNumber(value.sizeBytes) }),
    ...(readNonEmptyString(value.previewUrl) === null ? {} : { previewUrl: readNonEmptyString(value.previewUrl) }),
  };
  return metadata.path || metadata.fileName || metadata.previewUrl ? metadata : null;
}

function parseDataUrl(value) {
  const text = readNonEmptyString(value);
  if (text === null) {
    return null;
  }
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/u.exec(text);
  if (!match) {
    return null;
  }
  if (match[2] !== ";base64") {
    return null;
  }
  return {
    mimeType: match[1] || "application/octet-stream",
    content: match[3],
  };
}

function createDesktopObjectUrl(file) {
  if (!file || typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
    return undefined;
  }
  return URL.createObjectURL(file);
}

function revokeDesktopObjectUrl(url) {
  if (!url || typeof URL === "undefined" || typeof URL.revokeObjectURL !== "function") {
    return;
  }
  URL.revokeObjectURL(url);
}

function readNonEmptyString(value) {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length > 0 ? text : null;
}

function readFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
