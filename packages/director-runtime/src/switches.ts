import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

import type { ActionClass, ApprovalMode, CrewRole } from "@hotflow/director-core";

import {
  DIRECTOR_CREW_ROLE_DEFAULTS,
  DIRECTOR_FEATURE_SWITCH_DEFAULTS,
  DIRECTOR_SWITCH_SCHEMA_ID,
  type DirectorFeatureSwitchKey,
  type DirectorSwitchDocument,
  type DirectorSwitchOverrides,
  type DirectorSwitchState,
} from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFeatureKey(value: string): value is DirectorFeatureSwitchKey {
  return value in DIRECTOR_FEATURE_SWITCH_DEFAULTS;
}

function isCrewRoleKey(value: string): value is CrewRole {
  return value in DIRECTOR_CREW_ROLE_DEFAULTS;
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function withDirectorSwitchFileLock<T>(path: string, operation: () => T): T {
  mkdirSync(dirname(path), { recursive: true });
  const lockPath = `${path}.lock`;
  const startedAt = Date.now();
  const timeoutMs = 5000;
  const staleMs = 30000;

  while (true) {
    try {
      mkdirSync(lockPath);
      break;
    } catch (error) {
      if (Date.now() - startedAt > timeoutMs) {
        throw new Error(
          `Timed out waiting for Director switch lock at ${lockPath}: ${String(error)}`,
        );
      }

      try {
        const stats = statSync(lockPath);
        if (Date.now() - stats.mtimeMs > staleMs) {
          rmSync(lockPath, { recursive: true, force: true });
          continue;
        }
      } catch {
        // The lock disappeared between attempts; retry immediately.
      }

      sleepSync(25);
    }
  }

  try {
    return operation();
  } finally {
    rmSync(lockPath, { recursive: true, force: true });
  }
}

export function resolveDirectorSwitchState(
  overrides: DirectorSwitchOverrides = {},
): DirectorSwitchState {
  const features: Record<DirectorFeatureSwitchKey, boolean> = {
    ...DIRECTOR_FEATURE_SWITCH_DEFAULTS,
  };
  const roleOverrides: Record<CrewRole, boolean> = {
    ...DIRECTOR_CREW_ROLE_DEFAULTS,
  };

  for (const [key, value] of Object.entries(overrides.features ?? {})) {
    if (isFeatureKey(key) && typeof value === "boolean") {
      features[key] = value;
    }
  }

  for (const [key, value] of Object.entries(overrides.roleOverrides ?? {})) {
    if (isCrewRoleKey(key) && typeof value === "boolean") {
      roleOverrides[key] = value;
    }
  }

  return {
    schemaId: DIRECTOR_SWITCH_SCHEMA_ID,
    source: overrides.source ?? "defaults",
    ...(overrides.path === undefined ? {} : { path: overrides.path }),
    features,
    roleOverrides,
    adapterOverrides: {
      ...(overrides.adapterOverrides ?? {}),
    },
    notes: overrides.notes === undefined ? [] : [...overrides.notes],
    issues: overrides.issues === undefined ? [] : [...overrides.issues],
  };
}

export function loadDirectorSwitchState(path: string): DirectorSwitchState {
  if (!existsSync(path)) {
    return resolveDirectorSwitchState({
      source: "defaults",
      path,
      notes: ["Switch file not found; using built-in defaults."],
    });
  }

  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
    const parsed = parseDirectorSwitchDocument(raw);
    return resolveDirectorSwitchState({
      source: "file",
      path,
      ...(parsed.features === undefined ? {} : { features: parsed.features }),
      ...(parsed.roleOverrides === undefined ? {} : { roleOverrides: parsed.roleOverrides }),
      ...(parsed.adapterOverrides === undefined
        ? {}
        : { adapterOverrides: parsed.adapterOverrides }),
      notes: ["Loaded Director switches from disk."],
    });
  } catch (error) {
    return resolveDirectorSwitchState({
      source: "defaults",
      path,
      notes: ["Switch file could not be parsed; falling back to defaults."],
      issues: [String(error)],
    });
  }
}

export function writeDirectorSwitchDocument(path: string, document: DirectorSwitchDocument): void {
  mkdirSync(dirname(path), { recursive: true });
  const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  renameSync(tempPath, path);
}

