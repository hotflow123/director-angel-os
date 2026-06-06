import { existsSync } from "node:fs";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type DirectorComfyUiDraftWorkflowKind = "script" | "copywriting" | "image" | "video";
export type DirectorComfyUiWorkflowMode = "script" | "image" | "video";

export const DIRECTOR_COMFYUI_TEMPLATE_BRIDGE_MODULE = "director_angel_bridge";

export interface DirectorComfyUiWorkflowDraftIntent {
  readonly workflowKind: DirectorComfyUiDraftWorkflowKind;
  readonly workflowModes: readonly DirectorComfyUiWorkflowMode[];
  readonly objective: string;
}

export interface DirectorComfyUiTemplateBridgePublishInput {
  readonly baseUrl: string;
  readonly mode: "local" | "cloud" | string;
  readonly templateName: string;
  readonly workflow: object;
  readonly localInstallPath?: string;
  readonly fetchImpl?: DirectorComfyUiTemplateFetch;
}

export interface DirectorComfyUiTemplateBridgePublishResult {
  readonly ok: boolean;
  readonly directOpenReady: boolean;
  readonly sourceModule: typeof DIRECTOR_COMFYUI_TEMPLATE_BRIDGE_MODULE;
  readonly templateName: string;
  readonly openUrl: string;
  readonly templateEndpoint: string;
  readonly localInstallPath?: string;
  readonly customNodePath?: string;
  readonly workflowPath?: string;
  readonly status?: number;
  readonly message: string;
}

interface DirectorComfyUiTemplateFetchInit {
  readonly method: "GET";
  readonly headers: Record<string, string>;
}

type DirectorComfyUiTemplateFetch = (
  url: string,
  init: DirectorComfyUiTemplateFetchInit,
) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  readonly statusText?: string;
  text(): Promise<string>;
}>;

export interface DirectorComfyUiVisibleWorkflowDraftInput {
  readonly id: string;
  readonly kind: DirectorComfyUiDraftWorkflowKind;
  readonly workflowModes?: readonly DirectorComfyUiWorkflowMode[];
  readonly objective: string;
  readonly status: string;
  readonly executable: boolean;
  readonly createdAt: string;
  readonly angelOutput?: string;
  readonly angelSource?: string;
  readonly toolParameters?: readonly DirectorComfyUiVisibleToolParameter[];
  readonly knowledgeHits?: readonly DirectorComfyUiVisibleContextHit[];
  readonly skillHits?: readonly DirectorComfyUiVisibleContextHit[];
  readonly handoffNotes?: readonly string[];
}

export interface DirectorComfyUiVisibleToolParameter {
  readonly name: string;
  readonly label: string;
  readonly value: string | number | boolean;
  readonly description?: string;
}

export interface DirectorComfyUiVisibleContextHit {
  readonly id: string;
  readonly title?: string;
}

export function createDirectorComfyUiVisibleWorkflowDraft(
  draft: DirectorComfyUiVisibleWorkflowDraftInput,
) {
  const angelOutput = normalizeMultilineText(
    draft.angelOutput,
    createDirectorComfyUiWorkflowPromptTemplate(draft.kind, draft.objective),
  );
  const workflowModes = normalizeDirectorComfyUiWorkflowModes(draft.workflowModes, draft.kind);
  const workflow = createDirectorComfyUiComposedWorkflow({ draft, angelOutput, workflowModes });
  return {
    last_node_id: workflow.lastNodeId,
    last_link_id: workflow.lastLinkId,
    nodes: workflow.nodes,
    links: workflow.links,
    groups: [
      {
        title: workflow.groupTitle,
        bounding: workflow.groupBounding,
        color: "#3f789e",
        font_size: 24,
        flags: {},
      },
    ],
    config: {},
    extra: {
      ds: { offset: [0, 0], scale: 0.8 },
      directorAngel: {
        schemaVersion: 1,
        draftId: draft.id,
        kind: draft.kind,
        workflowModes,
        objective: draft.objective,
        status: draft.status,
        executable: draft.executable,
        createdAt: draft.createdAt,
        angelSource: draft.angelSource ?? "director-angel",
        toolParameters: [...(draft.toolParameters ?? [])],
        knowledgeHits: [...(draft.knowledgeHits ?? [])],
        skillHits: [...(draft.skillHits ?? [])],
        boundary:
          "Director Angel generates the content and parameter plan first. ComfyUI is the external workflow canvas/executor; it is not expected to write scripts or make planning decisions by itself.",
      },
    },
    version: 0.4,
  };
}

export function parseDirectorComfyUiWorkflowDraftIntent(
  value: string,
): DirectorComfyUiWorkflowDraftIntent | null {
  const normalized = value.trim();
  const shorthand = parseDirectorComfyUiWorkflowModePrefix(normalized);
  if (shorthand !== null) {
    return shorthand;
  }
  const patterns: readonly RegExp[] = [
    /^(?:创建|新建|生成|制作)\s*(脚本|剧本|文案|图片|图像|视频|脚本[+＋/、，,与和及]*(?:图片|图像|视频).*)?\s*工作流\s*[:：,，-]?\s*(.*)$/u,
    /^(脚本|剧本|文案|图片|图像|视频|脚本[+＋/、，,与和及]*(?:图片|图像|视频).*)\s*工作流\s*[:：,，-]?\s*(.*)$/u,
    /^(脚本|剧本|文案)\s*[:：,，-]\s*(.*)$/u,
    /^(?:create|new|build)\s+(script|screenplay|copywriting|image|video|script[+\-_/,\s]*(?:image|video).*)?\s*workflow\s*[:：,，-]?\s*(.*)$/iu,
  ];
  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (!match) {
      continue;
    }
    const composition = normalizeDirectorComfyUiWorkflowComposition(match[1]);
    return {
      workflowKind: composition.workflowKind,
      workflowModes: composition.workflowModes,
      objective: (match[2] ?? "").trim(),
    };
  }
  return null;
}

function parseDirectorComfyUiWorkflowModePrefix(
  value: string,
): DirectorComfyUiWorkflowDraftIntent | null {
  const match = value.match(/^([^\s:：,，-]+)\s*(.*)$/u);
  if (!match) {
    return null;
  }
  const composition = parseDirectorComfyUiWorkflowComposition(match[1]);
  if (composition === null) {
    return null;
  }
  const objective = String(match[2] ?? "")
    .replace(/^(?:工作流)\s*[:：,，-]?\s*/u, "")
    .replace(/^[:：,，-]\s*/u, "")
    .trim();
  return {
    ...composition,
    objective,
  };
}

function parseDirectorComfyUiWorkflowComposition(
  value: string | undefined,
): Pick<DirectorComfyUiWorkflowDraftIntent, "workflowKind" | "workflowModes"> | null {
  const normalized = String(value ?? "")
    .trim()
    .replace(/工作流$/u, "");
  if (normalized.length === 0) {
    return null;
  }
  const parts = normalized
    .split(/\s*(?:\+|＋|\/|、|,|，|与|和|及|and)\s*/iu)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (parts.length === 0) {
    return null;
  }
  const workflowModes: DirectorComfyUiWorkflowMode[] = [];
  let sawCopywriting = false;
  for (const part of parts) {
    const mode = normalizeDirectorComfyUiWorkflowMode(part);
    if (mode === null) {
      return null;
    }
    if (part.toLowerCase() === "文案" || part.toLowerCase() === "copywriting") {
      sawCopywriting = true;
    }
    if (!workflowModes.includes(mode)) {
      workflowModes.push(mode);
    }
  }
  const workflowKind: DirectorComfyUiDraftWorkflowKind = workflowModes.includes("script")
    ? sawCopywriting && workflowModes.length === 1
      ? "copywriting"
      : "script"
    : workflowModes.includes("video")
      ? "video"
      : "image";
  return { workflowKind, workflowModes };
}

function normalizeDirectorComfyUiWorkflowComposition(
  value: string | undefined,
): Pick<DirectorComfyUiWorkflowDraftIntent, "workflowKind" | "workflowModes"> {
  const composition = parseDirectorComfyUiWorkflowComposition(value);
  if (composition !== null) {
    return composition;
  }
  const workflowKind = normalizeDirectorComfyUiWorkflowKind(value);
  return {
    workflowKind,
    workflowModes:
      workflowKind === "image" ? ["image"] : workflowKind === "video" ? ["video"] : ["script"],
  };
}

