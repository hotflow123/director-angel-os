export function createThinkingIndicator() {
  const indicator = document.createElement("div");
  indicator.className = "thinking-indicator";
  indicator.setAttribute("aria-label", "Angel 正在思考");
  for (let index = 0; index < 3; index += 1) {
    const dot = document.createElement("span");
    dot.className = "thinking-dot";
    indicator.append(dot);
  }
  return indicator;
}

export function setTimelineMessageBodyText(body, value) {
  const text = String(value ?? "");
  body.textContent = text;
  updateTimelineMessageBodyMetrics(body, text);
}

function updateTimelineMessageBodyMetrics(body, text) {
  body.classList.add("message-body");
  const lineCount = text.split(/\r?\n/u).length;
  body.classList.toggle("long-message-body", text.length > 900 || lineCount > 12);
}

export function createTimelineTextChunks(value) {
  const text = String(value);
  if (text.length === 0) {
    return [""];
  }
  if (typeof Intl?.Segmenter === "function") {
    const segmenter = new Intl.Segmenter("zh-CN", { granularity: "grapheme" });
    return [...segmenter.segment(text)].map((segment) => segment.segment);
  }
  return [...text];
}

export function createTimelineStableMarkdownChunks(value) {
  const text = String(value ?? "");
  if (text.length === 0) {
    return [""];
  }
  const chunks = [];
  let offset = 0;
  while (offset < text.length) {
    const boundary = findTimelineStableMarkdownBoundary(text.slice(offset));
    if (boundary <= 0) {
      break;
    }
    chunks.push(text.slice(offset, offset + boundary));
    offset += boundary;
  }
  if (offset < text.length) {
    chunks.push(...createTimelineTextChunks(text.slice(offset)));
  }
  return chunks;
}

export function createTimelineStreamingMarkdownFrame(value, state = {}) {
  const text = String(value ?? "");
  let stablePrefix =
    typeof state.stablePrefix === "string" && text.startsWith(state.stablePrefix)
      ? state.stablePrefix
      : "";
  const boundary = findTimelineStableMarkdownBoundary(text);
  if (boundary > stablePrefix.length) {
    stablePrefix = text.slice(0, boundary);
  }
  state.stablePrefix = stablePrefix;
  state.unstableSuffix = text.slice(stablePrefix.length);
  return {
    stablePrefix: state.stablePrefix,
    unstableSuffix: state.unstableSuffix,
  };
}

export function renderTimelineStreamingMarkdownFrame(body, frame) {
  const stablePrefix = String(frame?.stablePrefix ?? "");
  const unstableSuffix = String(frame?.unstableSuffix ?? "");
  const fullText = `${stablePrefix}${unstableSuffix}`;
  updateTimelineMessageBodyMetrics(body, fullText);

  if (!stablePrefix || !unstableSuffix) {
    body.dataset.streamingMarkdownMode = "single";
    body.textContent = fullText;
    return;
  }

  body.dataset.streamingMarkdownMode = "split";
  const stableNode = ensureTimelineStreamingMarkdownPart(body, "stable");
  const unstableNode = ensureTimelineStreamingMarkdownPart(body, "unstable");

  if (stableNode.dataset.markdownSource !== stablePrefix) {
    renderTimelineMarkdownBlocks(stableNode, stablePrefix);
    stableNode.dataset.markdownSource = stablePrefix;
    queueTimelineMarkdownLinkTitleResolution(stableNode);
  }
  renderTimelineMarkdownBlocks(unstableNode, unstableSuffix);
  unstableNode.dataset.markdownSource = unstableSuffix;
  queueTimelineMarkdownLinkTitleResolution(unstableNode);

  if (body.children.length !== 2 || body.children[0] !== stableNode || body.children[1] !== unstableNode) {
    body.replaceChildren(stableNode, unstableNode);
  }
}

function queueTimelineMarkdownLinkTitleResolution(root) {
  if (typeof queueMicrotask === "function") {
    queueMicrotask(() => {
      void resolveTimelineMarkdownLinkTitles(root);
    });
    return;
  }
  void Promise.resolve().then(() => resolveTimelineMarkdownLinkTitles(root));
}