export function writeDirectorFeatureOverride(
  path: string,
  feature: DirectorFeatureSwitchKey,
  enabled: boolean,
): DirectorSwitchState {
  return withDirectorSwitchFileLock(path, () => {
    const current = loadDirectorSwitchState(path);
    const nextDocument: DirectorSwitchDocument = {
      schemaId: DIRECTOR_SWITCH_SCHEMA_ID,
      features: {
        ...current.features,
        [feature]: enabled,
      },
      roleOverrides: {
        ...current.roleOverrides,
      },
      adapterOverrides: {
        ...current.adapterOverrides,
      },
    };
    writeDirectorSwitchDocument(path, nextDocument);
    return loadDirectorSwitchState(path);
  });
}

export function writeDirectorAdapterOverride(
  path: string,
  adapterId: string,
  enabled: boolean,
): DirectorSwitchState {
  return withDirectorSwitchFileLock(path, () => {
    const current = loadDirectorSwitchState(path);
    const nextDocument: DirectorSwitchDocument = {
      schemaId: DIRECTOR_SWITCH_SCHEMA_ID,
      ...(Object.keys(current.features).length === 0 ? {} : { features: current.features }),
      ...(Object.keys(current.roleOverrides).length === 0
        ? {}
        : { roleOverrides: current.roleOverrides }),
      adapterOverrides: {
        ...current.adapterOverrides,
        [adapterId]: enabled,
      },
    };
    writeDirectorSwitchDocument(path, nextDocument);
    return loadDirectorSwitchState(path);
  });
}

export function parseDirectorSwitchDocument(input: unknown): DirectorSwitchDocument {
  if (!isRecord(input) || input.schemaId !== DIRECTOR_SWITCH_SCHEMA_ID) {
    throw new Error(
      `Director switch document must be an object with schemaId=${DIRECTOR_SWITCH_SCHEMA_ID}.`,
    );
  }

  const features: Partial<Record<DirectorFeatureSwitchKey, boolean>> = {};
  if (isRecord(input.features)) {
    for (const [key, value] of Object.entries(input.features)) {
      if (isFeatureKey(key) && typeof value === "boolean") {
        features[key] = value;
      }
    }
  }

  const roleOverrides: Partial<Record<CrewRole, boolean>> = {};
  if (isRecord(input.roleOverrides)) {
    for (const [key, value] of Object.entries(input.roleOverrides)) {
      if (isCrewRoleKey(key) && typeof value === "boolean") {
        roleOverrides[key] = value;
      }
    }
  }

  const adapterOverrides: Record<string, boolean> = {};
  if (isRecord(input.adapterOverrides)) {
    for (const [key, value] of Object.entries(input.adapterOverrides)) {
      if (typeof value === "boolean") {
        adapterOverrides[key] = value;
      }
    }
  }

  return {
    schemaId: DIRECTOR_SWITCH_SCHEMA_ID,
    ...(Object.keys(features).length === 0 ? {} : { features }),
    ...(Object.keys(roleOverrides).length === 0 ? {} : { roleOverrides }),
    ...(Object.keys(adapterOverrides).length === 0 ? {} : { adapterOverrides }),
  };
}

export function isDirectorFeatureEnabled(
  state: DirectorSwitchState,
  key: DirectorFeatureSwitchKey,
): boolean {
  return state.features[key];
}

export function isDirectorRoleEnabled(state: DirectorSwitchState, role: CrewRole): boolean {
  return state.roleOverrides[role];
}

export function isDirectorAdapterEnabled(state: DirectorSwitchState, adapterId: string): boolean {
  return state.adapterOverrides[adapterId] ?? true;
}

export function applyDirectorApprovalPolicy(
  requested: ApprovalMode,
  actionClass: ActionClass,
  state: DirectorSwitchState,
): ApprovalMode {
  if (!isDirectorFeatureEnabled(state, "director.enabled")) {
    return "forbidden-in-beta1";
  }

  if (!isDirectorFeatureEnabled(state, "crew.enabled") && actionClass !== "read") {
    return "forbidden-in-beta1";
  }

  if (actionClass === "route" && !isDirectorFeatureEnabled(state, "autoRoute.enabled")) {
    return "forbidden-in-beta1";
  }

  if (actionClass === "publish" && !isDirectorFeatureEnabled(state, "publish.enabled")) {
    return "forbidden-in-beta1";
  }

  if (
    actionClass === "write" &&
    !isDirectorFeatureEnabled(state, "execution.sideEffects.enabled")
  ) {
    return "forbidden-in-beta1";
  }

  if (actionClass === "review") {
    return requested === "forbidden-in-beta1" ? requested : "operator-approve";
  }

  if (actionClass === "route") {
    return requested === "forbidden-in-beta1" ? requested : "operator-approve";
  }

  return requested;
}
