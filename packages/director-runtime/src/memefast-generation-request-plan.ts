export type DirectorGenerationMediaType = "text" | "image" | "video" | "audio";

export type DirectorGenerationOperation =
  | "text"
  | "t2i"
  | "i2i"
  | "edit_image"
  | "t2v"
  | "i2v"
  | "r2v"
  | "first_last_frame"
  | "video_edit"
  | "music"
  | "lyrics"
  | "tts";

export interface DirectorGenerationRequestPlan {
  readonly family: string;
  readonly adapter: string;
  readonly mediaType: DirectorGenerationMediaType;
  readonly operation: DirectorGenerationOperation;
  readonly modelId: string;
  readonly endpointPath: string;
  readonly body: Record<string, unknown>;
  readonly warnings: readonly string[];
  readonly notes: readonly string[];
}

export interface DirectorMemefastGenerationRequestPlanInput {
  readonly mediaKind: "text" | "image" | "video" | "audio";
  readonly model: string;
  readonly prompt: string;
  readonly input: Readonly<Record<string, unknown>>;
  readonly routeFamily?: string;
  readonly endpointTypes?: readonly string[];
}

interface ImageWithRole {
  readonly role?: string;
  readonly url: string;
}

const GPT_IMAGE_2_MODELS = new Set(["gpt-image-2", "gpt-image-2-all"]);

const SORA_VARIANTS: Readonly<
  Record<
    string,
    {
      readonly durations: readonly number[];
      readonly resolutions: readonly string[];
      readonly preferUnifiedEndpoint: boolean;
    }
  >
> = {
  "sora-2": {
    durations: [4, 8, 12],
    resolutions: ["720p"],
    preferUnifiedEndpoint: false,
  },
  "sora-2-pro": {
    durations: [4, 8, 12],
    resolutions: ["720p", "1080p"],
    preferUnifiedEndpoint: false,
  },
  "sora-2-all": {
    durations: [10, 15],
    resolutions: ["720p"],
    preferUnifiedEndpoint: true,
  },
  "sora-2-pro-all": {
    durations: [15, 25],
    resolutions: ["720p", "1080p"],
    preferUnifiedEndpoint: true,
  },
  "sora-2-vip-all": {
    durations: [10],
    resolutions: ["720p"],
    preferUnifiedEndpoint: false,
  },
};

const SORA_UNIFIED_ENDPOINT_TYPES = new Set(["openai", "openai-response", "视频统一格式"]);

type VeoEndpointFamily = "unified" | "openai_videos" | "unknown";
type VeoUploadMode = "none" | "single" | "first_last" | "multi";

interface VeoUploadCapability {
  readonly isVeo: boolean;
  readonly endpointFamily: VeoEndpointFamily;
  readonly mode: VeoUploadMode;
  readonly minFiles: number;
  readonly maxFiles: number;
  readonly supportsTextToVideo: boolean;
}

const OPENAI_VEO_TEXT_ONLY_MODELS = new Set(["veo_3_1-4k"]);
const OPENAI_VEO_FIRST_LAST_MODELS = new Set(["veo_3_1", "veo_3_1-fast", "veo_3_1-fast-4k"]);
const OPENAI_VEO_SINGLE_IMAGE_MODELS = new Set(["veo_3_1-components", "veo_3_1-components-4k"]);
const OPENAI_VEO_MULTI_IMAGE_MODELS = new Set([
  "veo_3_1-fast-components",
  "veo_3_1-fast-components-4k",
]);
const UNIFIED_VEO_TEXT_ONLY_MODELS = new Set([
  "veo2",
  "veo2-fast",
  "veo2-pro",
  "veo3",
  "veo3-fast",
  "veo3-pro",
  "veo3.1-4k",
]);
const UNIFIED_VEO_FIRST_LAST_OPTIONAL_MODELS = new Set([
  "veo3.1",
  "veo3.1-fast",
  "veo3.1-pro",
  "veo3.1-pro-4k",
]);
const UNIFIED_VEO_FIRST_LAST_REQUIRED_MODELS = new Set(["veo2-fast-frames"]);
const UNIFIED_VEO_SINGLE_IMAGE_MODELS = new Set([
  "veo3-fast-frames",
  "veo3-frames",
  "veo3-pro-frames",
  "veo3.1-components-4k",
]);
const UNIFIED_VEO_MULTI_IMAGE_MODELS = new Set([
  "veo2-fast-components",
  "veo2-pro-components",
  "veo3.1-components",
  "veo3.1-fast-components",
]);

const GPT_IMAGE_2_SIZE_BY_ASPECT_RATIO: Readonly<
  Record<string, Readonly<Record<"1K" | "2K" | "4K", string>>>
> = {
  "1:1": { "1K": "1024x1024", "2K": "2048x2048", "4K": "2880x2880" },
  "16:9": { "1K": "1536x864", "2K": "2048x1152", "4K": "3840x2160" },
  "9:16": { "1K": "864x1536", "2K": "1152x2048", "4K": "2160x3840" },
  "4:3": { "1K": "1152x864", "2K": "2048x1536", "4K": "3264x2448" },
  "3:4": { "1K": "864x1152", "2K": "1536x2048", "4K": "2448x3264" },
  "5:4": { "1K": "1120x896", "2K": "2560x2048", "4K": "3200x2560" },
  "4:5": { "1K": "896x1120", "2K": "2048x2560", "4K": "2560x3200" },
  "3:2": { "1K": "1248x832", "2K": "1536x1024", "4K": "3456x2304" },
  "2:3": { "1K": "832x1248", "2K": "1024x1536", "4K": "2304x3456" },
};

const FAL_FLUX_TEXT_IMAGE_MODELS = new Set([
  "fal-ai/flux-1/dev",
  "fal-ai/flux-1/schnell",
  "fal-ai/flux-lora",
]);

const FAL_FLUX_IMAGE_TO_IMAGE_MODELS = new Set(["fal-ai/flux-1/dev/image-to-image"]);

const FAL_FLUX_REDUX_IMAGE_MODELS = new Set([
  "fal-ai/flux-1/dev/redux",
  "fal-ai/flux-1/schnell/redux",
]);

const REPLICATE_FLUX_KONTEXT_SINGLE_IMAGE_MODELS = new Set([
  "black-forest-labs/flux-kontext-dev",
  "black-forest-labs/flux-kontext-max",
  "black-forest-labs/flux-kontext-pro",
]);

const REPLICATE_FLUX_KONTEXT_MULTI_IMAGE_MODELS = new Set([
  "flux-kontext-apps/multi-image-kontext-max",
  "flux-kontext-apps/multi-image-kontext-pro",
]);

const KLING_VIDEO_PATH_MAP: Readonly<Record<string, string>> = {
  "kling-omni-video": "omni-video",
  "kling-o1-video": "omni-video",
  "kling-o1-text-to-video": "omni-video",
  "kling-video-o1": "omni-video",
  "kling-v3-omni": "omni-video",
  "kling-video-extend": "video-extend",
  "kling-motion-control": "motion-control",
  "kling-multi-elements": "multi-elements",
  "kling-avatar-image2video": "avatar/image2video",
  "kling-advanced-lip-sync": "advanced-lip-sync",
  "kling-effects": "effects",
};

const RUNWAY_RATIO_MAP: Readonly<Record<string, string>> = {
  "16:9": "1280:720",
  "9:16": "720:1280",
  "1:1": "720:720",
  "4:3": "960:720",
  "3:4": "720:960",
  "21:9": "2048:880",
};

const VIDU_ENDPOINT_PATHS: Readonly<Record<string, string>> = {
  text: "/ent/v2/text2video",
  image: "/ent/v2/img2video",
  reference: "/ent/v2/reference2video",
  start_end: "/ent/v2/start-end2video",
};

export function buildDirectorMemefastGenerationRequestPlan(
  request: DirectorMemefastGenerationRequestPlanInput,
): DirectorGenerationRequestPlan {
  if (request.mediaKind === "text") {
    return buildTextLlmPlan(request);
  }
  if (request.mediaKind === "audio") {
    return buildSunoPlan(request);
  }
  if (request.mediaKind === "image") {
    return buildImagePlan(request);
  }
  return buildVideoPlan(request);
}

export function summarizeDirectorGenerationRequestPlan(
  plan: DirectorGenerationRequestPlan,
): Record<string, unknown> {
  return {
    family: plan.family,
    adapter: plan.adapter,
    mediaType: plan.mediaType,
    operation: plan.operation,
    modelId: plan.modelId,
    endpointPath: plan.endpointPath,
    warnings: [...plan.warnings],
    notes: [...plan.notes],
  };
}

export function isDirectorMemefastAudioModel(model: string): boolean {
  return /^suno[_-]/iu.test(model) || /(?:suno|music|lyrics|song|audio)/iu.test(model);
}

