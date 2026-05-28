/** Player Overlay & Episode Picker */
import { playerState, setPlayerState, setWatchProgress } from './state.js';
import { getProviderUrl } from './config.js';
import { fetchWithAuth } from './api.js';
import { BASE_URL, API_KEY } from './config.js';
import { showToast, lockScroll, unlockScroll } from './utils.js';
import { recordWatchSession } from './supabase.js';
import { getWatchProgress, saveWatchProgress, syncWatchProgressItem } from './storage.js';

/* DOM refs */
const playerOverlay = document.getElementById('playerOverlay');
const playerFrame = document.getElementById('playerFrame');
const playerTitleText = document.getElementById('playerTitleText');
const playerBackBtn = document.getElementById('playerBackBtn');
const playerNextBtn = document.getElementById('playerNextBtn');
const playerEpBtn = document.getElementById('playerEpBtn');
const epPopoverOverlay = document.getElementById('epPopoverOverlay');
const epPopoverList = document.getElementById('epPopoverList');
const epPopoverTitle = document.getElementById('epPopoverTitle');
const epPopoverBack = document.getElementById('epPopoverBack');
const epPopoverClose = document.getElementById('epPopoverClose');
const epPopoverTabs = document.getElementById('epPopoverTabs');

/* Elapsed-time tracking */
let _playerOpenedAt = 0;
let _progressInterval = null;
let _srcPoller = null;
let _lastKnownSrc = '';

/* Active watch tracking */
let _sessionStart = 0;
let _totalPausedMs = 0;
let _pausedAt = null;
let _watchListenersAttached = false;
let _lastSessionSnapshot = 0;

function getCurrentProgress() {
  return getWatchProgress();
}

function setCurrentProgress(data) {
  try {
    saveWatchProgress(data); // fire-and-forget: async but non-blocking
    setWatchProgress(data);
  } catch (e) { console.error('[setCurrentProgress] failed', e); }
}

async function persistProgress(id, season, episode, extra = {}) {
  if (!id || season == null || episode == null) return;
  try {
    const sid = String(id);
    const progress = getCurrentProgress();
    const existing = progress[sid] || {};
    const merged = {
      season: parseInt(season),
      episode: parseInt(episode),
      updated_at: new Date().toISOString(),
      elapsedMinutes: extra.elapsedMinutes ?? existing.elapsedMinutes ?? 0,
      episodeRuntime: extra.episodeRuntime ?? existing.episodeRuntime ?? null,
      ...extra
    };
    progress[sid] = merged;
    setCurrentProgress(progress);
    await syncWatchProgressItem(sid, 'tv', merged.season, merged.episode, merged.elapsedMinutes * 60);
    console.log('[persistProgress] synced', sid, 'S' + season, 'E' + episode);
  } catch (e) {
    console.error('[persistProgress] failed', e);
  }
}

function addSessionElapsed() {
  if (!_playerOpenedAt) return 0;
  const minutes = Math.floor((Date.now() - _playerOpenedAt) / 60000);
  _playerOpenedAt = Date.now();
  return minutes;
}

function startProgressInterval() {
  stopProgressInterval();
  _progressInterval = setInterval(() => {
    const p = playerState;
    if (p.id && p.type === 'tv' && p.season != null && p.episode != null) {
      const minutes = addSessionElapsed();
      if (minutes > 0) {
        const progress = getCurrentProgress();
        const existing = progress[String(p.id)];
        if (existing) {
          existing.elapsedMinutes = (existing.elapsedMinutes || 0) + minutes;
          existing.updated_at = new Date().toISOString();
          setCurrentProgress(progress);
        }
      }
    }
  }, 30000); // tick every 30s
}

function stopProgressInterval() {
  if (_progressInterval) {
    clearInterval(_progressInterval);
    _progressInterval = null;
  }
}

