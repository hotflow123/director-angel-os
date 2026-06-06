import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  ToolRegistry,
  createFilesystemReadTextTool,
  createTasksTodoWriteTool,
} from "../../packages/tools/dist/index.js";
import { getBenchmarksPaths, runWorkspaceBuild } from "./cli-command.mjs";

function fail(message, details) {
  if (details) {
    process.stderr.write(`${message}\n${details}\n`);
  } else {
    process.stderr.write(`${message}\n`);
  }
  process.exit(1);
}

async function runGate() {
  const { resultsDir } = getBenchmarksPaths();

  for (const target of ["@hotflow/contracts", "@hotflow/policy-runtime", "@hotflow/tools"]) {
    const build = runWorkspaceBuild(target, process.env);
    if (build.status !== 0) {
      fail(`build failed for ${target} during wave44 tool schema surface gate.`, build.stderr);
    }
  }

  const registry = new ToolRegistry();
  registry.register(
    createFilesystemReadTextTool({
      allowedRoots: ["/workspace"],
    }),
  );
  registry.register(
    createTasksTodoWriteTool({
      async write(items) {
        return { items };
      },
    }),
  );
  registry.register({
    name: "filesystem.hidden",
    description: "hidden until token exists",
    timeoutMs: 100,
    readOnly: true,
    schema: {
      type: "object",
      additionalProperties: false,
    },
    toolset: "filesystem",
    toolsetDescription: "Workspace-scoped file reading tools.",
    toolsetEnabledByDefault: true,
    requiresEnv: ["WAVE44_TOKEN"],
    async execute() {
      return {
        toolCallId: "ignored_hidden",
        toolName: "filesystem.hidden",
        ok: true,
        output: "ok",
      };
    },
  });

  const failures = [];
  const toolsets = registry.listToolsets();
  const schemas = registry.getSchemas({ WAVE44_TOKEN: "" });
  const filesystemSchemas = registry.getSchemas("filesystem", { WAVE44_TOKEN: "" });

  if (
    JSON.stringify(toolsets) !==
    JSON.stringify([
      {
        name: "filesystem",
        description: "Workspace-scoped file reading tools.",
        tools: ["filesystem.hidden", "filesystem.read_text"],
        enabledByDefault: true,
      },
      {
        name: "tasks",
        description: "Task board mutation tools.",
        tools: ["tasks.todo_write"],
        enabledByDefault: true,
      },
    ])
  ) {
    failures.push(`Unexpected toolset catalog: ${JSON.stringify(toolsets)}.`);
  }

  if (
    JSON.stringify(schemas.map((entry) => entry.name)) !==
    JSON.stringify(["filesystem.read_text", "tasks.todo_write"])
  ) {
    failures.push(
      `Unexpected visible schemas: ${JSON.stringify(schemas.map((entry) => entry.name))}.`,
    );
  }

  if (
    JSON.stringify(filesystemSchemas.map((entry) => entry.name)) !==
    JSON.stringify(["filesystem.read_text"])
  ) {
    failures.push(
      `Expected filesystem schema surface to hide env-gated tools, but received ${JSON.stringify(filesystemSchemas.map((entry) => entry.name))}.`,
    );
  }

  if (filesystemSchemas[0]?.inputSchema?.properties?.path?.type !== "string") {
    failures.push(
      `Expected filesystem.read_text schema to expose path:string, but received ${JSON.stringify(filesystemSchemas[0]?.inputSchema)}.`,
    );
  }

  if (schemas[1]?.inputSchema?.properties?.items?.type !== "array") {
    failures.push(
      `Expected tasks.todo_write schema to expose items:array, but received ${JSON.stringify(schemas[1]?.inputSchema)}.`,
    );
  }

  mkdirSync(resultsDir, { recursive: true });
  writeFileSync(
    join(resultsDir, "wave44-tool-schema-surface-gate-latest.json"),
    JSON.stringify(
      {
        gate: "wave44-tool-schema-surface",
        toolsets,
        schemas,
        filesystemSchemas,
        passed: failures.length === 0,
        failures,
      },
      null,
      2,
    ),
    "utf8",
  );

  if (failures.length > 0) {
    fail("wave44 tool schema surface gate failed.", failures.join("\n"));
  }

  process.stdout.write("wave44 tool schema surface gate passed.\n");
}

await runGate();
