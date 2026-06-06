# Phase 2.2 Step Loop Contract Assumptions

This package now has an internal strategy-driven step loop (`src/step-loop.ts`) and engine step strategy (`src/engine-step-strategy.ts`).

Current behavior is preserved by relying on these assumptions from existing cross-package contracts:

1. `@hotflow/models`:
`ModelGenerateResult.toolCalls` is the only loop-continuation signal.
If `toolCalls` is empty/undefined, the turn is treated as complete for this step loop.

2. `@hotflow/tools`:
All returned tool results are safe to append to the next prompt as plain text.
No separate contract exists for model-native tool-result message format.

3. `@hotflow/sessions`:
Checkpointing after tool-executing steps is triggered by internal strategy effect (`"tools-executed"`), not a first-class session/turn event contract.

4. `@hotflow/contracts` + `tasks.todo_write` event payload:
Task persistence replay assumes payloads are coercible into `PersistedTaskState` via local coercion rules in `src/engine.ts`.

## Remaining Contract Dependencies (for clean integration later)

1. Add an explicit model loop decision contract (example: `nextAction: "respond" | "call_tools" | "continue"`), so continuation logic does not depend solely on `toolCalls.length`.
2. Define a structured tool-result-to-model contract (instead of raw JSON string rendering) to make strategy swapping safer.
3. Define a typed step lifecycle contract for checkpoint/journal triggers (instead of string effect tags).
4. Optionally expose dispatcher batching/merge semantics via a stable interface if future step strategies need parallel tool execution.