function normalizeDirectorComfyUiWorkflowMode(
  value: string | undefined,
): DirectorComfyUiWorkflowMode | null {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (
    normalized === "脚本" ||
    normalized === "剧本" ||
    normalized === "script" ||
    normalized === "screenplay"
  ) {
    return "script";
  }
  if (normalized === "文案" || normalized === "copywriting") {
    return "script";
  }
  if (normalized === "图片" || normalized === "图像" || normalized === "image") {
    return "image";
  }
  if (normalized === "视频" || normalized === "video") {
    return "video";
  }
  return null;
}

function normalizeDirectorComfyUiWorkflowKind(
  value: string | undefined,
): DirectorComfyUiDraftWorkflowKind {
  const normalized = String(value ?? "script")
    .trim()
    .toLowerCase();
  if (normalized === "文案" || normalized === "copywriting") {
    return "copywriting";
  }
  if (normalized === "图片" || normalized === "图像" || normalized === "image") {
    return "image";
  }
  if (normalized === "视频" || normalized === "video") {
    return "video";
  }
  return "script";
}

function createDirectorComfyUiComposedWorkflow(input: {
  readonly draft: DirectorComfyUiVisibleWorkflowDraftInput;
  readonly angelOutput: string;
  readonly workflowModes: readonly DirectorComfyUiWorkflowMode[];
}) {
  const hasScript = input.workflowModes.includes("script");
  const hasImage = input.workflowModes.includes("image");
  const hasVideo = input.workflowModes.includes("video");
  const nodes: object[] = [
    noteNode({
      id: 1,
      title: "Angel 内容与参数依据",
      pos: [80, 120],
      size: [460, 520],
      text: formatDirectorComfyUiReferenceNote(input.draft, input.angelOutput),
    }),
  ];
  const links: Array<[number, number, number, number, number, string]> = [];
  let nextNodeId = 2;
  let nextLinkId = 1;
  let maxX = 600;
  let maxY = 680;

  if (hasScript) {
    const scriptNodeId = nextNodeId++;
    const previewNodeId = nextNodeId++;
    const scriptLinkId = nextLinkId++;
    nodes.push(
      primitiveStringNode({
        id: scriptNodeId,
        title: "Angel 脚本文本",
        pos: [620, 120],
        size: [460, 420],
        value: input.angelOutput,
        links: [scriptLinkId],
        role: "Angel 生成的脚本、文案或分镜文本",
        color: "#233645",
        bgcolor: "#1a2733",
      }),
      previewAnyNode({
        id: previewNodeId,
        title: "预览脚本文本",
        pos: [1140, 220],
        sourceLinkId: scriptLinkId,
      }),
    );
    links.push([scriptLinkId, scriptNodeId, 0, previewNodeId, 0, "STRING"]);
    maxX = Math.max(maxX, 1460);
  }

  if (hasScript && (hasImage || hasVideo)) {
    const branch = createComposedSceneMediaBranches({
      draft: input.draft,
      angelOutput: input.angelOutput,
      x: 620,
      y: 660,
      nextNodeId,
      nextLinkId,
      includeImage: hasImage,
      includeVideo: hasVideo,
    });
    nodes.push(...branch.nodes);
    links.push(...branch.links);
    nextNodeId = branch.nextNodeId;
    nextLinkId = branch.nextLinkId;
    maxX = Math.max(maxX, branch.maxX);
    maxY = Math.max(maxY, branch.maxY);
  } else if (hasImage) {
    const branch = createComposedImageBranch({
      draft: input.draft,
      angelOutput: input.angelOutput,
      x: hasScript ? 1560 : 620,
      y: 120,
      nextNodeId,
      nextLinkId,
    });
    nodes.push(...branch.nodes);
    links.push(...branch.links);
    nextNodeId = branch.nextNodeId;
    nextLinkId = branch.nextLinkId;
    maxX = Math.max(maxX, branch.maxX);
    maxY = Math.max(maxY, branch.maxY);
  } else if (hasVideo) {
    const branch = createComposedVideoBranch({
      draft: input.draft,
      angelOutput: input.angelOutput,
      x: hasScript ? 1560 : 620,
      y: 120,
      nextNodeId,
      nextLinkId,
    });
    nodes.push(...branch.nodes);
    links.push(...branch.links);
    nextNodeId = branch.nextNodeId;
    nextLinkId = branch.nextLinkId;
    maxX = Math.max(maxX, branch.maxX);
    maxY = Math.max(maxY, branch.maxY);
  }

  return {
    lastNodeId: nextNodeId - 1,
    lastLinkId: nextLinkId - 1,
    nodes,
    links,
    groupTitle: `Director Angel ${formatDirectorComfyUiWorkflowModes(input.workflowModes)}完整工作流`,
    groupBounding: [40, 60, Math.max(1780, maxX - 40), Math.max(620, maxY - 60)],
  };
}

function createComposedImageBranch(input: {
  readonly draft: DirectorComfyUiVisibleWorkflowDraftInput;
  readonly angelOutput: string;
  readonly x: number;
  readonly y: number;
  readonly nextNodeId: number;
  readonly nextLinkId: number;
}): {
  readonly nodes: readonly object[];
  readonly links: readonly [number, number, number, number, number, string][];
  readonly nextNodeId: number;
  readonly nextLinkId: number;
  readonly maxX: number;
  readonly maxY: number;
} {
  const aspectRatio =
    readStringToolParameter(input.draft, "aspect_ratio") ??
    inferAspectRatio(input.draft.objective, "1:1");
  const dimensions = aspectRatioToWanImageDimensions(aspectRatio);
  const promptNodeId = input.nextNodeId;
  const negativeNodeId = input.nextNodeId + 1;
  const imageNodeId = input.nextNodeId + 2;
  const saveNodeId = input.nextNodeId + 3;
  const promptLinkId = input.nextLinkId;
  const negativeLinkId = input.nextLinkId + 1;
  const imageLinkId = input.nextLinkId + 2;
  return {
    nodes: [
      primitiveStringNode({
        id: promptNodeId,
        title: "图片正向提示词",
        pos: [input.x, input.y],
        size: [430, 260],
        value: createImagePrompt(input.draft, input.angelOutput),
        links: [promptLinkId],
        role: "Angel 从脚本或目标生成的图片提示词",
        color: "#233645",
        bgcolor: "#1a2733",
      }),
      primitiveStringNode({
        id: negativeNodeId,
        title: "图片负向提示词",
        pos: [input.x, input.y + 300],
        size: [430, 150],
        value: extractNegativePrompt(input.angelOutput),
        links: [negativeLinkId],
        role: "Angel 生成的图片负向提示词",
        color: "#3b3224",
        bgcolor: "#251f16",
      }),
      wanTextToImageNode({
        id: imageNodeId,
        title: "Wan 文生图",
        pos: [input.x + 500, input.y + 60],
        promptLinkId,
        negativeLinkId,
        outputLinkId: imageLinkId,
        width: dimensions.width,
        height: dimensions.height,
      }),
      saveImageNode({
        id: saveNodeId,
        title: "保存图片",
        pos: [input.x + 900, input.y + 120],
        imageLinkId,
        filenamePrefix: `DirectorAngel/${input.draft.id}/image`,
      }),
    ],
    links: [
      [promptLinkId, promptNodeId, 0, imageNodeId, 1, "STRING"],
      [negativeLinkId, negativeNodeId, 0, imageNodeId, 2, "STRING"],
      [imageLinkId, imageNodeId, 0, saveNodeId, 0, "IMAGE"],
    ],
    nextNodeId: input.nextNodeId + 4,
    nextLinkId: input.nextLinkId + 3,
    maxX: input.x + 1220,
    maxY: input.y + 500,
  };
}

interface DirectorComfyUiScenePlan {
  readonly index: number;
  readonly title: string;
  readonly summary: string;
  readonly imagePrompt: string;
  readonly videoPrompt: string;
}

