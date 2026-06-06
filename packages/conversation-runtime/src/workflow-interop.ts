const WORKFLOW_INTEROP_SCHEMA_VERSION = "director.workflow-interop.v1" as const;

export type WorkflowInteropLossiness = "lossless" | "lossy" | "unsupported";

export interface WorkflowInteropPackage {
  readonly schemaVersion: typeof WORKFLOW_INTEROP_SCHEMA_VERSION;
  readonly id: string;
  readonly source: WorkflowInteropEndpoint;
  readonly target?: WorkflowInteropEndpoint;
  readonly graph: WorkflowInteropGraph;
  readonly artifacts: readonly WorkflowInteropArtifact[];
  readonly conversion: WorkflowInteropConversionReport;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface WorkflowInteropEndpoint {
  readonly provider: string;
  readonly format: string;
  readonly artifactId?: string;
  readonly uri?: string;
}

export interface WorkflowInteropGraph {
  readonly nodes: readonly WorkflowInteropNode[];
  readonly edges: readonly WorkflowInteropEdge[];
}

export interface WorkflowInteropNode {
  readonly id: string;
  readonly kind: string;
  readonly label?: string;
  readonly payload?: unknown;
}

export interface WorkflowInteropEdge {
  readonly from: string;
  readonly to: string;
  readonly label?: string;
}

export interface WorkflowInteropArtifact {
  readonly id: string;
  readonly kind: string;
  readonly uri?: string;
  readonly localPath?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface WorkflowInteropConversionReport {
  readonly executable: boolean;
  readonly requestedExecutable?: boolean;
  readonly lossiness: WorkflowInteropLossiness;
  readonly unmappedFields: readonly string[];
  readonly missingDependencies: readonly string[];
  readonly logs: readonly string[];
}

export interface WorkflowInteropValidationResult {
  readonly ok: boolean;
  readonly package?: WorkflowInteropPackage;
  readonly errors: readonly string[];
}

export interface WorkflowInteropConversionExplanation {
  readonly executable: boolean;
  readonly reason: string;
  readonly lossiness: WorkflowInteropLossiness;
  readonly unmappedFields: readonly string[];
  readonly missingDependencies: readonly string[];
}

export function createWorkflowInteropPackage(
  input: Omit<WorkflowInteropPackage, "schemaVersion"> & {
    readonly schemaVersion?: typeof WORKFLOW_INTEROP_SCHEMA_VERSION;
  },
): WorkflowInteropPackage {
  const conversion = normalizeWorkflowInteropConversion(input.conversion);
  return {
    schemaVersion: WORKFLOW_INTEROP_SCHEMA_VERSION,
    id: input.id,
    source: input.source,
    ...(input.target === undefined ? {} : { target: input.target }),
    graph: input.graph,
    artifacts: input.artifacts,
    conversion,
    ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
  };
}

export function validateWorkflowInteropPackage(input: unknown): WorkflowInteropValidationResult {
  if (!isRecord(input)) {
    return { ok: false, errors: ["Workflow interop package must be an object."] };
  }
  if (input.schemaVersion !== WORKFLOW_INTEROP_SCHEMA_VERSION) {
    return {
      ok: false,
      errors: [`Workflow interop package must use ${WORKFLOW_INTEROP_SCHEMA_VERSION}.`],
    };
  }
  const errors: string[] = [];
  const id = readString(input.id);
  if (id === undefined) {
    errors.push("id is required.");
  }
  const source = readEndpoint(input.source, "source", errors);
  const target =
    input.target === undefined ? undefined : readEndpoint(input.target, "target", errors);
  const graph = readGraph(input.graph, errors);
  const artifacts = readArtifacts(input.artifacts, errors);
  const conversion = readConversion(input.conversion, errors);
  if (
    errors.length > 0 ||
    id === undefined ||
    source === undefined ||
    graph === undefined ||
    conversion === undefined
  ) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    errors: [],
    package: createWorkflowInteropPackage({
      id,
      source,
      ...(target === undefined ? {} : { target }),
      graph,
      artifacts,
      conversion,
      ...(isRecord(input.metadata) ? { metadata: input.metadata } : {}),
    }),
  };
}

export function explainWorkflowInteropConversion(
  input: WorkflowInteropPackage,
): WorkflowInteropConversionExplanation {
  const normalized = createWorkflowInteropPackage(input);
  const conversion = normalized.conversion;
  const reason = conversion.executable
    ? "conversion is executable"
    : createWorkflowInteropNonExecutableReason(conversion);
  return {
    executable: conversion.executable,
    reason,
    lossiness: conversion.lossiness,
    unmappedFields: conversion.unmappedFields,
    missingDependencies: conversion.missingDependencies,
  };
}

function normalizeWorkflowInteropConversion(
  input: WorkflowInteropConversionReport,
): WorkflowInteropConversionReport {
  const requestedExecutable = input.requestedExecutable ?? input.executable;
  const executable =
    input.executable === true &&
    input.lossiness === "lossless" &&
    input.unmappedFields.length === 0 &&
    input.missingDependencies.length === 0;
  return {
    executable,
    ...(requestedExecutable === executable ? {} : { requestedExecutable }),
    lossiness: input.lossiness,
    unmappedFields: uniqueStrings(input.unmappedFields),
    missingDependencies: uniqueStrings(input.missingDependencies),
    logs: uniqueStrings(input.logs),
  };
}

function createWorkflowInteropNonExecutableReason(
  conversion: WorkflowInteropConversionReport,
): string {
  if (conversion.lossiness !== "lossless") {
    return `conversion is ${conversion.lossiness}`;
  }
  if (conversion.missingDependencies.length > 0) {
    return "conversion has missing dependencies";
  }
  if (conversion.unmappedFields.length > 0) {
    return "conversion has unmapped fields";
  }
  return "conversion is marked non-executable";
}

function readEndpoint(
  value: unknown,
  label: string,
  errors: string[],
): WorkflowInteropEndpoint | undefined {
  if (!isRecord(value)) {
    errors.push(`${label} must be an object.`);
    return undefined;
  }
  const provider = readString(value.provider);
  const format = readString(value.format);
  if (provider === undefined) {
    errors.push(`${label}.provider is required.`);
  }
  if (format === undefined) {
    errors.push(`${label}.format is required.`);
  }
  if (provider === undefined || format === undefined) {
    return undefined;
  }
  return {
    provider,
    format,
    ...optionalStringField("artifactId", value.artifactId),
    ...optionalStringField("uri", value.uri),
  };
}

function readGraph(value: unknown, errors: string[]): WorkflowInteropGraph | undefined {
  if (!isRecord(value)) {
    errors.push("graph must be an object.");
    return undefined;
  }
  return {
    nodes: readNodes(value.nodes, errors),
    edges: readEdges(value.edges, errors),
  };
}

function readNodes(value: unknown, errors: string[]): readonly WorkflowInteropNode[] {
  if (!Array.isArray(value)) {
    errors.push("graph.nodes must be an array.");
    return [];
  }
  return value.flatMap((node): WorkflowInteropNode[] => {
    if (!isRecord(node)) {
      return [];
    }
    const id = readString(node.id);
    const kind = readString(node.kind);
    if (id === undefined || kind === undefined) {
      return [];
    }
    return [
      {
        id,
        kind,
        ...optionalStringField("label", node.label),
        ...(node.payload === undefined ? {} : { payload: node.payload }),
      },
    ];
  });
}

function readEdges(value: unknown, errors: string[]): readonly WorkflowInteropEdge[] {
  if (!Array.isArray(value)) {
    errors.push("graph.edges must be an array.");
    return [];
  }
  return value.flatMap((edge): WorkflowInteropEdge[] => {
    if (!isRecord(edge)) {
      return [];
    }
    const from = readString(edge.from);
    const to = readString(edge.to);
    if (from === undefined || to === undefined) {
      return [];
    }
    return [{ from, to, ...optionalStringField("label", edge.label) }];
  });
}

function readArtifacts(value: unknown, errors: string[]): readonly WorkflowInteropArtifact[] {
  if (!Array.isArray(value)) {
    errors.push("artifacts must be an array.");
    return [];
  }
  return value.flatMap((artifact): WorkflowInteropArtifact[] => {
    if (!isRecord(artifact)) {
      return [];
    }
    const id = readString(artifact.id);
    const kind = readString(artifact.kind);
    if (id === undefined || kind === undefined) {
      return [];
    }
    return [
      {
        id,
        kind,
        ...optionalStringField("uri", artifact.uri),
        ...optionalStringField("localPath", artifact.localPath),
        ...(isRecord(artifact.metadata) ? { metadata: artifact.metadata } : {}),
      },
    ];
  });
}

function readConversion(
  value: unknown,
  errors: string[],
): WorkflowInteropConversionReport | undefined {
  if (!isRecord(value)) {
    errors.push("conversion must be an object.");
    return undefined;
  }
  const lossiness = readLossiness(value.lossiness);
  return normalizeWorkflowInteropConversion({
    executable: value.executable === true,
    ...(typeof value.requestedExecutable === "boolean"
      ? { requestedExecutable: value.requestedExecutable }
      : {}),
    lossiness,
    unmappedFields: readStringList(value.unmappedFields),
    missingDependencies: readStringList(value.missingDependencies),
    logs: readStringList(value.logs),
  });
}

function readLossiness(value: unknown): WorkflowInteropLossiness {
  return value === "lossless" || value === "lossy" || value === "unsupported"
    ? value
    : "unsupported";
}

function readStringList(value: unknown): readonly string[] {
  return Array.isArray(value) ? uniqueStrings(value.flatMap((item) => readString(item) ?? [])) : [];
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function optionalStringField<K extends string>(
  key: K,
  value: unknown,
): { readonly [P in K]?: string } {
  const text = readString(value);
  return text === undefined ? {} : ({ [key]: text } as { readonly [P in K]?: string });
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
