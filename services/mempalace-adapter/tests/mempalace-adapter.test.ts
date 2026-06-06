import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import {
  type MempalaceCommandExecutor,
  evaluateMempalaceRecallBenchmark,
  evaluateMempalaceRecallBenchmarkFixture,
  evaluateMempalaceRecallBenchmarkThresholds,
  findMempalaceDrawerPointerInIndexSync,
  indexMempalaceDrawerPointersSync,
  loadMempalaceAdapterConfig,
  loadMempalaceDrawerPointerIndexSync,
  loadMempalaceRecallDatasetManifestFixture,
  planMempalaceLiveMemoryEvalSweep,
  probeMempalaceHealthSync,
  readMempalaceDrawerSourceSync,
  refreshMempalaceDrawerPointerIndexSync,
  scanMempalaceDrawerPointersSync,
  searchMempalaceRecallSync,
} from "../src/index.js";

const HEALTHY_STDOUT = JSON.stringify({
  ok: true,
  results: [
    {
      id: "drawer_seedance_01",
      content: "Architecture decision summary.",
      text: "We chose the Agent OS skeleton.",
      verbatim: "We chose the Agent OS skeleton.\n\nReason: reusable runtime contracts.",
      wing: "hotflow",
      room: "architecture",
      similarity: 0.92,
      matched_via: "drawer+closet",
      bm25_score: 0.73,
      distance: 0.18,
      effective_distance: 0.07,
      closet_boost: 0.11,
      drawer_index: 4,
      total_drawers: 12,
      memory_layer: "L2",
      source_file: "architecture.md",
      metadata: {
        source_file: "/repo/architecture.md",
      },
    },
  ],
});

function createRunCommand(output: {
  readonly status?: number | null;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly error?: Error;
}): MempalaceCommandExecutor {
  return () => ({
    status: output.status ?? 0,
    signal: null,
    stdout: output.stdout ?? "",
    stderr: output.stderr ?? "",
    timedOut: false,
    ...(output.error ? { error: output.error } : {}),
  });
}

describe("loadMempalaceAdapterConfig", () => {
  test("defaults to disabled mode", () => {
    expect(loadMempalaceAdapterConfig({}).mode).toBe("disabled");
  });

  test("accepts HOTFLOW_MEMPALACE_PATH as an alias", () => {
    const config = loadMempalaceAdapterConfig({
      env: {
        HOTFLOW_MEMPALACE_MODE: "optional",
        HOTFLOW_MEMPALACE_COMMAND: "node",
        HOTFLOW_MEMPALACE_PATH: "/tmp/palace",
      },
    });

    expect(config.configured).toBe(true);
    expect(config.palacePath).toBe("/tmp/palace");
  });

  test("accepts primary mode as a configured long-term memory backend", () => {
    const config = loadMempalaceAdapterConfig({
      env: {
        HOTFLOW_MEMPALACE_MODE: "primary",
        HOTFLOW_MEMPALACE_COMMAND: "node",
        HOTFLOW_MEMPALACE_PALACE_PATH: "/repo/palace",
      },
    });

    expect(config.mode).toBe("primary");
    expect(config.configured).toBe(true);
    expect(config.issues).toEqual([]);
  });

  test("reports missing primary backend configuration explicitly", () => {
    const config = loadMempalaceAdapterConfig({
      env: {
        HOTFLOW_MEMPALACE_MODE: "primary",
      },
    });

    expect(config.mode).toBe("primary");
    expect(config.configured).toBe(false);
    expect(config.issues).toEqual([
      "Missing HOTFLOW_MEMPALACE_COMMAND in primary mode.",
      "Missing HOTFLOW_MEMPALACE_PALACE_PATH in primary mode.",
    ]);
  });
});