function buildImagePlan(
  request: DirectorMemefastGenerationRequestPlanInput,
): DirectorGenerationRequestPlan {
  const model = request.model;
  const references = readReferenceImages(request.input);
  const size = readString(request.input.size) ?? readString(request.input.imageSize);
  const aspectRatio =
    readString(request.input.aspect_ratio) ?? readString(request.input.aspectRatio);
  const negativePrompt =
    readString(request.input.negative_prompt) ?? readString(request.input.negativePrompt);

  if (/^kling-(?:image|omni-image)/iu.test(model)) {
    const body: Record<string, unknown> = {
      prompt: request.prompt,
      model: model === "kling-omni-image" ? "kling-v3-omni" : model,
    };
    appendIfDefined(body, "aspect_ratio", aspectRatio);
    appendIfDefined(body, "negative_prompt", negativePrompt);
    return {
      family: "kling_image",
      adapter: "kling-image",
      mediaType: "image",
      operation: references.length > 0 ? "i2i" : "t2i",
      modelId: model,
      endpointPath:
        model === "kling-omni-image"
          ? "/kling/v1/images/omni-image"
          : "/kling/v1/images/generations",
      body,
      warnings: [],
      notes: ["Kling image uses the native MemeFast Kling image endpoint family."],
    };
  }

  if (isGptImage2Model(model)) {
    return buildGptImage2Plan(request, { references, aspectRatio, negativePrompt });
  }

  if (/seedream/iu.test(model)) {
    const body: Record<string, unknown> = {
      model,
      prompt: request.prompt,
      n: readNumber(request.input.n) ?? 1,
      size: size ?? resolveImageSize(aspectRatio),
      stream: false,
    };
    appendIfDefined(body, "negative_prompt", negativePrompt);
    if (references.length > 0) {
      body.image_urls = references;
    }
    return {
      family: "seedream",
      adapter: "seedream-image",
      mediaType: "image",
      operation: references.length > 0 ? "i2i" : "t2i",
      modelId: model,
      endpointPath: "/v1/images/generations",
      body,
      warnings: [],
      notes: ["Seedream image uses OpenAI-compatible images/generations with image_urls."],
    };
  }

  if (/gemini|nano[-_ ]?banana/iu.test(model) && /image|imagen|banana/iu.test(model)) {
    if (model.startsWith("fal-ai/")) {
      return {
        family: "gemini_image",
        adapter: "gemini-fal-image",
        mediaType: "image",
        operation: references.length > 0 ? "i2i" : "t2i",
        modelId: model,
        endpointPath: `/${model}`,
        body: {
          model,
          input: {
            prompt: request.prompt,
            ...(references.length > 0 ? { image_urls: references } : {}),
            ...(aspectRatio ? { aspect_ratio: aspectRatio } : {}),
            ...(readString(request.input.resolution)
              ? { resolution: readString(request.input.resolution) }
              : {}),
          },
        },
        warnings: [],
        notes: ["Fal Nano Banana/Gemini image uses the provider-specific async endpoint shape."],
      };
    }
    const userContent: Array<Record<string, unknown>> = [
      {
        type: "text",
        text: aspectRatio
          ? `Generate an image at ${aspectRatio}. ${request.prompt}`
          : request.prompt,
      },
    ];
    for (const image of references) {
      userContent.push({ type: "image_url", image_url: { url: image } });
    }
    return {
      family: "gemini_image",
      adapter: "gemini-image-chat",
      mediaType: "image",
      operation: references.length > 0 ? "i2i" : "t2i",
      modelId: model,
      endpointPath: "/v1/chat/completions",
      body: {
        model,
        messages: [{ role: "user", content: userContent }],
        stream: false,
        aspect_ratio: aspectRatio,
      },
      warnings: [],
      notes: ["Gemini image keeps chat-completions shape and inline references."],
    };
  }

  if (/^ideogram(?:_|-|\/)|ideogram-ai\/ideogram/iu.test(model)) {
    const body: Record<string, unknown> = {
      model,
      prompt: request.prompt,
    };
    appendIfDefined(body, "aspect_ratio", toIdeogramAspectRatio(aspectRatio));
    appendIfDefined(
      body,
      "rendering_speed",
      toUpperString(
        readString(request.input.rendering_speed) ?? readString(request.input.renderSpeed),
      ),
    );
    appendIfDefined(body, "style_type", toUpperString(readString(request.input.style)));
    appendIfDefined(body, "negative_prompt", negativePrompt);
    appendIfDefined(
      body,
      "num_images",
      readNumber(request.input.num_images) ?? readNumber(request.input.n),
    );
    return {
      family: "ideogram",
      adapter: "ideogram-image",
      mediaType: "image",
      operation: "t2i",
      modelId: model,
      endpointPath: "/ideogram/v1/ideogram-v3/generate",
      body,
      warnings:
        references.length > 0
          ? ["Ideogram generate route is text-to-image; reference images were not forwarded."]
          : [],
      notes: ["Ideogram image uses the MemeFast Ideogram V3 generate endpoint."],
    };
  }

  if (isFluxKontextImageModel(model)) {
    return buildFalFluxKontextImagePlan(request, { references, aspectRatio });
  }

  if (isFalFluxImageModel(model)) {
    return buildFalFluxImagePlan(request, { references, aspectRatio });
  }

  if (isReplicateFluxKontextImageModel(model)) {
    return buildReplicateFluxKontextImagePlan(request, { references, aspectRatio });
  }

  if (/flux|kontext/iu.test(model)) {
    const requiresReference = /kontext|redux|image-to-image|i2i/iu.test(model);
    if (requiresReference && references.length === 0) {
      throw new Error(`Model ${model} requires a reference image for the Flux image adapter.`);
    }
    const body: Record<string, unknown> = {
      prompt: request.prompt,
      num_images: readNumber(request.input.num_images) ?? 1,
      output_format: readString(request.input.output_format) ?? "jpeg",
    };
    appendIfDefined(body, "aspect_ratio", aspectRatio);
    if (requiresReference) {
      body.image_url = references[0];
    }
    return {
      family: requiresReference ? "flux_reference" : "flux",
      adapter: "flux-image",
      mediaType: "image",
      operation: requiresReference ? "i2i" : "t2i",
      modelId: model,
      endpointPath: model.startsWith("fal-ai/") ? `/${model}` : "/v1/images/generations",
      body,
      warnings: [],
      notes: ["Flux request plan preserves reference-image requirements before submit."],
    };
  }

  if (isDalleImageModel(model)) {
    return buildDalleImagePlan(request, { aspectRatio });
  }

  if (/^qwen-image-edit-2509$/iu.test(model)) {
    if (references.length === 0) {
      throw new Error(`Model ${model} requires one reference image for Qwen image editing.`);
    }
    const body: Record<string, unknown> = {
      model,
      prompt: request.prompt,
      image: references[0],
    };
    appendIfDefined(body, "size", size ?? resolveAliyunQwenEditSize(aspectRatio));
    appendIfDefined(body, "response_format", readString(request.input.response_format));
    return {
      family: "qwen_image",
      adapter: "qwen-image-edit-2509-image",
      mediaType: "image",
      operation: "edit_image",
      modelId: model,
      endpointPath: "/v1/images/generations",
      body,
      warnings: [],
      notes: ["Qwen image edit keeps the OpenAI-compatible edit payload."],
    };
  }

  if (/qwen.*image|aigc-image/iu.test(model)) {
    const body: Record<string, unknown> = {
      model_name: readString(request.input.model_name) ?? "Qwen",
      model_version: readString(request.input.model_version) ?? "0925",
      prompt: request.prompt,
      output_config: {
        storage_mode: "Temporary",
        resolution: size ?? resolveTencentImageResolution(aspectRatio),
        person_generation: "AllowAdult",
      },
    };
    if (references.length > 0) {
      body.file_infos = references.map((url) => ({ type: "Url", url }));
    }
    return {
      family: "qwen_image",
      adapter: "tencent-aigc-qwen-image",
      mediaType: "image",
      operation: references.length > 0 ? "i2i" : "t2i",
      modelId: model,
      endpointPath: "/tencent-vod/v1/aigc-image",
      body,
      warnings: [],
      notes: ["Qwen image uses Tencent AIGC image request shape when routed by MemeFast metadata."],
    };
  }

  if (/seededit|edit/iu.test(model) && references.length > 0) {
    return {
      family: "seededit",
      adapter: "seededit-image",
      mediaType: "image",
      operation: "edit_image",
      modelId: model,
      endpointPath: "/v1/images/generations",
      body: {
        model,
        prompt: request.prompt,
        image: references[0],
        response_format: "url",
        size: size ?? "adaptive",
      },
      warnings: [],
      notes: ["SeedEdit-style image editing requires one reference image."],
    };
  }

  if (/^recraft-ai\/recraft-v3(?:-svg)?$/iu.test(model)) {
    const input: Record<string, unknown> = {
      prompt: request.prompt,
      size: readString(request.input.size) ?? toReplicateImageSize(aspectRatio).recraftSize,
      style: readString(request.input.style) ?? "any",
      aspect_ratio: aspectRatio ?? "Not set",
    };
    appendIfDefined(input, "negative_prompt", negativePrompt);
    return {
      family: "recraft",
      adapter: "replicate-recraft-image",
      mediaType: "image",
      operation: "t2i",
      modelId: model,
      endpointPath: `/replicate/v1/models/${model}/predictions`,
      body: { input },
      warnings: [],
      notes: ["Recraft image uses the Replicate model prediction envelope."],
    };
  }

  if (/^stability-ai\/(?:sdxl|stable-diffusion(?:-(?:img2img|inpainting))?)$/iu.test(model)) {
    const dims = toReplicateImageSize(aspectRatio);
    const requiresReference = /img2img|inpainting/iu.test(model);
    if (requiresReference && references.length === 0) {
      throw new Error(`Model ${model} requires one reference image for the Replicate SDXL route.`);
    }
    const input: Record<string, unknown> = {
      prompt: request.prompt,
      width: readNumber(request.input.width) ?? dims.width,
      height: readNumber(request.input.height) ?? dims.height,
      num_outputs:
        readNumber(request.input.num_outputs) ??
        readNumber(request.input.numImages) ??
        readNumber(request.input.num_images) ??
        readNumber(request.input.n) ??
        1,
      scheduler: readString(request.input.scheduler) ?? "K_EULER",
      num_inference_steps: readNumber(request.input.num_inference_steps) ?? 30,
      guidance_scale: readNumber(request.input.guidance_scale) ?? 7.5,
    };
    appendIfDefined(input, "negative_prompt", negativePrompt);
    if (requiresReference) {
      input.image = references[0];
      appendIfDefined(
        input,
        "mask",
        readString(request.input.maskImage) ?? readString(request.input.mask),
      );
      appendIfDefined(input, "strength", readNumber(request.input.strength) ?? 0.8);
    }
    return {
      family: "sdxl",
      adapter: "replicate-sdxl-image",
      mediaType: "image",
      operation: requiresReference ? "i2i" : "t2i",
      modelId: model,
      endpointPath: "/replicate/v1/predictions",
      body: { model, input },
      warnings: [],
      notes: ["SDXL image uses the Replicate prediction envelope."],
    };
  }

  const body: Record<string, unknown> = {
    model,
    prompt: request.prompt,
    n: readNumber(request.input.n) ?? 1,
    size: size ?? resolveImageSize(aspectRatio),
  };
  appendIfDefined(body, "quality", readString(request.input.quality));
  appendIfDefined(body, "format", readString(request.input.format));
  appendIfDefined(body, "output_format", readString(request.input.outputFormat));
  if (references.length > 0) {
    body.image_urls = references;
  }
  return {
    family: /^gpt[-_]?image/iu.test(model) ? "gpt_image" : "image",
    adapter: /^gpt[-_]?image/iu.test(model) ? "gpt-image-image" : "openai-images",
    mediaType: "image",
    operation: references.length > 0 ? "i2i" : "t2i",
    modelId: model,
    endpointPath: "/v1/images/generations",
    body,
    warnings: [],
    notes: ["Fallback image adapter keeps OpenAI-compatible images/generations shape."],
  };
}

function buildGptImage2Plan(
  request: DirectorMemefastGenerationRequestPlanInput,
  media: {
    readonly references: readonly string[];
    readonly aspectRatio: string | undefined;
    readonly negativePrompt: string | undefined;
  },
): DirectorGenerationRequestPlan {
  const maskImage = readString(request.input.maskImage) ?? readString(request.input.mask);
  const isEdit = media.references.length > 0 || maskImage !== undefined;
  const resolution = readString(request.input.resolution);
  const outputFormat =
    readString(request.input.output_format) ??
    readString(request.input.outputFormat) ??
    readString(request.input.format);
  const body: Record<string, unknown> = {
    model: request.model,
    prompt: appendNegativePrompt(request.prompt, media.negativePrompt),
    n: clampInteger(readNumber(request.input.n), 1, 10, 1),
    size: isEdit
      ? mapAspectRatioToOpenAiImageSize(media.aspectRatio)
      : mapAspectRatioToGptImage2Size(media.aspectRatio, resolution),
  };
  appendIfDefined(
    body,
    "quality",
    readString(request.input.quality) ?? mapResolutionToGptImageQuality(resolution),
  );
  appendIfDefined(
    body,
    "background",
    normalizeGptImageBackground(readString(request.input.background)),
  );
  appendIfDefined(body, "moderation", readString(request.input.moderation));
  appendIfDefined(body, "output_format", normalizeImageOutputFormat(outputFormat));
  appendIfDefined(
    body,
    "output_compression",
    clampInteger(readNumber(request.input.output_compression), 0, 100, Number.NaN),
  );
  appendIfDefined(
    body,
    "partial_images",
    clampInteger(readNumber(request.input.partial_images), 0, 3, Number.NaN),
  );
  appendIfDefined(body, "stream", readBoolean(request.input.stream));
  appendIfDefined(body, "user", readString(request.input.user));

  if (isEdit) {
    if (media.references.length > 0) {
      body.images = media.references.slice(0, 16).map((imageUrl) => ({ image_url: imageUrl }));
    }
    appendIfDefined(body, "mask", maskImage);
  }

  return {
    family: "gpt_image",
    adapter: "gpt-image-2-image",
    mediaType: "image",
    operation: isEdit ? "i2i" : "t2i",
    modelId: request.model,
    endpointPath: isEdit ? "/v1/images/edits" : "/v1/images/generations",
    body: stripNaNValues(body),
    warnings: [],
    notes: ["GPT Image 2 and gpt-image-2-all share the dedicated image adapter."],
  };
}

function buildDalleImagePlan(
  request: DirectorMemefastGenerationRequestPlanInput,
  media: { readonly aspectRatio: string | undefined },
): DirectorGenerationRequestPlan {
  const body: Record<string, unknown> = {
    model: request.model,
    prompt: request.prompt,
    n: isQwenDalleImageModel(request.model)
      ? 1
      : clampInteger(readNumber(request.input.n), 1, 10, 1),
    size: resolveDalleCompatibleSize(readString(request.input.size), media.aspectRatio),
  };
  appendIfDefined(body, "quality", readString(request.input.quality));
  appendIfDefined(body, "style", readString(request.input.style));
  appendIfDefined(
    body,
    "response_format",
    readString(request.input.response_format) ?? readString(request.input.responseFormat),
  );
  appendIfDefined(body, "user", readString(request.input.user));
  if (isQwenDalleImageModel(request.model)) {
    appendIfDefined(body, "watermark", readBoolean(request.input.watermark));
    appendIfDefined(
      body,
      "prompt_extend",
      readBoolean(request.input.prompt_extend) ?? readBoolean(request.input.promptExtend),
    );
  }
  return {
    family: "dalle_image",
    adapter: "dalle-image",
    mediaType: "image",
    operation: "t2i",
    modelId: request.model,
    endpointPath: "/v1/images/generations",
    body,
    warnings: [],
    notes: ["DALL-E-compatible image request plan preserves images/generations shape."],
  };
}

function buildFalFluxKontextImagePlan(
  request: DirectorMemefastGenerationRequestPlanInput,
  media: { readonly references: readonly string[]; readonly aspectRatio: string | undefined },
): DirectorGenerationRequestPlan {
  const isTextToImage = /\/text-to-image$/iu.test(request.model);
  const isMultiImage = /\/multi$/iu.test(request.model);
  const body: Record<string, unknown> = {
    prompt: request.prompt,
    guidance_scale: clampFloat(readNumber(request.input.guidance_scale), 1, 20, 3.5),
    num_images: clampInteger(readNumber(request.input.num_images), 1, 4, 1),
    output_format:
      readString(request.input.output_format) ?? readString(request.input.outputFormat) ?? "jpeg",
    safety_tolerance: readString(request.input.safety_tolerance) ?? "2",
  };
  appendIfDefined(body, "aspect_ratio", media.aspectRatio);
  appendIfDefined(body, "seed", readNumber(request.input.seed));
  appendIfDefined(body, "sync_mode", readBoolean(request.input.sync_mode));

  if (isTextToImage) {
    return {
      family: "flux_reference",
      adapter: "flux-kontext-image",
      mediaType: "image",
      operation: "t2i",
      modelId: request.model,
      endpointPath: `/${request.model}`,
      body,
      warnings: [],
      notes: ["Fal Flux Kontext text-to-image uses the model-specific async route."],
    };
  }

  if (isMultiImage) {
    if (media.references.length === 0) {
      throw new Error(
        `Model ${request.model} requires reference images for Flux Kontext multi-image editing.`,
      );
    }
    body.image_urls = media.references.slice(0, 4);
  } else {
    const imageUrl = media.references[0];
    if (!imageUrl) {
      throw new Error(
        `Model ${request.model} requires one reference image for Flux Kontext image editing.`,
      );
    }
    body.image_url = imageUrl;
  }

  return {
    family: "flux_reference",
    adapter: "flux-kontext-image",
    mediaType: "image",
    operation: "i2i",
    modelId: request.model,
    endpointPath: `/${request.model}`,
    body,
    warnings: [],
    notes: ["Fal Flux Kontext image editing keeps image_url/image_urls in the native body."],
  };
}

