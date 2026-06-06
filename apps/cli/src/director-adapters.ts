import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import type { RuntimeCapabilityAdapter } from "@hotflow/director-host-contracts";
import {
  DirectorAdapterRegistry,
  FileSystemDirectorAdapterRegistryStore,
  loadDirectorSwitchState,
  writeDirectorAdapterOverride,
} from "@hotflow/director-runtime";
import { resolveDirectorWorkspace } from "@hotflow/director-workspace";

function formatYesNo(value: boolean): string {
  return value ? "yes" : "no";
}

function formatList(values: readonly string[] | undefined, fallback = "(none)"): string {
  return values && values.length > 0 ? values.join(", ") : fallback;
}

export async function registerDirectorAdapterManifest(
  workspaceRoot: string,
  manifestPath: string,
): Promise<string> {
  const workspace = resolveDirectorWorkspace({ root: workspaceRoot });
  const resolvedManifestPath = resolve(workspaceRoot, manifestPath);
  const store = new FileSystemDirectorAdapterRegistryStore({
    rootPath: workspace.adaptersRegistry,
  });
  const raw = JSON.parse(await readFile(resolvedManifestPath, "utf8")) as unknown;
  const result = await store.upsertManifest(raw, { source: "cli.register" });
  const document = result.status === "ok" ? await store.getManifest(result.adapterId) : null;

  const lines = [
    "Director adapter register:",
    `  manifest input: ${resolvedManifestPath}`,
    `  registry dir: ${workspace.adaptersRegistry}`,
    `  status: ${result.status}`,
    `  adapter id: ${result.adapterId}`,
    `  stored version: ${document?.version ?? result.version}`,
    `  manifest path: ${document ? join(workspace.adaptersRegistry, "manifests", `${encodeURIComponent(document.adapterId)}.json`) : "(unknown)"}`,
    "  next step: restart director host bootstrap to materialize persisted adapters into runtime snapshots.",
  ];

  if (document) {
    lines.push(`  adapter kind: ${document.adapterKind}`);
    lines.push(`  provider: ${document.provider}`);
    lines.push(`  mock only: ${formatYesNo(document.mockOnly)}`);
    lines.push(`  dry run: ${formatYesNo(document.dryRunSupported)}`);
    lines.push(`  risk level: ${document.riskLevel ?? "unspecified"}`);
    lines.push(`  approval mode: ${document.approvalMode ?? "unspecified"}`);
  }

  if (result.notes.length > 0) {
    lines.push(`  notes: ${result.notes.join(" | ")}`);
  }

  return `${lines.join("\n")}\n`;
}

export async function explainDirectorAdapter(
  workspaceRoot: string,
  adapterId: string,
): Promise<string> {
  const workspace = resolveDirectorWorkspace({ root: workspaceRoot });
  const switchPath = join(workspace.runtime, "switches.json");
  const switchState = loadDirectorSwitchState(switchPath);
  const store = new FileSystemDirectorAdapterRegistryStore({
    rootPath: workspace.adaptersRegistry,
  });
  const document = await store.getManifest(adapterId);
  const snapshotAdapter = resolveAdapterSnapshot(document, switchState, adapterId);
  const effectiveEnabled =
    snapshotAdapter?.enabled ?? resolveEffectiveAdapterEnabled(document, switchState, adapterId);
  const bridge = snapshotAdapter?.bridge;
  const realExecutionEligible =
    bridge !== undefined &&
    effectiveEnabled &&
    document?.mockOnly === false &&
    switchState.features["execution.sideEffects.enabled"];
  const lines = [
    "Director adapter explain:",
    `  adapter id: ${adapterId}`,
    `  registry dir: ${workspace.adaptersRegistry}`,
    `  switch path: ${switchPath}`,
    `  manifest registered: ${formatYesNo(document !== null)}`,
    `  switch override: ${readSwitchOverrideLabel(switchState.adapterOverrides[adapterId])}`,
    `  effective enabled: ${formatYesNo(effectiveEnabled)}`,
  ];

  if (!document) {
    lines.push("  notes: No persisted adapter manifest found for this adapter id.");
    return `${lines.join("\n")}\n`;
  }

  lines.push(`  version: ${document.version}`);
  lines.push(`  captured at: ${document.capturedAt}`);
  lines.push(`  source: ${document.source}`);
  lines.push(`  adapter kind: ${document.adapterKind}`);
  lines.push(`  provider: ${document.provider}`);
  lines.push(`  binding id: ${document.bindingId ?? "(none)"}`);
  lines.push(`  health: ${document.healthStatus}`);
  lines.push(`  manifest enabled: ${document.enabled === false ? "no" : "yes"}`);
  lines.push(`  dry run: ${formatYesNo(document.dryRunSupported)}`);
  lines.push(`  mock only: ${formatYesNo(document.mockOnly)}`);
  lines.push(`  risk level: ${document.riskLevel ?? "unspecified"}`);
  lines.push(`  approval mode: ${document.approvalMode ?? "unspecified"}`);
  lines.push(`  permission scopes: ${formatList(document.permissionScopes)}`);
  lines.push(`  data retention: ${document.dataRetentionPolicy ?? "unspecified"}`);
  lines.push(`  rate limit: ${document.rateLimitPolicy ?? "unspecified"}`);
  lines.push(`  budget policy: ${document.budgetPolicy ?? "unspecified"}`);
  lines.push(
    `  execution side effects: ${formatYesNo(switchState.features["execution.sideEffects.enabled"])}`,
  );
  lines.push(`  bridge capable: ${formatYesNo(bridge !== undefined)}`);
  lines.push(`  actions: ${formatList(document.supportedActionClasses)}`);

  if (bridge) {
    lines.push(`  bridge kind: ${bridge.kind}`);
    lines.push(`  bridge endpoint: ${bridge.endpointOrigin}${bridge.endpointPath}`);
    lines.push(`  bridge auth: ${bridge.authMode}`);
    lines.push(`  bridge headers: ${formatList(bridge.headerKeys)}`);
    lines.push("  execution lane: worker-only");
  }

  lines.push(`  real execution eligible: ${formatYesNo(realExecutionEligible)}`);

  if (document.mediaCapability) {
    lines.push(
      `  media: modes=${formatList(document.mediaCapability.supportedModes)} inputs=${formatList(document.mediaCapability.inputModalities)} outputs=${formatList(document.mediaCapability.outputArtifactTypes)}`,
    );
  }

  if (document.notes && document.notes.length > 0) {
    lines.push(`  notes: ${document.notes.join(" | ")}`);
  }

  return `${lines.join("\n")}\n`;
}