describe("probeMempalaceHealthSync", () => {
  test("returns pass when mode is disabled", () => {
    const result = probeMempalaceHealthSync();

    expect(result.status).toBe("pass");
    expect(result.mode).toBe("disabled");
    expect(result.configured).toBe(false);
    expect(result.reachable).toBe(false);
  });

  test("returns warn when optional mode lacks required config", () => {
    const result = probeMempalaceHealthSync({
      env: {
        HOTFLOW_MEMPALACE_MODE: "optional",
      },
    });

    expect(result.status).toBe("warn");
    expect(result.configured).toBe(false);
    expect(result.summary).toContain("optional");
    expect(result.details.issues).toEqual([
      "Missing HOTFLOW_MEMPALACE_COMMAND in optional mode.",
      "Missing HOTFLOW_MEMPALACE_PALACE_PATH in optional mode.",
    ]);
  });

  test("returns warn when primary mode lacks required config", () => {
    const result = probeMempalaceHealthSync({
      env: {
        HOTFLOW_MEMPALACE_MODE: "primary",
      },
    });

    expect(result.status).toBe("warn");
    expect(result.configured).toBe(false);
    expect(result.summary).toContain("primary");
    expect(result.details.issues).toEqual([
      "Missing HOTFLOW_MEMPALACE_COMMAND in primary mode.",
      "Missing HOTFLOW_MEMPALACE_PALACE_PATH in primary mode.",
    ]);
  });

  test("returns warn when configured command execution fails", () => {
    const result = probeMempalaceHealthSync({
      env: {
        HOTFLOW_MEMPALACE_MODE: "optional",
        HOTFLOW_MEMPALACE_COMMAND: "node",
        HOTFLOW_MEMPALACE_PALACE_PATH: "/repo/palace",
      },
      runCommand: createRunCommand({
        error: new Error("spawn timeout"),
      }),
    });

    expect(result.status).toBe("warn");
    expect(result.configured).toBe(true);
    expect(result.reachable).toBe(false);
    expect(result.details.timedOut).toBe(false);
  });

  test("returns pass when configured health probe succeeds", () => {
    const result = probeMempalaceHealthSync({
      env: {
        HOTFLOW_MEMPALACE_MODE: "optional",
        HOTFLOW_MEMPALACE_COMMAND: "node",
        HOTFLOW_MEMPALACE_PALACE_PATH: "/repo/palace",
      },
      runCommand: createRunCommand({
        stdout: JSON.stringify({ ok: true }),
      }),
    });

    expect(result.status).toBe("pass");
    expect(result.configured).toBe(true);
    expect(result.reachable).toBe(true);
  });

  test("routes the default command executor through Agent OS host sandbox evidence", () => {
    const cliPath = join(process.cwd(), "tests", "fixtures", "mempalace-cli.cjs");

    expect(existsSync(cliPath)).toBe(true);

    const result = probeMempalaceHealthSync({
      env: {
        HOTFLOW_MEMPALACE_MODE: "optional",
        HOTFLOW_MEMPALACE_COMMAND: process.execPath,
        HOTFLOW_MEMPALACE_COMMAND_ARGS: JSON.stringify([cliPath]),
        HOTFLOW_MEMPALACE_PALACE_PATH: "/repo/palace",
        HOTFLOW_MEMPALACE_WORKDIR: process.cwd(),
      },
    });

    expect(result.status).toBe("pass");
    expect(result.details.agentOsSandboxCommandExecution).toMatchObject({
      backend: "host",
      providerId: "agent-os-sandbox.host",
      exitCode: 0,
      enforcement: {
        process: "host-process",
      },
      backendConfig: {
        commandPattern: {
          executable: process.execPath,
          argv: [cliPath],
          operationId: `mempalace:${cliPath}`,
        },
      },
    });
  });
});

describe("searchMempalaceRecallSync", () => {
  test("returns degraded when optional mode is unconfigured", () => {
    const result = searchMempalaceRecallSync({
      env: {
        HOTFLOW_MEMPALACE_MODE: "optional",
      },
      query: "architecture",
    });

    expect(result.outcome).toBe("degraded");
    expect(result.items).toEqual([]);
    expect(result.degraded?.reason).toBe("mempalace-misconfigured");
  });

  test("returns mapped recall items when search succeeds", () => {
    const result = searchMempalaceRecallSync({
      env: {
        HOTFLOW_MEMPALACE_MODE: "optional",
        HOTFLOW_MEMPALACE_COMMAND: "node",
        HOTFLOW_MEMPALACE_PALACE_PATH: "/repo/palace",
      },
      query: "architecture",
      runCommand: createRunCommand({
        stdout: HEALTHY_STDOUT,
      }),
      now: () => 500,
    });

    expect(result.outcome).toBe("ok");
    expect(result.items).toEqual([
      {
        id: "drawer_seedance_01",
        content: "We chose the Agent OS skeleton.",
        score: 0.92,
        updatedAt: 500,
        wing: "hotflow",
        room: "architecture",
        metadata: {
          sourceFile: "architecture.md",
          verbatim: "We chose the Agent OS skeleton.\n\nReason: reusable runtime contracts.",
          retrievalEngine: "mempalace",
          matchMode: "drawer+closet",
          vectorSimilarity: 0.92,
          bm25Score: 0.73,
          distance: 0.18,
          effectiveDistance: 0.07,
          closetBoost: 0.11,
          drawerIndex: 4,
          totalDrawers: 12,
          memoryLayer: "L2",
          layerLabel: "L2 On-Demand",
          rawMetadata: {
            source_file: "/repo/architecture.md",
          },
          provenance: {
            engine: "mempalace",
            sourceFile: "architecture.md",
            wing: "hotflow",
            room: "architecture",
            drawerIndex: 4,
            totalDrawers: 12,
            memoryLayer: "L2",
          },
        },
      },
    ]);
    expect(result.details).toMatchObject({
      retrieval: {
        engine: "mempalace",
        mode: "hybrid",
        query: "architecture",
        returned: 1,
      },
    });
  });

  test("passes wing and room via JSON request body", () => {
    let seenRequest: unknown;
    const runCommand: MempalaceCommandExecutor = (input) => {
      seenRequest = JSON.parse(input.inputJson);
      return {
        status: 0,
        signal: null,
        stdout: HEALTHY_STDOUT,
        stderr: "",
        timedOut: false,
      };
    };

    searchMempalaceRecallSync({
      config: {
        mode: "optional",
        command: "node",
        commandArgs: [],
        palacePath: "/repo/palace",
        wing: "hotflow",
        room: "architecture",
        timeoutMs: 1000,
        nResults: 3,
        configured: true,
        degradeOnFailure: true,
        issues: [],
      },
      query: "architecture",
      runCommand,
    });

    expect(seenRequest).toEqual({
      action: "search",
      palacePath: "/repo/palace",
      query: "architecture",
      nResults: 3,
      wing: "hotflow",
      room: "architecture",
    });
  });
});