function createComposedSceneMediaBranches(input: {
  readonly draft: DirectorComfyUiVisibleWorkflowDraftInput;
  readonly angelOutput: string;
  readonly x: number;
  readonly y: number;
  readonly nextNodeId: number;
  readonly nextLinkId: number;
  readonly includeImage: boolean;
  readonly includeVideo: boolean;
}): {
  readonly nodes: readonly object[];
  readonly links: readonly [number, number, number, number, number, string][];
  readonly nextNodeId: number;
  readonly nextLinkId: number;
  readonly maxX: number;
  readonly maxY: number;
} {
  const scenes = extractDirectorComfyUiScenePlans(input.draft, input.angelOutput, 3);
  const aspectRatio =
    readStringToolParameter(input.draft, "aspect_ratio") ??
    inferAspectRatio(input.draft.objective, "9:16");
  const dimensions = aspectRatioToWanImageDimensions(aspectRatio);
  const videoResolution = aspectRatioToApiResolution(aspectRatio);
  const negativePrompt = extractNegativePrompt(input.angelOutput);
  const sceneDuration = normalizeSceneVideoDuration(
    Math.ceil(
      (readNumericToolParameter(input.draft, "duration_seconds") ??
        inferDurationSeconds(input.draft.objective) ??
        scenes.length * 5) / scenes.length,
    ),
  );
  const nodes: object[] = [];
  const links: Array<[number, number, number, number, number, string]> = [];
  let nextNodeId = input.nextNodeId;
  let nextLinkId = input.nextLinkId;
  let maxX = input.x;
  let maxY = input.y;

  for (const scene of scenes) {
    const rowY = input.y + (scene.index - 1) * 560;
    const sceneX = input.x;
    const scriptNodeId = nextNodeId++;
    const previewNodeId = nextNodeId++;
    const scriptLinkId = nextLinkId++;
    nodes.push(
      primitiveStringNode({
        id: scriptNodeId,
        title: `场景 ${scene.index} 脚本`,
        pos: [sceneX, rowY],
        size: [360, 220],
        value: `${scene.title}\n${scene.summary}`,
        links: [scriptLinkId],
        role: "Angel 拆分出的单场景脚本",
        color: "#26343a",
        bgcolor: "#172126",
      }),
      previewAnyNode({
        id: previewNodeId,
        title: `预览场景 ${scene.index}`,
        pos: [sceneX, rowY + 260],
        sourceLinkId: scriptLinkId,
      }),
    );
    links.push([scriptLinkId, scriptNodeId, 0, previewNodeId, 0, "STRING"]);

    let sceneImageVideoLinkId: number | null = null;
    let sceneImageSourceNodeId: number | null = null;
    let mediaStartX = sceneX + 430;
    if (input.includeImage) {
      const imagePromptNodeId = nextNodeId++;
      const imageNegativeNodeId = nextNodeId++;
      const imageNodeId = nextNodeId++;
      const saveImageNodeId = nextNodeId++;
      const imagePromptLinkId = nextLinkId++;
      const imageNegativeLinkId = nextLinkId++;
      const imageSaveLinkId = nextLinkId++;
      sceneImageVideoLinkId = input.includeVideo ? nextLinkId++ : null;
      sceneImageSourceNodeId = imageNodeId;
      nodes.push(
        primitiveStringNode({
          id: imagePromptNodeId,
          title: `场景 ${scene.index} 图片提示词`,
          pos: [mediaStartX, rowY],
          size: [360, 190],
          value: scene.imagePrompt,
          links: [imagePromptLinkId],
          role: "Angel 为当前场景生成的首帧/关键帧图片提示词",
          color: "#233645",
          bgcolor: "#1a2733",
        }),
        primitiveStringNode({
          id: imageNegativeNodeId,
          title: `场景 ${scene.index} 图片负向提示词`,
          pos: [mediaStartX, rowY + 220],
          size: [360, 130],
          value: negativePrompt,
          links: [imageNegativeLinkId],
          role: "当前场景图片负向提示词",
          color: "#3b3224",
          bgcolor: "#251f16",
        }),
        wanTextToImageNode({
          id: imageNodeId,
          title: `场景 ${scene.index} 文生图`,
          pos: [mediaStartX + 420, rowY + 20],
          promptLinkId: imagePromptLinkId,
          negativeLinkId: imageNegativeLinkId,
          outputLinkId: imageSaveLinkId,
          outputLinkIds:
            sceneImageVideoLinkId === null
              ? [imageSaveLinkId]
              : [imageSaveLinkId, sceneImageVideoLinkId],
          width: dimensions.width,
          height: dimensions.height,
        }),
        saveImageNode({
          id: saveImageNodeId,
          title: `保存场景 ${scene.index} 图片`,
          pos: [mediaStartX + 820, rowY + 60],
          imageLinkId: imageSaveLinkId,
          filenamePrefix: `DirectorAngel/${input.draft.id}/scene_${scene.index}_image`,
        }),
      );
      links.push(
        [imagePromptLinkId, imagePromptNodeId, 0, imageNodeId, 1, "STRING"],
        [imageNegativeLinkId, imageNegativeNodeId, 0, imageNodeId, 2, "STRING"],
        [imageSaveLinkId, imageNodeId, 0, saveImageNodeId, 0, "IMAGE"],
      );
      mediaStartX += 1180;
      maxX = Math.max(maxX, mediaStartX);
    }

    if (input.includeVideo) {
      const videoPromptNodeId = nextNodeId++;
      const videoNegativeNodeId = nextNodeId++;
      const videoNodeId = nextNodeId++;
      const saveVideoNodeId = nextNodeId++;
      const videoPromptLinkId = nextLinkId++;
      const videoNegativeLinkId = nextLinkId++;
      const videoOutputLinkId = nextLinkId++;
      nodes.push(
        primitiveStringNode({
          id: videoPromptNodeId,
          title: `场景 ${scene.index} 视频提示词`,
          pos: [mediaStartX, rowY],
          size: [380, 190],
          value: scene.videoPrompt,
          links: [videoPromptLinkId],
          role: "Angel 为当前场景生成的视频提示词",
          color: "#233645",
          bgcolor: "#1a2733",
        }),
        primitiveStringNode({
          id: videoNegativeNodeId,
          title: `场景 ${scene.index} 视频负向提示词`,
          pos: [mediaStartX, rowY + 220],
          size: [380, 130],
          value: negativePrompt,
          links: [videoNegativeLinkId],
          role: "当前场景视频负向提示词",
          color: "#3b3224",
          bgcolor: "#251f16",
        }),
      );
      if (sceneImageVideoLinkId !== null && sceneImageSourceNodeId !== null) {
        nodes.push(
          wanImageToVideoNode({
            id: videoNodeId,
            title: `场景 ${scene.index} 图生视频`,
            pos: [mediaStartX + 440, rowY + 20],
            firstFrameLinkId: sceneImageVideoLinkId,
            promptLinkId: videoPromptLinkId,
            negativeLinkId: videoNegativeLinkId,
            outputLinkId: videoOutputLinkId,
            resolution: videoResolution,
            duration: sceneDuration,
            seed: scene.index - 1,
          }),
        );
        links.push(
          [sceneImageVideoLinkId, sceneImageSourceNodeId, 0, videoNodeId, 0, "IMAGE"],
          [videoPromptLinkId, videoPromptNodeId, 0, videoNodeId, 1, "STRING"],
          [videoNegativeLinkId, videoNegativeNodeId, 0, videoNodeId, 2, "STRING"],
        );
      } else {
        nodes.push(
          wanTextToVideoNode({
            id: videoNodeId,
            title: `场景 ${scene.index} 文生视频`,
            pos: [mediaStartX + 440, rowY + 20],
            promptLinkId: videoPromptLinkId,
            negativeLinkId: videoNegativeLinkId,
            outputLinkId: videoOutputLinkId,
            size: aspectRatioToWanVideoSize(aspectRatio),
            duration: sceneDuration,
            seed: scene.index - 1,
          }),
        );
        links.push(
          [videoPromptLinkId, videoPromptNodeId, 0, videoNodeId, 1, "STRING"],
          [videoNegativeLinkId, videoNegativeNodeId, 0, videoNodeId, 2, "STRING"],
        );
      }
      nodes.push(
        saveVideoNode({
          id: saveVideoNodeId,
          title: `保存场景 ${scene.index} 视频`,
          pos: [mediaStartX + 840, rowY + 80],
          videoLinkId: videoOutputLinkId,
          filenamePrefix: `DirectorAngel/${input.draft.id}/scene_${scene.index}_video`,
        }),
      );
      links.push([videoOutputLinkId, videoNodeId, 0, saveVideoNodeId, 0, "VIDEO"]);
      maxX = Math.max(maxX, mediaStartX + 1180);
    }
    maxY = Math.max(maxY, rowY + 420);
  }

  return {
    nodes,
    links,
    nextNodeId,
    nextLinkId,
    maxX,
    maxY,
  };
}

