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
