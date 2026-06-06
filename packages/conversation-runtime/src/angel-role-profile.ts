import type { ConversationRuntimeAngelRoleProfile } from "./types.js";

const DEFAULT_DIRECTOR_ANGEL_ROLE_PROFILE: ConversationRuntimeAngelRoleProfile = Object.freeze({
  roleId: "director",
  title: "导演 Angel",
  domain: "影视制作与 AI 工作流",
  responsibilities: [
    "持续学习影视短剧和 AI 制作经验",
    "把可复用方法沉淀为待审经验候选",
    "在制作任务中优先复用已确认经验",
  ],
  learningScope: ["影视短剧", "AI 制作", "角色设定", "分镜", "镜头语言", "制作流程"],
  controllableSystems: ["learning", "knowledge.recall", "memory.recall", "comfyui"],
});

export function createDefaultDirectorAngelRoleProfile(
  overrides: Partial<ConversationRuntimeAngelRoleProfile> = {},
): ConversationRuntimeAngelRoleProfile {
  const profile = normalizeConversationRuntimeAngelRoleProfile({
    ...DEFAULT_DIRECTOR_ANGEL_ROLE_PROFILE,
    ...overrides,
    responsibilities:
      overrides.responsibilities ?? DEFAULT_DIRECTOR_ANGEL_ROLE_PROFILE.responsibilities,
    learningScope: overrides.learningScope ?? DEFAULT_DIRECTOR_ANGEL_ROLE_PROFILE.learningScope,
    controllableSystems:
      overrides.controllableSystems ?? DEFAULT_DIRECTOR_ANGEL_ROLE_PROFILE.controllableSystems,
    metadata: {
      ...(DEFAULT_DIRECTOR_ANGEL_ROLE_PROFILE.metadata ?? {}),
      ...(overrides.metadata ?? {}),
    },
  });
  return profile ?? DEFAULT_DIRECTOR_ANGEL_ROLE_PROFILE;
}

export function normalizeConversationRuntimeAngelRoleProfile(
  value: unknown,
): ConversationRuntimeAngelRoleProfile | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const roleId = readNonEmptyString(value.roleId);
  if (roleId === undefined) {
    return undefined;
  }
  const title = readNonEmptyString(value.title) ?? readNonEmptyString(value.roleName);
  const responsibilities = readStringArray(value.responsibilities);
  const learningScope = readStringArray(value.learningScope ?? value.learningFocus);
  const controllableSystems = readStringArray(value.controllableSystems ?? value.toolAccess);
  return {
    roleId,
    ...(title === undefined ? {} : { title }),
    ...optionalStringField("domain", value.domain),
    ...(responsibilities.length === 0 ? {} : { responsibilities }),
    ...(learningScope.length === 0 ? {} : { learningScope }),
    ...(controllableSystems.length === 0 ? {} : { controllableSystems }),
    ...(isRecord(value.metadata) ? { metadata: { ...value.metadata } } : {}),
  };
}

export function renderConversationRuntimeAngelRoleSystemContext(
  profile: ConversationRuntimeAngelRoleProfile | undefined,
): string | undefined {
  if (profile === undefined) {
    return undefined;
  }
  const lines = [
    `当前岗位：${profile.title ?? profile.roleId}`,
    ...(profile.domain === undefined ? [] : [`领域：${profile.domain}`]),
    ...renderListLine("职责", profile.responsibilities),
    ...renderListLine("学习范围", profile.learningScope),
    ...renderListLine("可用系统", profile.controllableSystems),
    "岗位规则：只把高质量资料沉淀为待审候选，用户确认前不得自动发布到长期经验库。",
  ];
  return lines.join("\n");
}

function renderListLine(label: string, items: readonly string[] | undefined): readonly string[] {
  if (items === undefined || items.length === 0) {
    return [];
  }
  return [`${label}：${items.join("；")}`];
}

function optionalStringField<K extends string>(key: K, value: unknown): Partial<Record<K, string>> {
  const text = readNonEmptyString(value);
  return text === undefined ? {} : ({ [key]: text } as Partial<Record<K, string>>);
}

function readStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return [
    ...new Set(value.map(readNonEmptyString).filter((item): item is string => item !== undefined)),
  ];
}

function readNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const text = value.trim();
  return text.length === 0 ? undefined : text;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
