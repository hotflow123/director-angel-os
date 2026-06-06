import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import * as directorKnowledge from "../../cli/src/director-knowledge.ts";
import { DESKTOP_ACTIONS } from "./desktop-contract.js";
import { createDirectorDesktopNativeBridge } from "./desktop-native-bridge.js";
import { installDirectorAngelPreloadBridge } from "./desktop-preload-bridge.js";

describe("director desktop native bridge", () => {
  const tempRoots = [];

  afterEach(() => {
    for (const root of tempRoots.splice(0, tempRoots.length)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("creates the bridge object that preload can expose to the renderer", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-desktop-native-"));
    tempRoots.push(workspaceRoot);
    const lessonDir = join(workspaceRoot, "fixtures", "learning-source");
    mkdirSync(lessonDir, { recursive: true });
    writeFileSync(
      join(lessonDir, "lesson.md"),
      "Keep learned guidance review-gated before runtime recall.",
    );
    writeFeatureSwitchFixture(workspaceRoot, {
      "learning.enabled": true,
    });

    const bridge = createDirectorDesktopNativeBridge({
      workspaceRoot,
      knowledge: directorKnowledge,
      desktop: {
        pickDirectory: async () => ({ selectedDirectory: lessonDir, events: [] }),
      },
    });
    const picked = await bridge.invoke({ type: DESKTOP_ACTIONS.DESKTOP_PICK_DIRECTORY });
    const learned = await bridge.invoke({
      type: DESKTOP_ACTIONS.EXPERIENCE_LEARN_DIRECTORY,
      directory: lessonDir,
    });

    expect(picked.selectedDirectory).toBe(lessonDir);
    expect(learned.snapshot.candidate.count).toBe(1);
    expect(learned.snapshot.candidate.status).toBe("pending");
  });

  it("installs only the invoke surface into a preload context", async () => {
    const calls = [];
    const contextBridge = {
      exposeInMainWorld(name, value) {
        calls.push({ name, value });
      },
    };
    const bridge = {
      async invoke(action) {
        return { actionType: action.type };
      },
    };

    installDirectorAngelPreloadBridge({ contextBridge, bridge });

    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe("directorAngel");
    expect(Object.keys(calls[0].value)).toEqual(["invoke", "liveAudio", "uiState"]);
    expect(Object.keys(calls[0].value.liveAudio)).toEqual(["start", "stop", "cancel", "status"]);
    expect(Object.keys(calls[0].value.uiState)).toEqual(["read", "write"]);
    await expect(calls[0].value.invoke({ type: DESKTOP_ACTIONS.SNAPSHOT })).resolves.toEqual({
      actionType: DESKTOP_ACTIONS.SNAPSHOT,
    });
    await expect(calls[0].value.liveAudio.start({ turnId: "turn-voice" })).resolves.toEqual({
      actionType: DESKTOP_ACTIONS.LIVE_AUDIO_START,
    });
  });
});

function writeFeatureSwitchFixture(workspaceRoot, features) {
  const runtimeRoot = join(workspaceRoot, ".director-angel", "runtime");
  mkdirSync(runtimeRoot, { recursive: true });
  writeFileSync(
    join(runtimeRoot, "switches.json"),
    JSON.stringify({
      schemaId: "director.switches.v1",
      features,
    }),
    "utf8",
  );
}