function ensureTimelineStreamingMarkdownPart(body, kind) {
  const attribute =
    kind === "stable" ? "data-streaming-markdown-stable" : "data-streaming-markdown-unstable";
  const selector = `[${attribute}]`;
  const existing = body.querySelector(selector);
  if (existing) {
    return existing;
  }
  const element = body.ownerDocument.createElement("span");
  element.className = `streaming-markdown-${kind}`;
  element.setAttribute(attribute, "1");
  return element;
}

function renderTimelineMarkdownBlocks(container, source) {
  const documentRef = container.ownerDocument;
  const blocks = parseTimelineMarkdownBlocks(source);
  const nodes = blocks.map((block) => createTimelineMarkdownBlockElement(documentRef, block));
  container.replaceChildren(...nodes);
}

function parseTimelineMarkdownBlocks(source) {
  const lines = String(source ?? "").replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (line.trim().length === 0) {
      index += 1;
      continue;
    }
    if (isTimelineMarkdownAudioVoiceDirective(line)) {
      index += 1;
      continue;
    }
    const media = parseTimelineMarkdownMediaLine(line);
    if (media) {
      blocks.push({ kind: "media", target: media });
      index += 1;
      continue;
    }
    const fence = line.match(/^\s*(`{3,}|~{3,})(.*)$/u);
    if (fence) {
      const fenceMark = fence[1][0];
      const codeLines = [];
      index += 1;
      while (index < lines.length && !isTimelineMarkdownFenceClose(lines[index] ?? "", fenceMark)) {
        codeLines.push(lines[index] ?? "");
        index += 1;
      }
      if (index < lines.length) {
        index += 1;
      }
      blocks.push({ kind: "code", text: codeLines.join("\n") });
      continue;
    }
    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.*?)(?:\s+#+\s*)?$/u);
    if (heading) {
      blocks.push({ kind: "heading", level: heading[1].length, text: heading[2] });
      index += 1;
      continue;
    }
    if (isTimelineMarkdownTableStart(lines, index)) {
      const rows = [];
      while (index < lines.length && isTimelineMarkdownTableRow(lines[index] ?? "")) {
        rows.push(splitTimelineMarkdownTableRow(lines[index] ?? ""));
        index += 1;
      }
      blocks.push({ kind: "table", header: rows[0] ?? [], rows: rows.slice(2) });
      continue;
    }
    const math = line.match(/^\s*(\$\$|\\\[)(.*)$/u);
    if (math) {
      const closeMatcher = math[1] === "$$" ? /\$\$\s*$/u : /\\\]\s*$/u;
      const mathLines = [];
      const firstLine = math[2].replace(closeMatcher, "").trim();
      if (firstLine.length > 0) {
        mathLines.push(firstLine);
      }
      index += 1;
      while (index < lines.length && !closeMatcher.test(lines[index] ?? "")) {
        mathLines.push(lines[index] ?? "");
        index += 1;
      }
      if (index < lines.length) {
        const closingLine = (lines[index] ?? "").replace(closeMatcher, "").trim();
        if (closingLine.length > 0) {
          mathLines.push(closingLine);
        }
        index += 1;
      }
      blocks.push({ kind: "math", text: mathLines.join("\n").trim() });
      continue;
    }
    const bullet = line.match(/^\s*[-+*]\s+(.*)$/u);
    if (bullet) {
      const items = [];
      while (index < lines.length) {
        const item = (lines[index] ?? "").match(/^(\s*)[-+*]\s+(.*)$/u);
        if (!item) {
          break;
        }
        const task = item[2].match(/^\[( |x|X)\]\s+(.*)$/u);
        items.push({
          text: task ? task[2] : item[2],
          depth: calculateTimelineMarkdownIndentDepth(item[1]),
          task: task ? (task[1].toLowerCase() === "x" ? "checked" : "unchecked") : undefined,
        });
        index += 1;
      }
      blocks.push({ kind: "list", ordered: false, items });
      continue;
    }
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/u);
    if (numbered) {
      const items = [];
      while (index < lines.length) {
        const item = (lines[index] ?? "").match(/^(\s*)(\d+)[.)]\s+(.*)$/u);
        if (!item) {
          break;
        }
        items.push({
          text: item[3],
          depth: calculateTimelineMarkdownIndentDepth(item[1]),
          marker: item[2],
        });
        index += 1;
      }
      blocks.push({ kind: "list", ordered: true, items });
      continue;
    }
    const quote = line.match(/^\s*>\s?(.*)$/u);
    if (quote) {
      const quoteLines = [];
      while (index < lines.length) {
        const item = (lines[index] ?? "").match(/^\s*(>+\s*)(.*)$/u);
        if (!item) {
          break;
        }
        quoteLines.push({
          depth: (item[1].match(/>/gu) ?? []).length,
          text: item[2],
        });
        index += 1;
      }
      blocks.push({ kind: "quote", lines: quoteLines });
      continue;
    }
    const paragraphLines = [line];
    index += 1;
    while (index < lines.length && (lines[index] ?? "").trim().length > 0) {
      paragraphLines.push(lines[index] ?? "");
      index += 1;
    }
    blocks.push({ kind: "paragraph", text: paragraphLines.join("\n") });
  }
  return blocks.length === 0 ? [{ kind: "paragraph", text: "" }] : blocks;
}

function isTimelineMarkdownFenceClose(line, fenceMark) {
  const trimmed = String(line ?? "").trim();
  return trimmed.length >= 3 && [...trimmed].every((char) => char === fenceMark);
}

function isTimelineMarkdownTableStart(lines, index) {
  return (
    isTimelineMarkdownTableRow(lines[index] ?? "") &&
    isTimelineMarkdownTableDivider(lines[index + 1] ?? "")
  );
}

function isTimelineMarkdownTableRow(line) {
  const trimmed = String(line ?? "").trim();
  return trimmed.startsWith("|") && trimmed.endsWith("|") && trimmed.includes("|", 1);
}

function isTimelineMarkdownTableDivider(line) {
  if (!isTimelineMarkdownTableRow(line)) {
    return false;
  }
  return splitTimelineMarkdownTableRow(line).every((cell) => /^:?-{3,}:?$/u.test(cell));
}

function splitTimelineMarkdownTableRow(line) {
  return String(line ?? "")
    .trim()
    .replace(/^\|/u, "")
    .replace(/\|$/u, "")
    .split("|")
    .map((cell) => cell.trim());
}

function calculateTimelineMarkdownIndentDepth(value) {
  return Math.floor(String(value ?? "").replace(/\t/gu, "  ").length / 2);
}

function createTimelineMarkdownBlockElement(documentRef, block) {
  if (block.kind === "heading") {
    const heading = documentRef.createElement(`h${Math.min(Math.max(block.level, 1), 6)}`);
    heading.className = "timeline-markdown-heading";
    appendTimelineInlineMarkdownNodes(heading, block.text);
    return heading;
  }
  if (block.kind === "list") {
    const list = documentRef.createElement(block.ordered ? "ol" : "ul");
    list.className = "timeline-markdown-list";
    for (const item of block.items) {
      const child = documentRef.createElement("li");
      const detail = normalizeTimelineMarkdownListItem(item);
      child.dataset.markdownDepth = String(detail.depth);
      if (detail.task) {
        child.dataset.markdownTask = detail.task;
      }
      if (detail.marker) {
        child.dataset.markdownMarker = detail.marker;
      }
      appendTimelineInlineMarkdownNodes(child, detail.text);
      list.append(child);
    }
    return list;
  }
  if (block.kind === "table") {
    return createTimelineMarkdownTableElement(documentRef, block);
  }
  if (block.kind === "code") {
    const pre = documentRef.createElement("pre");
    pre.className = "timeline-markdown-code";
    const code = documentRef.createElement("code");
    code.textContent = block.text;
    pre.append(code);
    return pre;
  }
  if (block.kind === "math") {
    const math = documentRef.createElement("div");
    math.className = "timeline-markdown-math";
    math.textContent = block.text;
    return math;
  }
  if (block.kind === "media") {
    const paragraph = documentRef.createElement("p");
    paragraph.className = "timeline-markdown-media";
    const anchor = documentRef.createElement("a");
    anchor.setAttribute("href", resolveTimelineMarkdownMediaHref(block.target));
    anchor.setAttribute("target", "_blank");
    anchor.setAttribute("rel", "noopener noreferrer");
    anchor.textContent = block.target;
    paragraph.append(anchor);
    return paragraph;
  }
  if (block.kind === "quote") {
    const quote = documentRef.createElement("blockquote");
    quote.className = "timeline-markdown-quote";
    const lines = Array.isArray(block.lines)
      ? block.lines
      : String(block.text ?? "")
          .split("\n")
          .map((text) => ({ depth: 1, text }));
    for (const line of lines) {
      const child = documentRef.createElement("p");
      child.dataset.markdownQuoteDepth = String(line.depth ?? 1);
      appendTimelineInlineMarkdownNodes(child, line.text);
      quote.append(child);
    }
    return quote;
  }
  const paragraph = documentRef.createElement("p");
  paragraph.className = "timeline-markdown-paragraph";
  appendTimelineInlineMarkdownNodes(paragraph, block.text);
  return paragraph;
}

function normalizeTimelineMarkdownListItem(item) {
  if (item && typeof item === "object") {
    return {
      text: String(item.text ?? ""),
      depth: Math.max(0, Number.isFinite(item.depth) ? item.depth : 0),
      task: item.task,
      marker: item.marker,
    };
  }
  return { text: String(item ?? ""), depth: 0, task: undefined, marker: undefined };
}

function createTimelineMarkdownTableElement(documentRef, block) {
  const table = documentRef.createElement("table");
  table.className = "timeline-markdown-table";
  const thead = documentRef.createElement("thead");
  const headRow = documentRef.createElement("tr");
  for (const cell of block.header) {
    const th = documentRef.createElement("th");
    appendTimelineInlineMarkdownNodes(th, cell);
    headRow.append(th);
  }
  thead.append(headRow);
  table.append(thead);
  const tbody = documentRef.createElement("tbody");
  for (const row of block.rows) {
    const tr = documentRef.createElement("tr");
    for (const cell of row) {
      const td = documentRef.createElement("td");
      appendTimelineInlineMarkdownNodes(td, cell);
      tr.append(td);
    }
    tbody.append(tr);
  }
  table.append(tbody);
  return table;
}

function appendTimelineInlineMarkdownNodes(parent, value) {
  const documentRef = parent.ownerDocument;
  const text = String(value ?? "");
  const pattern = /(\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\(((?:https?:\/\/|mailto:)[^\s)]+)\))/gu;
  let offset = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (start > offset) {
      parent.append(documentRef.createTextNode(text.slice(offset, start)));
    }
    if (match[2] !== undefined) {
      const strong = documentRef.createElement("strong");
      strong.textContent = match[2];
      parent.append(strong);
    } else if (match[3] !== undefined) {
      const code = documentRef.createElement("code");
      code.textContent = match[3];
      parent.append(code);
    } else if (match[4] !== undefined && match[5] !== undefined) {
      const anchor = documentRef.createElement("a");
      anchor.setAttribute("href", match[5]);
      anchor.setAttribute("target", "_blank");
      anchor.setAttribute("rel", "noopener noreferrer");
      anchor.textContent = match[4];
      anchor.dataset.timelineMarkdownLink = "1";
      anchor.dataset.linkTitleOriginalLabel = match[4];
      anchor.dataset.linkTitleStatus = isTimelineMarkdownTitleFetchable(match[5])
        ? "pending"
        : "blocked";
      parent.append(anchor);
    }
    offset = start + match[0].length;
  }
  if (offset < text.length) {
    parent.append(documentRef.createTextNode(text.slice(offset)));
  }
}

function parseTimelineMarkdownMediaLine(line) {
  return String(line ?? "").match(/^\s*[`"']?MEDIA:\s*(\S+?)[`"']?\s*$/u)?.[1] ?? null;
}

function isTimelineMarkdownAudioVoiceDirective(line) {
  return /^\s*\[\[audio_as_voice\]\]\s*$/u.test(String(line ?? ""));
}

function resolveTimelineMarkdownMediaHref(target) {
  const value = String(target ?? "");
  if (/^(?:https?:\/\/|mailto:|file:\/\/)/iu.test(value)) {
    return value;
  }
  if (/^(?:\/|[A-Za-z]:[\\/])/u.test(value)) {
    return `file://${value}`;
  }
  return value;
}

export async function resolveTimelineMarkdownLinkTitles(
  root,
  resolver = fetchTimelineMarkdownLinkTitle,
) {
  if (!root || typeof root.querySelectorAll !== "function") {
    return 0;
  }
  const anchors = [...root.querySelectorAll("a[href]")];
  let resolvedCount = 0;
  for (const anchor of anchors) {
    const href = anchor.getAttribute?.("href") ?? anchor.href ?? "";
    if (!isTimelineMarkdownTitleFetchable(href)) {
      anchor.dataset.linkTitleStatus = "blocked";
      continue;
    }
    if (anchor.dataset.linkTitleStatus === "resolved") {
      continue;
    }
    anchor.dataset.linkTitleStatus = "pending";
    try {
      const title = sanitizeTimelineMarkdownLinkTitle(await resolver(href, anchor));
      if (!title) {
        anchor.dataset.linkTitleStatus = "failed";
        continue;
      }
      anchor.textContent = title;
      anchor.dataset.linkTitleStatus = "resolved";
      resolvedCount += 1;
    } catch {
      anchor.dataset.linkTitleStatus = "failed";
    }
  }
  return resolvedCount;
}

export function isTimelineMarkdownTitleFetchable(value) {
  let url;
  try {
    url = new URL(String(value ?? ""));
  } catch {
    return false;
  }
  if (!/^https?:$/u.test(url.protocol)) {
    return false;
  }
  return !isTimelineMarkdownPrivateOrLocalHost(url.hostname);
}

export async function fetchTimelineMarkdownLinkTitle(url) {
  if (!isTimelineMarkdownTitleFetchable(url) || typeof fetch !== "function") {
    return "";
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
      },
      redirect: "follow",
      signal: controller.signal,
    });
    if (!response.ok) {
      return "";
    }
    const contentType = response.headers?.get?.("content-type") ?? "";
    if (contentType && !/(?:html|xml|text\/html)/iu.test(contentType)) {
      return "";
    }
    return parseTimelineMarkdownHtmlTitle(await readTimelineMarkdownResponseSnippet(response));
  } catch {
    return "";
  } finally {
    clearTimeout(timeout);
  }
}