function createComposedVideoBranch(input: {
  readonly draft: DirectorComfyUiVisibleWorkflowDraftInput;
  readonly angelOutput: string;
  readonly x: number;
  readonly y: number;
  readonly nextNodeId: number;
  readonly nextLinkId: number;
}): {
  readonly nodes: readonly object[];
  readonly links: readonly [number, number, number, number, number, string][];
  readonly nextNodeId: number;
  readonly nextLinkId: number;
  readonly maxX: number;
  readonly maxY: number;
} {
  const duration =
    readNumericToolParameter(input.draft, "duration_seconds") ??
    inferDurationSeconds(input.draft.objective) ??
    15;
  const clipCount = Math.max(1, Math.min(4, Math.ceil(duration / 15)));
  const clipDuration = normalizeWanDuration(Math.ceil(duration / clipCount));
  const aspectRatio =
    readStringToolParameter(input.draft, "aspect_ratio") ??
    inferAspectRatio(input.draft.objective, "9:16");
  const size = aspectRatioToWanVideoSize(aspectRatio);
  const negativePrompt = extractNegativePrompt(input.angelOutput);
  const nodes: object[] = [];
  const links: Array<[number, number, number, number, number, string]> = [];
  let nextNodeId = input.nextNodeId;
  let nextLinkId = input.nextLinkId;

  for (let index = 0; index < clipCount; index += 1) {
    const promptNodeId = nextNodeId++;
    const negativeNodeId = nextNodeId++;
    const videoNodeId = nextNodeId++;
    const saveNodeId = nextNodeId++;
    const promptLinkId = nextLinkId++;
    const negativeLinkId = nextLinkId++;
    const videoLinkId = nextLinkId++;
    const clipX = input.x + index * 620;
    nodes.push(
      primitiveStringNode({
        id: promptNodeId,
        title: `片段 ${index + 1} 视频提示词`,
        pos: [clipX, input.y],
        size: [430, 260],
        value: createVideoClipPrompt({
          draft: input.draft,
          angelOutput: input.angelOutput,
          clipIndex: index,
          clipCount,
        }),
        links: [promptLinkId],
        role: "Angel 从脚本或目标生成的视频提示词",
        color: "#233645",
        bgcolor: "#1a2733",
      }),
      primitiveStringNode({
        id: negativeNodeId,
        title: `片段 ${index + 1} 负向提示词`,
        pos: [clipX, input.y + 300],
        size: [430, 150],
        value: negativePrompt,
        links: [negativeLinkId],
        role: "Angel 生成的视频负向提示词",
        color: "#3b3224",
        bgcolor: "#251f16",
      }),
      wanTextToVideoNode({
        id: videoNodeId,
        title: `Wan 文生视频 ${index + 1}`,
        pos: [clipX + 500, input.y + 50],
        promptLinkId,
        negativeLinkId,
        outputLinkId: videoLinkId,
        size,
        duration: clipDuration,
        seed: index,
      }),
      saveVideoNode({
        id: saveNodeId,
        title: `保存视频片段 ${index + 1}`,
        pos: [clipX + 900, input.y + 120],
        videoLinkId,
        filenamePrefix: `DirectorAngel/${input.draft.id}/clip_${index + 1}`,
      }),
    );
    links.push(
      [promptLinkId, promptNodeId, 0, videoNodeId, 1, "STRING"],
      [negativeLinkId, negativeNodeId, 0, videoNodeId, 2, "STRING"],
      [videoLinkId, videoNodeId, 0, saveNodeId, 0, "VIDEO"],
    );
  }

  return {
    nodes,
    links,
    nextNodeId,
    nextLinkId,
    maxX: input.x + 1220 + Math.max(0, clipCount - 1) * 620,
    maxY: input.y + 500,
  };
}

function createDirectorComfyUiScriptToVideoWorkflow(input: {
  readonly draft: DirectorComfyUiVisibleWorkflowDraftInput;
  readonly angelOutput: string;
}) {
  const duration =
    readNumericToolParameter(input.draft, "duration_seconds") ??
    inferDurationSeconds(input.draft.objective) ??
    15;
  const clipCount = Math.max(1, Math.min(4, Math.ceil(duration / 15)));
  const clipDuration = normalizeWanDuration(Math.ceil(duration / clipCount));
  const aspectRatio =
    readStringToolParameter(input.draft, "aspect_ratio") ??
    inferAspectRatio(input.draft.objective, "9:16");
  const size = aspectRatioToWanVideoSize(aspectRatio);
  const negativePrompt = extractNegativePrompt(input.angelOutput);
  const nodes: object[] = [
    noteNode({
      id: 1,
      title: "Angel 脚本与参数依据",
      pos: [80, 120],
      size: [500, 520],
      text: formatDirectorComfyUiReferenceNote(input.draft, input.angelOutput),
    }),
  ];
  const links: Array<[number, number, number, number, number, string]> = [];
  let nextNodeId = 2;
  let nextLinkId = 1;

  for (let index = 0; index < clipCount; index += 1) {
    const promptNodeId = nextNodeId++;
    const negativeNodeId = nextNodeId++;
    const videoNodeId = nextNodeId++;
    const saveNodeId = nextNodeId++;
    const promptLinkId = nextLinkId++;
    const negativeLinkId = nextLinkId++;
    const videoLinkId = nextLinkId++;
    const x = 680 + index * 620;
    const clipPrompt = createVideoClipPrompt({
      draft: input.draft,
      angelOutput: input.angelOutput,
      clipIndex: index,
      clipCount,
    });
    nodes.push(
      primitiveStringNode({
        id: promptNodeId,
        title: `片段 ${index + 1} 视频提示词`,
        pos: [x, 120],
        size: [430, 260],
        value: clipPrompt,
        links: [promptLinkId],
        role: "Angel 生成的视频提示词",
        color: "#233645",
        bgcolor: "#1a2733",
      }),
      primitiveStringNode({
        id: negativeNodeId,
        title: `片段 ${index + 1} 负向提示词`,
        pos: [x, 420],
        size: [430, 150],
        value: negativePrompt,
        links: [negativeLinkId],
        role: "Angel 生成的负向提示词",
        color: "#3b3224",
        bgcolor: "#251f16",
      }),
      wanTextToVideoNode({
        id: videoNodeId,
        title: `Wan 文生视频 ${index + 1}`,
        pos: [x + 500, 170],
        promptLinkId,
        negativeLinkId,
        outputLinkId: videoLinkId,
        size,
        duration: clipDuration,
        seed: index,
      }),
      saveVideoNode({
        id: saveNodeId,
        title: `保存视频片段 ${index + 1}`,
        pos: [x + 900, 240],
        videoLinkId,
        filenamePrefix: `DirectorAngel/${input.draft.id}/clip_${index + 1}`,
      }),
    );
    links.push(
      [promptLinkId, promptNodeId, 0, videoNodeId, 1, "STRING"],
      [negativeLinkId, negativeNodeId, 0, videoNodeId, 2, "STRING"],
      [videoLinkId, videoNodeId, 0, saveNodeId, 0, "VIDEO"],
    );
  }

  return {
    lastNodeId: nextNodeId - 1,
    lastLinkId: nextLinkId - 1,
    nodes,
    links,
    groupTitle: `Director Angel ${formatDirectorComfyUiDraftWorkflowKind(input.draft.kind)}到视频完整工作流`,
    groupBounding: [40, 60, 1180 + clipCount * 620, 620],
  };
}

function createDirectorComfyUiImageWorkflow(input: {
  readonly draft: DirectorComfyUiVisibleWorkflowDraftInput;
  readonly angelOutput: string;
}) {
  const aspectRatio =
    readStringToolParameter(input.draft, "aspect_ratio") ??
    inferAspectRatio(input.draft.objective, "1:1");
  const dimensions = aspectRatioToWanImageDimensions(aspectRatio);
  const promptLinkId = 1;
  const negativeLinkId = 2;
  const imageLinkId = 3;
  const positivePrompt = createImagePrompt(input.draft, input.angelOutput);
  const negativePrompt = extractNegativePrompt(input.angelOutput);
  return {
    lastNodeId: 5,
    lastLinkId: 3,
    nodes: [
      noteNode({
        id: 1,
        title: "Angel 图片方案依据",
        pos: [80, 120],
        size: [420, 420],
        text: formatDirectorComfyUiReferenceNote(input.draft, input.angelOutput),
      }),
      primitiveStringNode({
        id: 2,
        title: "正向提示词",
        pos: [580, 120],
        size: [430, 260],
        value: positivePrompt,
        links: [promptLinkId],
        role: "Angel 生成的图片提示词",
        color: "#233645",
        bgcolor: "#1a2733",
      }),
      primitiveStringNode({
        id: 3,
        title: "负向提示词",
        pos: [580, 420],
        size: [430, 150],
        value: negativePrompt,
        links: [negativeLinkId],
        role: "Angel 生成的负向提示词",
        color: "#3b3224",
        bgcolor: "#251f16",
      }),
      wanTextToImageNode({
        id: 4,
        title: "Wan 文生图",
        pos: [1080, 180],
        promptLinkId,
        negativeLinkId,
        outputLinkId: imageLinkId,
        width: dimensions.width,
        height: dimensions.height,
      }),
      saveImageNode({
        id: 5,
        title: "保存图片",
        pos: [1480, 240],
        imageLinkId,
        filenamePrefix: `DirectorAngel/${input.draft.id}`,
      }),
    ],
    links: [
      [promptLinkId, 2, 0, 4, 1, "STRING"],
      [negativeLinkId, 3, 0, 4, 2, "STRING"],
      [imageLinkId, 4, 0, 5, 0, "IMAGE"],
    ] satisfies Array<[number, number, number, number, number, string]>,
    groupTitle: "Director Angel 图片完整工作流",
    groupBounding: [40, 60, 1780, 560],
  };
}