function buildFalFluxImagePlan(
  request: DirectorMemefastGenerationRequestPlanInput,
  media: { readonly references: readonly string[]; readonly aspectRatio: string | undefined },
): DirectorGenerationRequestPlan {
  const normalizedModel = normalizeModelId(request.model);
  const requiresReference =
    FAL_FLUX_IMAGE_TO_IMAGE_MODELS.has(normalizedModel) ||
    FAL_FLUX_REDUX_IMAGE_MODELS.has(normalizedModel);
  if (requiresReference && media.references.length === 0) {
    throw new Error(`Model ${request.model} requires one reference image for the Fal Flux route.`);
  }
  const body: Record<string, unknown> = {
    num_images: clampInteger(readNumber(request.input.num_images), 1, 4, 1),
    enable_safety_checker: readBoolean(request.input.enable_safety_checker) ?? true,
    output_format:
      readString(request.input.output_format) ?? readString(request.input.outputFormat) ?? "jpeg",
    image_size: readString(request.input.image_size) ?? toFalImageSize(media.aspectRatio),
    num_inference_steps:
      readNumber(request.input.num_inference_steps) ??
      (normalizedModel.includes("/schnell") ? 4 : 28),
    acceleration: readString(request.input.acceleration) ?? "regular",
  };
  if (!normalizedModel.includes("/schnell")) {
    body.guidance_scale = readNumber(request.input.guidance_scale) ?? 3.5;
  }
  if (FAL_FLUX_REDUX_IMAGE_MODELS.has(normalizedModel)) {
    body.image_url = media.references[0];
  } else {
    body.prompt = request.prompt;
    if (requiresReference) {
      body.image_url = media.references[0];
      body.strength = readNumber(request.input.strength) ?? 0.85;
    }
  }
  return {
    family: requiresReference ? "flux_reference" : "flux",
    adapter: "fal-flux-image",
    mediaType: "image",
    operation: requiresReference ? "i2i" : "t2i",
    modelId: request.model,
    endpointPath: `/${request.model}`,
    body,
    warnings: FAL_FLUX_REDUX_IMAGE_MODELS.has(normalizedModel)
      ? [
          "Fal Flux Redux route is image-reference driven and does not accept storyboard prompt text.",
        ]
      : [],
    notes: ["Fal Flux image uses the model-specific async endpoint shape."],
  };
}

function buildReplicateFluxKontextImagePlan(
  request: DirectorMemefastGenerationRequestPlanInput,
  media: { readonly references: readonly string[]; readonly aspectRatio: string | undefined },
): DirectorGenerationRequestPlan {
  const isMultiImage = REPLICATE_FLUX_KONTEXT_MULTI_IMAGE_MODELS.has(
    normalizeModelId(request.model),
  );
  if (isMultiImage && media.references.length < 2) {
    throw new Error(
      `Model ${request.model} requires two reference images for the Replicate multi-image Kontext route.`,
    );
  }
  if (!isMultiImage && media.references.length === 0) {
    throw new Error(
      `Model ${request.model} requires one reference image for the Replicate Kontext route.`,
    );
  }
  const input: Record<string, unknown> = {
    prompt: request.prompt,
    aspect_ratio: isMultiImage ? (media.aspectRatio ?? "1:1") : "match_input_image",
    output_format: normalizeReplicateOutputFormat(
      readString(request.input.output_format) ?? readString(request.input.outputFormat),
      isMultiImage ? "png" : "jpg",
    ),
    safety_tolerance: clampInteger(readNumber(request.input.safety_tolerance), 0, 6, 2),
  };
  appendIfDefined(input, "prompt_upsampling", readBoolean(request.input.prompt_upsampling));
  if (isMultiImage) {
    input.input_image_1 = media.references[0];
    input.input_image_2 = media.references[1];
  } else {
    input.input_image = media.references[0];
    if (normalizeModelId(request.model).endsWith("/flux-kontext-dev")) {
      appendIfDefined(input, "go_fast", readBoolean(request.input.go_fast) ?? true);
      appendIfDefined(input, "guidance", readNumber(request.input.guidance) ?? 2.5);
      appendIfDefined(input, "output_quality", readNumber(request.input.output_quality) ?? 80);
      appendIfDefined(
        input,
        "num_inference_steps",
        readNumber(request.input.num_inference_steps) ?? 30,
      );
    }
  }
  return {
    family: "flux_reference",
    adapter: "replicate-flux-kontext-image",
    mediaType: "image",
    operation: "i2i",
    modelId: request.model,
    endpointPath: `/replicate/v1/models/${request.model}/predictions`,
    body: { input },
    warnings: [],
    notes: ["Replicate Flux Kontext uses the model prediction envelope with input object."],
  };
}

function buildTextLlmPlan(
  request: DirectorMemefastGenerationRequestPlanInput,
): DirectorGenerationRequestPlan {
  const adapter = resolveTextLlmAdapter(request);
  const messages = readMessageArray(request.input.messages, request.prompt);
  const temperature = readNumber(request.input.temperature);
  const maxTokens = readNumber(request.input.maxTokens) ?? readNumber(request.input.max_tokens);
  const responseFormat = isRecord(request.input.responseFormat)
    ? request.input.responseFormat
    : isRecord(request.input.response_format)
      ? request.input.response_format
      : undefined;

  if (adapter === "openai_responses") {
    const body: Record<string, unknown> = {
      model: request.model,
      input: messages
        .map((message) => extractMessageText(message))
        .filter(Boolean)
        .join("\n\n"),
    };
    appendIfDefined(body, "temperature", temperature);
    appendIfDefined(body, "max_output_tokens", maxTokens);
    appendIfDefined(body, "response_format", responseFormat);
    return {
      family: "text",
      adapter: "openai-responses-llm",
      mediaType: "text",
      operation: "text",
      modelId: request.model,
      endpointPath: "/v1/responses",
      body,
      warnings: [],
      notes: ["Text LLM uses the OpenAI Responses adapter."],
    };
  }

  if (adapter === "anthropic_messages") {
    const system = messages
      .filter((message) => message.role === "system")
      .map(extractMessageText)
      .filter(Boolean)
      .join("\n\n");
    const body: Record<string, unknown> = {
      model: request.model,
      messages: messages
        .filter((message) => message.role !== "system")
        .map((message) => ({
          role: message.role === "assistant" ? "assistant" : "user",
          content: toAnthropicContent(message.content),
        })),
      max_tokens: maxTokens ?? 4096,
    };
    appendIfDefined(body, "system", system || undefined);
    appendIfDefined(body, "temperature", temperature);
    return {
      family: "text",
      adapter: "anthropic-messages-llm",
      mediaType: "text",
      operation: "text",
      modelId: request.model,
      endpointPath: "/v1/messages",
      body,
      warnings: [],
      notes: ["Text LLM uses the Anthropic Messages adapter."],
    };
  }

  if (adapter === "gemini_generate_content") {
    const body: Record<string, unknown> = {
      contents: messages
        .filter((message) => message.role !== "system")
        .map((message) => ({
          role: message.role === "assistant" ? "model" : "user",
          parts: toGeminiParts(message.content),
        })),
    };
    const system = messages
      .filter((message) => message.role === "system")
      .map(extractMessageText)
      .filter(Boolean)
      .join("\n\n");
    if (system) {
      body.system_instruction = { parts: [{ text: system }] };
    }
    if (temperature !== undefined || maxTokens !== undefined) {
      body.generationConfig = {
        ...(temperature === undefined ? {} : { temperature }),
        ...(maxTokens === undefined ? {} : { maxOutputTokens: maxTokens }),
      };
    }
    return {
      family: "text",
      adapter: "gemini-generate-content-llm",
      mediaType: "text",
      operation: "text",
      modelId: request.model,
      endpointPath: `/v1beta/models/${request.model}:generateContent`,
      body,
      warnings: [],
      notes: ["Text LLM uses the Gemini generateContent adapter."],
    };
  }

  const body: Record<string, unknown> = {
    model: request.model,
    messages,
  };
  appendIfDefined(body, "temperature", temperature);
  appendIfDefined(body, "max_tokens", maxTokens);
  appendIfDefined(body, "response_format", responseFormat);
  appendIfDefined(body, "stream", readBoolean(request.input.stream));
  return {
    family: "text",
    adapter: "openai-chat-llm",
    mediaType: "text",
    operation: "text",
    modelId: request.model,
    endpointPath: "/v1/chat/completions",
    body,
    warnings: [],
    notes: ["Text LLM uses the OpenAI-compatible chat adapter."],
  };
}

function buildVideoPlan(
  request: DirectorMemefastGenerationRequestPlanInput,
): DirectorGenerationRequestPlan {
  const model = request.model;
  const firstFrame = readFirstFrame(request.input);
  const lastFrame = readLastFrame(request.input);
  const references = readReferenceImages(request.input);
  const videoRefs = readStringArray(request.input.videoRefs).concat(
    readStringArray(request.input.video_urls),
  );
  const audioRefs = readStringArray(request.input.audioRefs).concat(
    readStringArray(request.input.audio_urls),
  );

  if (/kling/iu.test(model) || request.routeFamily === "kling") {
    return buildKlingVideoPlan(request, { firstFrame, lastFrame, references, videoRefs });
  }
  if (/seedance|doubao-seedance|doubao/iu.test(model) || request.routeFamily === "volc") {
    return buildSeedanceVideoPlan(request, {
      firstFrame,
      lastFrame,
      references,
      videoRefs,
      audioRefs,
    });
  }
  if (
    /pixverse/iu.test(model) ||
    request.routeFamily === "pixverse" ||
    hasEndpoint(request, /pixverse/iu)
  ) {
    return buildPixVerseVideoPlan(request, { firstFrame, lastFrame, references });
  }
  if (/happyhorse/iu.test(model) || request.routeFamily === "happyhorse") {
    return buildHappyHorseVideoPlan(request, { firstFrame, references });
  }
  if (/sora/iu.test(model)) {
    return buildSoraVideoPlan(request, { firstFrame, references });
  }
  if (/veo/iu.test(model)) {
    return buildVeoVideoPlan(request, { firstFrame, lastFrame, references });
  }
  if (/wan/iu.test(model) || request.routeFamily === "wan") {
    return buildWanVideoPlan(request, { firstFrame, lastFrame, references });
  }
  if (/runway/iu.test(model)) {
    return buildRunwayVideoPlan(request, { firstFrame });
  }
  if (/luma/iu.test(model)) {
    return buildLumaVideoPlan(request, { firstFrame, lastFrame });
  }
  if (/vidu/iu.test(model) || hasEndpoint(request, /vidu/iu)) {
    return buildViduVideoPlan(request, { firstFrame, lastFrame, references });
  }
  if (/minimax|hailuo/iu.test(model) || hasEndpoint(request, /海螺|aigc-video|mini/iu)) {
    return buildMiniMaxVideoPlan(request, { firstFrame, lastFrame, references });
  }
  if (/grok/iu.test(model)) {
    return buildGrokVideoPlan(request, { firstFrame, references, videoRefs, audioRefs });
  }
  if (/omni[-_ ]?flash/iu.test(model)) {
    return buildOmniFlashVideoPlan(request, {
      firstFrame,
      lastFrame,
      references,
      videoRefs,
      audioRefs,
    });
  }
  if (request.routeFamily === "unified") {
    return buildUnifiedVideoPlan(request, { firstFrame, references });
  }

  return buildGenericVideoPlan(request, { firstFrame, references });
}

