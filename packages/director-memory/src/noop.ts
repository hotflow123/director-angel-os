import {
  DIRECTOR_RECALL_PACKET_SCHEMA_VERSION,
  type DirectorMemoryRecord,
  type DirectorRecallPacket,
  type DirectorRecallQuery,
} from "@hotflow/director-memory-contracts";

import type {
  DirectorMemoryCandidate,
  DirectorMemoryCandidatePublishInput,
  DirectorMemoryCandidatePublishResult,
  DirectorMemoryGovernanceInput,
  DirectorMemoryGovernanceResult,
  DirectorMemoryPort,
  DirectorMemoryStatus,
  DirectorMemoryWriteResult,
} from "./types.js";

export interface NoopDirectorMemoryPortOptions {
  readonly clock?: () => string;
}

export class NoopDirectorMemoryPort implements DirectorMemoryPort {
  private readonly clock;

  public constructor(options: NoopDirectorMemoryPortOptions = {}) {
    this.clock = options.clock ?? (() => new Date().toISOString());
  }

  public async writeRecord(_record: DirectorMemoryRecord): Promise<DirectorMemoryWriteResult> {
    return {
      status: "disabled",
      notes: ["Director memory is disabled."],
    };
  }

  public async writeCandidate(
    candidate: DirectorMemoryCandidate,
  ): Promise<DirectorMemoryCandidatePublishResult> {
    return {
      status: "disabled",
      candidateId: candidate.candidateId,
      notes: ["Director memory is disabled."],
    };
  }

  public async publishCandidate(
    candidateId: string,
    _input: DirectorMemoryCandidatePublishInput = {},
  ): Promise<DirectorMemoryCandidatePublishResult> {
    return {
      status: "disabled",
      candidateId,
      notes: ["Director memory is disabled."],
    };
  }

  public async retractPublication(
    recordId: string,
    _input: DirectorMemoryGovernanceInput = {},
  ): Promise<DirectorMemoryGovernanceResult> {
    return this.disabledGovernance(recordId);
  }

  public async demotePublication(
    recordId: string,
    _input: DirectorMemoryGovernanceInput = {},
  ): Promise<DirectorMemoryGovernanceResult> {
    return this.disabledGovernance(recordId);
  }

  public async quarantinePublication(
    recordId: string,
    _input: DirectorMemoryGovernanceInput = {},
  ): Promise<DirectorMemoryGovernanceResult> {
    return this.disabledGovernance(recordId);
  }

  public async restorePublication(
    recordId: string,
    _input: DirectorMemoryGovernanceInput = {},
  ): Promise<DirectorMemoryGovernanceResult> {
    return this.disabledGovernance(recordId);
  }

  public async recall(query: DirectorRecallQuery): Promise<DirectorRecallPacket> {
    return {
      schemaVersion: DIRECTOR_RECALL_PACKET_SCHEMA_VERSION,
      queryId: `recall-disabled-${this.clock()}`,
      status: "disabled",
      recordedAt: this.clock(),
      notes: ["Director memory is disabled."],
      hits: [],
      query,
      truncated: false,
    };
  }

  public async getStatus(): Promise<DirectorMemoryStatus> {
    return {
      status: "disabled",
      recordCount: 0,
      notes: ["Director memory is disabled."],
    };
  }

  private disabledGovernance(recordId: string): DirectorMemoryGovernanceResult {
    return {
      status: "disabled",
      recordId,
      notes: ["Director memory is disabled."],
    };
  }
}
