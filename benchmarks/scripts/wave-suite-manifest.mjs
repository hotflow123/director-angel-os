const waveSuiteManifest = [
  {
    id: "wave1-quality-gate",
    script: "wave1-quality-gate.mjs",
    command: "pnpm --dir benchmarks bench:quality",
    description: "Wave 1 quality gate scenario + replay benchmark cases.",
    kind: "gate",
    required: true,
  },
  {
    id: "wave2-recovery-gate",
    script: "wave2-recovery-gate.mjs",
    command: "pnpm --dir benchmarks bench:recovery",
    description: "Wave 2 interrupted-turn recovery gate.",
    kind: "gate",
    required: true,
  },
  {
    id: "wave3-governance-gate",
    script: "wave3-governance-gate.mjs",
    command: "pnpm --dir benchmarks bench:governance",
    description: "Wave 3 governance and degradation coverage.",
    kind: "gate",
    required: true,
  },
  {
    id: "wave4-task-control-plane-gate",
    script: "wave4-task-control-plane-gate.mjs",
    command: "pnpm --dir benchmarks bench:taskplane",
    description: "Wave 4 task/control-plane vertical slice gate.",
    kind: "gate",
    required: true,
  },
  {
    id: "wave5-task-contract-gate",
    script: "wave5-task-contract-gate.mjs",
    command: "pnpm --dir benchmarks bench:taskcontract",
    description: "Wave 5 contract coverage for task events and recovery boundaries.",
    kind: "gate",
    required: true,
  },
  {
    id: "wave6-dynamic-context-gate",
    script: "wave6-dynamic-context-gate.mjs",
    command: "pnpm --dir benchmarks bench:context",
    description:
      "Wave 6 dynamic context, tool injection, budget omission, and memory degrade coverage.",
    kind: "gate",
    required: true,
  },
  {
    id: "wave7-provider-run-gate",
    script: "wave7-provider-run-gate.mjs",
    command: "pnpm --dir benchmarks bench:provider",
    description: "Wave 7 real provider run gate.",
    kind: "gate",
    required: true,
  },
  {
    id: "wave8-doctor-gate",
    script: "wave8-doctor-gate.mjs",
    command: "pnpm --dir benchmarks bench:doctor",
    description: "Wave 8 doctor diagnostics coverage.",
    kind: "gate",
    required: true,
  },
  {
    id: "wave9-channels-gate",
    script: "wave9-channels-gate.mjs",
    command: "pnpm --dir benchmarks bench:channels",
    description: "Wave 9 direct/thread routing contract gate.",
    kind: "gate",
    required: true,
  },
  {
    id: "wave10-gateway-gate",
    script: "wave10-gateway-gate.mjs",
    command: "pnpm --dir benchmarks bench:gateway",
    description: "Wave 10 gateway HTTP contract gate.",
    kind: "gate",
    required: true,
  },
  {
    id: "wave11-worker-jobs-gate",
    script: "wave11-worker-jobs-gate.mjs",
    command: "pnpm --dir benchmarks bench:workerjobs",
    description: "Wave 11 worker jobs proposal pipeline gate.",
    kind: "gate",
    required: true,
  },
  {
    id: "wave12-delegation-flow-gate",
    script: "wave12-delegation-flow-gate.mjs",
    command: "pnpm --dir benchmarks bench:delegationflow",
    description: "Wave 12 delegation mailbox + verification coverage.",
    kind: "gate",
    required: true,
  },
  {
    id: "wave13-proposal-reconcile-gate",
    script: "wave13-proposal-reconcile-gate.mjs",
    command: "pnpm --dir benchmarks bench:reconcile",
    description: "Wave 13 proposal reconcile + safe apply gate.",
    kind: "gate",
    required: true,
  },
  {
    id: "wave14-runtime-failure-gate",
    script: "wave14-runtime-failure-gate.mjs",
    command: "pnpm --dir benchmarks bench:runtimefailures",
    description: "Wave 14 runtime failure + degradation contract gate.",
    kind: "gate",
    required: true,
  },
  {
    id: "wave15-skills-plugins-gate",
    script: "wave15-skills-plugins-gate.mjs",
    command: "pnpm --dir benchmarks bench:skillsplugins",
    description: "Wave 15 skills/plugin-runtime/internal-plugins scaffold gate.",
    kind: "gate",
    required: true,
  },
  {
    id: "wave16-skill-reload-gate",
    script: "wave16-skill-reload-gate.mjs",
    command: "pnpm --dir benchmarks bench:skillreload",
    description: "Wave 16 skill reload gate.",
    kind: "gate",
    required: true,
  },
  {
    id: "wave17-skill-review-gate",
    script: "wave17-skill-review-gate.mjs",
    command: "pnpm --dir benchmarks bench:skillreview",
    description: "Wave 17 skill review gate.",
    kind: "gate",
    required: true,
  },
  {
    id: "wave18-engine-runtime-failure-gate",
    script: "wave18-engine-runtime-failure-gate.mjs",
    command: "pnpm --dir benchmarks bench:enginefailures",
    description: "Wave 18 engine runtime failure wrapping gate.",
    kind: "gate",
    required: true,
  },
  {
    id: "wave19-runtime-closure-gate",
    script: "wave19-runtime-closure-gate.mjs",
    command: "pnpm --dir benchmarks bench:runtimeclosure",
    description: "Wave 19 runtime closure coverage for memory degrade -> provider failure.",
    kind: "gate",
    required: true,
  },
  {
    id: "wave20-pre-model-boundary-gate",
    script: "wave20-pre-model-boundary-gate.mjs",
    command: "pnpm --dir benchmarks bench:premodelboundary",
    description: "Wave 20 pre-model boundary gate.",
    kind: "gate",
    required: true,
  },
  {
    id: "wave21-streaming-boundary-gate",
    script: "wave21-streaming-boundary-gate.mjs",
    command: "pnpm --dir benchmarks bench:streamingboundary",
    description: "Wave 21 streaming boundary gate.",
    kind: "gate",
    required: true,
  },
  {
    id: "wave22-mempalace-boundary-gate",
    script: "wave22-mempalace-boundary-gate.mjs",
    command: "pnpm --dir benchmarks bench:mempalaceboundary",
    description: "Wave 22 mempalace/doctor boundary gate.",
    kind: "gate",
    required: true,
  },
  {
    id: "wave23a-operator-surface-gate",
    script: "wave23a-operator-surface-gate.mjs",
    command: "pnpm --dir benchmarks bench:wave23a",
    description: "Wave 23a operator/control-plane surface gate.",
    kind: "gate",
    required: true,
  },
  {
    id: "wave23b-onboarding-gate",
    script: "wave23b-onboarding-gate.mjs",
    command: "pnpm --dir benchmarks bench:wave23b",
    description: "Wave 23b onboarding gate.",
    kind: "gate",
    required: true,
  },
  {
    id: "wave25-learning-input-gate",
    script: "wave25-learning-input-gate.mjs",
    command: "pnpm --dir benchmarks bench:wave25",
    description: "Wave 25 learning input / digest boundary gate.",
    kind: "gate",
    required: true,
  },
  {
    id: "wave26-proposal-generator-gate",
    script: "wave26-proposal-generator-gate.mjs",
    command: "pnpm --dir benchmarks bench:wave26",
    description:
      "Wave 26 proposal generator, duplicate detection, and low-evidence degradation gate.",
    kind: "gate",
    required: true,
  },
  {
    id: "wave27-operator-surface-gate",
    script: "wave27-operator-surface-gate.mjs",
    command: "pnpm --dir benchmarks bench:wave27",
    description:
      "Wave 27 operator surface smoke gate for proposal lifecycle actions, control-plane audit evidence, and learning lane doctor checks.",
    kind: "gate",
    required: true,
  },
  {
    id: "wave28-safe-apply-gate",
    script: "wave28-safe-apply-gate.mjs",
    command: "pnpm --dir benchmarks bench:wave28",
    description:
      "Wave 28 safe apply gate for preview, apply, reload-only visibility, rollback, and audit evidence.",
    kind: "gate",
    required: true,
  },
  {
    id: "wave29-phase4-golden-path-gate",
    script: "wave29-phase4-golden-path-gate.mjs",
    command: "pnpm --dir benchmarks bench:wave29",
    description:
      "Wave 29 Phase 4 golden path gate for committed trajectory, worker proposal, operator review, safe apply, and reload visibility.",
    kind: "gate",
    required: true,
  },
  {
    id: "wave42-tool-journal-closure-gate",
    script: "wave42-tool-journal-closure-gate.mjs",
    command: "pnpm --dir benchmarks bench:wave42",
    description:
      "Wave 42 tool journal closure gate for planned/result journal ownership staying inside the tool runtime seam.",
    kind: "gate",
    required: true,
  },
  {
    id: "wave43-tool-parallel-dispatch-boundary-gate",
    script: "wave43-tool-parallel-dispatch-boundary-gate.mjs",
    command: "pnpm --dir benchmarks bench:wave43",
    description:
      "Wave 43 tool parallel dispatch boundary gate for contiguous read-only batching with write barriers and stable merge semantics.",
    kind: "gate",
    required: true,
  },
  {
    id: "wave44-tool-schema-surface-gate",
    script: "wave44-tool-schema-surface-gate.mjs",
    command: "pnpm --dir benchmarks bench:wave44",
    description:
      "Wave 44 tool schema surface gate for toolset catalog visibility, env-gated hiding, and stable input schema exposure.",
    kind: "gate",
    required: true,
  },
  {
    id: "wave45-tool-schema-request-boundary-gate",
    script: "wave45-tool-schema-request-boundary-gate.mjs",
    command: "pnpm --dir benchmarks bench:wave45",
    description:
      "Wave 45 tool schema request boundary gate for engine-visible tool schemas flowing into model requests and OpenAI-compatible provider request bodies.",
    kind: "gate",
    required: true,
  },
  {
    id: "wave46-tool-result-message-boundary-gate",
    script: "wave46-tool-result-message-boundary-gate.mjs",
    command: "pnpm --dir benchmarks bench:wave46",
    description:
      "Wave 46 tool result message boundary gate for structured assistant/tool continuation messages flowing from engine state into OpenAI-compatible request bodies.",
    kind: "gate",
    required: true,
  },
  {
    id: "wave47-tool-result-budget-boundary-gate",
    script: "wave47-tool-result-budget-boundary-gate.mjs",
    command: "pnpm --dir benchmarks bench:wave47",
    description:
      "Wave 47 tool result replay budget boundary gate for oversized continuation payloads.",
    kind: "gate",
    required: true,
  },
  {
    id: "wave48-tool-result-replay-degradation-gate",
    script: "wave48-tool-result-replay-degradation-gate.mjs",
    command: "pnpm --dir benchmarks bench:wave48",
    description:
      "Wave 48 tool result replay degradation gate for runtime-visible truncation surfaces and next-step guidance.",
    kind: "gate",
    required: true,
  },
  {
    id: "wave49-replay-degradation-operator-summary-gate",
    script: "wave49-replay-degradation-operator-summary-gate.mjs",
    command: "pnpm --dir benchmarks bench:wave49",
    description:
      "Wave 49 operator summary surface for replay context-pressure degradation in prompt-explain and status.",
    kind: "gate",
    required: true,
  },
  {
    id: "wave50-replay-degradation-detail-surface-gate",
    script: "wave50-replay-degradation-detail-surface-gate.mjs",
    command: "pnpm --dir benchmarks bench:wave50",
    description:
      "Wave 50 prompt-inspect and prompt-explain detail surfaces preserve replay degradation metadata.",
    kind: "gate",
    required: true,
  },
  {
    id: "wave51-replay-degradation-prompt-fidelity-gate",
    script: "wave51-replay-degradation-prompt-fidelity-gate.mjs",
    command: "pnpm --dir benchmarks bench:wave51",
    description:
      "Wave 51 runtime.degradations prompt section preserves replay metadata and model guidance for trimmed tool replay.",
    kind: "gate",
    required: true,
  },
  {
    id: "wave52-tool-runtime-guidance-detail-surface-gate",
    script: "wave52-tool-runtime-guidance-detail-surface-gate.mjs",
    command: "pnpm --dir benchmarks bench:wave52",
    description:
      "Wave 52 prompt-inspect, prompt-explain, and status preserve safe tool runtime detail previews for impacted tools.",
    kind: "gate",
    required: true,
  },
  {
    id: "wave53-tool-runtime-guidance-metadata-surface-gate",
    script: "wave53-tool-runtime-guidance-metadata-surface-gate.mjs",
    command: "pnpm --dir benchmarks bench:wave53",
    description:
      "Wave 53 prompt-inspect, prompt-explain, and status preserve safe structured metadata previews for impacted tool runtime guidance.",
    kind: "gate",
    required: true,
  },
  {
    id: "wave54-latest-turn-tool-runtime-guidance-fallback-gate",
    script: "wave54-latest-turn-tool-runtime-guidance-fallback-gate.mjs",
    command: "pnpm --dir benchmarks bench:wave54",
    description:
      "Wave 54 status preserves persisted latest-turn tool runtime guidance when step replay is unavailable.",
    kind: "gate",
    required: true,
  },
  {
    id: "wave55-latest-turn-prompt-degradation-fallback-gate",
    script: "wave55-latest-turn-prompt-degradation-fallback-gate.mjs",
    command: "pnpm --dir benchmarks bench:wave55",
    description:
      "Wave 55 status preserves persisted latest-turn prompt degradation summaries when step replay is unavailable.",
    kind: "gate",
    required: true,
  },
  {
    id: "wave56-latest-turn-resume-continuity-fallback-gate",
    script: "wave56-latest-turn-resume-continuity-fallback-gate.mjs",
    command: "pnpm --dir benchmarks bench:wave56",
    description:
      "Wave 56 status preserves persisted latest-turn resume continuity guidance when step replay is unavailable.",
    kind: "gate",
    required: true,
  },
  {
    id: "wave57-latest-turn-runtime-state-fallback-gate",
    script: "wave57-latest-turn-runtime-state-fallback-gate.mjs",
    command: "pnpm --dir benchmarks bench:wave57",
    description:
      "Wave 57 status preserves persisted latest-turn runtime state when prompt replay guidance is unavailable.",
    kind: "gate",
    required: true,
  },
  {
    id: "wave58-latest-turn-finish-state-fallback-gate",
    script: "wave58-latest-turn-finish-state-fallback-gate.mjs",
    command: "pnpm --dir benchmarks bench:wave58",
    description:
      "Wave 58 status preserves persisted latest-turn finish state when prompt replay guidance is unavailable.",
    kind: "gate",
    required: true,
  },
  {
    id: "wave59-latest-turn-tool-outcome-fallback-gate",
    script: "wave59-latest-turn-tool-outcome-fallback-gate.mjs",
    command: "pnpm --dir benchmarks bench:wave59",
    description:
      "Wave 59 status preserves persisted latest-turn tool count and tool outcomes when prompt replay guidance is unavailable.",
    kind: "gate",
    required: true,
  },
  {
    id: "wave60-session-guidance-control-closure-gate",
    script: "wave60-session-guidance-control-closure-gate.mjs",
    command: "pnpm --dir benchmarks bench:wave60",
    description:
      "Wave 60 control output-style and permissions actions persist journal evidence and status re-surfaces current session guidance without prompt replay.",
    kind: "gate",
    required: true,
  },
  {
    id: "wave61-memory-control-closure-gate",
    script: "wave61-memory-control-closure-gate.mjs",
    command: "pnpm --dir benchmarks bench:wave61",
    description:
      "Wave 61 memory inspect and clear actions persist journal evidence, preserve before/after counts, and keep operator-visible closure bounded to the existing control family.",
    kind: "gate",
    required: true,
  },
  {
    id: "wave62-status-memory-summary-surface-gate",
    script: "wave62-status-memory-summary-surface-gate.mjs",
    command: "pnpm --dir benchmarks bench:wave62",
    description:
      "Wave 62 status re-surfaces current working and episodic memory counts so the operator can observe the session memory face without leaving the existing status/control family.",
    kind: "gate",
    required: true,
  },
  {
    id: "wave63-status-latest-memory-control-summary-gate",
    script: "wave63-status-latest-memory-control-summary-gate.mjs",
    command: "pnpm --dir benchmarks bench:wave63",
    description:
      "Wave 63 status re-surfaces the latest memory control action summary so the operator can see the most recent inspect/clear decision without opening a separate memory browser.",
    kind: "gate",
    required: true,
  },
  {
    id: "wave64-status-memory-control-journal-surface-gate",
    script: "wave64-status-memory-control-journal-surface-gate.mjs",
    command: "pnpm --dir benchmarks bench:wave64",
    description:
      "Wave 64 status re-surfaces the latest memory control journal seq and occurredAtMs so the operator can see when the most recent inspect/clear decision happened without opening the session journal.",
    kind: "gate",
    required: true,
  },
  {
    id: "wave65-director-runtime-prompt-registry-gate",
    script: "wave65-director-runtime-prompt-registry-gate.mjs",
    command: "pnpm --dir benchmarks bench:wave65",
    description:
      "Wave 65 re-anchors the runtime prompt registry to Director Angel so the default static prompt identity, director role, and worker-only execution boundary are locked into the bootstrap surface.",
    kind: "gate",
    required: true,
  },
  {
    id: "wave66-session-language-policy-control-closure-gate",
    script: "wave66-session-language-policy-control-closure-gate.mjs",
    command: "pnpm --dir benchmarks bench:wave66",
    description:
      "Wave 66 closes the session-level response language control seam so responseLanguage flows through context, control-plane, CLI status, journal, and persisted session guidance without opening a new runtime family.",
    kind: "gate",
    required: true,
  },
  {
    id: "wave67-runtime-response-language-default-surface-gate",
    script: "wave67-runtime-response-language-default-surface-gate.mjs",
    command: "pnpm --dir benchmarks bench:wave67",
    description:
      "Wave 67 surfaces the runtime default response language through config, named static guidance, onboard, and preflight so the operator can see the default language policy before any session override is applied.",
    kind: "gate",
    required: true,
  },
  {
    id: "wave68-effective-guidance-status-surface-gate",
    script: "wave68-effective-guidance-status-surface-gate.mjs",
    command: "pnpm --dir benchmarks bench:wave68",
    description:
      "Wave 68 surfaces the currently effective guidance across status and prompt-explain by merging runtime defaults with session overrides without opening a new guidance family.",
    kind: "gate",
    required: true,
  },
  {
    id: "wave69-effective-guidance-control-surface-gate",
    script: "wave69-effective-guidance-control-surface-gate.mjs",
    command: "pnpm --dir benchmarks bench:wave69",
    description:
      "Wave 69 surfaces the currently effective guidance directly in output-style, permissions, and language control actions so operators can see the merged runtime outcome immediately after changing guidance.",
    kind: "gate",
    required: true,
  },
  {
    id: "wave70-status-latest-guidance-control-summary-gate",
    script: "wave70-status-latest-guidance-control-summary-gate.mjs",
    command: "pnpm --dir benchmarks bench:wave70",
    description:
      "Wave 70 surfaces the latest guidance control action in status so operators can see which output-style, permission-mode, or response-language change happened most recently without reopening the control flow.",
    kind: "gate",
    required: true,
  },
  {
    id: "wave71-status-guidance-control-journal-surface-gate",
    script: "wave71-status-guidance-control-journal-surface-gate.mjs",
    command: "pnpm --dir benchmarks bench:wave71",
    description:
      "Wave 71 surfaces the journal seq and occurredAt provenance of the latest guidance control in status so operators can trace when the most recent output-style, permission-mode, or response-language change was written.",
    kind: "gate",
    required: true,
  },
  {
    id: "wave72-session-guidance-named-dynamic-sections-gate",
    script: "wave72-session-guidance-named-dynamic-sections-gate.mjs",
    command: "pnpm --dir benchmarks bench:wave72",
    description:
      "Wave 72 closes session guidance into named runtime seams so prompt-inspect, prompt-explain, and status can trace output-style, permission-mode, and response-language as distinct dynamic sections.",
    kind: "gate",
    required: true,
  },
  {
    id: "wave73-effective-guidance-source-surface-gate",
    script: "wave73-effective-guidance-source-surface-gate.mjs",
    command: "pnpm --dir benchmarks bench:wave73",
    description:
      "Wave 73 surfaces the source of each effective guidance field across status and prompt-explain so operators can tell whether output-style, permission-mode, and response-language came from runtime defaults or session overrides.",
    kind: "gate",
    required: true,
  },
  {
    id: "wave74-effective-guidance-source-control-surface-gate",
    script: "wave74-effective-guidance-source-control-surface-gate.mjs",
    command: "pnpm --dir benchmarks bench:wave74",
    description:
      "Wave 74 surfaces effective guidance field sources directly in output-style, permissions, and language control actions so operators can see whether each merged field came from runtime defaults or session overrides immediately after a change.",
    kind: "gate",
    required: true,
  },
  {
    id: "wave75-prompt-inspect-guidance-source-metadata-gate",
    script: "wave75-prompt-inspect-guidance-source-metadata-gate.mjs",
    command: "pnpm --dir benchmarks bench:wave75",
    description:
      "Wave 75 closes the raw prompt-inspect evidence seam so named session guidance sections carry source=session-override metadata from context generation through CLI inspection.",
    kind: "gate",
    required: true,
  },
  {
    id: "wave76-prompt-inspect-guidance-summary-surface-gate",
    script: "wave76-prompt-inspect-guidance-summary-surface-gate.mjs",
    command: "pnpm --dir benchmarks bench:wave76",
    description:
      "Wave 76 surfaces effective guidance, guidance sources, and session guidance directly in prompt-inspect so operators can read the merged runtime policy before parsing raw prompt sections.",
    kind: "gate",
    required: true,
  },
  {
    id: "wave77-prompt-inspect-runtime-default-guidance-source-metadata-gate",
    script: "wave77-prompt-inspect-runtime-default-guidance-source-metadata-gate.mjs",
    command: "pnpm --dir benchmarks bench:wave77",
    description:
      "Wave 77 closes prompt-inspect provenance symmetry by attaching runtime-default source metadata to named static guidance sections while keeping system.runtime as a shell-only section.",
    kind: "gate",
    required: true,
  },
  {
    id: "wave78-runtime-default-guidance-named-static-sections-gate",
    script: "wave78-runtime-default-guidance-named-static-sections-gate.mjs",
    command: "pnpm --dir benchmarks bench:wave78",
    description:
      "Wave 78 continues the Cycle 1 prompt registry cleanup by turning runtime-default permission-mode and response-language into named static sections while preserving existing runtime summary surfaces.",
    kind: "gate",
    required: true,
  },
  {
    id: "wave79-static-guidance-operator-surface-gate",
    script: "wave79-static-guidance-operator-surface-gate.mjs",
    command: "pnpm --dir benchmarks bench:wave79",
    description:
      "Wave 79 exposes named runtime-default static guidance sections directly in prompt-explain and status so operators can read default output-style, permission-mode, and response-language without parsing raw prompt-inspect lines.",
    kind: "gate",
    required: true,
  },
  {
    id: "wave80-runtime-shell-guidance-dedup-gate",
    script: "wave80-runtime-shell-guidance-dedup-gate.mjs",
    command: "pnpm --dir benchmarks bench:wave80",
    description:
      "Wave 80 finishes the runtime shell cleanup by removing duplicated permission-mode and response-language guidance from system.runtime while preserving named static guidance sections and operator-visible summaries.",
    kind: "gate",
    required: true,
  },
  {
    id: "wave81-prompt-evidence-effective-guidance-alignment-gate",
    script: "wave81-prompt-evidence-effective-guidance-alignment-gate.mjs",
    command: "pnpm --dir benchmarks bench:wave81",
    description:
      "Wave 81 aligns prompt-inspect, prompt-explain, and status prompt summaries around stored prompt evidence so historical effective guidance remains anchored to the prompt build instead of being overwritten by current runtime config.",
    kind: "gate",
    required: true,
  },
  {
    id: "wave82-runtime-shell-operator-surface-alignment-gate",
    script: "wave82-runtime-shell-operator-surface-alignment-gate.mjs",
    command: "pnpm --dir benchmarks bench:wave82",
    description:
      "Wave 82 aligns prompt-explain and status prompt summaries with the shell-only system.runtime section so operators can read the runtime shell directly without reloading guidance semantics into that section.",
    kind: "gate",
    required: true,
  },
  {
    id: "wave83-prompt-inspect-static-runtime-summary-surface-gate",
    script: "wave83-prompt-inspect-static-runtime-summary-surface-gate.mjs",
    command: "pnpm --dir benchmarks bench:wave83",
    description:
      "Wave 83 lifts runtime shell and named static guidance into the prompt-inspect summary layer so operators can read static runtime conclusions before drilling into raw static section evidence.",
    kind: "gate",
    required: true,
  },
  {
    id: "wave84-prompt-inspect-dynamic-runtime-summary-surface-gate",
    script: "wave84-prompt-inspect-dynamic-runtime-summary-surface-gate.mjs",
    command: "pnpm --dir benchmarks bench:wave84",
    description:
      "Wave 84 lifts tool runtime, turn resume, latest turn, and prompt degradation summaries into the prompt-inspect summary layer so operators can read dynamic runtime conclusions before drilling into raw dynamic section evidence.",
    kind: "gate",
    required: true,
  },
  {
    id: "wave85-prompt-inspect-focus-omission-summary-surface-gate",
    script: "wave85-prompt-inspect-focus-omission-summary-surface-gate.mjs",
    command: "pnpm --dir benchmarks bench:wave85",
    description:
      "Wave 85 lifts prompt focus and omission summaries into the prompt-inspect summary layer so operators can read the overall active and omitted section set before drilling into raw prompt evidence.",
    kind: "gate",
    required: true,
  },
  {
    id: "wave86-prompt-inspect-change-summary-surface-gate",
    script: "wave86-prompt-inspect-change-summary-surface-gate.mjs",
    command: "pnpm --dir benchmarks bench:wave86",
    description:
      "Wave 86 lifts previous-step prompt diff summaries into the prompt-inspect summary layer so operators can read what changed between prompt builds before drilling into raw evidence.",
    kind: "gate",
    required: true,
  },
  {
    id: "wave87-status-prompt-change-summary-closure-gate",
    script: "wave87-status-prompt-change-summary-closure-gate.mjs",
    command: "pnpm --dir benchmarks bench:wave87",
    description:
      "Wave 87 closes the remaining status prompt-change summary gap so operator-facing Prompt changes lines keep both dynamic add/remove evidence and omission/restore evidence in one compact summary.",
    kind: "gate",
    required: true,
  },
  {
    id: "wave88-prompt-explain-summary-vocabulary-alignment-gate",
    script: "wave88-prompt-explain-summary-vocabulary-alignment-gate.mjs",
    command: "pnpm --dir benchmarks bench:wave88",
    description:
      "Wave 88 aligns prompt-explain with the same Prompt tokens, Prompt focus, Prompt omissions, and Runtime degradations vocabulary already used by prompt-inspect and status.",
    kind: "gate",
    required: true,
  },
  {
    id: "wave89-status-first-build-wording-alignment-gate",
    script: "wave89-status-first-build-wording-alignment-gate.mjs",
    command: "pnpm --dir benchmarks bench:wave89",
    description:
      "Wave 89 aligns status first-build wording with the same first prompt build in the turn phrasing already used by prompt-inspect and prompt-explain.",
    kind: "gate",
    required: true,
  },
  {
    id: "wave90-prompt-inspect-runtime-degradations-none-surface-gate",
    script: "wave90-prompt-inspect-runtime-degradations-none-surface-gate.mjs",
    command: "pnpm --dir benchmarks bench:wave90",
    description:
      "Wave 90 makes prompt-inspect explicitly surface Runtime degradations: (none) when the selected prompt build has no raw runtime degradations.",
    kind: "gate",
    required: true,
  },
  {
    id: "wave91-prompt-inspect-explain-prompt-degradations-none-surface-gate",
    script: "wave91-prompt-inspect-explain-prompt-degradations-none-surface-gate.mjs",
    command: "pnpm --dir benchmarks bench:wave91",
    description:
      "Wave 91 makes prompt-inspect and prompt-explain explicitly surface Prompt degradations: (none) when the selected prompt build has no prompt degradation summary and no raw runtime degradations.",
    kind: "gate",
    required: true,
  },
  {
    id: "wave92-status-prompt-degradations-none-surface-gate",
    script: "wave92-status-prompt-degradations-none-surface-gate.mjs",
    command: "pnpm --dir benchmarks bench:wave92",
    description:
      "Wave 92 makes status explicitly surface Prompt degradations: (none) when the selected step prompt summary has no prompt degradations, while keeping latest-turn prompt degradation fallback only for no-step-summary shells.",
    kind: "gate",
    required: true,
  },
  {
    id: "wave93-status-tool-runtime-guidance-precedence-gate",
    script: "wave93-status-tool-runtime-guidance-precedence-gate.mjs",
    command: "pnpm --dir benchmarks bench:wave93",
    description:
      "Wave 93 makes status prefer exact step prompt summary evidence over latest-turn tool runtime guidance fallback when the selected prompt build has no runtime.tool-status section.",
    kind: "gate",
    required: true,
  },
  {
    id: "director-beta1-golden-path-gate",
    script: "director-beta1-golden-path-gate.mjs",
    command: "pnpm --dir benchmarks bench:directorbeta1",
    description:
      "Director Angel Beta-1 control-kernel golden path gate for runtime, clarification, blueprint handoff, outcome capture, and observation visibility.",
    kind: "gate",
    required: true,
  },
  {
    id: "director-beta2-golden-path-gate",
    script: "director-beta2-golden-path-gate.mjs",
    command: "pnpm --dir benchmarks bench:directorbeta2",
    description:
      "Director Angel Beta-2 execution-lane golden path gate for reviewed blueprint materialization, operator run control, mock worker completion, and run-report evidence.",
    kind: "gate",
    required: true,
  },
  {
    id: "director-beta3-memory-golden-path-gate",
    script: "director-beta3-memory-golden-path-gate.mjs",
    command: "pnpm --dir benchmarks bench:directorbeta3",
    description:
      "Director Angel Beta-3 memory-lane golden path gate for terminal-run ingest, recall preview, doctor visibility, disabled semantics, and degrade-safe evaluation.",
    kind: "gate",
    required: true,
  },
  {
    id: "director-beta4-trace-to-proposal-gate",
    script: "director-beta4-trace-to-proposal-gate.mjs",
    command: "pnpm --dir benchmarks bench:directorbeta4",
    description:
      "Director Angel Beta-4 trace-to-proposal gate for terminal-run ingest, proposal materialization, and status visibility.",
    kind: "gate",
    required: true,
  },
  {
    id: "director-beta5-published-knowledge-recall-gate",
    script: "director-beta5-published-knowledge-recall-gate.mjs",
    command: "pnpm --dir benchmarks bench:directorbeta5",
    description:
      "Director Angel Beta-5 published knowledge recall gate for accepted proposal publish, bounded recall preview, doctor visibility, and recall-aware planning.",
    kind: "gate",
    required: true,
  },
  {
    id: "director-beta6-controlled-knowledge-evolution-gate",
    script: "director-beta6-controlled-knowledge-evolution-gate.mjs",
    command: "pnpm --dir benchmarks bench:directorbeta6",
    description:
      "Director Angel Beta-6 controlled knowledge evolution gate for candidate sync, publish history, recall, and rollback verification.",
    kind: "gate",
    required: true,
  },
  {
    id: "director-beta7-wave1-adapter-registry-gate",
    script: "director-beta7-wave1-adapter-registry-gate.mjs",
    command: "pnpm --dir benchmarks bench:directorbeta7wave1",
    description:
      "Director Angel Beta-7 Wave 1 adapter registry gate for persisted register, switch disable, and bootstrap reflection.",
    kind: "gate",
    required: true,
  },
  {
    id: "director-beta7-wave2-real-adapter-bridge-gate",
    script: "director-beta7-wave2-real-adapter-bridge-gate.mjs",
    command: "pnpm --dir benchmarks bench:directorbeta7wave2",
    description:
      "Director Angel Beta-7 Wave 2 gate for safe bridge visibility, worker-side http-json execution, and report-to-memory closure.",
    kind: "gate",
    required: true,
  },
  {
    id: "director-beta8-single-vertical-gate",
    script: "director-beta8-single-vertical-gate.mjs",
    command: "pnpm --dir benchmarks bench:directorbeta8",
    description:
      "Director Angel Beta-8 single-vertical closure gate for snapshot-to-blueprint flow, worker bridge submission, operator-readable report output, and success/failure memory closure.",
    kind: "gate",
    required: true,
  },
  {
    id: "director-phase-p1-platform-entry-gate",
    script: "director-phase-p1-platform-entry-gate.mjs",
    command: "pnpm --dir benchmarks bench:director-platform-entry",
    description:
      "Director Angel Phase P1 platform-entry gate for raw entry golden path, clarification hold, and terminal failure/retry guard visibility.",
    kind: "gate",
    required: true,
  },
  {
    id: "director-phase-p2-wave1-real-execution-adapter-handoff-gate",
    script: "director-phase-p2-wave1-real-execution-adapter-handoff-gate.mjs",
    command: "pnpm --dir benchmarks bench:director-phase-p2-wave1",
    description:
      "Director Angel Phase P2 Wave 1 gate for reviewed script-planner selection, worker-only real execution handoff, preview fallback, and report-to-memory closure.",
    kind: "gate",
    required: true,
  },
  {
    id: "director-phase-p2-wave2-dual-execution-chain-gate",
    script: "director-phase-p2-wave2-dual-execution-chain-gate.mjs",
    command: "pnpm --dir benchmarks bench:director-phase-p2-wave2",
    description:
      "Director Angel Phase P2 Wave 2 gate for script-planner -> shot-planner dual execution handoff, worker-only real bridge, preview fallback, and report-to-memory closure.",
    kind: "gate",
    required: true,
  },
  {
    id: "director-phase-p2-wave3-retryable-bridge-failure-gate",
    script: "director-phase-p2-wave3-retryable-bridge-failure-gate.mjs",
    command: "pnpm --dir benchmarks bench:director-phase-p2-wave3",
    description:
      "Director Angel Phase P2 Wave 3 gate for shot-planner retryable bridge failure, operator-visible retry guidance, assignment-scoped retry, and recovery back to completed.",
    kind: "gate",
    required: true,
  },
  {
    id: "director-phase-p2-wave4-non-retryable-bridge-failure-gate",
    script: "director-phase-p2-wave4-non-retryable-bridge-failure-gate.mjs",
    command: "pnpm --dir benchmarks bench:director-phase-p2-wave4",
    description:
      "Director Angel Phase P2 Wave 4 gate for invalid-response and HTTP 4xx non-retryable bridge failures, retry rejection, and 5xx retryable control coverage.",
    kind: "gate",
    required: true,
  },
  {
    id: "director-phase-p2-wave5-retry-policy-boundary-gate",
    script: "director-phase-p2-wave5-retry-policy-boundary-gate.mjs",
    command: "pnpm --dir benchmarks bench:director-phase-p2-wave5",
    description:
      "Director Angel Phase P2 Wave 5 gate for bounded manual retry budget, retry-budget exhaustion guidance, and second-retry rejection across service, worker host-api, and CLI surfaces.",
    kind: "gate",
    required: true,
  },
  {
    id: "director-phase-p2-wave6-failover-boundary-gate",
    script: "director-phase-p2-wave6-failover-boundary-gate.mjs",
    command: "pnpm --dir benchmarks bench:director-phase-p2-wave6",
    description:
      "Director Angel Phase P2 Wave 6 gate for operator-controlled reroute, per-route retry reset, and approved-adapter failover guidance across contracts, service, worker host-api, and CLI surfaces.",
    kind: "gate",
    required: true,
  },
  {
    id: "director-phase-p2-wave7-route-recovery-audit-closure-gate",
    script: "director-phase-p2-wave7-route-recovery-audit-closure-gate.mjs",
    command: "pnpm --dir benchmarks bench:director-phase-p2-wave7",
    description:
      "Director Angel Phase P2 Wave 7 gate for structured route recovery event evidence, operator-facing audit closure, and acceptance coverage across execution service and CLI surfaces.",
    kind: "gate",
    required: true,
  },
  {
    id: "director-phase-p2-wave8-chain-route-health-snapshot-gate",
    script: "director-phase-p2-wave8-chain-route-health-snapshot-gate.mjs",
    command: "pnpm --dir benchmarks bench:director-phase-p2-wave8",
    description:
      "Director Angel Phase P2 Wave 8 gate for chain-wide route health snapshot visibility across director status, run explain, and acceptance surfaces.",
    kind: "gate",
    required: true,
  },
  {
    id: "director-phase-p2-wave9-chain-route-doctor-visibility-gate",
    script: "director-phase-p2-wave9-chain-route-doctor-visibility-gate.mjs",
    command: "pnpm --dir benchmarks bench:director-phase-p2-wave9",
    description:
      "Director Angel Phase P2 Wave 9 gate for chain route doctor visibility across director doctor classification, CLI rendering, and acceptance surfaces.",
    kind: "gate",
    required: true,
  },
  {
    id: "director-phase-p2-wave10-worker-once-operator-entry-gate",
    script: "director-phase-p2-wave10-worker-once-operator-entry-gate.mjs",
    command: "pnpm --dir benchmarks bench:director-phase-p2-wave10",
    description:
      "Director Angel Phase P2 Wave 10 gate for main-CLI worker-once operator entry, local run execution, and acceptance-surface evidence.",
    kind: "gate",
    required: true,
  },
  {
    id: "director-phase-p2-wave11-run-once-preflight-guidance-gate",
    script: "director-phase-p2-wave11-run-once-preflight-guidance-gate.mjs",
    command: "pnpm --dir benchmarks bench:director-phase-p2-wave11",
    description:
      "Director Angel Phase P2 Wave 11 gate for onboarding and preflight surfacing the bounded run-once command when the latest execution chain is healthy and has ready work.",
    kind: "gate",
    required: true,
  },
  {
    id: "director-phase-p2-wave12-run-once-exit-surface-gate",
    script: "director-phase-p2-wave12-run-once-exit-surface-gate.mjs",
    command: "pnpm --dir benchmarks bench:director-phase-p2-wave12",
    description:
      "Director Angel Phase P2 Wave 12 gate for rendering operator-readable run-once exit status, follow-up guidance, and acceptance-surface evidence.",
    kind: "gate",
    required: true,
  },
  {
    id: "director-phase-p2-wave13-run-once-holding-state-taxonomy-gate",
    script: "director-phase-p2-wave13-run-once-holding-state-taxonomy-gate.mjs",
    command: "pnpm --dir benchmarks bench:director-phase-p2-wave13",
    description:
      "Director Angel Phase P2 Wave 13 gate for classifying created/paused holding states after run-once execution, while preserving worker-once and acceptance-surface evidence.",
    kind: "gate",
    required: true,
  },
  {
    id: "director-phase-p2-wave14-run-state-surface-alignment-gate",
    script: "director-phase-p2-wave14-run-state-surface-alignment-gate.mjs",
    command: "pnpm --dir benchmarks bench:director-phase-p2-wave14",
    description:
      "Director Angel Phase P2 Wave 14 gate for aligning run report and run explain with created/paused holding-state taxonomy, while preserving worker-once and acceptance-surface evidence.",
    kind: "gate",
    required: true,
  },
  {
    id: "director-phase-p2-wave15-run-state-visibility-closeout-gate",
    script: "director-phase-p2-wave15-run-state-visibility-closeout-gate.mjs",
    command: "pnpm --dir benchmarks bench:director-phase-p2-wave15",
    description:
      "Director Angel Phase P2 Wave 15 gate for closing director status and run audit onto the shared holding-state surface, while preserving acceptance coverage.",
    kind: "gate",
    required: true,
  },
  {
    id: "director-cycle-1-wave94-prompt-runtime-acceptance-closeout-gate",
    script: "director-cycle-1-wave94-prompt-runtime-acceptance-closeout-gate.mjs",
    command: "pnpm --dir benchmarks bench:director-cycle-1-wave94",
    description:
      "Director Angel Cycle 1 Wave 94 gate for folding prompt/runtime surface closeout artifacts into director acceptance and CLI acceptance output.",
    kind: "gate",
    required: true,
  },
  {
    id: "director-cycle-2-wave21-startup-reconciliation-gate",
    script: "director-cycle-2-wave21-startup-reconciliation-gate.mjs",
    command: "pnpm --dir benchmarks bench:director-cycle-2-wave21",
    description:
      "Director Angel Cycle 2 Wave 21 gate for reconciling orphaned running delegations at startup while preserving journaled recovery reason metadata.",
    kind: "gate",
    required: true,
  },
  {
    id: "director-cycle-2-wave22-delegation-record-completeness-gate",
    script: "director-cycle-2-wave22-delegation-record-completeness-gate.mjs",
    command: "pnpm --dir benchmarks bench:director-cycle-2-wave22",
    description:
      "Director Angel Cycle 2 Wave 22 gate for persisting delegation provenance, context snapshots, and completion summaries through tasks-core and worker-jobs.",
    kind: "gate",
    required: true,
  },
  {
    id: "director-cycle-2-wave23-verification-gate-completeness-gate",
    script: "director-cycle-2-wave23-verification-gate-completeness-gate.mjs",
    command: "pnpm --dir benchmarks bench:director-cycle-2-wave23",
    description:
      "Director Angel Cycle 2 Wave 23 gate for persisting structured verification verdicts, actors, checks, and partial outcomes through tasks-core and worker-jobs.",
    kind: "gate",
    required: true,
  },
  {
    id: "director-cycle-2-wave24-task-lifecycle-minimal-cut-gate",
    script: "director-cycle-2-wave24-task-lifecycle-minimal-cut-gate.mjs",
    command: "pnpm --dir benchmarks bench:director-cycle-2-wave24",
    description:
      "Director Angel Cycle 2 Wave 24 gate for deriving a formal task lifecycle surface from persisted todo, delegation, and verification state across replay, worker flows, and CLI task status.",
    kind: "gate",
    required: true,
  },
  {
    id: "director-cycle-2-wave25-task-notification-minimal-cut-gate",
    script: "director-cycle-2-wave25-task-notification-minimal-cut-gate.mjs",
    command: "pnpm --dir benchmarks bench:director-cycle-2-wave25",
    description:
      "Director Angel Cycle 2 Wave 25 gate for persisting minimal task notifications and exposing them coherently across replay, mailbox selectors, worker flows, and CLI task status.",
    kind: "gate",
    required: true,
  },
  {
    id: "director-cycle-2-wave26-worker-mailbox-snapshot-surface-gate",
    script: "director-cycle-2-wave26-worker-mailbox-snapshot-surface-gate.mjs",
    command: "pnpm --dir benchmarks bench:director-cycle-2-wave26",
    description:
      "Director Angel Cycle 2 Wave 26 gate for promoting worker mailbox into a formal shared snapshot surface across tasks-core, worker-jobs, control-plane, and the main CLI.",
    kind: "gate",
    required: true,
  },
  {
    id: "director-cycle-2-wave27-turn-reasoning-strategy-selection-surface-gate",
    script: "director-cycle-2-wave27-turn-reasoning-strategy-selection-surface-gate.mjs",
    command: "pnpm --dir benchmarks bench:director-cycle-2-wave27",
    description:
      "Director Angel Cycle 2 Wave 27 gate for turning reasoning strategy selection into a formal turn-start prompt, journal, and stream surface inside engine.",
    kind: "gate",
    required: true,
  },
  {
    id: "director-cycle-2-wave28-app-wiring-turn-reasoning-surface-gate",
    script: "director-cycle-2-wave28-app-wiring-turn-reasoning-surface-gate.mjs",
    command: "pnpm --dir benchmarks bench:director-cycle-2-wave28",
    description:
      "Director Angel Cycle 2 Wave 28 gate for wiring CLI and gateway turn surfaces into bounded reasoning defaults and metadata overrides without opening a new session-policy family.",
    kind: "gate",
    required: true,
  },
  {
    id: "director-cycle-2-wave29-latest-turn-reasoning-operator-surface-gate",
    script: "director-cycle-2-wave29-latest-turn-reasoning-operator-surface-gate.mjs",
    command: "pnpm --dir benchmarks bench:director-cycle-2-wave29",
    description:
      "Director Angel Cycle 2 Wave 29 gate for persisting latest-turn reasoning summaries and exposing them on status, prompt-inspect, and prompt-explain without opening a new reasoning policy family.",
    kind: "gate",
    required: true,
  },
  {
    id: "director-cycle-2-wave30-resume-reasoning-recovery-symmetry-gate",
    script: "director-cycle-2-wave30-resume-reasoning-recovery-symmetry-gate.mjs",
    command: "pnpm --dir benchmarks bench:director-cycle-2-wave30",
    description:
      "Director Angel Cycle 2 Wave 30 gate for making resume reasoning recovery symmetric across stream evidence, latest-turn fallback, and CLI operator surfaces without opening a new policy family.",
    kind: "gate",
    required: true,
  },
  {
    id: "director-cycle-2-wave31-app-surface-override-contract-clarity-gate",
    script: "director-cycle-2-wave31-app-surface-override-contract-clarity-gate.mjs",
    command: "pnpm --dir benchmarks bench:director-cycle-2-wave31",
    description:
      "Director Angel Cycle 2 Wave 31 gate for clarifying the app-surface reasoning override contract by making runtime-bootstrap surface resolution explicit and rejecting mixed gateway override shapes.",
    kind: "gate",
    required: true,
  },
  {
    id: "director-cycle-2-wave32-verifier-mailbox-snapshot-surface-gate",
    script: "director-cycle-2-wave32-verifier-mailbox-snapshot-surface-gate.mjs",
    command: "pnpm --dir benchmarks bench:director-cycle-2-wave32",
    description:
      "Director Angel Cycle 2 Wave 32 gate for giving verifier mailbox / verification queue the same shared snapshot, worker-jobs, control-plane, and CLI surface treatment already used by worker mailbox.",
    kind: "gate",
    required: true,
  },
  {
    id: "director-cycle-2-wave33-delegation-verification-handoff-contract-gate",
    script: "director-cycle-2-wave33-delegation-verification-handoff-contract-gate.mjs",
    command: "pnpm --dir benchmarks bench:director-cycle-2-wave33",
    description:
      "Director Angel Cycle 2 Wave 33 gate for making delegation records carry their own verification handoff contract across replay, worker mailbox, worker-jobs completion, control-plane, and CLI task surfaces.",
    kind: "gate",
    required: true,
  },
  {
    id: "director-cycle-2-wave34-delegation-specialization-seam-gate",
    script: "director-cycle-2-wave34-delegation-specialization-seam-gate.mjs",
    command: "pnpm --dir benchmarks bench:director-cycle-2-wave34",
    description:
      "Director Angel Cycle 2 Wave 34 gate for persisting delegation specialization and target-agent facts without changing workerId routing.",
    kind: "gate",
    required: true,
  },
  {
    id: "director-cycle-2-wave35-experience-source-adapter-gate",
    script: "director-cycle-2-wave35-experience-source-adapter-gate.mjs",
    command: "pnpm --dir benchmarks bench:director-cycle-2-wave35",
    description:
      "Director Angel Cycle 2 Wave 35 gate for review-gated experience source contracts and local reference repository adapter ingestion.",
    kind: "gate",
    required: true,
  },
  {
    id: "director-cycle-2-wave36-experience-review-store-gate",
    script: "director-cycle-2-wave36-experience-review-store-gate.mjs",
    command: "pnpm --dir benchmarks bench:director-cycle-2-wave36",
    description:
      "Director Angel Cycle 2 Wave 36 gate for file-backed experience candidate review, promotion, and rollback storage.",
    kind: "gate",
    required: true,
  },
  {
    id: "director-cycle-2-wave37-mock-production-platform-gate",
    script: "director-cycle-2-wave37-mock-production-platform-gate.mjs",
    command: "pnpm --dir benchmarks bench:director-cycle-2-wave37",
    description:
      "Director Angel Cycle 2 Wave 37 gate for a mock production platform vertical slice with dry-run traces, approval blocking, and retryable preview recovery.",
    kind: "gate",
    required: true,
  },
  {
    id: "director-cycle-2-wave38-self-learning-orchestrator-gate",
    script: "director-cycle-2-wave38-self-learning-orchestrator-gate.mjs",
    command: "pnpm --dir benchmarks bench:director-cycle-2-wave38",
    description:
      "Director Angel Cycle 2 Wave 38 gate for self-learning from user-provided local directories and selected web URLs into review-gated stored experience candidates.",
    kind: "gate",
    required: true,
  },
  {
    id: "director-cycle-2-wave39-web-search-learning-gate",
    script: "director-cycle-2-wave39-web-search-learning-gate.mjs",
    command: "pnpm --dir benchmarks bench:director-cycle-2-wave39",
    description:
      "Director Angel Cycle 2 Wave 39 gate for query-driven web search learning into review-gated stored experience candidates.",
    kind: "gate",
    required: true,
  },
  {
    id: "director-cycle-2-wave40-experience-promotion-recall-gate",
    script: "director-cycle-2-wave40-experience-promotion-recall-gate.mjs",
    command: "pnpm --dir benchmarks bench:director-cycle-2-wave40",
    description:
      "Director Angel Cycle 2 Wave 40 gate for promoting reviewed experience candidates into existing knowledge candidate, publish, and recall lifecycle.",
    kind: "gate",
    required: true,
  },
  {
    id: "director-cycle-2-wave41-global-experience-runtime-recall-gate",
    script: "director-cycle-2-wave41-global-experience-runtime-recall-gate.mjs",
    command: "pnpm --dir benchmarks bench:director-cycle-2-wave41",
    description:
      "Director Angel Cycle 2 Wave 41 gate for injecting published self-learning experience knowledge into Director runtime planning prompts.",
    kind: "gate",
    required: true,
  },
  {
    id: "director-cycle-2-wave42-memory-recall-quality-gate",
    script: "director-cycle-2-wave42-memory-recall-quality-gate.mjs",
    command: "pnpm --dir benchmarks bench:director-cycle-2-wave42",
    description:
      "Director Angel Cycle 2 Wave 42 gate for MemPalace-style recall quality metrics, provenance-aware trace evaluation, and missing expected ID diagnostics.",
    kind: "gate",
    required: true,
  },
  {
    id: "director-cycle-2-wave43-unified-conversation-tool-recall-gate",
    script: "director-cycle-2-wave43-unified-conversation-tool-recall-gate.mjs",
    command: "pnpm --dir benchmarks bench:director-cycle-2-wave43",
    description:
      "Director Angel Cycle 2 Wave 43 gate proving channel adapters, ordinary chat, source grounding, recall, and the model/tool loop stay on one unified runtime path.",
    kind: "gate",
    required: true,
  },
  {
    id: "director-cycle-2-wave44-real-entry-runtime-gate",
    script: "director-cycle-2-wave44-real-entry-runtime-gate.mjs",
    command: "pnpm --dir benchmarks bench:director-cycle-2-wave44",
    description:
      "Director Angel Cycle 2 Wave 44 gate for real desktop and Weixin entry paths proving unified runtime, source grounding tools, browser handoff, and no hardcoded reply regression.",
    kind: "gate",
    required: true,
  },
  {
    id: "director-cycle-2-wave45-mempalace-recall-benchmark-gate",
    script: "director-cycle-2-wave45-mempalace-recall-benchmark-gate.mjs",
    command: "pnpm --dir benchmarks bench:director-cycle-2-wave45",
    description:
      "Director Angel Cycle 2 Wave 45 gate for MemPalace adapter recall benchmark metrics, verbatim evidence, provenance, and missing expected ID diagnostics.",
    kind: "gate",
    required: true,
  },
  {
    id: "director-cycle-2-wave46-real-entry-eval-matrix-gate",
    script: "director-cycle-2-wave46-real-entry-eval-matrix-gate.mjs",
    command: "pnpm --dir benchmarks bench:director-cycle-2-wave46",
    description:
      "Director Angel Cycle 2 Wave 46 gate that systematizes desktop, Weixin, tool-use, learning, and recall evidence across Wave43/44/45 without replacing manual real-device smoke.",
    kind: "gate",
    required: true,
  },
  {
    id: "director-cycle-2-wave47-learning-governance-heartbeat-gate",
    script: "director-cycle-2-wave47-learning-governance-heartbeat-gate.mjs",
    command: "pnpm --dir benchmarks bench:director-cycle-2-wave47",
    description:
      "Director Angel Cycle 2 Wave 47 gate proving daily learning governance backlog and missing recall eval evidence surface through heartbeat maintenance-due.",
    kind: "gate",
    required: true,
  },
  {
    id: "director-cycle-2-wave48-memory-governance-ops-panel-gate",
    script: "director-cycle-2-wave48-memory-governance-ops-panel-gate.mjs",
    command: "pnpm --dir benchmarks bench:director-cycle-2-wave48",
    description:
      "Director Angel Cycle 2 Wave 48 gate proving heartbeat learning governance evidence reaches the desktop review ops panel with direct maintenance controls.",
    kind: "gate",
    required: true,
  },
  {
    id: "director-agent-os-kernel-contracts-gate",
    script: "director-phase-a-agent-os-kernel-contracts-gate.mjs",
    command: "pnpm --dir benchmarks bench:director-agent-os-kernel",
    description:
      "Director Angel Agent OS Phase A.0 gate proving turn envelopes, policy/sandbox projection, timeline append-only behavior, memory evidence, and subagent non-escalation contracts stay green.",
    kind: "gate",
    required: true,
  },
  {
    id: "director-agent-os-runtime-mapping-gate",
    script: "director-phase-a1-agent-os-runtime-mapping-gate.mjs",
    command: "pnpm --dir benchmarks bench:director-agent-os-runtime-mapping",
    description:
      "Director Angel Agent OS Phase A.1 gate proving existing channel transports, ConversationRuntime results, and session journal evidence project into Agent OS turn envelopes and append-only timelines.",
    kind: "gate",
    required: true,
  },
  {
    id: "director-agent-os-operator-surface-gate",
    script: "director-phase-a2-agent-os-operator-surface-gate.mjs",
    command: "pnpm --dir benchmarks bench:director-agent-os-operator-surface",
    description:
      "Director Angel Agent OS Phase A.2 gate proving projected Agent OS timeline summaries surface through CLI/operator status without new persistence.",
    kind: "gate",
    required: true,
  },
  {
    id: "director-agent-os-entry-projection-gate",
    script: "director-phase-a3-agent-os-entry-projection-gate.mjs",
    command: "pnpm --dir benchmarks bench:director-agent-os-entry-projection",
    description:
      "Director Angel Agent OS Phase A.3 gate proving Host API entry/session responses expose optional Agent OS projections through director-entry-contracts while staying read-only and non-voice.",
    kind: "gate",
    required: true,
  },
  {
    id: "director-agent-os-extension-matrix-gate",
    script: "director-phase-b-agent-os-extension-matrix-gate.mjs",
    command: "pnpm --dir benchmarks bench:director-agent-os-extension-matrix",
    description:
      "Director Angel Agent OS Phase B gate proving extension manifests project into the external tools runtime/control-plane matrix with health, capability, install, sandbox, and doctor evidence.",
    kind: "gate",
    required: true,
  },
  {
    id: "director-agent-os-media-understanding-runner-gate",
    script: "director-phase-b3-agent-os-media-understanding-runner-gate.mjs",
    command: "pnpm --dir benchmarks bench:director-agent-os-media-understanding",
    description:
      "Director Angel Agent OS Phase B.3 gate proving the built-in media-understanding provider runner invokes through the external tool queue, readonly sandbox admission, trace, and extension matrix projection.",
    kind: "gate",
    required: true,
  },
  {
    id: "director-agent-os-desktop-extension-control-plane-gate",
    script: "director-phase-b4-agent-os-desktop-extension-control-plane-gate.mjs",
    command: "pnpm --dir benchmarks bench:director-agent-os-desktop-extension-control-plane",
    description:
      "Director Angel Agent OS Phase B.4 gate proving desktop Tools/Settings expose the runtime extension matrix with health, capability, sandbox, source trust, and tool-id evidence.",
    kind: "gate",
    required: true,
  },
  {
    id: "director-agent-os-host-cli-extension-matrix-gate",
    script: "director-phase-b5-agent-os-host-cli-extension-matrix-gate.mjs",
    command: "pnpm --dir benchmarks bench:director-agent-os-host-cli-extension-matrix",
    description:
      "Director Angel Agent OS Phase B.5 gate proving Host API runtime snapshots and CLI operator output expose the extension matrix with contract guards intact.",
    kind: "gate",
    required: true,
  },
  {
    id: "director-agent-os-mempalace-real-eval-fixture-gate",
    script: "director-agent-os-mempalace-real-eval-fixture-gate.mjs",
    command: "pnpm --dir benchmarks bench:director-agent-os-mempalace-real-eval",
    description:
      "Director Angel Agent OS Phase G gate proving MemPalace recall evaluation can run from local real-eval style fixtures with verbatim/provenance evidence and threshold diagnostics.",
    kind: "gate",
    required: true,
  },
  {
    id: "director-phase-g2-agent-os-memory-eval-ops-gate",
    script: "director-phase-g2-agent-os-memory-eval-ops-gate.mjs",
    command: "pnpm --dir benchmarks bench:director-agent-os-memory-eval-ops",
    description:
      "Director Angel Agent OS Phase G.2 gate proving desktop Review/Ops surfaces the latest local MemPalace fixture eval status, thresholds, quality averages, and diagnostic failures without reading live user datasets.",
    kind: "gate",
    required: true,
  },
  {
    id: "director-phase-g3-agent-os-memory-sweep-safety-gate",
    script: "director-phase-g3-agent-os-memory-sweep-safety-gate.mjs",
    command: "pnpm --dir benchmarks bench:director-agent-os-memory-sweep-safety",
    description:
      "Director Angel Agent OS Phase G.3 gate proving future live MemPalace memory eval sweeps require operator approval, anonymization, retention, dry-run, read-only, and network-disabled safety preflight before any real user dataset can be touched.",
    kind: "gate",
    required: true,
  },
  {
    id: "director-phase-g4-agent-os-memory-sweep-safety-ops-gate",
    script: "director-phase-g4-agent-os-memory-sweep-safety-ops-gate.mjs",
    command: "pnpm --dir benchmarks bench:director-agent-os-memory-sweep-safety-ops",
    description:
      "Director Angel Agent OS Phase G.4 gate proving desktop Review/Ops surfaces live memory eval safety preflight blocked/ready plans without reading live user datasets.",
    kind: "gate",
    required: true,
  },
  {
    id: "director-phase-gnext-agent-os-memory-dataset-loader-anonymization-gate",
    script: "director-phase-gnext-agent-os-memory-dataset-loader-anonymization-gate.mjs",
    command: "pnpm --dir benchmarks bench:director-agent-os-memory-dataset-loader-anonymization",
    description:
      "Director Angel Agent OS G.next gate proving approved local public-benchmark memory dataset manifests become anonymized recall fixtures with no raw identifier leakage, no raw content storage, TTL, dry-run, read-only, and network-disabled constraints.",
    kind: "gate",
    required: true,
  },
  {
    id: "director-phase-gnext-agent-os-memory-eval-dashboard-maintenance-gate",
    script: "director-phase-gnext-agent-os-memory-eval-dashboard-maintenance-gate.mjs",
    command: "pnpm --dir benchmarks bench:director-agent-os-memory-eval-dashboard-maintenance",
    description:
      "Director Angel Agent OS G.next gate proving desktop Review/Ops surfaces a local-only memory eval dashboard with recall trend, dataset-loader safety state, and maintenance-due actions without reading live user datasets.",
    kind: "gate",
    required: true,
  },
  {
    id: "director-agent-os-sandbox-preflight-gate",
    script: "director-phase-c-agent-os-sandbox-preflight-gate.mjs",
    command: "pnpm --dir benchmarks bench:director-agent-os-sandbox-preflight",
    description:
      "Director Angel Agent OS Phase C gate proving approved mutating model-tool calls fail closed unless an Agent OS sandbox preflight allows execution.",
    kind: "gate",
    required: true,
  },
  {
    id: "director-agent-os-sandbox-runtime-gate",
    script: "director-phase-c-agent-os-sandbox-runtime-gate.mjs",
    command: "pnpm --dir benchmarks bench:director-agent-os-sandbox-runtime",
    description:
      "Director Angel Agent OS Phase C gate proving sandbox execution plans fail closed on denied preflight, disabled backends, cwd scope, and network escalation.",
    kind: "gate",
    required: true,
  },
  {
    id: "director-agent-os-non-voice-release-safety-gate",
    script: "director-phase-c27-agent-os-non-voice-release-safety-gate.mjs",
    command: "pnpm --dir benchmarks bench:director-agent-os-non-voice-release-safety",
    description:
      "Director Angel Agent OS Phase C.27 release safety gate proving active non-voice runtime source does not grow unreviewed process runners, open-url side doors, legacy prefix APIs, or premature TTS/STT runner work.",
    kind: "gate",
    required: true,
  },
  {
    id: "director-phase-cnext-agent-os-runner-scan-migration-batch-gate",
    script: "director-phase-cnext-agent-os-runner-scan-migration-batch-gate.mjs",
    command: "pnpm --dir benchmarks bench:director-agent-os-runner-scan-migration-batch",
    description:
      "Director Angel Agent OS C.next gate scanning active media/browser/Notebook runner surfaces for unreviewed OS process runners, Playwright/Chromium/ffmpeg/local media server drift, legacy prefix APIs, and missing sandbox/process-ledger evidence.",
    kind: "gate",
    required: true,
  },
  {
    id: "director-phase-browsernext-agent-os-notebook-browser-automation-hardening-gate",
    script: "director-phase-browsernext-agent-os-notebook-browser-automation-hardening-gate.mjs",
    command: "pnpm --dir benchmarks bench:director-agent-os-notebook-browser-automation-hardening",
    description:
      "Director Angel Agent OS Browser.next gate proving browser.desktop remains an Electron BrowserWindow runner, Notebook/browser providers require operator scope for credential/profile access, and unmanaged Playwright/Chromium/Puppeteer processes remain blocked.",
    kind: "gate",
    required: true,
  },
  {
    id: "director-phase-dnext-agent-os-channel-adapter-v2-template-gate",
    script: "director-phase-dnext-agent-os-channel-adapter-v2-template-gate.mjs",
    command: "pnpm --dir benchmarks bench:director-agent-os-channel-adapter-v2-template",
    description:
      "Director Angel Agent OS D.next gate proving a second non-desktop/non-weixin channel adapter v2 template binds to the shared runtime contract and forbids channel-specific tool side doors.",
    kind: "gate",
    required: true,
  },
  {
    id: "director-phase-uxnext-agent-os-provider-setup-guidance-gate",
    script: "director-phase-uxnext-agent-os-provider-setup-guidance-gate.mjs",
    command: "pnpm --dir benchmarks bench:director-agent-os-provider-setup-guidance",
    description:
      "Director Angel Agent OS UX.next gate proving desktop Settings/Tools surfaces external tool/provider setup guidance for needs-auth, install, reconnect, and last-known-good states without reading or displaying SecretRef/Keychain secret values.",
    kind: "gate",
    required: true,
  },
  {
    id: "director-phase-voicenext-agent-os-voice-runner-readiness-gate",
    script: "director-phase-voicenext-agent-os-voice-runner-readiness-gate.mjs",
    command: "pnpm --dir benchmarks bench:director-agent-os-voice-runner-readiness",
    description:
      "Director Angel Agent OS Voice.next gate proving speech-to-text and text-to-speech live runner readiness stays fail-closed until operator evidence exists.",
    kind: "gate",
    required: true,
  },
  {
    id: "director-phase-voicenext-agent-os-voice-evidence-manifest-validator-gate",
    script: "director-phase-voicenext-agent-os-voice-evidence-manifest-validator-gate.mjs",
    command: "pnpm --dir benchmarks bench:director-agent-os-voice-evidence-manifest-validator",
    description:
      "Director Angel Agent OS Voice.next gate proving speech-to-text and text-to-speech evidence manifests validate only in local dry-run mode.",
    kind: "gate",
    required: true,
  },
  {
    id: "director-phase-voicenext-agent-os-voice-provider-matrix-runner-admission-gate",
    script: "director-phase-voicenext-agent-os-voice-provider-matrix-runner-admission-gate.mjs",
    command: "pnpm --dir benchmarks bench:director-agent-os-voice-provider-matrix-runner-admission",
    description:
      "Director Angel Agent OS Voice.next gate proving STT/TTS provider matrix and runner admission stay fail-closed without credentials, network, audio devices, Whisper, provider SDKs, or live runners.",
    kind: "gate",
    required: true,
  },
  {
    id: "director-phase-voicenext-agent-os-voice-regression-safety-gate",
    script: "director-phase-voicenext-agent-os-voice-regression-safety-gate.mjs",
    command: "pnpm --dir benchmarks bench:director-agent-os-voice-regression-safety",
    description:
      "Director Angel Agent OS Voice.next regression gate proving STT, TTS, Whisper, realtime Talk, and multi-channel voice input stay fail-closed without microphone autostart, raw audio reads, provider credentials, naked local processes, autoplay, or channel-specific side doors.",
    kind: "gate",
    required: true,
  },
  {
    id: "director-agent-os-skill-evolution-gate",
    script: "director-phase-e-agent-os-skill-evolution-gate.mjs",
    command: "pnpm --dir benchmarks bench:director-agent-os-skill-evolution",
    description:
      "Director Angel Agent OS Phase E.1 gate proving accepted experience candidates are promoted through one shared Skill proposal bridge with provenance, privacy, model-invocation, operator-review, and entry-surface delegation invariants intact.",
    kind: "gate",
    required: true,
  },
  {
    id: "director-phase-enext-agent-os-skill-patch-editor-diff-confirmation-gate",
    script: "director-phase-enext-agent-os-skill-patch-editor-diff-confirmation-gate.mjs",
    command: "pnpm --dir benchmarks bench:director-agent-os-skill-patch-editor-diff-confirmation",
    description:
      "Director Angel Agent OS E.next gate proving desktop Skill curator patches use a visible patch editor, explicit diff confirmation, bounded Skill patch payloads, local operator scope, and guarded auto apply while remote curator write execution remains disabled.",
    kind: "gate",
    required: true,
  },
  {
    id: "director-phase-enext-agent-os-skill-failure-to-patch-eval-gate",
    script: "director-phase-enext-agent-os-skill-failure-to-patch-eval-gate.mjs",
    command: "pnpm --dir benchmarks bench:director-agent-os-skill-failure-to-patch-eval",
    description:
      "Director Angel Agent OS E.next gate proving repeated Skill failures generate review-gated patch proposals, dangerous proposals are rejected, and no Skill promotion happens without accepted review.",
    kind: "gate",
    required: true,
  },
  {
    id: "director-agent-os-subagents-gate",
    script: "director-phase-f-agent-os-subagents-gate.mjs",
    command: "pnpm --dir benchmarks bench:director-agent-os-subagents",
    description:
      "Director Angel Agent OS Phase F gate proving AgentTool/SubagentProfile contracts, bounded non-escalating child envelopes, parent-visible results, task-backed subagent projection, Host API/CLI operator visibility, conversation-runtime agent.delegate scheduling, desktop task-plane binding, Weixin remote fail-closed behavior, and worker-route hardening stay green without voice or new OS runner work.",
    kind: "gate",
    required: true,
  },
  {
    id: "director-phase-fnext-agent-os-bounded-scheduler-executor-gate",
    script: "director-phase-fnext-agent-os-bounded-scheduler-executor-gate.mjs",
    command: "pnpm --dir benchmarks bench:director-agent-os-bounded-scheduler-executor",
    description:
      "Director Angel Agent OS F.next gate proving the bounded local scheduler executor consumes scheduler tick dispatch intents through task-plane run-delegation without direct process runners, remote writes, or scheduler bypasses.",
    kind: "gate",
    required: true,
  },
  {
    id: "director-phase-fnext-agent-os-child-git-diff-observed-write-set-gate",
    script: "director-phase-fnext-agent-os-child-git-diff-observed-write-set-gate.mjs",
    command: "pnpm --dir benchmarks bench:director-agent-os-child-git-diff-observed-write-set",
    description:
      "Director Angel Agent OS F.next gate proving child-run observed write-set evidence can be collected from bounded workspace git index metadata without spawning git, staging, committing, resetting, or rolling back user changes.",
    kind: "gate",
    required: true,
  },
  {
    id: "director-phase-fnext-agent-os-executable-recovery-workflow-gate",
    script: "director-phase-fnext-agent-os-executable-recovery-workflow-gate.mjs",
    command: "pnpm --dir benchmarks bench:director-agent-os-executable-recovery-workflow",
    description:
      "Director Angel Agent OS F.next gate proving scheduler recovery actions execute as a bounded local workflow with dry-run default, operator-confirmed observed-drift cancellation, and no process runners or remote writes.",
    kind: "gate",
    required: true,
  },
  {
    id: "director-agent-os-release-suite-coverage-gate",
    script: "director-agent-os-release-suite-coverage-gate.mjs",
    command: "pnpm --dir benchmarks bench:director-agent-os-release-suite",
    description:
      "Director Angel Agent OS Phase H.1 gate proving the release eval suite covers required smoke, synthetic, real-provider, and real-data Agent OS gates and keeps live-only checks explicit.",
    kind: "gate",
    required: true,
  },
  {
    id: "director-agent-os-all-gate",
    script: "director-agent-os-all-gate.mjs",
    command: "pnpm --dir benchmarks bench:director-agent-os-all",
    description:
      "Director Angel Agent OS Phase H.1 aggregate release gate running CI-safe smoke, synthetic, local real-provider, and local real-data tiers while recording skip reasons for live desktop, Weixin, provider-account, and real-user-data checks.",
    kind: "gate",
    required: true,
  },
  {
    id: "director-phase-h2-agent-os-desktop-release-ops-gate",
    script: "director-phase-h2-agent-os-desktop-release-ops-gate.mjs",
    command: "pnpm --dir benchmarks bench:director-agent-os-desktop-release-ops",
    description:
      "Director Angel Agent OS Phase H.2 gate proving desktop Review/Ops surfaces the latest aggregate release gate tier matrix and live-only skipped checks as an operator checklist.",
    kind: "gate",
    required: true,
  },
  {
    id: "director-phase-h3-agent-os-release-smoke-readiness-gate",
    script: "director-phase-h3-agent-os-release-smoke-readiness-gate.mjs",
    command: "pnpm --dir benchmarks bench:director-agent-os-release-smoke-readiness",
    description:
      "Director Angel Agent OS Phase H.3 gate proving live-only release smoke checks are converted into read-only readiness plans before any real desktop, Weixin, provider, browser auth, or user-memory smoke can run.",
    kind: "gate",
    required: true,
  },
  {
    id: "director-phase-h4-agent-os-release-smoke-admission-gate",
    script: "director-phase-h4-agent-os-release-smoke-admission-gate.mjs",
    command: "pnpm --dir benchmarks bench:director-agent-os-release-smoke-admission",
    description:
      "Director Angel Agent OS Phase H.4 gate proving live-only release smoke readiness plans remain blocked by explicit admission verdicts until operator scope, auth, environment isolation, audit evidence, and data policy are satisfied.",
    kind: "gate",
    required: true,
  },
  {
    id: "director-phase-h5-agent-os-release-smoke-execution-preflight-gate",
    script: "director-phase-h5-agent-os-release-smoke-execution-preflight-gate.mjs",
    command: "pnpm --dir benchmarks bench:director-agent-os-release-smoke-execution-preflight",
    description:
      "Director Angel Agent OS Phase H.5 gate proving live-only release smoke admission verdicts produce explicit execution preflight evidence packets before any execution intent or live runner can start.",
    kind: "gate",
    required: true,
  },
  {
    id: "director-phase-h6-agent-os-release-smoke-evidence-intake-gate",
    script: "director-phase-h6-agent-os-release-smoke-evidence-intake-gate.mjs",
    command: "pnpm --dir benchmarks bench:director-agent-os-release-smoke-evidence-intake",
    description:
      "Director Angel Agent OS Phase H.6 gate proving live-only release smoke execution preflight packets stay blocked behind local operator evidence manifests without remote intake, user-data reads, or runner unlocks.",
    kind: "gate",
    required: true,
  },
  {
    id: "director-phase-h7-agent-os-release-smoke-evidence-manifest-preflight-gate",
    script: "director-phase-h7-agent-os-release-smoke-evidence-manifest-preflight-gate.mjs",
    command:
      "pnpm --dir benchmarks bench:director-agent-os-release-smoke-evidence-manifest-preflight",
    description:
      "Director Angel Agent OS Phase H.7 gate proving local operator evidence manifests stay blocked behind schema preflight without reading manifest content, remote manifests, or runner unlocks.",
    kind: "gate",
    required: true,
  },
  {
    id: "director-phase-h8-agent-os-release-smoke-evidence-manifest-validation-gate",
    script: "director-phase-h8-agent-os-release-smoke-evidence-manifest-validation-gate.mjs",
    command:
      "pnpm --dir benchmarks bench:director-agent-os-release-smoke-evidence-manifest-validation",
    description:
      "Director Angel Agent OS Phase H.8 gate proving local operator evidence manifests stay blocked behind schema-only validation without manifest reads, audit artifact readiness, or runner unlocks.",
    kind: "gate",
    required: true,
  },
  {
    id: "director-phase-h9-agent-os-release-smoke-evidence-manifest-path-authorization-gate",
    script:
      "director-phase-h9-agent-os-release-smoke-evidence-manifest-path-authorization-gate.mjs",
    command:
      "pnpm --dir benchmarks bench:director-agent-os-release-smoke-evidence-manifest-path-authorization",
    description:
      "Director Angel Agent OS Phase H.9 gate proving local operator evidence manifests stay blocked until an operator-owned local path authorization contract is satisfied without reading manifest content or unlocking runners.",
    kind: "gate",
    required: true,
  },
  {
    id: "director-phase-h10-agent-os-release-smoke-evidence-manifest-schema-validator-readiness-gate",
    script:
      "director-phase-h10-agent-os-release-smoke-evidence-manifest-schema-validator-readiness-gate.mjs",
    command:
      "pnpm --dir benchmarks bench:director-agent-os-release-smoke-evidence-manifest-schema-validator-readiness",
    description:
      "Director Angel Agent OS Phase H.10 gate proving local schema validator readiness stays blocked until schema binding, path authorization, manifest read authorization, and audit artifact readiness are satisfied without reading manifest content or unlocking runners.",
    kind: "gate",
    required: true,
  },
  {
    id: "director-phase-h11-agent-os-release-smoke-evidence-manifest-schema-definition-binding-gate",
    script:
      "director-phase-h11-agent-os-release-smoke-evidence-manifest-schema-definition-binding-gate.mjs",
    command:
      "pnpm --dir benchmarks bench:director-agent-os-release-smoke-evidence-manifest-schema-definition-binding",
    description:
      "Director Angel Agent OS Phase H.11 gate proving schema definition binding stays blocked until a local schema definition reference, schema loader, validator readiness, manifest read authorization, and audit artifact readiness are satisfied without reading manifest content or unlocking runners.",
    kind: "gate",
    required: true,
  },
  {
    id: "director-phase-h12-agent-os-release-smoke-evidence-manifest-read-authorization-gate",
    script:
      "director-phase-h12-agent-os-release-smoke-evidence-manifest-read-authorization-gate.mjs",
    command:
      "pnpm --dir benchmarks bench:director-agent-os-release-smoke-evidence-manifest-read-authorization",
    description:
      "Director Angel Agent OS Phase H.12 gate proving manifest read authorization stays blocked until operator read scope, local path authorization, schema definition binding, audit artifact readiness, and runner intent controls are satisfied without reading manifest content or unlocking runners.",
    kind: "gate",
    required: true,
  },
  {
    id: "director-phase-h13-agent-os-release-smoke-evidence-manifest-audit-artifact-readiness-gate",
    script:
      "director-phase-h13-agent-os-release-smoke-evidence-manifest-audit-artifact-readiness-gate.mjs",
    command:
      "pnpm --dir benchmarks bench:director-agent-os-release-smoke-evidence-manifest-audit-artifact-readiness",
    description:
      "Director Angel Agent OS Phase H.13 gate proving audit artifact readiness stays blocked until local audit artifact path, write authorization, manifest read authorization, manifest content read state, and runner intent controls are satisfied without writing audit artifacts, reading manifest content, or unlocking runners.",
    kind: "gate",
    required: true,
  },
  {
    id: "director-phase-h14-agent-os-release-smoke-runner-intent-signing-revocation-gate",
    script: "director-phase-h14-agent-os-release-smoke-runner-intent-signing-revocation-gate.mjs",
    command:
      "pnpm --dir benchmarks bench:director-agent-os-release-smoke-runner-intent-signing-revocation",
    description:
      "Director Angel Agent OS Phase H.14 gate proving runner intent signing and revocation stay fail-closed until signing key, signature, revocation record, audit artifact readiness, and manifest content read state are satisfied without issuing runner tokens, starting live runners, or reading manifest content.",
    kind: "gate",
    required: true,
  },
  {
    id: "director-phase-i1-agent-os-desktop-smoke-evidence-artifact-gate",
    script: "director-phase-i1-agent-os-desktop-smoke-evidence-artifact-gate.mjs",
    command: "pnpm --dir benchmarks bench:director-agent-os-desktop-smoke-evidence-artifact",
    description:
      "Director Angel Agent OS Phase I.1 gate proving the desktop smoke evidence artifact writer only emits local dry-run metadata without reading user data, starting desktop/Weixin/provider/browser automation, issuing runner tokens, or starting live runners.",
    kind: "gate",
    required: true,
  },
  {
    id: "director-phase-i2-agent-os-desktop-smoke-manual-run-artifact-validator-gate",
    script: "director-phase-i2-agent-os-desktop-smoke-manual-run-artifact-validator-gate.mjs",
    command:
      "pnpm --dir benchmarks bench:director-agent-os-desktop-smoke-manual-run-artifact-validator",
    description:
      "Director Angel Agent OS Phase I.2 gate proving the desktop smoke manual-run artifact validator checks schema, path, signing, and revocation state without automatic desktop clicks, manifest content reads beyond the explicit dry-run artifact, runner tokens, or live runners.",
    kind: "gate",
    required: true,
  },
  {
    id: "director-phase-i3-agent-os-non-voice-provider-smoke-candidate-gate",
    script: "director-phase-i3-agent-os-non-voice-provider-smoke-candidate-gate.mjs",
    command: "pnpm --dir benchmarks bench:director-agent-os-non-voice-provider-smoke-candidate",
    description:
      "Director Angel Agent OS Phase I.3 gate proving the non-voice provider smoke candidate uses media-understanding.local as a local metadata dry-run path with readonly sandbox admission, no credentials, no network, no live runner, and fail-closed runner intent state.",
    kind: "gate",
    required: true,
  },
  {
    id: "director-phase-bnext-agent-os-real-non-voice-provider-runner-extension-gate",
    script: "director-phase-bnext-agent-os-real-non-voice-provider-runner-extension-gate.mjs",
    command:
      "pnpm --dir benchmarks bench:director-agent-os-real-non-voice-provider-runner-extension",
    description:
      "Director Angel Agent OS B.next gate proving a sandbox-owned real non-voice provider runner extension uses media-analysis.local through sandbox preflight, execution plan, backend admission, command execution evidence, process ledger, no credentials, no network, no live runner, and fail-closed runner intent controls.",
    kind: "gate",
    required: true,
  },
  {
    id: "director-phase-i4-agent-os-controlled-runner-intent-token-prototype-gate",
    script: "director-phase-i4-agent-os-controlled-runner-intent-token-prototype-gate.mjs",
    command:
      "pnpm --dir benchmarks bench:director-agent-os-controlled-runner-intent-token-prototype",
    description:
      "Director Angel Agent OS Phase I.4 gate proving the controlled runner intent token prototype only issues a local dry-run envelope with TTL, revocation record, operator scope, artifact hash bundle, and no-user-data guarantee while refusing live runner tokens.",
    kind: "gate",
    required: true,
  },
  {
    id: "cli-e2e-smoke",
    script: "cli-e2e-smoke.mjs",
    command: "pnpm --dir benchmarks e2e:smoke",
    description: "CLI smoke end-to-end scenario.",
    kind: "smoke",
    required: true,
  },
  {
    id: "cli-run-benchmark",
    script: "cli-run-benchmark.mjs",
    command: "pnpm --dir benchmarks bench:run",
    description: "CLI benchmark harness runner (optional).",
    kind: "benchmark",
    required: false,
  },
];

function renderCommandTable() {
  const header = "| Suite | Command | Description |";
  const separator = "| --- | --- | --- |";
  const rows = waveSuiteManifest.map((suite) => {
    return `| ${suite.id} | ${suite.command} | ${suite.description}`;
  });
  return [header, separator, ...rows].join("\n");
}

export { waveSuiteManifest as waveSuites, renderCommandTable };
