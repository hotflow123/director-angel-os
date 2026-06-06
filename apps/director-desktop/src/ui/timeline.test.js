import { describe, expect, it } from "vitest";

import {
  createTimelineStableMarkdownChunks,
  createTimelineStreamingMarkdownFrame,
  renderTimelineStreamingMarkdownFrame,
  findTimelineStableMarkdownBoundary,
  isTimelineMarkdownTitleFetchable,
  resolveTimelineMarkdownLinkTitles,
} from "./timeline.js";

function createFakeTimelineElement() {
  const element = {
    children: [],
    dataset: {},
    textContent: "",
    className: "",
    tagName: "DIV",
    href: "",
    ownerDocument: null,
    classList: {
      add() {},
      toggle() {},
    },
    setAttribute(name, value) {
      if (name === "data-streaming-markdown-stable") {
        this.dataset.streamingMarkdownStable = String(value);
      } else if (name === "data-streaming-markdown-unstable") {
        this.dataset.streamingMarkdownUnstable = String(value);
      } else if (name === "href") {
        this.href = String(value);
      } else {
        this.dataset[name] = String(value);
      }
    },
    querySelector(selector) {
      if (selector === "[data-streaming-markdown-stable]") {
        return this.children.find((child) => child.dataset.streamingMarkdownStable === "1") ?? null;
      }
      if (selector === "[data-streaming-markdown-unstable]") {
        return this.children.find((child) => child.dataset.streamingMarkdownUnstable === "1") ?? null;
      }
      return null;
    },
    querySelectorAll(selector) {
      const matches = [];
      const visit = (node) => {
        if (selector === "a[href]" && node.tagName === "A" && node.href) {
          matches.push(node);
        }
        for (const child of node.children ?? []) {
          visit(child);
        }
      };
      visit(this);
      return matches;
    },
    replaceChildren(...children) {
      this.children = children;
      this.textContent = children.map((child) => child.textContent).join("");
    },
    append(...children) {
      this.children.push(...children);
      this.textContent = this.children.map((child) => child.textContent).join("");
    },
  };
  element.ownerDocument = {
    createElement(tagName = "div") {
      const child = createFakeTimelineElement();
      child.tagName = String(tagName).toUpperCase();
      return child;
    },
    createTextNode(text) {
      const child = createFakeTimelineElement();
      child.tagName = "#TEXT";
      child.textContent = String(text ?? "");
      return child;
    },
  };
  return element;
}

function readChildTags(element) {
  return element.children.map((child) => child.tagName);
}

function findFirstTag(element, tagName) {
  if (!element) {
    return null;
  }
  if (element.tagName === tagName) {
    return element;
  }
  for (const child of element.children) {
    const found = findFirstTag(child, tagName);
    if (found) {
      return found;
    }
  }
  return null;
}

