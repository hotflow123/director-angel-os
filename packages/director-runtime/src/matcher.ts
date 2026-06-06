import type { ActionClass, BindingPolicy } from "@hotflow/director-core";

import { isDirectorAdapterEnabled, isDirectorFeatureEnabled } from "./switches.js";
import type {
  DirectorAdapterManifest,
  DirectorMediaRouteMatch,
  DirectorMediaRouteMode,
  DirectorMediaRouteRequest,
  DirectorSwitchState,
} from "./types.js";

function bindingIdOf(manifest: DirectorAdapterManifest): string {
  return manifest.bindingId ?? manifest.adapterId;
}

function supportsRequestedMode(
  manifest: DirectorAdapterManifest,
  mode: DirectorMediaRouteMode,
): boolean {
  if (manifest.adapterKind !== "media" || manifest.mediaCapability === undefined) {
    return false;
  }

  const supportedModes = manifest.mediaCapability.supportedModes;
  return mode === "video"
    ? supportedModes.includes("text_to_video") || supportedModes.includes("image_to_video")
    : supportedModes.includes("text_to_image");
}

function supportsAction(manifest: DirectorAdapterManifest, actionClass: ActionClass): boolean {
  return manifest.supportedActionClasses.includes(actionClass);
}

function isEligibleManifest(
  manifest: DirectorAdapterManifest,
  actionClass: ActionClass,
  switchState: DirectorSwitchState | undefined,
  allowDegraded: boolean,
  allowedAdapterIds: readonly string[] | undefined,
): boolean {
  if (manifest.adapterKind !== "media") {
    return false;
  }
  if (manifest.enabled === false) {
    return false;
  }
  if (!supportsAction(manifest, actionClass)) {
    return false;
  }
  if (manifest.healthStatus === "offline") {
    return false;
  }
  if (!allowDegraded && manifest.healthStatus === "degraded") {
    return false;
  }
  if (
    allowedAdapterIds !== undefined &&
    allowedAdapterIds.length > 0 &&
    !allowedAdapterIds.includes(manifest.adapterId)
  ) {
    return false;
  }
  if (switchState === undefined) {
    return true;
  }
  return (
    isDirectorFeatureEnabled(switchState, "mediaAdapters.enabled") &&
    isDirectorAdapterEnabled(switchState, manifest.adapterId)
  );
}

function sortCandidates(
  candidates: readonly DirectorAdapterManifest[],
  preferredBinding: string | undefined,
  fallbackBindings: readonly string[] | undefined,
): DirectorAdapterManifest[] {
  const preferred =
    preferredBinding === undefined
      ? []
      : candidates.filter((candidate) => bindingIdOf(candidate) === preferredBinding);
  const remainingAfterPreferred = candidates.filter((candidate) => !preferred.includes(candidate));

  const fallbackOrder = fallbackBindings ?? [];
  const fallbackMatches = fallbackOrder.flatMap((binding) =>
    remainingAfterPreferred.filter((candidate) => bindingIdOf(candidate) === binding),
  );
  const remaining = remainingAfterPreferred.filter(
    (candidate) => !fallbackMatches.includes(candidate),
  );

  return [...preferred, ...fallbackMatches, ...remaining];
}

function buildNoMatchResult(
  reasons: readonly string[],
  missingCapabilities: readonly string[] = [],
): DirectorMediaRouteMatch {
  return {
    status: "no_match",
    selectedAdapterId: null,
    selectedBindingId: null,
    eligibleAdapterIds: [],
    eligibleBindings: [],
    partialAdapterIds: [],
    reasons: [...reasons],
    missingCapabilities: [...missingCapabilities],
  };
}

function buildBlockedResult(
  reasons: readonly string[],
  partialAdapterIds: readonly string[] = [],
): DirectorMediaRouteMatch {
  return {
    status: "blocked",
    selectedAdapterId: null,
    selectedBindingId: null,
    eligibleAdapterIds: [],
    eligibleBindings: [],
    partialAdapterIds: [...partialAdapterIds],
    reasons: [...reasons],
    missingCapabilities: [],
  };
}