function sanitizeTimelineMarkdownLinkTitle(value) {
  const title = String(value ?? "").replace(/\s+/gu, " ").trim();
  if (!title || /\b(?:access denied|captcha|forbidden|request blocked)\b/iu.test(title)) {
    return "";
  }
  return title.slice(0, 240);
}

async function readTimelineMarkdownResponseSnippet(response) {
  const byteBudget = 96 * 1024;
  const reader = response.body?.getReader?.();
  if (!reader) {
    return String(await response.text()).slice(0, byteBudget);
  }
  const chunks = [];
  let bytes = 0;
  let done = false;
  try {
    while (bytes < byteBudget) {
      const next = await reader.read();
      if (next.done) {
        done = true;
        break;
      }
      if (!next.value?.length) {
        continue;
      }
      const remaining = byteBudget - bytes;
      const chunk = next.value.length > remaining ? next.value.subarray(0, remaining) : next.value;
      chunks.push(chunk);
      bytes += chunk.length;
      if (chunk.length < next.value.length) {
        break;
      }
    }
  } catch {
    return "";
  } finally {
    if (!done) {
      try {
        await reader.cancel();
      } catch {
        // Ignore stream teardown failures.
      }
    }
  }
  const joined = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(joined);
}

function parseTimelineMarkdownHtmlTitle(html) {
  const title = String(html ?? "").match(/<title[^>]*>([\s\S]*?)<\/title>/iu)?.[1] ?? "";
  return decodeTimelineMarkdownHtmlEntities(title).replace(/\s+/gu, " ").trim();
}

