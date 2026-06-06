import { describe, expect, it } from "vitest";

import {
  createDesktopLiveAudioHost,
  createFailClosedDesktopLiveAudioCaptureAdapter,
} from "./desktop-live-audio-host.js";

describe("desktop live audio host", () => {
  it("fails closed without an explicitly injected capture adapter", async () => {
    const host = createDesktopLiveAudioHost();

    const started = await host.start({ turnId: "turn-audio-1" });

    expect(started.ok).toBe(false);
    expect(started.status).toBe("blocked");
    expect(started.reason).toContain("真实麦克风");
    expect(started.session).toMatchObject({
      capabilityId: "audio.capture",
      providerId: "desktop-microphone",
      liveRunnerStarted: false,
      providerCredentialsUsed: false,
      networkUsed: false,
      audioBytesRead: false,
      microphoneAccessed: false,
      rawAudioPersisted: false,
      whisperStarted: false,
    });
    await expect(host.status()).resolves.toMatchObject({
      active: false,
      status: "blocked",
      latestSession: expect.objectContaining({
        status: "failed",
      }),
    });
  });

  it("starts, stops, and cancels a mock capture session while releasing resources exactly once", async () => {
    const calls = [];
    const host = createDesktopLiveAudioHost({
      captureAdapter: {
        async start(input) {
          calls.push(["start", input.session.sessionId]);
          return {
            stop: async () => {
              calls.push(["stop", input.session.sessionId]);
            },
            cancel: async (reason) => {
              calls.push(["cancel", input.session.sessionId, reason]);
            },
          };
        },
      },
    });

    const started = await host.start({ turnId: "turn-audio-2", mode: "push-to-talk" });
    expect(started).toMatchObject({
      ok: true,
      status: "recording",
      session: {
        status: "running",
        capabilityId: "audio.capture",
        providerSdkLoaded: false,
        providerCredentialsUsed: false,
        networkUsed: false,
        localProcessStarted: false,
        rawAudioPersisted: false,
        whisperStarted: false,
      },
    });
    await expect(host.status()).resolves.toMatchObject({
      active: true,
      status: "recording",
      latestSession: expect.objectContaining({
        status: "running",
      }),
    });

    const stopped = await host.stop({ reason: "operator released hold key" });
    expect(stopped).toMatchObject({
      ok: true,
      status: "stopped",
      released: true,
      session: { status: "completed" },
    });
    const stoppedAgain = await host.stop({ reason: "second stop click" });
    expect(stoppedAgain).toMatchObject({
      ok: true,
      status: "idle",
      released: false,
    });
    expect(calls).toEqual([
      ["start", started.session.sessionId],
      ["stop", started.session.sessionId],
    ]);

    const restarted = await host.start({ turnId: "turn-audio-3" });
    expect(restarted.ok).toBe(true);
    const cancelled = await host.cancel({ reason: "operator cancelled voice" });
    expect(cancelled).toMatchObject({
      ok: true,
      status: "cancelled",
      released: true,
      session: { status: "cancelled", cancelReason: "operator cancelled voice" },
    });
    const cancelledAgain = await host.cancel({ reason: "second cancel click" });
    expect(cancelledAgain).toMatchObject({
      ok: true,
      status: "idle",
      released: false,
    });
    expect(calls).toEqual([
      ["start", started.session.sessionId],
      ["stop", started.session.sessionId],
      ["start", restarted.session.sessionId],
      ["cancel", restarted.session.sessionId, "operator cancelled voice"],
    ]);
  });

  it("lets tests explicitly inject a fail-closed adapter without touching devices", async () => {
    const host = createDesktopLiveAudioHost({
      captureAdapter: createFailClosedDesktopLiveAudioCaptureAdapter("测试环境没有授权麦克风。"),
    });

    const result = await host.start({ turnId: "turn-audio-4" });

    expect(result).toMatchObject({
      ok: false,
      status: "blocked",
      reason: "测试环境没有授权麦克风。",
      session: {
        liveRunnerStarted: false,
        microphoneAccessed: false,
        audioBytesRead: false,
      },
    });
  });
});
