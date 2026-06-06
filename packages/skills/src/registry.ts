import {
  InMemorySkillRepository,
  type SkillRepositoryPort,
  type SkillSnapshot,
} from "./repository.js";

export class SkillRegistry {
  public constructor(
    private readonly repository: SkillRepositoryPort = new InMemorySkillRepository(),
  ) {}

  public get(skillId: string): SkillSnapshot | undefined {
    return this.repository.getApproved(skillId);
  }

  public list(): readonly SkillSnapshot[] {
    return this.repository.listApproved();
  }

  public register(skill: SkillSnapshot): void {
    if (this.repository.getApproved(skill.id) !== undefined) {
      throw new Error(`Skill already registered: ${skill.id}`);
    }
    this.repository.upsertApproved(skill);
  }

  public upsert(skill: SkillSnapshot): void {
    this.repository.upsertApproved(skill);
  }
}
