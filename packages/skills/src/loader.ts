import {
  InMemorySkillRepository,
  type SkillRepositoryPort,
  type SkillSnapshot,
} from "./repository.js";

export interface SkillLoaderInput {
  readonly approvedSkills: readonly SkillSnapshot[];
}

export function loadSkillRepository(input: SkillLoaderInput): SkillRepositoryPort {
  return new InMemorySkillRepository(input.approvedSkills);
}