function decodeTimelineMarkdownHtmlEntities(value) {
  const named = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };
  return String(value ?? "")
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/giu, (_match, key) => named[String(key).toLowerCase()] ?? "")
    .replace(/&#x([0-9a-f]+);/giu, (_match, hex) => String.fromCodePoint(parseInt(hex, 16) || 32))
    .replace(/&#(\d+);/gu, (_match, decimal) => String.fromCodePoint(parseInt(decimal, 10) || 32));
}

function isTimelineMarkdownPrivateOrLocalHost(hostname) {
  const normalized = normalizeTimelineMarkdownHostname(hostname);
  if (!normalized) {
    return true;
  }
  if (/^(?:localhost|localhost\.localdomain)$/iu.test(normalized)) {
    return true;
  }
  if ([".corp", ".home", ".internal", ".lan", ".local", ".localdomain"].some((suffix) => normalized.endsWith(suffix))) {
    return true;
  }
  if (!normalized.includes(":") && !normalized.includes(".")) {
    return true;
  }
  if (isTimelineMarkdownPrivateIpv4(normalized)) {
    return true;
  }
  return isTimelineMarkdownPrivateIpv6(normalized);
}

function normalizeTimelineMarkdownHostname(value) {
  return String(value ?? "")
    .replace(/^\[/u, "")
    .replace(/\]$/u, "")
    .split("%", 1)[0]
    .replace(/\.$/u, "")
    .toLowerCase();
}

function isTimelineMarkdownPrivateIpv4(value) {
  const octets = parseTimelineMarkdownIpv4Octets(value);
  if (!octets) {
    return false;
  }
  const [a, b] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a === 255 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19))
  );
}

