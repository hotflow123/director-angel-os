import { existsSync, readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

export const DIRECTOR_COMFYUI_CONFIG_SCHEMA_VERSION = "director.comfyui.v1" as const;

export type DirectorComfyUiMode = "local" | "cloud";

export type DirectorComfyUiSettingKey =
  | "enabled"
  | "mode"
  | "apiKey"
  | "apiKeyEnvVar"
  | "baseUrl"
  | "localInstallPath"
  | "defaultWorkflowPath"
  | "outputDir"
  | "positivePromptNodeId"
  | "positivePromptInputName"
  | "negativePromptNodeId"
  | "negativePromptInputName";

export interface DirectorComfyUiEndpoint {
  readonly id: "health" | "object_info" | "prompt" | "history" | "view" | "upload_image";
  readonly label: string;
  readonly method: "GET" | "POST";
  readonly path: string;
  readonly notes: readonly string[];
}

export interface DirectorComfyUiAdapter {
  readonly id: "comfyui-media";
  readonly platform: "comfyui";
  readonly name: "ComfyUI";
  readonly mode: DirectorComfyUiMode;
  readonly baseUrl: string;
  readonly localInstallPath: string;
  readonly enabled: boolean;
  readonly apiKeyEnvVar: string;
  readonly apiKeyConfigured: boolean;
  readonly apiKeyMasked: string;
  readonly defaultWorkflowPath: string;
  readonly outputDir: string;
  readonly positivePromptNodeId: string;
  readonly positivePromptInputName: string;
  readonly negativePromptNodeId: string;
  readonly negativePromptInputName: string;
  readonly supportedModes: readonly ["text_to_image", "text_to_video", "image_to_video"];
  readonly endpoints: readonly DirectorComfyUiEndpoint[];
  readonly notes: readonly string[];
}

export interface DirectorComfyUiConfigDocument {
  readonly schemaVersion: typeof DIRECTOR_COMFYUI_CONFIG_SCHEMA_VERSION;
  readonly updatedAt: string;
  readonly adapter: DirectorComfyUiAdapter;
}

export interface LoadDirectorComfyUiConfigResult {
  readonly document: DirectorComfyUiConfigDocument;
  readonly configPath: string;
  readonly source: "defaults" | "file";
  readonly notes: readonly string[];
  readonly issues: readonly string[];
}

export interface DirectorComfyUiSettingUpdate {
  readonly key: DirectorComfyUiSettingKey;
  readonly value: string | boolean;
  readonly now?: string;
}

export interface DirectorComfyUiConnectionTestInput {
  readonly baseUrl?: string;
  readonly apiKey?: string;
  readonly timeoutMs?: number;
  readonly now?: string;
  readonly fetchImpl?: DirectorComfyUiFetch;
}

export interface DirectorComfyUiConnectionTestResult {
  readonly ok: boolean;
  readonly endpoint: string;
  readonly checkedAt: string;
  readonly latencyMs: number;
  readonly status?: number;
  readonly statusText?: string;
  readonly message: string;
}

export interface DirectorComfyUiWorkflowRunInput {
  readonly prompt: string;
  readonly workflowPath?: string;
  readonly workflowJson?: unknown;
  readonly outputDir?: string;
  readonly apiKey?: string;
  readonly clientId?: string;
  readonly timeoutMs?: number;
  readonly pollIntervalMs?: number;
  readonly now?: string;
  readonly fetchImpl?: DirectorComfyUiFetch;
  readonly webSocketFactory?: DirectorComfyUiWebSocketFactory;
  readonly onProgress?: (event: DirectorComfyUiProgressEvent) => void;
}

export interface DirectorComfyUiArtifactFetchInput {
  readonly promptId?: string;
  readonly filename: string;
  readonly subfolder?: string;
  readonly type?: string;
  readonly outputDir?: string;
  readonly apiKey?: string;
  readonly timeoutMs?: number;
  readonly now?: string;
  readonly fetchImpl?: DirectorComfyUiFetch;
}

export interface DirectorComfyUiHealthInspectInput {
  readonly promptId?: string;
  readonly timeoutMs?: number;
  readonly now?: string;
  readonly fetchImpl?: DirectorComfyUiFetch;
  readonly commandExists?: (command: string) => boolean | Promise<boolean>;
}

export type DirectorComfyUiRunReadiness = "generation" | "connectivity_check" | "blocked";

export type DirectorComfyUiHealthStatus =
  | "disabled"
  | "misconfigured"
  | "needs-auth"
  | "ready"
  | "unreachable";

export interface DirectorComfyUiCliStatus {
  readonly available: boolean;
  readonly method?: "comfy" | "uvx";
  readonly command?: string;
  readonly hint?: string;
}

export interface DirectorComfyUiServerHealth {
  readonly reachable: boolean;
  readonly endpoint: string;
  readonly status?: number;
  readonly statusText?: string;
  readonly stats?: unknown;
  readonly error?: string;
}

export interface DirectorComfyUiModelFolderStatus {
  readonly folder: string;
  readonly queryable: boolean;
  readonly count: number;
  readonly firstFew: readonly string[];
  readonly endpoint: string;
  readonly status?: number;
  readonly statusText?: string;
  readonly error?: string;
}

export interface DirectorComfyUiQueueStatus {
  readonly ok: boolean;
  readonly endpoint: string;
  readonly runningCount: number;
  readonly pendingCount: number;
  readonly raw?: unknown;
  readonly status?: number;
  readonly statusText?: string;
  readonly error?: string;
}

export interface DirectorComfyUiHistoryStatus {
  readonly ok: boolean;
  readonly endpoint: string;
  readonly promptId: string;
  readonly statusStr?: string;
  readonly completed?: boolean;
  readonly outputNodeIds: readonly string[];
  readonly outputCount: number;
  readonly executionLog: readonly unknown[];
  readonly errors: readonly unknown[];
  readonly raw?: unknown;
  readonly status?: number;
  readonly statusText?: string;
  readonly error?: string;
}

export interface DirectorComfyUiHealthInspectResult {
  readonly ok: boolean;
  readonly status: DirectorComfyUiHealthStatus;
  readonly checkedAt: string;
  readonly latencyMs: number;
  readonly adapter: DirectorComfyUiAdapter;
  readonly lifecycle: {
    readonly comfyCli: DirectorComfyUiCliStatus;
    readonly server: DirectorComfyUiServerHealth;
    readonly checkpoints: DirectorComfyUiModelFolderStatus | null;
  };
  readonly modelFolders: readonly DirectorComfyUiModelFolderStatus[];
  readonly queue: DirectorComfyUiQueueStatus;
  readonly history?: DirectorComfyUiHistoryStatus;
  readonly workflow: DirectorComfyUiWorkflowInspectReport | null;
  readonly nextActions: readonly string[];
  readonly notes: readonly string[];
}

export interface DirectorComfyUiWorkflowDiagnostics {
  readonly promptNodeCount: number;
  readonly modelDependencyCount: number;
  readonly outputNodeCount: number;
  readonly modelDependencies: readonly string[];
  readonly notes: readonly string[];
}

export type DirectorComfyUiWorkflowParameterType =
  | "bool"
  | "float"
  | "int"
  | "link"
  | "object"
  | "string"
  | "unknown";

export interface DirectorComfyUiWorkflowParameter {
  readonly name: string;
  readonly nodeId: string;
  readonly field: string;
  readonly type: DirectorComfyUiWorkflowParameterType;
  readonly value: unknown;
  readonly classType: string;
  readonly aliasOf?: string;
}

export interface DirectorComfyUiWorkflowModelDependency {
  readonly nodeId: string;
  readonly classType: string;
  readonly field: string;
  readonly folder: string;
  readonly value: string;
  readonly installed?: boolean;
}

export interface DirectorComfyUiWorkflowMissingNode {
  readonly nodeId: string;
  readonly classType: string;
  readonly suggestedAction: string;
}

export interface DirectorComfyUiWorkflowInspectInput {
  readonly objectInfo?: unknown;
  readonly installedModels?: Readonly<Record<string, readonly string[]>>;
}

export interface DirectorComfyUiWorkflowInspectReport {
  readonly ok: boolean;
  readonly parameters: readonly DirectorComfyUiWorkflowParameter[];
  readonly outputNodes: readonly string[];
  readonly modelDependencies: readonly DirectorComfyUiWorkflowModelDependency[];
  readonly missingNodes: readonly DirectorComfyUiWorkflowMissingNode[];
  readonly notes: readonly string[];
  readonly summary: {
    readonly parameterCount: number;
    readonly promptNodeCount: number;
    readonly outputNodeCount: number;
    readonly modelDependencyCount: number;
    readonly missingNodeCount: number;
    readonly missingModelCount: number;
    readonly hasNegativePrompt: boolean;
    readonly hasSeed: boolean;
    readonly isVideoWorkflow: boolean;
  };
}

export interface DirectorComfyUiArtifact {
  readonly kind: "image" | "video";
  readonly filename: string;
  readonly subfolder: string;
  readonly type: string;
  readonly url: string;
  readonly localPath?: string;
}

export interface DirectorComfyUiWorkflowRunResult {
  readonly ok: boolean;
  readonly endpoint: string;
  readonly checkedAt: string;
  readonly latencyMs: number;
  readonly readiness: DirectorComfyUiRunReadiness;
  readonly promptApplied: boolean;
  readonly diagnostics: readonly string[];
  readonly workflowDiagnostics: DirectorComfyUiWorkflowDiagnostics;
  readonly promptId?: string;
  readonly artifactCount: number;
  readonly artifacts: readonly DirectorComfyUiArtifact[];
  readonly message: string;
  readonly progressMode?: "polling" | "websocket";
  readonly progressEvents?: readonly DirectorComfyUiProgressEvent[];
  readonly status?: number;
  readonly statusText?: string;
}

export interface DirectorComfyUiArtifactFetchResult {
  readonly ok: boolean;
  readonly endpoint: string;
  readonly checkedAt: string;
  readonly latencyMs: number;
  readonly artifact?: DirectorComfyUiArtifact;
  readonly artifacts: readonly DirectorComfyUiArtifact[];
  readonly message: string;
  readonly status?: number;
  readonly statusText?: string;
  readonly error?: string;
}

export type DirectorComfyUiProgressEventType =
  | "executed"
  | "executing"
  | "execution_error"
  | "execution_interrupted"
  | "execution_success"
  | "notification"
  | "progress"
  | "progress_state"
  | "unknown";

export interface DirectorComfyUiProgressEvent {
  readonly type: DirectorComfyUiProgressEventType;
  readonly promptId?: string;
  readonly node?: string;
  readonly value?: number;
  readonly max?: number;
  readonly data?: unknown;
  readonly occurredAtMs?: number;
}

export interface DirectorComfyUiWebSocketHandlers {
  readonly onMessage: (message: unknown) => void;
  readonly onError: (error: unknown) => void;
  readonly onClose: () => void;
}

export interface DirectorComfyUiWebSocketConnection {
  readonly close: () => void;
}

export type DirectorComfyUiWebSocketFactory = (
  url: string,
  handlers: DirectorComfyUiWebSocketHandlers,
) => DirectorComfyUiWebSocketConnection | Promise<DirectorComfyUiWebSocketConnection>;

export type DirectorComfyUiLifecycleAction = "restart" | "start" | "status" | "stop";

export interface DirectorComfyUiCommandPlan {
  readonly command: string;
  readonly args: readonly string[];
  readonly summary: string;
  readonly cwd?: string;
}

export interface DirectorComfyUiCommandResult {
  readonly command: string;
  readonly args: readonly string[];
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly sandbox?: DirectorComfyUiSandboxCommandEvidence;
}

export type DirectorComfyUiCommandRunner = (
  command: string,
  args: readonly string[],
  options?: { readonly cwd?: string },
) =>
  | Promise<{ readonly exitCode: number; readonly stdout?: string; readonly stderr?: string }>
  | { readonly exitCode: number; readonly stdout?: string; readonly stderr?: string };

export interface DirectorComfyUiSandboxCommandRequest {
  readonly providerId: "comfyui";
  readonly operationId: "lifecycle" | "install" | "fix_dependencies";
  readonly plan: DirectorComfyUiCommandPlan;
}

export interface DirectorComfyUiSandboxCommandEvidence {
  readonly ok: boolean;
  readonly status: string;
  readonly backend?: string;
  readonly providerId?: string;
  readonly exitCode?: number;
  readonly error?: string;
  readonly reason?: string;
  readonly evidence?: unknown;
}

export interface DirectorComfyUiSandboxCommandRunnerResult {
  readonly exitCode: number;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly sandbox: DirectorComfyUiSandboxCommandEvidence;
}

export type DirectorComfyUiSandboxCommandRunner = (
  request: DirectorComfyUiSandboxCommandRequest,
) => DirectorComfyUiSandboxCommandRunnerResult | Promise<DirectorComfyUiSandboxCommandRunnerResult>;

export interface DirectorComfyUiLifecycleActionInput {
  readonly action: DirectorComfyUiLifecycleAction;
  readonly dryRun?: boolean;
  readonly now?: string;
  readonly commandExists?: (command: string) => boolean | Promise<boolean>;
  readonly commandRunner?: DirectorComfyUiCommandRunner;
  readonly sandboxCommandRunner?: DirectorComfyUiSandboxCommandRunner;
  readonly unsafeAllowRawCommandRunner?: boolean;
}

export interface DirectorComfyUiLifecycleActionResult {
  readonly ok: boolean;
  readonly action: DirectorComfyUiLifecycleAction;
  readonly checkedAt: string;
  readonly latencyMs: number;
  readonly adapter: DirectorComfyUiAdapter;
  readonly executed: boolean;
  readonly plan: readonly DirectorComfyUiCommandPlan[];
  readonly results: readonly DirectorComfyUiCommandResult[];
  readonly message: string;
  readonly error?: string;
  readonly notes: readonly string[];
}

export interface DirectorComfyUiDependencyFixInput {
  readonly workflowPath?: string;
  readonly workflowJson?: unknown;
  readonly objectInfo?: unknown;
  readonly installedModels?: Readonly<Record<string, readonly string[]>>;
  readonly modelSources?: Readonly<Record<string, string>>;
  readonly hfToken?: string;
  readonly civitaiToken?: string;
  readonly now?: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: DirectorComfyUiFetch;
  readonly commandExists?: (command: string) => boolean | Promise<boolean>;
  readonly commandRunner?: DirectorComfyUiCommandRunner;
  readonly sandboxCommandRunner?: DirectorComfyUiSandboxCommandRunner;
  readonly unsafeAllowRawCommandRunner?: boolean;
}

export type DirectorComfyUiDependencyFixStatus =
  | "cannot-fix"
  | "cannot-fix-cloud"
  | "failed"
  | "fixed"
  | "partial"
  | "planned"
  | "ready";

export interface DirectorComfyUiDependencyFixAction {
  readonly kind: "embedding" | "model" | "node";
  readonly command: DirectorComfyUiCommandPlan;
  readonly nodeId?: string;
  readonly classType?: string;
  readonly packageName?: string;
  readonly folder?: string;
  readonly filename?: string;
  readonly url?: string;
}

export interface DirectorComfyUiDependencyFixFailure {
  readonly kind: "embedding" | "model" | "node";
  readonly reason: string;
  readonly nodeId?: string;
  readonly classType?: string;
  readonly folder?: string;
  readonly filename?: string;
}

export interface DirectorComfyUiDependencyFixResult {
  readonly ok: boolean;
  readonly status: DirectorComfyUiDependencyFixStatus;
  readonly checkedAt: string;
  readonly latencyMs: number;
  readonly adapter: DirectorComfyUiAdapter;
  readonly dryRun: boolean;
  readonly workflow: DirectorComfyUiWorkflowInspectReport | null;
  readonly actions: readonly DirectorComfyUiDependencyFixAction[];
  readonly failures: readonly DirectorComfyUiDependencyFixFailure[];
  readonly results: readonly DirectorComfyUiCommandResult[];
  readonly needsServerRestart: boolean;
  readonly message: string;
  readonly notes: readonly string[];
}

export type DirectorComfyUiInstallStatus =
  | "cannot-install-cloud"
  | "failed"
  | "installed"
  | "missing-installer"
  | "partial"
  | "planned";

export interface DirectorComfyUiInstallInput {
  readonly dryRun?: boolean;
  readonly gpuFlag?: "--nvidia" | "--amd" | "--m-series" | "--cpu";
  readonly skipLaunch?: boolean;
  readonly forceCloudOverride?: boolean;
  readonly now?: string;
  readonly commandExists?: (command: string) => boolean | Promise<boolean>;
  readonly commandRunner?: DirectorComfyUiCommandRunner;
  readonly sandboxCommandRunner?: DirectorComfyUiSandboxCommandRunner;
  readonly unsafeAllowRawCommandRunner?: boolean;
}

export interface DirectorComfyUiInstallResult {
  readonly ok: boolean;
  readonly status: DirectorComfyUiInstallStatus;
  readonly checkedAt: string;
  readonly latencyMs: number;
  readonly adapter: DirectorComfyUiAdapter;
  readonly dryRun: boolean;
  readonly executed: boolean;
  readonly plan: readonly DirectorComfyUiCommandPlan[];
  readonly results: readonly DirectorComfyUiCommandResult[];
  readonly message: string;
  readonly notes: readonly string[];
}

interface DirectorComfyUiFetchInit {
  readonly method: "GET" | "POST";
  readonly headers: Record<string, string>;
  readonly body?: string;
  readonly signal?: AbortSignal;
}

type DirectorComfyUiFetch = (
  url: string,
  init: DirectorComfyUiFetchInit,
) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  readonly statusText: string;
  text(): Promise<string>;
  arrayBuffer?(): Promise<ArrayBuffer>;
}>;

