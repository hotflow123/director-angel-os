export const CONVERSATION_RUNTIME_INTERNAL_CONTEXT_TAGS = [
  "learning-evidence-context",
  "memory-context",
  "evidence-context",
] as const;

const INTERNAL_CONTEXT_TAG_PATTERN = new RegExp(
  `<\\/?(?:${CONVERSATION_RUNTIME_INTERNAL_CONTEXT_TAGS.join("|")})>`,
  "iu",
);

export function scrubConversationRuntimeInternalContextTags(text: string): string {
  let output = "";
  let index = 0;
  while (index < text.length) {
    const next = findNextInternalContextTag(text, index);
    if (next === undefined) {
      output += text.slice(index);
      break;
    }
    output += text.slice(index, next.start);
    if (next.closing) {
      index = next.end;
      continue;
    }
    const close = findClosingInternalContextTag(text, next.tag, next.end);
    if (close === undefined) {
      break;
    }
    index = close.end;
  }
  return output.replace(/\n{3,}/gu, "\n\n").trim();
}

export class ConversationRuntimeStreamingContextScrubber {
  private buffer = "";
  private insideContextTag = false;

  filterDelta(delta: string): string {
    this.buffer += delta;
    const output = this.consumeStableBuffer();
    return output;
  }

  flush(): string {
    let output = "";
    while (this.buffer.length > 0) {
      const next = this.consumeNextCharacter({ flush: true });
      if (next === undefined) {
        break;
      }
      output += next;
    }
    this.buffer = "";
    this.insideContextTag = false;
    return output;
  }

  reset(): void {
    this.buffer = "";
    this.insideContextTag = false;
  }

  private consumeStableBuffer(): string {
    let output = "";
    while (this.buffer.length > 0) {
      const next = this.consumeNextCharacter({ flush: false });
      if (next === undefined) {
        break;
      }
      output += next;
    }
    return output;
  }

  private consumeNextCharacter(input: { readonly flush: boolean }): string | undefined {
    if (this.insideContextTag) {
      const close = findNextClosingTagInBuffer(this.buffer);
      if (close === undefined) {
        this.buffer = "";
        return undefined;
      }
      this.buffer = this.buffer.slice(close.end);
      this.insideContextTag = false;
      return "";
    }

    const open = findOpenTagAtBufferStart(this.buffer);
    if (open !== undefined) {
      this.buffer = this.buffer.slice(open.length);
      this.insideContextTag = true;
      return "";
    }
    if (!input.flush && isPotentialInternalContextOpenTagPrefix(this.buffer)) {
      return undefined;
    }
    const char = this.buffer[0];
    this.buffer = this.buffer.slice(1);
    return char;
  }
}

function findNextInternalContextTag(
  text: string,
  fromIndex: number,
):
  | {
      readonly start: number;
      readonly end: number;
      readonly tag: string;
      readonly closing: boolean;
    }
  | undefined {
  const match = INTERNAL_CONTEXT_TAG_PATTERN.exec(text.slice(fromIndex));
  if (match === null || match.index === undefined) {
    return undefined;
  }
  const raw = match[0];
  const start = fromIndex + match.index;
  const end = start + raw.length;
  return {
    start,
    end,
    tag: raw.replace(/[</>]/gu, "").toLocaleLowerCase(),
    closing: raw.startsWith("</"),
  };
}

function findClosingInternalContextTag(
  text: string,
  tag: string,
  fromIndex: number,
): { readonly start: number; readonly end: number } | undefined {
  const close = new RegExp(`</${escapeRegExp(tag)}>`, "iu").exec(text.slice(fromIndex));
  if (close === null || close.index === undefined) {
    return undefined;
  }
  const start = fromIndex + close.index;
  return {
    start,
    end: start + close[0].length,
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function findOpenTagAtBufferStart(
  buffer: string,
): { readonly tag: string; readonly length: number } | undefined {
  const lower = buffer.toLocaleLowerCase();
  for (const tag of CONVERSATION_RUNTIME_INTERNAL_CONTEXT_TAGS) {
    const raw = `<${tag}>`;
    if (lower.startsWith(raw)) {
      return { tag, length: raw.length };
    }
  }
  return undefined;
}

function isPotentialInternalContextOpenTagPrefix(buffer: string): boolean {
  const lower = buffer.toLocaleLowerCase();
  return CONVERSATION_RUNTIME_INTERNAL_CONTEXT_TAGS.some((tag) => `<${tag}>`.startsWith(lower));
}

function findNextClosingTagInBuffer(
  buffer: string,
): { readonly start: number; readonly end: number } | undefined {
  let next: { readonly start: number; readonly end: number } | undefined;
  const lower = buffer.toLocaleLowerCase();
  for (const tag of CONVERSATION_RUNTIME_INTERNAL_CONTEXT_TAGS) {
    const raw = `</${tag}>`;
    const start = lower.indexOf(raw);
    if (start === -1) {
      continue;
    }
    const end = start + raw.length;
    if (next === undefined || start < next.start) {
      next = { start, end };
    }
  }
  return next;
}
