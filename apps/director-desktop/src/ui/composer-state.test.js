import { describe, expect, it } from "vitest";

import {
  addComposerAttachment,
  clearComposerAttachments,
  createComposerState,
  createComposerAttachmentsFromFiles,
  createComposerAttachmentsFromPastedFiles,
  resolveComposerKeyAction,
  insertComposerNewline,
  removeComposerAttachment,
  looksLikeDroppedPath,
} from "./composer-state.js";

describe("composer state Hermes parity", () => {
  it("clears submitted input and stores it in local history", () => {
    const composer = createComposerState();
    composer.setInput("哪些地方最有用？");

    const submitted = composer.submitCurrentInput();

    expect(submitted).toBe("哪些地方最有用？");
    expect(composer.input).toBe("");
    expect(composer.navigateHistory("up")).toBe(true);
    expect(composer.input).toBe("哪些地方最有用？");
  });

  it("preserves the draft while navigating history and restores it on down", () => {
    const composer = createComposerState();
    composer.setInput("学习这个 https://example.com/a");
    composer.submitCurrentInput();
    composer.setInput("还没发出的草稿");

    expect(composer.navigateHistory("up")).toBe(true);
    expect(composer.input).toBe("学习这个 https://example.com/a");
    expect(composer.navigateHistory("down")).toBe(true);
    expect(composer.input).toBe("还没发出的草稿");
  });

  it("deduplicates consecutive history entries", () => {
    const composer = createComposerState();
    composer.setInput("重复问题");
    composer.submitCurrentInput();
    composer.setInput("重复问题");
    composer.submitCurrentInput();

    expect(composer.history).toStrictEqual(["重复问题"]);
  });

  it("recognizes dropped local paths without treating URLs as files", () => {
    expect(looksLikeDroppedPath("/Users/example/Desktop/capture.png")).toBe(true);
    expect(looksLikeDroppedPath("file:///tmp/screenshot.png")).toBe(true);
    expect(looksLikeDroppedPath("/help")).toBe(false);
    expect(looksLikeDroppedPath("https://example.com/image.png")).toBe(false);
    expect(looksLikeDroppedPath("line one\nline two")).toBe(false);
  });

  it("adds, deduplicates, and removes local file attachments", () => {
    const composer = createComposerState();

    const first = addComposerAttachment(composer, {
      path: "/Users/example/Desktop/capture.png",
      fileName: "capture.png",
      mimeType: "image/png",
      sizeBytes: 1234,
    });
    const duplicate = addComposerAttachment(composer, {
      path: "/Users/example/Desktop/capture.png",
      fileName: "capture-copy.png",
    });

    expect(first).toMatchObject({
      type: "file",
      path: "/Users/example/Desktop/capture.png",
      fileName: "capture.png",
      mimeType: "image/png",
      sizeBytes: 1234,
    });
    expect(duplicate.id).toBe(first.id);
    expect(composer.attachments).toHaveLength(1);

    expect(removeComposerAttachment(composer, first.id)).toBe(true);
    expect(composer.attachments).toStrictEqual([]);
  });

  it("clears attachments with submitted input but leaves history intact", () => {
    const composer = createComposerState();
    composer.setInput("分析这个截图");
    addComposerAttachment(composer, {
      path: "/Users/example/Desktop/capture.png",
    });

    const submitted = composer.submitCurrentInput();

    expect(submitted).toBe("分析这个截图");
    expect(composer.history).toStrictEqual(["分析这个截图"]);
    expect(composer.attachments).toStrictEqual([]);
  });

  it("can clear attachments without changing the draft", () => {
    const composer = createComposerState();
    composer.setInput("保留草稿");
    addComposerAttachment(composer, {
      path: "/Users/example/Desktop/capture.png",
    });

    clearComposerAttachments(composer);

    expect(composer.input).toBe("保留草稿");
    expect(composer.attachments).toStrictEqual([]);
  });

  it("creates attachment metadata from dropped desktop files without reading content", () => {
    const attachments = createComposerAttachmentsFromFiles([
      {
        path: "/Users/example/Desktop/capture.png",
        name: "capture.png",
        type: "image/png",
        size: 2048,
      },
      {
        name: "browser-only-file.png",
        type: "image/png",
        size: 1024,
      },
    ]);

    expect(attachments).toStrictEqual([
      {
        id: "composer-attachment-g78pub",
        type: "file",
        path: "/Users/example/Desktop/capture.png",
        fileName: "capture.png",
        mimeType: "image/png",
        sizeBytes: 2048,
      },
    ]);
  });

  it("creates dataUrl payload snapshots for dropped desktop files when bytes are provided", async () => {
    const file = {
      path: "/Users/example/Desktop/brief.pdf",
      name: "brief.pdf",
      type: "application/pdf",
      size: 7,
      async arrayBuffer() {
        return new TextEncoder().encode("brief\n").buffer;
      },
    };

    const attachments = await createComposerAttachmentsFromFiles([file], {
      includePayloads: true,
    });

    expect(attachments).toStrictEqual([
      {
        id: "composer-attachment-lrcr4",
        type: "file",
        path: "/Users/example/Desktop/brief.pdf",
        fileName: "brief.pdf",
        mimeType: "application/pdf",
        sizeBytes: 7,
        dataUrl: "data:application/pdf;base64,YnJpZWYK",
      },
    ]);
  });

  it("creates payload-backed attachments from pasted files even without desktop paths", async () => {
    const file = {
      name: "clipboard-image.png",
      type: "image/png",
      size: 5,
      async arrayBuffer() {
        return new Uint8Array([1, 2, 3, 4, 5]).buffer;
      },
    };

    const attachments = await createComposerAttachmentsFromPastedFiles([file]);

    expect(attachments).toStrictEqual([
      {
        id: "composer-paste-1onnx1x",
        type: "file",
        fileName: "clipboard-image.png",
        mimeType: "image/png",
        sizeBytes: 5,
        dataUrl: "data:image/png;base64,AQIDBAU=",
      },
    ]);
  });

  it("does not submit while IME composition is active", () => {
    expect(
      resolveComposerKeyAction({
        key: "Enter",
        isComposing: true,
      }),
    ).toBe("ignore");
  });

  it("uses Shift+Enter for multiline drafts and plain Enter for submit", () => {
    expect(resolveComposerKeyAction({ key: "Enter", shiftKey: true })).toBe("newline");
    expect(resolveComposerKeyAction({ key: "Enter", shiftKey: false })).toBe("submit");
  });

  it("inserts composer newlines at the current selection", () => {
    expect(insertComposerNewline("第一行第二行", 3, 3)).toStrictEqual({
      value: "第一行\n第二行",
      cursor: 4,
    });
    expect(insertComposerNewline("第一行旧内容第二行", 3, 6)).toStrictEqual({
      value: "第一行\n第二行",
      cursor: 4,
    });
  });
});
