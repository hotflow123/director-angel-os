import { afterEach, describe, expect, it, vi } from "vitest";

import {
  cloneDesktopAttachmentMetadata,
  discardDesktopAttachmentDataUrls,
  getDesktopAttachmentDataUrl,
  getDesktopAttachmentPreviewUrl,
  materializeDesktopAttachmentPayloads,
  registerDesktopAttachmentPayload,
  releaseDesktopAttachmentPayloads,
  resetDesktopAttachmentPayloadStoreForTest,
} from "./attachment-payload-store.js";

describe("desktop attachment payload store OpenClaw parity", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetDesktopAttachmentPayloadStoreForTest();
  });

  it("keeps metadata clones free of large payload bytes", () => {
    const attachment = registerDesktopAttachmentPayload({
      attachment: {
        id: "att-1",
        type: "file",
        path: "/tmp/brief.pdf",
        fileName: "brief.pdf",
        mimeType: "application/pdf",
      },
      dataUrl: "data:application/pdf;base64,JVBERi0xLjQK",
      previewUrl: "blob:brief",
    });

    expect(cloneDesktopAttachmentMetadata(attachment)).toStrictEqual({
      id: "att-1",
      type: "file",
      path: "/tmp/brief.pdf",
      fileName: "brief.pdf",
      mimeType: "application/pdf",
      previewUrl: "blob:brief",
    });
  });

  it("materializes snapshotted dataUrl attachments into model payload content", () => {
    const attachment = registerDesktopAttachmentPayload({
      attachment: {
        id: "att-1",
        type: "file",
        path: "/tmp/brief.pdf",
        fileName: "brief.pdf",
        mimeType: "application/pdf",
      },
      dataUrl: "data:application/pdf;base64,JVBERi0xLjQK",
    });

    expect(materializeDesktopAttachmentPayloads([attachment])).toStrictEqual([
      {
        id: "att-1",
        type: "file",
        path: "/tmp/brief.pdf",
        fileName: "brief.pdf",
        mimeType: "application/pdf",
        contentEncoding: "base64",
        content: "JVBERi0xLjQK",
      },
    ]);
  });

  it("keeps already materialized base64 attachments intact", () => {
    expect(
      materializeDesktopAttachmentPayloads([
        {
          id: "att-1",
          type: "file",
          path: "/tmp/brief.pdf",
          fileName: "brief.pdf",
          mimeType: "application/pdf",
          contentEncoding: "base64",
          content: "JVBERi0xLjQK",
        },
      ]),
    ).toStrictEqual([
      {
        id: "att-1",
        type: "file",
        path: "/tmp/brief.pdf",
        fileName: "brief.pdf",
        mimeType: "application/pdf",
        contentEncoding: "base64",
        content: "JVBERi0xLjQK",
      },
    ]);
  });

  it("can discard sent payload bytes while keeping preview URLs", () => {
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:brief"),
      revokeObjectURL,
    });
    const attachment = registerDesktopAttachmentPayload({
      attachment: {
        id: "att-1",
        type: "file",
        path: "/tmp/brief.pdf",
        fileName: "brief.pdf",
      },
      dataUrl: "data:application/pdf;base64,JVBERi0xLjQK",
      file: { name: "brief.pdf" },
    });

    discardDesktopAttachmentDataUrls([attachment]);

    expect(getDesktopAttachmentDataUrl(attachment)).toBeNull();
    expect(getDesktopAttachmentPreviewUrl(attachment)).toBe("blob:brief");
    expect(revokeObjectURL).not.toHaveBeenCalled();
  });

  it("releases queued payloads and revokes generated preview URLs", () => {
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:queued"),
      revokeObjectURL,
    });
    const attachment = registerDesktopAttachmentPayload({
      attachment: {
        id: "queued-att",
        type: "file",
        path: "/tmp/brief.pdf",
        fileName: "brief.pdf",
      },
      dataUrl: "data:application/pdf;base64,JVBERi0xLjQK",
      file: { name: "brief.pdf" },
    });

    releaseDesktopAttachmentPayloads([attachment]);

    expect(getDesktopAttachmentDataUrl(attachment)).toBeNull();
    expect(getDesktopAttachmentPreviewUrl(attachment)).toBeNull();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:queued");
  });
});
