import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { getBenchmarksPaths } from "./cli-command.mjs";

const { repoRoot, resultsDir } = getBenchmarksPaths();
const suiteId = "director-phase-enext-agent-os-skill-patch-editor-diff-confirmation-gate";
const latestPath = resolve(resultsDir, `${suiteId}-latest.json`);

const requiredSourceCoverage = [
  {
    id: "desktop-contract-action",
    path: "apps/director-desktop/src/desktop-contract.js",
    needles: ["SKILL_CURATOR_APPLY_PATCH", "skill.curatorApplyPatch"],
  },
  {
    id: "desktop-bridge-action",
    path: "apps/director-desktop/src/desktop-bridge-facade.js",
    needles: ["DESKTOP_ACTIONS.SKILL_CURATOR_APPLY_PATCH", "handlers.skills?.curatorApplyPatch"],
  },
  {
    id: "desktop-local-guarded-apply-handler",
    path: "apps/director-desktop/src/desktop-system-handlers.js",
    needles: [
      "SkillCuratorAutoApplyService",
      "guardSkillCuratorWriteRequest",
      "SKILL_CURATOR_WRITE_SCOPE",
      "curatorApplyPatch: async (action)",
      "applyDesktopSkillCuratorPatchWithDiffConfirmation",
      "diffConfirmationAccepted",
      "patchEditorPayload",
      'operatorScope: "skills.curator.write"',
      "Host API Skill curator patch editor actions are not wired yet; use local desktop mode.",
      "skills.curator.write",
      "curatorAutoApplyResult",
    ],
  },
  {
    id: "desktop-patch-editor-ui",
    path: "apps/director-desktop/src/app.js",
    needles: [
      "createSkillCuratorPatchEditor",
      "createSkillCuratorPatchDiffPreview",
      "readSkillCuratorPatchEditorPayload",
      "data-skill-curator-patch-field",
      "diff confirmation",
      "我已核对 diff，只应用上方 bounded Skill patch",
      "DESKTOP_ACTIONS.SKILL_CURATOR_APPLY_PATCH",
      'operatorScope: "skills.curator.write"',
      "patchEditorPayload",
      "createSkillCuratorPatchEditor(action)",
      "bounded file scope",
      "remote curator write execution remains disabled",
    ],
  },
  {
    id: "desktop-structure-tests",
    path: "apps/director-desktop/src/app-structure.test.js",
    needles: [
      "renders Skill curator patch editor with diff confirmation",
      "createSkillCuratorPatchEditor",
      "createSkillCuratorPatchDiffPreview",
      "readSkillCuratorPatchEditorPayload",
      "SKILL_CURATOR_APPLY_PATCH",
      "diff confirmation",
      "bounded Skill patch",
    ],
  },
  {
    id: "desktop-handler-tests",
    path: "apps/director-desktop/src/desktop-system-handlers.test.js",
    needles: [
      "applies a Skill curator patch through the desktop diff confirmation flow",
      "SKILL_CURATOR_APPLY_PATCH",
      "diffConfirmationAccepted",
      "patchEditorPayload",
      "curatorAutoApplyResult",
      "curatorAutoAppliedAtMs",
      "skills.curator-auto-apply://patch/skill.failed-curator",
    ],
  },
  {
    id: "desktop-patch-editor-styles",
    path: "apps/director-desktop/src/styles.css",
    needles: [
      ".skill-curator-patch-editor",
      ".skill-curator-patch-diff-preview",
      ".skill-curator-diff-confirmation",
      ".skill-curator-patch-field",
    ],
  },
  {
    id: "release-registration",
    path: "benchmarks/scripts/director-agent-os-all-gate.mjs",
    needles: ["director-phase-enext-agent-os-skill-patch-editor-diff-confirmation-gate"],
  },
];

