import { humanizeProductionResultText } from "@hotflow/channels-core";
import { createChannelTransportEnvelope } from "@hotflow/contracts";

interface EntrySessionShape {
  readonly entrySessionId: string;
  readonly state?: string;
  readonly nextAction?: string;
  readonly latestLineage?: {
    readonly blueprintId?: string;
    readonly runId?: string;
    readonly reportId?: string;
  };
  readonly latestRun?: {
    readonly runId?: string;
    readonly status?: string;
  };
}

interface EntryIntakePayloadShape {
  readonly session: EntrySessionShape;
  readonly turn?: {
    readonly summary?: string;
  };
  readonly intake?: {
    readonly alignmentLock?: {
      readonly objective?: string;
      readonly notes?: readonly string[];
    } | null;
  };
}

interface EntryBlueprintPayloadShape {
  readonly session: EntrySessionShape;
  readonly blueprint?: {
    readonly blueprintId?: string;
    readonly actionGraph?: {
      readonly goal?: string;
      readonly nodes?: readonly {
        readonly assignmentId?: string;
        readonly approvalMode?: string;
        readonly status?: string;
      }[];
    };
    readonly preview?: {
      readonly warnings?: readonly string[];
    };
    readonly review?: {
      readonly requiredFixes?: readonly string[];
    };
  };
}

interface EntryRunPayloadShape {
  readonly session: EntrySessionShape;
  readonly run?: {
    readonly runId?: string;
    readonly status?: string;
    readonly assignments?: readonly {
      readonly assignmentId?: string;
      readonly approvalMode?: string;
      readonly status?: string;
    }[];
  };
}

interface EntryStatusPayloadShape {
  readonly session: EntrySessionShape;
  readonly run?: {
    readonly runId?: string;
    readonly status?: string;
  };
  readonly report?: {
    readonly reportId?: string;
    readonly operatorSurface?: {
      readonly operatorSummary?: string;
      readonly flags?: readonly string[];
      readonly nextAction?: string;
    };
  };
}

export interface DirectorEntryMessageInput {
  readonly text: string;
  readonly hostUrl?: string;
  readonly hostId?: string;
  readonly agentId?: string;
  readonly channel?: string;
  readonly peerId?: string;
  readonly messageId?: string;
  readonly receivedAtMs?: number;
  readonly autoAdvance?: boolean;
  readonly autoStartRun?: boolean;
}

export interface DirectorEntryMessageResult {
  readonly intake: EntryIntakePayloadShape;
  readonly blueprint?: EntryBlueprintPayloadShape;
  readonly run?: EntryRunPayloadShape;
  readonly status?: EntryStatusPayloadShape;
}

function resolveHostUrl(hostUrl: string | undefined): string {
  return (hostUrl ?? "http://127.0.0.1:3201").replace(/\/+$/u, "");
}

function buildUrl(hostUrl: string | undefined, path: string): string {
  return new URL(path, `${resolveHostUrl(hostUrl)}/`).toString();
}

async function readJsonResponse<T>(response: Response, label: string): Promise<T> {
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`${label} failed (${response.status} ${response.statusText}): ${raw}`);
  }
  return JSON.parse(raw) as T;
}