function parseTimelineMarkdownIpv4Octets(value) {
  const parts = String(value ?? "").split(".");
  if (parts.length !== 4) {
    return null;
  }
  const octets = parts.map((part) => Number(part));
  if (
    parts.some((part) => !/^\d{1,3}$/u.test(part)) ||
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return null;
  }
  return octets;
}

function isTimelineMarkdownPrivateIpv6(value) {
  const normalized = String(value ?? "").toLowerCase();
  if (!normalized.includes(":")) {
    return false;
  }
  if (normalized === "::" || normalized === "::1") {
    return true;
  }
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) {
    return true;
  }
  if (/^fe[89ab]/u.test(normalized)) {
    return true;
  }
  return normalized.startsWith("::ffff:") && isTimelineMarkdownPrivateIpv4(normalized.slice(7));
}

export function resolveTimelineStreamDelay(chunk) {
  const length = String(chunk ?? "").length;
  if (length <= 0) {
    return 0;
  }
  if (/[\r\n。！？.!?]/u.test(String(chunk))) {
    return 44;
  }
  return 18;
}

export function findTimelineStableMarkdownBoundary(text) {
  const value = String(text ?? "");
  let index = value.length;
  while (index > 0) {
    const boundary = value.lastIndexOf("\n\n", index - 1);
    if (boundary < 0) {
      return -1;
    }
    const splitAt = boundary + 2;
    if (!isTimelineMarkdownFenceOpenAt(value, splitAt)) {
      return splitAt;
    }
    index = boundary;
  }
  return -1;
}