describe("readMempalaceDrawerSourceSync", () => {
  test("reads full drawer source by native drawerId", () => {
    let seenRequest: unknown;
    const result = readMempalaceDrawerSourceSync({
      config: {
        mode: "optional",
        command: "node",
        commandArgs: [],
        palacePath: "/repo/palace",
        timeoutMs: 1000,
        nResults: 3,
        configured: true,
        degradeOnFailure: true,
        issues: [],
      },
      drawerId: "drawer_hotflow_architecture_abc123",
      runCommand: (input) => {
        seenRequest = JSON.parse(input.inputJson);
        return {
          status: 0,
          signal: null,
          stdout: JSON.stringify({
            ok: true,
            drawer: {
              drawer_id: "drawer_hotflow_architecture_abc123",
              content: "Native drawer full text.",
              wing: "hotflow",
              room: "architecture",
              metadata: {
                source_file: "architecture.md",
                chunk_index: 4,
              },
            },
          }),
          stderr: "",
          timedOut: false,
        };
      },
    });

    expect(seenRequest).toEqual({
      action: "getDrawer",
      palacePath: "/repo/palace",
      drawerId: "drawer_hotflow_architecture_abc123",
    });
    expect(result).toMatchObject({
      outcome: "ok",
      content: "Native drawer full text.",
      source: {
        drawerId: "drawer_hotflow_architecture_abc123",
        sourceFile: "architecture.md",
        drawerIndex: 4,
        wing: "hotflow",
        room: "architecture",
      },
    });
  });

  test("reads full drawer source by sourceFile and drawerIndex", () => {
    let seenRequest: unknown;
    const result = readMempalaceDrawerSourceSync({
      config: {
        mode: "optional",
        command: "node",
        commandArgs: [],
        palacePath: "/repo/palace",
        wing: "hotflow",
        room: "architecture",
        timeoutMs: 1000,
        nResults: 3,
        configured: true,
        degradeOnFailure: true,
        issues: [],
      },
      sourceFile: "architecture.md",
      drawerIndex: 4,
      runCommand: (input) => {
        seenRequest = JSON.parse(input.inputJson);
        return {
          status: 0,
          signal: null,
          stdout: JSON.stringify({
            ok: true,
            drawer: {
              content: "Full MemPalace drawer text.\nSecond paragraph.",
              source_file: "architecture.md",
              drawer_index: 4,
              total_drawers: 12,
              memory_layer: "L2",
            },
          }),
          stderr: "",
          timedOut: false,
        };
      },
    });

    expect(seenRequest).toEqual({
      action: "readDrawer",
      palacePath: "/repo/palace",
      sourceFile: "architecture.md",
      drawerIndex: 4,
      wing: "hotflow",
      room: "architecture",
    });
    expect(result).toMatchObject({
      outcome: "ok",
      content: "Full MemPalace drawer text.\nSecond paragraph.",
      source: {
        sourceFile: "architecture.md",
        drawerIndex: 4,
        totalDrawers: 12,
        memoryLayer: "L2",
        layerLabel: "L2 On-Demand",
      },
    });
  });

  test("fails closed when drawer source input is missing", () => {
    const result = readMempalaceDrawerSourceSync({
      env: {
        HOTFLOW_MEMPALACE_MODE: "optional",
      },
      sourceFile: "",
      drawerIndex: null,
    });

    expect(result).toMatchObject({
      outcome: "degraded",
      degraded: {
        reason: "mempalace-source-read-invalid-input",
      },
    });
    expect(result.content).toBeUndefined();
  });
});

