import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { getBenchmarksPaths } from "./cli-command.mjs";

const { repoRoot, resultsDir } = getBenchmarksPaths();
const suiteId = "director-phase-enext-agent-os-skill-failure-to-patch-eval-gate";
const latestPath = resolve(resultsDir, `${suiteId}-latest.json`);

const requiredSourceCoverage = [
  {
    id: "failure-to-patch-generator-api",
    path: "packages/skills/src/generator.ts",
    needles: [
      "generateSkillFailurePatchProposal",
      "GenerateSkillFailurePatchProposalInput",
      "GeneratedSkillFailurePatchProposal",
      "SkillFailurePatchEvidence",
      "skills.failure-to-patch-eval.v1",
      "failurePatchPayload",
      "patchProposal",
      "sourceSkill",
      "failureEvidence",
      "reviewRequirement",
      "noPromotionWithoutReview",
    ],
  },
  {
    id: "skills-index-export",
    path: "packages/skills/src/index.ts",
    needles: [
      "generateSkillFailurePatchProposal",
      "GenerateSkillFailurePatchProposalInput",
      "GeneratedSkillFailurePatchProposal",
      "SkillFailurePatchEvidence",
    ],
  },
  {
    id: "failure-to-patch-tests",
    path: "packages/skills/tests/proposal-generator.test.ts",
    needles: [
      "generateSkillFailurePatchProposal",
      "turns repeated Skill failures into a review-gated patch proposal",
      "skills.failure-to-patch-eval.v1",
      "failurePatchPayload",
      "noPromotionWithoutReview",
      "reviewRequirement",
    ],
  },
  {
    id: "bad-proposal-review-tests",
    path: "packages/skills/tests/review.test.ts",
    needles: [
      "rejects failure-to-patch proposals with dangerous generated content",
      "dangerous_content",
      "untrusted_provenance",
    ],
  },
  {
    id: "no-review-no-promotion-tests",
    path: "packages/skills/tests/safe-apply.test.ts",
    needles: [
      "blocks failure-to-patch promotion before proposal review acceptance",
      "must be accepted before safe apply",
    ],
  },
  {
    id: "release-registration",
    path: "benchmarks/scripts/director-agent-os-all-gate.mjs",
    needles: ["director-phase-enext-agent-os-skill-failure-to-patch-eval-gate"],
  },
];

const requiredPackageScripts = [
  {
    id: "benchmarks-package-script",
    path: "benchmarks/package.json",
    needle:
      '"bench:director-agent-os-skill-failure-to-patch-eval": "node ./scripts/director-phase-enext-agent-os-skill-failure-to-patch-eval-gate.mjs"',
  },
  {
    id: "root-package-script",
    path: "package.json",
    needle:
      '"bench:director-agent-os-skill-failure-to-patch-eval": "pnpm --dir benchmarks bench:director-agent-os-skill-failure-to-patch-eval"',
  },
  {
    id: "wave-manifest",
    path: "benchmarks/scripts/wave-suite-manifest.mjs",
    needle: "director-phase-enext-agent-os-skill-failure-to-patch-eval-gate",
  },
  {
    id: "release-suite-coverage",
    path: "benchmarks/scripts/director-agent-os-release-suite-coverage-gate.mjs",
    needle: "skill-failure-to-patch-eval",
  },
  {
    id: "benchmark-readme",
    path: "benchmarks/README.md",
    needle: "bench:director-agent-os-skill-failure-to-patch-eval",
  },
];

function readText(path) {
  return readFileSync(resolve(repoRoot, path), "utf8");
}

function evaluateNeedleCoverage(items) {
  return items.map((item) => {
    let text = "";
    let sourceLoadError = null;
    try {
      text = readText(item.path);
    } catch (error) {
      sourceLoadError = error instanceof Error ? error.message : String(error);
    }
    const missingNeedles =
      sourceLoadError === null
        ? (item.needles?.filter((needle) => !text.includes(needle)) ??
          (text.includes(item.needle) ? [] : [item.needle]))
        : (item.needles ?? [item.needle]);
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

const sourceCoverage = evaluateNeedleCoverage(requiredSourceCoverage);
const registrationCoverage = evaluateNeedleCoverage(requiredPackageScripts);
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
    note: "E.next failure-to-patch eval proves repeated Skill failures generate review-gated patch proposals, dangerous proposals are rejected, and no Skill promotion happens without accepted review.",
  },
  sourceCoverage,
  registrationCoverage,
  failures,
};

writeFileSync(latestPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

process.stdout.write(
  `Director Agent OS Skill failure-to-patch eval gate completed: ${report.summary.status}\n`,
);
process.stdout.write(
  `Source coverage: ${report.summary.sourceCoveragePassed}/${report.summary.sourceCoverage}, registration coverage: ${report.summary.registrationCoveragePassed}/${report.summary.registrationCoverage}\n`,
);
process.stdout.write(`Report: ${latestPath}\n`);

if (failures.length > 0) {
  process.stderr.write("Director Agent OS Skill failure-to-patch eval gate failed.\n");
  process.stderr.write(`${failures.join("\n")}\n`);
  process.exit(1);
}