function isTimelineMarkdownFenceOpenAt(text, end) {
  let codeOpen = false;
  let mathOpen = false;
  let mathOpener = null;
  let index = 0;
  while (index < end) {
    const newline = text.indexOf("\n", index);
    const lineEnd = newline < 0 || newline > end ? end : newline;
    const line = text.slice(index, lineEnd).trim();
    if (/^(?:`{3,}|~{3,})/u.test(line)) {
      codeOpen = !codeOpen;
    } else if (!codeOpen) {
      if (!mathOpen && /^\$\$/u.test(line)) {
        const singleLine = line.length >= 4 && /\$\$$/u.test(line);
        if (!singleLine) {
          mathOpen = true;
          mathOpener = "$$";
        }
      } else if (!mathOpen && /^\\\[/u.test(line)) {
        const singleLine = /\\\]$/u.test(line);
        if (!singleLine) {
          mathOpen = true;
          mathOpener = "\\[";
        }
      } else if (mathOpen && mathOpener === "$$" && /\$\$$/u.test(line)) {
        mathOpen = false;
        mathOpener = null;
      } else if (mathOpen && mathOpener === "\\[" && /\\\]$/u.test(line)) {
        mathOpen = false;
        mathOpener = null;
      }
    }
    if (newline < 0 || newline >= end) {
      break;
    }
    index = newline + 1;
  }
  return codeOpen || mathOpen;
}
