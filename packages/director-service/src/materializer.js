export function materializeSnapshot(snapshot) {
  return {
    request: {
      requestId: snapshot.snapshotId,
      projectId: snapshot.project.projectId,
      groupId: snapshot.group.groupId,
      timestamp: snapshot.createdAt,
      triggerSource: snapshot.host.triggerSource,
    },
    project: {
      ...(snapshot.project.title === undefined ? {} : { title: snapshot.project.title }),
      ...(snapshot.project.outline === undefined ? {} : { outline: snapshot.project.outline }),
      ...(snapshot.project.genre === undefined ? {} : { genre: snapshot.project.genre }),
      ...(snapshot.project.continuityPriority === undefined
        ? {}
        : { continuityPriority: snapshot.project.continuityPriority }),
    },
    group: {
      groupId: snapshot.group.groupId,
      generationType: snapshot.group.generationType,
      sceneCount: snapshot.group.sceneCount,
      anchorIds: snapshot.group.anchorIds,
      ...(snapshot.group.generationStyle === undefined
        ? {}
        : { generationStyle: snapshot.group.generationStyle }),
      ...(snapshot.group.totalDurationSeconds === undefined
        ? {}
        : { totalDurationSeconds: snapshot.group.totalDurationSeconds }),
    },
    runtime: {
      runtimeId: snapshot.runtime.runtimeId,
      status: snapshot.runtime.status,
      availableBindings: snapshot.runtime.availableBindings,
      maxPromptChars: snapshot.runtime.maxPromptChars,
      supportsVideo: snapshot.runtime.supportsVideo,
      ...(snapshot.runtime.deterministicMode === undefined
        ? {}
        : { deterministicMode: snapshot.runtime.deterministicMode }),
    },
    intent: {
      bindingPolicy: snapshot.intent.bindingPolicy,
      ...(snapshot.intent.preferredImageBinding === undefined
        ? {}
        : { preferredImageBinding: snapshot.intent.preferredImageBinding }),
      ...(snapshot.intent.preferredVideoBinding === undefined
        ? {}
        : { preferredVideoBinding: snapshot.intent.preferredVideoBinding }),
      ...(snapshot.intent.requiredImageBinding === undefined
        ? {}
        : { requiredImageBinding: snapshot.intent.requiredImageBinding }),
      ...(snapshot.intent.requiredVideoBinding === undefined
        ? {}
        : { requiredVideoBinding: snapshot.intent.requiredVideoBinding }),
      ...(snapshot.intent.fallbackBindings === undefined
        ? {}
        : { fallbackBindings: snapshot.intent.fallbackBindings }),
    },
    ...(snapshot.locks === undefined
      ? {}
      : {
          locks: {
            lockedFields: snapshot.locks.lockedFields.map((lock) => ({
              field: lock.field,
              level: lock.level,
              ...(lock.reason === undefined ? {} : { reason: lock.reason }),
            })),
          },
        }),
    ...(snapshot.knowledgeSignals === undefined
      ? {}
      : {
          knowledgeSignals: snapshot.knowledgeSignals.map((signal) => ({
            id: signal.id,
            description: signal.description,
            confidence: signal.confidence,
            tags: signal.tags ?? [],
          })),
        }),
  };
}
//# sourceMappingURL=materializer.js.map