const requiredPackageScripts = [
  {
    id: "benchmarks-package-script",
    path: "benchmarks/package.json",
    needle:
      '"bench:director-agent-os-skill-patch-editor-diff-confirmation": "node ./scripts/director-phase-enext-agent-os-skill-patch-editor-diff-confirmation-gate.mjs"',
  },
  {
    id: "root-package-script",
    path: "package.json",
    needle:
      '"bench:director-agent-os-skill-patch-editor-diff-confirmation": "pnpm --dir benchmarks bench:director-agent-os-skill-patch-editor-diff-confirmation"',
  },
  {
    id: "wave-manifest",
    path: "benchmarks/scripts/wave-suite-manifest.mjs",
    needle: "director-phase-enext-agent-os-skill-patch-editor-diff-confirmation-gate",
  },
  {
    id: "release-suite-coverage",
    path: "benchmarks/scripts/director-agent-os-release-suite-coverage-gate.mjs",
    needle: "skill-patch-editor-diff-confirmation",
  },
  {
    id: "benchmark-readme",
    path: "benchmarks/README.md",
    needle: "bench:director-agent-os-skill-patch-editor-diff-confirmation",
  },
];

function readText(path) {
  return readFileSync(resolve(repoRoot, path), "utf8");
}

function evaluateSourceCoverage() {
  return requiredSourceCoverage.map((item) => {
    let text = "";
    let sourceLoadError = null;
    try {
      text = readText(item.path);
    } catch (error) {
      sourceLoadError = error instanceof Error ? error.message : String(error);
    }
    const missingNeedles =
      sourceLoadError === null
        ? item.needles.filter((needle) => !text.includes(needle))
        : item.needles;
    return {
      id: item.id,
      path: item.path,
      status: missingNeedles.length === 0 ? "passed" : "failed",
      missingNeedles,
      ...(sourceLoadError === null ? {} : { sourceLoadError }),
    };
  });
}

function evaluateRegistrationCoverage() {
  return requiredPackageScripts.map((item) => {
    let text = "";
    let sourceLoadError = null;
    try {
      text = readText(item.path);
    } catch (error) {
      sourceLoadError = error instanceof Error ? error.message : String(error);
    }
    const missingNeedles =
      sourceLoadError === null && text.includes(item.needle) ? [] : [item.needle];
    return {
      id: item.id,
      path: item.path,
      status: missingNeedles.length === 0 ? "passed" : "failed",
      missingNeedles,
      ...(sourceLoadError === null ? {} : { sourceLoadError }),
    };
  });
}

mkdirSync(resultsDir, { recursive: true });

const sourceCoverage = evaluateSourceCoverage();
const registrationCoverage = evaluateRegistrationCoverage();
const failedSourceCoverage = sourceCoverage.filter((result) => result.status !== "passed");
const failedRegistrationCoverage = registrationCoverage.filter(
  (result) => result.status !== "passed",
);
const failures = [
  ...failedSourceCoverage.map(
    (result) => `${result.id} missing ${result.missingNeedles.join(", ")} in ${result.path}`,
  ),
  ...failedRegistrationCoverage.map(
    (result) => `${result.id} missing ${result.missingNeedles.join(", ")} in ${result.path}`,
  ),
];

const report = {
  suiteId,
  generatedAt: new Date().toISOString(),
  summary: {
    status: failures.length === 0 ? "passed" : "failed",
    sourceCoverage: sourceCoverage.length,
    sourceCoveragePassed: sourceCoverage.length - failedSourceCoverage.length,
    registrationCoverage: registrationCoverage.length,
    registrationCoveragePassed: registrationCoverage.length - failedRegistrationCoverage.length,
    failed: failures.length,
    note: "E.next proves desktop Skill curator patch editor uses bounded patch payloads, explicit diff confirmation, local operator scope, and SkillCuratorAutoApplyService while remote curator write execution stays disabled.",
  },
  sourceCoverage,
  registrationCoverage,
  failures,
};

writeFileSync(latestPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

process.stdout.write(
  `Director Agent OS Skill patch editor diff confirmation gate completed: ${report.summary.status}\n`,
);
process.stdout.write(
  `Source coverage: ${report.summary.sourceCoveragePassed}/${report.summary.sourceCoverage}, registration coverage: ${report.summary.registrationCoveragePassed}/${report.summary.registrationCoverage}\n`,
);
process.stdout.write(`Report: ${latestPath}\n`);

if (failures.length > 0) {
  process.stderr.write("Director Agent OS Skill patch editor diff confirmation gate failed.\n");
  process.stderr.write(`${failures.join("\n")}\n`);
  process.exit(1);
}