function noteNode(input: {
  readonly id: number;
  readonly title: string;
  readonly pos: [number, number];
  readonly size: [number, number];
  readonly text: string;
}) {
  return {
    id: input.id,
    type: "MarkdownNote",
    pos: input.pos,
    size: input.size,
    flags: {},
    order: 0,
    mode: 0,
    inputs: [],
    outputs: [],
    title: input.title,
    properties: {},
    widgets_values: [input.text],
    color: "#222",
    bgcolor: "#000",
  };
}

function primitiveStringNode(input: {
  readonly id: number;
  readonly title: string;
  readonly pos: [number, number];
  readonly size: [number, number];
  readonly value: string;
  readonly links: readonly number[];
  readonly role: string;
  readonly color: string;
  readonly bgcolor: string;
}) {
  return {
    id: input.id,
    type: "PrimitiveStringMultiline",
    pos: input.pos,
    size: input.size,
    flags: {},
    order: input.id,
    mode: 0,
    title: input.title,
    inputs: [],
    outputs: [{ name: "STRING", type: "STRING", links: [...input.links], slot_index: 0 }],
    properties: {
      "Node name for S&R": "PrimitiveStringMultiline",
      "Director Angel role": input.role,
    },
    widgets_values: [input.value],
    color: input.color,
    bgcolor: input.bgcolor,
  };
}

function previewAnyNode(input: {
  readonly id: number;
  readonly title: string;
  readonly pos: [number, number];
  readonly sourceLinkId: number;
}) {
  return {
    id: input.id,
    type: "PreviewAny",
    pos: input.pos,
    size: [320, 180],
    flags: {},
    order: input.id,
    mode: 0,
    title: input.title,
    inputs: [{ name: "source", type: "STRING", link: input.sourceLinkId }],
    outputs: [],
    properties: {
      "Node name for S&R": "PreviewAny",
      "Director Angel role": "文本预览节点",
    },
    widgets_values: [],
    color: "#26343a",
    bgcolor: "#172126",
  };
}

function wanTextToVideoNode(input: {
  readonly id: number;
  readonly title: string;
  readonly pos: [number, number];
  readonly promptLinkId: number;
  readonly negativeLinkId: number;
  readonly outputLinkId: number;
  readonly size: string;
  readonly duration: number;
  readonly seed: number;
}) {
  return {
    id: input.id,
    type: "WanTextToVideoApi",
    pos: input.pos,
    size: [360, 380],
    flags: {},
    order: input.id,
    mode: 0,
    title: input.title,
    inputs: [
      { name: "prompt", type: "STRING", widget: { name: "prompt" }, link: input.promptLinkId },
      {
        name: "negative_prompt",
        type: "STRING",
        widget: { name: "negative_prompt" },
        link: input.negativeLinkId,
      },
    ],
    outputs: [{ name: "VIDEO", type: "VIDEO", links: [input.outputLinkId], slot_index: 0 }],
    properties: {
      "Node name for S&R": "WanTextToVideoApi",
      "Director Angel role": "ComfyUI 视频生成执行节点",
    },
    widgets_values: [
      "wan2.6-t2v",
      "",
      "",
      input.size,
      input.duration,
      input.seed,
      false,
      true,
      false,
      "multi",
    ],
    color: "#2f3d26",
    bgcolor: "#1b2618",
  };
}

function wanImageToVideoNode(input: {
  readonly id: number;
  readonly title: string;
  readonly pos: [number, number];
  readonly firstFrameLinkId: number;
  readonly promptLinkId: number;
  readonly negativeLinkId: number;
  readonly outputLinkId: number;
  readonly resolution: string;
  readonly duration: number;
  readonly seed: number;
}) {
  return {
    id: input.id,
    type: "Wan2ImageToVideoApi",
    pos: input.pos,
    size: [380, 380],
    flags: {},
    order: input.id,
    mode: 0,
    title: input.title,
    inputs: [
      { name: "first_frame", type: "IMAGE", link: input.firstFrameLinkId },
      {
        name: "prompt",
        type: "STRING",
        widget: { name: "model.prompt" },
        link: input.promptLinkId,
      },
      {
        name: "negative_prompt",
        type: "STRING",
        widget: { name: "model.negative_prompt" },
        link: input.negativeLinkId,
      },
    ],
    outputs: [{ name: "VIDEO", type: "VIDEO", links: [input.outputLinkId], slot_index: 0 }],
    properties: {
      "Node name for S&R": "Wan2ImageToVideoApi",
      "Director Angel role": "ComfyUI 图生视频执行节点",
    },
    widgets_values: [
      "wan2.7-i2v",
      "",
      "",
      input.resolution,
      input.duration,
      input.seed,
      true,
      false,
    ],
    color: "#2f3d26",
    bgcolor: "#1b2618",
  };
}

function saveVideoNode(input: {
  readonly id: number;
  readonly title: string;
  readonly pos: [number, number];
  readonly videoLinkId: number;
  readonly filenamePrefix: string;
}) {
  return {
    id: input.id,
    type: "SaveVideo",
    pos: input.pos,
    size: [320, 160],
    flags: {},
    order: input.id,
    mode: 0,
    title: input.title,
    inputs: [{ name: "video", type: "VIDEO", link: input.videoLinkId }],
    outputs: [],
    properties: {
      "Node name for S&R": "SaveVideo",
      "Director Angel role": "视频输出节点",
    },
    widgets_values: [input.filenamePrefix, "mp4", "h264"],
    color: "#443047",
    bgcolor: "#281b2a",
  };
}

function wanTextToImageNode(input: {
  readonly id: number;
  readonly title: string;
  readonly pos: [number, number];
  readonly promptLinkId: number;
  readonly negativeLinkId: number;
  readonly outputLinkId: number;
  readonly outputLinkIds?: readonly number[];
  readonly width: number;
  readonly height: number;
}) {
  return {
    id: input.id,
    type: "WanTextToImageApi",
    pos: input.pos,
    size: [360, 320],
    flags: {},
    order: input.id,
    mode: 0,
    title: input.title,
    inputs: [
      { name: "prompt", type: "STRING", widget: { name: "prompt" }, link: input.promptLinkId },
      {
        name: "negative_prompt",
        type: "STRING",
        widget: { name: "negative_prompt" },
        link: input.negativeLinkId,
      },
    ],
    outputs: [
      {
        name: "IMAGE",
        type: "IMAGE",
        links: [...(input.outputLinkIds ?? [input.outputLinkId])],
        slot_index: 0,
      },
    ],
    properties: {
      "Node name for S&R": "WanTextToImageApi",
      "Director Angel role": "ComfyUI 图片生成执行节点",
    },
    widgets_values: ["wan2.5-t2i-preview", "", "", input.width, input.height, 0, true, false],
    color: "#2f3d26",
    bgcolor: "#1b2618",
  };
}

function saveImageNode(input: {
  readonly id: number;
  readonly title: string;
  readonly pos: [number, number];
  readonly imageLinkId: number;
  readonly filenamePrefix: string;
}) {
  return {
    id: input.id,
    type: "SaveImage",
    pos: input.pos,
    size: [300, 120],
    flags: {},
    order: input.id,
    mode: 0,
    title: input.title,
    inputs: [{ name: "images", type: "IMAGE", link: input.imageLinkId }],
    outputs: [],
    properties: {
      "Node name for S&R": "SaveImage",
      "Director Angel role": "图片输出节点",
    },
    widgets_values: [input.filenamePrefix],
    color: "#443047",
    bgcolor: "#281b2a",
  };
}

function formatDirectorComfyUiReferenceNote(
  draft: DirectorComfyUiVisibleWorkflowDraftInput,
  angelOutput: string,
): string {
  return [
    `# Angel ${formatDirectorComfyUiDraftWorkflowKind(draft.kind)}依据`,
    "",
    `目标：${draft.objective}`,
    `来源：${draft.angelSource ?? "director-angel"}`,
    "",
    "## Angel 生成内容",
    truncateText(angelOutput, 2500),
    "",
    "## 参数",
    formatDirectorComfyUiToolParameters(draft),
    "",
    "## 召回",
    formatDirectorComfyUiContextText(draft),
  ].join("\n");
}

