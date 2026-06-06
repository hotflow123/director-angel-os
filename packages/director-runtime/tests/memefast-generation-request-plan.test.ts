import { describe, expect, it } from "vitest";

import { buildDirectorMemefastGenerationRequestPlan } from "../src/memefast-generation-request-plan.ts";

describe("director memefast generation request plan", () => {
  it("builds Kling omni first-last-frame requests with native image_list roles", () => {
    const plan = buildDirectorMemefastGenerationRequestPlan({
      mediaKind: "video",
      model: "kling-omni-video",
      prompt: "雨夜街头转场",
      routeFamily: "kling",
      endpointTypes: ["omni-video"],
      input: {
        imageWithRoles: [
          { role: "first_frame", url: "https://cdn.example.test/first.png" },
          { role: "last_frame", url: "https://cdn.example.test/last.png" },
        ],
        aspectRatio: "16:9",
        duration: 5,
      },
    });

    expect(plan).toMatchObject({
      family: "kling",
      adapter: "kling-video",
      mediaType: "video",
      operation: "first_last_frame",
      endpointPath: "/kling/v1/videos/omni-video",
      body: {
        model_name: "kling-v3-omni",
        prompt: "雨夜街头转场",
        aspect_ratio: "16:9",
        duration: "5",
        sound: "on",
        image_list: [
          { image_url: "https://cdn.example.test/first.png", type: "first_frame" },
          { image_url: "https://cdn.example.test/last.png", type: "end_frame" },
        ],
      },
    });
  });

  it("builds Seedance content/messages with image, video, and audio reference roles", () => {
    const plan = buildDirectorMemefastGenerationRequestPlan({
      mediaKind: "video",
      model: "doubao-seedance-2-0-260128",
      prompt: "室内角色对话",
      routeFamily: "volc",
      endpointTypes: ["豆包视频异步"],
      input: {
        firstFrame: "https://cdn.example.test/first.png",
        videoRefs: ["https://cdn.example.test/ref.mp4"],
        audioRefs: ["https://cdn.example.test/ref.mp3"],
        resolution: "1080p",
        aspectRatio: "9:16",
        duration: 8,
        audio: true,
      },
    });

    expect(plan.endpointPath).toBe("/volc/v1/contents/generations/tasks");
    expect(plan.body).toMatchObject({
      model: "doubao-seedance-2-0-260128",
      resolution: "720p",
      ratio: "9:16",
      duration: 8,
      generate_audio: true,
      messages: [{ role: "user", content: expect.any(Array) }],
    });
    expect(plan.warnings.join("\n")).toMatch(/1080p.*720p/u);
    expect(plan.body.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "image_url", role: "first_frame" }),
        expect.objectContaining({ type: "video_url", role: "reference_video" }),
        expect.objectContaining({ type: "audio_url", role: "reference_audio" }),
      ]),
    );
  });

  it("keeps Seedance 2.0 adapter controls aligned with Moyin request planning", () => {
    const official = buildDirectorMemefastGenerationRequestPlan({
      mediaKind: "video",
      model: "doubao-seedance-2-0-fast-260128",
      prompt: "角色从室内走到雨夜街口",
      routeFamily: "volc",
      endpointTypes: ["豆包视频异步"],
      input: {
        seedanceAdapter: "ark-official",
        resolution: "1080p",
        aspectRatio: "9:16",
        duration: 30,
        audio: true,
        serviceTier: "priority",
        draftMode: true,
        enabledTools: ["camera"],
      },
    });
    const shortProxy = buildDirectorMemefastGenerationRequestPlan({
      mediaKind: "video",
      model: "doubao-seedance-1-5-pro-251215",
      prompt: "手持跟拍角色穿过走廊",
      routeFamily: "volc",
      endpointTypes: ["豆包视频异步"],
      input: {
        seedanceParameterStyle: "short",
        resolution: "1080p",
        aspectRatio: "16:9",
        duration: 6,
        cameraFixed: false,
        includeReqId: false,
      },
    });

    expect(official).toMatchObject({
      family: "seedance",
      adapter: "seedance-video",
      endpointPath: "/api/v3/contents/generations/tasks",
      body: {
        model: "doubao-seedance-2-0-fast-260128",
        resolution: "720p",
        ratio: "9:16",
        duration: 15,
        generate_audio: true,
        service_tier: "priority",
        draft: true,
        tools: [{ type: "camera" }],
      },
    });
    expect(official.body).not.toHaveProperty("messages");
    expect(official.body).not.toHaveProperty("req_id");
    expect(official.warnings.join("\n")).toMatch(/1080p.*720p/u);

    expect(shortProxy.body).toMatchObject({
      model: "doubao-seedance-1-5-pro-251215",
      resolution: "1080p",
      ratio: "16:9",
      duration: 6,
      messages: [{ role: "user", content: expect.any(Array) }],
    });
    expect(shortProxy.body).not.toHaveProperty("req_id");
    expect(JSON.stringify(shortProxy.body.content)).toContain("--rs 1080p");
    expect(JSON.stringify(shortProxy.body.content)).toContain("--rt 16:9");
    expect(JSON.stringify(shortProxy.body.content)).toContain("--dur 6");
  });

  it("normalizes Sora official video plans to the multipart-equivalent OpenAI size fields", () => {
    const plan = buildDirectorMemefastGenerationRequestPlan({
      mediaKind: "video",
      model: "sora-2-pro",
      prompt: "晨光城市航拍",
      routeFamily: "openai_official",
      endpointTypes: ["openAI官方视频格式"],
      input: {
        aspectRatio: "9:16",
        resolution: "1080p",
        duration: 12,
        firstFrame: "https://cdn.example.test/first.png",
      },
    });

    expect(plan).toMatchObject({
      family: "sora",
      adapter: "sora-video",
      mediaType: "video",
      operation: "i2v",
      endpointPath: "/v1/videos",
      body: {
        model: "sora-2-pro",
        prompt: "晨光城市航拍",
        size: "1024x1792",
        seconds: "12",
        input_reference: "https://cdn.example.test/first.png",
      },
    });
  });

  it("enforces Veo model-family upload slots before selecting the OpenAI video route", () => {
    expect(() =>
      buildDirectorMemefastGenerationRequestPlan({
        mediaKind: "video",
        model: "veo_3_1-components",
        prompt: "产品旋转镜头",
        routeFamily: "openai_official",
        endpointTypes: ["openAI官方视频格式"],
        input: {
          aspectRatio: "16:9",
          duration: 8,
        },
      }),
    ).toThrow(/requires at least 1 reference image/i);

    const plan = buildDirectorMemefastGenerationRequestPlan({
      mediaKind: "video",
      model: "veo_3_1-fast-components",
      prompt: "多角色同框移动",
      routeFamily: "openai_official",
      endpointTypes: ["openAI官方视频格式"],
      input: {
        aspectRatio: "16:9",
        duration: 8,
        referenceImages: [
          "https://cdn.example.test/a.png",
          "https://cdn.example.test/b.png",
          "https://cdn.example.test/c.png",
          "https://cdn.example.test/d.png",
        ],
      },
    });

    expect(plan).toMatchObject({
      family: "veo",
      adapter: "veo-video",
      mediaType: "video",
      operation: "first_last_frame",
      endpointPath: "/v1/videos",
      body: {
        model: "veo_3_1-fast-components",
        prompt: "多角色同框移动",
        size: "16x9",
        seconds: "8",
        watermark: false,
        input_references: [
          "https://cdn.example.test/a.png",
          "https://cdn.example.test/b.png",
          "https://cdn.example.test/c.png",
        ],
      },
    });
  });

  it("covers Moyin Kling aliases and special endpoint paths", () => {
    const extend = buildDirectorMemefastGenerationRequestPlan({
      mediaKind: "video",
      model: "kling-video-extend",
      prompt: "延长这段镜头",
      routeFamily: "kling",
      endpointTypes: ["视频延长"],
      input: {
        videoRefs: ["https://cdn.example.test/source.mp4"],
        duration: 8,
      },
    });
    const o1 = buildDirectorMemefastGenerationRequestPlan({
      mediaKind: "video",
      model: "kling-o1-video",
      prompt: "多参考人物调度",
      routeFamily: "kling",
      endpointTypes: ["omni-video"],
      input: {
        referenceImages: [
          "https://cdn.example.test/a.png",
          "https://cdn.example.test/b.png",
          "https://cdn.example.test/c.png",
          "https://cdn.example.test/d.png",
          "https://cdn.example.test/e.png",
          "https://cdn.example.test/f.png",
          "https://cdn.example.test/g.png",
          "https://cdn.example.test/h.png",
        ],
      },
    });

    expect(extend).toMatchObject({
      family: "kling",
      endpointPath: "/kling/v1/videos/video-extend",
      body: {
        model_name: "kling-video-extend",
      },
    });
    expect(o1).toMatchObject({
      family: "kling",
      endpointPath: "/kling/v1/videos/omni-video",
      body: {
        model_name: "kling-video-o1",
        image_list: expect.arrayContaining([
          { image_url: "https://cdn.example.test/a.png" },
          { image_url: "https://cdn.example.test/g.png" },
        ]),
      },
    });
    expect(JSON.stringify(o1.body)).not.toContain("https://cdn.example.test/h.png");
  });

  it("enforces Wan single first-frame i2v and rejects unsupported inputs before submit", () => {
    expect(() =>
      buildDirectorMemefastGenerationRequestPlan({
        mediaKind: "video",
        model: "wan2.6-i2v",
        prompt: "角色转身",
        routeFamily: "wan",
        endpointTypes: ["异步"],
        input: {},
      }),
    ).toThrow(/requires one first-frame image/u);

    const plan = buildDirectorMemefastGenerationRequestPlan({
      mediaKind: "video",
      model: "wan2.6-i2v-flash",
      prompt: "角色转身",
      routeFamily: "wan",
      endpointTypes: ["异步"],
      input: {
        firstFrame: "https://cdn.example.test/first.png",
        resolution: "480p",
        audio: false,
      },
    });

    expect(plan).toMatchObject({
      family: "wan",
      operation: "i2v",
      endpointPath: "/alibailian/api/v1/services/aigc/video-generation/video-synthesis",
      body: {
        model: "wan2.6-i2v-flash",
        input: {
          prompt: "角色转身",
          img_url: "https://cdn.example.test/first.png",
        },
        parameters: {
          resolution: "480P",
          prompt_extend: true,
          audio: false,
        },
      },
    });
  });

  it("keeps Runway image-to-video strict and maps aspect ratio to pixel ratio", () => {
    expect(() =>
      buildDirectorMemefastGenerationRequestPlan({
        mediaKind: "video",
        model: "runway-gen4-turbo",
        prompt: "车窗外城市延时",
        endpointTypes: ["runway图生视频"],
        input: {},
      }),
    ).toThrow(/requires a first-frame image/u);

    const plan = buildDirectorMemefastGenerationRequestPlan({
      mediaKind: "video",
      model: "runway-gen4-turbo",
      prompt: "车窗外城市延时",
      endpointTypes: ["runway图生视频"],
      input: {
        firstFrame: "https://cdn.example.test/first.png",
        aspectRatio: "16:9",
        duration: 10,
      },
    });

    expect(plan).toMatchObject({
      family: "runway",
      endpointPath: "/runwayml/v1/image_to_video",
      body: {
        promptImage: "https://cdn.example.test/first.png",
        ratio: "1280:720",
        promptText: "车窗外城市延时",
        duration: 10,
      },
    });
  });

  it("keeps the full Moyin Runway aspect-ratio map", () => {
    const plan = buildDirectorMemefastGenerationRequestPlan({
      mediaKind: "video",
      model: "runway-gen3a-turbo",
      prompt: "四比三广告镜头",
      endpointTypes: ["runway图生视频"],
      input: {
        firstFrame: "https://cdn.example.test/first.png",
        aspectRatio: "4:3",
      },
    });

    expect(plan.body).toMatchObject({
      model: "gen3a_turbo",
      ratio: "960:720",
      duration: 5,
    });
  });

  it("selects Vidu start-end endpoint from endpoint metadata and frame roles", () => {
    const plan = buildDirectorMemefastGenerationRequestPlan({
      mediaKind: "video",
      model: "viduq3-turbo",
      prompt: "从白天过渡到夜晚",
      endpointTypes: ["vidu首尾帧"],
      input: {
        imageWithRoles: [
          { role: "first_frame", url: "https://cdn.example.test/day.png" },
          { role: "last_frame", url: "https://cdn.example.test/night.png" },
        ],
        duration: 4,
        resolution: "720p",
      },
    });

    expect(plan).toMatchObject({
      family: "vidu",
      operation: "first_last_frame",
      endpointPath: "/ent/v2/start-end2video",
      body: {
        model: "viduq3-turbo",
        prompt: "从白天过渡到夜晚",
        images: ["https://cdn.example.test/day.png", "https://cdn.example.test/night.png"],
      },
    });
  });

  it("allows PixVerse request planning to reserve upload placeholders before submit", () => {
    const plan = buildDirectorMemefastGenerationRequestPlan({
      mediaKind: "video",
      model: "pixverse-v5.5-t2v",
      prompt: "让角色缓慢转身",
      endpointTypes: ["pixverse视频"],
      input: {
        operation: "i2v",
        firstFrame: "https://cdn.example.test/first.png",
        duration: 9,
        resolution: "1080p",
      },
    });

    expect(plan).toMatchObject({
      family: "pixverse",
      adapter: "pixverse-video",
      operation: "i2v",
      endpointPath: "/openapi/v2/video/img/generate",
      body: {
        model: "v5.5",
        duration: 8,
        img_id: "__PIXVERSE_UPLOAD:first_frame__",
        motion_mode: "normal",
      },
    });
  });

  it("fails PixVerse explicit image-to-video planning when no image input is present", () => {
    expect(() =>
      buildDirectorMemefastGenerationRequestPlan({
        mediaKind: "video",
        model: "pixverse-v5.5-t2v",
        prompt: "让角色缓慢转身",
        endpointTypes: ["pixverse视频"],
        input: {
          operation: "i2v",
          duration: 9,
          resolution: "1080p",
        },
      }),
    ).toThrow(/requires an uploaded PixVerse image id/u);
  });

  it("keeps qwen-image-edit-2509 on the OpenAI-compatible edit route", () => {
    expect(() =>
      buildDirectorMemefastGenerationRequestPlan({
        mediaKind: "image",
        model: "qwen-image-edit-2509",
        prompt: "补一盏窗边暖光",
        input: {},
      }),
    ).toThrow(/requires one reference image/u);

    const plan = buildDirectorMemefastGenerationRequestPlan({
      mediaKind: "image",
      model: "qwen-image-edit-2509",
      prompt: "补一盏窗边暖光",
      input: {
        referenceImages: ["https://cdn.example.test/source.png"],
        aspectRatio: "16:9",
      },
    });

    expect(plan).toMatchObject({
      family: "qwen_image",
      adapter: "qwen-image-edit-2509-image",
      mediaType: "image",
      operation: "edit_image",
      endpointPath: "/v1/images/generations",
      body: {
        model: "qwen-image-edit-2509",
        prompt: "补一盏窗边暖光",
        image: "https://cdn.example.test/source.png",
        size: "1280*720",
      },
    });
    expect(plan.body).not.toHaveProperty("model_name");
    expect(plan.body).not.toHaveProperty("file_infos");
  });

  it("keeps dedicated image family adapters for Ideogram and Replicate-style models", () => {
    const ideogram = buildDirectorMemefastGenerationRequestPlan({
      mediaKind: "image",
      model: "ideogram_generate_V_3_QUALITY",
      prompt: "复古片名字体海报",
      input: {
        aspectRatio: "16:9",
        renderSpeed: "Quality",
        style: "Design",
        n: 2,
      },
    });
    const recraft = buildDirectorMemefastGenerationRequestPlan({
      mediaKind: "image",
      model: "recraft-ai/recraft-v3",
      prompt: "极简 logo",
      input: { aspectRatio: "1:1", style: "vector_illustration" },
    });
    const sdxl = buildDirectorMemefastGenerationRequestPlan({
      mediaKind: "image",
      model: "stability-ai/sdxl",
      prompt: "雪山日出",
      input: { aspectRatio: "16:9", negativePrompt: "low quality" },
    });

    expect(ideogram).toMatchObject({
      family: "ideogram",
      adapter: "ideogram-image",
      endpointPath: "/ideogram/v1/ideogram-v3/generate",
      body: {
        model: "ideogram_generate_V_3_QUALITY",
        prompt: "复古片名字体海报",
        aspect_ratio: "ASPECT_16_9",
        rendering_speed: "QUALITY",
        style_type: "DESIGN",
        num_images: 2,
      },
    });
    expect(recraft).toMatchObject({
      family: "recraft",
      adapter: "replicate-recraft-image",
      endpointPath: "/replicate/v1/models/recraft-ai/recraft-v3/predictions",
      body: {
        input: {
          prompt: "极简 logo",
          size: "1024x1024",
          style: "vector_illustration",
        },
      },
    });
    expect(sdxl).toMatchObject({
      family: "sdxl",
      adapter: "replicate-sdxl-image",
      endpointPath: "/replicate/v1/predictions",
      body: {
        model: "stability-ai/sdxl",
        input: expect.objectContaining({
          prompt: "雪山日出",
          negative_prompt: "low quality",
        }),
      },
    });
  });

  it("uses the dedicated GPT Image 2 adapter for generation and reference editing", () => {
    const generation = buildDirectorMemefastGenerationRequestPlan({
      mediaKind: "image",
      model: "gpt-image-2",
      prompt: "电影海报主视觉",
      input: {
        aspectRatio: "16:9",
        resolution: "4K",
        negativePrompt: "low detail",
        outputFormat: "webp",
      },
    });
    const edit = buildDirectorMemefastGenerationRequestPlan({
      mediaKind: "image",
      model: "gpt-image-2-all",
      prompt: "把海报改成雨夜霓虹",
      input: {
        aspectRatio: "16:9",
        referenceImages: ["https://cdn.example.test/source.png"],
      },
    });

    expect(generation).toMatchObject({
      family: "gpt_image",
      adapter: "gpt-image-2-image",
      operation: "t2i",
      endpointPath: "/v1/images/generations",
      body: {
        model: "gpt-image-2",
        n: 1,
        size: "3840x2160",
        quality: "high",
        output_format: "webp",
      },
    });
    expect(String(generation.body.prompt)).toContain("Negative constraints: low detail");
    expect(edit).toMatchObject({
      family: "gpt_image",
      adapter: "gpt-image-2-image",
      operation: "i2i",
      endpointPath: "/v1/images/edits",
      body: {
        model: "gpt-image-2-all",
        prompt: "把海报改成雨夜霓虹",
        n: 1,
        size: "1536x1024",
        images: [{ image_url: "https://cdn.example.test/source.png" }],
      },
    });
    expect(edit.body).not.toHaveProperty("image_urls");
  });

  it("keeps DALL-E-compatible image models in the DALL-E family adapter", () => {
    const qwen = buildDirectorMemefastGenerationRequestPlan({
      mediaKind: "image",
      model: "qwen-image-max",
      prompt: "高端汽车广告",
      input: {
        aspectRatio: "16:9",
        n: 5,
        quality: "hd",
        style: "vivid",
        response_format: "url",
        watermark: false,
        prompt_extend: true,
        negativePrompt: "do not send this as a field",
      },
    });
    const grokImagine = buildDirectorMemefastGenerationRequestPlan({
      mediaKind: "image",
      model: "grok-imagine-image",
      prompt: "竖版赛博朋克肖像",
      input: { aspectRatio: "9:16" },
    });

    expect(qwen).toMatchObject({
      family: "dalle_image",
      adapter: "dalle-image",
      operation: "t2i",
      endpointPath: "/v1/images/generations",
      body: {
        model: "qwen-image-max",
        prompt: "高端汽车广告",
        n: 1,
        size: "1792x1024",
        quality: "hd",
        style: "vivid",
        response_format: "url",
        watermark: false,
        prompt_extend: true,
      },
    });
    expect(qwen.body).not.toHaveProperty("aspect_ratio");
    expect(qwen.body).not.toHaveProperty("negative_prompt");
    expect(grokImagine).toMatchObject({
      family: "dalle_image",
      adapter: "dalle-image",
      endpointPath: "/v1/images/generations",
      body: { size: "1024x1792" },
    });
  });

  it("splits Flux image families into Fal, Fal Kontext, and Replicate Kontext adapters", () => {
    const falText = buildDirectorMemefastGenerationRequestPlan({
      mediaKind: "image",
      model: "fal-ai/flux-1/dev",
      prompt: "电影感山谷",
      input: { aspectRatio: "16:9", output_format: "png" },
    });
    const falI2i = buildDirectorMemefastGenerationRequestPlan({
      mediaKind: "image",
      model: "fal-ai/flux-1/dev/image-to-image",
      prompt: "维持构图但换成黄昏",
      input: {
        aspectRatio: "4:3",
        referenceImages: ["https://cdn.example.test/ref.png"],
        strength: 0.7,
      },
    });
    const falKontext = buildDirectorMemefastGenerationRequestPlan({
      mediaKind: "image",
      model: "fal-ai/flux-pro/kontext/max/multi",
      prompt: "合成两张角色设定",
      input: {
        referenceImages: ["https://cdn.example.test/a.png", "https://cdn.example.test/b.png"],
      },
    });
    const replicateKontext = buildDirectorMemefastGenerationRequestPlan({
      mediaKind: "image",
      model: "black-forest-labs/flux-kontext-pro",
      prompt: "替换背景",
      input: {
        referenceImages: ["https://cdn.example.test/source.png"],
      },
    });

    expect(falText).toMatchObject({
      family: "flux",
      adapter: "fal-flux-image",
      operation: "t2i",
      endpointPath: "/fal-ai/flux-1/dev",
      body: {
        prompt: "电影感山谷",
        image_size: "landscape_16_9",
        output_format: "png",
      },
    });
    expect(falI2i).toMatchObject({
      family: "flux_reference",
      adapter: "fal-flux-image",
      operation: "i2i",
      endpointPath: "/fal-ai/flux-1/dev/image-to-image",
      body: {
        prompt: "维持构图但换成黄昏",
        image_url: "https://cdn.example.test/ref.png",
        strength: 0.7,
      },
    });
    expect(falKontext).toMatchObject({
      family: "flux_reference",
      adapter: "flux-kontext-image",
      operation: "i2i",
      endpointPath: "/fal-ai/flux-pro/kontext/max/multi",
      body: {
        image_urls: ["https://cdn.example.test/a.png", "https://cdn.example.test/b.png"],
      },
    });
    expect(replicateKontext).toMatchObject({
      family: "flux_reference",
      adapter: "replicate-flux-kontext-image",
      operation: "i2i",
      endpointPath: "/replicate/v1/models/black-forest-labs/flux-kontext-pro/predictions",
      body: {
        input: {
          prompt: "替换背景",
          aspect_ratio: "match_input_image",
          input_image: "https://cdn.example.test/source.png",
        },
      },
    });
  });

  it("routes Fal Nano Banana image models through the Fal Gemini image adapter", () => {
    const plan = buildDirectorMemefastGenerationRequestPlan({
      mediaKind: "image",
      model: "fal-ai/nano-banana/edit",
      prompt: "让角色换上红色外套",
      input: {
        aspectRatio: "1:1",
        resolution: "2K",
        referenceImages: ["https://cdn.example.test/role.png"],
      },
    });

    expect(plan).toMatchObject({
      family: "gemini_image",
      adapter: "gemini-fal-image",
      operation: "i2i",
      endpointPath: "/fal-ai/nano-banana/edit",
      body: {
        model: "fal-ai/nano-banana/edit",
        input: {
          prompt: "让角色换上红色外套",
          image_urls: ["https://cdn.example.test/role.png"],
          aspect_ratio: "1:1",
          resolution: "2K",
        },
      },
    });
  });

  it("keeps Grok video on its dedicated family adapter instead of the generic unified adapter", () => {
    const plan = buildDirectorMemefastGenerationRequestPlan({
      mediaKind: "video",
      model: "grok-video-3-15s",
      prompt: "街头追车低机位",
      endpointTypes: ["grok视频"],
      input: {
        aspectRatio: "9:16",
        resolution: "1080p",
        referenceImages: ["https://cdn.example.test/first.png"],
        videoRefs: ["https://cdn.example.test/ignored.mp4"],
        audio: true,
      },
    });

    expect(plan).toMatchObject({
      family: "grok",
      adapter: "grok-video",
      mediaType: "video",
      operation: "i2v",
      endpointPath: "/v1/video/create",
      body: {
        model: "grok-video-3-15s",
        prompt: "街头追车低机位",
        aspect_ratio: "2:3",
        size: "720P",
        images: ["https://cdn.example.test/first.png"],
      },
    });
    expect(plan.body).not.toHaveProperty("duration");
    expect(plan.warnings.join("\n")).toMatch(/audio generation toggles/u);
  });

  it("keeps Omni Flash video on its dedicated multi-reference adapter", () => {
    const plan = buildDirectorMemefastGenerationRequestPlan({
      mediaKind: "video",
      model: "omni-flash-components",
      prompt: "四个角色同框运动",
      input: {
        aspectRatio: "16:9",
        duration: 5,
        referenceImages: [
          "https://cdn.example.test/a.png",
          "https://cdn.example.test/b.png",
          "https://cdn.example.test/c.png",
          "https://cdn.example.test/d.png",
          "https://cdn.example.test/e.png",
        ],
      },
    });

    expect(plan).toMatchObject({
      family: "omni_flash",
      adapter: "omni-flash-video",
      mediaType: "video",
      operation: "r2v",
      endpointPath: "/v1/video/create",
      body: {
        model: "omni-flash-components",
        prompt: "四个角色同框运动",
        aspect_ratio: "3:2",
        size: "720P",
        duration: 5,
        images: [
          "https://cdn.example.test/a.png",
          "https://cdn.example.test/b.png",
          "https://cdn.example.test/c.png",
          "https://cdn.example.test/d.png",
        ],
      },
    });
    expect(plan.warnings.join("\n")).toMatch(/only forwards 4 reference image/u);
  });

  it("preserves image parts when adapting vision LLM calls to Anthropic and Gemini", () => {
    const anthropic = buildDirectorMemefastGenerationRequestPlan({
      mediaKind: "text",
      model: "claude-haiku-4-5-20251001",
      prompt: "描述图片",
      input: {
        llmAdapter: "anthropic_messages",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "描述图片" },
              { type: "image_url", image_url: { url: "https://cdn.example.test/frame.jpg" } },
            ],
          },
        ],
      },
    });
    const gemini = buildDirectorMemefastGenerationRequestPlan({
      mediaKind: "text",
      model: "gemini-3-pro-preview",
      prompt: "描述图片",
      input: {
        llmAdapter: "gemini_generate_content",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "描述图片" },
              { type: "image_url", image_url: { url: "https://cdn.example.test/frame.jpg" } },
            ],
          },
        ],
      },
    });

    expect(anthropic.body).toMatchObject({
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "描述图片" },
            {
              type: "image",
              source: {
                type: "url",
                url: "https://cdn.example.test/frame.jpg",
              },
            },
          ],
        },
      ],
    });
    expect(gemini.body).toMatchObject({
      contents: [
        {
          role: "user",
          parts: [
            { text: "描述图片" },
            {
              file_data: {
                mime_type: "image/jpeg",
                file_uri: "https://cdn.example.test/frame.jpg",
              },
            },
          ],
        },
      ],
    });
  });

  it("builds PixVerse text-to-video with the native OpenAPI endpoint", () => {
    const plan = buildDirectorMemefastGenerationRequestPlan({
      mediaKind: "video",
      model: "pixverse-v5.5-t2v",
      prompt: "霓虹雨夜的跟拍镜头",
      routeFamily: "pixverse",
      endpointTypes: ["pixverse视频"],
      input: {
        aspectRatio: "16:9",
        duration: 8,
        resolution: "1080p",
        audio: true,
      },
    });

    expect(plan).toMatchObject({
      family: "pixverse",
      adapter: "pixverse-video",
      mediaType: "video",
      operation: "t2v",
      endpointPath: "/openapi/v2/video/text/generate",
      body: {
        prompt: "霓虹雨夜的跟拍镜头",
        model: "v5.5",
        duration: 8,
        quality: "1080p",
        generate_audio_switch: true,
        aspect_ratio: "16:9",
      },
    });
  });

  it("isolates Suno music and lyrics from image/video payload fields", () => {
    const music = buildDirectorMemefastGenerationRequestPlan({
      mediaKind: "audio",
      model: "suno_music",
      prompt: "A cinematic synthwave cue",
      input: {
        mv: "chirp-v4",
        title: "Night Ride",
        tags: "synthwave, cinematic",
        makeInstrumental: false,
        taskId: "task-parent",
        continueAt: 53,
        continueClipId: "clip-parent",
        notifyHook: "https://hook.example.test/suno",
      },
    });
    const lyrics = buildDirectorMemefastGenerationRequestPlan({
      mediaKind: "audio",
      model: "suno_lyrics",
      prompt: "dance pop about sunrise",
      input: {},
    });

    expect(music).toMatchObject({
      family: "suno",
      adapter: "suno-music",
      mediaType: "audio",
      operation: "music",
      endpointPath: "/suno/submit/music",
      body: {
        gpt_description_prompt: "A cinematic synthwave cue",
        mv: "chirp-v4",
        title: "Night Ride",
        tags: "synthwave, cinematic",
        make_instrumental: false,
        task_id: "task-parent",
        continue_at: 53,
        continue_clip_id: "clip-parent",
        notify_hook: "https://hook.example.test/suno",
      },
    });
    expect(music.body).not.toHaveProperty("model");
    expect(music.body).not.toHaveProperty("image");

    expect(lyrics).toMatchObject({
      family: "suno",
      adapter: "suno-lyrics",
      mediaType: "audio",
      operation: "lyrics",
      endpointPath: "/suno/submit/lyrics",
      body: { prompt: "dance pop about sunrise" },
    });
  });
});