function buildSunoPlan(
  request: DirectorMemefastGenerationRequestPlanInput,
): DirectorGenerationRequestPlan {
  const operation: "music" | "lyrics" =
    readString(request.input.operation) === "lyrics" || /lyrics/iu.test(request.model)
      ? "lyrics"
      : "music";
  if (operation === "lyrics") {
    return {
      family: "suno",
      adapter: "suno-lyrics",
      mediaType: "audio",
      operation: "lyrics",
      modelId: request.model,
      endpointPath: "/suno/submit/lyrics",
      body: { prompt: request.prompt },
      warnings: [],
      notes: ["Suno lyrics uses MemeFast /suno/submit/lyrics."],
    };
  }

  const body: Record<string, unknown> = {};
  const lyrics = readString(request.input.lyrics);
  if (lyrics) {
    body.prompt = lyrics;
  } else {
    body.gpt_description_prompt = request.prompt;
  }
  appendIfDefined(body, "mv", readString(request.input.mv) ?? readString(request.input.version));
  appendIfDefined(body, "title", readString(request.input.title));
  appendIfDefined(body, "tags", readString(request.input.tags));
  appendIfDefined(
    body,
    "make_instrumental",
    readBoolean(request.input.make_instrumental) ?? readBoolean(request.input.makeInstrumental),
  );
  appendIfDefined(
    body,
    "task_id",
    readString(request.input.task_id) ?? readString(request.input.taskId),
  );
  appendIfDefined(
    body,
    "continue_at",
    readNumber(request.input.continue_at) ?? readNumber(request.input.continueAt),
  );
  appendIfDefined(
    body,
    "continue_clip_id",
    readString(request.input.continue_clip_id) ?? readString(request.input.continueClipId),
  );
  appendIfDefined(
    body,
    "notify_hook",
    readString(request.input.notify_hook) ?? readString(request.input.notifyHook),
  );
  return {
    family: "suno",
    adapter: "suno-music",
    mediaType: "audio",
    operation: "music",
    modelId: request.model,
    endpointPath: "/suno/submit/music",
    body,
    warnings: [],
    notes: ["Suno music uses MemeFast /suno/submit/music."],
  };
}

function buildKlingVideoPlan(
  request: DirectorMemefastGenerationRequestPlanInput,
  media: {
    readonly firstFrame: string | undefined;
    readonly lastFrame: string | undefined;
    readonly references: readonly string[];
    readonly videoRefs: readonly string[];
  },
): DirectorGenerationRequestPlan {
  const resolvedModelName = resolveKlingModelName(request.model);
  const isOmniVideo =
    KLING_VIDEO_PATH_MAP[request.model] === "omni-video" || resolvedModelName === "kling-v3-omni";
  const referenceLimit = isOmniVideo || resolvedModelName === "kling-video-o1" ? 7 : 1;
  const references = uniqueStrings([
    ...media.references,
    ...(media.firstFrame === undefined ? [] : [media.firstFrame]),
  ]).slice(0, referenceLimit);
  const hasMultipleReferences = references.length > 1;
  const endpointPath =
    KLING_VIDEO_PATH_MAP[request.model] ??
    (hasMultipleReferences ? "multi-image2video" : media.firstFrame ? "image2video" : "text2video");
  const normalizedDuration = normalizeKlingDuration({
    model: request.model,
    resolvedModelName,
    requestedDuration: readNumber(request.input.duration) ?? readNumber(request.input.seconds),
    hasLastFrame: media.lastFrame !== undefined,
  });
  const body: Record<string, unknown> = {
    model_name: resolvedModelName,
    prompt: request.prompt,
    aspect_ratio: readAspectRatio(request.input),
    duration: String(normalizedDuration),
  };
  appendIfDefined(
    body,
    "mode",
    resolveKlingMode(request.input, resolvedModelName, media.lastFrame !== undefined),
  );
  if (isOmniVideo || resolvedModelName === "kling-v3" || resolvedModelName === "kling-v3-omni") {
    body.sound = readBoolean(request.input.audio) === false ? "off" : "on";
  }
  if (endpointPath === "omni-video") {
    const imageList = buildKlingOmniImageList(media.firstFrame, media.lastFrame, references);
    if (imageList.length > 0) {
      body.image_list = imageList;
    }
    if (media.videoRefs.length > 0 && media.videoRefs[0] !== undefined) {
      body.video_list = [
        {
          video_url: media.videoRefs[0],
          refer_type: "feature",
          keep_original_sound: "no",
        },
      ];
    }
    body.sound = readBoolean(request.input.audio) === false ? "off" : "on";
  } else if (endpointPath === "multi-image2video") {
    body.image_list = references.map((image) => ({ image }));
  } else if (endpointPath === "image2video" && media.firstFrame) {
    body.image = media.firstFrame;
    appendIfDefined(body, "image_tail", media.lastFrame);
  }
  return {
    family: "kling",
    adapter: "kling-video",
    mediaType: "video",
    operation: media.lastFrame
      ? "first_last_frame"
      : references.length > 1
        ? "r2v"
        : media.firstFrame
          ? "i2v"
          : "t2v",
    modelId: request.model,
    endpointPath: `/kling/v1/videos/${endpointPath}`,
    body,
    warnings:
      media.references.length > referenceLimit
        ? [
            `Kling adapter only forwards ${referenceLimit} reference image(s); extra images were dropped.`,
          ]
        : [],
    notes: [`Kling endpoint path: ${endpointPath}.`],
  };
}