describe("timeline Hermes streaming markdown parity", () => {
  it("returns -1 when no blank line boundary exists", () => {
    expect(findTimelineStableMarkdownBoundary("partial line with no newline yet")).toBe(-1);
    expect(findTimelineStableMarkdownBoundary("line one\nline two\nline three")).toBe(-1);
  });

  it("splits after the last blank line separator", () => {
    const text = "first paragraph\n\nsecond paragraph\n\nthird";
    const boundary = findTimelineStableMarkdownBoundary(text);

    expect(text.slice(0, boundary)).toBe("first paragraph\n\nsecond paragraph\n\n");
    expect(text.slice(boundary)).toBe("third");
  });

  it("does not split inside open fenced code blocks", () => {
    expect(findTimelineStableMarkdownBoundary("```ts\nfn();\n\nmore code here")).toBe(-1);

    const text = "intro paragraph\n\n```ts\nfn();\n\nmore code";
    const boundary = findTimelineStableMarkdownBoundary(text);

    expect(text.slice(0, boundary)).toBe("intro paragraph\n\n");
    expect(text.slice(boundary).startsWith("```ts")).toBe(true);
  });

  it("allows splitting after fenced code closes", () => {
    const text = "```ts\nfn();\n```\n\nnarration continues";
    const boundary = findTimelineStableMarkdownBoundary(text);

    expect(text.slice(0, boundary)).toBe("```ts\nfn();\n```\n\n");
    expect(text.slice(boundary)).toBe("narration continues");
  });

  it("does not split inside display math blocks", () => {
    expect(findTimelineStableMarkdownBoundary("$$\nx + y\n\nmore math")).toBe(-1);

    const text = "intro paragraph\n\n$$\nx + y\n\nmore";
    const boundary = findTimelineStableMarkdownBoundary(text);

    expect(text.slice(0, boundary)).toBe("intro paragraph\n\n");
    expect(text.slice(boundary).startsWith("$$")).toBe(true);
  });

  it("allows splitting after display math closes", () => {
    const text = "$$\nx + y = z\n$$\n\nnarration continues";
    const boundary = findTimelineStableMarkdownBoundary(text);

    expect(text.slice(0, boundary)).toBe("$$\nx + y = z\n$$\n\n");
    expect(text.slice(boundary)).toBe("narration continues");
  });

  it("creates stable chunks before falling back to grapheme chunks for the unstable tail", () => {
    const chunks = createTimelineStableMarkdownChunks("first\n\n```ts\nconst a = 1;\n\nstill open");

    expect(chunks[0]).toBe("first\n\n");
    expect(chunks.slice(1).join("")).toBe("```ts\nconst a = 1;\n\nstill open");
  });

  it("advances the streaming markdown stable prefix monotonically like Hermes", () => {
    const state = {};
    const first = createTimelineStreamingMarkdownFrame(
      "intro\n\n```ts\nconst a = 1;\n\nstill open",
      state,
    );

    expect(first).toStrictEqual({
      stablePrefix: "intro\n\n",
      unstableSuffix: "```ts\nconst a = 1;\n\nstill open",
    });

    const second = createTimelineStreamingMarkdownFrame(
      "intro\n\n```ts\nconst a = 1;\n```\n\nnext",
      state,
    );

    expect(second.stablePrefix).toBe("intro\n\n```ts\nconst a = 1;\n```\n\n");
    expect(second.unstableSuffix).toBe("next");
  });

  it("resets the streaming markdown frame when text no longer starts with the cached prefix", () => {
    const state = { stablePrefix: "old\n\n" };

    const frame = createTimelineStreamingMarkdownFrame("new partial", state);

    expect(frame).toStrictEqual({
      stablePrefix: "",
      unstableSuffix: "new partial",
    });
    expect(state.stablePrefix).toBe("");
  });

  it("renders Hermes-style stable and unstable markdown subtrees", () => {
    const body = createFakeTimelineElement();
    const state = {};
    const frame = createTimelineStreamingMarkdownFrame(
      "intro\n\n```ts\nconst a = 1;\n\nstill open",
      state,
    );

    renderTimelineStreamingMarkdownFrame(body, frame);

    expect(body.dataset.streamingMarkdownMode).toBe("split");
    expect(body.querySelector("[data-streaming-markdown-stable]")?.textContent).toBe("intro");
    expect(body.querySelector("[data-streaming-markdown-unstable]")?.textContent).toBe(
      "const a = 1;\n\nstill open",
    );
  });

  it("reuses the stable markdown subtree while the unstable suffix changes", () => {
    const body = createFakeTimelineElement();
    const state = {};
    const first = createTimelineStreamingMarkdownFrame("intro\n\npartial", state);
    renderTimelineStreamingMarkdownFrame(body, first);
    const stableNode = body.querySelector("[data-streaming-markdown-stable]");

    const second = createTimelineStreamingMarkdownFrame("intro\n\npartial grows", state);
    renderTimelineStreamingMarkdownFrame(body, second);

    expect(body.querySelector("[data-streaming-markdown-stable]")).toBe(stableNode);
    expect(body.querySelector("[data-streaming-markdown-unstable]")?.textContent).toBe(
      "partial grows",
    );
  });

  it("renders basic markdown blocks inside streaming subtrees without innerHTML", () => {
    const body = createFakeTimelineElement();
    const state = {};
    const frame = createTimelineStreamingMarkdownFrame(
      "# Title\n\n- one\n- two\n\n```js\nconst ok = true;\n```\n\npartial",
      state,
    );

    renderTimelineStreamingMarkdownFrame(body, frame);

    const stableNode = body.querySelector("[data-streaming-markdown-stable]");
    expect(readChildTags(stableNode)).toEqual(["H1", "UL", "PRE"]);
    expect(stableNode.children[0]?.textContent).toBe("Title");
    expect(stableNode.children[1]?.children.map((child) => child.textContent)).toEqual([
      "one",
      "two",
    ]);
    expect(stableNode.children[2]?.textContent).toBe("const ok = true;");
    expect(stableNode.innerHTML).toBeUndefined();
  });

  it("renders inline emphasis, code, and links as safe DOM nodes", () => {
    const body = createFakeTimelineElement();
    const frame = createTimelineStreamingMarkdownFrame(
      "Intro with **bold** and `code` plus [docs](https://example.com).\n\nnext",
      {},
    );

    renderTimelineStreamingMarkdownFrame(body, frame);

    const stableNode = body.querySelector("[data-streaming-markdown-stable]");
    const paragraph = stableNode.children[0];
    expect(readChildTags(paragraph)).toEqual(["#TEXT", "STRONG", "#TEXT", "CODE", "#TEXT", "A", "#TEXT"]);
    expect(findFirstTag(paragraph, "STRONG")?.textContent).toBe("bold");
    expect(findFirstTag(paragraph, "CODE")?.textContent).toBe("code");
    expect(findFirstTag(paragraph, "A")?.href).toBe("https://example.com");
  });

  it("renders markdown tables and display math as safe block DOM", () => {
    const body = createFakeTimelineElement();
    const frame = createTimelineStreamingMarkdownFrame(
      "| A | B |\n|---|---|\n| 1 | 2 |\n\n$$\nx + y = z\n$$\n\nnext",
      {},
    );

    renderTimelineStreamingMarkdownFrame(body, frame);

    const stableNode = body.querySelector("[data-streaming-markdown-stable]");
    expect(readChildTags(stableNode)).toEqual(["TABLE", "DIV"]);
    expect(findFirstTag(stableNode, "TH")?.textContent).toBe("A");
    expect(findFirstTag(stableNode, "TD")?.textContent).toBe("1");
    expect(findFirstTag(stableNode, "DIV")?.className).toBe("timeline-markdown-math");
    expect(findFirstTag(stableNode, "DIV")?.textContent).toBe("x + y = z");
  });

  it("renders Hermes media lines as safe links and hides audio voice directives", () => {
    const body = createFakeTimelineElement();
    const frame = createTimelineStreamingMarkdownFrame(
      "MEDIA:/tmp/render.png\n\n[[audio_as_voice]]\n\nMEDIA:https://example.com/a.mp4\n\nnext",
      {},
    );

    renderTimelineStreamingMarkdownFrame(body, frame);

    const stableNode = body.querySelector("[data-streaming-markdown-stable]");
    expect(readChildTags(stableNode)).toEqual(["P", "P"]);
    expect(stableNode.textContent).toBe("/tmp/render.pnghttps://example.com/a.mp4");
    expect(stableNode.children[0]?.className).toBe("timeline-markdown-media");
    expect(stableNode.children[0]?.children[0]?.href).toBe("file:///tmp/render.png");
    expect(stableNode.children[1]?.children[0]?.href).toBe("https://example.com/a.mp4");
  });

  it("keeps Hermes-style nested list depth, task markers, and quote depth", () => {
    const body = createFakeTimelineElement();
    const frame = createTimelineStreamingMarkdownFrame(
      "- parent\n  - child\n  - [x] done\n\n> outer\n>> inner\n\nnext",
      {},
    );

    renderTimelineStreamingMarkdownFrame(body, frame);

    const stableNode = body.querySelector("[data-streaming-markdown-stable]");
    const list = stableNode.children[0];
    const quote = stableNode.children[1];
    expect(readChildTags(stableNode)).toEqual(["UL", "BLOCKQUOTE"]);
    expect(list.children.map((child) => child.dataset.markdownDepth)).toEqual(["0", "1", "1"]);
    expect(list.children.map((child) => child.dataset.markdownTask)).toEqual([
      undefined,
      undefined,
      "checked",
    ]);
    expect(list.children.map((child) => child.textContent)).toEqual(["parent", "child", "done"]);
    expect(quote.children.map((child) => child.dataset.markdownQuoteDepth)).toEqual(["1", "2"]);
    expect(quote.children.map((child) => child.textContent)).toEqual(["outer", "inner"]);
  });

  it("resolves safe markdown link titles asynchronously without blocking the fallback label", async () => {
    const body = createFakeTimelineElement();
    const frame = createTimelineStreamingMarkdownFrame(
      "Read [docs](https://example.com/a-good-slug) now.\n\nnext",
      {},
    );

    renderTimelineStreamingMarkdownFrame(body, frame);

    const anchor = findFirstTag(body, "A");
    expect(anchor?.textContent).toBe("docs");
    expect(anchor?.dataset.linkTitleStatus).toBe("pending");

    const resolved = await resolveTimelineMarkdownLinkTitles(body, async (url) => {
      expect(url).toBe("https://example.com/a-good-slug");
      return "Example Documentation";
    });

    expect(resolved).toBe(1);
    expect(anchor?.textContent).toBe("Example Documentation");
    expect(anchor?.dataset.linkTitleStatus).toBe("resolved");
  });

  it("blocks unsafe link title resolution targets", async () => {
    const body = createFakeTimelineElement();
    const frame = createTimelineStreamingMarkdownFrame(
      [
        "[mail](mailto:a@example.com)",
        "[local](http://localhost:3000)",
        "[lan](http://router.local/status)",
        "[private](http://192.168.1.2/page)",
        "[script](javascript:alert(1))",
      ].join(" ") + "\n\nnext",
      {},
    );

    renderTimelineStreamingMarkdownFrame(body, frame);

    const calls = [];
    const resolved = await resolveTimelineMarkdownLinkTitles(body, async (url) => {
      calls.push(url);
      return "Should Not Appear";
    });

    expect(resolved).toBe(0);
    expect(calls).toEqual([]);
    expect(body.querySelectorAll("a[href]").map((anchor) => anchor.dataset.linkTitleStatus)).toEqual([
      "blocked",
      "blocked",
      "blocked",
      "blocked",
    ]);
    expect(isTimelineMarkdownTitleFetchable("https://example.com/a-good-slug")).toBe(true);
    expect(isTimelineMarkdownTitleFetchable("mailto:a@example.com")).toBe(false);
    expect(isTimelineMarkdownTitleFetchable("http://10.0.0.1/status")).toBe(false);
    expect(isTimelineMarkdownTitleFetchable("http://singlelabel/path")).toBe(false);
  });

  it("keeps the original markdown link label when title resolution fails", async () => {
    const body = createFakeTimelineElement();
    const frame = createTimelineStreamingMarkdownFrame(
      "Read [docs](https://example.com/failing-title) now.\n\nnext",
      {},
    );

    renderTimelineStreamingMarkdownFrame(body, frame);

    const anchor = findFirstTag(body, "A");
    await resolveTimelineMarkdownLinkTitles(body, async () => {
      throw new Error("network timeout");
    });

    expect(anchor?.textContent).toBe("docs");
    expect(anchor?.dataset.linkTitleStatus).toBe("failed");
  });
});