function flushElapsedAndSave() {
  const p = playerState;
  if (!p.id || p.type !== 'tv') return;
  if (p.season == null || p.episode == null) return;
  const minutes = addSessionElapsed();
  const sid = String(p.id);
  const progress = getCurrentProgress();
  const existing = progress[sid] || {};
  progress[sid] = {
    season: parseInt(p.season),
    episode: parseInt(p.episode),
    updated_at: new Date().toISOString(),
    elapsedMinutes: (existing.elapsedMinutes || 0) + minutes,
    episodeRuntime: existing.episodeRuntime ?? null
  };
  setCurrentProgress(progress);
  console.log('[flushElapsedAndSave] saved', sid, 'S' + p.season, 'E' + p.episode);
}

/* Active watch time helpers */
function getActiveDurationMs() {
  if (!_sessionStart) return 0;
  let paused = _totalPausedMs;
  if (_pausedAt) paused += (Date.now() - _pausedAt);
  return Math.max(0, Date.now() - _sessionStart - paused);
}

function pauseWatch() {
  if (_pausedAt) return;
  _pausedAt = Date.now();
}

function resumeWatch() {
  if (!_pausedAt) return;
  _totalPausedMs += (Date.now() - _pausedAt);
  _pausedAt = null;
}

function attachWatchActivityListeners() {
  if (_watchListenersAttached) return;
  _watchListenersAttached = true;
  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('blur', pauseWatch);
  window.addEventListener('focus', resumeWatch);
}

function detachWatchActivityListeners() {
  if (!_watchListenersAttached) return;
  _watchListenersAttached = false;
  document.removeEventListener('visibilitychange', onVisibilityChange);
  window.removeEventListener('blur', pauseWatch);
  window.removeEventListener('focus', resumeWatch);
}

function onVisibilityChange() {
  if (document.hidden) pauseWatch();
  else resumeWatch();
}

function recordCurrentSession() {
  const dur = getActiveDurationMs();
  if (dur < 5000) return; // ignore < 5s
  const p = playerState;
  if (!p.id) return;
  recordWatchSession({
    tmdb_id: p.id,
    type: p.type,
    season: p.type === 'tv' ? p.season : null,
    episode: p.type === 'tv' ? p.episode : null,
    started_at: new Date(Date.now() - dur - _totalPausedMs - (_pausedAt ? (Date.now() - _pausedAt) : 0)).toISOString(),
    ended_at: new Date().toISOString(),
    duration_seconds: Math.round(dur / 1000)
  });
}

function resetWatchSession() {
  recordCurrentSession();
  _sessionStart = Date.now();
  _totalPausedMs = 0;
  _pausedAt = null;
}

/* Track our own iframe loads vs user-initiated embed navigation */
let _intentionalLoad = false;
let _iframeLoadHandler = null;

function attachIframeLoadListener() {
  if (!playerFrame || _iframeLoadHandler) return;
  _iframeLoadHandler = () => {
    if (_intentionalLoad) {
      _intentionalLoad = false;
      return;
    }
    // User navigated inside the embed — try to detect the new episode
    const currentSrc = playerFrame.src || '';
    console.log('[iframe] load event fired, src=', currentSrc);
    handleIframeSrcChange(currentSrc);
  };
  playerFrame.addEventListener('load', _iframeLoadHandler);
}

function detachIframeLoadListener() {
  if (!playerFrame || !_iframeLoadHandler) return;
  playerFrame.removeEventListener('load', _iframeLoadHandler);
  _iframeLoadHandler = null;
}

/* Detect iframe src changes from inside the player (user clicks next/prev in embed) */
function startSrcPoller() {
  stopSrcPoller();
  attachIframeLoadListener();
  _lastKnownSrc = playerFrame?.src || '';
  _srcPoller = setInterval(() => {
    const currentSrc = playerFrame?.src || '';
    if (currentSrc && currentSrc !== _lastKnownSrc) {
      _lastKnownSrc = currentSrc;
      console.log('[srcPoller] src changed', currentSrc);
      handleIframeSrcChange(currentSrc);
    }
  }, 2000);
}

function stopSrcPoller() {
  if (_srcPoller) {
    clearInterval(_srcPoller);
    _srcPoller = null;
  }
  _lastKnownSrc = '';
  detachIframeLoadListener();
}

