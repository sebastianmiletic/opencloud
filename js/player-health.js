export function connectionScoreForLatency(latencyMs, status = 200, reachable = true) {
  if (!reachable || !Number.isFinite(Number(latencyMs))) return 1;
  if (Number(status) >= 500) return 1;
  if (Number(status) >= 400) return 2;
  const latency = Number(latencyMs);
  if (latency <= 350) return 5;
  if (latency <= 800) return 4;
  if (latency <= 1600) return 3;
  if (latency <= 3000) return 2;
  return 1;
}

export function connectionScoreForPlayback(bufferedAheadSeconds, readyState = 0, stalled = false, mediaErrorCode = 0) {
  if (Number(mediaErrorCode) > 0 || stalled) return 1;
  const state = Number(readyState) || 0;
  const buffer = Math.max(0, Number(bufferedAheadSeconds) || 0);
  if (state < 2) return 1;
  if (state < 3) return 2;
  if (buffer >= 30) return 5;
  if (buffer >= 15) return 4;
  if (buffer >= 6) return 3;
  if (buffer >= 2) return 2;
  return state >= 4 ? 3 : 1;
}

export function stallThresholdsForConnection(connection = null) {
  const effectiveType = String(connection?.effectiveType || '');
  const downlink = Number(connection?.downlink);
  const weakConnection = connection?.saveData === true
    || effectiveType === 'slow-2g'
    || effectiveType === '2g'
    || effectiveType === '3g'
    || (Number.isFinite(downlink) && downlink > 0 && downlink < 3);
  return weakConnection
    ? { recoverAfterMs: 5000, failoverAfterMs: 20000 }
    : { recoverAfterMs: 4000, failoverAfterMs: 14000 };
}