function createVideoClipPrompt(input: {
  readonly draft: DirectorComfyUiVisibleWorkflowDraftInput;
  readonly angelOutput: string;
  readonly clipIndex: number;
  readonly clipCount: number;
}): string {
  const extracted = extractPositivePrompts(input.angelOutput);
  const prompt = extracted[input.clipIndex] ?? extracted[0];
  if (prompt) {
    return prompt;
  }
  return truncateText(
    [
      `Create video clip ${input.clipIndex + 1}/${input.clipCount} for: ${input.draft.objective}.`,
      "Use the Angel script below as the source. Keep the same character, scene continuity, cinematic motion, expressive action, clear subject, no subtitles.",
      input.angelOutput,
    ].join("\n"),
    1800,
  );
}

function createImagePrompt(
  draft: DirectorComfyUiVisibleWorkflowDraftInput,
  angelOutput: string,
): string {
  return (
    extractPositivePrompts(angelOutput)[0] ??
    truncateText(
      [
        `Create one polished image for: ${draft.objective}.`,
        "Clear subject, strong composition, cinematic lighting, detailed visual design.",
        angelOutput,
      ].join("\n"),
      1600,
    )
  );
}

function extractPositivePrompts(value: string): string[] {
  const prompts = [
    ...value.matchAll(/"image_prompt_positive"\s*:\s*"([^"]+)"/giu),
    ...value.matchAll(/(?:正向提示词|positive prompt|视觉提示词)\s*[:：]\s*([^\n]+)/giu),
  ]
    .map((match) => match[1]?.trim())
    .filter((item): item is string => typeof item === "string" && item.length > 0);
  return [...new Set(prompts)];
}

function extractNegativePrompt(value: string): string {
  const match =
    value.match(/"image_prompt_negative"\s*:\s*"([^"]+)"/iu) ??
    value.match(/(?:负向提示词|negative prompt)\s*[:：]\s*([^\n]+)/iu);
  const extracted = match?.[1]?.trim();
  return extracted && extracted.length > 0
    ? extracted
    : "ugly, deformed, disfigured, poor quality, low resolution, bad anatomy, extra limbs, mutated, text, watermark, signature";
}

function readNumericToolParameter(
  draft: DirectorComfyUiVisibleWorkflowDraftInput,
  name: string,
): number | null {
  const parameter = draft.toolParameters?.find((item) => item.name === name);
  const value = parameter?.value;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readStringToolParameter(
  draft: DirectorComfyUiVisibleWorkflowDraftInput,
  name: string,
): string | null {
  const value = draft.toolParameters?.find((item) => item.name === name)?.value;
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function inferDurationSeconds(value: string): number | null {
  const match = value.match(/(\d{1,3})\s*(?:秒|s|sec|seconds)/iu);
  if (!match) {
    return null;
  }
  const parsed = Number.parseInt(match[1] ?? "", 10);
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 120) : null;
}

function normalizeWanDuration(value: number): number {
  if (value <= 5) {
    return 5;
  }
  if (value <= 10) {
    return 10;
  }
  return 15;
}

function inferAspectRatio(value: string, fallback: string): string {
  if (/横屏|16\s*[:：]\s*9|landscape/iu.test(value)) {
    return "16:9";
  }
  if (/竖屏|9\s*[:：]\s*16|portrait|短视频/iu.test(value)) {
    return "9:16";
  }
  if (/方图|1\s*[:：]\s*1|square/iu.test(value)) {
    return "1:1";
  }
  return fallback;
}

function aspectRatioToWanVideoSize(value: string): string {
  if (value === "16:9") {
    return "720p: 16:9 (1280x720)";
  }
  if (value === "9:16") {
    return "720p: 9:16 (720x1280)";
  }
  return "720p: 1:1 (960x960)";
}

function aspectRatioToWanImageDimensions(value: string): {
  readonly width: number;
  readonly height: number;
} {
  if (value === "16:9") {
    return { width: 1440, height: 800 };
  }
  if (value === "9:16") {
    return { width: 800, height: 1440 };
  }
  return { width: 1024, height: 1024 };
}

function aspectRatioToApiResolution(_value: string): string {
  return "720P";
}

function normalizeSceneVideoDuration(value: number): number {
  if (!Number.isFinite(value)) {
    return 5;
  }
  return Math.min(Math.max(Math.round(value), 2), 15);
}

function extractDirectorComfyUiScenePlans(
  draft: DirectorComfyUiVisibleWorkflowDraftInput,
  angelOutput: string,
  fallbackSceneCount = 1,
): readonly DirectorComfyUiScenePlan[] {
  const explicitSceneCount =
    readNumericToolParameter(draft, "scene_count") ??
    inferSceneCount(draft.objective) ??
    inferSceneCount(angelOutput);
  const blocks = splitDirectorComfyUiSceneBlocks(angelOutput);
  const sceneCount = Math.max(
    1,
    Math.min(12, explicitSceneCount ?? (blocks.length || fallbackSceneCount)),
  );
  const scenes: DirectorComfyUiScenePlan[] = [];

  for (let index = 0; index < sceneCount; index += 1) {
    const block = blocks[index];
    const sceneIndex = index + 1;
    if (block) {
      const summary = cleanSceneSummary(block.body || block.title || `场景 ${sceneIndex}`);
      scenes.push({
        index: sceneIndex,
        title: block.title || `场景 ${sceneIndex}`,
        summary,
        imagePrompt:
          extractSceneField(block.body, [
            "图片提示词",
            "图像提示词",
            "首帧提示词",
            "关键帧提示词",
            "image prompt",
          ]) ?? createFallbackSceneImagePrompt(draft, sceneIndex, summary),
        videoPrompt:
          extractSceneField(block.body, [
            "视频提示词",
            "图生视频提示词",
            "运镜提示词",
            "video prompt",
          ]) ?? createFallbackSceneVideoPrompt(draft, sceneIndex, summary),
      });
      continue;
    }
    const fallbackSummary = `围绕“${draft.objective}”生成第 ${sceneIndex} 个场景，只使用本场景的人物、动作和环境。`;
    scenes.push({
      index: sceneIndex,
      title: `场景 ${sceneIndex}`,
      summary: fallbackSummary,
      imagePrompt: createFallbackSceneImagePrompt(draft, sceneIndex, fallbackSummary),
      videoPrompt: createFallbackSceneVideoPrompt(draft, sceneIndex, fallbackSummary),
    });
  }

  return scenes;
}

function splitDirectorComfyUiSceneBlocks(
  value: string,
): readonly { readonly index: number; readonly title: string; readonly body: string }[] {
  const markerPattern =
    /(?:^|\n)\s*(?:#{1,6}\s*)?(?:场景|镜头|Scene)\s*([一二三四五六七八九十百\d]+)\s*[:：.\-、]?\s*([^\n]*)/giu;
  const matches = [...value.matchAll(markerPattern)];
  if (matches.length === 0) {
    return splitDirectorComfyUiNumberedSceneBlocks(value);
  }
  return matches.map((match, sequenceIndex) => {
    const matchIndex = match.index ?? 0;
    const nextIndex = matches[sequenceIndex + 1]?.index ?? value.length;
    const ordinal = parseSceneOrdinal(match[1] ?? "") ?? sequenceIndex + 1;
    const inlineTitle = String(match[2] ?? "").trim();
    const contentStart = matchIndex + match[0].length;
    const rest = value.slice(contentStart, nextIndex).trim();
    const body = [inlineTitle, rest]
      .filter((item) => item.length > 0)
      .join("\n")
      .trim();
    return {
      index: ordinal,
      title: `场景 ${ordinal}${inlineTitle.length > 0 ? `：${stripSceneFields(inlineTitle)}` : ""}`,
      body: body.length > 0 ? body : inlineTitle,
    };
  });
}

function splitDirectorComfyUiNumberedSceneBlocks(
  value: string,
): readonly { readonly index: number; readonly title: string; readonly body: string }[] {
  const anchor = value.search(/(?:分场脚本|分场|镜头细节|场景拆分|故事板|storyboard)\s*[:：]?/iu);
  if (anchor < 0) {
    return [];
  }
  const section = value.slice(anchor);
  const numberedPattern = /(?:^|\n)\s*(\d{1,2})\s*[.、)]\s*([^\n]+)/gu;
  const matches = [...section.matchAll(numberedPattern)];
  if (matches.length === 0) {
    return [];
  }
  return matches.map((match, sequenceIndex) => {
    const matchIndex = match.index ?? 0;
    const nextIndex = matches[sequenceIndex + 1]?.index ?? section.length;
    const ordinal = Number.parseInt(match[1] ?? "", 10);
    const inlineTitle = String(match[2] ?? "").trim();
    const contentStart = matchIndex + match[0].length;
    const rest = section.slice(contentStart, nextIndex).trim();
    const body = [inlineTitle, rest]
      .filter((item) => item.length > 0)
      .join("\n")
      .trim();
    return {
      index: Number.isFinite(ordinal) ? ordinal : sequenceIndex + 1,
      title: `场景 ${Number.isFinite(ordinal) ? ordinal : sequenceIndex + 1}${
        inlineTitle.length > 0 ? `：${stripSceneFields(inlineTitle)}` : ""
      }`,
      body: body.length > 0 ? body : inlineTitle,
    };
  });
}

function extractSceneField(value: string, labels: readonly string[]): string | null {
  const escapedLabels = labels.map((label) => escapeRegExp(label)).join("|");
  const pattern = new RegExp(`(?:${escapedLabels})\\s*[:：]\\s*([^\\n]+)`, "iu");
  const match = value.match(pattern);
  const extracted = match?.[1]?.trim();
  if (!extracted) {
    return null;
  }
  return stripSceneFields(extracted);
}

function cleanSceneSummary(value: string): string {
  const cleaned = stripSceneFields(value)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join("\n");
  return cleaned.length > 0 ? cleaned : "本场景由 Angel 拆分生成。";
}

function stripSceneFields(value: string): string {
  return value
    .replace(
      /(?:图片提示词|图像提示词|首帧提示词|关键帧提示词|image prompt|视频提示词|图生视频提示词|运镜提示词|video prompt|负向提示词|negative prompt)\s*[:：]\s*[^\n]+/giu,
      "",
    )
    .replace(/\s+/gu, " ")
    .trim();
}

function createFallbackSceneImagePrompt(
  draft: DirectorComfyUiVisibleWorkflowDraftInput,
  sceneIndex: number,
  sceneSummary: string,
): string {
  return truncateText(
    [
      `Scene ${sceneIndex} key frame for: ${draft.objective}.`,
      sceneSummary,
      "Clear subject, consistent character, cinematic composition, detailed environment.",
    ].join("\n"),
    1200,
  );
}

function createFallbackSceneVideoPrompt(
  draft: DirectorComfyUiVisibleWorkflowDraftInput,
  sceneIndex: number,
  sceneSummary: string,
): string {
  return truncateText(
    [
      `Scene ${sceneIndex} motion for: ${draft.objective}.`,
      sceneSummary,
      "Use only this scene as context. Keep motion clear, continuous, cinematic, no subtitles.",
    ].join("\n"),
    1200,
  );
}

function inferSceneCount(value: string): number | null {
  const numericPattern = /(\d{1,2})\s*(?:个)?\s*(?:场景|镜头|分镜|scene)/giu;
  for (const numericMatch of value.matchAll(numericPattern)) {
    if (isOrdinalSceneReference(value, numericMatch.index ?? 0)) {
      continue;
    }
    const parsed = Number.parseInt(numericMatch[1] ?? "", 10);
    return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 12) : null;
  }
  const chinesePattern = /([一二三四五六七八九十]{1,3})\s*(?:个)?\s*(?:场景|镜头|分镜)/gu;
  for (const chineseMatch of value.matchAll(chinesePattern)) {
    if (isOrdinalSceneReference(value, chineseMatch.index ?? 0)) {
      continue;
    }
    const parsed = parseSceneOrdinal(chineseMatch[1] ?? "");
    return parsed === null ? null : Math.min(Math.max(parsed, 1), 12);
  }
  return null;
}

