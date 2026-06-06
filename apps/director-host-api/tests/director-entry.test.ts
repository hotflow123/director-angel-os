import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { FileSystemDirectorEntryStore } from "../src/director-entry.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("FileSystemDirectorEntryStore", () => {
  it("preserves index entries when independent sessions are recorded concurrently", async () => {
    const root = mkdtempSync(join(tmpdir(), "director-entry-store-"));
    roots.push(root);
    const store = new FileSystemDirectorEntryStore({
      rootPath: root,
      now: () => "2026-04-30T03:40:00.000Z",
    });

    await Promise.all([
      store.recordIntake(createIntakeRequest("message-a", "peer-a"), createIntakeResponse("a")),
      store.recordIntake(createIntakeRequest("message-b", "peer-b"), createIntakeResponse("b")),
    ]);

    const index = JSON.parse(readFileSync(join(root, "index.json"), "utf8")) as {
      entries: Array<{ sessionKey: string }>;
    };
    expect(index.entries.map((entry) => entry.sessionKey).sort()).toEqual([
      "agent:director:direct:peer-a",
      "agent:director:direct:peer-b",
    ]);
  });
});

function createIntakeRequest(messageId: string, peerId: string) {
  const sessionKey = `agent:director:direct:${peerId}`;
  return {
    apiVersion: "director-entry.v1",
    entry: {
      hostId: "director-cli",
      channel: "cli",
      routeKind: "direct",
      sessionKey,
      messageId,
      receivedAt: "2026-04-30T03:40:00.000Z",
    },
    snapshot: {
      apiVersion: "director-host-api.v1",
      schemaId: "director.host.snapshot.v1",
      snapshotId: `snapshot-${messageId}`,
      createdAt: "2026-04-30T03:40:00.000Z",
      host: {
        hostId: "director-cli",
        triggerSource: "api",
        sessionId: sessionKey,
      },
      project: {
        projectId: `project-${peerId}`,
        title: "CLI smoke",
        outline: "生成一个15秒短剧分镜蓝图",
      },
      group: {
        groupId: `group-${peerId}`,
        generationType: "new",
        sceneCount: 1,
        anchorIds: [],
      },
      runtime: {
        runtimeId: "director-host-api",
        status: "ready",
        availableBindings: ["scripted"],
        maxPromptChars: 4096,
        supportsVideo: true,
      },
      intent: {
        bindingPolicy: "auto",
      },
    },
    intake: {
      intakeId: `intake-${messageId}`,
      submittedAt: "2026-04-30T03:40:00.000Z",
      objective: "生成一个15秒短剧分镜蓝图",
      desiredOutcome: "生成一个15秒短剧分镜蓝图",
      metadata: {
        hostId: "director-cli",
        channel: "cli",
        routeKind: "direct",
        messageId,
        sessionKey,
      },
    },
  } as const;
}

function createIntakeResponse(suffix: string) {
  return {
    apiVersion: "director-host-api.v1",
    snapshotId: `snapshot-${suffix}`,
    runtimeId: "director-host-api",
    intakeId: `intake-${suffix}`,
    capabilitySnapshot: {
      snapshotId: `capability-${suffix}`,
      runtimeId: "director-host-api",
      capturedAt: "2026-04-30T03:40:00.000Z",
      status: "ready",
      adapters: [],
      notes: [],
    },
    clarification: {
      decision: "ready",
      summary: "Ready.",
      missingFields: [],
      conflictingFields: [],
      questions: [],
    },
    alignmentState: "locked",
    alignmentLock: {
      lockId: `alignment-lock-${suffix}`,
      sourceIntakeId: `intake-${suffix}`,
      state: "locked",
      lockedAt: "2026-04-30T03:40:00.000Z",
      objective: "生成一个15秒短剧分镜蓝图",
      desiredOutcome: "生成一个15秒短剧分镜蓝图",
      deliverables: ["生成一个15秒短剧分镜蓝图"],
      lockedConstraints: [],
      lockedFields: [],
      notes: [],
    },
  } as const;
}
