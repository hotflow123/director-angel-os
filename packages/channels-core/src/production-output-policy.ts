export type ProductionResultSurface = "desktop" | "weixin";

export function createProductionResultSystemPrompt(surface: ProductionResultSurface): string {
  const surfaceLabel = surface === "weixin" ? "微信" : "桌面端";
  return [
    `你是 Director Angel 的${surfaceLabel}制作助手。用户只要结果，不要过程。`,
    "基于用户目标、已发布经验、已批准 Skill、内部状态和安全边界，直接输出最终可用的中文制作内容。",
    "不要寒暄，不要说“我理解了”，不要称呼 Director Angel，不要解释系统怎么运行，不要写“可继续修改方向”。",
    "不要暴露 Director run、蓝图 ID、assignment、worker、自动批准、本地预览、模型供应方、API Key 等内部词。",
    "不要声称已经调用第三方制作平台；如果资料不足，也不要解释系统原因，直接按通用导演经验给结果。",
    "不要输出“待审查项”“系统审查状态”“下一步”“经验/Skill调用”等过程章节。",
    "默认控制在 600-1000 个汉字；用户明确要求详细时才加长。",
    "如果用户要 15 秒分镜，直接给 3-5 个镜头；如果用户要故事或脚本，直接给片名、梗概和正文/分场。",
  ].join("\n");
}

export function humanizeProductionResultText(value: string): string {
  const sectionStripped = stripProductionProcessSections(value)
    .split(/\n\s*(?:\*\*)?可继续修改方向(?:\*\*)?\s*[:：]?\s*\n/u)[0]
    ?.split(/\n\s*Director Angel\s*看完/u)[0]
    ?.trim();
  const visibleLines = String(sectionStripped ?? "")
    .split(/\r?\n/u)
    .map((line) => cleanProductionResultLine(line))
    .filter((line) => shouldKeepProductionResultLine(line))
    .join("\n");
  return visibleLines
    .replace(/\s+needs operator review before execution handoff\.?/giu, "")
    .replace(/无经验\s*\/\s*无\s*Skill/giu, "先按通用导演经验")
    .replace(/知识召回状态\s*[:：]\s*miss/giu, "经验库暂未命中特定资料")
    .replace(/Skill\s*状态\s*[:：]\s*miss/giu, "Skill 暂未命中特定模板")
    .trim();
}

function stripProductionProcessSections(value: string): string {
  const lines = String(value).trim().split(/\r?\n/u);
  const cutIndex = lines.findIndex((line) =>
    /^\s*(#{1,6}\s*)?(\*\*)?\s*(待审查项|系统审查状态|经验\s*\/\s*Skill\s*调用|经验调用|Skill调用|下一步)\s*(\*\*)?\s*[:：]?\s*$/iu.test(
      line,
    ),
  );
  return (cutIndex === -1 ? lines : lines.slice(0, cutIndex)).join("\n").trim();
}

function cleanProductionResultLine(value: string): string {
  return value
    .replace(
      /^(?:好的|收到|明白)?\s*(?:Director Angel|Angel|导演 Angel)?[！!，,\s]*(?:我理解(?:了|的是)[：:，,。]?\s*)/iu,
      "",
    )
    .replace(
      /^(?:先给一版(?:制作草案|制作结果|草案|初稿)?(?:，?\s*您可以直接参考)?|您可以直接参考|你可以继续直接发)[:：，,。]?\s*/u,
      "",
    )
    .trimEnd();
}

function shouldKeepProductionResultLine(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return true;
  }
  if (
    /^(?:Run|RunID|蓝图ID|自动批准|已推进|已批准待审环节|执行结果|模型草案|模型草案未生成|待审查项|系统审查状态|执行意图|安全边界)\s*[:：]/iu.test(
      trimmed,
    )
  ) {
    return false;
  }
  if (/^蓝图\s*[:：]\s*blueprint/iu.test(trimmed)) {
    return false;
  }
  if (
    /\b(?:assignment-[\w-]+|preview-only|worker|operator review before execution handoff)\b/iu.test(
      trimmed,
    )
  ) {
    return false;
  }
  if (/API\s*Key/iu.test(trimmed)) {
    return false;
  }
  if (/^(?:好的|收到|明白)[，,\s]*(?:Director Angel|Angel|导演 Angel)?[！!。]?$/iu.test(trimmed)) {
    return false;
  }
  if (/^(?:我理解(?:了|的是)|先给一版|您可以直接参考|你可以继续直接发)[:：，,。]/u.test(trimmed)) {
    return false;
  }
  if (/^\/(?:制作|生产|创建|生成)\s+/u.test(trimmed)) {
    return false;
  }
  if (
    /^(?:生成|制作|写|做)(?!判断\s*[:：]).*(?:分镜蓝图|短剧|视频|脚本|故事板|旅游记|旅行记)/u.test(
      trimmed,
    )
  ) {
    return false;
  }
  if (/^(?:补充内容|执行意图|安全边界)\s*[:：]/u.test(trimmed)) {
    return false;
  }
  if (/^-{3,}$/u.test(trimmed)) {
    return false;
  }
  return true;
}