function handleIframeSrcChange(src) {
  if (playerState.type !== 'tv' || !playerState.id) return;
  const parsed = parseSeasonEpisodeFromUrl(src);
  if (!parsed) {
    console.log('[handleIframeSrcChange] could not parse', src);
    return;
  }

  const newS = parseInt(parsed.season);
  const newE = parseInt(parsed.episode);
  if (isNaN(newS) || isNaN(newE)) return;

  // Only act if actually changed
  if (newS === parseInt(playerState.season) && newE === parseInt(playerState.episode)) {
    console.log('[handleIframeSrcChange] same ep, ignoring');
    return;
  }

  console.log('[handleIframeSrcChange] detected change', 'S' + newS, 'E' + newE);

  // Save elapsed for old episode and record active watch session
  const minutesWatched = addSessionElapsed();
  const progress = getCurrentProgress();
  const existing = progress[String(playerState.id)];
  if (existing) {
    existing.elapsedMinutes = (existing.elapsedMinutes || 0) + minutesWatched;
  }
  setCurrentProgress(progress);
  resetWatchSession();

  // Update state and title
  setPlayerState({ ...playerState, season: newS, episode: newE });
  updatePlayerTitle(playerState.tmdbData?.title || '', newS, newE);
  await persistProgress(playerState.id, newS, newE, { elapsedMinutes: 0 });

  // Update Next button state
  if (playerState.tmdbData && playerNextBtn) {
    const [nextS, nextE] = getNextEp(newS, newE, playerState.tmdbData);
    if (nextS !== null) {
      playerNextBtn.style.display = 'flex';
      playerNextBtn.disabled = false;
      playerNextBtn.title = `Next: S${nextS} E${nextE}`;
      playerNextBtn.onclick = () => {
        const minutes = addSessionElapsed();
        const p = getCurrentProgress();
        const ex = p[String(playerState.id)];
        if (ex) ex.elapsedMinutes = (ex.elapsedMinutes || 0) + minutes;
        setCurrentProgress(p);
        setPlayerState({ ...playerState, season: nextS, episode: nextE });
        updatePlayerTitle(playerState.tmdbData.title, nextS, nextE);
        await persistProgress(playerState.id, nextS, nextE, { elapsedMinutes: 0 });
        _playerOpenedAt = Date.now();
        initPlayerData();
      };
    } else {
      playerNextBtn.style.display = 'flex';
      playerNextBtn.disabled = true;
      playerNextBtn.title = 'No next episode';
    }
  }
}

function parseSeasonEpisodeFromUrl(url) {
  try {
    const u = new URL(url);
    const path = u.pathname;
    const search = u.search;

    // Format: /tv/{id}/{season}/{episode}  (vidsrccc, vidsrcto, videasy, vidsrcsu, vidlink)
    let m = path.match(/\/tv\/\d+\/(\d+)\/(\d+)/);
    if (m) return { season: m[1], episode: m[2] };

    // Format: /tv/{id}-{season}-{episode}  (moviesapi)
    m = path.match(/\/tv\/\d+-(\d+)-(\d+)/);
    if (m) return { season: m[1], episode: m[2] };

    // Format: ?tmdb={id}&season={season}&episode={episode}  (vidsrcme)
    const s = new URLSearchParams(search).get('season');
    const e = new URLSearchParams(search).get('episode');
    if (s && e) return { season: s, episode: e };
  } catch (e) {
    console.error('[parseSeasonEpisodeFromUrl]', e);
  }
  return null;
}

/* beforeunload: always do a final save */
window.addEventListener('beforeunload', () => {
  flushElapsedAndSave();
  recordCurrentSession();
});