describe("indexMempalaceDrawerPointersSync", () => {
  test("builds a drawerId pointer index from MemPalace listDrawers", () => {
    let seenRequest: unknown;
    const result = indexMempalaceDrawerPointersSync({
      config: {
        mode: "optional",
        command: "node",
        commandArgs: [],
        palacePath: "/repo/palace",
        wing: "hotflow",
        room: "architecture",
        timeoutMs: 1000,
        nResults: 3,
        configured: true,
        degradeOnFailure: true,
        issues: [],
      },
      limit: 2,
      runCommand: (input) => {
        seenRequest = JSON.parse(input.inputJson);
        return {
          status: 0,
          signal: null,
          stdout: JSON.stringify({
            ok: true,
            drawers: [
              {
                drawer_id: "drawer_hotflow_architecture_abc123",
                content: "Full text A",
                wing: "hotflow",
                room: "architecture",
                metadata: {
                  source_file: "architecture.md",
                  chunk_index: 4,
                  memory_layer: "L2",
                },
              },
              {
                id: "drawer_hotflow_architecture_def456",
                text: "Full text B",
                source_file: "architecture.md",
                drawer_index: 5,
              },
            ],
          }),
          stderr: "",
          timedOut: false,
        };
      },
    });

    expect(seenRequest).toEqual({
      action: "listDrawers",
      palacePath: "/repo/palace",
      limit: 2,
      offset: 0,
      wing: "hotflow",
      room: "architecture",
    });
    expect(result).toMatchObject({
      outcome: "ok",
      pointers: [
        {
          drawerId: "drawer_hotflow_architecture_abc123",
          sourceFile: "architecture.md",
          drawerIndex: 4,
          wing: "hotflow",
          room: "architecture",
          memoryLayer: "L2",
          layerLabel: "L2 On-Demand",
        },
        {
          drawerId: "drawer_hotflow_architecture_def456",
          sourceFile: "architecture.md",
          drawerIndex: 5,
        },
      ],
    });
  });

  test("refreshes a durable drawer pointer index snapshot", () => {
    const indexPath = join(mkdtempSync(join(tmpdir(), "mempalace-drawer-index-")), "index.json");
    const result = refreshMempalaceDrawerPointerIndexSync({
      indexPath,
      config: {
        mode: "optional",
        command: "node",
        commandArgs: [],
        palacePath: "/repo/palace",
        wing: "hotflow",
        room: "architecture",
        timeoutMs: 1000,
        nResults: 3,
        configured: true,
        degradeOnFailure: true,
        issues: [],
      },
      runCommand: createRunCommand({
        stdout: JSON.stringify({
          ok: true,
          drawers: [
            {
              drawer_id: "drawer_hotflow_architecture_abc123",
              wing: "hotflow",
              room: "architecture",
              metadata: {
                source_file: "architecture.md",
                chunk_index: 4,
                memory_layer: "L2",
              },
            },
          ],
        }),
      }),
      now: () => 1710000000000,
    });

    expect(result).toMatchObject({
      outcome: "ok",
      refreshedAtMs: 1710000000000,
      indexPath,
      pointers: [
        {
          drawerId: "drawer_hotflow_architecture_abc123",
          sourceFile: "architecture.md",
          drawerIndex: 4,
          memoryLayer: "L2",
          layerLabel: "L2 On-Demand",
          wing: "hotflow",
          room: "architecture",
        },
      ],
    });
    expect(JSON.parse(readFileSync(indexPath, "utf8"))).toMatchObject({
      schemaVersion: "hotflow.mempalace.drawer-pointer-index.v1",
      refreshedAtMs: 1710000000000,
      pointers: result.pointers,
    });
    expect(loadMempalaceDrawerPointerIndexSync({ indexPath })).toMatchObject({
      outcome: "ok",
      pointers: result.pointers,
    });
  });

  test("finds drawer pointers by drawerId or sourceFile and drawerIndex", () => {
    const indexPath = join(mkdtempSync(join(tmpdir(), "mempalace-drawer-index-")), "index.json");
    refreshMempalaceDrawerPointerIndexSync({
      indexPath,
      config: {
        mode: "optional",
        command: "node",
        commandArgs: [],
        palacePath: "/repo/palace",
        timeoutMs: 1000,
        nResults: 3,
        configured: true,
        degradeOnFailure: true,
        issues: [],
      },
      runCommand: createRunCommand({
        stdout: JSON.stringify({
          ok: true,
          drawers: [
            {
              drawer_id: "drawer_hotflow_architecture_abc123",
              source_file: "architecture.md",
              drawer_index: 4,
            },
          ],
        }),
      }),
    });

    expect(
      findMempalaceDrawerPointerInIndexSync({
        indexPath,
        drawerId: "drawer_hotflow_architecture_abc123",
      }),
    ).toMatchObject({
      outcome: "ok",
      pointer: {
        drawerId: "drawer_hotflow_architecture_abc123",
      },
    });
    expect(
      findMempalaceDrawerPointerInIndexSync({
        indexPath,
        sourceFile: "architecture.md",
        drawerIndex: 4,
      }),
    ).toMatchObject({
      outcome: "ok",
      pointer: {
        drawerId: "drawer_hotflow_architecture_abc123",
      },
    });
  });

  test("scans drawer pointers across multiple pages instead of stopping at the first batch", () => {
    const seenOffsets: number[] = [];
    const result = scanMempalaceDrawerPointersSync({
      config: {
        mode: "optional",
        command: "node",
        commandArgs: [],
        palacePath: "/repo/palace",
        timeoutMs: 1000,
        nResults: 3,
        configured: true,
        degradeOnFailure: true,
        issues: [],
      },
      limit: 1,
      maxPages: 5,
      runCommand: (input) => {
        const request = JSON.parse(input.inputJson) as { offset?: number };
        seenOffsets.push(request.offset ?? 0);
        if ((request.offset ?? 0) === 0) {
          return {
            status: 0,
            signal: null,
            stdout: JSON.stringify({
              ok: true,
              drawers: [
                {
                  drawer_id: "drawer_hotflow_architecture_a",
                  source_file: "architecture.md",
                  drawer_index: 1,
                },
              ],
            }),
            stderr: "",
            timedOut: false,
          };
        }
        if ((request.offset ?? 0) === 1) {
          return {
            status: 0,
            signal: null,
            stdout: JSON.stringify({
              ok: true,
              drawers: [
                {
                  drawer_id: "drawer_hotflow_architecture_b",
                  source_file: "architecture.md",
                  drawer_index: 2,
                },
              ],
            }),
            stderr: "",
            timedOut: false,
          };
        }
        if ((request.offset ?? 0) === 2) {
          return {
            status: 0,
            signal: null,
            stdout: JSON.stringify({
              ok: true,
              drawers: [],
            }),
            stderr: "",
            timedOut: false,
          };
        }
        return {
          status: 0,
          signal: null,
          stdout: JSON.stringify({
            ok: true,
            drawers: [],
          }),
          stderr: "",
          timedOut: false,
        };
      },
    });

    expect(seenOffsets).toStrictEqual([0, 1, 2]);
    expect(result).toMatchObject({
      outcome: "ok",
      pagesScanned: 3,
      hasMore: false,
      pointers: [
        {
          drawerId: "drawer_hotflow_architecture_a",
          sourceFile: "architecture.md",
          drawerIndex: 1,
        },
        {
          drawerId: "drawer_hotflow_architecture_b",
          sourceFile: "architecture.md",
          drawerIndex: 2,
        },
      ],
    });
  });
});

