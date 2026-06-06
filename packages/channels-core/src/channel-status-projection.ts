export interface ChannelCapabilityOverviewProjectionInput {
  readonly surfaceLabel: string;
  readonly runtimeToolCount: number;
  readonly hostReadyToolCount?: number;
}

export interface ChannelWorkspaceStatusProjectionInput {
  readonly title: string;
  readonly hostApiUrl: string;
  readonly desktopBrowserBridgeConfigured: boolean;
  readonly modelProviderSummary: string;
  readonly activeRun?: {
    readonly label: string;
    readonly pendingApprovalCount: number;
  };
  readonly toolProviders?: readonly {
    readonly providerId: string;
    readonly status: string;
    readonly lastKnownGood?: boolean;
  }[];
  readonly toolProviderReadError?: boolean;
}

export interface ChannelLearningStatusProjectionInput {
  readonly title: string;
  readonly latest?: {
    readonly sourceKind: string;
    readonly sourceRef: string;
    readonly candidateCount: number;
    readonly evidenceCount: number;
    readonly firstEvidenceId?: string;
    readonly readable: boolean;
    readonly status: string;
  };
  readonly backgroundSummary: string;
}

export function renderChannelCapabilityOverviewProjection(
  input: ChannelCapabilityOverviewProjectionInput,
): string {
  return [
    `${input.surfaceLabel}可用能力`,
    `共享运行时工具：${input.runtimeToolCount} 个`,
    input.hostReadyToolCount === undefined
      ? ""
      : `Host API 可调用工具：${input.hostReadyToolCount} 个`,
    "常用入口：/学习链接 <url>、/经验 列表、/知识 召回、/技能 列表、/制作 <目标>、/运行 状态",
    "需要桌面端在线：浏览器、OpenCLI、ComfyUI、MCP 和部分本机工具。",
  ]
    .filter((line) => line.length > 0)
    .join("\n");
}

export function renderChannelWorkspaceStatusProjection(
  input: ChannelWorkspaceStatusProjectionInput,
): string {
  const lines = [
    input.title,
    `Host API：${input.hostApiUrl}`,
    `桌面浏览器桥：${input.desktopBrowserBridgeConfigured ? "已配置" : "未配置"}`,
    `模型通道：${input.modelProviderSummary}`,
  ];
  if (input.activeRun === undefined) {
    lines.push("制作运行：无活跃任务");
  } else {
    lines.push(
      `制作运行：${input.activeRun.label} · 待确认 ${input.activeRun.pendingApprovalCount} 个`,
    );
  }
  if (input.toolProviderReadError === true) {
    lines.push("工具供应方：Host API 暂不可读");
  } else if (input.toolProviders !== undefined && input.toolProviders.length > 0) {
    lines.push("工具供应方");
    for (const provider of input.toolProviders.slice(0, 6)) {
      lines.push(
        `- ${provider.providerId}：${provider.status}${provider.lastKnownGood === true ? " · 最近可用" : ""}`,
      );
    }
  }
  return lines.join("\n");
}

export function renderChannelLearningStatusProjection(
  input: ChannelLearningStatusProjectionInput,
): string {
  const lines = [input.title];
  if (input.latest === undefined) {
    lines.push("最近学习：无");
  } else {
    lines.push(`最近学习：${input.latest.sourceKind}`);
    lines.push(input.latest.sourceRef);
    lines.push(`候选：${input.latest.candidateCount} 条`);
    lines.push(`证据：${input.latest.evidenceCount} 条`);
    if (input.latest.firstEvidenceId !== undefined) {
      lines.push(`证据编号：${input.latest.firstEvidenceId}`);
    }
    lines.push(`读取状态：${input.latest.readable ? "已读取" : "待确认"}`);
    lines.push(input.latest.status === "pending_confirmation" ? "待审" : input.latest.status);
  }
  lines.push(input.backgroundSummary);
  return lines.join("\n");
}