export function matchMediaRouteFromManifests(
  manifests: readonly DirectorAdapterManifest[],
  request: DirectorMediaRouteRequest,
): DirectorMediaRouteMatch {
  const actionClass = request.actionClass ?? "route";
  const switchState = request.switchState;
  const allowDegraded = request.allowDegraded ?? true;

  if (switchState !== undefined && !isDirectorFeatureEnabled(switchState, "director.enabled")) {
    return buildBlockedResult(["Director control is disabled by switch."]);
  }

  if (
    actionClass === "route" &&
    switchState !== undefined &&
    !isDirectorFeatureEnabled(switchState, "autoRoute.enabled")
  ) {
    return buildBlockedResult(["Automatic routing is disabled by switch."]);
  }

  const visibleMedia = manifests.filter(
    (manifest) =>
      manifest.adapterKind === "media" &&
      manifest.enabled !== false &&
      (switchState === undefined || isDirectorAdapterEnabled(switchState, manifest.adapterId)) &&
      (switchState === undefined || isDirectorFeatureEnabled(switchState, "mediaAdapters.enabled")),
  );
  const modeCapable = visibleMedia.filter((manifest) =>
    supportsRequestedMode(manifest, request.mode),
  );
  const eligible = modeCapable.filter((manifest) =>
    isEligibleManifest(
      manifest,
      actionClass,
      switchState,
      allowDegraded,
      request.allowedAdapterIds,
    ),
  );

  const preferredBinding = request.requiredBinding ?? request.preferredBinding;
  const orderedEligible = sortCandidates(eligible, preferredBinding, request.fallbackBindings);

  if (request.requiredBinding !== undefined) {
    const exact = orderedEligible.find(
      (manifest) => bindingIdOf(manifest) === request.requiredBinding,
    );
    if (exact !== undefined) {
      return {
        status: "matched",
        selectedAdapterId: exact.adapterId,
        selectedBindingId: bindingIdOf(exact),
        eligibleAdapterIds: orderedEligible.map((manifest) => manifest.adapterId),
        eligibleBindings: orderedEligible.map(bindingIdOf),
        partialAdapterIds: [],
        reasons: [
          `Required binding ${request.requiredBinding} is available for ${request.mode} routing.`,
        ],
        missingCapabilities: [],
      };
    }

    const registered = visibleMedia.some(
      (manifest) => bindingIdOf(manifest) === request.requiredBinding,
    );
    return registered
      ? buildBlockedResult([
          `Required binding ${request.requiredBinding} is registered but unavailable under current switches or health constraints.`,
        ])
      : buildNoMatchResult(
          [`Required binding ${request.requiredBinding} is not registered.`],
          [request.requiredBinding],
        );
  }

  if (orderedEligible.length === 0) {
    if (modeCapable.length === 0 && visibleMedia.length > 0) {
      return {
        status: "partial",
        selectedAdapterId: null,
        selectedBindingId: null,
        eligibleAdapterIds: [],
        eligibleBindings: [],
        partialAdapterIds: visibleMedia.map((manifest) => manifest.adapterId),
        reasons: [
          `No ${request.mode} adapter matched, but other media adapters exist for manual degradation review.`,
        ],
        missingCapabilities: [request.mode === "video" ? "text_to_video" : "text_to_image"],
      };
    }

    return buildNoMatchResult([
      `No eligible media adapter matched the ${request.mode} route request.`,
    ]);
  }

  const selected = orderedEligible[0];
  if (selected === undefined) {
    return buildNoMatchResult([
      `No eligible media adapter matched the ${request.mode} route request.`,
    ]);
  }
  const eligibleAdapterIds = orderedEligible.map((manifest) => manifest.adapterId);
  const eligibleBindings = orderedEligible.map(bindingIdOf);
  const selectedBindingId = bindingIdOf(selected);

  const fellBackFromPreferred =
    request.preferredBinding !== undefined && selectedBindingId !== request.preferredBinding;
  const usedFallback =
    request.bindingPolicy !== ("auto" as BindingPolicy) &&
    request.fallbackBindings !== undefined &&
    request.fallbackBindings.includes(selectedBindingId);

  return {
    status: fellBackFromPreferred || usedFallback ? "partial" : "matched",
    selectedAdapterId: selected.adapterId,
    selectedBindingId,
    eligibleAdapterIds,
    eligibleBindings,
    partialAdapterIds: [],
    reasons:
      fellBackFromPreferred || usedFallback
        ? [
            request.preferredBinding !== undefined
              ? `Preferred binding ${request.preferredBinding} was unavailable; selected ${selectedBindingId} instead.`
              : `Selected fallback binding ${selectedBindingId} for ${request.mode} routing.`,
          ]
        : [`Selected ${selectedBindingId} for ${request.mode} routing.`],
    missingCapabilities: [],
  };
}
