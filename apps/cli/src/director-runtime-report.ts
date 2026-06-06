import { join } from "node:path";
import type {
  DirectorRuntimeCapabilitySnapshotResponse,
  RuntimeCapabilityAdapter,
} from "@hotflow/director-host-contracts";
import { DIRECTOR_FEATURE_SWITCH_KEYS, loadDirectorSwitchState } from "@hotflow/director-runtime";
import { resolveDirectorWorkspace } from "@hotflow/director-workspace";

function formatYesNo(value: boolean): string {
  return value ? "yes" : "no";
}

function formatList(values: readonly string[] | undefined, fallback = "(none)"): string {
  return values && values.length > 0 ? values.join(", ") : fallback;
}

function summarizeSwitchSource(source: string): string {
  return source === "defaults" ? "Beta-1 defaults" : source;
}

function summarizeBeta1State(state: ReturnType<typeof loadDirectorSwitchState>): string {
  return state.features["director.enabled"] &&
    state.features["clarification.enabled"] &&
    state.features["crew.enabled"]
    ? "on"
    : "off";
}

function summarizeBeta2State(state: ReturnType<typeof loadDirectorSwitchState>): string {
  return state.features["execution.sideEffects.enabled"] ? "on" : "off";
}

function summarizeBeta3State(
  response: DirectorRuntimeCapabilitySnapshotResponse,
  state: ReturnType<typeof loadDirectorSwitchState>,
): string {
  return response.capabilitySnapshot.adapters.length > 0 ||
    state.features["memory.enabled"] ||
    state.features["learning.enabled"]
    ? "on"
    : "off";
}

function renderAdapterLines(adapter: RuntimeCapabilityAdapter): string[] {
  const lines = [
    `  - ${adapter.adapterId} [${adapter.adapterKind}] provider=${adapter.provider} status=${adapter.healthStatus} enabled=${formatYesNo(adapter.enabled)} dry-run=${formatYesNo(adapter.dryRunSupported)} mock-only=${formatYesNo(adapter.mockOnly)}`,
  ];

  if (adapter.supportedActionClasses && adapter.supportedActionClasses.length > 0) {
    lines.push(`    actions: ${adapter.supportedActionClasses.join(", ")}`);
  }

  if (adapter.mediaCapability) {
    lines.push(
      `    media: modes=${formatList(adapter.mediaCapability.supportedModes)} inputs=${formatList(adapter.mediaCapability.inputModalities)} outputs=${formatList(adapter.mediaCapability.outputArtifactTypes)} async=${adapter.mediaCapability.supportsAsync ? "yes" : "no"}`,
    );
  }

  if (adapter.notes && adapter.notes.length > 0) {
    lines.push(`    notes: ${adapter.notes.join(" | ")}`);
  }

  return lines;
}

export function renderDirectorAdapterInventory(
  workspaceRoot: string,
  response: DirectorRuntimeCapabilitySnapshotResponse,
): string {
  const snapshot = response.capabilitySnapshot;
  const workspace = resolveDirectorWorkspace({ root: workspaceRoot });
  const enabledCount = snapshot.adapters.filter((adapter) => adapter.enabled).length;
  const lines = [
    "Director adapters:",
    `  runtime id: ${response.runtimeId}`,
    `  snapshot id: ${snapshot.snapshotId}`,
    `  status: ${snapshot.status}`,
    `  enabled adapters: ${enabledCount}/${snapshot.adapters.length}`,
    `  adapters dir: ${workspace.adapters}`,
    `  registry dir: ${workspace.adaptersRegistry}`,
  ];

  if (snapshot.notes && snapshot.notes.length > 0) {
    lines.push(`  notes: ${snapshot.notes.join(" | ")}`);
  }

  if (snapshot.adapters.length === 0) {
    lines.push("  (none)");
  } else {
    for (const adapter of snapshot.adapters) {
      lines.push(...renderAdapterLines(adapter));
    }
  }

  return `${lines.join("\n")}\n`;
}

export function renderDirectorSwitchSummary(
  workspaceRoot: string,
  response: DirectorRuntimeCapabilitySnapshotResponse,
): string {
  const snapshot = response.capabilitySnapshot;
  const workspace = resolveDirectorWorkspace({ root: workspaceRoot });
  const switchState = loadDirectorSwitchState(join(workspace.runtime, "switches.json"));
  const disabledRoles = Object.entries(switchState.roleOverrides)
    .filter(([, enabled]) => enabled === false)
    .map(([role]) => role);
  const disabledAdapters = Object.entries(switchState.adapterOverrides)
    .filter(([, enabled]) => enabled === false)
    .map(([adapterId]) => adapterId);
  const lines = [
    "Director switches:",
    `  source: ${summarizeSwitchSource(switchState.source)}`,
    `  runtime id: ${response.runtimeId}`,
    `  runtime status: ${snapshot.status}`,
    `  workspace root: ${workspace.root}`,
    `  switch path: ${switchState.path ?? "(defaults)"}`,
    `  adapters detected: ${snapshot.adapters.length}`,
    `  beta1: ${summarizeBeta1State(switchState)}`,
    `  beta2: ${summarizeBeta2State(switchState)}`,
    `  beta3: ${summarizeBeta3State(response, switchState)}`,
    `  adapter scope: ${snapshot.adapters[0]?.adapterId ?? "(none)"} (${snapshot.adapters[0] ? "present" : "missing"})`,
  ];

  for (const key of DIRECTOR_FEATURE_SWITCH_KEYS) {
    lines.push(`  ${key}: ${switchState.features[key] ? "on" : "off"}`);
  }

  if (disabledRoles.length > 0) {
    lines.push(`  disabled roles: ${disabledRoles.join(", ")}`);
  }

  if (disabledAdapters.length > 0) {
    lines.push(`  disabled adapters: ${disabledAdapters.join(", ")}`);
  }

  if (switchState.notes.length > 0) {
    lines.push(`  notes: ${switchState.notes.join(" | ")}`);
  }

  if (switchState.issues.length > 0) {
    lines.push(`  issues: ${switchState.issues.join(" | ")}`);
  }

  return `${lines.join("\n")}\n`;
}