export function initPlayer() {
  if (playerBackBtn) playerBackBtn.addEventListener('click', closePlayer);
  if (epPopoverClose) epPopoverClose.addEventListener('click', closeEpPopover);
  if (epPopoverBack) epPopoverBack.addEventListener('click', () => {
    if (playerState.tmdbData) showSeasons(playerState.tmdbData.title);
  });
  if (epPopoverOverlay) {
    epPopoverOverlay.addEventListener('click', (e) => {
      if (e.target === epPopoverOverlay) closeEpPopover();
    });
  }
  if (playerTitleText) {
    playerTitleText.addEventListener('click', () => {
      if (playerState.id) {
        window.open(`https://www.themoviedb.org/${playerState.type}/${playerState.id}`, '_blank');
      }
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (epPopoverOverlay && !epPopoverOverlay.classList.contains('hidden')) {
        closeEpPopover();
      } else if (playerOverlay && !playerOverlay.classList.contains('hidden')) {
        closePlayer();
      }
    }
  });
}

function getPlayerSrc() {
  const p = playerState;
  if (p.type === 'movie') {
    return getProviderUrl('movie', p.id);
  }
  return getProviderUrl('tv', p.id, p.season, p.episode);
}

function loadPlayerIframe() {
  if (!playerFrame) return;
  _intentionalLoad = true;
  playerFrame.src = getPlayerSrc();
}

export function closePlayer() {
  if (!playerOverlay) return;
  flushElapsedAndSave();
  stopProgressInterval();
  stopSrcPoller();
  recordCurrentSession();
  detachWatchActivityListeners();
  _playerOpenedAt = 0;
  _sessionStart = 0;
  _totalPausedMs = 0;
  _pausedAt = null;
  playerOverlay.classList.add('closing');
  setTimeout(() => {
    playerOverlay.classList.add('hidden');
    playerOverlay.classList.remove('closing');
    if (playerFrame) playerFrame.src = '';
    setPlayerState({ id: null, type: null, season: 1, episode: 1, tmdbData: null, epData: null, view: 'seasons' });
    unlockScroll();
  }, 350);
}

export function openPlayer(id, type, season, episode) {
  if (!playerOverlay || !playerFrame) return;

  let startSeason = season ?? 1;
  let startEpisode = episode ?? 1;

  // Resume from saved progress for TV shows if no explicit episode provided
  if (type === 'tv' && season == null && episode == null) {
    try {
      const progress = getCurrentProgress();
      const saved = progress[String(id)];
      if (saved && saved.season != null && saved.episode != null) {
        startSeason = saved.season;
        startEpisode = saved.episode;
        console.log('[openPlayer] resuming from saved', id, 'S' + startSeason, 'E' + startEpisode);
      }
    } catch (e) { /* ignore */ }
  }

  setPlayerState({
    id,
    type,
    season: startSeason,
    episode: startEpisode,
    tmdbData: null,
    epData: null,
    view: 'seasons'
  });

  // Save immediately so a reload right after clicking play resumes correctly
  if (type === 'tv') {
    await persistProgress(id, startSeason, startEpisode);
  }

  _playerOpenedAt = Date.now();
  _sessionStart = Date.now();
  _totalPausedMs = 0;
  _pausedAt = null;
  attachWatchActivityListeners();
  playerOverlay.classList.remove('hidden');
  playerOverlay.classList.remove('closing');
  lockScroll();
  window.dispatchEvent(new CustomEvent('watchStarted', { detail: { id, type, season: startSeason, episode: startEpisode } }));
  startProgressInterval();
  startSrcPoller();
  initPlayerData();
}

function updatePlayerTitle(name, season, episode) {
  if (playerTitleText) {
    if (playerState.type === 'tv') {
      playerTitleText.textContent = `${name} S${season} E${episode}`;
    } else {
      playerTitleText.textContent = name;
    }
  }
}

