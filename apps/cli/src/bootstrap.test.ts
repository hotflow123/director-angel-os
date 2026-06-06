import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { InMemoryModelProviderRegistry } from "@hotflow/models";
import type { SessionStore } from "@hotflow/sessions";
import { SkillPromptIndex, createSkillProposalQueueInput } from "@hotflow/skills";
import { describe, expect, test } from "vitest";

import {
  bootstrapCli,
  recordCliAuditEvent,
  registerCliProviders,
  resolveCliSessionDbPath,
} from "./bootstrap.js";

describe("registerCliProviders", () => {
  test("resolves CLI session db path from explicit env override", () => {
    expect(
      resolveCliSessionDbPath(
        {
          dataDir: "/workspace/.hotflow",
          sessionDbPath: "/workspace/.hotflow/sessions/sessions.sqlite",
        },
        {
          HOTFLOW_CLI_SESSION_DB_PATH: "/tmp/hotflow-cli.sqlite",
        },
      ),
    ).toBe("/tmp/hotflow-cli.sqlite");
  });

  test("always registers scripted provider", () => {
    const registry = new InMemoryModelProviderRegistry();
    const providerIds = registerCliProviders(registry, { env: {} });

    expect(providerIds).toContain("scripted");
    expect(registry.get("scripted")).toBeDefined();
  });

  test("registers openai-compatible provider when env is configured", () => {
    const registry = new InMemoryModelProviderRegistry();
    const providerIds = registerCliProviders(registry, {
      env: {
        HOTFLOW_OPENAI_BASE_URL: "https://example.invalid/v1",
        HOTFLOW_OPENAI_PROVIDER_ID: "openai-live",
      },
      fetchImpl: async () => new Response("{}", { status: 200 }),
    });

    expect(providerIds).toContain("scripted");
    expect(providerIds).toContain("openai-live");
    expect(registry.get("openai-live")).toBeDefined();
  });
});

describe("bootstrapCli", () => {
  test("uses explicit env session db override during runtime bootstrap", () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "hotflow-cli-bootstrap-"));
    const dataDir = join(workspaceRoot, ".hotflow");
    mkdirSync(join(dataDir, "sessions"), { recursive: true });
    const overrideDbPath = join(dataDir, "sessions", "override.sqlite");

    const runtime = bootstrapCli({
      env: {
        HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
        HOTFLOW_DATA_DIR: dataDir,
        HOTFLOW_CLI_SESSION_DB_PATH: overrideDbPath,
      },
    });

    try {
      runtime.sessionStore.createSession({ sessionId: "sess_bootstrap_override" });
      runtime.sessionStore.close();
      expect(existsSync(overrideDbPath)).toBe(true);
    } finally {
      try {
        runtime.sessionStore.close();
      } catch {
        // Ignore double-close for cleanup in tests.
      }
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  test("applied skill proposals become visible only after the next bootstrap", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "hotflow-cli-skill-reload-"));
    const dataDir = join(workspaceRoot, ".hotflow");
    mkdirSync(join(dataDir, "sessions"), { recursive: true });
    const sessionDbPath = join(dataDir, "sessions", "skills.sqlite");
    const env = {
      HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
      HOTFLOW_DATA_DIR: dataDir,
      HOTFLOW_CLI_SESSION_DB_PATH: sessionDbPath,
    };

    const runtime = bootstrapCli({ env });
    try {
      expect(runtime.skillRepository.listApproved()).toHaveLength(0);

      const enqueueResult = await runtime.controlPlane.dispatch({
        type: "proposal-enqueue",
        sessionId: "sess_skill_reload",
        proposal: createSkillProposalQueueInput({
          id: "proposal_skill_reload",
          snapshot: {
            id: "skill.readme.summary",
            version: "1.0.0",
            title: "README Summary",
            content: "Read the README, then summarize the repository briefly.",
            tags: ["readme", "summary"],
            toolNames: ["filesystem.read_text"],
            updatedAtMs: 100,
          },
          sourceSessionId: "sess_skill_reload",
          sourceTurnId: "turn_skill_reload",
          trajectoryRef: "journal://sess_skill_reload/turn_skill_reload",
          provenance: "bootstrap.test",
        }),
      });
      expect(enqueueResult.ok).toBe(true);

      const acceptResult = await runtime.controlPlane.dispatch({
        type: "proposal-transition",
        sessionId: "sess_skill_reload",
        proposalId: "proposal_skill_reload",
        status: "accepted",
      });
      expect(acceptResult.ok).toBe(true);

      const applyResult = await runtime.controlPlane.dispatch({
        type: "proposal-apply",
        sessionId: "sess_skill_reload",
        proposalId: "proposal_skill_reload",
      });
      expect(applyResult.ok).toBe(true);
      expect(runtime.skillRepository.listApproved()).toHaveLength(0);
      expect(runtime.approvedSkillRepository.listApproved()).toHaveLength(1);
    } finally {
      runtime.sessionStore.close();
    }

    const reloadedRuntime = bootstrapCli({ env });
    try {
      expect(reloadedRuntime.skillRepository.listApproved()).toHaveLength(1);
      const sections = new SkillPromptIndex(reloadedRuntime.skillRepository).buildSections({
        userText: "Read the README and summarize the repository.",
        limit: 1,
      });
      expect(sections).toHaveLength(1);
      expect(sections[0]?.content).toContain("README Summary");
    } finally {
      reloadedRuntime.sessionStore.close();
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });
});

describe("recordCliAuditEvent", () => {
  test("appends audit event envelope to session store", () => {
    const calls: unknown[] = [];
    const sessionStore = {
      appendAuditEvent(sessionId: string, input: unknown) {
        calls.push({ sessionId, input });
        return {
          rowId: 1,
          sessionId,
          seq: 1,
          eventType: "audit.event",
          turnId: null,
          payload: {},
          schemaVersion: "0.1.0",
          createdAtMs: 42,
        };
      },
    } as Pick<SessionStore, "appendAuditEvent">;

    recordCliAuditEvent(
      sessionStore,
      {
        sessionId: "session_1",
        kind: "cli.run.completed",
        payload: { providerId: "scripted" },
      },
      {
        now: () => 42,
        eventIdFactory: () => "audit_1",
      },
    );

    expect(calls).toEqual([
      {
        sessionId: "session_1",
        input: {
          event: {
            id: "audit_1",
            kind: "cli.run.completed",
            schemaVersion: "cli.audit.v1",
            occurredAtMs: 42,
            payload: { providerId: "scripted" },
          },
          createdAtMs: 42,
        },
      },
    ]);
  });

  test("swallows persistence errors", () => {
    const sessionStore = {
      appendAuditEvent() {
        throw new Error("boom");
      },
    } as Pick<SessionStore, "appendAuditEvent">;

    expect(() =>
      recordCliAuditEvent(
        sessionStore,
        {
          sessionId: "session_1",
          kind: "cli.run.completed",
        },
        {
          now: () => 42,
        },
      ),
    ).not.toThrow();
  });
});