interface StoredDirectorComfyUiAdapter {
  readonly enabled?: boolean;
  readonly mode?: DirectorComfyUiMode;
  readonly apiKey?: string;
  readonly apiKeyEnvVar?: string;
  readonly baseUrl?: string;
  readonly localInstallPath?: string;
  readonly defaultWorkflowPath?: string;
  readonly outputDir?: string;
  readonly positivePromptNodeId?: string;
  readonly positivePromptInputName?: string;
  readonly negativePromptNodeId?: string;
  readonly negativePromptInputName?: string;
}

interface StoredDirectorComfyUiConfigDocument {
  readonly schemaVersion: typeof DIRECTOR_COMFYUI_CONFIG_SCHEMA_VERSION;
  readonly updatedAt: string;
  readonly adapter: StoredDirectorComfyUiAdapter;
}

const COMFYUI_ENDPOINTS = [
  {
    id: "health",
    label: "System Stats",
    method: "GET",
    path: "/system_stats",
    notes: ["本地 ComfyUI 健康检查接口。"],
  },
  {
    id: "object_info",
    label: "Object Info",
    method: "GET",
    path: "/object_info",
    notes: ["读取节点类型和输入 schema，用于后续 workflow 校验。"],
  },
  {
    id: "prompt",
    label: "Prompt Queue",
    method: "POST",
    path: "/prompt",
    notes: ["提交 ComfyUI workflow graph。Cloud 模式会使用 /api/prompt。"],
  },
  {
    id: "history",
    label: "History",
    method: "GET",
    path: "/history/{prompt_id}",
    notes: ["轮询 prompt 执行产物。Cloud 模式会使用 /api/history/{prompt_id}。"],
  },
  {
    id: "view",
    label: "View Output",
    method: "GET",
    path: "/view",
    notes: ["下载图片或视频产物。Cloud 模式会使用 /api/view。"],
  },
  {
    id: "upload_image",
    label: "Upload Image",
    method: "POST",
    path: "/upload/image",
    notes: ["上传参考图。Cloud 模式会使用 /api/upload/image。"],
  },
] as const satisfies readonly DirectorComfyUiEndpoint[];

const EMPTY_WORKFLOW_DIAGNOSTICS: DirectorComfyUiWorkflowDiagnostics = Object.freeze({
  promptNodeCount: 0,
  modelDependencyCount: 0,
  outputNodeCount: 0,
  modelDependencies: [],
  notes: [],
});

const MODEL_DEPENDENCY_FIELDS: ReadonlyMap<string, readonly [string, string][]> = new Map([
  ["CheckpointLoaderSimple", [["ckpt_name", "checkpoints"]]],
  ["LoraLoader", [["lora_name", "loras"]]],
  ["LoraLoaderModelOnly", [["lora_name", "loras"]]],
  ["VAELoader", [["vae_name", "vae"]]],
  ["ControlNetLoader", [["control_net_name", "controlnet"]]],
  ["CLIPLoader", [["clip_name", "clip"]]],
  [
    "DualCLIPLoader",
    [
      ["clip_name1", "clip"],
      ["clip_name2", "clip"],
    ],
  ],
  [
    "TripleCLIPLoader",
    [
      ["clip_name1", "clip"],
      ["clip_name2", "clip"],
      ["clip_name3", "clip"],
    ],
  ],
  ["UNETLoader", [["unet_name", "unet"]]],
  ["DiffusionModelLoader", [["model_name", "diffusion_models"]]],
  ["UpscaleModelLoader", [["model_name", "upscale_models"]]],
  ["IPAdapterModelLoader", [["ipadapter_file", "ipadapter"]]],
  ["ADE_AnimateDiffLoaderWithContext", [["model_name", "animatediff_models"]]],
]);

const OUTPUT_NODE_PATTERN =
  /^(SaveImage|PreviewImage|SaveAudio|VHS_VideoCombine|SaveAnimatedWEBP|SaveAnimatedPNG|Save3D)$/u;

const VIDEO_NODE_PATTERN =
  /^(VHS_VideoCombine|SaveVideo|SaveAnimatedWEBP|SaveAnimatedPNG|WanTextToVideoApi|Wan2ImageToVideoApi)$/u;

const PARAMETER_PATTERNS: readonly {
  readonly classPattern: RegExp;
  readonly field: string;
  readonly name: string;
}[] = [
  { classPattern: /CLIPTextEncode|TextEncode|Prompt/iu, field: "text", name: "prompt" },
  { classPattern: /KSampler|Sampler/iu, field: "seed", name: "seed" },
  { classPattern: /KSampler|Sampler/iu, field: "steps", name: "steps" },
  { classPattern: /KSampler|Sampler/iu, field: "cfg", name: "cfg" },
  { classPattern: /KSampler|Sampler/iu, field: "sampler_name", name: "sampler" },
  { classPattern: /KSampler|Sampler/iu, field: "scheduler", name: "scheduler" },
  { classPattern: /KSampler|Sampler/iu, field: "denoise", name: "denoise" },
  { classPattern: /EmptyLatentImage|EmptySD3LatentImage/iu, field: "width", name: "width" },
  { classPattern: /EmptyLatentImage|EmptySD3LatentImage/iu, field: "height", name: "height" },
  {
    classPattern: /EmptyLatentImage|EmptySD3LatentImage/iu,
    field: "batch_size",
    name: "batch_size",
  },
  { classPattern: /CheckpointLoaderSimple/iu, field: "ckpt_name", name: "checkpoint" },
  { classPattern: /LoraLoader|LoraLoaderModelOnly/iu, field: "lora_name", name: "lora" },
  { classPattern: /VAELoader/iu, field: "vae_name", name: "vae" },
];

const SAMPLER_NODE_FAMILY = new Set([
  "KSampler",
  "KSamplerAdvanced",
  "SamplerCustom",
  "SamplerCustomAdvanced",
  "BasicGuider",
  "CFGGuider",
  "DualCFGGuider",
]);

const EMBEDDING_REFERENCE_PATTERN = /\bembedding:([A-Za-z0-9_.\-\/]+)/giu;

const COMFYUI_NODE_TO_PACKAGE: Readonly<Record<string, string>> = Object.freeze({
  ADE_AnimateDiffLoaderGen1: "comfyui-animatediff-evolved",
  ADE_AnimateDiffLoaderWithContext: "comfyui-animatediff-evolved",
  ADE_LoadAnimateDiffModel: "comfyui-animatediff-evolved",
  AnimalPosePreprocessor: "comfyui_controlnet_aux",
  ApplyInstantID: "comfyui_instantid",
  BboxDetectorSEGS: "comfyui-impact-pack",
  CannyEdgePreprocessor: "comfyui_controlnet_aux",
  DWPreprocessor: "comfyui_controlnet_aux",
  DepthAnythingPreprocessor: "comfyui_controlnet_aux",
  DetailerForEach: "comfyui-impact-pack",
  "Display Any (rgthree)": "rgthree-comfy",
  "Display Int (rgthree)": "rgthree-comfy",
  DualCLIPLoaderGGUF: "ComfyUI-GGUF",
  FaceDetailer: "comfyui-impact-pack",
  Florence2Run: "comfyui-florence2",
  "GetImageSize+": "comfyui_essentials",
  IPAdapterAdvanced: "comfyui_ipadapter_plus",
  IPAdapterInsightFaceLoader: "comfyui_ipadapter_plus",
  IPAdapterModelLoader: "comfyui_ipadapter_plus",
  IPAdapterUnifiedLoader: "comfyui_ipadapter_plus",
  "Image Comparer (rgthree)": "rgthree-comfy",
  "Image Filter Adjustments": "was-node-suite-comfyui",
  "Image Save": "was-node-suite-comfyui",
  "ImageBatchMultiple+": "comfyui_essentials",
  ImpactWildcardProcessor: "comfyui-impact-pack",
  InstantIDModelLoader: "comfyui_instantid",
  "Number Counter": "was-node-suite-comfyui",
  OpenposePreprocessor: "comfyui_controlnet_aux",
  PhotoMakerLoader: "ComfyUI-PhotoMaker-Plus",
  "Power Lora Loader (rgthree)": "rgthree-comfy",
  "PreviewImage|pysssss": "comfyui-custom-scripts",
  SAMLoader: "comfyui-impact-pack",
  SUPIR_Upscale: "comfyui-supir",
  SUPIR_first_stage: "comfyui-supir",
  "Seed (rgthree)": "rgthree-comfy",
  "ShowText|pysssss": "comfyui-custom-scripts",
  "Text String": "was-node-suite-comfyui",
  UNETLoaderGGUF: "ComfyUI-GGUF",
  UltralyticsDetectorProvider: "comfyui-impact-subpack",
  VHS_LoadAudio: "comfyui-videohelpersuite",
  VHS_LoadVideo: "comfyui-videohelpersuite",
  VHS_VideoCombine: "comfyui-videohelpersuite",
  WanVideoModelLoader: "ComfyUI-WanVideoWrapper",
  WanVideoSampler: "ComfyUI-WanVideoWrapper",
  Zoe_DepthAnythingPreprocessor: "comfyui_controlnet_aux",
  "easy fullLoader": "comfyui-easy-use",
  "easy imageSave": "comfyui-easy-use",
  "easy negative": "comfyui-easy-use",
  "easy positive": "comfyui-easy-use",
  "easy seed": "comfyui-easy-use",
});

export function loadDirectorComfyUiConfig(rootPath: string): LoadDirectorComfyUiConfigResult {
  const path = configPath(rootPath);
  const notes: string[] = [];
  const issues: string[] = [];
  let source: "defaults" | "file" = "defaults";
  let stored = defaultStoredAdapter(rootPath);
  let updatedAt = new Date(0).toISOString();

  if (existsSync(path)) {
    try {
      const parsed = parseStoredDocument(JSON.parse(readFileSync(path, "utf8")) as unknown);
      stored = { ...stored, ...parsed.adapter };
      updatedAt = parsed.updatedAt;
      source = "file";
      notes.push("Loaded ComfyUI external tool configuration.");
    } catch (error) {
      issues.push(`Failed to load ComfyUI config: ${toErrorMessage(error)}.`);
      notes.push("ComfyUI config could not be parsed; using built-in local defaults.");
    }
  } else {
    notes.push("ComfyUI config not found; using disabled local external-tool defaults.");
  }

  return {
    document: {
      schemaVersion: DIRECTOR_COMFYUI_CONFIG_SCHEMA_VERSION,
      updatedAt,
      adapter: createComfyUiAdapter(rootPath, stored),
    },
    configPath: path,
    source,
    notes,
    issues,
  };
}

export async function updateDirectorComfyUiSetting(
  rootPath: string,
  update: DirectorComfyUiSettingUpdate,
): Promise<LoadDirectorComfyUiConfigResult> {
  const existing = loadStoredDocument(rootPath);
  const now = update.now ?? new Date().toISOString();
  const adapter = applyComfyUiSetting(existing.adapter, update);

  await writeStoredDocument(rootPath, {
    schemaVersion: DIRECTOR_COMFYUI_CONFIG_SCHEMA_VERSION,
    updatedAt: now,
    adapter,
  });

  return loadDirectorComfyUiConfig(rootPath);
}

