import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { getBenchmarksPaths } from "./cli-command.mjs";

function compareSubset(actual, expected, path = "value") {
  const failures = [];

  if (expected === null || typeof expected !== "object" || Array.isArray(expected)) {
    if (actual !== expected) {
      failures.push(
        `Expected ${path}=${JSON.stringify(expected)} but received ${JSON.stringify(actual)}.`,
      );
    }
    return failures;
  }

  if (actual === null || typeof actual !== "object" || Array.isArray(actual)) {
    failures.push(`Expected ${path} to be an object.`);
    return failures;
  }

  for (const [key, expectedValue] of Object.entries(expected)) {
    failures.push(...compareSubset(actual[key], expectedValue, `${path}.${key}`));
  }

  return failures;
}

function detectIntegrationState(repoRoot) {
  const skillsDistPath = resolve(repoRoot, "packages/skills/dist/index.js");
  const pluginRuntimeDistPath = resolve(repoRoot, "packages/plugin-runtime/dist/index.js");
  const internalPluginsRoot = resolve(repoRoot, "internal-plugins");
  const internalProvidersRoot = resolve(internalPluginsRoot, "providers");
  const internalToolsRoot = resolve(internalPluginsRoot, "tools");

  const internalProviderPluginPresent =
    existsSync(resolve(internalProvidersRoot, "scripted")) ||
    existsSync(resolve(internalProvidersRoot, "scripted/index.ts")) ||
    existsSync(resolve(internalProvidersRoot, "scripted/index.js")) ||
    existsSync(resolve(internalProvidersRoot, "scripted/plugin.json")) ||
    existsSync(resolve(internalProvidersRoot, "scripted/manifest.json"));

  const internalToolPluginPresent =
    existsSync(resolve(internalToolsRoot, "filesystem-read")) ||
    existsSync(resolve(internalToolsRoot, "filesystem-read/index.ts")) ||
    existsSync(resolve(internalToolsRoot, "filesystem-read/index.js")) ||
    existsSync(resolve(internalToolsRoot, "filesystem-read/plugin.json")) ||
    existsSync(resolve(internalToolsRoot, "filesystem-read/manifest.json"));

  const state = {
    skillsDistPath,
    pluginRuntimeDistPath,
    internalPluginsRoot,
    skillsBuilt: existsSync(skillsDistPath),
    pluginRuntimeBuilt: existsSync(pluginRuntimeDistPath),
    internalProviderPluginPresent,
    internalToolPluginPresent,
  };

  const assumptions = [];
  if (!state.skillsBuilt) {
    assumptions.push("ASSUME_SKILLS_PACKAGE_BUILT: missing packages/skills/dist/index.js");
  }
  if (!state.pluginRuntimeBuilt) {
    assumptions.push("ASSUME_PLUGIN_RUNTIME_BUILT: missing packages/plugin-runtime/dist/index.js");
  }
  if (!state.internalProviderPluginPresent) {
    assumptions.push(
      "ASSUME_INTERNAL_PROVIDER_PLUGIN: missing internal-plugins/providers/scripted",
    );
  }
  if (!state.internalToolPluginPresent) {
    assumptions.push("ASSUME_INTERNAL_TOOL_PLUGIN: missing internal-plugins/tools/filesystem-read");
  }

  return { state, assumptions };
}

function hasAllRequiredIntegrations(state, requiredIntegrations = []) {
  for (const requirement of requiredIntegrations) {
    if (requirement === "skills" && !state.skillsBuilt) {
      return false;
    }
    if (requirement === "plugin-runtime" && !state.pluginRuntimeBuilt) {
      return false;
    }
    if (
      requirement === "internal-plugins" &&
      (!state.internalProviderPluginPresent || !state.internalToolPluginPresent)
    ) {
      return false;
    }
  }
  return true;
}

async function importExports(modulePath) {
  const moduleUrl = pathToFileURL(modulePath).href;
  const imported = await import(moduleUrl);
  return Object.keys(imported);
}

function includesAll(actualExports, expectedExports) {
  return expectedExports.every((name) => actualExports.includes(name));
}

