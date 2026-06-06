#!/usr/bin/env node
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { importReferenceSkills } from "../packages/skills/dist/index.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const hotflowRoot = resolve(repoRoot, "..");
const dataDir = resolve(repoRoot, ".hotflow");

const repositories = [
  {
    repoId: "hermes-agent",
    root: resolve(hotflowRoot, "hermes-agent"),
    includeDirs: ["skills", "optional-skills"],
  },
  {
    repoId: "openclaw",
    root: resolve(hotflowRoot, "openclaw"),
    includeDirs: ["skills", "extensions", ".agents/skills"],
  },
  {
    repoId: "mempalace",
    root: resolve(hotflowRoot, "mempalace"),
    includeDirs: [".codex-plugin/skills", ".claude-plugin/skills", "integrations"],
  },
].filter((repo) => existsSync(repo.root));

const result = await importReferenceSkills({
  dataDir,
  repositories,
  actor: "director-angel-reference-import",
});

console.log(JSON.stringify(result, null, 2));
