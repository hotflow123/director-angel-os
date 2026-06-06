import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runDirectorDailySelfReflection } from "../src/self-reflection.ts";

describe("director daily self-reflection", () => {
  it("summarizes daily runs without mutating learning or soul state", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "director-daily-self-reflection-"));
    try {
      const runRoot = join(
        workspaceRoot,
        ".director-angel",
        "runtime",
        "execution",
        "runs",
        "run-1",
      );
      mkdirSync(runRoot, { recursive: true });
      writeFileSync(
        join(runRoot, "report.json"),
        JSON.stringify(
          {
            schemaVersion: "director.execution.run.v1",
            reportId: "report-run-1",
            runId: "run-1",
            recordedAt: "2026-05-03T05:00:00.000Z",
            summary: ["run status=failed", "Knowledge recall miss", "Skill miss"],
            flags: ["failed", "external-bridge-failed"],
            run: {
              schemaVersion: "director.execution.run.v1",
              runId: "run-1",
              goal: "生成一个15秒短剧分镜蓝图",
              status: "failed",
              sideEffectsAllowed: false,
              createdAt: "2026-05-03T04:00:00.000Z",
              updatedAt: "2026-05-03T05:00:00.000Z",
              assignments: [],
            },
            events: [],
          },
          null,
          2,
        ),
        "utf8",
      );
      const sessionRoot = join(workspaceRoot, ".director-angel", "runtime", "entry", "sessions");
      mkdirSync(sessionRoot, { recursive: true });
      writeFileSync(
        join(sessionRoot, "entry-session-1.json"),
        JSON.stringify(
          {
            schemaVersion: "director.entry.session.v1",
            entrySessionId: "entry-session-1",
            channel: "desktop",
            turns: [
              {
                receivedAt: "2026-05-03T05:10:00.000Z",
                summary: "用户反馈：这次不是我要的，应该更像结果而不是流程。",
              },
            ],
          },
          null,
          2,
        ),
        "utf8",
      );

      const result = await runDirectorDailySelfReflection(workspaceRoot, {
        now: "2026-05-03T06:00:00.000Z",
      });

      expect(result.report).toMatchObject({
        schemaVersion: "director.self-reflection.daily-report.v1",
        status: "blocked",
        runs: {
          total: 1,
          failed: 1,
          reflectionDue: 1,
          skillMiss: 1,
          knowledgeMiss: 1,
        },
        reviewRequired: true,
      });
      expect(result.report.feedbackSignals).toHaveLength(1);
      expect(result.report.guardrails.join("\n")).toContain("不自动发布知识");
      expect(result.report.proposals).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "ui-copy-improvement",
            reviewRequired: true,
            evidenceRefs: expect.arrayContaining([expect.stringContaining("feedback://desktop")]),
          }),
          expect.objectContaining({
            kind: "experience-candidate",
            reviewRequired: true,
            actionRefs: expect.arrayContaining([expect.stringContaining("/复盘")]),
          }),
          expect.objectContaining({
            kind: "test-smoke-improvement",
            reviewRequired: true,
          }),
        ]),
      );
      expect(result.report.proposals.every((proposal) => proposal.reviewRequired)).toBe(true);
      expect(result.text).toContain("Director daily self-reflection:");
      expect(result.text).toContain("review proposals:");
      expect(result.reportPath).toContain(
        ".director-angel/knowledge/reflection/daily/2026-05-03.json",
      );
      expect(result.markdownPath).toContain(
        ".director-angel/knowledge/reflection/daily/2026-05-03.md",
      );
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });
});