async function runCase(benchmarkCase, repoRoot) {
  const started = process.hrtime.bigint();
  const failures = [];
  const { state, assumptions } = detectIntegrationState(repoRoot);
  const baselineIntegrations = ["skills", "plugin-runtime", "internal-plugins"];
  const integrationReady = hasAllRequiredIntegrations(state, baselineIntegrations);
  const strictReady = hasAllRequiredIntegrations(state, benchmarkCase.requiredIntegrations ?? []);

  const actual = {
    hasBenchScaffold: true,
    integrationReady,
    assumptions,
    skillsBuilt: state.skillsBuilt,
    pluginRuntimeBuilt: state.pluginRuntimeBuilt,
    internalProviderPluginPresent: state.internalProviderPluginPresent,
    internalToolPluginPresent: state.internalToolPluginPresent,
    skillSnapshotInjectable: false,
    proposalIsolationBoundaryPresent: false,
    pluginRuntimeCanLoadAndRegister: false,
    skillsExports: [],
    pluginRuntimeExports: [],
  };

  if (benchmarkCase.mode === "strict-when-ready" && !strictReady) {
    const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;
    return {
      caseId: benchmarkCase.id,
      durationMs,
      ok: true,
      skipped: true,
      skipReason: "Strict checks skipped: required integrations are not ready yet.",
      failures: [],
      actual,
    };
  }

  if (state.skillsBuilt) {
    try {
      actual.skillsExports = await importExports(state.skillsDistPath);
      actual.skillSnapshotInjectable =
        actual.skillsExports.includes("SkillRepository") ||
        actual.skillsExports.includes("SkillPromptIndex");
      actual.proposalIsolationBoundaryPresent =
        actual.skillsExports.includes("SkillProposalStore") &&
        actual.skillsExports.includes("SkillReconciler");
    } catch (error) {
      failures.push(`Failed to import skills package: ${String(error)}`);
    }
  }

  if (state.pluginRuntimeBuilt) {
    try {
      actual.pluginRuntimeExports = await importExports(state.pluginRuntimeDistPath);
      actual.pluginRuntimeCanLoadAndRegister =
        actual.pluginRuntimeExports.includes("PluginLoader") &&
        actual.pluginRuntimeExports.includes("PluginRegistrar");
    } catch (error) {
      failures.push(`Failed to import plugin-runtime package: ${String(error)}`);
    }
  }

  if (
    Array.isArray(benchmarkCase.expectedSkillsExports) &&
    benchmarkCase.expectedSkillsExports.length > 0
  ) {
    if (!includesAll(actual.skillsExports, benchmarkCase.expectedSkillsExports)) {
      failures.push(
        `Missing expected skills exports: ${benchmarkCase.expectedSkillsExports
          .filter((name) => !actual.skillsExports.includes(name))
          .join(", ")}`,
      );
    }
  }

  if (
    Array.isArray(benchmarkCase.expectedPluginRuntimeExports) &&
    benchmarkCase.expectedPluginRuntimeExports.length > 0
  ) {
    if (!includesAll(actual.pluginRuntimeExports, benchmarkCase.expectedPluginRuntimeExports)) {
      failures.push(
        `Missing expected plugin-runtime exports: ${benchmarkCase.expectedPluginRuntimeExports
          .filter((name) => !actual.pluginRuntimeExports.includes(name))
          .join(", ")}`,
      );
    }
  }

  if (benchmarkCase.expect) {
    failures.push(...compareSubset(actual, benchmarkCase.expect, "result"));
  }

  const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;
  return {
    caseId: benchmarkCase.id,
    durationMs,
    ok: failures.length === 0,
    skipped: false,
    failures,
    actual,
  };
}

const { benchmarksDir, repoRoot, resultsDir } = getBenchmarksPaths();
const fixturePath = resolve(benchmarksDir, "fixtures", "wave15-skills-plugins-gate.json");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
const runs = [];

for (const benchmarkCase of fixture.cases ?? []) {
  runs.push(await runCase(benchmarkCase, repoRoot));
}

const failedRuns = runs.filter((run) => !run.ok);
const skippedRuns = runs.filter((run) => run.skipped);
mkdirSync(resultsDir, { recursive: true });
const outputPath = resolve(resultsDir, "wave15-skills-plugins-gate-latest.json");
writeFileSync(
  outputPath,
  JSON.stringify(
    {
      summary: {
        suiteId: fixture.suiteId ?? "wave15-skills-plugins-gate",
        timestamp: new Date().toISOString(),
        totalRuns: runs.length,
        failedRuns: failedRuns.length,
        skippedRuns: skippedRuns.length,
      },
      runs,
    },
    null,
    2,
  ),
);

process.stdout.write(
  `Wave 15 skills/plugins gate completed: ${runs.length} runs, failed ${failedRuns.length}, skipped ${skippedRuns.length}\n`,
);
process.stdout.write(`Report: ${outputPath}\n`);

if (failedRuns.length > 0) {
  process.exitCode = 1;
}
