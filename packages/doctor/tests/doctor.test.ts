import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { HotflowConfig } from "@hotflow/config";
import { afterEach, describe, expect, it, vi } from "vitest";

import { defaultRegisterDoctorProviders, runDoctor } from "../src/index.js";

const scratchDirs: string[] = [];

function createScratchDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "hotflow-doctor-"));
  scratchDirs.push(dir);
  return dir;
}

function createConfig(dir: string, defaultProvider = "scripted"): HotflowConfig {
  return {
    profile: "test",
    workspaceRoot: dir,
    dataDir: join(dir, ".hotflow"),
    sessionDbPath: join(dir, ".hotflow", "sessions", "sessions.sqlite"),
    defaultProvider,
    defaultModel: "hotflow-phase1",
    permissionMode: "ask",
    outputStyle: "normal",
  };
}

function getCheck(report: Awaited<ReturnType<typeof runDoctor>>, id: string) {
  const check = report.checks.find((entry) => entry.id === id);
  expect(check).toBeDefined();
  if (!check) {
    throw new Error(`missing check ${id}`);
  }
  return check;
}

afterEach(() => {
  while (scratchDirs.length > 0) {
    const dir = scratchDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("defaultRegisterDoctorProviders", () => {
  it("includes scripted and env-configured openai-compatible providers", () => {
    const dir = createScratchDir();
    const providers = defaultRegisterDoctorProviders({
      config: createConfig(dir),
      env: {
        HOTFLOW_OPENAI_BASE_URL: "https://example.invalid/v1",
        HOTFLOW_OPENAI_PROVIDER_ID: "openai-live",
      },
    });

    expect(providers.providerIds).toEqual(["scripted", "openai-live"]);
    expect(providers.providers).toContainEqual({
      id: "openai-live",
      source: "env",
      available: true,
      details: {
        baseUrl: "https://example.invalid/v1",
        hasApiKey: false,
      },
    });
  });
});

describe("runDoctor", () => {
  it("returns a passing structured report for the minimal happy path", async () => {
    const dir = createScratchDir();
    const overrideDbPath = join(dir, "override", "doctor.sqlite");

    const report = await runDoctor({
      sessionDbPathOverride: overrideDbPath,
      loadConfig: () => createConfig(dir),
      now: vi.fn(() => 100),
    });

    expect(report.ok).toBe(true);
    expect(report.status).toBe("pass");
    expect(report.checks.map((check) => check.id)).toEqual([
      "config.load",
      "session.db_path",
      "provider.registry",
      "provider.default",
      "session.store",
      "control_plane.bootstrap",
    ]);
    expect(getCheck(report, "session.db_path").details).toEqual({
      sessionDbPath: overrideDbPath,
    });
    expect(getCheck(report, "control_plane.bootstrap").details).toEqual({
      implementation: "default-core",
    });
  });

  it("fails when the configured default provider is unavailable", async () => {
    const dir = createScratchDir();

    const report = await runDoctor({
      loadConfig: () => createConfig(dir, "openai-compatible"),
    });

    expect(report.ok).toBe(false);
    expect(report.status).toBe("fail");
    expect(getCheck(report, "provider.default").status).toBe("fail");
    expect(getCheck(report, "provider.default").summary).toContain(
      "HOTFLOW_OPENAI_BASE_URL is not set.",
    );
  });

  it("fails the session store check when openSessionStore throws", async () => {
    const dir = createScratchDir();

    const report = await runDoctor({
      loadConfig: () => createConfig(dir),
      openSessionStore: () => {
        throw new Error("db unavailable");
      },
    });

    expect(report.ok).toBe(false);
    expect(getCheck(report, "session.store").error).toEqual({
      code: "SESSION_STORE_OPEN_FAILED",
      message: "db unavailable",
    });
    expect(getCheck(report, "control_plane.bootstrap").error).toEqual({
      code: "DEPENDENCY_UNAVAILABLE",
      message: "Dependency check failed: session.store",
    });
  });

  it("includes a passing mempalace check when a probe is injected", async () => {
    const dir = createScratchDir();

    const report = await runDoctor({
      loadConfig: () => createConfig(dir),
      probeMempalace: () => ({
        status: "pass",
        summary: "Mempalace adapter disabled by configuration.",
        mode: "disabled",
        configured: false,
        reachable: false,
        details: {
          mode: "disabled",
        },
      }),
    });

    expect(report.ok).toBe(true);
    expect(getCheck(report, "memory.mempalace")).toMatchObject({
      status: "pass",
      summary: "Mempalace adapter disabled by configuration.",
      details: {
        mode: "disabled",
        configured: false,
        reachable: false,
      },
    });
  });

  it("downgrades the overall report to warn when the mempalace probe warns", async () => {
    const dir = createScratchDir();

    const report = await runDoctor({
      loadConfig: () => createConfig(dir),
      probeMempalace: () => ({
        status: "warn",
        summary: "Mempalace adapter is optional but not fully configured.",
        mode: "optional",
        configured: false,
        reachable: false,
      }),
    });

    expect(report.ok).toBe(true);
    expect(report.status).toBe("warn");
    expect(getCheck(report, "memory.mempalace").status).toBe("warn");
  });

  it("accepts mempalace primary mode in the injected health probe", async () => {
    const dir = createScratchDir();

    const report = await runDoctor({
      loadConfig: () => createConfig(dir),
      probeMempalace: () => ({
        status: "pass",
        summary: "Mempalace adapter is the primary memory backend.",
        mode: "primary",
        configured: true,
        reachable: true,
        details: {
          mode: "primary",
        },
      }),
    });

    expect(report.ok).toBe(true);
    expect(getCheck(report, "memory.mempalace")).toMatchObject({
      status: "pass",
      details: {
        mode: "primary",
        configured: true,
        reachable: true,
      },
    });
  });

  it("fails the control-plane check when a custom bootstrap throws", async () => {
    const dir = createScratchDir();

    const report = await runDoctor({
      loadConfig: () => createConfig(dir),
      bootstrapControlPlane: () => {
        throw new Error("control-plane wiring failed");
      },
    });

    expect(report.ok).toBe(false);
    expect(getCheck(report, "control_plane.bootstrap").error).toEqual({
      code: "CONTROL_PLANE_BOOTSTRAP_FAILED",
      message: "control-plane wiring failed",
    });
  });

  it("includes learning lane checks when a probe summary is injected", async () => {
    const dir = createScratchDir();

    const report = await runDoctor({
      loadConfig: () => createConfig(dir),
      probeLearningLane: () => ({
        proposalStore: {
          status: "pass",
          summary: "Proposal queue is readable from the session-backed task plane.",
          details: {
            total: 2,
            pending: 1,
            accepted: 1,
            rejected: 0,
            applied: 0,
            expired: 0,
          },
        },
        approvedSnapshot: {
          status: "pass",
          summary: "Approved skill snapshot is readable.",
          details: {
            approvedSkillCount: 0,
            snapshotPath: join(dir, ".hotflow", "approved-skills.json"),
          },
        },
        reloadVisibility: {
          status: "pass",
          summary: "Skill visibility remains reload-only.",
          details: {
            mode: "reload-only",
            hotReloadSupported: false,
          },
        },
      }),
    });

    expect(report.ok).toBe(true);
    expect(getCheck(report, "learning.proposal_store")).toMatchObject({
      status: "pass",
      details: {
        total: 2,
        pending: 1,
      },
    });
    expect(getCheck(report, "learning.approved_snapshot")).toMatchObject({
      status: "pass",
      details: {
        approvedSkillCount: 0,
      },
    });
    expect(getCheck(report, "learning.reload_visibility")).toMatchObject({
      status: "pass",
      details: {
        mode: "reload-only",
        hotReloadSupported: false,
      },
    });
  });

  it("includes director memory lane checks when a probe summary is injected", async () => {
    const dir = createScratchDir();

    const report = await runDoctor({
      loadConfig: () => createConfig(dir),
      probeDirectorMemoryLane: () => ({
        switchState: {
          status: "pass",
          summary: "Director memory is enabled by switch.",
          details: {
            enabled: true,
          },
        },
        storeReadable: {
          status: "pass",
          summary: "Director memory store is readable.",
          details: {
            recordCount: 1,
          },
        },
        recallPreview: {
          status: "pass",
          summary: "Director memory recall preview returned a hit.",
          details: {
            status: "ok",
            hitCount: 1,
          },
        },
        ingestClosure: {
          status: "pass",
          summary: "Terminal run -> memory ingest closure is healthy.",
          details: {
            latestIngestStatus: "ok",
            recordId: "record-1",
          },
        },
      }),
    });

    expect(report.ok).toBe(true);
    expect(getCheck(report, "director.memory.switch")).toMatchObject({
      status: "pass",
      details: {
        enabled: true,
      },
    });
    expect(getCheck(report, "director.memory.store")).toMatchObject({
      status: "pass",
      details: {
        recordCount: 1,
      },
    });
    expect(getCheck(report, "director.memory.recall")).toMatchObject({
      status: "pass",
      details: {
        status: "ok",
        hitCount: 1,
      },
    });
    expect(getCheck(report, "director.memory.ingest")).toMatchObject({
      status: "pass",
      details: {
        latestIngestStatus: "ok",
        recordId: "record-1",
      },
    });
  });

  it("includes director knowledge lane checks when a probe summary is injected", async () => {
    const dir = createScratchDir();

    const report = await runDoctor({
      loadConfig: () => createConfig(dir),
      probeDirectorKnowledgeLane: () => ({
        switchState: {
          status: "pass",
          summary: "Director knowledge recall is enabled by switch.",
          details: {
            enabled: true,
            maxHits: 3,
            maxChars: 900,
          },
        },
        storeReadable: {
          status: "pass",
          summary: "Published Director knowledge lane is readable.",
          details: {
            publishedCount: 1,
            candidateReady: false,
          },
        },
        recallPreview: {
          status: "pass",
          summary: "Director knowledge recall preview returned a hit.",
          details: {
            status: "hit",
            hitCount: 1,
            knowledgePackId: "pack-1",
          },
        },
      }),
    });

    expect(report.ok).toBe(true);
    expect(getCheck(report, "director.knowledge.switch")).toMatchObject({
      status: "pass",
      details: {
        enabled: true,
        maxHits: 3,
      },
    });
    expect(getCheck(report, "director.knowledge.store")).toMatchObject({
      status: "pass",
      details: {
        publishedCount: 1,
      },
    });
    expect(getCheck(report, "director.knowledge.recall")).toMatchObject({
      status: "pass",
      details: {
        status: "hit",
        hitCount: 1,
        knowledgePackId: "pack-1",
      },
    });
  });

  it("marks provider-dependent checks as dependency failures when registry resolution fails", async () => {
    const dir = createScratchDir();

    const report = await runDoctor({
      loadConfig: () => createConfig(dir),
      registerProviders: () => {
        throw new Error("provider registry unavailable");
      },
    });

    expect(report.ok).toBe(false);
    expect(getCheck(report, "provider.registry").error).toEqual({
      code: "PROVIDER_REGISTRY_FAILED",
      message: "provider registry unavailable",
    });
    expect(getCheck(report, "provider.default").error).toEqual({
      code: "DEPENDENCY_UNAVAILABLE",
      message: "Dependency check failed: provider.registry",
    });
    expect(getCheck(report, "control_plane.bootstrap").error).toEqual({
      code: "DEPENDENCY_UNAVAILABLE",
      message: "Dependency check failed: provider.registry",
    });
  });

  it("marks downstream checks as dependency failures when config load fails", async () => {
    const report = await runDoctor({
      loadConfig: () => {
        throw new Error("bad config");
      },
    });

    expect(report.ok).toBe(false);
    expect(getCheck(report, "config.load").error).toEqual({
      code: "CONFIG_LOAD_FAILED",
      message: "bad config",
    });
    expect(getCheck(report, "session.db_path").error).toEqual({
      code: "DEPENDENCY_UNAVAILABLE",
      message: "Dependency check failed: config.load",
    });
    expect(getCheck(report, "control_plane.bootstrap").status).toBe("fail");
  });
});
