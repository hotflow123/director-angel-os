import { describe, expect, it } from "vitest";

import {
  createChannelVoiceInputEnvelope,
  planChannelVoiceTranscription,
} from "../src/channel-voice-input.js";

describe("channel voice input envelope", () => {
  it("normalizes desktop, weixin, and upload voice into one audio.transcribe plan", () => {
    const desktop = createChannelVoiceInputEnvelope({
      surface: "desktop",
      channel: "director-desktop",
      messageId: "desktop-voice-1",
      fileRef: {
        path: "/tmp/director-desktop/voice.wav",
        mimeType: "audio/wav",
        sizeBytes: 4096,
        durationMs: 1200,
        sha256: "sha256-desktop",
      },
    });
    const weixin = createChannelVoiceInputEnvelope({
      surface: "weixin",
      channel: "personal-weixin",
      messageId: "wx-voice-1",
      weixinVoice: {
        messageId: "wx-voice-1",
        mimeType: "audio/silk",
        sizeBytes: 2048,
        durationMs: 900,
      },
    });
    const upload = createChannelVoiceInputEnvelope({
      surface: "host-api",
      channel: "future-client",
      messageId: "upload-voice-1",
      upload: {
        uploadId: "upload-voice-1",
        mimeType: "audio/mpeg",
        sizeBytes: 8192,
        sha256: "sha256-upload",
      },
    });

    expect([desktop.source.kind, weixin.source.kind, upload.source.kind]).toEqual([
      "desktop-recording",
      "weixin-voice",
      "upload",
    ]);

    for (const envelope of [desktop, weixin, upload]) {
      const plan = planChannelVoiceTranscription(envelope, {
        providerId: "memefast-compatible-stt",
      });
      expect(plan).toMatchObject({
        ok: true,
        capabilityId: "audio.transcribe",
        providerId: "memefast-compatible-stt",
        usesUnifiedConversationRuntime: true,
        sideEffects: {
          audioBytesRead: false,
          rawAudioPersisted: false,
          providerCredentialsUsed: false,
          networkUsed: false,
          microphoneAccessed: false,
        },
      });
      expect(plan.runtimeInput.source.kind).toBe(envelope.source.kind);
      expect(JSON.stringify(plan)).not.toContain("sk-");
    }
  });

  it("blocks unsupported or incomplete channel voice input without reading audio", () => {
    const missing = createChannelVoiceInputEnvelope({
      surface: "weixin",
      channel: "personal-weixin",
      messageId: "wx-voice-missing",
      weixinVoice: {
        messageId: "",
        mimeType: "audio/silk",
      },
    });

    expect(
      planChannelVoiceTranscription(missing, { providerId: "local-whisper-cli" }),
    ).toMatchObject({
      ok: false,
      status: "blocked",
      reason: expect.stringContaining("微信语音消息缺少 messageId"),
      sideEffects: {
        audioBytesRead: false,
        rawAudioPersisted: false,
        providerCredentialsUsed: false,
      },
    });
  });
});
