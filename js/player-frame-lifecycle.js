/** Pure helpers for keeping asynchronous provider-frame events generation-safe. */
export function isCurrentFrameGeneration(expected, current) {
  return expected.frame === current.frame
    && expected.sessionToken === current.sessionToken
    && expected.providerKey === current.providerKey
    && current.playerOpen === true;
}

export function getNextProviderCandidate(candidates, attemptedProviders) {
  return candidates.find(key => !attemptedProviders.has(key)) || null;
}
