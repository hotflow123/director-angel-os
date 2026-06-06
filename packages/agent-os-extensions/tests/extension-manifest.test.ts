import { describe, expect, it } from "vitest";

import {
  createAgentOsExtensionMatrix,
  createBuiltInAgentOsExtensionManifests,
  createComfyUiExtensionManifest,
  createMcpExtensionManifest,
  createMediaAnalysisExtensionManifest,
  createMediaUnderstandingExtensionManifest,
  createMemefastExtensionManifest,
  createVoiceLiveAudioExtensionManifest,
  createXTwitterExtensionManifest,
} from "../src/index.js";

describe("Agent OS extension manifests", () => {
  it("projects ComfyUI into a provider extension with install, sandbox, health, and UI surfaces", () => {
    const manifest = createComfyUiExtensionManifest({
      id: "comfyui.local",
      displayName: "ComfyUI Local",
      providerId: "comfyui",
      health: {
        status: "needs-setup",
        checkedAt: "2026-05-08T00:00:00.000Z",
        checkFn: "comfyui.health",
      },
    });

    expect(manifest).toMatchObject({
      id: "comfyui.local",
      kind: "provider",
      displayName: "ComfyUI Local",
      providerId: "comfyui",
      sourceTrust: { status: "trusted-local-config" },
      installPolicy: {
        supported: true,
        defaultMode: "plan",
        requiresExplicitExecute: true,
      },
      sandboxPolicy: {
        defaultMode: "host",
        networkPolicy: "none",
        requiresCommandPattern: true,
      },
      health: {
        status: "needs-setup",
        checkFn: "comfyui.health",
      },
      uiSurfaces: expect.arrayContaining(["settings", "tools", "approval-card", "review"]),
    });
    expect(manifest.capabilities.map((capability) => capability.id)).toEqual([
      "comfyui.lifecycle",
      "comfyui.install",
      "comfyui.workflow.inspect",
      "comfyui.workflow.invoke",
      "media.generate_image",
      "media.generate_video",
      "artifact.output",
    ]);
    expect(manifest.tools.map((tool) => tool.name)).toEqual([
      "comfyui.status",
      "comfyui.start",
      "comfyui.stop",
      "comfyui.install",
      "comfyui.workflow.invoke",
    ]);
  });

  it("builds a first extension matrix for web, browser, MCP, ComfyUI, MemeFast, voice, and X/Twitter", () => {
    const matrix = createAgentOsExtensionMatrix(createBuiltInAgentOsExtensionManifests());

    expect(matrix.summary).toEqual({
      total: 8,
      ready: 3,
      needsAuth: 2,
      needsSetup: 1,
      disabled: 1,
      problem: 1,
    });
    expect(matrix.entries.map((entry) => entry.id)).toEqual([
      "browser.desktop",
      "comfyui.local",
      "mcp.local",
      "media-understanding.local",
      "memefast.api",
      "voice.live-audio",
      "web.builtin",
      "x-twitter",
    ]);
    const browserEntry = matrix.entries.find((entry) => entry.id === "browser.desktop");
    expect(browserEntry).toMatchObject({
      kind: "tool-source",
      capabilityIds: expect.arrayContaining(["browser.navigate", "browser.snapshot"]),
      capabilities: expect.arrayContaining([
        expect.objectContaining({ id: "browser.navigate", readOnly: false }),
      ]),
      tools: expect.arrayContaining([
        expect.objectContaining({ name: "browser_navigate", capabilityId: "browser.navigate" }),
      ]),
      sandbox: {
        defaultMode: "network-limited",
        networkPolicy: "limited",
      },
      health: { status: "ready" },
    });
    expect(browserEntry?.capabilityIds).toEqual(
      expect.arrayContaining([
        "browser.navigate",
        "browser.snapshot",
        "browser.click",
        "browser.type",
        "browser.scroll",
        "browser.back",
        "browser.press",
        "browser.images",
        "browser.console",
      ]),
    );
    expect(browserEntry?.tools.map((tool) => [tool.name, tool.capabilityId])).toEqual([
      ["browser_navigate", "browser.navigate"],
      ["browser_snapshot", "browser.snapshot"],
      ["browser_click", "browser.click"],
      ["browser_type", "browser.type"],
      ["browser_scroll", "browser.scroll"],
      ["browser_back", "browser.back"],
      ["browser_press", "browser.press"],
      ["browser_get_images", "browser.images"],
      ["browser_console", "browser.console"],
    ]);
    expect(matrix.entries.find((entry) => entry.id === "mcp.local")).toMatchObject({
      kind: "tool-source",
      capabilityIds: expect.arrayContaining(["mcp.tool", "mcp.oauth"]),
      sandbox: {
        defaultMode: "host",
        requiresCommandPattern: true,
      },
      health: { status: "problem" },
    });
    expect(matrix.byCapability["media.generate_image"]?.map((entry) => entry.id)).toEqual([
      "comfyui.local",
      "memefast.api",
    ]);
    expect(matrix.byCapability["model.chat"]?.map((entry) => entry.id)).toEqual(["memefast.api"]);
    expect(matrix.byCapability["audio.realtime.talk"]?.map((entry) => entry.id)).toEqual([
      "voice.live-audio",
    ]);
    expect(matrix.byCapability["media.understand_image"]?.map((entry) => entry.id)).toEqual([
      "media-understanding.local",
    ]);
  });

  it("declares a disabled fail-closed live audio provider for unified STT/TTS/Talk", () => {
    const manifest = createVoiceLiveAudioExtensionManifest();

    expect(manifest).toMatchObject({
      id: "voice.live-audio",
      kind: "provider",
      displayName: "Live Audio",
      providerId: "voice-live-audio",
      health: {
        status: "disabled",
        message: expect.stringContaining("真实语音"),
      },
      sandboxPolicy: {
        defaultMode: "host",
        networkPolicy: "none",
        requiresCommandPattern: true,
      },
      metadata: {
        failClosed: true,
        microphoneAccessed: false,
        speakerAccessed: false,
        audioBytesRead: false,
        rawAudioPersisted: false,
        providerCredentialsUsed: false,
        networkUsed: false,
        localProcessStarted: false,
        whisperStarted: false,
        liveRunnerStarted: false,
      },
    });
    expect(manifest.capabilities.map((capability) => capability.id)).toEqual([
      "audio.capture",
      "audio.transcribe",
      "audio.synthesize",
      "audio.realtime.transcribe",
      "audio.realtime.talk",
    ]);
    expect(manifest.providerAccounts).toEqual([
      expect.objectContaining({
        id: "voice-provider",
        authType: "secret-ref",
        required: false,
        scopes: expect.arrayContaining(["audio.transcribe", "audio.synthesize"]),
      }),
    ]);
  });

  it("declares Browser.next hardening metadata for desktop browser automation", () => {
    const matrix = createAgentOsExtensionMatrix(createBuiltInAgentOsExtensionManifests());
    const browserEntry = matrix.entries.find((entry) => entry.id === "browser.desktop");

    expect(browserEntry?.metadata).toMatchObject({
      automationHardening: {
        runnerImplementation: "electron-browser-window",
        externalProcessRunner: false,
        credentialProfileAccess: "operator-scope-required",
        unmanagedPlaywrightChromiumProcess: false,
        requiresOperatorScopeForProfileAccess: true,
        processLedgerRequiredForExternalRunner: true,
      },
    });
  });

  it("declares a built-in read-only media-understanding provider runner", () => {
    const manifest = createMediaUnderstandingExtensionManifest();

    expect(manifest).toMatchObject({
      id: "media-understanding.local",
      kind: "provider",
      displayName: "Media Understanding",
      providerId: "media-understanding",
      sourceTrust: { status: "built-in" },
      installPolicy: { supported: false, defaultMode: "none" },
      sandboxPolicy: {
        defaultMode: "readonly",
        networkPolicy: "none",
        requiresCommandPattern: false,
      },
      health: { status: "ready", checkFn: "media-understanding.local" },
      uiSurfaces: expect.arrayContaining(["tools", "review"]),
    });
    expect(manifest.capabilities).toEqual([
      expect.objectContaining({ id: "media.understand_image", readOnly: true, risk: "low" }),
      expect.objectContaining({ id: "media.understand_video", readOnly: true, risk: "low" }),
      expect.objectContaining({ id: "media.understand_audio", readOnly: true, risk: "low" }),
      expect.objectContaining({ id: "artifact.metadata.inspect", readOnly: true, risk: "low" }),
    ]);
    expect(manifest.metadata).toMatchObject({
      supportedContainers: expect.arrayContaining(["mp4", "webm", "wav", "flac"]),
      semanticTranscription: "unsupported",
    });
    expect(manifest.tools).toEqual([
      expect.objectContaining({
        name: "media_understanding.inspect",
        capabilityId: "media.understand_image",
        readOnly: true,
      }),
      expect.objectContaining({
        name: "media_understanding.inspect_video",
        capabilityId: "media.understand_video",
        readOnly: true,
      }),
      expect.objectContaining({
        name: "media_understanding.inspect_audio",
        capabilityId: "media.understand_audio",
        readOnly: true,
      }),
    ]);
  });

  it("declares a built-in sandbox-owned real non-voice media-analysis provider runner", () => {
    const manifest = createMediaAnalysisExtensionManifest();

    expect(manifest).toMatchObject({
      id: "media-analysis.local",
      kind: "provider",
      displayName: "Media Analysis",
      providerId: "media-analysis",
      sourceTrust: { status: "built-in" },
      installPolicy: { supported: false, defaultMode: "none" },
      sandboxPolicy: {
        defaultMode: "host",
        networkPolicy: "none",
        requiresCommandPattern: true,
      },
      health: { status: "ready", checkFn: "media-analysis.local" },
      metadata: {
        runnerKind: "local-media-analysis-provider-runner",
        supportedModes: ["local-command-dry-run"],
        semanticTranscription: "unsupported",
        providerCredentialsUsed: false,
        networkUsed: false,
        liveRunnerStarted: false,
      },
    });
    expect(manifest.capabilities).toEqual([
      expect.objectContaining({
        id: "media.analysis.local_dry_run",
        readOnly: false,
        requiresApproval: true,
        risk: "medium",
      }),
      expect.objectContaining({ id: "media.analyze_image", readOnly: true, risk: "low" }),
      expect.objectContaining({ id: "media.analyze_video", readOnly: true, risk: "low" }),
      expect.objectContaining({ id: "media.analyze_audio", readOnly: true, risk: "low" }),
      expect.objectContaining({ id: "artifact.metadata.inspect", readOnly: true, risk: "low" }),
    ]);
    expect(manifest.tools).toEqual([
      expect.objectContaining({
        name: "media_analysis.run",
        capabilityId: "media.analysis.local_dry_run",
        readOnly: false,
        requiresApproval: true,
      }),
      expect.objectContaining({
        name: "media_analysis.inspect_image",
        capabilityId: "media.analyze_image",
        readOnly: true,
      }),
      expect.objectContaining({
        name: "media_analysis.inspect_video",
        capabilityId: "media.analyze_video",
        readOnly: true,
      }),
      expect.objectContaining({
        name: "media_analysis.inspect_audio",
        capabilityId: "media.analyze_audio",
        readOnly: true,
      }),
    ]);
  });

  it("keeps auth and account requirements explicit for external provider manifests", () => {
    const manifest = createXTwitterExtensionManifest({
      health: {
        status: "needs-auth",
        checkedAt: "2026-05-08T00:00:00.000Z",
        message: "bearer token missing",
      },
    });

    expect(manifest).toMatchObject({
      id: "x-twitter",
      kind: "provider",
      providerId: "x-twitter",
      sourceTrust: { status: "user-configured" },
      providerAccounts: [
        {
          id: "bearer-token",
          authType: "secret-ref",
          required: true,
          scopes: ["x.search"],
        },
      ],
      secrets: [
        {
          id: "bearerToken",
          required: true,
          allowedSources: ["env", "exec", "file", "inline"],
        },
      ],
      health: {
        status: "needs-auth",
        message: "bearer token missing",
      },
    });
  });

  it("declares MemeFast as an API provider extension without starting live runners", () => {
    const manifest = createMemefastExtensionManifest({
      health: {
        status: "needs-auth",
        checkedAt: "2026-05-10T00:00:00.000Z",
        message: "MEMEFAST_API_KEY missing",
      },
    });

    expect(manifest).toMatchObject({
      id: "memefast.api",
      kind: "provider",
      displayName: "MemeFast API",
      providerId: "memefast-api",
      sourceTrust: { status: "user-configured" },
      providerAccounts: [
        {
          id: "api-key",
          authType: "secret-ref",
          required: true,
          scopes: ["model.chat", "media.generate_image", "media.generate_video"],
        },
      ],
      secrets: [
        {
          id: "apiKey",
          required: true,
          allowedSources: ["env", "exec", "file", "inline"],
        },
      ],
      sandboxPolicy: {
        defaultMode: "network-limited",
        networkPolicy: "limited",
        requiresCommandPattern: false,
      },
      health: {
        status: "needs-auth",
        checkFn: "memefast.auth",
      },
      metadata: {
        baseUrl: "https://memefast.top",
        liveRunnerStarted: false,
        providerCredentialsUsed: false,
        endpointFamilies: expect.arrayContaining([
          "openai_chat",
          "openai_images",
          "openai_official",
          "volc",
          "wan",
          "kling",
          "happyhorse",
          "unified",
        ]),
      },
    });
    expect(manifest.capabilities).toEqual([
      expect.objectContaining({ id: "model.chat", readOnly: false, requiresApproval: true }),
      expect.objectContaining({ id: "model.vision", readOnly: false, requiresApproval: true }),
      expect.objectContaining({
        id: "media.generate_image",
        readOnly: false,
        requiresApproval: true,
      }),
      expect.objectContaining({
        id: "media.generate_video",
        readOnly: false,
        requiresApproval: true,
      }),
      expect.objectContaining({ id: "provider.memefast", readOnly: true }),
    ]);
  });

  it("normalizes duplicate extension ids and capabilities deterministically", () => {
    const mcp = createMcpExtensionManifest({
      id: "mcp.local",
      displayName: "MCP Local",
      serverCount: 2,
      toolCount: 7,
      health: { status: "ready" },
    });
    const matrix = createAgentOsExtensionMatrix([mcp, mcp]);

    expect(matrix.summary.total).toBe(1);
    expect(matrix.entries).toHaveLength(1);
    expect(matrix.entries[0]).toMatchObject({
      id: "mcp.local",
      capabilityIds: ["mcp.tool", "mcp.oauth", "mcp.resource"],
      providerAccounts: [
        expect.objectContaining({ id: "mcp-oauth", authType: "oauth", required: false }),
      ],
      installPolicy: {
        supported: true,
        defaultMode: "manual",
        requiresExplicitExecute: true,
      },
      metadata: {
        serverCount: 2,
        toolCount: 7,
      },
    });
  });
});
