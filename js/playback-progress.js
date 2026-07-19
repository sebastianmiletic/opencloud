export const MIN_CONTENT_DURATION_SECONDS = 180;

export function episodeProgressKey(season, episode) {
  return `s${Number(season) || 1}e${Number(episode) || 1}`;
}

export function isPlausiblePlaybackSample(sample) {
  const seconds = Number(sample?.seconds);
  const durationSeconds = Number(sample?.durationSeconds);
  return Number.isFinite(seconds)
    && Number.isFinite(durationSeconds)
    && seconds >= 0
    && durationSeconds >= MIN_CONTENT_DURATION_SECONDS
    && seconds <= durationSeconds + 2;
}

export function getSavedPlaybackSeconds(progressItem, type, season = 1, episode = 1) {
  if (!progressItem || typeof progressItem !== 'object') return 0;
  if (type === 'tv') {
    const episodeEntry = progressItem.episodes?.[episodeProgressKey(season, episode)];
    if (episodeEntry) return Math.max(0, Number(episodeEntry.playbackSeconds ?? episodeEntry.progress_seconds) || 0);
    const sameEpisode = Number(progressItem.season) === Number(season)
      && Number(progressItem.episode) === Number(episode);
    if (!sameEpisode) return 0;
  }
  return Math.max(0, Number(progressItem.playbackSeconds ?? progressItem.progress_seconds) || 0);
}

export function getSavedPlaybackDuration(progressItem, type, season = 1, episode = 1) {
  if (!progressItem || typeof progressItem !== 'object') return 0;
  if (type === 'tv') {
    const episodeEntry = progressItem.episodes?.[episodeProgressKey(season, episode)];
    if (episodeEntry) return Math.max(0, Number(episodeEntry.durationSeconds) || 0);
    const sameEpisode = Number(progressItem.season) === Number(season)
      && Number(progressItem.episode) === Number(episode);
    if (!sameEpisode) return 0;
  }
  return Math.max(0, Number(progressItem.durationSeconds) || 0);
}

export function mergePlaybackCheckpoint(existing = {}, context, sample) {
  const playbackSeconds = Math.round(Math.max(0, Number(sample.seconds) || 0) * 10) / 10;
  const durationSeconds = Math.round(Math.max(0, Number(sample.durationSeconds) || 0) * 10) / 10;
  const updatedAt = sample.updatedAt || new Date().toISOString();
  const base = {
    ...existing,
    mediaType: context.type,
    playbackSeconds,
    progress_seconds: Math.round(playbackSeconds),
    durationSeconds,
    updated_at: updatedAt
  };

  if (context.type !== 'tv') return base;

  const season = Number(context.season) || 1;
  const episode = Number(context.episode) || 1;
  const key = episodeProgressKey(season, episode);
  return {
    ...base,
    season,
    episode,
    elapsedMinutes: playbackSeconds / 60,
    episodeRuntime: durationSeconds / 60,
    episodes: {
      ...(existing.episodes || {}),
      [key]: { playbackSeconds, progress_seconds: Math.round(playbackSeconds), durationSeconds, updated_at: updatedAt }
    }
  };
}