function buildSeedanceVideoPlan(
  request: DirectorMemefastGenerationRequestPlanInput,
  media: {
    readonly firstFrame: string | undefined;
    readonly lastFrame: string | undefined;
    readonly references: readonly string[];
    readonly videoRefs: readonly string[];
    readonly audioRefs: readonly string[];
  },
): DirectorGenerationRequestPlan {
  const seedanceAdapter =
    readString(request.input.seedanceAdapter) === "ark-official" ||
    readBoolean(request.input.useOfficialArk) === true
      ? "ark-official"
      : "volc-proxy";
  const parameterStyle =
    readString(request.input.seedanceParameterStyle) === "short" ? "short" : "long";
  const includeRatio = readBoolean(request.input.includeRatio) ?? true;
  const includeReqId = readBoolean(request.input.includeReqId) ?? true;
  const hasImageReferences =
    media.firstFrame !== undefined || media.lastFrame !== undefined || media.references.length > 0;
  const requestedResolution = normalizeResolution(readString(request.input.resolution) ?? "720p");
  const liteI2vNeeds720p =
    hasImageReferences &&
    /doubao-seedance-1[._-]?0[._-]?lite[._-]?i2v[._-]?250428/iu.test(request.model) &&
    requestedResolution === "1080p";
  const baseResolution = liteI2vNeeds720p ? "720p" : requestedResolution;
  const resolution =
    normalizeSeedance20Resolution(request.model, baseResolution, "720p") ?? baseResolution;
  const duration = normalizeSeedance20Duration(
    request.model,
    readNumber(request.input.duration) ?? readNumber(request.input.seconds),
    5,
    readNumber(request.input.durationFloorOverride) ?? 1,
  );
  const ratio = includeRatio ? readAspectRatio(request.input) : undefined;
  const cameraFixed = readBoolean(request.input.cameraFixed);
  const content: Array<Record<string, unknown>> = [
    {
      type: "text",
      text: buildSeedanceTextContent({
        prompt: request.prompt,
        resolution,
        ...(ratio === undefined ? {} : { ratio }),
        ...(duration === undefined ? {} : { duration }),
        ...(cameraFixed === undefined ? {} : { cameraFixed }),
        adapter: seedanceAdapter,
        parameterStyle,
      }),
    },
  ];
  for (const item of [
    media.firstFrame ? { role: "first_frame", url: media.firstFrame } : undefined,
    media.lastFrame ? { role: "last_frame", url: media.lastFrame } : undefined,
    ...media.references.map((url) => ({ role: "reference_image", url })),
  ]) {
    if (item) {
      content.push({ type: "image_url", image_url: { url: item.url }, role: item.role });
    }
  }
  for (const videoUrl of media.videoRefs) {
    content.push({ type: "video_url", video_url: { url: videoUrl }, role: "reference_video" });
  }
  for (const audioUrl of media.audioRefs) {
    content.push({ type: "audio_url", audio_url: { url: audioUrl }, role: "reference_audio" });
  }
  const body: Record<string, unknown> = {
    model: request.model,
    content,
    resolution,
    watermark: false,
  };
  if (ratio) {
    body.ratio = ratio;
  }
  if (typeof duration === "number") {
    body.duration = duration;
  }
  if (
    typeof cameraFixed === "boolean" &&
    !isSeedance20ModelId(request.model) &&
    !hasImageReferences
  ) {
    body.camera_fixed = cameraFixed;
  }
  const audio = readBoolean(request.input.audio);
  if (typeof audio === "boolean" && seedanceSupportsAudioGeneration(request.model)) {
    body.generate_audio = audio;
  }
  appendIfDefined(body, "service_tier", readString(request.input.serviceTier));
  const draftMode = readBoolean(request.input.draftMode);
  if (typeof draftMode === "boolean") {
    body.draft = draftMode;
  }
  const enabledTools = readStringArray(request.input.enabledTools);
  if (enabledTools.length > 0) {
    body.tools = enabledTools.map((type) => ({ type }));
  }
  const frames = readNumber(request.input.frames);
  if (!isSeedance20ModelId(request.model) && frames !== undefined) {
    body.frames = frames;
  }
  if (seedanceAdapter === "volc-proxy") {
    if (includeReqId) {
      body.req_id =
        readString(request.input.reqId) ??
        `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    }
    body.messages = [{ role: "user", content }];
  }
  const warnings: string[] = [];
  if (requestedResolution !== resolution) {
    warnings.push(`Seedance resolution ${requestedResolution} was normalized to ${resolution}.`);
  }
  return {
    family: "seedance",
    adapter: "seedance-video",
    mediaType: "video",
    operation: media.lastFrame ? "first_last_frame" : media.firstFrame ? "i2v" : "t2v",
    modelId: request.model,
    endpointPath:
      seedanceAdapter === "ark-official"
        ? "/api/v3/contents/generations/tasks"
        : "/volc/v1/contents/generations/tasks",
    body,
    warnings,
    notes: [`Seedance adapter: ${seedanceAdapter}.`],
  };
}

function buildHappyHorseVideoPlan(
  request: DirectorMemefastGenerationRequestPlanInput,
  media: { readonly firstFrame: string | undefined; readonly references: readonly string[] },
): DirectorGenerationRequestPlan {
  const model = request.model;
  const input: Record<string, unknown> = { prompt: request.prompt };
  const parameters: Record<string, unknown> = {};
  appendIfDefined(parameters, "ratio", readAspectRatio(request.input));
  appendIfDefined(
    parameters,
    "duration",
    readNumber(request.input.duration) ?? readNumber(request.input.seconds),
  );
  appendIfDefined(parameters, "resolution", readString(request.input.resolution));
  if (/r2v/iu.test(model)) {
    input.reference_image = media.references.slice(0, 9);
  } else if (/i2v/iu.test(model) && media.firstFrame) {
    input.first_frame = media.firstFrame;
  }
  return {
    family: "happyhorse",
    adapter: "happyhorse-video",
    mediaType: "video",
    operation: /r2v/iu.test(model) ? "r2v" : media.firstFrame ? "i2v" : "t2v",
    modelId: model,
    endpointPath: "/alibailian/api/v1/services/aigc/video-generation/video-synthesis",
    body: { model, input, parameters },
    warnings: [],
    notes: ["HappyHorse plan maps T2V/I2V/R2V into the Bailian video synthesis envelope."],
  };
}

function buildPixVerseVideoPlan(
  request: DirectorMemefastGenerationRequestPlanInput,
  media: {
    readonly firstFrame: string | undefined;
    readonly lastFrame: string | undefined;
    readonly references: readonly string[];
  },
): DirectorGenerationRequestPlan {
  const modelName = resolvePixVerseModelName(request.model, readString(request.input.modelVersion));
  const quality = normalizePixVerseQuality(readString(request.input.resolution));
  const operation = readPixVerseOperation(request, media);
  const body: Record<string, unknown> = {
    prompt: request.prompt,
    model: modelName,
    duration: normalizePixVerseDuration(
      modelName,
      readNumber(request.input.duration) ?? readNumber(request.input.seconds),
      quality,
    ),
    quality,
  };
  const warnings: string[] = [];
  const notes: string[] = [];
  appendIfDefined(body, "seed", readNumber(request.input.seed));
  const audio = readBoolean(request.input.audio);
  if (typeof audio === "boolean" && supportsPixVerseGenerateAudio(modelName)) {
    body.generate_audio_switch = audio;
  } else if (audio === true) {
    warnings.push(
      `PixVerse ${modelName} does not support generate_audio_switch; audio was not sent.`,
    );
  }

  const pixverseImageIds = isRecord(request.input.pixverseImageIds)
    ? request.input.pixverseImageIds
    : {};
  const firstImageId =
    readImageId(request.input.firstFrameImgId) ??
    readImageId(request.input.img_id) ??
    readImageId(pixverseImageIds.firstFrame) ??
    (media.firstFrame ? pixVerseUploadPlaceholder("first_frame") : undefined);
  const lastImageId =
    readImageId(request.input.lastFrameImgId) ??
    readImageId(pixverseImageIds.lastFrame) ??
    (media.lastFrame ? pixVerseUploadPlaceholder("last_frame") : undefined);
  const referenceImageIds = uniquePixVerseImageIds([
    ...readImageIdArray(request.input.pixverseReferenceImageIds),
    ...readImageIdArray(pixverseImageIds.references),
    ...media.references.map((_, index) => pixVerseUploadPlaceholder(`reference_${index + 1}`)),
  ]);

  if (operation === "first_last_frame") {
    if (!firstImageId || !lastImageId) {
      throw new Error(
        `Model ${request.model} requires uploaded PixVerse first/last image ids for transition generation.`,
      );
    }
    body.first_frame_img = firstImageId;
    body.last_frame_img = lastImageId;
    body.motion_mode = "normal";
    return {
      family: "pixverse",
      adapter: "pixverse-video",
      mediaType: "video",
      operation: "first_last_frame",
      modelId: request.model,
      endpointPath: "/openapi/v2/video/transition/generate",
      body,
      warnings,
      notes: [...notes, "PixVerse transition requires pre-uploaded image ids."],
    };
  }

  if (operation === "r2v") {
    const refIds =
      referenceImageIds.length > 0 ? referenceImageIds : firstImageId ? [firstImageId] : [];
    if (refIds.length === 0) {
      throw new Error(
        `Model ${request.model} requires uploaded PixVerse reference image ids for fusion generation.`,
      );
    }
    const cappedRefs = refIds.slice(0, modelName === "v4.5" || modelName === "v5" ? 3 : 7);
    const refNames = cappedRefs.map((_, index) => `ref_${index + 1}`);
    body.image_references = cappedRefs.map((imgId, index) => ({
      type: "subject",
      img_id: imgId,
      ref_name: refNames[index],
    }));
    body.prompt = appendPixVerseReferenceAnchors(request.prompt, refNames);
    appendIfDefined(body, "aspect_ratio", readAspectRatio(request.input));
    return {
      family: "pixverse",
      adapter: "pixverse-video",
      mediaType: "video",
      operation: "r2v",
      modelId: request.model,
      endpointPath: "/openapi/v2/video/fusion/generate",
      body,
      warnings,
      notes: [...notes, "PixVerse fusion requires pre-uploaded reference image ids."],
    };
  }

  if (operation === "i2v") {
    if (!firstImageId) {
      throw new Error(
        `Model ${request.model} requires an uploaded PixVerse image id for image-to-video generation.`,
      );
    }
    body.img_id = firstImageId;
    body.motion_mode = "normal";
    return {
      family: "pixverse",
      adapter: "pixverse-video",
      mediaType: "video",
      operation: "i2v",
      modelId: request.model,
      endpointPath: "/openapi/v2/video/img/generate",
      body,
      warnings,
      notes: [...notes, "PixVerse image-to-video requires one pre-uploaded image id."],
    };
  }

  appendIfDefined(body, "aspect_ratio", readAspectRatio(request.input));
  return {
    family: "pixverse",
    adapter: "pixverse-video",
    mediaType: "video",
    operation: "t2v",
    modelId: request.model,
    endpointPath: "/openapi/v2/video/text/generate",
    body,
    warnings,
    notes: [...notes, "PixVerse text-to-video uses the OpenAPI v2 text generate route."],
  };
}

function buildSoraVideoPlan(
  request: DirectorMemefastGenerationRequestPlanInput,
  media: { readonly firstFrame: string | undefined; readonly references: readonly string[] },
): DirectorGenerationRequestPlan {
  const resolution = readString(request.input.resolution);
  const duration =
    readNumber(request.input.duration) ??
    readNumber(request.input.seconds) ??
    getDefaultSoraDuration(request.model) ??
    10;
  validateSoraVideoOptions(request.model, duration, resolution);
  const useUnified =
    request.model === "sora-2-all" ||
    request.model === "sora-2-pro-all" ||
    request.routeFamily === "unified" ||
    prefersSoraUnifiedRoute(request.model, request.endpointTypes);
  if (useUnified) {
    const image = pickFirstString([media.references[0], media.firstFrame]);
    return {
      family: "sora",
      adapter: "sora-video",
      mediaType: "video",
      operation: image ? "i2v" : "t2v",
      modelId: request.model,
      endpointPath: "/v1/video/create",
      body: {
        model: request.model,
        prompt: request.prompt,
        orientation: toSoraUnifiedOrientation(readAspectRatio(request.input)),
        duration,
        size: toSoraUnifiedSize(request.model, resolution),
        images: image ? [image] : [],
      },
      warnings: [],
      notes: ["Sora all variants use MemeFast unified video create payload."],
    };
  }
  return {
    family: "sora",
    adapter: "sora-video",
    mediaType: "video",
    operation: media.firstFrame ? "i2v" : "t2v",
    modelId: request.model,
    endpointPath: "/v1/videos",
    body: {
      model: request.model,
      prompt: request.prompt,
      size:
        readString(request.input.size) ??
        toSoraOfficialSize(request.model, readAspectRatio(request.input), resolution),
      seconds: String(duration),
      ...(media.firstFrame ? { input_reference: media.firstFrame } : {}),
    },
    warnings: [],
    notes: ["Sora official route records the multipart-equivalent fields."],
  };
}

function buildVeoVideoPlan(
  request: DirectorMemefastGenerationRequestPlanInput,
  media: {
    readonly firstFrame: string | undefined;
    readonly lastFrame: string | undefined;
    readonly references: readonly string[];
  },
): DirectorGenerationRequestPlan {
  const capability = resolveVeoUploadCapability(request.model, request.endpointTypes);
  const images = selectVeoReferenceImages(capability, media);
  if (images.length < capability.minFiles) {
    throw new Error(
      `Model ${request.model} requires at least ${capability.minFiles} reference image(s).`,
    );
  }
  const endpointPath =
    request.routeFamily === "openai_official" ||
    capability.endpointFamily === "openai_videos" ||
    isOpenAiVeoModel(request.model)
      ? "/v1/videos"
      : "/v1/video/create";
  return {
    family: "veo",
    adapter: "veo-video",
    mediaType: "video",
    operation: images.length > 1 ? "first_last_frame" : images.length === 1 ? "i2v" : "t2v",
    modelId: request.model,
    endpointPath,
    body:
      endpointPath === "/v1/videos"
        ? {
            model: request.model,
            prompt: request.prompt,
            size: toVeoOpenAiVideoSize(readAspectRatio(request.input)),
            seconds: String(readNumber(request.input.duration) ?? 8),
            watermark: false,
            ...(images.length > 0 ? { input_references: images } : {}),
          }
        : {
            model: request.model,
            prompt: request.prompt,
            aspect_ratio: readAspectRatio(request.input),
            enhance_prompt: true,
            enable_upsample: true,
            ...(images.length > 0 ? { images } : {}),
          },
    warnings: [],
    notes: ["Veo plan keeps OpenAI official and unified video route bodies separate."],
  };
}

function buildWanVideoPlan(
  request: DirectorMemefastGenerationRequestPlanInput,
  media: {
    readonly firstFrame: string | undefined;
    readonly lastFrame: string | undefined;
    readonly references: readonly string[];
  },
): DirectorGenerationRequestPlan {
  const firstFrame = media.firstFrame ?? media.references[0];
  if (!firstFrame) {
    throw new Error(`Model ${request.model} requires one first-frame image for Wan i2v.`);
  }
  if (media.lastFrame || media.references.length > 1) {
    throw new Error(
      `Model ${request.model} only supports one first-frame image in the Wan adapter.`,
    );
  }
  const parameters: Record<string, unknown> = {
    resolution: normalizeUpperResolution(readString(request.input.resolution) ?? "480p"),
    prompt_extend: true,
  };
  appendIfDefined(
    parameters,
    "duration",
    readNumber(request.input.duration) ?? readNumber(request.input.seconds),
  );
  if (/wan2\.6-i2v-flash/iu.test(request.model)) {
    parameters.audio = readBoolean(request.input.audio) ?? true;
  }
  return {
    family: "wan",
    adapter: "wan-video",
    mediaType: "video",
    operation: "i2v",
    modelId: request.model,
    endpointPath: "/alibailian/api/v1/services/aigc/video-generation/video-synthesis",
    body: {
      model: request.model,
      input: { prompt: request.prompt, img_url: firstFrame },
      parameters,
    },
    warnings: [],
    notes: ["Wan request plan enforces the current single first-frame i2v contract."],
  };
}

function buildRunwayVideoPlan(
  request: DirectorMemefastGenerationRequestPlanInput,
  media: { readonly firstFrame: string | undefined },
): DirectorGenerationRequestPlan {
  if (!media.firstFrame) {
    throw new Error(
      `Model ${request.model} requires a first-frame image for Runway image-to-video.`,
    );
  }
  return {
    family: "runway",
    adapter: "runway-video",
    mediaType: "video",
    operation: "i2v",
    modelId: request.model,
    endpointPath: "/runwayml/v1/image_to_video",
    body: {
      promptImage: media.firstFrame,
      model: resolveRunwaySubmitModel(request.model),
      ratio: RUNWAY_RATIO_MAP[readAspectRatio(request.input)] ?? readAspectRatio(request.input),
      promptText: request.prompt,
      duration: resolveRunwayDuration(
        request.model,
        readNumber(request.input.duration) ?? readNumber(request.input.seconds),
      ),
    },
    warnings: [],
    notes: ["Runway request plan is intentionally image-to-video only."],
  };
}

function buildLumaVideoPlan(
  request: DirectorMemefastGenerationRequestPlanInput,
  media: { readonly firstFrame: string | undefined; readonly lastFrame: string | undefined },
): DirectorGenerationRequestPlan {
  return {
    family: "luma",
    adapter: "luma-video",
    mediaType: "video",
    operation: media.lastFrame ? "first_last_frame" : media.firstFrame ? "i2v" : "t2v",
    modelId: request.model,
    endpointPath: "/luma/generations",
    body: {
      user_prompt: request.prompt,
      expand_prompt: true,
      loop: false,
      resolution: readString(request.input.resolution) ?? "720p",
      duration: `${readNumber(request.input.duration) ?? readNumber(request.input.seconds) ?? 5}s`,
      model_name: request.model,
      ...(media.firstFrame ? { image_url: media.firstFrame } : {}),
      ...(media.lastFrame ? { image_end_url: media.lastFrame } : {}),
    },
    warnings: [],
    notes: ["Luma plan covers text, first-frame, and first-last keyframe generation."],
  };
}

function buildViduVideoPlan(
  request: DirectorMemefastGenerationRequestPlanInput,
  media: {
    readonly firstFrame: string | undefined;
    readonly lastFrame: string | undefined;
    readonly references: readonly string[];
  },
): DirectorGenerationRequestPlan {
  const endpointKind = resolveViduEndpointKind(request, media);
  const body: Record<string, unknown> = {
    model: request.model,
    prompt: request.prompt,
  };
  appendIfDefined(
    body,
    "duration",
    readNumber(request.input.duration) ?? readNumber(request.input.seconds),
  );
  appendIfDefined(body, "resolution", readString(request.input.resolution));
  appendIfDefined(body, "aspect_ratio", readAspectRatio(request.input));
  const audio = readBoolean(request.input.audio);
  if (typeof audio === "boolean") {
    body.audio = audio;
  }
  if (endpointKind === "image") {
    if (!media.firstFrame) {
      throw new Error(
        `Model ${request.model} requires a first-frame image for Vidu image-to-video.`,
      );
    }
    body.images = [media.firstFrame];
  } else if (endpointKind === "reference") {
    const refs = uniqueStrings(
      media.references.length > 0 ? media.references : [media.firstFrame, media.lastFrame],
    ).slice(0, 7);
    if (refs.length === 0) {
      throw new Error(
        `Model ${request.model} requires reference image(s) for Vidu reference-to-video.`,
      );
    }
    body.subjects = refs.map((url, index) => ({ name: `subject_${index + 1}`, images: [url] }));
  } else if (endpointKind === "start_end") {
    const images = [media.firstFrame, media.lastFrame].filter(isNonEmptyString);
    if (images.length < 2) {
      throw new Error(
        `Model ${request.model} requires first and last frame images for Vidu start-end video.`,
      );
    }
    body.images = images;
  }
  return {
    family: "vidu",
    adapter: "vidu-video",
    mediaType: "video",
    operation:
      endpointKind === "start_end"
        ? "first_last_frame"
        : endpointKind === "reference"
          ? "r2v"
          : endpointKind === "image"
            ? "i2v"
            : "t2v",
    modelId: request.model,
    endpointPath: VIDU_ENDPOINT_PATHS[endpointKind] ?? "/ent/v2/text2video",
    body,
    warnings: [],
    notes: [`Vidu endpoint kind: ${endpointKind}.`],
  };
}

function buildMiniMaxVideoPlan(
  request: DirectorMemefastGenerationRequestPlanInput,
  media: {
    readonly firstFrame: string | undefined;
    readonly lastFrame: string | undefined;
    readonly references: readonly string[];
  },
): DirectorGenerationRequestPlan {
  const images = uniqueStrings([
    ...(media.firstFrame ? [media.firstFrame] : []),
    ...(media.lastFrame ? [media.lastFrame] : []),
    ...media.references,
  ]);
  const body: Record<string, unknown> = {
    model: request.model,
    prompt: request.prompt,
    duration: readNumber(request.input.duration) ?? readNumber(request.input.seconds),
    resolution: readString(request.input.resolution),
  };
  if (images.length > 0) {
    body.images = images;
  }
  return {
    family: "minimax",
    adapter: "minimax-video",
    mediaType: "video",
    operation: media.lastFrame ? "first_last_frame" : media.firstFrame ? "i2v" : "t2v",
    modelId: request.model,
    endpointPath: hasEndpoint(request, /aigc-video/iu)
      ? "/tencent-vod/v1/aigc-video"
      : "/minimax/v1/video_generation",
    body,
    warnings: [],
    notes: ["MiniMax/Hailuo plan keeps unified video fields under the selected MemeFast route."],
  };
}

function buildGrokVideoPlan(
  request: DirectorMemefastGenerationRequestPlanInput,
  media: {
    readonly firstFrame: string | undefined;
    readonly references: readonly string[];
    readonly videoRefs: readonly string[];
    readonly audioRefs: readonly string[];
  },
): DirectorGenerationRequestPlan {
  const images = uniqueStrings([
    ...(media.firstFrame ? [media.firstFrame] : []),
    ...media.references,
  ]);
  const forwardedImages = images.slice(0, 1);
  const warnings: string[] = [];
  if (images.length > forwardedImages.length) {
    warnings.push("Grok Video 3 adapter accepts one image only; extra references were dropped.");
  }
  if (media.videoRefs.length > 0) {
    warnings.push(
      "Grok Video 3 does not accept video references in this adapter and they were dropped.",
    );
  }
  if (media.audioRefs.length > 0) {
    warnings.push(
      "Grok Video 3 does not accept audio references in this adapter and they were dropped.",
    );
  }
  if (readBoolean(request.input.audio) === true) {
    warnings.push("Grok Video 3 does not accept audio generation toggles in this adapter.");
  }
  return {
    family: "grok",
    adapter: "grok-video",
    mediaType: "video",
    operation: forwardedImages.length === 1 ? "i2v" : "t2v",
    modelId: request.model,
    endpointPath: "/v1/video/create",
    body: {
      model: request.model,
      prompt: request.prompt,
      aspect_ratio: toGrokAspectRatio(readAspectRatio(request.input)),
      size: toGrokSize(readString(request.input.resolution)),
      images: forwardedImages,
    },
    warnings,
    notes: ["Grok Video 3 uses the unified /v1/video/create transport with one optional image."],
  };
}

function buildOmniFlashVideoPlan(
  request: DirectorMemefastGenerationRequestPlanInput,
  media: {
    readonly firstFrame: string | undefined;
    readonly lastFrame: string | undefined;
    readonly references: readonly string[];
    readonly videoRefs: readonly string[];
    readonly audioRefs: readonly string[];
  },
): DirectorGenerationRequestPlan {
  const referenceLimit = /components/iu.test(request.model) ? 4 : 1;
  const requestedImages = uniqueStrings([
    ...(media.firstFrame ? [media.firstFrame] : []),
    ...media.references,
  ]);
  const images = requestedImages.slice(0, referenceLimit);
  const warnings: string[] = [];
  if (requestedImages.length > images.length) {
    warnings.push(
      `Omni Flash adapter only forwards ${referenceLimit} reference image(s); extra images were dropped.`,
    );
  }
  if (media.lastFrame) {
    warnings.push("Omni Flash adapter currently ignores last-frame guidance.");
  }
  if (media.videoRefs.length > 0) {
    warnings.push("Omni Flash adapter does not accept video references and they were dropped.");
  }
  if (media.audioRefs.length > 0) {
    warnings.push("Omni Flash adapter does not accept audio references and they were dropped.");
  }
  return {
    family: "omni_flash",
    adapter: "omni-flash-video",
    mediaType: "video",
    operation: images.length > 1 ? "r2v" : images.length === 1 ? "i2v" : "t2v",
    modelId: request.model,
    endpointPath: "/v1/video/create",
    body: {
      model: request.model,
      prompt: request.prompt,
      aspect_ratio: toGrokAspectRatio(readAspectRatio(request.input)),
      size: toGrokSize(readString(request.input.resolution)),
      duration: readNumber(request.input.duration) ?? readNumber(request.input.seconds) ?? 5,
      images,
    },
    warnings,
    notes: [
      "Omni Flash uses the unified video create route and keeps reference images inline when possible.",
      ...(/components/iu.test(request.model)
        ? ["Omni Flash Components is the multi-reference variant."]
        : []),
    ],
  };
}

function buildUnifiedVideoPlan(
  request: DirectorMemefastGenerationRequestPlanInput,
  media: { readonly firstFrame: string | undefined; readonly references: readonly string[] },
): DirectorGenerationRequestPlan {
  const images = uniqueStrings([
    ...(media.firstFrame ? [media.firstFrame] : []),
    ...media.references,
  ]);
  const referenceLimit = 1;
  const forwardedImages = images.slice(0, referenceLimit);
  return {
    family: "unified",
    adapter: "unified-video",
    mediaType: "video",
    operation: forwardedImages.length > 1 ? "r2v" : forwardedImages.length === 1 ? "i2v" : "t2v",
    modelId: request.model,
    endpointPath: "/v1/video/create",
    body: {
      model: request.model,
      prompt: request.prompt,
      aspect_ratio: readAspectRatio(request.input),
      size: readString(request.input.size) ?? readString(request.input.resolution),
      duration: readNumber(request.input.duration) ?? readNumber(request.input.seconds),
      images: forwardedImages,
    },
    warnings:
      images.length > forwardedImages.length
        ? [
            `Unified video adapter only forwards ${referenceLimit} reference image(s); extra images were dropped.`,
          ]
        : [],
    notes: ["Unified video plan covers metadata-only /v1/video/create families."],
  };
}

function buildGenericVideoPlan(
  request: DirectorMemefastGenerationRequestPlanInput,
  media: { readonly firstFrame: string | undefined; readonly references: readonly string[] },
): DirectorGenerationRequestPlan {
  const body: Record<string, unknown> = {
    model: request.model,
    prompt: request.prompt,
  };
  appendIfDefined(body, "aspect_ratio", readAspectRatio(request.input));
  appendIfDefined(
    body,
    "duration",
    readNumber(request.input.duration) ?? readNumber(request.input.seconds),
  );
  appendIfDefined(body, "size", readString(request.input.size));
  appendIfDefined(body, "resolution", readString(request.input.resolution));
  appendIfDefined(body, "image_url", media.firstFrame ?? media.references[0]);
  if (media.references.length > 0) {
    body.images = media.references;
  }
  return {
    family: "generic",
    adapter: "generic-video",
    mediaType: "video",
    operation: media.firstFrame ? "i2v" : "t2v",
    modelId: request.model,
    endpointPath: "/v1/video/generations",
    body,
    warnings: ["No dedicated model-family adapter matched; generic video fallback was used."],
    notes: ["Generic fallback is retained only for unknown provider models."],
  };
}

function resolveViduEndpointKind(
  request: DirectorMemefastGenerationRequestPlanInput,
  media: {
    readonly firstFrame: string | undefined;
    readonly lastFrame: string | undefined;
    readonly references: readonly string[];
  },
): "text" | "image" | "reference" | "start_end" {
  if (hasEndpoint(request, /首尾|start[-_ ]?end/iu) || (media.firstFrame && media.lastFrame)) {
    return "start_end";
  }
  if (hasEndpoint(request, /参考|reference/iu) || media.references.length > 1) {
    return "reference";
  }
  if (hasEndpoint(request, /图生|img|image/iu) || media.firstFrame) {
    return "image";
  }
  return "text";
}

function buildKlingOmniImageList(
  firstFrame: string | undefined,
  lastFrame: string | undefined,
  references: readonly string[],
): Array<Record<string, string>> {
  if (firstFrame || lastFrame) {
    return [
      ...(firstFrame ? [{ image_url: firstFrame, type: "first_frame" }] : []),
      ...(lastFrame ? [{ image_url: lastFrame, type: "end_frame" }] : []),
    ];
  }
  return references.map((image_url) => ({ image_url }));
}

function resolveKlingModelName(model: string): string {
  const aliasMap: Readonly<Record<string, string>> = {
    "kling-omni-video": "kling-v3-omni",
    "kling-o1-video": "kling-video-o1",
    "kling-o1-text-to-video": "kling-video-o1",
    "kling-video": "kling-v3",
    "kling-v3-omni": "kling-v3-omni",
  };
  return aliasMap[model] ?? model;
}

function resolveKlingMode(
  input: Readonly<Record<string, unknown>>,
  resolvedModelName: string,
  hasLastFrame: boolean,
): string | undefined {
  const explicit = readString(input.mode);
  if (explicit) {
    return explicit;
  }
  const resolution = readString(input.resolution)?.toLowerCase();
  if (/kling-v3/iu.test(resolvedModelName)) {
    return resolution === "1080p" ? "pro" : "std";
  }
  if (hasLastFrame) {
    return undefined;
  }
  if (resolution === "1080p") {
    return "pro";
  }
  if (resolution === "720p") {
    return "std";
  }
  return undefined;
}

function normalizeKlingDuration(input: {
  readonly model: string;
  readonly resolvedModelName: string;
  readonly requestedDuration: number | undefined;
  readonly hasLastFrame: boolean;
}): number {
  if (input.hasLastFrame) {
    return 5;
  }
  const isOmniVideo =
    KLING_VIDEO_PATH_MAP[input.model] === "omni-video" ||
    input.resolvedModelName === "kling-v3-omni";
  const minDuration =
    input.resolvedModelName === "kling-v3" || input.resolvedModelName === "kling-v3-omni"
      ? 3
      : isOmniVideo
        ? 3
        : 5;
  const maxDuration =
    input.resolvedModelName === "kling-v3" || input.resolvedModelName === "kling-v3-omni"
      ? 15
      : isOmniVideo
        ? 15
        : 10;
  const candidate =
    typeof input.requestedDuration === "number" && Number.isFinite(input.requestedDuration)
      ? Math.round(input.requestedDuration)
      : minDuration;
  return Math.max(minDuration, Math.min(maxDuration, candidate));
}

function resolveTextLlmAdapter(request: DirectorMemefastGenerationRequestPlanInput): string {
  const explicit = readString(request.input.llmAdapter) ?? readString(request.input.llm_adapter);
  if (
    explicit === "openai_responses" ||
    explicit === "anthropic_messages" ||
    explicit === "gemini_generate_content" ||
    explicit === "openai_chat"
  ) {
    return explicit;
  }
  if (/^claude(?:[.-]|$)/iu.test(request.model)) {
    return "anthropic_messages";
  }
  return "openai_chat";
}

function readMessageArray(value: unknown, fallbackPrompt: string): Array<Record<string, unknown>> {
  if (!Array.isArray(value) || value.length === 0) {
    return [{ role: "user", content: fallbackPrompt }];
  }
  return value.filter(isRecord).map((message) => ({
    ...message,
    role: readString(message.role) ?? "user",
    content:
      typeof message.content === "string" || Array.isArray(message.content)
        ? message.content
        : fallbackPrompt,
  }));
}

function extractMessageText(message: Record<string, unknown>): string {
  const content = message.content;
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((part) => {
      if (!isRecord(part)) {
        return "";
      }
      return readString(part.text) ?? "";
    })
    .filter(Boolean)
    .join("\n");
}

function toAnthropicContent(content: unknown): unknown {
  if (!Array.isArray(content)) {
    return content;
  }
  return content.map((part) => {
    if (!isRecord(part)) {
      return part;
    }
    if (part.type === "image_url") {
      const imageUrl = isRecord(part.image_url) ? readString(part.image_url.url) : undefined;
      return {
        type: "image",
        source: {
          type: "url",
          url: imageUrl ?? "",
        },
      };
    }
    return part;
  });
}

function toGeminiParts(content: unknown): Array<Record<string, unknown>> {
  if (typeof content === "string") {
    return [{ text: content }];
  }
  if (!Array.isArray(content)) {
    return [{ text: "" }];
  }
  return content.map((part) => {
    if (!isRecord(part)) {
      return { text: "" };
    }
    if (part.type === "image_url") {
      const imageUrl = isRecord(part.image_url) ? readString(part.image_url.url) : undefined;
      return {
        file_data: {
          mime_type: readString(part.mime_type) ?? readString(part.mimeType) ?? "image/jpeg",
          file_uri: imageUrl ?? "",
        },
      };
    }
    return { text: readString(part.text) ?? "" };
  });
}

function readFirstFrame(input: Readonly<Record<string, unknown>>): string | undefined {
  return (
    readString(input.firstFrame) ??
    readString(input.first_frame) ??
    readString(input.imageUrl) ??
    readString(input.image_url) ??
    readString(input.input_reference) ??
    readImageWithRole(input, /first|start/iu)
  );
}

function readLastFrame(input: Readonly<Record<string, unknown>>): string | undefined {
  return (
    readString(input.lastFrame) ??
    readString(input.last_frame) ??
    readString(input.endFrame) ??
    readString(input.end_frame) ??
    readString(input.imageTail) ??
    readString(input.image_tail) ??
    readImageWithRole(input, /last|end|tail/iu)
  );
}

function readReferenceImages(input: Readonly<Record<string, unknown>>): string[] {
  return uniqueStrings([
    ...readStringArray(input.referenceImages),
    ...readStringArray(input.references),
    ...readStringArray(input.images),
    ...readStringArray(input.image_urls),
    ...readStringArray(input.imageUrls),
    ...readImageWithRoles(input)
      .filter((item) => item.role === undefined || !/(first|start|last|end|tail)/iu.test(item.role))
      .map((item) => item.url),
  ]);
}

function readImageWithRole(
  input: Readonly<Record<string, unknown>>,
  rolePattern: RegExp,
): string | undefined {
  return readImageWithRoles(input).find((item) => item.role && rolePattern.test(item.role))?.url;
}

function readImageWithRoles(input: Readonly<Record<string, unknown>>): ImageWithRole[] {
  const raw = input.imageWithRoles;
  if (!Array.isArray(raw)) {
    return [];
  }
  const result: ImageWithRole[] = [];
  for (const item of raw) {
    if (!isRecord(item)) {
      continue;
    }
    const url = readString(item.url) ?? readString(item.image_url) ?? readString(item.imageUrl);
    if (!url) {
      continue;
    }
    result.push({
      url,
      ...(typeof item.role === "string" ? { role: item.role } : {}),
    });
  }
  return result;
}

function readAspectRatio(input: Readonly<Record<string, unknown>>): string {
  return readString(input.aspect_ratio) ?? readString(input.aspectRatio) ?? "16:9";
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) {
      return true;
    }
    if (["false", "0", "no", "off"].includes(normalized)) {
      return false;
    }
  }
  return undefined;
}

function readStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter(isNonEmptyString).map((item) => item.trim());
  }
  const text = readString(value);
  if (!text) {
    return [];
  }
  return text
    .split(/[,\n]/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function appendIfDefined(target: Record<string, unknown>, key: string, value: unknown): void {
  if (value !== undefined) {
    target[key] = value;
  }
}

function uniqueStrings(values: readonly (string | undefined)[]): string[] {
  return Array.from(new Set(values.filter(isNonEmptyString).map((value) => value.trim())));
}

function pickFirstString(values: readonly (string | undefined)[]): string | undefined {
  return values.find(isNonEmptyString)?.trim();
}

function hasEndpoint(
  request: DirectorMemefastGenerationRequestPlanInput,
  pattern: RegExp,
): boolean {
  return request.endpointTypes?.some((endpoint) => pattern.test(endpoint)) ?? false;
}

function resolveImageSize(aspectRatio: string | undefined): string {
  switch (aspectRatio) {
    case "9:16":
      return "1024x1536";
    case "16:9":
      return "1536x1024";
    case "4:3":
      return "1152x896";
    case "3:4":
      return "896x1152";
    default:
      return "1024x1024";
  }
}

function resolveTencentImageResolution(aspectRatio: string | undefined): string {
  if (aspectRatio === "9:16") {
    return "720x1280";
  }
  if (aspectRatio === "16:9") {
    return "1280x720";
  }
  return "1024x1024";
}

function resolveAliyunQwenEditSize(aspectRatio: string | undefined): string {
  return resolveTencentImageResolution(aspectRatio).replace("x", "*");
}

function toUpperString(value: string | undefined): string | undefined {
  return value === undefined ? undefined : value.trim().toUpperCase();
}

function toIdeogramAspectRatio(aspectRatio: string | undefined): string | undefined {
  switch (aspectRatio) {
    case "1:1":
      return "ASPECT_1_1";
    case "3:4":
      return "ASPECT_3_4";
    case "4:3":
      return "ASPECT_4_3";
    case "9:16":
      return "ASPECT_9_16";
    case "16:9":
      return "ASPECT_16_9";
    default:
      return aspectRatio;
  }
}

function toReplicateImageSize(aspectRatio: string | undefined): {
  readonly width: number;
  readonly height: number;
  readonly recraftSize: string;
} {
  switch (aspectRatio) {
    case "9:16":
      return { width: 768, height: 1365, recraftSize: "768x1365" };
    case "4:3":
      return { width: 1152, height: 864, recraftSize: "1152x864" };
    case "3:4":
      return { width: 864, height: 1152, recraftSize: "864x1152" };
    case "16:9":
      return { width: 1280, height: 720, recraftSize: "1365x768" };
    default:
      return { width: 1024, height: 1024, recraftSize: "1024x1024" };
  }
}

function isGptImage2Model(model: string): boolean {
  return GPT_IMAGE_2_MODELS.has(normalizeModelId(model));
}

function normalizeModelId(model: string): string {
  return model.trim().toLowerCase();
}

function isFluxKontextImageModel(model: string): boolean {
  return /^fal-ai\/flux-pro\/kontext(?:\/(?:max(?:\/(?:multi|text-to-image))?|multi|text-to-image))?$/iu.test(
    model,
  );
}

function isFalFluxImageModel(model: string): boolean {
  const normalized = normalizeModelId(model);
  return (
    FAL_FLUX_TEXT_IMAGE_MODELS.has(normalized) ||
    FAL_FLUX_IMAGE_TO_IMAGE_MODELS.has(normalized) ||
    FAL_FLUX_REDUX_IMAGE_MODELS.has(normalized)
  );
}

function isReplicateFluxKontextImageModel(model: string): boolean {
  const normalized = normalizeModelId(model);
  return (
    REPLICATE_FLUX_KONTEXT_SINGLE_IMAGE_MODELS.has(normalized) ||
    REPLICATE_FLUX_KONTEXT_MULTI_IMAGE_MODELS.has(normalized)
  );
}

function isDalleImageModel(model: string): boolean {
  return (
    model === "dall-e-3" ||
    /^qwen-image-max(?:-|$)/iu.test(model) ||
    /^grok-imagine-image(?:-|$)/iu.test(model)
  );
}

function isQwenDalleImageModel(model: string): boolean {
  return /^qwen-image-max(?:-|$)/iu.test(model);
}

function appendNegativePrompt(prompt: string, negativePrompt: string | undefined): string {
  return negativePrompt ? `${prompt}\n\nNegative constraints: ${negativePrompt}` : prompt;
}

function normalizeImageOutputFormat(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "jpg") {
    return "jpeg";
  }
  return normalized === "png" || normalized === "jpeg" || normalized === "webp"
    ? normalized
    : undefined;
}

function normalizeGptImageBackground(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "transparent") {
    return "auto";
  }
  return normalized === "opaque" || normalized === "auto" ? normalized : undefined;
}

function mapResolutionToGptImageQuality(value: string | undefined): string | undefined {
  switch (value?.trim().toUpperCase()) {
    case "1K":
      return "low";
    case "2K":
      return "medium";
    case "4K":
      return "high";
    default:
      return undefined;
  }
}

function normalizeGptImageResolutionTier(value: string | undefined): "1K" | "2K" | "4K" {
  const normalized = value?.trim().toUpperCase();
  return normalized === "1K" || normalized === "4K" ? normalized : "2K";
}

function mapAspectRatioToGptImage2Size(
  aspectRatio: string | undefined,
  resolution: string | undefined,
): string {
  const ratioSizes = GPT_IMAGE_2_SIZE_BY_ASPECT_RATIO[aspectRatio ?? "1:1"];
  if (ratioSizes) {
    return ratioSizes[normalizeGptImageResolutionTier(resolution)] ?? ratioSizes["2K"];
  }
  return mapAspectRatioToOpenAiImageSize(aspectRatio);
}

function mapAspectRatioToOpenAiImageSize(aspectRatio: string | undefined): string {
  switch (inferDalleCompatibleOrientation(aspectRatio)) {
    case "portrait":
      return "1024x1536";
    case "landscape":
      return "1536x1024";
    default:
      return "1024x1024";
  }
}

function inferDalleCompatibleOrientation(
  aspectRatio: string | undefined,
): "landscape" | "portrait" | "square" {
  const value = aspectRatio?.trim() ?? "";
  if (["9:16", "2:3", "3:4", "4:5", "9:21"].includes(value)) {
    return "portrait";
  }
  if (["16:9", "3:2", "4:3", "5:4", "21:9"].includes(value)) {
    return "landscape";
  }
  return "square";
}

function resolveDalleCompatibleSize(
  size: string | undefined,
  aspectRatio: string | undefined,
): string {
  if (size && (/^\d{3,5}x\d{3,5}$/iu.test(size) || size === "auto")) {
    return size;
  }
  switch (inferDalleCompatibleOrientation(aspectRatio)) {
    case "portrait":
      return "1024x1792";
    case "landscape":
      return "1792x1024";
    default:
      return "1024x1024";
  }
}

function toFalImageSize(aspectRatio: string | undefined): string {
  switch (aspectRatio) {
    case "16:9":
      return "landscape_16_9";
    case "9:16":
      return "portrait_16_9";
    case "4:3":
      return "landscape_4_3";
    case "3:4":
      return "portrait_4_3";
    case "1:1":
      return "square_hd";
    default:
      return "landscape_4_3";
  }
}

function normalizeReplicateOutputFormat(
  value: string | undefined,
  fallback: "jpg" | "png",
): string {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "jpeg") {
    return "jpg";
  }
  return normalized === "jpg" || normalized === "png" || normalized === "webp"
    ? normalized
    : fallback;
}

function toGrokAspectRatio(aspectRatio: string | undefined): "2:3" | "3:2" | "1:1" {
  const normalized = aspectRatio?.trim();
  if (normalized === "1:1") {
    return "1:1";
  }
  if (normalized === "9:16" || normalized === "3:4" || normalized === "2:3") {
    return "2:3";
  }
  return "3:2";
}

function toGrokSize(_resolution: string | undefined): "720P" {
  void _resolution;
  return "720P";
}

function normalizeSoraResolution(value: string | undefined): "720p" | "1080p" | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (normalized.includes("1080")) {
    return "1080p";
  }
  if (normalized.includes("720")) {
    return "720p";
  }
  return undefined;
}

function getDefaultSoraDuration(model: string): number | undefined {
  return SORA_VARIANTS[model]?.durations[0];
}

function prefersSoraUnifiedRoute(
  model: string,
  endpointTypes: readonly string[] | undefined,
): boolean {
  const profile = SORA_VARIANTS[model];
  if (profile?.preferUnifiedEndpoint !== true) {
    return false;
  }
  return (endpointTypes ?? []).some((type) => SORA_UNIFIED_ENDPOINT_TYPES.has(type.trim()));
}

function validateSoraVideoOptions(
  model: string,
  duration: number | undefined,
  resolution: string | undefined,
): void {
  const profile = SORA_VARIANTS[model];
  if (!profile) {
    return;
  }
  if (duration !== undefined && !profile.durations.includes(duration)) {
    throw new Error(`${model} only supports ${profile.durations.join(" / ")} second durations.`);
  }
  const normalizedResolution = normalizeSoraResolution(resolution);
  if (normalizedResolution && !profile.resolutions.includes(normalizedResolution)) {
    throw new Error(`${model} only supports ${profile.resolutions.join(" / ")} resolution.`);
  }
  if (model === "sora-2-pro-all" && duration === 25 && normalizedResolution === "1080p") {
    throw new Error("sora-2-pro-all 25 second generation only supports 720p.");
  }
}

function toSoraOfficialSize(
  model: string,
  aspectRatio: string | undefined,
  resolution: string | undefined,
): string {
  const portrait = aspectRatio === "9:16" || aspectRatio === "3:4";
  const normalizedResolution = normalizeSoraResolution(resolution);
  const proFamily = model === "sora-2-pro" || model === "sora-2-pro-all";
  if (normalizedResolution === "1080p" && proFamily) {
    return portrait ? "1024x1792" : "1792x1024";
  }
  return portrait ? "720x1280" : "1280x720";
}

function toSoraUnifiedSize(model: string, resolution: string | undefined): "small" | "large" {
  const normalizedResolution = normalizeSoraResolution(resolution);
  if (normalizedResolution === "1080p" && (model === "sora-2-pro" || model === "sora-2-pro-all")) {
    return "large";
  }
  return "small";
}

function toSoraUnifiedOrientation(aspectRatio: string | undefined): "portrait" | "landscape" {
  return aspectRatio === "9:16" || aspectRatio === "3:4" ? "portrait" : "landscape";
}

function isOpenAiVeoModel(model: string): boolean {
  return /^veo_3_1(?:[-_].*)?$/iu.test(model.trim());
}

function normalizeVeoModel(model: string): string {
  return model.trim().toLowerCase();
}

function resolveVeoEndpointFamily(endpointTypes: readonly string[] | undefined): VeoEndpointFamily {
  if (!endpointTypes || endpointTypes.length === 0) {
    return "unknown";
  }
  if (
    endpointTypes.some(
      (type) =>
        /openai_videos|openai.*official|openai.*video/iu.test(type) ||
        type === "openAI视频格式" ||
        type === "openAI官方视频格式",
    )
  ) {
    return "openai_videos";
  }
  if (endpointTypes.some((type) => /unified/iu.test(type) || type.trim() === "视频统一格式")) {
    return "unified";
  }
  return "unknown";
}

function createVeoCapability(input: {
  readonly endpointFamily: VeoEndpointFamily;
  readonly mode: VeoUploadMode;
  readonly minFiles?: number;
  readonly maxFiles?: number;
  readonly supportsTextToVideo?: boolean;
}): VeoUploadCapability {
  return {
    isVeo: true,
    endpointFamily: input.endpointFamily,
    mode: input.mode,
    minFiles: input.minFiles ?? 0,
    maxFiles: input.maxFiles ?? 0,
    supportsTextToVideo: input.supportsTextToVideo ?? false,
  };
}

function createSingleImageVeoCapability(
  endpointFamily: VeoEndpointFamily,
  required: boolean,
): VeoUploadCapability {
  return createVeoCapability({
    endpointFamily,
    mode: "single",
    minFiles: required ? 1 : 0,
    maxFiles: 1,
  });
}

function createFirstLastVeoCapability(input: {
  readonly endpointFamily: VeoEndpointFamily;
  readonly required: boolean;
  readonly supportsTextToVideo?: boolean;
}): VeoUploadCapability {
  return createVeoCapability({
    endpointFamily: input.endpointFamily,
    mode: "first_last",
    minFiles: input.required ? 1 : 0,
    maxFiles: 2,
    ...(input.supportsTextToVideo === undefined
      ? {}
      : { supportsTextToVideo: input.supportsTextToVideo }),
  });
}

function createMultiImageVeoCapability(
  endpointFamily: VeoEndpointFamily,
  minFiles = 1,
  maxFiles = 3,
): VeoUploadCapability {
  return createVeoCapability({
    endpointFamily,
    mode: "multi",
    minFiles,
    maxFiles,
  });
}

function resolveVeoUploadCapability(
  model: string,
  endpointTypes: readonly string[] | undefined,
): VeoUploadCapability {
  const lower = normalizeVeoModel(model);
  const family = isOpenAiVeoModel(model)
    ? "openai_videos"
    : resolveVeoEndpointFamily(endpointTypes);
  if (family === "openai_videos") {
    if (OPENAI_VEO_MULTI_IMAGE_MODELS.has(lower) || lower.includes("fast-components")) {
      return createMultiImageVeoCapability(family);
    }
    if (OPENAI_VEO_SINGLE_IMAGE_MODELS.has(lower) || lower.includes("components")) {
      return createSingleImageVeoCapability(family, true);
    }
    if (OPENAI_VEO_TEXT_ONLY_MODELS.has(lower)) {
      return createVeoCapability({
        endpointFamily: family,
        mode: "none",
        supportsTextToVideo: true,
      });
    }
    if (OPENAI_VEO_FIRST_LAST_MODELS.has(lower)) {
      return createFirstLastVeoCapability({
        endpointFamily: family,
        required: false,
        supportsTextToVideo: true,
      });
    }
    return createFirstLastVeoCapability({
      endpointFamily: family,
      required: false,
      supportsTextToVideo: true,
    });
  }

  if (UNIFIED_VEO_TEXT_ONLY_MODELS.has(lower)) {
    return createVeoCapability({
      endpointFamily: family,
      mode: "none",
      supportsTextToVideo: true,
    });
  }
  if (UNIFIED_VEO_SINGLE_IMAGE_MODELS.has(lower) || lower.includes("frames")) {
    return createSingleImageVeoCapability(family, true);
  }
  if (UNIFIED_VEO_FIRST_LAST_OPTIONAL_MODELS.has(lower)) {
    return createFirstLastVeoCapability({
      endpointFamily: family,
      required: false,
      supportsTextToVideo: true,
    });
  }
  if (UNIFIED_VEO_FIRST_LAST_REQUIRED_MODELS.has(lower)) {
    return createFirstLastVeoCapability({ endpointFamily: family, required: true });
  }
  if (UNIFIED_VEO_MULTI_IMAGE_MODELS.has(lower) || lower.includes("components")) {
    return createMultiImageVeoCapability(family);
  }
  return createVeoCapability({
    endpointFamily: family,
    mode: "none",
    supportsTextToVideo: true,
  });
}

function selectVeoReferenceImages(
  capability: VeoUploadCapability,
  media: {
    readonly firstFrame: string | undefined;
    readonly lastFrame: string | undefined;
    readonly references: readonly string[];
  },
): string[] {
  const firstFrame = media.firstFrame ?? media.references[0];
  const lastFrame = media.lastFrame ?? media.references[1];
  if (capability.mode === "single") {
    return firstFrame ? [firstFrame] : [];
  }
  if (capability.mode === "first_last") {
    return uniqueStrings([firstFrame, lastFrame]).slice(0, capability.maxFiles || 2);
  }
  if (capability.mode === "multi") {
    const candidates =
      media.references.length > 0 ? media.references : [media.firstFrame, media.lastFrame];
    return uniqueStrings(candidates).slice(0, capability.maxFiles || 3);
  }
  return [];
}

function toVeoOpenAiVideoSize(aspectRatio: string | undefined): "9x16" | "16x9" {
  return aspectRatio === "9:16" || aspectRatio === "3:4" ? "9x16" : "16x9";
}

function clampInteger(
  value: number | undefined,
  min: number,
  max: number,
  fallback: number,
): number | undefined {
  const candidate = value ?? fallback;
  if (!Number.isFinite(candidate)) {
    return undefined;
  }
  return Math.max(min, Math.min(max, Math.trunc(candidate)));
}

function clampFloat(value: number | undefined, min: number, max: number, fallback: number): number {
  const candidate = value ?? fallback;
  return Math.max(min, Math.min(max, Number.isFinite(candidate) ? candidate : fallback));
}

function stripNaNValues(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => typeof entry !== "number" || !Number.isNaN(entry)),
  );
}

function normalizeResolution(value: string): string {
  return value.trim().toLowerCase();
}

function isSeedance20ModelId(model: string): boolean {
  return model === "doubao-seedance-2-0-260128" || model === "doubao-seedance-2-0-fast-260128";
}

function normalizeSeedance20Resolution(
  model: string,
  resolution: string | undefined,
  fallback: "720p" | "480p",
): string | undefined {
  const normalized = resolution?.trim().toLowerCase();
  if (!isSeedance20ModelId(model)) {
    return normalized || resolution;
  }
  return normalized === "480p" ? "480p" : fallback;
}

function normalizeSeedance20Duration(
  model: string,
  duration: number | undefined,
  fallback: number,
  minDurationOverride: number,
): number | undefined {
  const normalized =
    typeof duration === "number" && Number.isFinite(duration) ? Math.round(duration) : undefined;
  if (!isSeedance20ModelId(model)) {
    return normalized ?? duration;
  }
  const minimumDuration = Math.min(15, Math.max(1, Math.round(minDurationOverride)));
  return Math.min(15, Math.max(minimumDuration, normalized ?? fallback));
}

function seedanceSupportsAudioGeneration(model: string): boolean {
  return /doubao-seedance-(?:1[._-]?5[._-]?pro(?:[._-]?251215)?|2[._-]?0(?:[._-]?fast)?)/iu.test(
    model.toLowerCase(),
  );
}

function buildSeedanceTextContent(input: {
  readonly prompt: string;
  readonly resolution: string;
  readonly ratio?: string;
  readonly duration?: number;
  readonly cameraFixed?: boolean;
  readonly adapter: "ark-official" | "volc-proxy";
  readonly parameterStyle: "long" | "short";
}): string {
  if (input.adapter === "ark-official") {
    return input.prompt;
  }
  if (input.parameterStyle === "short") {
    return [
      input.prompt,
      input.resolution ? `--rs ${input.resolution}` : "",
      input.ratio ? `--rt ${input.ratio}` : "",
      typeof input.duration === "number" ? `--dur ${input.duration}` : "",
    ]
      .filter(Boolean)
      .join(" ");
  }
  return [
    input.prompt,
    `--resolution ${input.resolution}`,
    input.ratio ? `--ratio ${input.ratio}` : "",
    typeof input.duration === "number" ? `--duration ${input.duration}` : "",
    typeof input.cameraFixed === "boolean" ? `--camera_fixed ${input.cameraFixed}` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function normalizeUpperResolution(value: string): string {
  const match = value.trim().match(/^(\d+)\s*[pP]$/u);
  return match?.[1] ? `${match[1]}P` : value.trim().toUpperCase();
}

function resolvePixVerseModelName(model: string, modelVersion?: string): string {
  const explicit = modelVersion?.trim().toLowerCase();
  if (
    explicit === "v3.5" ||
    explicit === "v4" ||
    explicit === "v4.5" ||
    explicit === "v5" ||
    explicit === "v5.5" ||
    explicit === "v5.6" ||
    explicit === "v6" ||
    explicit === "c1"
  ) {
    return explicit;
  }
  const normalized = model.toLowerCase();
  if (/c1/u.test(normalized)) {
    return "c1";
  }
  if (/v6/u.test(normalized)) {
    return "v6";
  }
  if (/v5[._-]?6/u.test(normalized)) {
    return "v5.6";
  }
  if (/v5[._-]?5/u.test(normalized)) {
    return "v5.5";
  }
  if (/v5(?![._-]?\d)/u.test(normalized)) {
    return "v5";
  }
  if (/v4[._-]?5/u.test(normalized)) {
    return "v4.5";
  }
  return "v5.5";
}

function readPixVerseOperation(
  request: DirectorMemefastGenerationRequestPlanInput,
  media: {
    readonly firstFrame: string | undefined;
    readonly lastFrame: string | undefined;
    readonly references: readonly string[];
  },
): "t2v" | "i2v" | "r2v" | "first_last_frame" {
  const explicit = readString(request.input.operation);
  if (
    explicit === "first_last_frame" ||
    explicit === "r2v" ||
    explicit === "i2v" ||
    explicit === "t2v"
  ) {
    return explicit;
  }
  if (media.firstFrame && media.lastFrame) {
    return "first_last_frame";
  }
  if (media.references.length > 1) {
    return "r2v";
  }
  if (media.firstFrame) {
    return "i2v";
  }
  return "t2v";
}

function pixVerseUploadPlaceholder(name: string): string {
  return `__PIXVERSE_UPLOAD:${name}__`;
}

function readImageId(value: unknown): number | string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return readString(value);
}

function readImageIdArray(value: unknown): Array<number | string> {
  return Array.isArray(value)
    ? value.map(readImageId).filter((item): item is number | string => item !== undefined)
    : [];
}

function uniquePixVerseImageIds(
  values: readonly (number | string | undefined)[],
): Array<number | string> {
  const result: Array<number | string> = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (value === undefined) {
      continue;
    }
    const key = String(value);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(value);
  }
  return result;
}

function supportsPixVerseGenerateAudio(modelName: string): boolean {
  return /^(?:v5\.5|v5\.6|v6|c1)$/u.test(modelName);
}

function nearestAllowedDuration(candidate: number, allowed: readonly number[]): number {
  return allowed.reduce((best, value) =>
    Math.abs(value - candidate) < Math.abs(best - candidate) ? value : best,
  );
}

function normalizePixVerseDuration(
  modelName: string,
  duration: number | undefined,
  quality: string,
): number {
  const candidate =
    typeof duration === "number" && Number.isFinite(duration) ? Math.round(duration) : 5;
  if (modelName === "v6" || modelName === "c1") {
    return Math.max(1, Math.min(15, candidate));
  }
  if (modelName === "v5.5" || modelName === "v5.6") {
    const allowed = quality === "1080p" ? [5, 8] : [5, 8, 10];
    return allowed.includes(candidate) ? candidate : nearestAllowedDuration(candidate, allowed);
  }
  const allowed = quality === "1080p" && modelName === "v3.5" ? [5] : [5, 8];
  return allowed.includes(candidate) ? candidate : nearestAllowedDuration(candidate, allowed);
}

function appendPixVerseReferenceAnchors(prompt: string, refNames: readonly string[]): string {
  const missing = refNames.filter((name) => !new RegExp(`@${name}(?:\\s|$)`, "u").test(prompt));
  if (missing.length === 0) {
    return prompt;
  }
  return `${prompt}\n\nReference anchors: ${missing.map((name) => `@${name} `).join("")}`.trim();
}

function normalizePixVerseQuality(value: string | undefined): string {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "360" || normalized === "360p") {
    return "360p";
  }
  if (normalized === "540" || normalized === "540p") {
    return "540p";
  }
  if (normalized === "1080" || normalized === "1080p") {
    return "1080p";
  }
  return "720p";
}

function resolveRunwaySubmitModel(model: string): "gen3a_turbo" | "gen4_turbo" {
  return /gen4/iu.test(model) ? "gen4_turbo" : "gen3a_turbo";
}

function resolveRunwayDuration(model: string, requestedDuration: number | undefined): number {
  if (/(?:_|-)10$/iu.test(model)) {
    return 10;
  }
  if (/(?:_|-)5$/iu.test(model)) {
    return 5;
  }
  return requestedDuration === 10 ? 10 : 5;
}

function isPortrait(aspectRatio: string): boolean {
  const match = aspectRatio.match(/^(\d+)\s*:\s*(\d+)$/u);
  if (!match?.[1] || !match[2]) {
    return false;
  }
  return Number(match[2]) > Number(match[1]);
}