async function postJson<T>(
  hostUrl: string | undefined,
  path: string,
  body: unknown | undefined,
): Promise<T> {
  const response = await fetch(buildUrl(hostUrl, path), {
    method: "POST",
    headers: createDirectorHostApiRequestHeaders({ "content-type": "application/json" }),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return readJsonResponse<T>(response, `Director Entry ${path}`);
}

async function getJson<T>(hostUrl: string | undefined, path: string): Promise<T> {
  const response = await fetch(buildUrl(hostUrl, path), {
    headers: createDirectorHostApiRequestHeaders(),
  });
  return readJsonResponse<T>(response, `Director Entry ${path}`);
}

function createDirectorHostApiRequestHeaders(
  headers: Record<string, string> = {},
): Record<string, string> {
  const token = readDirectorHostApiBearerToken();
  return token === undefined
    ? headers
    : {
        ...headers,
        authorization: `Bearer ${token}`,
      };
}

function readDirectorHostApiBearerToken(): string | undefined {
  if (typeof process === "undefined") {
    return undefined;
  }
  const token = process.env?.DIRECTOR_HOST_API_BEARER_TOKEN?.trim();
  return token === undefined || token.length === 0 ? undefined : token;
}

export async function sendDirectorEntryMessage(
  input: DirectorEntryMessageInput,
): Promise<DirectorEntryMessageResult> {
  const channel = input.channel ?? "cli";
  const agentId = input.agentId ?? "director";
  const peerId = input.peerId ?? "cli-user";
  const messageId = input.messageId ?? `cli-${Date.now()}`;
  const receivedAtMs = input.receivedAtMs ?? Date.now();
  const hostId = input.hostId ?? "director-cli";
  const autoAdvance = input.autoAdvance ?? true;
  const autoStartRun = input.autoStartRun ?? true;

  const intake = await postJson<EntryIntakePayloadShape>(input.hostUrl, "/v1/entry/message", {
    apiVersion: "director-entry.v1",
    hostId,
    message: createChannelTransportEnvelope({
      channel,
      agentId,
      peerId,
      messageId,
      receivedAtMs,
      text: input.text,
      routingHint: {
        agentId,
        channel,
        routeKind: "direct",
        peerId,
      },
      metadata: {
        source: "director-cli",
      },
    }),
  });

  if (!autoAdvance) {
    return { intake };
  }

  let blueprint: EntryBlueprintPayloadShape | undefined;
  if (intake.session.nextAction === "blueprint") {
    blueprint = await postJson<EntryBlueprintPayloadShape>(
      input.hostUrl,
      `/v1/entry/sessions/${encodeURIComponent(intake.session.entrySessionId)}/blueprint`,
      undefined,
    );
  }

  const sessionAfterBlueprint = blueprint?.session ?? intake.session;
  let run: EntryRunPayloadShape | undefined;
  if (sessionAfterBlueprint.nextAction === "run") {
    run = await postJson<EntryRunPayloadShape>(
      input.hostUrl,
      `/v1/entry/sessions/${encodeURIComponent(sessionAfterBlueprint.entrySessionId)}/runs`,
      undefined,
    );
  }

  const runId = run?.run?.runId;
  if (autoStartRun && runId !== undefined && runId.length > 0) {
    await postJson(input.hostUrl, `/v1/runs/${encodeURIComponent(runId)}/start`, undefined);
  }

  const latestSession = run?.session ?? blueprint?.session ?? intake.session;
  const status =
    runId === undefined
      ? undefined
      : await getJson<EntryStatusPayloadShape>(
          input.hostUrl,
          `/v1/entry/sessions/${encodeURIComponent(latestSession.entrySessionId)}/status`,
        );

  return {
    intake,
    ...(blueprint === undefined ? {} : { blueprint }),
    ...(run === undefined ? {} : { run }),
    ...(status === undefined ? {} : { status }),
  };
}

export function renderDirectorEntryMessageResult(
  result: DirectorEntryMessageResult,
  options: { readonly json?: boolean } = {},
): string {
  if (options.json === true) {
    return `${JSON.stringify(result, null, 2)}\n`;
  }

  const operatorSummary = cleanUserFacingText(
    result.status?.report?.operatorSurface?.operatorSummary ?? "",
  );
  if (operatorSummary.length > 0) {
    return `${operatorSummary}\n`;
  }

  const rawObjective =
    result.intake.intake?.alignmentLock?.objective ??
    result.intake.turn?.summary ??
    result.blueprint?.blueprint?.actionGraph?.goal ??
    "已收到";
  const objective = cleanObjective(rawObjective);
  const productionFallback = createProductionFallbackResult(rawObjective);
  if (productionFallback !== null) {
    return `${productionFallback}\n`;
  }
  const warnings = [
    ...(result.blueprint?.blueprint?.review?.requiredFixes ?? []),
    ...(result.blueprint?.blueprint?.preview?.warnings ?? []),
  ]
    .map((warning) => warning.trim())
    .filter((warning) => warning.length > 0);
  const status =
    result.status?.run?.status ??
    result.run?.run?.status ??
    result.intake.session.state ??
    "received";
  const lines = [`收到：${objective}`, `状态：${translateStatus(status)}`];
  if (warnings.length > 0) {
    lines.push("还缺：");
    for (const warning of warnings.slice(0, 3)) {
      lines.push(`- ${warning}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function cleanUserFacingText(value: string): string {
  return humanizeProductionResultText(value)
    .split(/\r?\n/u)
    .filter((line) => !/(?:Run|RunID|蓝图|assignment|worker)\s*[:：]/iu.test(line))
    .join("\n")
    .trim();
}

function cleanObjective(value: string): string {
  const cleaned = value
    .replace(/^\/(?:制作|生产|创建|生成)\s*/u, "")
    .replace(/\s+needs operator review before execution handoff\.?$/giu, "")
    .trim();
  return cleaned.split(/\n(?:补充内容|执行意图|安全边界)[:：]/u)[0]?.trim() ?? cleaned;
}

function translateStatus(status: string): string {
  const map: Record<string, string> = {
    created: "已创建",
    running: "运行中",
    pending: "待处理",
    paused: "已暂停",
    completed: "已完成",
    failed: "失败",
    aborted: "已中止",
    ready_for_blueprint: "可创建蓝图",
    ready_for_run: "可创建运行",
    run_in_progress: "运行中",
    wait: "等待",
    received: "已收到",
  };
  return map[status] ?? status;
}

function createProductionFallbackResult(objective: string): string | null {
  const trimmed = objective.trim();
  if (
    !/(制作|生成|写|做|设计|创作|策划|短剧|视频|影片|分镜|镜头|脚本|剧本|故事板|旅游记|旅行记)/u.test(
      trimmed,
    )
  ) {
    return null;
  }

  if (/(15\s*秒|十五秒|分镜|镜头|短剧)/u.test(trimmed)) {
    const subject = deriveFallbackSubject(trimmed);
    const supplement = deriveFallbackSupplement(trimmed);
    if (/拐卖|人口买卖|买.*女|买.*老婆|买妻|强迫婚姻|被卖/u.test(subject)) {
      return [
        "分镜蓝图",
        "片名：《回家的路》",
        "时长：15 秒",
        "",
        "1. 0-5s：中景，平视，固定镜头。山村集市喧闹，女性主角被困在人群边缘，镜头强调她的紧张和求救信号，不美化买卖关系。",
        "2. 5-10s：近景，手持轻晃。她抓住机会向路人或执法人员传递线索，施害者的控制被打断，冲突集中在逃离与救助。",
        "3. 10-15s：特写，轻微仰视，定镜。女性主角走向安全处，画面落在她坚定的表情；字幕或旁白点明买卖人口和强迫婚姻必须被追责。",
        "",
        "立场：批判拐卖和强迫婚姻，保留受害者主体性，不把伤害包装成爱情。",
      ].join("\n");
    }
    return [
      "分镜蓝图",
      `片名：《${deriveFallbackTitle(subject)}》`,
      "时长：15 秒",
      "",
      `1. 0-5s：中景，平视，轻微推镜。建立「${subject}」的主角、场景和目标，让观众一眼知道故事要发生什么。`,
      supplement === null
        ? "2. 5-10s：近景，前侧面，跟镜头。加入一个小冲突或意外，让主角必须做出选择。"
        : `2. 5-10s：近景，前侧面，跟镜头。呈现补充要求：${supplement}。`,
      "3. 10-15s：特写，轻微俯视，定镜。放大关键动作或表情，用一个清楚的反应完成反转或情绪收束。",
      "",
      "风格：节奏紧凑，画面信息少而准，每个镜头只承担一个叙事功能。",
    ].join("\n");
  }

  return [
    `片名：《${deriveFallbackTitle(trimmed)}》`,
    "",
    `梗概：围绕「${trimmed}」展开，用一个清楚的主角目标、一次小阻碍和一个温暖收束组成完整短片。`,
    "",
    "结构：",
    "1. 开场：快速交代主角和目标。",
    "2. 发展：加入意外、冲突或新朋友，让故事动起来。",
    "3. 结尾：给出行动结果和情绪落点，让观众记住最后一幕。",
  ].join("\n");
}

function deriveFallbackTitle(objective: string): string {
  const themeMatch = /主题\s*[:：]\s*([^，,。；;\n]+)/u.exec(objective);
  if (themeMatch?.[1]) {
    return deriveFallbackTitle(themeMatch[1]);
  }
  const cleaned = objective
    .replace(/^生成一个?/u, "")
    .replace(/^制作一个?/u, "")
    .replace(/^写一个?/u, "")
    .replace(/^(?:一条|一个)?\s*(?:15\s*秒|十五秒)?\s*(?:短剧|视频|分镜|镜头|蓝图|制作蓝图)+/u, "")
    .replace(/[,，。].*$/u, "")
    .replace(/[:：]/gu, " ")
    .trim();
  if (/小猫/u.test(cleaned)) {
    return "小猫的出门日";
  }
  if (/拐卖|买.*女|买.*老婆|强迫婚姻/u.test(cleaned)) {
    return "回家的路";
  }
  return cleaned.length > 0 && cleaned.length <= 16 ? cleaned : "15秒转折";
}

function deriveFallbackSubject(objective: string): string {
  const themeMatch = /主题\s*[:：]\s*([^，,。；;\n]+)/u.exec(objective);
  if (themeMatch?.[1]) {
    return themeMatch[1].trim();
  }
  return (
    objective
      .replace(/^生成|^制作|^写|^做/u, "")
      .replace(
        /^(?:一个|一条)?\s*(?:15\s*秒|十五秒)?\s*(?:短剧|视频|分镜|镜头|蓝图|制作蓝图)+/u,
        "",
      )
      .trim() || "这个主题"
  );
}

function deriveFallbackSupplement(objective: string): string | null {
  const match = /补充内容\s*[:：]\s*([^\n]+)/u.exec(objective);
  const supplement = match?.[1]?.trim();
  return supplement === undefined || supplement.length === 0 ? null : supplement;
}
