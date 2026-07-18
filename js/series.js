export function resolveUpNextEpisode(show, progress) {
  let season = Number(progress?.season) || 1;
  let episode = Number(progress?.episode) || 1;
  const runtime = Number(progress?.episodeRuntime) || 0;
  const elapsed = Number(progress?.elapsedMinutes) || 0;
  const shouldAdvance = runtime > 0 && elapsed / runtime >= 0.9;
  let advanced = false;

  if (shouldAdvance) {
    const seasons = (show?.seasons || [])
      .filter(item => item.season_number > 0 && item.episode_count > 0)
      .sort((a, b) => a.season_number - b.season_number);
    const current = seasons.find(item => item.season_number === season);
    if (current && episode < current.episode_count) {
      episode += 1;
      advanced = true;
    } else {
      const nextSeason = seasons.find(item => item.season_number > season);
      if (nextSeason) {
        season = nextSeason.season_number;
        episode = 1;
        advanced = true;
      }
    }
  }

  return { season, episode, advanced };
}
