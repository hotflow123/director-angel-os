export interface SkillSnapshot {
  readonly id: string;
  readonly version: string;
  readonly title: string;
  readonly content: string;
  readonly description?: string;
  readonly tags?: readonly string[];
  readonly toolNames?: readonly string[];
  readonly priority?: number;
  readonly disableModelInvocation?: boolean;
  readonly updatedAtMs: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

export function parseSkillSnapshot(value: unknown): SkillSnapshot | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    typeof value.id !== "string" ||
    typeof value.version !== "string" ||
    typeof value.title !== "string" ||
    typeof value.content !== "string" ||
    typeof value.updatedAtMs !== "number"
  ) {
    return null;
  }

  if (value.tags !== undefined && !isStringArray(value.tags)) {
    return null;
  }
  if (value.toolNames !== undefined && !isStringArray(value.toolNames)) {
    return null;
  }
  if (value.priority !== undefined && typeof value.priority !== "number") {
    return null;
  }
  if (
    value.disableModelInvocation !== undefined &&
    typeof value.disableModelInvocation !== "boolean"
  ) {
    return null;
  }
  if (value.description !== undefined && typeof value.description !== "string") {
    return null;
  }
  if (value.metadata !== undefined && !isRecord(value.metadata)) {
    return null;
  }

  const metadataDisableModelInvocation = readMetadataDisableModelInvocation(value.metadata);
  const disableModelInvocation =
    value.disableModelInvocation === undefined
      ? metadataDisableModelInvocation
      : value.disableModelInvocation;

  return {
    id: value.id,
    version: value.version,
    title: value.title,
    content: value.content,
    updatedAtMs: value.updatedAtMs,
    ...(value.description === undefined ? {} : { description: value.description }),
    ...(value.tags === undefined ? {} : { tags: [...value.tags] }),
    ...(value.toolNames === undefined ? {} : { toolNames: [...value.toolNames] }),
    ...(value.priority === undefined ? {} : { priority: value.priority }),
    ...(disableModelInvocation === undefined ? {} : { disableModelInvocation }),
    ...(value.metadata === undefined ? {} : { metadata: { ...value.metadata } }),
  };
}

export interface SkillRepositoryPort {
  getApproved(skillId: string): SkillSnapshot | undefined;
  listApproved(): readonly SkillSnapshot[];
  replaceApproved(skills: readonly SkillSnapshot[]): void;
  upsertApproved(skill: SkillSnapshot): void;
}

function cloneOptionalStringArray(
  values: readonly string[] | undefined,
): readonly string[] | undefined {
  return values === undefined ? undefined : [...values];
}

function cloneOptionalMetadata(
  metadata: Readonly<Record<string, unknown>> | undefined,
): Readonly<Record<string, unknown>> | undefined {
  return metadata === undefined ? undefined : { ...metadata };
}

export function cloneSkillSnapshot(snapshot: SkillSnapshot): SkillSnapshot {
  const tags = cloneOptionalStringArray(snapshot.tags);
  const toolNames = cloneOptionalStringArray(snapshot.toolNames);
  const metadata = cloneOptionalMetadata(snapshot.metadata);

  return {
    id: snapshot.id,
    version: snapshot.version,
    title: snapshot.title,
    content: snapshot.content,
    updatedAtMs: snapshot.updatedAtMs,
    ...(snapshot.description === undefined ? {} : { description: snapshot.description }),
    ...(tags === undefined ? {} : { tags }),
    ...(toolNames === undefined ? {} : { toolNames }),
    ...(snapshot.priority === undefined ? {} : { priority: snapshot.priority }),
    ...(snapshot.disableModelInvocation === undefined
      ? {}
      : { disableModelInvocation: snapshot.disableModelInvocation }),
    ...(metadata === undefined ? {} : { metadata }),
  };
}

function readMetadataDisableModelInvocation(value: unknown): boolean | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  return typeof value.disableModelInvocation === "boolean"
    ? value.disableModelInvocation
    : undefined;
}

export class SkillRepository implements SkillRepositoryPort {
  private readonly approvedSkills = new Map<string, SkillSnapshot>();

  public constructor(initialSkills: readonly SkillSnapshot[] = []) {
    this.replaceApproved(initialSkills);
  }

  public getApproved(skillId: string): SkillSnapshot | undefined {
    const skill = this.approvedSkills.get(skillId);
    return skill === undefined ? undefined : cloneSkillSnapshot(skill);
  }

  public listApproved(): readonly SkillSnapshot[] {
    return [...this.approvedSkills.values()].map((skill) => cloneSkillSnapshot(skill));
  }

  public replaceApproved(skills: readonly SkillSnapshot[]): void {
    this.approvedSkills.clear();
    for (const skill of skills) {
      this.approvedSkills.set(skill.id, cloneSkillSnapshot(skill));
    }
  }

  public upsertApproved(skill: SkillSnapshot): void {
    this.approvedSkills.set(skill.id, cloneSkillSnapshot(skill));
  }
}

export { SkillRepository as InMemorySkillRepository };