async function initPlayerData() {
  const p = playerState;
  try {
    if (p.type === 'movie') {
      const url = `${BASE_URL}/movie/${p.id}?language=en-US`;
      const res = await fetch(url, {
        headers: { 'Authorization': `Bearer ${API_KEY}`, 'accept': 'application/json' }
      });
      const data = await res.json();
      updatePlayerTitle(data.original_title || data.title);
      if (playerNextBtn) playerNextBtn.style.display = 'none';
      if (playerEpBtn) {
        playerEpBtn.style.display = 'none';
        playerEpBtn.disabled = true;
      }
      loadPlayerIframe();
    } else {
      const url = `${BASE_URL}/tv/${p.id}?language=en-US`;
      const res = await fetch(url, {
        headers: { 'Authorization': `Bearer ${API_KEY}`, 'accept': 'application/json' }
      });
      const data = await res.json();
      const newTmdbData = { title: data.name, seasons: [] };
      for (const season of data.seasons) {
        newTmdbData[season.season_number] = season.episode_count;
        if (season.season_number !== 0) newTmdbData.seasons.push(season.season_number);
      }
      setPlayerState({ ...p, tmdbData: newTmdbData });

      // Update title with CURRENT state (which may have been changed by Next/Ep picker/srcPoller)
      updatePlayerTitle(data.name, playerState.season, playerState.episode);

      // Save progress again now that metadata is confirmed loaded
      await persistProgress(p.id, playerState.season, playerState.episode);

      const [nextS, nextE] = getNextEp(playerState.season, playerState.episode, newTmdbData);
      if (nextS !== null && playerNextBtn) {
        playerNextBtn.style.display = 'flex';
        playerNextBtn.disabled = false;
        playerNextBtn.title = `Next: S${nextS} E${nextE}`;
        playerNextBtn.onclick = () => {
          const minutesWatched = addSessionElapsed();
          // Save old episode elapsed first
          const progress = getCurrentProgress();
          const existing = progress[String(p.id)];
          if (existing) {
            existing.elapsedMinutes = (existing.elapsedMinutes || 0) + minutesWatched;
          }
          setCurrentProgress(progress);
          resetWatchSession();

          setPlayerState({ ...playerState, season: nextS, episode: nextE });
          updatePlayerTitle(newTmdbData.title, nextS, nextE);
          await persistProgress(p.id, nextS, nextE, { elapsedMinutes: 0 });
          initPlayerData();
        };
      } else if (playerNextBtn) {
        playerNextBtn.style.display = 'flex';
        playerNextBtn.disabled = true;
        playerNextBtn.title = 'No next episode';
      }

      if (playerEpBtn) {
        playerEpBtn.style.display = 'flex';
        playerEpBtn.disabled = true;
        playerEpBtn.innerHTML = '<i class="fas fa-list"></i> <span>Loading...</span>';
      }
      loadPlayerIframe();
      loadEpPopoverData(newTmdbData);
    }
  } catch (err) {
    if (playerTitleText) playerTitleText.textContent = 'Error loading video';
    showToast('Failed to load video info', 'error');
  }
}

function getNextEp(currentSeason, currentEpisode, data) {
  const s = parseInt(currentSeason);
  const e = parseInt(currentEpisode);
  const currentSeasonEps = data[s];
  if (e < currentSeasonEps) return [s, e + 1];
  const nextSeasonEps = data[s + 1];
  if (nextSeasonEps !== undefined) return [s + 1, 1];
  return [null, null];
}

async function loadEpPopoverData(tmdbData) {
  const p = playerState;
  if (!tmdbData) return;
  const result = {};
  try {
    for (const season of tmdbData.seasons) {
      const url = `${BASE_URL}/tv/${p.id}/season/${season}?language=en-US`;
      const res = await fetch(url, {
        headers: { 'Authorization': `Bearer ${API_KEY}`, 'accept': 'application/json' }
      });
      const seasonData = await res.json();
      result[season] = {
        name: seasonData.name,
        air_date: seasonData.air_date,
        episodes: seasonData.episodes.map(ep => ({
          name: ep.name,
          episode_number: ep.episode_number,
          season_number: ep.season_number,
          air_date: ep.air_date,
          runtime: ep.runtime
        }))
      };
    }
    setPlayerState({ ...p, epData: result });

    // Cache current episode runtime in progress
    const currentEp = result[p.season]?.episodes?.find(
      ep => String(ep.episode_number) === String(p.episode)
    );
    if (currentEp?.runtime) {
      const progress = getCurrentProgress();
      if (progress[String(p.id)]) {
        progress[String(p.id)].episodeRuntime = currentEp.runtime;
        setCurrentProgress(progress);
      }
    }

    if (playerEpBtn) {
      playerEpBtn.disabled = false;
      playerEpBtn.innerHTML = '<i class="fas fa-list"></i> <span>Episodes</span>';
      playerEpBtn.onclick = (e) => { e.stopPropagation(); openEpPopover(); };
    }
  } catch (err) {
    if (playerEpBtn) {
      playerEpBtn.disabled = true;
      playerEpBtn.innerHTML = '<i class="fas fa-list"></i> <span>Error</span>';
    }
    showToast('Failed to load episode data', 'error');
  }
}