describe("evaluateMempalaceRecallBenchmark", () => {
  test("computes recall metrics from auditable MemPalace result evidence", () => {
    const report = evaluateMempalaceRecallBenchmark({
      suiteId: "mempalace-smoke",
      cases: [
        {
          queryId: "seedance-scene-routing",
          query: "seedance scene routing",
          expectedIds: ["mempalace:drawer_seedance_01"],
          result: {
            outcome: "ok",
            items: [
              {
                id: "drawer_seedance_01",
                content: "Scene prompts stay per shot.",
                score: 0.93,
                updatedAt: 1,
                metadata: {
                  retrievalEngine: "mempalace",
                  matchMode: "drawer+closet",
                  verbatim: "Scene prompts stay per shot. Do not merge all scenes.",
                  sourceFile: "seedance.md",
                  provenance: {
                    engine: "mempalace",
                    sourceFile: "seedance.md",
                    drawerIndex: 2,
                    totalDrawers: 7,
                  },
                },
              },
              {
                id: "drawer_generic_02",
                content: "Generic web search note.",
                score: 0.55,
                updatedAt: 1,
              },
            ],
            details: {
              retrieval: {
                engine: "mempalace",
                mode: "hybrid",
                query: "seedance scene routing",
                requested: 2,
                returned: 2,
              },
            },
          },
          k: 2,
        },
      ],
    });

    expect(report).toMatchObject({
      suiteId: "mempalace-smoke",
      summary: {
        caseCount: 1,
        failed: 0,
        averages: {
          recallAtK: 1,
          recallAnyAtK: 1,
          recallAllAtK: 1,
          ndcgAtK: 1,
        },
      },
      failures: [],
    });
    expect(report.results[0]).toMatchObject({
      queryId: "seedance-scene-routing",
      retrievedIdsAtK: ["mempalace:drawer_seedance_01", "mempalace:drawer_generic_02"],
      evidenceAtK: expect.arrayContaining([
        expect.objectContaining({
          id: "mempalace:drawer_seedance_01",
          retrievalEngine: "mempalace",
          matchMode: "drawer+closet",
          hasVerbatim: true,
          sourceFile: "seedance.md",
        }),
      ]),
    });
  });

  test("reports degraded and missing expected IDs without counting them as hits", () => {
    const report = evaluateMempalaceRecallBenchmark({
      suiteId: "mempalace-diagnostic",
      cases: [
        {
          queryId: "missing-twitter-source",
          query: "twitter seedance latest",
          expectedIds: ["mempalace:drawer_twitter_latest"],
          result: {
            outcome: "degraded",
            items: [
              {
                id: "drawer_nearby_wrong",
                content: "Nearby but wrong.",
                score: 0.5,
                updatedAt: 1,
              },
            ],
            degraded: {
              reason: "mempalace-timeout",
              message: "Search timed out",
            },
            details: {},
          },
          k: 3,
        },
      ],
    });

    expect(report.summary).toMatchObject({
      caseCount: 1,
      failed: 1,
      averages: {
        recallAtK: 0,
        recallAnyAtK: 0,
        recallAllAtK: 0,
        ndcgAtK: 0,
      },
    });
    expect(report.failures).toEqual([
      {
        queryId: "missing-twitter-source",
        missingExpectedIds: ["mempalace:drawer_twitter_latest"],
        degradedReason: "mempalace-timeout",
      },
    ]);
  });

  test("evaluates fixture-backed real recall cases with verbatim and provenance evidence gates", () => {
    const report = evaluateMempalaceRecallBenchmarkFixture({
      schemaVersion: "hotflow.mempalace.recall-benchmark.fixture.v1",
      suiteId: "mempalace-real-eval-mini",
      source: {
        name: "locomo-style-local-fixture",
        localOnly: true,
      },
      thresholds: {
        recallAtK: 0.8,
        recallAnyAtK: 1,
        ndcgAtK: 0.8,
        requireVerbatimEvidence: true,
        requireProvenanceEvidence: true,
      },
      cases: [
        {
          queryId: "character-prefers-seedance",
          query: "Which video workflow should Mira use for scene-level prompts?",
          expectedIds: ["mempalace:drawer_character_mira_seedance"],
          k: 2,
          mempalaceResult: {
            ok: true,
            results: [
              {
                id: "drawer_character_mira_seedance",
                text: "Mira prefers Seedance scene-level video prompts.",
                verbatim:
                  "Mira prefers Seedance scene-level video prompts and wants each scene kept separate.",
                similarity: 0.97,
                matched_via: "drawer+closet",
                source_file: "locomo/mira-session.md",
                wing: "director-angel",
                room: "user-memory",
                drawer_index: 3,
                total_drawers: 12,
              },
              {
                id: "drawer_generic_video_note",
                text: "Generic video workflow note.",
                verbatim:
                  "Generic video workflow note with provenance for audit-only distractor coverage.",
                similarity: 0.61,
                source_file: "locomo/generic-video.md",
                wing: "director-angel",
                room: "user-memory",
              },
            ],
          },
        },
      ],
    });

    const thresholdResult = evaluateMempalaceRecallBenchmarkThresholds(report, report.thresholds);

    expect(report.source).toEqual({
      name: "locomo-style-local-fixture",
      localOnly: true,
    });
    expect(report.results[0]).toMatchObject({
      queryId: "character-prefers-seedance",
      retrievedIdsAtK: [
        "mempalace:drawer_character_mira_seedance",
        "mempalace:drawer_generic_video_note",
      ],
      evidenceAtK: expect.arrayContaining([
        expect.objectContaining({
          id: "mempalace:drawer_character_mira_seedance",
          hasVerbatim: true,
          sourceFile: "locomo/mira-session.md",
          provenance: expect.objectContaining({
            engine: "mempalace",
            room: "user-memory",
          }),
        }),
      ]),
    });
    expect(thresholdResult).toEqual({
      status: "passed",
      thresholds: report.thresholds,
      failures: [],
    });
  });

  test("fails fixture thresholds when expected IDs or required evidence are missing", () => {
    const report = evaluateMempalaceRecallBenchmarkFixture({
      schemaVersion: "hotflow.mempalace.recall-benchmark.fixture.v1",
      suiteId: "mempalace-real-eval-diagnostic",
      thresholds: {
        recallAtK: 1,
        recallAnyAtK: 1,
        ndcgAtK: 1,
        requireVerbatimEvidence: true,
        requireProvenanceEvidence: true,
      },
      cases: [
        {
          queryId: "missing-user-memory",
          query: "What does Mira remember about video prompts?",
          expectedIds: ["mempalace:drawer_character_mira_seedance"],
          k: 1,
          mempalaceResult: {
            ok: true,
            results: [
              {
                id: "drawer_wrong_memory",
                text: "Nearby but wrong memory.",
                similarity: 0.8,
              },
            ],
          },
        },
      ],
    });

    const thresholdResult = evaluateMempalaceRecallBenchmarkThresholds(report, report.thresholds);

    expect(thresholdResult.status).toBe("failed");
    expect(thresholdResult.failures).toEqual(
      expect.arrayContaining([
        "recall@k expected >= 1 but received 0.",
        "recallAny@k expected >= 1 but received 0.",
        "ndcg@k expected >= 1 but received 0.",
        "case missing-user-memory is missing expected IDs: mempalace:drawer_character_mira_seedance.",
        "case missing-user-memory evidence mempalace:drawer_wrong_memory is missing verbatim text.",
        "case missing-user-memory evidence mempalace:drawer_wrong_memory is missing provenance.",
      ]),
    );
  });
});

