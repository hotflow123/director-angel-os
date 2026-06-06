import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { SkillUsageStore, resolveSkillUsagePath } from "../src/index.js";

const tempDirs: string[] = [];

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "hotflow-skill-usage-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("SkillUsageStore", () => {
  test("tracks view, use, and patch counters in a sidecar document", async () => {
    const dataDir = await createTempDir();
    const nowValues = [1000, 2000, 3000, 4000];
    const store = new SkillUsageStore(resolveSkillUsagePath({ dataDir }), {
      now: () => nowValues.shift() ?? 5000,
    });

    const viewed = store.recordView("comfyui", { actor: "desktop", reason: "model read" });
    const used = store.recordUse("comfyui", { actor: "runtime", reason: "prompt section" });
    const failed = store.recordFailure("comfyui", {
      actor: "runtime",
      reason: "tool unavailable during skill execution",
    });
    const patched = store.recordPatch("comfyui", { actor: "desktop", reason: "operator edit" });

    expect(viewed.viewCount).toBe(1);
    expect(used.useCount).toBe(1);
    expect(failed.failureCount).toBe(1);
    expect(failed.lastFailedAtMs).toBe(3000);
    expect(patched.patchCount).toBe(1);
    expect(patched.lastActivityAtMs).toBe(4000);
    expect(patched.events.map((event) => event.action)).toEqual([
      "view",
      "use",
      "failure",
      "patch",
    ]);

    const persisted = JSON.parse(readFileSync(resolveSkillUsagePath({ dataDir }), "utf8"));
    expect(persisted.records.comfyui.viewCount).toBe(1);
    expect(persisted.records.comfyui.useCount).toBe(1);
    expect(persisted.records.comfyui.failureCount).toBe(1);
    expect(persisted.records.comfyui.patchCount).toBe(1);
  });

  test("degrades corrupt usage files to an empty document", async () => {
    const dataDir = await createTempDir();
    const usagePath = resolveSkillUsagePath({ dataDir });
    mkdirSync(dirname(usagePath), { recursive: true });
    writeFileSync(usagePath, "{ not json", "utf8");

    const store = new SkillUsageStore(usagePath);

    expect(store.readDocument().records).toEqual({});
  });

  test("forgets deleted skills without failing when the record is missing", async () => {
    const dataDir = await createTempDir();
    const store = new SkillUsageStore(resolveSkillUsagePath({ dataDir }), {
      now: () => 1,
    });

    store.recordUse("storyboard");
    store.forget("storyboard", { actor: "desktop", nowMs: 2 });
    store.forget("missing", { actor: "desktop", nowMs: 3 });

    expect(store.readRecord("storyboard")).toBeNull();
    expect(existsSync(resolveSkillUsagePath({ dataDir }))).toBe(true);
  });

  test("records curator patch acknowledgement and archive lifecycle state", async () => {
    const dataDir = await createTempDir();
    const store = new SkillUsageStore(resolveSkillUsagePath({ dataDir }), {
      now: () => 1,
    });

    store.recordUse("storyboard", { nowMs: 10 });
    store.recordFailure("storyboard", { nowMs: 20, reason: "bad downstream output" });
    const patched = store.resetFailures("storyboard", {
      actor: "operator",
      nowMs: 30,
      reason: "manual patch applied",
    });
    const archived = store.archive("storyboard", {
      actor: "operator",
      nowMs: 40,
      reason: "stale after review",
    });

    expect(patched.failureCount).toBe(0);
    expect(patched.lastFailedAtMs).toBeNull();
    expect(patched.patchCount).toBe(1);
    expect(patched.events.map((event) => event.action)).toEqual(["use", "failure", "patch"]);
    expect(archived.state).toBe("archived");
    expect(archived.archivedAtMs).toBe(40);
    expect(archived.events.map((event) => event.action)).toEqual([
      "use",
      "failure",
      "patch",
      "archive",
    ]);
  });
});