function isOrdinalSceneReference(value: string, matchIndex: number): boolean {
  return /第\s*$/u.test(value.slice(Math.max(0, matchIndex - 4), matchIndex));
}

function parseSceneOrdinal(value: string): number | null {
  const normalized = value.trim();
  if (/^\d+$/u.test(normalized)) {
    const parsed = Number.parseInt(normalized, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  const digits: Record<string, number> = {
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  };
  if (normalized === "十") {
    return 10;
  }
  if (normalized.startsWith("十")) {
    return 10 + (digits[normalized.slice(1)] ?? 0);
  }
  if (normalized.includes("十")) {
    const [tens, ones] = normalized.split("十");
    return (digits[tens ?? ""] ?? 1) * 10 + (digits[ones ?? ""] ?? 0);
  }
  return digits[normalized] ?? null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function truncateText(value: string, maxChars: number): string {
  return value.length <= maxChars ? value : `${value.slice(0, Math.max(1, maxChars - 1))}…`;
}

function normalizeMultilineText(value: string | undefined, fallback: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized.length > 0 ? normalized : fallback;
}

function formatDirectorComfyUiToolParameters(
  draft: DirectorComfyUiVisibleWorkflowDraftInput,
): string {
  const parameters = draft.toolParameters ?? [];
  const header = `${formatDirectorComfyUiDraftWorkflowKind(draft.kind)}参数编排`;
  if (parameters.length === 0) {
    return [
      header,
      `目标：${draft.objective}`,
      "Angel 已生成内容草案；下一步可以把下方内容映射到具体 ComfyUI 节点参数。",
    ].join("\n");
  }
  return [
    header,
    ...parameters.map((parameter) => {
      const description = parameter.description ? ` ｜ ${parameter.description}` : "";
      return `${parameter.label} (${parameter.name}) = ${String(parameter.value)}${description}`;
    }),
  ].join("\n");
}

function formatDirectorComfyUiContextText(draft: DirectorComfyUiVisibleWorkflowDraftInput): string {
  const knowledgeHits = draft.knowledgeHits ?? [];
  const skillHits = draft.skillHits ?? [];
  const knowledgeText =
    knowledgeHits.length > 0
      ? knowledgeHits.map((hit) => `- ${hit.title ?? hit.id}`).join("\n")
      : "- 未命中已发布经验";
  const skillText =
    skillHits.length > 0
      ? skillHits.map((hit) => `- ${hit.title ?? hit.id}`).join("\n")
      : "- 未命中 Skill";
  return [
    `Angel 来源：${draft.angelSource ?? "director-angel"}`,
    "",
    "经验召回：",
    knowledgeText,
    "",
    "Skill 召回：",
    skillText,
  ].join("\n");
}

function formatDirectorComfyUiHandoffText(draft: DirectorComfyUiVisibleWorkflowDraftInput): string {
  const notes = draft.handoffNotes ?? [];
  const defaultNotes = [
    "这份 workflow 是 Angel 生成的可见交接稿。",
    "如果只是脚本/文案/参数编排，不需要 ComfyUI 自带 LLM 节点。",
    "如果要真实生成图片或视频，需要把参数映射到可执行的 ComfyUI API workflow 节点后再提交 /prompt。",
  ];
  return [
    "ComfyUI 交接边界",
    ...(notes.length > 0 ? notes : defaultNotes).map((note) => `- ${note}`),
  ].join("\n");
}

export async function publishDirectorComfyUiTemplateBridge(
  input: DirectorComfyUiTemplateBridgePublishInput,
): Promise<DirectorComfyUiTemplateBridgePublishResult> {
  const templateName = sanitizeComfyUiTemplateName(input.templateName);
  const openUrl = createDirectorComfyUiTemplateOpenUrl(input.baseUrl, templateName);
  const templateEndpoint = createDirectorComfyUiTemplateEndpoint(input.baseUrl, templateName);

  if (input.mode !== "local") {
    return {
      ok: false,
      directOpenReady: false,
      sourceModule: DIRECTOR_COMFYUI_TEMPLATE_BRIDGE_MODULE,
      templateName,
      openUrl,
      templateEndpoint,
      message: "ComfyUI 模板直达只支持本地模式；Cloud 模式继续使用 workflow 文件同步。",
    };
  }

  const localInstallPath = normalizeOptionalPath(input.localInstallPath);
  if (localInstallPath === undefined) {
    return {
      ok: false,
      directOpenReady: false,
      sourceModule: DIRECTOR_COMFYUI_TEMPLATE_BRIDGE_MODULE,
      templateName,
      openUrl,
      templateEndpoint,
      message: "未配置 ComfyUI 本地安装目录，无法写入 custom-node workflow template。",
    };
  }

  const customNodesPath = join(localInstallPath, "custom_nodes");
  if (!existsSync(customNodesPath)) {
    return {
      ok: false,
      directOpenReady: false,
      sourceModule: DIRECTOR_COMFYUI_TEMPLATE_BRIDGE_MODULE,
      templateName,
      openUrl,
      templateEndpoint,
      localInstallPath,
      message: `ComfyUI 安装目录缺少 custom_nodes：${customNodesPath}`,
    };
  }

  const customNodePath = join(customNodesPath, DIRECTOR_COMFYUI_TEMPLATE_BRIDGE_MODULE);
  const workflowsPath = join(customNodePath, "workflows");
  const workflowPath = join(workflowsPath, `${templateName}.json`);

  await mkdir(workflowsPath, { recursive: true });
  await writeFile(
    join(customNodePath, "__init__.py"),
    createDirectorComfyUiTemplateBridgePythonModule(),
    "utf8",
  );
  await writeFile(workflowPath, `${JSON.stringify(input.workflow, null, 2)}\n`, "utf8");
  await pruneAppleDoubleFiles(customNodePath);

  const route = await testDirectorComfyUiTemplateEndpoint({
    endpoint: templateEndpoint,
    ...(input.fetchImpl === undefined ? {} : { fetchImpl: input.fetchImpl }),
  });

  return {
    ok: true,
    directOpenReady: route.ok,
    sourceModule: DIRECTOR_COMFYUI_TEMPLATE_BRIDGE_MODULE,
    templateName,
    openUrl,
    templateEndpoint,
    localInstallPath,
    customNodePath,
    workflowPath,
    ...(route.status === undefined ? {} : { status: route.status }),
    message: route.ok
      ? `ComfyUI 模板桥接已可用：${DIRECTOR_COMFYUI_TEMPLATE_BRIDGE_MODULE}/${templateName}。`
      : `ComfyUI 模板已写入，但当前 ComfyUI 进程尚未加载桥接；重启 ComfyUI 后可直达画布。${route.message}`,
  };
}

export function createDirectorComfyUiTemplateOpenUrl(
  baseUrl: string,
  templateName: string,
): string {
  const normalized = normalizeBaseUrl(baseUrl);
  const query = new URLSearchParams({
    template: sanitizeComfyUiTemplateName(templateName),
    source: DIRECTOR_COMFYUI_TEMPLATE_BRIDGE_MODULE,
  });
  return `${normalized}/?${query.toString()}`;
}

function createDirectorComfyUiTemplateEndpoint(baseUrl: string, templateName: string): string {
  const normalized = normalizeBaseUrl(baseUrl);
  return `${normalized}/api/workflow_templates/${DIRECTOR_COMFYUI_TEMPLATE_BRIDGE_MODULE}/${encodeURIComponent(
    sanitizeComfyUiTemplateName(templateName),
  )}.json`;
}

function createDirectorComfyUiTemplateBridgePythonModule(): string {
  return [
    '"""Director Angel workflow template bridge for ComfyUI."""',
    "import os",
    "import re",
    "",
    "from aiohttp import web",
    "",
    "NODE_CLASS_MAPPINGS = {}",
    "NODE_DISPLAY_NAME_MAPPINGS = {}",
    "",
    '_SAFE_TEMPLATE_NAME = re.compile(r"^[A-Za-z0-9_.-]+$")',
    '_WORKFLOWS_DIR = os.path.join(os.path.dirname(__file__), "workflows")',
    "",
    "",
    "async def _serve_director_angel_template(request):",
    '    name = request.match_info.get("name", "")',
    "    if _SAFE_TEMPLATE_NAME.match(name) is None:",
    '        return web.Response(status=400, text="Invalid template name")',
    "",
    "    workflows_dir = os.path.abspath(_WORKFLOWS_DIR)",
    '    workflow_path = os.path.abspath(os.path.join(workflows_dir, f"{name}.json"))',
    "    if os.path.commonpath([workflows_dir, workflow_path]) != workflows_dir:",
    '        return web.Response(status=400, text="Invalid template path")',
    "    if not os.path.isfile(workflow_path):",
    "        return web.Response(status=404)",
    "",
    "    return web.FileResponse(workflow_path)",
    "",
    "",
    "try:",
    "    from server import PromptServer",
    "",
    "    PromptServer.instance.routes.get(",
    '        "/workflow_templates/director_angel_bridge/{name}.json"',
    "    )(_serve_director_angel_template)",
    "except Exception as exc:",
    '    print(f"[Director Angel] workflow template bridge route unavailable: {exc}")',
    "",
  ].join("\n");
}

async function pruneAppleDoubleFiles(root: string): Promise<void> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  await Promise.all(
    entries
      .filter((entry) => entry.name.startsWith("._"))
      .map((entry) =>
        rm(join(entry.parentPath, entry.name), { force: true, recursive: entry.isDirectory() }),
      ),
  );
}

async function testDirectorComfyUiTemplateEndpoint(input: {
  readonly endpoint: string;
  readonly fetchImpl?: DirectorComfyUiTemplateFetch;
}): Promise<{ readonly ok: boolean; readonly status?: number; readonly message: string }> {
  const fetcher = input.fetchImpl ?? globalThis.fetch;
  if (typeof fetcher !== "function") {
    return { ok: false, message: "当前运行环境没有 fetch，无法验证模板直达路由。" };
  }
  try {
    const response = await fetcher(input.endpoint, {
      method: "GET",
      headers: {},
    });
    await response.text();
    return {
      ok: response.ok,
      status: response.status,
      message: response.ok ? "模板路由已验证。" : `模板路由未就绪：HTTP ${response.status}。`,
    };
  } catch (error) {
    return {
      ok: false,
      message: `模板路由验证失败：${error instanceof Error ? error.message : String(error)}。`,
    };
  }
}

function normalizeBaseUrl(value: string): string {
  return String(value || "http://127.0.0.1:8188").replace(/\/+$/u, "");
}

function normalizeOptionalPath(value: string | undefined): string | undefined {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized.length > 0 ? normalized : undefined;
}

function sanitizeComfyUiTemplateName(value: string): string {
  const sanitized = value
    .trim()
    .replace(/[^a-zA-Z0-9_.-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return sanitized || "director-angel-workflow";
}

function normalizeDirectorComfyUiWorkflowModes(
  value: readonly DirectorComfyUiWorkflowMode[] | undefined,
  workflowKind: DirectorComfyUiDraftWorkflowKind,
): readonly DirectorComfyUiWorkflowMode[] {
  const modes = (value ?? []).filter(
    (item): item is DirectorComfyUiWorkflowMode =>
      item === "script" || item === "image" || item === "video",
  );
  if (modes.length > 0) {
    return [...new Set(modes)];
  }
  if (workflowKind === "image") {
    return ["image"];
  }
  if (workflowKind === "video") {
    return ["video"];
  }
  return ["script"];
}

export function createDirectorComfyUiWorkflowPromptTemplate(
  workflowKind: DirectorComfyUiDraftWorkflowKind,
  objective: string,
): string {
  if (workflowKind === "copywriting") {
    return [
      "你是短视频文案策划。",
      `目标：${objective}`,
      "请输出：标题、目标受众、口播正文、画面提示、修改建议。",
      "要求：结果可被人工审查，不要假装已经生成媒体文件。",
    ].join("\n");
  }
  if (workflowKind === "image") {
    return [
      "你是视觉提示词设计师。",
      `目标：${objective}`,
      "请输出：正向提示词、负向提示词、构图、光影、风格和可调参数建议。",
      "要求：这一步只生成提示词方案，不生成图片。",
    ].join("\n");
  }
  if (workflowKind === "video") {
    return [
      "你是视频生成工作流策划。",
      `目标：${objective}`,
      "请输出：镜头段落、运动方式、视觉提示词、时长和关键参数建议。",
      "要求：这一步只生成工作流方案，不生成视频。",
    ].join("\n");
  }
  return [
    "你是短剧脚本与分镜策划。",
    `目标：${objective}`,
    "请输出：片名、30秒故事梗概、分场脚本、关键对白、镜头提示、音效和需要确认的问题。",
    "要求：结构清楚，可进入人工审查；不要假装已经完成媒体生成。",
  ].join("\n");
}

export function formatDirectorComfyUiDraftWorkflowKind(
  workflowKind: DirectorComfyUiDraftWorkflowKind,
): string {
  const labels = {
    script: "脚本",
    copywriting: "文案",
    image: "图片",
    video: "视频",
  } as const;
  return labels[workflowKind];
}

export function formatDirectorComfyUiWorkflowModes(
  workflowModes: readonly DirectorComfyUiWorkflowMode[],
): string {
  const labels = {
    script: "脚本",
    image: "图片",
    video: "视频",
  } as const;
  return workflowModes.map((mode) => labels[mode]).join("+") || "脚本";
}