export async function setDirectorAdapterEnabled(
  workspaceRoot: string,
  adapterId: string,
  enabled: boolean,
): Promise<string> {
  const workspace = resolveDirectorWorkspace({ root: workspaceRoot });
  const switchPath = join(workspace.runtime, "switches.json");
  const switchState = writeDirectorAdapterOverride(switchPath, adapterId, enabled);
  const store = new FileSystemDirectorAdapterRegistryStore({
    rootPath: workspace.adaptersRegistry,
  });
  const document = await store.getManifest(adapterId);
  const effectiveEnabled = resolveEffectiveAdapterEnabled(document, switchState, adapterId);

  const lines = [
    `Director adapter ${enabled ? "enable" : "disable"}:`,
    `  adapter id: ${adapterId}`,
    `  switch path: ${switchPath}`,
    `  switch override: ${readSwitchOverrideLabel(switchState.adapterOverrides[adapterId])}`,
    `  effective enabled: ${formatYesNo(effectiveEnabled)}`,
    "  next step: restart director host bootstrap to refresh runtime snapshots from disk.",
  ];

  if (document) {
    lines.push("  manifest registered: yes");
    lines.push(`  adapter kind: ${document.adapterKind}`);
    lines.push(`  provider: ${document.provider}`);
  } else {
    lines.push("  manifest registered: no");
    lines.push(
      "  notes: Override was written even though no persisted manifest was found; this will only matter if a runtime exposes the same adapter id.",
    );
  }

  return `${lines.join("\n")}\n`;
}

function resolveEffectiveAdapterEnabled(
  document: Awaited<ReturnType<FileSystemDirectorAdapterRegistryStore["getManifest"]>>,
  switchState: ReturnType<typeof loadDirectorSwitchState>,
  adapterId: string,
): boolean {
  const snapshotAdapter = resolveAdapterSnapshot(document, switchState, adapterId);
  if (snapshotAdapter) {
    return snapshotAdapter.enabled;
  }

  if (!document) {
    return switchState.adapterOverrides[adapterId] ?? true;
  }

  return false;
}

function resolveAdapterSnapshot(
  document: Awaited<ReturnType<FileSystemDirectorAdapterRegistryStore["getManifest"]>>,
  switchState: ReturnType<typeof loadDirectorSwitchState>,
  adapterId: string,
): RuntimeCapabilityAdapter | null {
  if (!document) {
    return null;
  }

  const registry = new DirectorAdapterRegistry([document]);
  const snapshot = registry.buildRuntimeCapabilitySnapshot({
    runtimeId: "director-adapter-explain",
    switchState,
    includeDisabled: true,
  });
  return snapshot.adapters.find((adapter) => adapter.adapterId === adapterId) ?? null;
}

function readSwitchOverrideLabel(value: boolean | undefined): string {
  if (value === undefined) {
    return "default-on";
  }
  return value ? "forced-on" : "forced-off";
}