function openEpPopover() {
  if (!epPopoverOverlay) return;
  if (!playerState.epData) {
    showToast('Episodes still loading...', 'info');
    return;
  }
  epPopoverOverlay.classList.remove('hidden');
  if (playerState.tmdbData) {
    showSeasons(playerState.tmdbData.title);
  }
}

function closeEpPopover() {
  epPopoverOverlay?.classList.add('hidden');
}

function renderSeasonTabs(activeSeason) {
  if (!epPopoverTabs || !playerState.tmdbData) return;
  epPopoverTabs.innerHTML = playerState.tmdbData.seasons.map(season => {
    const s = playerState.epData?.[season];
    const label = s ? s.name : `Season ${season}`;
    const isActive = String(season) === String(activeSeason);
    return `<button class="ep-popover-tab ${isActive ? 'active' : ''}" data-season="${season}">${label}</button>`;
  }).join('');

  epPopoverTabs.querySelectorAll('.ep-popover-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      showEpisodes(tab.getAttribute('data-season'));
    });
  });
}

function showSeasons(tvShowTitle) {
  setPlayerState({ ...playerState, view: 'seasons' });
  if (epPopoverTitle) epPopoverTitle.innerText = tvShowTitle;
  if (epPopoverBack) epPopoverBack.style.visibility = 'hidden';
  if (!epPopoverList || !playerState.epData || !playerState.tmdbData) return;

  const firstSeason = playerState.tmdbData.seasons[0];
  renderSeasonTabs(firstSeason);
  showEpisodes(firstSeason);
}

function showEpisodes(season) {
  setPlayerState({ ...playerState, view: 'episodes', season });
  const s = playerState.epData?.[season];
  if (!s || !epPopoverList) return;
  if (epPopoverTitle) epPopoverTitle.innerText = s.name;
  if (epPopoverBack) epPopoverBack.style.visibility = 'visible';

  renderSeasonTabs(season);

  epPopoverList.innerHTML = s.episodes.map(ep => `
    <li data-season="${ep.season_number}" data-episode="${ep.episode_number}" class="${String(ep.season_number) === String(playerState.season) && String(ep.episode_number) === String(playerState.episode) ? 'current-ep' : ''}">
      <div class="item-name">E${ep.episode_number} - ${ep.name}</div>
      <div class="item-details">${ep.air_date || ''}${ep.runtime ? ` &middot; ${ep.runtime}m` : ''}</div>
    </li>
  `).join('');

  epPopoverList.querySelectorAll('li').forEach(li => {
    li.addEventListener('click', () => {
      const newSeason = li.getAttribute('data-season');
      const newEpisode = li.getAttribute('data-episode');
      const minutesWatched = addSessionElapsed();
      const progress = getCurrentProgress();
      const existing = progress[String(playerState.id)];
      if (existing) {
        existing.elapsedMinutes = (existing.elapsedMinutes || 0) + minutesWatched;
      }
      setCurrentProgress(progress);
      resetWatchSession();

      setPlayerState({ ...playerState, season: newSeason, episode: newEpisode });
      await persistProgress(playerState.id, newSeason, newEpisode, { elapsedMinutes: 0 });
      closeEpPopover();
      initPlayerData();
    });
  });
}