describe("planMempalaceLiveMemoryEvalSweep", () => {
  test("blocks live memory sweeps until approval, anonymization, and retention are explicit", () => {
    const plan = planMempalaceLiveMemoryEvalSweep({
      sweepId: "live-memory-sweep-missing-safety",
      dataset: {
        datasetId: "user-memory-prod",
        sourceKind: "live-user-memory",
        localOnly: false,
        containsUserContent: true,
        estimatedCaseCount: 25,
      },
      approval: {
        operatorApproved: false,
      },
      anonymization: {
        enabled: false,
        strategy: "none",
      },
      retention: {
        reportTtlDays: 120,
        storeRawContent: true,
        deleteRawContentAfterEval: false,
      },
      execution: {
        dryRunOnly: false,
        allowNetwork: true,
        readOnly: false,
      },
    });

    expect(plan.status).toBe("blocked");
    expect(plan.readyToRun).toBe(false);
    expect(plan.canReadUserData).toBe(false);
    expect(plan.reasonCodes).toEqual(
      expect.arrayContaining([
        "operator-approval-required",
        "anonymization-required",
        "raw-content-storage-forbidden",
        "retention-ttl-too-long",
        "dry-run-required",
        "network-disabled-required",
        "readonly-required",
      ]),
    );
    expect(plan.operatorChecklist).toEqual(
      expect.arrayContaining([
        expect.stringContaining("operator approval"),
        expect.stringContaining("anonymization"),
        expect.stringContaining("retention"),
      ]),
    );
  });

  test("allows only dry-run read-only local fixture sweeps without user content", () => {
    const plan = planMempalaceLiveMemoryEvalSweep({
      sweepId: "local-fixture-sweep",
      dataset: {
        datasetId: "mini-fixture",
        sourceKind: "local-fixture",
        localOnly: true,
        containsUserContent: false,
        estimatedCaseCount: 3,
      },
      approval: {
        operatorApproved: false,
      },
      anonymization: {
        enabled: true,
        strategy: "fixture-redacted",
        irreversible: true,
        removesDirectIdentifiers: true,
      },
      retention: {
        reportTtlDays: 30,
        storeRawContent: false,
        deleteRawContentAfterEval: true,
      },
      execution: {
        dryRunOnly: true,
        allowNetwork: false,
        readOnly: true,
      },
    });

    expect(plan).toMatchObject({
      status: "ready",
      readyToRun: true,
      canReadUserData: false,
      reasonCodes: [],
      safetyEnvelope: {
        sourceKind: "local-fixture",
        localOnly: true,
        dryRunOnly: true,
        allowNetwork: false,
        readOnly: true,
        storeRawContent: false,
        reportTtlDays: 30,
      },
    });
  });

  test("requires scoped approval for anonymized live user-memory sweeps", () => {
    const blocked = planMempalaceLiveMemoryEvalSweep({
      sweepId: "live-memory-sweep-wrong-scope",
      dataset: {
        datasetId: "user-memory-prod-redacted",
        sourceKind: "live-user-memory",
        localOnly: false,
        containsUserContent: true,
        estimatedCaseCount: 40,
      },
      approval: {
        operatorApproved: true,
        approvalId: "approval-1",
        scope: "fixture-only",
        approvedAt: "2026-05-09T04:00:00.000Z",
      },
      anonymization: {
        enabled: true,
        strategy: "hash+entity-redaction",
        irreversible: true,
        removesDirectIdentifiers: true,
      },
      retention: {
        reportTtlDays: 14,
        storeRawContent: false,
        deleteRawContentAfterEval: true,
      },
      execution: {
        dryRunOnly: true,
        allowNetwork: false,
        readOnly: true,
      },
    });

    expect(blocked.status).toBe("blocked");
    expect(blocked.reasonCodes).toContain("approval-scope-insufficient");

    const ready = planMempalaceLiveMemoryEvalSweep({
      ...blocked.inputSummary,
      approval: {
        operatorApproved: true,
        approvalId: "approval-2",
        scope: "live-user-memory-eval",
        approvedAt: "2026-05-09T04:05:00.000Z",
      },
    });

    expect(ready.status).toBe("ready");
    expect(ready.readyToRun).toBe(true);
    expect(ready.canReadUserData).toBe(false);
    expect(ready.reasonCodes).toEqual([]);
  });
});

