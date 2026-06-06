import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { AppendOnlyFileLearningObservationSink, NoopMemoryRecallPort } from "../src/observation.ts";
import { DIRECTOR_OBSERVATION_SCHEMA_ID } from "../src/types.ts";

describe("director-runtime observation", () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    for (const root of tempRoots.splice(0, tempRoots.length)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns a disabled recall result from the noop recall port", async () => {
    const port = new NoopMemoryRecallPort();
    const result = await port.recall({
      workingContext: {
        snapshotId: "snapshot-1",
        runtimeId: "runtime-1",
        operatorId: "operator-1",
        anchorIds: [],
      },
      recallHints: {
        preferredBindings: [],
        requiredBindings: [],
        fallbackBindings: [],
        continuityAnchorIds: [],
        knowledgeSignalTags: [],
        deliverables: [],
      },
    });

    expect(result.status).toBe("disabled");
    expect(result.knowledgePacks).toEqual([]);
    expect(result.hits).toEqual([]);
    expect(result.notes[0]).toContain("disabled");
  });

  it("appends observation envelopes as newline-delimited records", async () => {
    const root = mkdtempSync(join(tmpdir(), "director-observation-"));
    const path = join(root, "runtime", "observations.ndjson");
    tempRoots.push(root);
    const sink = new AppendOnlyFileLearningObservationSink({ path });

    await sink.append({
      schemaId: DIRECTOR_OBSERVATION_SCHEMA_ID,
      observationId: "observation-1",
      recordedAt: "2026-04-12T02:00:00.000Z",
      source: "evaluation",
      snapshotId: "snapshot-1",
      runtimeId: "runtime-1",
      recalledKnowledgePacks: [],
      recallStatus: "disabled",
      recallNotes: ["noop"],
      evaluation: {
        decision: "pass",
        actionGraphReadiness: "ready",
        selectedAdapters: ["mock-video"],
        blockedReasons: [],
        warnings: [],
      },
    });
    await sink.append({
      schemaId: DIRECTOR_OBSERVATION_SCHEMA_ID,
      observationId: "observation-2",
      recordedAt: "2026-04-12T02:01:00.000Z",
      source: "outcome",
      snapshotId: "snapshot-1",
      runtimeId: "runtime-1",
      recalledKnowledgePacks: [],
      recallStatus: "disabled",
      recallNotes: ["noop"],
      notes: ["operator accepted preview"],
    });

    const lines = readFileSync(path, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { observationId: string; source: string })
      .map((entry) => ({
        observationId: entry.observationId,
        source: entry.source,
      }));

    expect(lines).toEqual([
      { observationId: "observation-1", source: "evaluation" },
      { observationId: "observation-2", source: "outcome" },
    ]);
  });
});