export async function testDirectorComfyUiConnection(
  rootPath: string,
  input: DirectorComfyUiConnectionTestInput = {},
): Promise<DirectorComfyUiConnectionTestResult> {
  const startedAt = Date.now();
  const checkedAt = input.now ?? new Date().toISOString();
  const stored = loadStoredDocument(rootPath).adapter;
  const adapter = createComfyUiAdapter(rootPath, stored);
  const baseUrl = normalizeBaseUrl(input.baseUrl ?? adapter.baseUrl);
  const endpoint = buildEndpoint(baseUrl, adapter.mode, "/system_stats");

  if (!adapter.enabled) {
    return connectionTestResult({
      checkedAt,
      startedAt,
      endpoint,
      ok: false,
      message: "ComfyUI 外部工具已停用，先启用后再测试。",
    });
  }

  const apiKey = resolveApiKey(input.apiKey, stored.apiKey, adapter.apiKeyEnvVar);
  if (adapter.mode === "cloud" && !apiKey) {
    return connectionTestResult({
      checkedAt,
      startedAt,
      endpoint,
      ok: false,
      message: "Cloud ComfyUI 需要 API Key。",
    });
  }

  const fetchImpl = input.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    return connectionTestResult({
      checkedAt,
      startedAt,
      endpoint,
      ok: false,
      message: "当前运行环境没有 fetch，无法测试 ComfyUI。",
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, input.timeoutMs ?? 12_000);

  try {
    const response = await fetchImpl(endpoint, {
      method: "GET",
      headers: buildHeaders(apiKey, false),
      signal: controller.signal,
    });
    return connectionTestResult({
      checkedAt,
      startedAt,
      endpoint,
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      message: response.ok
        ? "ComfyUI 连接成功。"
        : `ComfyUI 连接失败：HTTP ${response.status} ${response.statusText || ""}`.trim(),
    });
  } catch (error) {
    return connectionTestResult({
      checkedAt,
      startedAt,
      endpoint,
      ok: false,
      message: `ComfyUI 连接失败：${toErrorMessage(error)}。`,
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function runDirectorComfyUiWorkflow(
  rootPath: string,
  input: DirectorComfyUiWorkflowRunInput,
): Promise<DirectorComfyUiWorkflowRunResult> {
  const startedAt = Date.now();
  const checkedAt = input.now ?? new Date().toISOString();
  const stored = loadStoredDocument(rootPath).adapter;
  const adapter = createComfyUiAdapter(rootPath, stored);
  const endpoint = buildEndpoint(adapter.baseUrl, adapter.mode, "/prompt");
  const outputDir = input.outputDir?.trim() || adapter.outputDir;
  const clientId = input.clientId ?? `director-angel-${Date.now()}`;

  if (!adapter.enabled) {
    return workflowRunResult({
      checkedAt,
      startedAt,
      endpoint,
      ok: false,
      readiness: "blocked",
      promptApplied: false,
      diagnostics: ["ComfyUI 外部工具已停用。"],
      workflowDiagnostics: EMPTY_WORKFLOW_DIAGNOSTICS,
      artifacts: [],
      message: "ComfyUI 外部工具已停用，未发起生成。",
    });
  }

  const prompt = input.prompt.trim();
  if (!prompt) {
    return workflowRunResult({
      checkedAt,
      startedAt,
      endpoint,
      ok: false,
      readiness: "blocked",
      promptApplied: false,
      diagnostics: ["ComfyUI 提示词为空。"],
      workflowDiagnostics: EMPTY_WORKFLOW_DIAGNOSTICS,
      artifacts: [],
      message: "ComfyUI 提示词为空，未发起生成。",
    });
  }

  const workflowLoad = loadWorkflow(
    input.workflowJson,
    input.workflowPath || adapter.defaultWorkflowPath,
  );
  if (!workflowLoad.ok) {
    return workflowRunResult({
      checkedAt,
      startedAt,
      endpoint,
      ok: false,
      readiness: "blocked",
      promptApplied: false,
      diagnostics: [workflowLoad.message],
      workflowDiagnostics: EMPTY_WORKFLOW_DIAGNOSTICS,
      artifacts: [],
      message: workflowLoad.message,
    });
  }
  const workflowDiagnostics = analyzeWorkflow(workflowLoad.workflow);

  const apiKey = resolveApiKey(input.apiKey, stored.apiKey, adapter.apiKeyEnvVar);
  if (adapter.mode === "cloud" && !apiKey) {
    return workflowRunResult({
      checkedAt,
      startedAt,
      endpoint,
      ok: false,
      readiness: "blocked",
      promptApplied: false,
      diagnostics: ["Cloud ComfyUI 需要 API Key。"],
      workflowDiagnostics,
      artifacts: [],
      message: "Cloud ComfyUI 需要 API Key，未发起生成。",
    });
  }

  const fetchImpl = input.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    return workflowRunResult({
      checkedAt,
      startedAt,
      endpoint,
      ok: false,
      readiness: "blocked",
      promptApplied: false,
      diagnostics: ["当前运行环境没有 fetch。"],
      workflowDiagnostics,
      artifacts: [],
      message: "当前运行环境没有 fetch，无法运行 ComfyUI workflow。",
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, input.timeoutMs ?? 180_000);

  try {
    const promptPatch = applyPromptToWorkflow(workflowLoad.workflow, prompt, adapter);
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: buildHeaders(apiKey, true),
      body: JSON.stringify({
        prompt: promptPatch.workflow,
        client_id: clientId,
      }),
      signal: controller.signal,
    });
    const body = await response.text();
    const promptResponse = parsePromptResponse(body);
    const nodeErrorSummary = summarizeNodeErrors(promptResponse.nodeErrors);
    if (!response.ok || !promptResponse.promptId || nodeErrorSummary.length > 0) {
      const diagnostics = [
        ...diagnoseWorkflowReadiness(workflowDiagnostics, promptPatch.promptApplied),
        ...nodeErrorSummary,
      ];
      return workflowRunResult({
        checkedAt,
        startedAt,
        endpoint,
        ok: false,
        readiness: "blocked",
        promptApplied: promptPatch.promptApplied,
        status: response.status,
        statusText: response.statusText,
        diagnostics,
        workflowDiagnostics,
        artifacts: [],
        message: formatPromptSubmitFailure(response, promptResponse, diagnostics),
      });
    }

    const progress = await monitorComfyUiWorkflowProgress({
      adapter,
      apiKey,
      promptId: promptResponse.promptId,
      clientId,
      timeoutMs: input.timeoutMs ?? 180_000,
      webSocketFactory: input.webSocketFactory,
      onProgress: input.onProgress,
    });

    const artifacts = await pollAndDownloadArtifacts({
      adapter,
      apiKey,
      baseUrl: adapter.baseUrl,
      promptId: promptResponse.promptId,
      outputDir,
      fetchImpl,
      signal: controller.signal,
      startedAt,
      timeoutMs: input.timeoutMs ?? 180_000,
      pollIntervalMs: input.pollIntervalMs ?? 1000,
    });

    return workflowRunResult({
      checkedAt,
      startedAt,
      endpoint,
      ok: artifacts.length > 0,
      readiness: promptPatch.promptApplied ? "generation" : "connectivity_check",
      promptApplied: promptPatch.promptApplied,
      promptId: promptResponse.promptId,
      diagnostics: diagnoseWorkflowReadiness(workflowDiagnostics, promptPatch.promptApplied),
      workflowDiagnostics,
      artifacts,
      status: response.status,
      statusText: response.statusText,
      progressMode: progress.mode,
      progressEvents: progress.events,
      message: formatWorkflowRunMessage(
        artifacts.length,
        promptPatch.promptApplied,
        workflowDiagnostics,
      ),
    });
  } catch (error) {
    return workflowRunResult({
      checkedAt,
      startedAt,
      endpoint,
      ok: false,
      readiness: "blocked",
      promptApplied: false,
      diagnostics: [`ComfyUI 运行失败：${toErrorMessage(error)}。`],
      workflowDiagnostics,
      artifacts: [],
      message: `ComfyUI 运行失败：${toErrorMessage(error)}。`,
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchDirectorComfyUiArtifact(
  rootPath: string,
  input: DirectorComfyUiArtifactFetchInput,
): Promise<DirectorComfyUiArtifactFetchResult> {
  const startedAt = Date.now();
  const checkedAt = input.now ?? new Date().toISOString();
  const stored = loadStoredDocument(rootPath).adapter;
  const adapter = createComfyUiAdapter(rootPath, stored);
  const filename = input.filename.trim();
  const subfolder = input.subfolder?.trim() ?? "";
  const type = input.type?.trim() || "output";
  const endpoint = filename
    ? buildViewUrl(adapter.baseUrl, adapter.mode, filename, subfolder, type)
    : buildEndpoint(adapter.baseUrl, adapter.mode, "/view");
  const outputDir = input.outputDir?.trim() || adapter.outputDir;

  if (!adapter.enabled) {
    return artifactFetchResult({
      checkedAt,
      startedAt,
      endpoint,
      ok: false,
      artifacts: [],
      message: "ComfyUI 外部工具已停用，未下载产物。",
      error: "COMFYUI_DISABLED",
    });
  }
  if (!filename) {
    return artifactFetchResult({
      checkedAt,
      startedAt,
      endpoint,
      ok: false,
      artifacts: [],
      message: "ComfyUI artifact.fetch 缺少 filename。",
      error: "COMFYUI_ARTIFACT_FILENAME_REQUIRED",
    });
  }

  const apiKey = resolveApiKey(input.apiKey, stored.apiKey, adapter.apiKeyEnvVar);
  if (adapter.mode === "cloud" && !apiKey) {
    return artifactFetchResult({
      checkedAt,
      startedAt,
      endpoint,
      ok: false,
      artifacts: [],
      message: "Cloud ComfyUI 需要 API Key，未下载产物。",
      error: "COMFYUI_API_KEY_REQUIRED",
    });
  }

  const fetchImpl = input.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    return artifactFetchResult({
      checkedAt,
      startedAt,
      endpoint,
      ok: false,
      artifacts: [],
      message: "当前运行环境没有 fetch，无法下载 ComfyUI 产物。",
      error: "FETCH_UNAVAILABLE",
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, input.timeoutMs ?? 60_000);

  try {
    const artifact = await downloadArtifact({
      artifact: {
        kind: inferComfyUiArtifactKind(filename),
        filename,
        subfolder,
        type,
        url: endpoint,
      },
      promptId: input.promptId?.trim() || "artifact",
      outputDir,
      apiKey,
      fetchImpl,
      signal: controller.signal,
    });
    if (artifact.localPath === undefined) {
      return artifactFetchResult({
        checkedAt,
        startedAt,
        endpoint,
        ok: false,
        artifacts: [artifact],
        message: "ComfyUI artifact.fetch 未能下载产物。",
        status: 502,
        error: "COMFYUI_ARTIFACT_DOWNLOAD_FAILED",
      });
    }
    return artifactFetchResult({
      checkedAt,
      startedAt,
      endpoint,
      ok: true,
      artifacts: [artifact],
      message: "ComfyUI artifact.fetch 已下载 1 个产物。",
    });
  } catch (error) {
    return artifactFetchResult({
      checkedAt,
      startedAt,
      endpoint,
      ok: false,
      artifacts: [],
      message: `ComfyUI artifact.fetch 失败：${toErrorMessage(error)}。`,
      error: toErrorMessage(error),
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function inspectDirectorComfyUiHealth(
  rootPath: string,
  input: DirectorComfyUiHealthInspectInput = {},
): Promise<DirectorComfyUiHealthInspectResult> {
  const startedAt = Date.now();
  const checkedAt = input.now ?? new Date().toISOString();
  const stored = loadStoredDocument(rootPath).adapter;
  const adapter = createComfyUiAdapter(rootPath, stored);
  const apiKey = resolveApiKey(undefined, stored.apiKey, adapter.apiKeyEnvVar);
  const fetchImpl = input.fetchImpl ?? globalThis.fetch;
  const notes: string[] = [];

  const comfyCli = await inspectComfyUiCliStatus(input.commandExists);
  if (!comfyCli.available) {
    notes.push("comfy-cli 不在 PATH；生命周期、节点安装和模型下载需要先安装 comfy-cli。");
  }

  if (!adapter.enabled) {
    return {
      ok: false,
      status: "disabled",
      checkedAt,
      latencyMs: Math.max(0, Date.now() - startedAt),
      adapter,
      lifecycle: {
        comfyCli,
        server: {
          reachable: false,
          endpoint: buildEndpoint(adapter.baseUrl, adapter.mode, "/system_stats"),
          error: "ComfyUI 外部工具已停用。",
        },
        checkpoints: null,
      },
      modelFolders: [],
      queue: {
        ok: false,
        endpoint: buildEndpoint(adapter.baseUrl, adapter.mode, "/queue"),
        runningCount: 0,
        pendingCount: 0,
        error: "ComfyUI 外部工具已停用。",
      },
      workflow: null,
      nextActions: ["在设置里启用 ComfyUI 外部工具"],
      notes,
    };
  }

  const workflowLoad = loadWorkflow(undefined, adapter.defaultWorkflowPath);
  const objectInfo = await fetchComfyUiJson({
    adapter,
    apiKey,
    fetchImpl,
    path: "/object_info",
    timeoutMs: input.timeoutMs,
  });
  const checkpoints = await fetchComfyUiModelFolderStatus({
    adapter,
    apiKey,
    fetchImpl,
    folder: "checkpoints",
    timeoutMs: input.timeoutMs,
  });
  const installedModels: Record<string, readonly string[]> = {};
  if (checkpoints.queryable) {
    installedModels.checkpoints = checkpoints.firstFew;
  }
  const workflow =
    workflowLoad.ok && isRecord(workflowLoad.workflow)
      ? inspectDirectorComfyUiWorkflow(workflowLoad.workflow, {
          objectInfo: objectInfo.ok ? objectInfo.data : undefined,
          installedModels,
        })
      : null;
  if (!workflowLoad.ok && adapter.defaultWorkflowPath.trim().length > 0) {
    notes.push(workflowLoad.message);
  }

  const server = await fetchComfyUiServerHealth({
    adapter,
    apiKey,
    fetchImpl,
    timeoutMs: input.timeoutMs,
  });
  const queue = await fetchComfyUiQueueStatus({
    adapter,
    apiKey,
    fetchImpl,
    timeoutMs: input.timeoutMs,
  });
  const history =
    input.promptId && input.promptId.trim().length > 0
      ? await fetchComfyUiHistoryStatus({
          adapter,
          apiKey,
          fetchImpl,
          promptId: input.promptId.trim(),
          timeoutMs: input.timeoutMs,
        })
      : undefined;

  const status = resolveComfyUiHealthStatus({
    adapter,
    apiKey,
    server,
    workflow,
  });
  const nextActions = createComfyUiHealthNextActions({
    adapter,
    status,
    comfyCli,
    server,
    checkpoints,
    workflow,
  });

  return {
    ok: status === "ready",
    status,
    checkedAt,
    latencyMs: Math.max(0, Date.now() - startedAt),
    adapter,
    lifecycle: {
      comfyCli,
      server,
      checkpoints,
    },
    modelFolders: checkpoints.queryable ? [checkpoints] : [],
    queue,
    ...(history === undefined ? {} : { history }),
    workflow,
    nextActions,
    notes,
  };
}

export async function runDirectorComfyUiLifecycleAction(
  rootPath: string,
  input: DirectorComfyUiLifecycleActionInput,
): Promise<DirectorComfyUiLifecycleActionResult> {
  const startedAt = Date.now();
  const checkedAt = input.now ?? new Date().toISOString();
  const stored = loadStoredDocument(rootPath).adapter;
  const adapter = createComfyUiAdapter(rootPath, stored);
  const notes: string[] = [];

  if (adapter.mode === "cloud") {
    return lifecycleActionResult({
      startedAt,
      checkedAt,
      adapter,
      action: input.action,
      ok: false,
      executed: false,
      plan: [],
      results: [],
      message: "Cloud ComfyUI 由外部服务管理，Angel 不执行本地生命周期命令。",
      notes,
    });
  }

  const comfyCli = await inspectComfyUiCliStatus(input.commandExists);
  if (!comfyCli.available || !comfyCli.command) {
    return lifecycleActionResult({
      startedAt,
      checkedAt,
      adapter,
      action: input.action,
      ok: false,
      executed: false,
      plan: [],
      results: [],
      message: "comfy-cli 不可用，无法执行 ComfyUI 生命周期命令。",
      error: "comfy-cli-missing",
      notes: [comfyCli.hint ?? "安装 comfy-cli 后再试。"],
    });
  }

  const plan = createComfyUiLifecycleCommandPlan(adapter, comfyCli, input.action);
  if (input.dryRun === true) {
    return lifecycleActionResult({
      startedAt,
      checkedAt,
      adapter,
      action: input.action,
      ok: true,
      executed: false,
      plan,
      results: [],
      message: `ComfyUI ${input.action} 命令计划已生成，等待确认执行。`,
      notes,
    });
  }

  if (input.sandboxCommandRunner === undefined && input.unsafeAllowRawCommandRunner !== true) {
    return lifecycleActionResult({
      startedAt,
      checkedAt,
      adapter,
      action: input.action,
      ok: false,
      executed: false,
      plan,
      results: [],
      message: "ComfyUI 本地命令需要 Agent OS 沙箱执行器；未执行裸 commandRunner。",
      error: "sandbox-command-runner-required",
      notes,
    });
  }

  const results: DirectorComfyUiCommandResult[] = [];
  for (const commandPlan of plan) {
    const result = await runComfyUiCommandPlan(commandPlan, {
      operationId: "lifecycle",
      commandRunner: input.commandRunner,
      sandboxCommandRunner: input.sandboxCommandRunner,
      ...(input.unsafeAllowRawCommandRunner === undefined
        ? {}
        : { unsafeAllowRawCommandRunner: input.unsafeAllowRawCommandRunner }),
    });
    results.push(result);
    if (result.exitCode !== 0) {
      return lifecycleActionResult({
        startedAt,
        checkedAt,
        adapter,
        action: input.action,
        ok: false,
        executed: true,
        plan,
        results,
        message: `ComfyUI ${input.action} 执行失败：${result.stderr || result.stdout || `exit ${result.exitCode}`}。`,
        error: result.sandbox?.ok === false ? "sandbox-command-failed" : "command-failed",
        notes,
      });
    }
  }

  return lifecycleActionResult({
    startedAt,
    checkedAt,
    adapter,
    action: input.action,
    ok: true,
    executed: true,
    plan,
    results,
    message: `ComfyUI ${input.action} 已执行。`,
    notes,
  });
}

export async function planDirectorComfyUiInstall(
  rootPath: string,
  input: DirectorComfyUiInstallInput = {},
): Promise<DirectorComfyUiInstallResult> {
  return resolveDirectorComfyUiInstall(rootPath, { ...input, dryRun: true });
}

export async function runDirectorComfyUiInstall(
  rootPath: string,
  input: DirectorComfyUiInstallInput = {},
): Promise<DirectorComfyUiInstallResult> {
  return resolveDirectorComfyUiInstall(rootPath, { ...input, dryRun: false });
}

export async function planDirectorComfyUiDependencyFix(
  rootPath: string,
  input: DirectorComfyUiDependencyFixInput = {},
): Promise<DirectorComfyUiDependencyFixResult> {
  return resolveDirectorComfyUiDependencyFix(rootPath, { ...input, dryRun: true });
}

export async function runDirectorComfyUiDependencyFix(
  rootPath: string,
  input: DirectorComfyUiDependencyFixInput = {},
): Promise<DirectorComfyUiDependencyFixResult> {
  return resolveDirectorComfyUiDependencyFix(rootPath, { ...input, dryRun: false });
}

export function inspectDirectorComfyUiWorkflow(
  workflowJson: unknown,
  input: DirectorComfyUiWorkflowInspectInput = {},
): DirectorComfyUiWorkflowInspectReport {
  const workflow = unwrapWorkflow(workflowJson);
  const objectInfoClasses = extractObjectInfoClasses(input.objectInfo);
  const installedModels = normalizeInstalledModels(input.installedModels);
  const positivePromptNodeId = findLinkedPromptNode(workflow, "positive");
  const negativePromptNodeId = findLinkedPromptNode(workflow, "negative");
  const outputNodes: string[] = [];
  const missingNodes: DirectorComfyUiWorkflowMissingNode[] = [];
  const rawParameters: Array<
    Omit<DirectorComfyUiWorkflowParameter, "name"> & { nameHint: string }
  > = [];
  const modelDependencies: DirectorComfyUiWorkflowModelDependency[] = [];
  let promptNodeCount = 0;
  let isVideoWorkflow = false;

  for (const [nodeId, node] of Object.entries(workflow)) {
    if (!isRecord(node)) {
      continue;
    }
    const classType = typeof node.class_type === "string" ? node.class_type : "";
    const inputs = isRecord(node.inputs) ? node.inputs : {};
    if (!classType) {
      continue;
    }
    if (objectInfoClasses && !objectInfoClasses.has(classType)) {
      missingNodes.push({
        nodeId,
        classType,
        suggestedAction: `安装包含 ${classType} 的 ComfyUI custom node。`,
      });
    }
    if (isPromptNode(classType, inputs)) {
      promptNodeCount += 1;
    }
    if (OUTPUT_NODE_PATTERN.test(classType)) {
      outputNodes.push(nodeId);
    }
    if (VIDEO_NODE_PATTERN.test(classType)) {
      isVideoWorkflow = true;
    }

    for (const pattern of PARAMETER_PATTERNS) {
      if (!pattern.classPattern.test(classType) || !(pattern.field in inputs)) {
        continue;
      }
      const value = inputs[pattern.field];
      const parameterType = inferWorkflowParameterType(value);
      if (parameterType === "link") {
        continue;
      }
      const nameHint =
        pattern.name === "prompt" && nodeId === negativePromptNodeId
          ? "negative_prompt"
          : pattern.name === "prompt" && positivePromptNodeId && nodeId === positivePromptNodeId
            ? "prompt"
            : pattern.name;
      rawParameters.push({
        nameHint,
        nodeId,
        field: pattern.field,
        type: parameterType,
        value,
        classType,
      });
    }

    const dependencyFields = MODEL_DEPENDENCY_FIELDS.get(classType) ?? [];
    for (const [fieldName, folder] of dependencyFields) {
      const value = inputs[fieldName];
      if (typeof value !== "string" || value.trim().length === 0) {
        continue;
      }
      modelDependencies.push(
        createWorkflowModelDependency({
          nodeId,
          classType,
          field: fieldName,
          folder,
          value: value.trim(),
          installedModels,
        }),
      );
    }

    for (const [fieldName, value] of Object.entries(inputs)) {
      if (typeof value !== "string") {
        continue;
      }
      for (const embeddingName of extractEmbeddingReferences(value)) {
        modelDependencies.push(
          createWorkflowModelDependency({
            nodeId,
            classType,
            field: fieldName,
            folder: "embeddings",
            value: embeddingName,
            installedModels,
          }),
        );
      }
    }
  }

  const parameters = finalizeWorkflowParameters(rawParameters);
  const uniqueModelDependencies = dedupeWorkflowModelDependencies(modelDependencies);
  const missingModelCount = uniqueModelDependencies.filter(
    (dependency) => dependency.installed === false,
  ).length;
  const notes = createWorkflowInspectNotes({
    missingNodeCount: missingNodes.length,
    missingModelCount,
    promptNodeCount,
    outputNodeCount: outputNodes.length,
  });

  return {
    ok: missingNodes.length === 0 && missingModelCount === 0,
    parameters,
    outputNodes,
    modelDependencies: uniqueModelDependencies,
    missingNodes,
    notes,
    summary: {
      parameterCount: parameters.length,
      promptNodeCount,
      outputNodeCount: outputNodes.length,
      modelDependencyCount: uniqueModelDependencies.length,
      missingNodeCount: missingNodes.length,
      missingModelCount,
      hasNegativePrompt: parameters.some((parameter) => parameter.name === "negative_prompt"),
      hasSeed: parameters.some(
        (parameter) => parameter.name === "seed" || parameter.aliasOf === "seed",
      ),
      isVideoWorkflow,
    },
  };
}

function createComfyUiAdapter(
  rootPath: string,
  stored: StoredDirectorComfyUiAdapter,
): DirectorComfyUiAdapter {
  const apiKeyEnvVar = stored.apiKeyEnvVar ?? "COMFYUI_API_KEY";
  const secret = resolveApiKey(undefined, stored.apiKey, apiKeyEnvVar);
  const mode = stored.mode ?? "local";

  return {
    id: "comfyui-media",
    platform: "comfyui",
    name: "ComfyUI",
    mode,
    baseUrl: normalizeBaseUrl(
      stored.baseUrl ?? (mode === "cloud" ? "https://cloud.comfy.org" : "http://127.0.0.1:8188"),
    ),
    localInstallPath: stored.localInstallPath ?? "",
    enabled: stored.enabled ?? false,
    apiKeyEnvVar,
    apiKeyConfigured: secret !== undefined,
    apiKeyMasked: maskSecret(secret),
    defaultWorkflowPath: stored.defaultWorkflowPath ?? "",
    outputDir: stored.outputDir ?? join(rootPath, "outputs", "comfyui"),
    positivePromptNodeId: stored.positivePromptNodeId ?? "",
    positivePromptInputName: stored.positivePromptInputName ?? "text",
    negativePromptNodeId: stored.negativePromptNodeId ?? "",
    negativePromptInputName: stored.negativePromptInputName ?? "text",
    supportedModes: ["text_to_image", "text_to_video", "image_to_video"],
    endpoints: COMFYUI_ENDPOINTS.map((endpoint) => ({
      ...endpoint,
      path:
        mode === "cloud" && endpoint.path !== "/system_stats"
          ? `/api${endpoint.path}`
          : endpoint.path,
    })),
    notes: [
      "ComfyUI 作为外部工具运行；Director Angel 只保存连接配置、workflow 路径和执行结果。",
      "未配置 workflow 文件时不会伪造图片或视频结果。",
    ],
  };
}

function defaultStoredAdapter(rootPath: string): StoredDirectorComfyUiAdapter {
  return {
    enabled: false,
    mode: "local",
    baseUrl: "http://127.0.0.1:8188",
    localInstallPath: "",
    apiKey: "",
    apiKeyEnvVar: "COMFYUI_API_KEY",
    defaultWorkflowPath: "",
    outputDir: join(rootPath, "outputs", "comfyui"),
    positivePromptNodeId: "",
    positivePromptInputName: "text",
    negativePromptNodeId: "",
    negativePromptInputName: "text",
  };
}

function loadStoredDocument(rootPath: string): StoredDirectorComfyUiConfigDocument {
  const path = configPath(rootPath);
  if (!existsSync(path)) {
    return {
      schemaVersion: DIRECTOR_COMFYUI_CONFIG_SCHEMA_VERSION,
      updatedAt: new Date(0).toISOString(),
      adapter: defaultStoredAdapter(rootPath),
    };
  }

  try {
    const parsed = parseStoredDocument(JSON.parse(readFileSync(path, "utf8")) as unknown);
    return {
      ...parsed,
      adapter: { ...defaultStoredAdapter(rootPath), ...parsed.adapter },
    };
  } catch {
    return {
      schemaVersion: DIRECTOR_COMFYUI_CONFIG_SCHEMA_VERSION,
      updatedAt: new Date(0).toISOString(),
      adapter: defaultStoredAdapter(rootPath),
    };
  }
}

function parseStoredDocument(value: unknown): StoredDirectorComfyUiConfigDocument {
  if (!isRecord(value)) {
    throw new Error("ComfyUI config must be an object.");
  }
  if (value.schemaVersion !== DIRECTOR_COMFYUI_CONFIG_SCHEMA_VERSION) {
    throw new Error("ComfyUI config schema version is invalid.");
  }
  if (!isRecord(value.adapter)) {
    throw new Error("ComfyUI config adapter must be an object.");
  }

  return {
    schemaVersion: DIRECTOR_COMFYUI_CONFIG_SCHEMA_VERSION,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : new Date(0).toISOString(),
    adapter: parseStoredAdapter(value.adapter),
  };
}

function parseStoredAdapter(value: Record<string, unknown>): StoredDirectorComfyUiAdapter {
  return {
    ...(typeof value.enabled === "boolean" ? { enabled: value.enabled } : {}),
    ...(value.mode === "local" || value.mode === "cloud" ? { mode: value.mode } : {}),
    ...(typeof value.apiKey === "string" ? { apiKey: value.apiKey } : {}),
    ...(typeof value.apiKeyEnvVar === "string" ? { apiKeyEnvVar: value.apiKeyEnvVar } : {}),
    ...(typeof value.baseUrl === "string" ? { baseUrl: value.baseUrl } : {}),
    ...(typeof value.localInstallPath === "string"
      ? { localInstallPath: value.localInstallPath }
      : {}),
    ...(typeof value.defaultWorkflowPath === "string"
      ? { defaultWorkflowPath: value.defaultWorkflowPath }
      : {}),
    ...(typeof value.outputDir === "string" ? { outputDir: value.outputDir } : {}),
    ...(typeof value.positivePromptNodeId === "string"
      ? { positivePromptNodeId: value.positivePromptNodeId }
      : {}),
    ...(typeof value.positivePromptInputName === "string"
      ? { positivePromptInputName: value.positivePromptInputName }
      : {}),
    ...(typeof value.negativePromptNodeId === "string"
      ? { negativePromptNodeId: value.negativePromptNodeId }
      : {}),
    ...(typeof value.negativePromptInputName === "string"
      ? { negativePromptInputName: value.negativePromptInputName }
      : {}),
  };
}

async function writeStoredDocument(
  rootPath: string,
  document: StoredDirectorComfyUiConfigDocument,
): Promise<void> {
  const path = configPath(rootPath);
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  await rename(tempPath, path);
}

function applyComfyUiSetting(
  adapter: StoredDirectorComfyUiAdapter,
  update: DirectorComfyUiSettingUpdate,
): StoredDirectorComfyUiAdapter {
  switch (update.key) {
    case "enabled":
      return { ...adapter, enabled: requireBoolean(update.value, update.key) };
    case "mode":
      return { ...adapter, mode: requireMode(update.value) };
    case "apiKey":
      return { ...adapter, apiKey: requireString(update.value, update.key) };
    case "apiKeyEnvVar":
      return { ...adapter, apiKeyEnvVar: requireString(update.value, update.key) };
    case "baseUrl":
      return { ...adapter, baseUrl: normalizeBaseUrl(requireAbsoluteUrl(update.value)) };
    case "localInstallPath":
      return { ...adapter, localInstallPath: requireString(update.value, update.key) };
    case "defaultWorkflowPath":
      return { ...adapter, defaultWorkflowPath: requireString(update.value, update.key) };
    case "outputDir":
      return { ...adapter, outputDir: requireString(update.value, update.key) };
    case "positivePromptNodeId":
      return { ...adapter, positivePromptNodeId: requireString(update.value, update.key) };
    case "positivePromptInputName":
      return { ...adapter, positivePromptInputName: requireString(update.value, update.key) };
    case "negativePromptNodeId":
      return { ...adapter, negativePromptNodeId: requireString(update.value, update.key) };
    case "negativePromptInputName":
      return { ...adapter, negativePromptInputName: requireString(update.value, update.key) };
  }
}

function loadWorkflow(
  workflowJson: unknown,
  workflowPath: string,
):
  | { readonly ok: true; readonly workflow: Record<string, unknown> }
  | { readonly ok: false; readonly message: string } {
  if (workflowJson !== undefined) {
    if (isRecord(workflowJson)) {
      return { ok: true, workflow: workflowJson };
    }
    return { ok: false, message: "ComfyUI workflow JSON 必须是对象。" };
  }

  if (!workflowPath.trim()) {
    return {
      ok: false,
      message: "ComfyUI 已启用，但还没有配置 workflow 文件，未发起生成。",
    };
  }
  if (!existsSync(workflowPath)) {
    return {
      ok: false,
      message: `ComfyUI workflow 文件不存在：${workflowPath}`,
    };
  }

  try {
    const parsed = JSON.parse(readFileSync(workflowPath, "utf8")) as unknown;
    if (!isRecord(parsed)) {
      return { ok: false, message: "ComfyUI workflow 文件必须是 JSON 对象。" };
    }
    return { ok: true, workflow: parsed };
  } catch (error) {
    return { ok: false, message: `ComfyUI workflow 读取失败：${toErrorMessage(error)}。` };
  }
}

function unwrapWorkflow(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    return {};
  }
  if (isRecord(value.workflow)) {
    return unwrapWorkflow(value.workflow);
  }
  if (isRecord(value.prompt)) {
    return unwrapWorkflow(value.prompt);
  }
  if (Array.isArray(value.nodes) && Array.isArray(value.links)) {
    return {};
  }
  return value;
}

function extractObjectInfoClasses(value: unknown): Set<string> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  return new Set(Object.keys(value).filter((key) => key.trim().length > 0));
}

function normalizeInstalledModels(
  value: Readonly<Record<string, readonly string[]>> | undefined,
): Map<string, Set<string>> | undefined {
  if (!value) {
    return undefined;
  }
  const result = new Map<string, Set<string>>();
  for (const [folder, models] of Object.entries(value)) {
    const normalized = new Set<string>();
    for (const model of models ?? []) {
      for (const candidate of modelNameCandidates(model)) {
        normalized.add(candidate);
      }
    }
    result.set(folder, normalized);
  }
  return result;
}

function applyPromptToWorkflow(
  workflow: Record<string, unknown>,
  prompt: string,
  adapter: DirectorComfyUiAdapter,
): { readonly workflow: Record<string, unknown>; readonly promptApplied: boolean } {
  const cloned = JSON.parse(JSON.stringify(workflow)) as Record<string, unknown>;
  if (
    setWorkflowInput(cloned, adapter.positivePromptNodeId, adapter.positivePromptInputName, prompt)
  ) {
    return { workflow: cloned, promptApplied: true };
  }

  for (const [nodeId, node] of Object.entries(cloned)) {
    if (!isRecord(node) || !isRecord(node.inputs)) {
      continue;
    }
    const classType = typeof node.class_type === "string" ? node.class_type : "";
    if (
      /CLIPTextEncode|TextEncode|Prompt/iu.test(classType) &&
      typeof node.inputs.text === "string"
    ) {
      setWorkflowInput(cloned, nodeId, "text", prompt);
      return { workflow: cloned, promptApplied: true };
    }
  }

  return { workflow: cloned, promptApplied: false };
}

function inferWorkflowParameterType(value: unknown): DirectorComfyUiWorkflowParameterType {
  if (typeof value === "boolean") {
    return "bool";
  }
  if (typeof value === "number") {
    return Number.isInteger(value) ? "int" : "float";
  }
  if (typeof value === "string") {
    return "string";
  }
  if (isWorkflowLink(value)) {
    return "link";
  }
  if (isRecord(value)) {
    return "object";
  }
  return "unknown";
}

function finalizeWorkflowParameters(
  rawParameters: readonly (Omit<DirectorComfyUiWorkflowParameter, "name"> & {
    readonly nameHint: string;
  })[],
): readonly DirectorComfyUiWorkflowParameter[] {
  const byName = new Map<
    string,
    readonly (Omit<DirectorComfyUiWorkflowParameter, "name"> & { readonly nameHint: string })[]
  >();
  for (const parameter of rawParameters) {
    byName.set(parameter.nameHint, [...(byName.get(parameter.nameHint) ?? []), parameter]);
  }

  const parameters: DirectorComfyUiWorkflowParameter[] = [];
  for (const [name, entries] of byName.entries()) {
    const sorted = [...entries].sort((left, right) =>
      `${left.nodeId}:${left.field}`.localeCompare(`${right.nodeId}:${right.field}`),
    );
    if (sorted.length === 1) {
      const entry = sorted[0];
      if (!entry) {
        continue;
      }
      parameters.push({
        name,
        nodeId: entry.nodeId,
        field: entry.field,
        type: entry.type,
        value: entry.value,
        classType: entry.classType,
      });
      continue;
    }
    for (const entry of sorted) {
      parameters.push({
        name: `${name}_${entry.nodeId}`,
        aliasOf: name,
        nodeId: entry.nodeId,
        field: entry.field,
        type: entry.type,
        value: entry.value,
        classType: entry.classType,
      });
    }
  }
  return parameters;
}

function createWorkflowModelDependency(input: {
  readonly nodeId: string;
  readonly classType: string;
  readonly field: string;
  readonly folder: string;
  readonly value: string;
  readonly installedModels: Map<string, Set<string>> | undefined;
}): DirectorComfyUiWorkflowModelDependency {
  return {
    nodeId: input.nodeId,
    classType: input.classType,
    field: input.field,
    folder: input.folder,
    value: input.value,
    ...(input.installedModels === undefined
      ? {}
      : { installed: isWorkflowModelInstalled(input.installedModels, input.folder, input.value) }),
  };
}

function isWorkflowModelInstalled(
  installedModels: Map<string, Set<string>>,
  folder: string,
  value: string,
): boolean {
  const candidates = modelNameCandidates(value);
  for (const folderName of folderAliases(folder)) {
    const models = installedModels.get(folderName);
    if (!models) {
      continue;
    }
    if (candidates.some((candidate) => models.has(candidate))) {
      return true;
    }
  }
  return false;
}

function dedupeWorkflowModelDependencies(
  dependencies: readonly DirectorComfyUiWorkflowModelDependency[],
): readonly DirectorComfyUiWorkflowModelDependency[] {
  const seen = new Set<string>();
  const result: DirectorComfyUiWorkflowModelDependency[] = [];
  for (const dependency of dependencies) {
    const key = `${dependency.nodeId}:${dependency.field}:${dependency.folder}:${dependency.value}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(dependency);
  }
  return result;
}

function createWorkflowInspectNotes(input: {
  readonly missingNodeCount: number;
  readonly missingModelCount: number;
  readonly promptNodeCount: number;
  readonly outputNodeCount: number;
}): readonly string[] {
  const notes: string[] = [];
  if (input.missingNodeCount > 0) {
    notes.push(`缺少自定义节点：${input.missingNodeCount} 个。`);
  }
  if (input.missingModelCount > 0) {
    notes.push(`缺少模型或 embedding：${input.missingModelCount} 个。`);
  }
  if (input.promptNodeCount === 0) {
    notes.push("未发现可控提示词节点。");
  }
  if (input.outputNodeCount === 0) {
    notes.push("未发现明确产物输出节点。");
  }
  return notes;
}

function findLinkedPromptNode(
  workflow: Record<string, unknown>,
  inputName: "negative" | "positive",
): string | undefined {
  for (const [nodeId, node] of Object.entries(workflow)) {
    if (!isRecord(node) || !isRecord(node.inputs)) {
      continue;
    }
    const classType = typeof node.class_type === "string" ? node.class_type : "";
    if (!SAMPLER_NODE_FAMILY.has(classType)) {
      continue;
    }
    const link = node.inputs[inputName];
    const sourceNodeId = traceWorkflowLink(workflow, link);
    if (!sourceNodeId) {
      continue;
    }
    const sourceNode = workflow[sourceNodeId];
    if (!isRecord(sourceNode)) {
      continue;
    }
    const sourceClassType = typeof sourceNode.class_type === "string" ? sourceNode.class_type : "";
    if (/CLIPTextEncode|TextEncode|Prompt/iu.test(sourceClassType)) {
      return sourceNodeId;
    }
  }
  return undefined;
}

function traceWorkflowLink(workflow: Record<string, unknown>, value: unknown): string | undefined {
  if (!isWorkflowLink(value)) {
    return undefined;
  }
  let nodeId: string | undefined = String(value[0]);
  const visited = new Set<string>();
  for (let index = 0; index < 8; index += 1) {
    if (!nodeId || visited.has(nodeId)) {
      return nodeId;
    }
    visited.add(nodeId);
    const node: unknown = workflow[nodeId];
    if (!isRecord(node)) {
      return undefined;
    }
    const classType = typeof node.class_type === "string" ? node.class_type : "";
    if (!["Reroute", "PrimitiveNode", "Note", "easy showAnything"].includes(classType)) {
      return nodeId;
    }
    const inputs: unknown[] = isRecord(node.inputs) ? Object.values(node.inputs) : [];
    const nextLink: readonly [string | number, number] | undefined = inputs.find(isWorkflowLink);
    if (!nextLink) {
      return nodeId;
    }
    nodeId = String(nextLink[0]);
  }
  return nodeId;
}

function isWorkflowLink(value: unknown): value is readonly [string | number, number] {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    (typeof value[0] === "string" || typeof value[0] === "number") &&
    typeof value[1] === "number"
  );
}

function extractEmbeddingReferences(value: string): readonly string[] {
  const references: string[] = [];
  for (const match of value.matchAll(EMBEDDING_REFERENCE_PATTERN)) {
    if (match[1]) {
      references.push(match[1]);
    }
  }
  return references;
}

function folderAliases(folder: string): readonly string[] {
  const aliases: Record<string, readonly string[]> = {
    clip: ["clip", "text_encoders"],
    controlnet: ["controlnet", "control_net"],
    diffusion_models: ["diffusion_models", "unet"],
    embeddings: ["embeddings", "embedding"],
    unet: ["unet", "diffusion_models"],
    vae: ["vae", "vae_approx"],
  };
  return aliases[folder] ?? [folder];
}

function modelNameCandidates(value: string): readonly string[] {
  const normalized = value.trim();
  if (!normalized) {
    return [];
  }
  const basenameValue = normalized.split(/[\\/]/u).pop() ?? normalized;
  const stem = basenameValue.replace(/\.[^.]+$/u, "");
  return [...new Set([normalized, basenameValue, stem])];
}

function analyzeWorkflow(workflow: Record<string, unknown>): DirectorComfyUiWorkflowDiagnostics {
  let promptNodeCount = 0;
  let outputNodeCount = 0;
  const modelDependencies: string[] = [];

  for (const node of Object.values(workflow)) {
    if (!isRecord(node) || !isRecord(node.inputs)) {
      continue;
    }
    const classType = typeof node.class_type === "string" ? node.class_type : "";
    if (isPromptNode(classType, node.inputs)) {
      promptNodeCount += 1;
    }
    if (OUTPUT_NODE_PATTERN.test(classType)) {
      outputNodeCount += 1;
    }
    const dependencyFields = MODEL_DEPENDENCY_FIELDS.get(classType) ?? [];
    for (const [fieldName, folder] of dependencyFields) {
      const value = node.inputs[fieldName];
      if (typeof value === "string" && value.trim().length > 0) {
        modelDependencies.push(`${folder}:${value.trim()}`);
      }
    }
  }

  const notes: string[] = [];
  if (promptNodeCount === 0) {
    notes.push("未发现可注入提示词的文本节点。");
  }
  if (modelDependencies.length === 0) {
    notes.push("未发现模型加载节点；这类 workflow 通常只能做连通性或非 AI 处理。");
  }
  if (outputNodeCount === 0) {
    notes.push("未发现明确产物输出节点。");
  }

  return {
    promptNodeCount,
    modelDependencyCount: modelDependencies.length,
    outputNodeCount,
    modelDependencies,
    notes,
  };
}

function isPromptNode(classType: string, inputs: Record<string, unknown>): boolean {
  if (!/CLIPTextEncode|TextEncode|Prompt/iu.test(classType)) {
    return false;
  }
  return ["text", "text_g", "text_l", "clip_l", "t5xxl", "prompt"].some(
    (key) => typeof inputs[key] === "string",
  );
}

function diagnoseWorkflowReadiness(
  workflowDiagnostics: DirectorComfyUiWorkflowDiagnostics,
  promptApplied: boolean,
): string[] {
  const diagnostics = [...workflowDiagnostics.notes];
  if (!promptApplied) {
    diagnostics.unshift("提示词没有写入 workflow；这次不能算文生图。");
  }
  if (workflowDiagnostics.modelDependencies.length > 0) {
    diagnostics.push(`模型依赖：${workflowDiagnostics.modelDependencies.join("，")}`);
  }
  return diagnostics;
}

function formatWorkflowRunMessage(
  artifactCount: number,
  promptApplied: boolean,
  workflowDiagnostics: DirectorComfyUiWorkflowDiagnostics,
): string {
  if (artifactCount === 0) {
    return "ComfyUI workflow 已完成轮询，但没有发现图片或视频产物。";
  }
  if (!promptApplied) {
    const modelNote = workflowDiagnostics.modelDependencyCount === 0 ? "，且没有模型加载节点" : "";
    return `ComfyUI workflow 已真实执行，但当前 workflow 没有可注入的提示词节点${modelNote}；产物只代表连通性验证，不代表 AI 文生图。`;
  }
  return `ComfyUI 生成完成，已保存 ${artifactCount} 个产物。`;
}

function setWorkflowInput(
  workflow: Record<string, unknown>,
  nodeId: string,
  inputName: string,
  value: string,
): boolean {
  if (!nodeId.trim() || !inputName.trim()) {
    return false;
  }
  const node = workflow[nodeId];
  if (!isRecord(node)) {
    return false;
  }
  if (!isRecord(node.inputs)) {
    node.inputs = {};
  }
  const inputs = node.inputs;
  if (!isRecord(inputs)) {
    return false;
  }
  inputs[inputName] = value;
  return true;
}

async function pollAndDownloadArtifacts(input: {
  readonly adapter: DirectorComfyUiAdapter;
  readonly apiKey: string | undefined;
  readonly baseUrl: string;
  readonly promptId: string;
  readonly outputDir: string;
  readonly fetchImpl: DirectorComfyUiFetch;
  readonly signal: AbortSignal;
  readonly startedAt: number;
  readonly timeoutMs: number;
  readonly pollIntervalMs: number;
}): Promise<DirectorComfyUiArtifact[]> {
  const deadline = input.startedAt + input.timeoutMs;
  const historyEndpoint = buildEndpoint(
    input.baseUrl,
    input.adapter.mode,
    `/history/${input.promptId}`,
  );

  while (Date.now() <= deadline) {
    const response = await input.fetchImpl(historyEndpoint, {
      method: "GET",
      headers: buildHeaders(input.apiKey, false),
      signal: input.signal,
    });
    const body = await response.text();
    const artifacts = extractArtifactsFromHistory(
      body,
      input.promptId,
      input.baseUrl,
      input.adapter.mode,
    );
    if (artifacts.length > 0) {
      return Promise.all(
        artifacts.map((artifact) =>
          downloadArtifact({
            artifact,
            promptId: input.promptId,
            outputDir: input.outputDir,
            apiKey: input.apiKey,
            fetchImpl: input.fetchImpl,
            signal: input.signal,
          }),
        ),
      );
    }

    await sleep(input.pollIntervalMs);
  }

  return [];
}

async function monitorComfyUiWorkflowProgress(input: {
  readonly adapter: DirectorComfyUiAdapter;
  readonly apiKey: string | undefined;
  readonly promptId: string;
  readonly clientId: string;
  readonly timeoutMs: number;
  readonly webSocketFactory: DirectorComfyUiWebSocketFactory | undefined;
  readonly onProgress: ((event: DirectorComfyUiProgressEvent) => void) | undefined;
}): Promise<{
  readonly mode: "polling" | "websocket";
  readonly events: readonly DirectorComfyUiProgressEvent[];
}> {
  if (input.webSocketFactory === undefined) {
    return { mode: "polling", events: [] };
  }

  const webSocketFactory = input.webSocketFactory;
  const events: DirectorComfyUiProgressEvent[] = [];
  let connection: DirectorComfyUiWebSocketConnection | undefined;
  try {
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) {
          return;
        }
        settled = true;
        resolve();
      };
      const timer = setTimeout(finish, Math.max(1, input.timeoutMs));
      const handlers: DirectorComfyUiWebSocketHandlers = {
        onMessage: (message) => {
          const event = normalizeComfyUiProgressEvent(message);
          if (event.promptId !== undefined && event.promptId !== input.promptId) {
            return;
          }
          events.push(event);
          input.onProgress?.(event);
          if (
            event.type === "execution_success" ||
            event.type === "execution_error" ||
            event.type === "execution_interrupted"
          ) {
            clearTimeout(timer);
            finish();
          }
        },
        onError: (error) => {
          const event: DirectorComfyUiProgressEvent = {
            type: "execution_error",
            promptId: input.promptId,
            data: { error: toErrorMessage(error) },
            occurredAtMs: Date.now(),
          };
          events.push(event);
          input.onProgress?.(event);
          clearTimeout(timer);
          finish();
        },
        onClose: finish,
      };
      Promise.resolve(webSocketFactory(buildComfyUiWebSocketUrl(input), handlers))
        .then((createdConnection) => {
          connection = createdConnection;
        })
        .catch((error) => {
          handlers.onError(error);
        });
    });
  } catch {
    return { mode: "polling", events };
  } finally {
    try {
      connection?.close();
    } catch {
      // Closing progress streams is best-effort.
    }
  }

  return { mode: events.length > 0 ? "websocket" : "polling", events };
}

function buildComfyUiWebSocketUrl(input: {
  readonly adapter: DirectorComfyUiAdapter;
  readonly apiKey: string | undefined;
  readonly clientId: string;
}): string {
  const base = new URL(input.adapter.baseUrl);
  base.protocol = base.protocol === "https:" ? "wss:" : "ws:";
  base.pathname = `${base.pathname.replace(/\/+$/u, "")}/ws`;
  base.search = "";
  base.searchParams.set("clientId", input.clientId);
  if (input.adapter.mode === "cloud" && input.apiKey) {
    base.searchParams.set("token", input.apiKey);
  }
  return base.toString();
}

function normalizeComfyUiProgressEvent(message: unknown): DirectorComfyUiProgressEvent {
  const payload = typeof message === "string" ? parseJsonValue(message) : message;
  const record = isRecord(payload) ? payload : {};
  const data = isRecord(record.data) ? record.data : {};
  const type = normalizeComfyUiProgressEventType(
    typeof record.type === "string" ? record.type : "unknown",
  );
  return {
    type,
    ...(typeof data.prompt_id === "string" ? { promptId: data.prompt_id } : {}),
    ...(typeof data.node === "string" ? { node: data.node } : {}),
    ...(typeof data.value === "number" ? { value: data.value } : {}),
    ...(typeof data.max === "number" ? { max: data.max } : {}),
    data,
    occurredAtMs: Date.now(),
  };
}

function normalizeComfyUiProgressEventType(value: string): DirectorComfyUiProgressEventType {
  switch (value) {
    case "executed":
    case "executing":
    case "execution_error":
    case "execution_interrupted":
    case "execution_success":
    case "notification":
    case "progress":
    case "progress_state":
      return value;
    default:
      return "unknown";
  }
}

function extractArtifactsFromHistory(
  body: string,
  promptId: string,
  baseUrl: string,
  mode: DirectorComfyUiMode,
): DirectorComfyUiArtifact[] {
  const parsed = parseJsonObject(body);
  if (!parsed) {
    return [];
  }
  const run = isRecord(parsed[promptId]) ? parsed[promptId] : parsed;
  const outputs = isRecord(run.outputs) ? run.outputs : undefined;
  if (!outputs) {
    return [];
  }

  const artifacts: DirectorComfyUiArtifact[] = [];
  for (const output of Object.values(outputs)) {
    if (!isRecord(output)) {
      continue;
    }
    for (const [key, kind] of [
      ["images", "image"],
      ["videos", "video"],
      ["gifs", "video"],
    ] as const) {
      const items = output[key];
      if (!Array.isArray(items)) {
        continue;
      }
      for (const item of items) {
        if (!isRecord(item) || typeof item.filename !== "string") {
          continue;
        }
        const subfolder = typeof item.subfolder === "string" ? item.subfolder : "";
        const type = typeof item.type === "string" ? item.type : "output";
        const url = buildViewUrl(baseUrl, mode, item.filename, subfolder, type);
        artifacts.push({ kind, filename: item.filename, subfolder, type, url });
      }
    }
  }
  return artifacts;
}

async function downloadArtifact(input: {
  readonly artifact: DirectorComfyUiArtifact;
  readonly promptId: string;
  readonly outputDir: string;
  readonly apiKey: string | undefined;
  readonly fetchImpl: DirectorComfyUiFetch;
  readonly signal: AbortSignal;
}): Promise<DirectorComfyUiArtifact> {
  const response = await input.fetchImpl(input.artifact.url, {
    method: "GET",
    headers: buildHeaders(input.apiKey, false),
    signal: input.signal,
  });
  if (!response.ok) {
    return input.artifact;
  }

  await mkdir(input.outputDir, { recursive: true });
  const localPath = join(
    input.outputDir,
    `${sanitizeFilePart(input.promptId)}-${basename(input.artifact.filename)}`,
  );
  const bytes =
    typeof response.arrayBuffer === "function"
      ? Buffer.from(await response.arrayBuffer())
      : Buffer.from(await response.text(), "utf8");
  await writeFile(localPath, bytes);
  return { ...input.artifact, localPath };
}

function buildViewUrl(
  baseUrl: string,
  mode: DirectorComfyUiMode,
  filename: string,
  subfolder: string,
  type: string,
): string {
  const endpoint = buildEndpoint(baseUrl, mode, "/view");
  const params = new URLSearchParams({ filename, subfolder, type });
  return `${endpoint}?${params.toString()}`;
}

function buildEndpoint(baseUrl: string, mode: DirectorComfyUiMode, path: string): string {
  const normalized = normalizeBaseUrl(baseUrl);
  const endpointPath = mode === "cloud" && !path.startsWith("/api/") ? `/api${path}` : path;
  return `${normalized}${endpointPath}`;
}

function buildHeaders(apiKey: string | undefined, json: boolean): Record<string, string> {
  return {
    ...(json ? { "Content-Type": "application/json" } : {}),
    ...(apiKey ? { "X-API-Key": apiKey } : {}),
  };
}

function inferComfyUiArtifactKind(filename: string): DirectorComfyUiArtifact["kind"] {
  return /\.(?:avi|gif|m4v|mkv|mov|mp4|webm)$/iu.test(filename) ? "video" : "image";
}

function connectionTestResult(input: {
  readonly checkedAt: string;
  readonly startedAt: number;
  readonly endpoint: string;
  readonly ok: boolean;
  readonly message: string;
  readonly status?: number;
  readonly statusText?: string;
}): DirectorComfyUiConnectionTestResult {
  return {
    ok: input.ok,
    endpoint: input.endpoint,
    checkedAt: input.checkedAt,
    latencyMs: Math.max(0, Date.now() - input.startedAt),
    ...(input.status === undefined ? {} : { status: input.status }),
    ...(input.statusText === undefined ? {} : { statusText: input.statusText }),
    message: input.message,
  };
}

function workflowRunResult(input: {
  readonly checkedAt: string;
  readonly startedAt: number;
  readonly endpoint: string;
  readonly ok: boolean;
  readonly readiness: DirectorComfyUiRunReadiness;
  readonly promptApplied: boolean;
  readonly diagnostics: readonly string[];
  readonly workflowDiagnostics: DirectorComfyUiWorkflowDiagnostics;
  readonly message: string;
  readonly artifacts: readonly DirectorComfyUiArtifact[];
  readonly promptId?: string;
  readonly status?: number;
  readonly statusText?: string;
  readonly progressMode?: "polling" | "websocket";
  readonly progressEvents?: readonly DirectorComfyUiProgressEvent[];
}): DirectorComfyUiWorkflowRunResult {
  return {
    ok: input.ok,
    endpoint: input.endpoint,
    checkedAt: input.checkedAt,
    latencyMs: Math.max(0, Date.now() - input.startedAt),
    readiness: input.readiness,
    promptApplied: input.promptApplied,
    diagnostics: input.diagnostics,
    workflowDiagnostics: input.workflowDiagnostics,
    ...(input.promptId === undefined ? {} : { promptId: input.promptId }),
    artifactCount: input.artifacts.length,
    artifacts: input.artifacts,
    message: input.message,
    ...(input.progressMode === undefined ? {} : { progressMode: input.progressMode }),
    ...(input.progressEvents === undefined ? {} : { progressEvents: input.progressEvents }),
    ...(input.status === undefined ? {} : { status: input.status }),
    ...(input.statusText === undefined ? {} : { statusText: input.statusText }),
  };
}

function artifactFetchResult(input: {
  readonly checkedAt: string;
  readonly startedAt: number;
  readonly endpoint: string;
  readonly ok: boolean;
  readonly artifacts: readonly DirectorComfyUiArtifact[];
  readonly message: string;
  readonly status?: number;
  readonly statusText?: string;
  readonly error?: string;
}): DirectorComfyUiArtifactFetchResult {
  return {
    ok: input.ok,
    endpoint: input.endpoint,
    checkedAt: input.checkedAt,
    latencyMs: Math.max(0, Date.now() - input.startedAt),
    artifacts: input.artifacts,
    ...(input.artifacts[0] === undefined ? {} : { artifact: input.artifacts[0] }),
    message: input.message,
    ...(input.status === undefined ? {} : { status: input.status }),
    ...(input.statusText === undefined ? {} : { statusText: input.statusText }),
    ...(input.error === undefined ? {} : { error: input.error }),
  };
}

async function inspectComfyUiCliStatus(
  commandExists: DirectorComfyUiHealthInspectInput["commandExists"],
): Promise<DirectorComfyUiCliStatus> {
  if (await isComfyUiCommandAvailable(commandExists, "comfy")) {
    return {
      available: true,
      method: "comfy",
      command: "comfy",
    };
  }
  if (await isComfyUiCommandAvailable(commandExists, "uvx")) {
    return {
      available: true,
      method: "uvx",
      command: "uvx --from comfy-cli comfy",
      hint: "可通过 uvx --from comfy-cli comfy ... 执行生命周期命令。",
    };
  }
  return {
    available: false,
    hint: "安装 comfy-cli：pipx install comfy-cli，或使用 uvx --from comfy-cli comfy。",
  };
}

async function isComfyUiCommandAvailable(
  commandExists: DirectorComfyUiHealthInspectInput["commandExists"],
  command: string,
): Promise<boolean> {
  if (commandExists === undefined) {
    return false;
  }
  try {
    return (await commandExists(command)) === true;
  } catch {
    return false;
  }
}

async function fetchComfyUiServerHealth(input: {
  readonly adapter: DirectorComfyUiAdapter;
  readonly apiKey: string | undefined;
  readonly fetchImpl: DirectorComfyUiFetch | undefined;
  readonly timeoutMs: number | undefined;
}): Promise<DirectorComfyUiServerHealth> {
  const endpoint = buildEndpoint(input.adapter.baseUrl, input.adapter.mode, "/system_stats");
  const fetched = await fetchComfyUiText({
    ...input,
    path: "/system_stats",
  });
  if (!fetched.ok) {
    return {
      reachable: false,
      endpoint,
      ...(fetched.status === undefined ? {} : { status: fetched.status }),
      ...(fetched.statusText === undefined ? {} : { statusText: fetched.statusText }),
      ...(fetched.error === undefined ? {} : { error: fetched.error }),
    };
  }
  return {
    reachable: true,
    endpoint,
    status: fetched.status,
    statusText: fetched.statusText,
    stats: parseJsonObject(fetched.body) ?? fetched.body,
  };
}

async function fetchComfyUiModelFolderStatus(input: {
  readonly adapter: DirectorComfyUiAdapter;
  readonly apiKey: string | undefined;
  readonly fetchImpl: DirectorComfyUiFetch | undefined;
  readonly folder: string;
  readonly timeoutMs: number | undefined;
}): Promise<DirectorComfyUiModelFolderStatus> {
  const endpoint = buildEndpoint(
    input.adapter.baseUrl,
    input.adapter.mode,
    `/models/${input.folder}`,
  );
  const fetched = await fetchComfyUiText({
    adapter: input.adapter,
    apiKey: input.apiKey,
    fetchImpl: input.fetchImpl,
    path: `/models/${input.folder}`,
    timeoutMs: input.timeoutMs,
  });
  if (!fetched.ok) {
    return {
      folder: input.folder,
      queryable: false,
      count: 0,
      firstFew: [],
      endpoint,
      ...(fetched.status === undefined ? {} : { status: fetched.status }),
      ...(fetched.statusText === undefined ? {} : { statusText: fetched.statusText }),
      ...(fetched.error === undefined ? {} : { error: fetched.error }),
    };
  }
  const models = parseComfyUiModelList(parseJsonValue(fetched.body));
  return {
    folder: input.folder,
    queryable: true,
    count: models.length,
    firstFew: models.slice(0, 5),
    endpoint,
    status: fetched.status,
    statusText: fetched.statusText,
  };
}

async function fetchComfyUiQueueStatus(input: {
  readonly adapter: DirectorComfyUiAdapter;
  readonly apiKey: string | undefined;
  readonly fetchImpl: DirectorComfyUiFetch | undefined;
  readonly timeoutMs: number | undefined;
}): Promise<DirectorComfyUiQueueStatus> {
  const endpoint = buildEndpoint(input.adapter.baseUrl, input.adapter.mode, "/queue");
  const fetched = await fetchComfyUiText({
    ...input,
    path: "/queue",
  });
  if (!fetched.ok) {
    return {
      ok: false,
      endpoint,
      runningCount: 0,
      pendingCount: 0,
      ...(fetched.status === undefined ? {} : { status: fetched.status }),
      ...(fetched.statusText === undefined ? {} : { statusText: fetched.statusText }),
      ...(fetched.error === undefined ? {} : { error: fetched.error }),
    };
  }
  const raw = parseJsonValue(fetched.body);
  const record = isRecord(raw) ? raw : {};
  return {
    ok: true,
    endpoint,
    runningCount: Array.isArray(record.queue_running) ? record.queue_running.length : 0,
    pendingCount: Array.isArray(record.queue_pending) ? record.queue_pending.length : 0,
    raw,
    status: fetched.status,
    statusText: fetched.statusText,
  };
}

async function fetchComfyUiHistoryStatus(input: {
  readonly adapter: DirectorComfyUiAdapter;
  readonly apiKey: string | undefined;
  readonly fetchImpl: DirectorComfyUiFetch | undefined;
  readonly promptId: string;
  readonly timeoutMs: number | undefined;
}): Promise<DirectorComfyUiHistoryStatus> {
  const endpoint = buildEndpoint(
    input.adapter.baseUrl,
    input.adapter.mode,
    `/history/${input.promptId}`,
  );
  const fetched = await fetchComfyUiText({
    adapter: input.adapter,
    apiKey: input.apiKey,
    fetchImpl: input.fetchImpl,
    path: `/history/${input.promptId}`,
    timeoutMs: input.timeoutMs,
  });
  if (!fetched.ok) {
    return {
      ok: false,
      endpoint,
      promptId: input.promptId,
      outputNodeIds: [],
      outputCount: 0,
      executionLog: [],
      errors: [],
      ...(fetched.status === undefined ? {} : { status: fetched.status }),
      ...(fetched.statusText === undefined ? {} : { statusText: fetched.statusText }),
      ...(fetched.error === undefined ? {} : { error: fetched.error }),
    };
  }
  const raw = parseJsonValue(fetched.body);
  const run = extractComfyUiHistoryRun(raw, input.promptId);
  const diagnostics = extractComfyUiHistoryDiagnostics(run);
  return {
    ok: true,
    endpoint,
    promptId: input.promptId,
    ...(diagnostics.statusStr === undefined ? {} : { statusStr: diagnostics.statusStr }),
    ...(diagnostics.completed === undefined ? {} : { completed: diagnostics.completed }),
    outputNodeIds: diagnostics.outputNodeIds,
    outputCount: diagnostics.outputCount,
    executionLog: diagnostics.executionLog,
    errors: diagnostics.errors,
    raw: run ?? raw,
    status: fetched.status,
    statusText: fetched.statusText,
  };
}

async function fetchComfyUiJson(input: {
  readonly adapter: DirectorComfyUiAdapter;
  readonly apiKey: string | undefined;
  readonly fetchImpl: DirectorComfyUiFetch | undefined;
  readonly path: string;
  readonly timeoutMs: number | undefined;
}): Promise<
  | {
      readonly ok: true;
      readonly data: unknown;
      readonly status: number;
      readonly statusText: string;
    }
  | {
      readonly ok: false;
      readonly error: string;
      readonly status?: number;
      readonly statusText?: string;
    }
> {
  const fetched = await fetchComfyUiText(input);
  if (!fetched.ok) {
    return {
      ok: false,
      error: fetched.error ?? "ComfyUI request failed.",
      ...(fetched.status === undefined ? {} : { status: fetched.status }),
      ...(fetched.statusText === undefined ? {} : { statusText: fetched.statusText }),
    };
  }
  return {
    ok: true,
    data: parseJsonValue(fetched.body),
    status: fetched.status,
    statusText: fetched.statusText,
  };
}

async function fetchComfyUiText(input: {
  readonly adapter: DirectorComfyUiAdapter;
  readonly apiKey: string | undefined;
  readonly fetchImpl: DirectorComfyUiFetch | undefined;
  readonly path: string;
  readonly timeoutMs: number | undefined;
}): Promise<
  | {
      readonly ok: true;
      readonly body: string;
      readonly status: number;
      readonly statusText: string;
    }
  | {
      readonly ok: false;
      readonly error: string;
      readonly status?: number;
      readonly statusText?: string;
    }
> {
  if (typeof input.fetchImpl !== "function") {
    return { ok: false, error: "当前运行环境没有 fetch。" };
  }
  const endpoint = buildEndpoint(input.adapter.baseUrl, input.adapter.mode, input.path);
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, input.timeoutMs ?? 12_000);
  try {
    const response = await input.fetchImpl(endpoint, {
      method: "GET",
      headers: buildHeaders(input.apiKey, false),
      signal: controller.signal,
    });
    const body = await response.text();
    if (!response.ok) {
      return {
        ok: false,
        error: `HTTP ${response.status} ${response.statusText || ""}`.trim(),
        status: response.status,
        statusText: response.statusText,
      };
    }
    return {
      ok: true,
      body,
      status: response.status,
      statusText: response.statusText,
    };
  } catch (error) {
    return { ok: false, error: toErrorMessage(error) };
  } finally {
    clearTimeout(timeout);
  }
}

function parseComfyUiModelList(value: unknown): readonly string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => (typeof item === "string" ? [item] : []));
  }
  if (!isRecord(value)) {
    return [];
  }
  const names = [value.models, value.files, value.data].find(Array.isArray);
  if (Array.isArray(names)) {
    return names.flatMap((item) => {
      if (typeof item === "string") {
        return [item];
      }
      if (isRecord(item) && typeof item.name === "string") {
        return [item.name];
      }
      return [];
    });
  }
  return [];
}

function extractComfyUiHistoryRun(raw: unknown, promptId: string): unknown {
  if (!isRecord(raw)) {
    return undefined;
  }
  if (isRecord(raw[promptId])) {
    return raw[promptId];
  }
  return raw;
}

function extractComfyUiHistoryDiagnostics(run: unknown): {
  readonly statusStr?: string;
  readonly completed?: boolean;
  readonly outputNodeIds: readonly string[];
  readonly outputCount: number;
  readonly executionLog: readonly unknown[];
  readonly errors: readonly unknown[];
} {
  if (!isRecord(run)) {
    return {
      outputNodeIds: [],
      outputCount: 0,
      executionLog: [],
      errors: [],
    };
  }
  const status = isRecord(run.status) ? run.status : {};
  const outputs = isRecord(run.outputs) ? run.outputs : {};
  const executionLog = Array.isArray(status.messages) ? status.messages : [];
  const errors = executionLog.flatMap((message) =>
    Array.isArray(message) && message[0] === "execution_error" && message.length > 1
      ? [message[1]]
      : [],
  );
  return {
    ...(typeof status.status_str === "string" ? { statusStr: status.status_str } : {}),
    ...(typeof status.completed === "boolean" ? { completed: status.completed } : {}),
    outputNodeIds: Object.keys(outputs),
    outputCount: countComfyUiOutputFiles(outputs),
    executionLog,
    errors,
  };
}

function countComfyUiOutputFiles(outputs: Record<string, unknown>): number {
  let total = 0;
  for (const output of Object.values(outputs)) {
    if (!isRecord(output)) {
      continue;
    }
    for (const key of ["images", "gifs", "videos", "video", "audio", "files", "models", "3d"]) {
      const value = output[key];
      total += Array.isArray(value) ? value.length : value === undefined ? 0 : 1;
    }
  }
  return total;
}

function resolveComfyUiHealthStatus(input: {
  readonly adapter: DirectorComfyUiAdapter;
  readonly apiKey: string | undefined;
  readonly server: DirectorComfyUiServerHealth;
  readonly workflow: DirectorComfyUiWorkflowInspectReport | null;
}): DirectorComfyUiHealthStatus {
  if (!input.adapter.enabled) {
    return "disabled";
  }
  if (input.adapter.mode === "cloud" && !input.apiKey) {
    return "needs-auth";
  }
  if (!input.server.reachable) {
    return "unreachable";
  }
  if (input.workflow !== null && !input.workflow.ok) {
    return "misconfigured";
  }
  return "ready";
}

function createComfyUiHealthNextActions(input: {
  readonly adapter: DirectorComfyUiAdapter;
  readonly status: DirectorComfyUiHealthStatus;
  readonly comfyCli: DirectorComfyUiCliStatus;
  readonly server: DirectorComfyUiServerHealth;
  readonly checkpoints: DirectorComfyUiModelFolderStatus | null;
  readonly workflow: DirectorComfyUiWorkflowInspectReport | null;
}): readonly string[] {
  const actions: string[] = [];
  if (input.status === "disabled") {
    actions.push("在设置里启用 ComfyUI 外部工具");
  }
  if (input.status === "needs-auth") {
    actions.push("配置 Comfy Cloud API Key 或切换本地模式");
  }
  if (!input.server.reachable) {
    actions.push("启动 ComfyUI 服务或修正 baseUrl");
  }
  if (!input.comfyCli.available && input.adapter.mode === "local") {
    actions.push("安装 comfy-cli 以启用启动、停止、节点和模型管理");
  }
  if (input.checkpoints?.queryable && input.checkpoints.count === 0) {
    actions.push("安装至少一个 checkpoint 模型");
  }
  if (input.workflow !== null && !input.workflow.ok) {
    actions.push("按 workflow doctor 修复缺失节点、模型或 embedding");
  }
  if (actions.length === 0) {
    actions.push("可以提交已配置的 ComfyUI workflow");
  }
  return actions;
}

async function resolveDirectorComfyUiDependencyFix(
  rootPath: string,
  input: DirectorComfyUiDependencyFixInput & { readonly dryRun: boolean },
): Promise<DirectorComfyUiDependencyFixResult> {
  const startedAt = Date.now();
  const checkedAt = input.now ?? new Date().toISOString();
  const stored = loadStoredDocument(rootPath).adapter;
  const adapter = createComfyUiAdapter(rootPath, stored);
  const notes: string[] = [];

  if (adapter.mode === "cloud") {
    return dependencyFixResult({
      startedAt,
      checkedAt,
      adapter,
      dryRun: input.dryRun,
      status: "cannot-fix-cloud",
      workflow: null,
      actions: [],
      failures: [],
      results: [],
      needsServerRestart: false,
      message: "Cloud ComfyUI 依赖由外部服务管理，Angel 不执行本地安装。",
      notes,
    });
  }

  const workflowLoad = loadWorkflow(
    input.workflowJson,
    input.workflowPath || adapter.defaultWorkflowPath,
  );
  if (!workflowLoad.ok) {
    return dependencyFixResult({
      startedAt,
      checkedAt,
      adapter,
      dryRun: input.dryRun,
      status: "cannot-fix",
      workflow: null,
      actions: [],
      failures: [],
      results: [],
      needsServerRestart: false,
      message: workflowLoad.message,
      notes,
    });
  }

  const comfyCli = await inspectComfyUiCliStatus(input.commandExists);
  if (!comfyCli.available || !comfyCli.command) {
    return dependencyFixResult({
      startedAt,
      checkedAt,
      adapter,
      dryRun: input.dryRun,
      status: "cannot-fix",
      workflow: null,
      actions: [],
      failures: [],
      results: [],
      needsServerRestart: false,
      message: "comfy-cli 不可用，无法安装 ComfyUI 依赖。",
      notes: [comfyCli.hint ?? "安装 comfy-cli 后再试。"],
    });
  }

  const autoDiagnostics = await resolveComfyUiDependencyFixDiagnostics({
    adapter,
    apiKey: resolveApiKey(undefined, stored.apiKey, adapter.apiKeyEnvVar),
    input,
  });
  const workflow = inspectDirectorComfyUiWorkflow(workflowLoad.workflow, {
    ...(autoDiagnostics.objectInfo === undefined ? {} : { objectInfo: autoDiagnostics.objectInfo }),
    ...(autoDiagnostics.installedModels === undefined
      ? {}
      : { installedModels: autoDiagnostics.installedModels }),
  });
  notes.push(...autoDiagnostics.notes);
  if (workflow.ok) {
    return dependencyFixResult({
      startedAt,
      checkedAt,
      adapter,
      dryRun: input.dryRun,
      status: "ready",
      workflow,
      actions: [],
      failures: [],
      results: [],
      needsServerRestart: false,
      message: "ComfyUI workflow 依赖已就绪，无需修复。",
      notes,
    });
  }

  const { actions, failures } = createComfyUiDependencyFixPlan({
    adapter,
    comfyCli,
    workflow,
    modelSources: input.modelSources ?? {},
    ...(input.hfToken === undefined ? {} : { hfToken: input.hfToken }),
    ...(input.civitaiToken === undefined ? {} : { civitaiToken: input.civitaiToken }),
  });
  const needsServerRestart = actions.some((action) => action.kind === "node");

  if (input.dryRun) {
    return dependencyFixResult({
      startedAt,
      checkedAt,
      adapter,
      dryRun: true,
      status: "planned",
      workflow,
      actions,
      failures,
      results: [],
      needsServerRestart,
      message: `ComfyUI dependency fix 计划已生成：${actions.length} 项可执行，${failures.length} 项需要人工补充。`,
      notes,
    });
  }

  if (input.sandboxCommandRunner === undefined && input.unsafeAllowRawCommandRunner !== true) {
    return dependencyFixResult({
      startedAt,
      checkedAt,
      adapter,
      dryRun: false,
      status: "cannot-fix",
      workflow,
      actions,
      failures,
      results: [],
      needsServerRestart,
      message: "ComfyUI dependency fix 需要 Agent OS 沙箱执行器；未执行裸 commandRunner。",
      notes,
    });
  }

  const results: DirectorComfyUiCommandResult[] = [];
  const runtimeFailures: DirectorComfyUiDependencyFixFailure[] = [...failures];
  for (const action of actions) {
    const result = await runComfyUiCommandPlan(action.command, {
      operationId: "fix_dependencies",
      commandRunner: input.commandRunner,
      sandboxCommandRunner: input.sandboxCommandRunner,
      ...(input.unsafeAllowRawCommandRunner === undefined
        ? {}
        : { unsafeAllowRawCommandRunner: input.unsafeAllowRawCommandRunner }),
    });
    results.push(result);
    if (result.exitCode !== 0) {
      runtimeFailures.push({
        kind: action.kind,
        reason: result.stderr || result.stdout || `command exited ${result.exitCode}`,
        ...(action.nodeId === undefined ? {} : { nodeId: action.nodeId }),
        ...(action.classType === undefined ? {} : { classType: action.classType }),
        ...(action.folder === undefined ? {} : { folder: action.folder }),
        ...(action.filename === undefined ? {} : { filename: action.filename }),
      });
    }
  }

  const status: DirectorComfyUiDependencyFixStatus =
    runtimeFailures.length === 0 ? "fixed" : results.length > 0 ? "partial" : "failed";
  return dependencyFixResult({
    startedAt,
    checkedAt,
    adapter,
    dryRun: false,
    status,
    workflow,
    actions,
    failures: runtimeFailures,
    results,
    needsServerRestart,
    message:
      runtimeFailures.length === 0
        ? `ComfyUI dependency fix 已执行 ${results.length} 项。`
        : `ComfyUI dependency fix 部分完成：${results.length} 项已尝试，${runtimeFailures.length} 项失败或缺少信息。`,
    notes,
  });
}

function createComfyUiLifecycleCommandPlan(
  adapter: DirectorComfyUiAdapter,
  comfyCli: DirectorComfyUiCliStatus,
  action: DirectorComfyUiLifecycleAction,
): readonly DirectorComfyUiCommandPlan[] {
  if (action === "status") {
    return [createComfyUiCommandPlan(adapter, comfyCli, ["which"], "查看本机 ComfyUI 安装位置。")];
  }
  if (action === "stop") {
    return [createComfyUiCommandPlan(adapter, comfyCli, ["stop"], "停止本机 ComfyUI。")];
  }
  if (action === "start") {
    return [createComfyUiLaunchCommandPlan(adapter, comfyCli)];
  }
  return [
    createComfyUiCommandPlan(adapter, comfyCli, ["stop"], "停止本机 ComfyUI。"),
    createComfyUiLaunchCommandPlan(adapter, comfyCli),
  ];
}

function createComfyUiLaunchCommandPlan(
  adapter: DirectorComfyUiAdapter,
  comfyCli: DirectorComfyUiCliStatus,
): DirectorComfyUiCommandPlan {
  return createComfyUiCommandPlan(
    adapter,
    comfyCli,
    ["launch", "--background", "--", "--port", String(readPortFromUrl(adapter.baseUrl) ?? 8188)],
    "后台启动本机 ComfyUI。",
  );
}

async function createComfyUiInstallCommandPlan(
  adapter: DirectorComfyUiAdapter,
  comfyCli: DirectorComfyUiCliStatus,
  input: DirectorComfyUiInstallInput,
): Promise<readonly DirectorComfyUiCommandPlan[]> {
  const gpuFlag = input.gpuFlag ?? defaultComfyUiGpuFlag();
  const installArgs = ["--skip-prompt", "install", gpuFlag];
  const plan: DirectorComfyUiCommandPlan[] = [];
  if (comfyCli.available && comfyCli.command) {
    plan.push(
      createComfyUiCommandPlan(adapter, comfyCli, installArgs, `安装 ComfyUI（${gpuFlag}）。`),
    );
  } else if (input.commandExists) {
    plan.push(...(await createComfyUiCliBootstrapPlan(adapter, input.commandExists, gpuFlag)));
  }
  if (input.skipLaunch !== true) {
    const launchCli =
      comfyCli.available && comfyCli.command ? comfyCli : { available: true, command: "comfy" };
    plan.push(createComfyUiLaunchCommandPlan(adapter, launchCli));
  }
  return plan;
}

async function createComfyUiCliBootstrapPlan(
  adapter: DirectorComfyUiAdapter,
  commandExists: NonNullable<DirectorComfyUiInstallInput["commandExists"]>,
  gpuFlag: "--nvidia" | "--amd" | "--m-series" | "--cpu",
): Promise<readonly DirectorComfyUiCommandPlan[]> {
  const commands: DirectorComfyUiCommandPlan[] = [];
  const hasPipx = await safeCommandExists(commandExists, "pipx");
  const hasPip = await safeCommandExists(commandExists, "pip");
  if (hasPipx) {
    commands.push({
      command: "pipx",
      args: ["install", "comfy-cli"],
      summary: "通过 pipx 安装 comfy-cli，避免污染系统 Python。",
    });
  } else if (hasPip) {
    commands.push({
      command: "pip",
      args: ["install", "--user", "comfy-cli"],
      summary: "通过 pip --user 安装 comfy-cli；建议优先使用 pipx 或 uvx。",
    });
  } else {
    return [];
  }
  commands.push(
    createComfyUiCommandPlan(
      adapter,
      { available: true, command: "comfy" },
      ["--skip-prompt", "install", gpuFlag],
      `安装 ComfyUI（${gpuFlag}）。`,
    ),
  );
  return commands;
}

function defaultComfyUiGpuFlag(): "--nvidia" | "--amd" | "--m-series" | "--cpu" {
  if (typeof process !== "undefined" && process.platform === "darwin" && process.arch === "arm64") {
    return "--m-series";
  }
  return "--nvidia";
}

async function safeCommandExists(
  commandExists: NonNullable<DirectorComfyUiInstallInput["commandExists"]>,
  command: string,
): Promise<boolean> {
  try {
    return (await commandExists(command)) === true;
  } catch {
    return false;
  }
}

async function resolveDirectorComfyUiInstall(
  rootPath: string,
  input: DirectorComfyUiInstallInput,
): Promise<DirectorComfyUiInstallResult> {
  const startedAt = Date.now();
  const checkedAt = input.now ?? new Date().toISOString();
  const dryRun = input.dryRun !== false;
  const stored = loadStoredDocument(rootPath).adapter;
  const adapter = createComfyUiAdapter(rootPath, stored);
  const notes: string[] = [
    "参考 Hermes ComfyUI Skill：本地安装只通过 comfy-cli/uvx/pipx 路径规划，外部工具本体仍由 ComfyUI 管。",
  ];

  if (adapter.mode === "cloud" && input.forceCloudOverride !== true) {
    return installResult({
      startedAt,
      checkedAt,
      adapter,
      dryRun,
      executed: false,
      status: "cannot-install-cloud",
      plan: [],
      results: [],
      message:
        "ComfyUI 当前是 Cloud 模式；Angel 不执行本地安装。请配置 Cloud API Key 或切回 local 后再安装。",
      notes,
    });
  }

  const comfyCli = await inspectComfyUiCliStatus(input.commandExists);
  const installPlan = await createComfyUiInstallCommandPlan(adapter, comfyCli, input);
  if (installPlan.length === 0) {
    return installResult({
      startedAt,
      checkedAt,
      adapter,
      dryRun,
      executed: false,
      status: "missing-installer",
      plan: [],
      results: [],
      message: "没有找到可用的 comfy-cli、uvx、pipx 或 pip，无法生成安全安装命令。",
      notes: [...notes, comfyCli.hint ?? "建议先安装 uv 或 pipx，再由 Angel 继续安装 ComfyUI。"],
    });
  }

  if (dryRun) {
    return installResult({
      startedAt,
      checkedAt,
      adapter,
      dryRun,
      executed: false,
      status: "planned",
      plan: installPlan,
      results: [],
      message: "ComfyUI 安装计划已生成，等待人工确认执行。",
      notes,
    });
  }

  if (input.sandboxCommandRunner === undefined && input.unsafeAllowRawCommandRunner !== true) {
    return installResult({
      startedAt,
      checkedAt,
      adapter,
      dryRun,
      executed: false,
      status: "missing-installer",
      plan: installPlan,
      results: [],
      message: "ComfyUI 安装需要 Agent OS 沙箱执行器；未执行裸 commandRunner。",
      notes,
    });
  }

  const results: DirectorComfyUiCommandResult[] = [];
  for (const commandPlan of installPlan) {
    const result = await runComfyUiCommandPlan(commandPlan, {
      operationId: "install",
      commandRunner: input.commandRunner,
      sandboxCommandRunner: input.sandboxCommandRunner,
      ...(input.unsafeAllowRawCommandRunner === undefined
        ? {}
        : { unsafeAllowRawCommandRunner: input.unsafeAllowRawCommandRunner }),
    });
    results.push(result);
    if (result.exitCode !== 0) {
      break;
    }
  }
  const succeeded =
    results.length === installPlan.length && results.every((result) => result.exitCode === 0);
  return installResult({
    startedAt,
    checkedAt,
    adapter,
    dryRun,
    executed: results.length > 0,
    status: succeeded
      ? "installed"
      : results.some((result) => result.exitCode === 0)
        ? "partial"
        : "failed",
    plan: installPlan,
    results,
    message: succeeded
      ? "ComfyUI 安装命令已执行完成。"
      : "ComfyUI 安装命令执行失败；请查看命令输出和日志后再重试。",
    notes,
  });
}

function createComfyUiDependencyFixPlan(input: {
  readonly adapter: DirectorComfyUiAdapter;
  readonly comfyCli: DirectorComfyUiCliStatus;
  readonly workflow: DirectorComfyUiWorkflowInspectReport;
  readonly modelSources: Readonly<Record<string, string>>;
  readonly hfToken?: string;
  readonly civitaiToken?: string;
}): {
  readonly actions: readonly DirectorComfyUiDependencyFixAction[];
  readonly failures: readonly DirectorComfyUiDependencyFixFailure[];
} {
  const actions: DirectorComfyUiDependencyFixAction[] = [];
  const failures: DirectorComfyUiDependencyFixFailure[] = [];
  const seenNodePackages = new Set<string>();
  const seenDownloads = new Set<string>();

  for (const missingNode of input.workflow.missingNodes) {
    const packageName = COMFYUI_NODE_TO_PACKAGE[missingNode.classType];
    if (!packageName) {
      failures.push({
        kind: "node",
        nodeId: missingNode.nodeId,
        classType: missingNode.classType,
        reason: "No registry mapping known. Search ComfyUI registry or install via Manager UI.",
      });
      continue;
    }
    if (seenNodePackages.has(packageName)) {
      continue;
    }
    seenNodePackages.add(packageName);
    actions.push({
      kind: "node",
      nodeId: missingNode.nodeId,
      classType: missingNode.classType,
      packageName,
      command: createComfyUiCommandPlan(
        input.adapter,
        input.comfyCli,
        ["--skip-prompt", "node", "install", packageName],
        `安装 ComfyUI custom node：${packageName}。`,
      ),
    });
  }

  for (const dependency of input.workflow.modelDependencies) {
    if (dependency.installed !== false) {
      continue;
    }
    const source = resolveComfyUiModelSource(dependency.value, input.modelSources);
    const kind = dependency.folder === "embeddings" ? "embedding" : "model";
    const filename = resolveComfyUiDownloadFilename(dependency, source);
    if (!source) {
      failures.push({
        kind,
        nodeId: dependency.nodeId,
        classType: dependency.classType,
        folder: dependency.folder,
        filename: dependency.value,
        reason: "No URL provided. Refusing to guess model download source.",
      });
      continue;
    }
    const key = `${dependency.folder}:${filename}:${source}`;
    if (seenDownloads.has(key)) {
      continue;
    }
    seenDownloads.add(key);
    actions.push({
      kind,
      nodeId: dependency.nodeId,
      classType: dependency.classType,
      folder: dependency.folder,
      filename,
      url: source,
      command: createComfyUiModelDownloadCommandPlan({
        adapter: input.adapter,
        comfyCli: input.comfyCli,
        url: source,
        folder: dependency.folder,
        filename,
        ...(input.hfToken === undefined ? {} : { hfToken: input.hfToken }),
        ...(input.civitaiToken === undefined ? {} : { civitaiToken: input.civitaiToken }),
      }),
    });
  }

  return { actions, failures };
}

async function resolveComfyUiDependencyFixDiagnostics(input: {
  readonly adapter: DirectorComfyUiAdapter;
  readonly apiKey: string | undefined;
  readonly input: DirectorComfyUiDependencyFixInput;
}): Promise<{
  readonly objectInfo?: unknown;
  readonly installedModels?: Readonly<Record<string, readonly string[]>>;
  readonly notes: readonly string[];
}> {
  const notes: string[] = [];
  const fetchImpl = input.input.fetchImpl ?? globalThis.fetch;
  let objectInfo = input.input.objectInfo;
  const installedModels: Record<string, readonly string[]> = {
    ...(input.input.installedModels ?? {}),
  };

  if (objectInfo === undefined && typeof fetchImpl === "function" && input.adapter.enabled) {
    const objectInfoResult = await fetchComfyUiJson({
      adapter: input.adapter,
      apiKey: input.apiKey,
      fetchImpl,
      path: "/object_info",
      timeoutMs: input.input.timeoutMs,
    });
    if (objectInfoResult.ok) {
      objectInfo = objectInfoResult.data;
    } else {
      notes.push(`ComfyUI object_info 读取失败：${objectInfoResult.error}`);
    }
  }

  for (const folder of ["checkpoints", "vae", "embeddings"]) {
    if (installedModels[folder] !== undefined) {
      continue;
    }
    if (typeof fetchImpl !== "function" || !input.adapter.enabled) {
      continue;
    }
    const folderStatus = await fetchComfyUiModelFolderStatus({
      adapter: input.adapter,
      apiKey: input.apiKey,
      fetchImpl,
      folder,
      timeoutMs: input.input.timeoutMs,
    });
    if (folderStatus.queryable) {
      installedModels[folder] = folderStatus.firstFew;
    } else if (folderStatus.error) {
      notes.push(`ComfyUI models/${folder} 读取失败：${folderStatus.error}`);
    }
  }

  return {
    ...(objectInfo === undefined ? {} : { objectInfo }),
    ...(Object.keys(installedModels).length === 0 ? {} : { installedModels }),
    notes,
  };
}

function createComfyUiCommandPlan(
  adapter: DirectorComfyUiAdapter,
  comfyCli: DirectorComfyUiCliStatus,
  args: readonly string[],
  summary: string,
): DirectorComfyUiCommandPlan {
  const commandParts = splitComfyUiCommand(comfyCli.command ?? "comfy");
  const workspaceArgs =
    adapter.localInstallPath.trim().length > 0
      ? ["--workspace", adapter.localInstallPath.trim()]
      : [];
  return {
    command: commandParts[0] ?? "comfy",
    args: [...commandParts.slice(1), ...workspaceArgs, ...args],
    summary,
  };
}

function createComfyUiModelDownloadCommandPlan(input: {
  readonly adapter: DirectorComfyUiAdapter;
  readonly comfyCli: DirectorComfyUiCliStatus;
  readonly url: string;
  readonly folder: string;
  readonly filename: string;
  readonly hfToken?: string;
  readonly civitaiToken?: string;
}): DirectorComfyUiCommandPlan {
  const args = [
    "--skip-prompt",
    "model",
    "download",
    "--url",
    input.url,
    "--relative-path",
    `models/${input.folder}`,
    "--filename",
    input.filename,
  ];
  if (input.hfToken) {
    args.push("--set-hf-api-token", input.hfToken);
  }
  if (input.civitaiToken) {
    args.push("--set-civitai-api-token", input.civitaiToken);
  }
  return createComfyUiCommandPlan(
    input.adapter,
    input.comfyCli,
    args,
    `下载 ComfyUI 模型：${input.filename}。`,
  );
}

function splitComfyUiCommand(command: string): readonly string[] {
  const parts = command.trim().split(/\s+/u).filter(Boolean);
  return parts.length > 0 ? parts : ["comfy"];
}

function resolveComfyUiModelSource(
  value: string,
  sources: Readonly<Record<string, string>>,
): string | undefined {
  for (const candidate of modelNameCandidates(value)) {
    const source = sources[candidate];
    if (typeof source === "string" && /^https?:\/\//iu.test(source)) {
      return source;
    }
  }
  return undefined;
}

function resolveComfyUiDownloadFilename(
  dependency: DirectorComfyUiWorkflowModelDependency,
  source: string | undefined,
): string {
  if (dependency.folder === "embeddings" && !/\.[A-Za-z0-9]+$/u.test(dependency.value)) {
    if (source?.endsWith(".safetensors")) {
      return `${dependency.value}.safetensors`;
    }
    return `${dependency.value}.pt`;
  }
  return dependency.value.split(/[\\/]/u).pop() ?? dependency.value;
}

function readPortFromUrl(value: string): number | undefined {
  try {
    const parsed = new URL(value);
    if (parsed.port) {
      return Number.parseInt(parsed.port, 10);
    }
    return parsed.protocol === "https:" ? 443 : 80;
  } catch {
    return undefined;
  }
}

function normalizeComfyUiCommandResult(
  plan: DirectorComfyUiCommandPlan,
  result: {
    readonly exitCode: number;
    readonly stdout?: string;
    readonly stderr?: string;
    readonly sandbox?: DirectorComfyUiSandboxCommandEvidence;
  },
): DirectorComfyUiCommandResult {
  return {
    command: plan.command,
    args: plan.args,
    exitCode: result.exitCode,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    ...(result.sandbox === undefined ? {} : { sandbox: result.sandbox }),
  };
}

async function runComfyUiCommandPlan(
  plan: DirectorComfyUiCommandPlan,
  input: {
    readonly operationId: DirectorComfyUiSandboxCommandRequest["operationId"];
    readonly commandRunner: DirectorComfyUiCommandRunner | undefined;
    readonly sandboxCommandRunner: DirectorComfyUiSandboxCommandRunner | undefined;
    readonly unsafeAllowRawCommandRunner?: boolean;
  },
): Promise<DirectorComfyUiCommandResult> {
  if (input.sandboxCommandRunner !== undefined) {
    return normalizeComfyUiCommandResult(
      plan,
      await input.sandboxCommandRunner({
        providerId: "comfyui",
        operationId: input.operationId,
        plan,
      }),
    );
  }
  if (input.commandRunner === undefined || input.unsafeAllowRawCommandRunner !== true) {
    return normalizeComfyUiCommandResult(plan, {
      exitCode: 1,
      stderr: "ComfyUI 命令需要 Agent OS 沙箱执行器；未执行裸 commandRunner。",
    });
  }
  return normalizeComfyUiCommandResult(
    plan,
    await input.commandRunner(plan.command, plan.args, {
      ...(plan.cwd === undefined ? {} : { cwd: plan.cwd }),
    }),
  );
}

function lifecycleActionResult(input: {
  readonly startedAt: number;
  readonly checkedAt: string;
  readonly adapter: DirectorComfyUiAdapter;
  readonly action: DirectorComfyUiLifecycleAction;
  readonly ok: boolean;
  readonly executed: boolean;
  readonly plan: readonly DirectorComfyUiCommandPlan[];
  readonly results: readonly DirectorComfyUiCommandResult[];
  readonly message: string;
  readonly error?: string;
  readonly notes: readonly string[];
}): DirectorComfyUiLifecycleActionResult {
  return {
    ok: input.ok,
    action: input.action,
    checkedAt: input.checkedAt,
    latencyMs: Math.max(0, Date.now() - input.startedAt),
    adapter: input.adapter,
    executed: input.executed,
    plan: input.plan,
    results: input.results,
    message: input.message,
    ...(input.error === undefined ? {} : { error: input.error }),
    notes: input.notes,
  };
}

function dependencyFixResult(input: {
  readonly startedAt: number;
  readonly checkedAt: string;
  readonly adapter: DirectorComfyUiAdapter;
  readonly dryRun: boolean;
  readonly status: DirectorComfyUiDependencyFixStatus;
  readonly workflow: DirectorComfyUiWorkflowInspectReport | null;
  readonly actions: readonly DirectorComfyUiDependencyFixAction[];
  readonly failures: readonly DirectorComfyUiDependencyFixFailure[];
  readonly results: readonly DirectorComfyUiCommandResult[];
  readonly needsServerRestart: boolean;
  readonly message: string;
  readonly notes: readonly string[];
}): DirectorComfyUiDependencyFixResult {
  const ok =
    input.status === "fixed" ||
    (input.status === "planned" && input.failures.length === 0) ||
    input.status === "ready" ||
    (input.status === "partial" && input.results.some((result) => result.exitCode === 0));
  return {
    ok,
    status: input.status,
    checkedAt: input.checkedAt,
    latencyMs: Math.max(0, Date.now() - input.startedAt),
    adapter: input.adapter,
    dryRun: input.dryRun,
    workflow: input.workflow,
    actions: input.actions,
    failures: input.failures,
    results: input.results,
    needsServerRestart: input.needsServerRestart,
    message: input.message,
    notes: input.notes,
  };
}

function installResult(input: {
  readonly startedAt: number;
  readonly checkedAt: string;
  readonly adapter: DirectorComfyUiAdapter;
  readonly dryRun: boolean;
  readonly executed: boolean;
  readonly status: DirectorComfyUiInstallStatus;
  readonly plan: readonly DirectorComfyUiCommandPlan[];
  readonly results: readonly DirectorComfyUiCommandResult[];
  readonly message: string;
  readonly notes: readonly string[];
}): DirectorComfyUiInstallResult {
  const ok = input.status === "planned" || input.status === "installed";
  return {
    ok,
    status: input.status,
    checkedAt: input.checkedAt,
    latencyMs: Math.max(0, Date.now() - input.startedAt),
    adapter: input.adapter,
    dryRun: input.dryRun,
    executed: input.executed,
    plan: input.plan,
    results: input.results,
    message: input.message,
    notes: input.notes,
  };
}

function configPath(rootPath: string): string {
  return join(rootPath, "comfyui.json");
}

function parsePromptResponse(body: string): {
  readonly promptId?: string;
  readonly nodeErrors: readonly string[];
  readonly rawError?: string;
} {
  const parsed = parseJsonObject(body);
  if (!parsed) {
    return { nodeErrors: [] };
  }
  return {
    ...(typeof parsed.prompt_id === "string" ? { promptId: parsed.prompt_id } : {}),
    nodeErrors: collectNodeErrors(parsed.node_errors),
    ...(typeof parsed.error === "string" ? { rawError: parsed.error } : {}),
  };
}

function collectNodeErrors(value: unknown): string[] {
  if (!isRecord(value)) {
    return [];
  }
  const errors: string[] = [];
  for (const [nodeId, nodeError] of Object.entries(value)) {
    errors.push(`node ${nodeId}: ${summarizeUnknownError(nodeError)}`);
  }
  return errors;
}

function summarizeNodeErrors(errors: readonly string[]): string[] {
  if (errors.length === 0) {
    return [];
  }
  return [
    "ComfyUI 返回 node_errors，通常是缺模型、缺自定义节点或 workflow 参数无效。",
    ...errors.slice(0, 5),
  ];
}

function summarizeUnknownError(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (isRecord(value)) {
    const messages = [
      typeof value.message === "string" ? value.message : undefined,
      typeof value.exception_message === "string" ? value.exception_message : undefined,
      Array.isArray(value.errors)
        ? value.errors.map((item) => summarizeUnknownError(item)).join("; ")
        : undefined,
    ].filter(Boolean);
    if (messages.length > 0) {
      return messages.join("; ");
    }
  }
  try {
    return JSON.stringify(value).slice(0, 500);
  } catch {
    return String(value);
  }
}

function formatPromptSubmitFailure(
  response: { readonly ok: boolean; readonly status: number; readonly statusText: string },
  promptResponse: {
    readonly promptId?: string;
    readonly nodeErrors: readonly string[];
    readonly rawError?: string;
  },
  diagnostics: readonly string[],
): string {
  if (!response.ok) {
    const status = `HTTP ${response.status} ${response.statusText || ""}`.trim();
    return `ComfyUI 提交失败：${status}。${diagnostics[0] ?? ""}`.trim();
  }
  if (promptResponse.nodeErrors.length > 0) {
    return `ComfyUI 拒绝执行 workflow：${diagnostics[0] ?? "存在 node_errors。"}`;
  }
  if (promptResponse.rawError) {
    return `ComfyUI 已响应错误：${promptResponse.rawError}`;
  }
  return "ComfyUI 已响应，但没有返回 prompt_id。";
}

function parseJsonObject(body: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(body) as unknown;
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function parseJsonValue(body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return undefined;
  }
}

function resolveApiKey(
  inputApiKey: string | undefined,
  storedApiKey: string | undefined,
  envVar: string,
): string | undefined {
  return firstSecret(inputApiKey) ?? firstSecret(storedApiKey) ?? firstSecret(process.env[envVar]);
}

function firstSecret(value: string | undefined): string | undefined {
  const first = String(value ?? "")
    .split(/[,\s]+/u)
    .map((item) => item.trim())
    .find(Boolean);
  return first && first.length > 0 ? first : undefined;
}

function maskSecret(value: string | undefined): string {
  if (!value) {
    return "未设置";
  }
  if (value.length <= 6) {
    return "•••";
  }
  return `${value.slice(0, 3)}...${value.slice(-3)}`;
}

function normalizeBaseUrl(value: string): string {
  return requireAbsoluteUrl(value).replace(/\/+$/u, "");
}

function requireAbsoluteUrl(value: string | boolean): string {
  const raw = requireString(value, "baseUrl");
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("invalid protocol");
    }
    return url.toString().replace(/\/+$/u, "");
  } catch {
    throw new Error("baseUrl must be an absolute http(s) URL.");
  }
}

function requireBoolean(value: string | boolean, key: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${key} must be a boolean.`);
  }
  return value;
}

function requireMode(value: string | boolean): DirectorComfyUiMode {
  if (value === "local" || value === "cloud") {
    return value;
  }
  throw new Error("mode must be local or cloud.");
}

function requireString(value: string | boolean, key: string): string {
  if (typeof value !== "string") {
    throw new Error(`${key} must be a string.`);
  }
  return value.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sanitizeFilePart(value: string): string {
  return value.replaceAll(/[^\w.-]+/gu, "_").slice(0, 80) || "prompt";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, ms));
  });
}