describe("loadMempalaceRecallDatasetManifestFixture", () => {
  test("blocks user-content dataset manifests before scoped approval and anonymization", () => {
    const result = loadMempalaceRecallDatasetManifestFixture({
      schemaVersion: "hotflow.mempalace.recall-dataset-manifest.v1",
      dataset: {
        datasetId: "locomo-private-mini",
        sourceKind: "public-benchmark",
        localOnly: true,
        containsUserContent: true,
        estimatedCaseCount: 1,
      },
      approval: {
        operatorApproved: false,
      },
      anonymization: {
        enabled: false,
        strategy: "none",
      },
      retention: {
        reportTtlDays: 60,
        storeRawContent: true,
        deleteRawContentAfterEval: false,
      },
      execution: {
        dryRunOnly: false,
        allowNetwork: true,
        readOnly: false,
      },
      cases: [
        {
          queryId: "mira-private-video-preference",
          query: "Which workflow does Mira prefer? email mira@example.com",
          expectedIds: ["drawer_mira_seedance"],
          results: [
            {
              id: "drawer_mira_seedance",
              text: "Mira uses Seedance. Phone +1 415 555 0188.",
              verbatim: "Mira uses Seedance for private scene prompts.",
              sourceFile: "locomo/mira-private.md",
              score: 0.95,
            },
          ],
        },
      ],
    });

    expect(result.status).toBe("blocked");
    expect(result.fixture).toBeUndefined();
    expect(result.safetyPlan.reasonCodes).toEqual(
      expect.arrayContaining([
        "operator-approval-required",
        "anonymization-required",
        "raw-content-storage-forbidden",
        "retention-ttl-too-long",
        "dry-run-required",
        "network-disabled-required",
        "readonly-required",
      ]),
    );
    expect(result.anonymization).toMatchObject({
      rawContentStored: false,
      irreversible: false,
    });
  });

  test("loads approved local benchmark manifests into anonymized recall fixtures", () => {
    const result = loadMempalaceRecallDatasetManifestFixture({
      schemaVersion: "hotflow.mempalace.recall-dataset-manifest.v1",
      suiteId: "mempalace-real-dataset-loader-mini",
      source: {
        name: "locomo-style-approved-local-manifest",
        dataset: "locomo-mini",
        version: "2026-05-10",
      },
      thresholds: {
        recallAtK: 1,
        requireVerbatimEvidence: true,
        requireProvenanceEvidence: true,
      },
      dataset: {
        datasetId: "locomo-mini",
        sourceKind: "public-benchmark",
        localOnly: true,
        containsUserContent: true,
        estimatedCaseCount: 1,
      },
      approval: {
        operatorApproved: true,
        approvalId: "approval-public-memory-1",
        scope: "public-benchmark-eval",
        approvedAt: "2026-05-10T02:00:00.000Z",
      },
      anonymization: {
        enabled: true,
        strategy: "hash+entity-redaction",
        irreversible: true,
        removesDirectIdentifiers: true,
      },
      retention: {
        reportTtlDays: 14,
        storeRawContent: false,
        deleteRawContentAfterEval: true,
      },
      execution: {
        dryRunOnly: true,
        allowNetwork: false,
        readOnly: true,
      },
      cases: [
        {
          queryId: "mira-private-video-preference",
          query:
            "What video workflow did Mira Zhang prefer? Email mira@example.com and phone +1 415 555 0188.",
          expectedIds: ["drawer_mira_seedance"],
          k: 1,
          results: [
            {
              id: "drawer_mira_seedance",
              text: "Mira Zhang prefers Seedance scene prompts. Reach her at mira@example.com or +1 415 555 0188.",
              verbatim:
                "Mira Zhang prefers Seedance scene prompts and wants every shot kept separate.",
              sourceFile: "locomo/private/mira-session.md",
              wing: "director-angel",
              room: "user-memory",
              score: 0.96,
            },
          ],
        },
      ],
    });

    expect(result.status).toBe("ready");
    expect(result.safetyPlan).toMatchObject({
      status: "ready",
      readyToRun: true,
      canReadUserData: false,
    });
    expect(result.anonymization).toMatchObject({
      rawContentStored: false,
      irreversible: true,
      removedDirectIdentifiers: true,
    });
    expect(result.anonymization.redactionCount).toBeGreaterThanOrEqual(6);
    expect(JSON.stringify(result.fixture)).not.toContain("Mira");
    expect(JSON.stringify(result.fixture)).not.toContain("mira");
    expect(JSON.stringify(result.fixture)).not.toContain("mira@example.com");
    expect(JSON.stringify(result.fixture)).not.toContain("415 555 0188");
    expect(JSON.stringify(result.fixture)).toContain("[redacted:person:");
    expect(JSON.stringify(result.fixture)).toContain("[redacted:email:");
    expect(JSON.stringify(result.fixture)).toContain("[redacted:phone:");

    const report = evaluateMempalaceRecallBenchmarkFixture(result.fixture);
    const thresholds = evaluateMempalaceRecallBenchmarkThresholds(report, report.thresholds);

    expect(result.fixture.source).toMatchObject({
      name: "locomo-style-approved-local-manifest",
      localOnly: true,
      dataset: "locomo-mini",
    });
    expect(result.fixture.cases[0]).toMatchObject({
      queryId: expect.stringMatching(/^case_/u),
      expectedIds: [expect.stringMatching(/^mempalace:anon_/u)],
      mempalaceResult: {
        ok: true,
        results: [
          expect.objectContaining({
            id: expect.stringMatching(/^anon_/u),
            source_file: expect.stringMatching(/^source_/u),
            metadata: expect.objectContaining({
              anonymized: true,
              originalIdHash: expect.stringMatching(/^sha256:/u),
              originalSourceFileHash: expect.stringMatching(/^sha256:/u),
            }),
          }),
        ],
      },
    });
    expect(thresholds).toEqual({
      status: "passed",
      thresholds: result.fixture.thresholds,
      failures: [],
    });
  });
});
