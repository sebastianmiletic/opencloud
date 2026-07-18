/** Player Overlay & Episode Picker */
import { playerState, setPlayerState, setWatchProgress } from './state.js';
import { getProviderCandidates, getProviderUrlFor, getSettings, PROVIDERS } from './config.js';
import { fetchWithAuth } from './api.js';
import { BASE_URL } from './config.js';
import { showToast, lockScroll, unlockScroll } from './utils.js';
import { recordWatchSession } from './supabase.js';
import { getWatchProgress, saveWatchProgress, syncWatchProgressItem, addToUserHistory } from './storage.js';
import { invokeDesktop, isTauri, openExternal } from './desktop.js';
import { connectionScoreForLatency } from './player-health.js';

/* DOM refs */
const playerOverlay = document.getElementById('playerOverlay');
const playerFrame = document.getElementById('playerFrame');
const playerTitleText = document.getElementById('playerTitleText');
const playerSeriesTitle = document.getElementById('playerSeriesTitle');
const playerEpisodeTitle = document.getElementById('playerEpisodeTitle');
const playerBackBtn = document.getElementById('playerBackBtn');
const playerNextBtn = document.getElementById('playerNextBtn');
const playerEpBtn = document.getElementById('playerEpBtn');
const playerFullscreenBtn = document.getElementById('playerFullscreenBtn');
const playerHealth = document.getElementById('playerHealth');
const playerHealthText = document.getElementById('playerHealthText');
const playerHealthScore = document.getElementById('playerHealthScore');
const playerRetryBtn = document.getElementById('playerRetryBtn');
const epPopoverOverlay = document.getElementById('epPopoverOverlay');
const epPopoverList = document.getElementById('epPopoverList');
const epPopoverTitle = document.getElementById('epPopoverTitle');
const epPopoverBack = document.getElementById('epPopoverBack');
const epPopoverClose = document.getElementById('epPopoverClose');
const epPopoverTabs = document.getElementById('epPopoverTabs');

/* Elapsed-time tracking */
let _playerOpenedAt = 0;
let _progressInterval = null;
let _healthTimer = null;
let _providerProbeInterval = null;
let _providerProbeTimeout = null;
let _providerProbeToken = 0;
let _providerProbeFailures = 0;
let _frameLoadStartedAt = 0;
let _lastFrameScore = 1;
let _currentProviderKey = null;
let _providerCandidates = [];
let _attemptedProviders = new Set();
let _iframeErrorHandler = null;
let _metadataFailed = false;
let _isPlayerFullscreen = false;
let _headerAutohide = false;
let _metadataRequestId = 0;
const _seasonCache = new Map();

function healthQuality(score) {
  return ['Unavailable', 'Poor', 'Fair', 'Good', 'Excellent'][Math.max(1, Math.min(5, score)) - 1];
}

function adjustScoreForConnection(score) {
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (!navigator.onLine) return 1;
  if (!connection) return score;
  if (connection.saveData) score = Math.min(score, 3);
  if (connection.effectiveType === 'slow-2g') return 1;
  if (connection.effectiveType === '2g') score = Math.min(score, 2);
  if (connection.effectiveType === '3g') score = Math.min(score, 3);
  if (Number(connection.rtt) > 1200 || (Number(connection.downlink) > 0 && Number(connection.downlink) < 1)) return Math.min(score, 2);
  if (Number(connection.rtt) > 600 || (Number(connection.downlink) > 0 && Number(connection.downlink) < 3)) return Math.min(score, 3);
  return score;
}

function setPlayerHealth(state, text, retry = false, score = 1, latencyMs = null) {
  const normalizedScore = Math.max(1, Math.min(5, Number(score) || 1));
  if (playerHealth) {
    playerHealth.className = `player-health is-${state} score-${normalizedScore}`;
    const latency = Number.isFinite(Number(latencyMs)) ? `, ${Math.round(Number(latencyMs))} milliseconds` : '';
    playerHealth.setAttribute('aria-label', `${providerName(_currentProviderKey)} connection ${normalizedScore} out of 5, ${healthQuality(normalizedScore)}${latency}`);
  }
  if (playerHealthScore) playerHealthScore.textContent = `${normalizedScore}/5`;
  if (playerHealthText) playerHealthText.textContent = text;
  playerRetryBtn?.classList.toggle('hidden', !retry);
  window.dispatchEvent(new CustomEvent('opencloud:provider-health', {
    detail: { provider: _currentProviderKey, state, score: normalizedScore, text, latencyMs }
  }));
}

function clearHealthTimer() {
  if (_healthTimer) clearTimeout(_healthTimer);
  _healthTimer = null;
}

function providerName(key) {
  return PROVIDERS[key]?.name || 'source';
}

function resetProviderSession(type) {
  _providerCandidates = getProviderCandidates(type);
  _currentProviderKey = _providerCandidates[0] || getSettings().provider;
  _attemptedProviders = new Set();
  _providerProbeFailures = 0;
  _lastFrameScore = 1;
}

function tryNextProvider(reason = 'The source did not respond') {
  clearHealthTimer();
  const nextKey = _providerCandidates.find(key => !_attemptedProviders.has(key));
  if (!nextKey) {
    setPlayerHealth('failed', 'No source responded', true, 1);
    showToast('No video source responded. Retry or choose a source in Settings.', 'error');
    return false;
  }
  _currentProviderKey = nextKey;
  _providerProbeFailures = 0;
  setPlayerHealth('switching', `Switching to ${providerName(nextKey)}…`, false, 2);
  showToast(`${reason}. Trying ${providerName(nextKey)}…`, 'info');
  loadPlayerIframe();
  return true;
}

function handleProviderFailure(reason) {
  if (getSettings().autoProviderFailover === true) {
    tryNextProvider(reason);
    return;
  }
  setPlayerHealth('slow', `${providerName(_currentProviderKey)} · Poor`, true, 1);
}

function stopProviderHealthProbes() {
  _providerProbeToken += 1;
  if (_providerProbeTimeout) clearTimeout(_providerProbeTimeout);
  if (_providerProbeInterval) clearInterval(_providerProbeInterval);
  _providerProbeTimeout = null;
  _providerProbeInterval = null;
}

async function probeCurrentProvider() {
  const providerKey = _currentProviderKey;
  if (!providerKey || !playerState.id || playerOverlay?.classList.contains('hidden')) return;
  const probeToken = _providerProbeToken;
  if (!navigator.onLine) {
    setPlayerHealth('failed', `${providerName(providerKey)} · Offline`, true, 1);
    return;
  }
  if (!isTauri()) return;

  try {
    const result = await invokeDesktop('probe_provider', { url: getPlayerSrc() });
    if (probeToken !== _providerProbeToken || providerKey !== _currentProviderKey) return;
    const measuredScore = connectionScoreForLatency(result?.latencyMs, result?.status, result?.reachable);
    const statusRejectedProbe = Number(result?.status) >= 400 && Number(result?.status) < 500 && result?.reachable;
    const score = adjustScoreForConnection(statusRejectedProbe ? _lastFrameScore : measuredScore);
    if (score === 1) _providerProbeFailures += 1;
    else _providerProbeFailures = 0;

    if (_providerProbeFailures >= 2 && getSettings().autoProviderFailover === true) {
      tryNextProvider(`${providerName(providerKey)} stopped responding`);
      return;
    }

    const state = score <= 2 ? 'slow' : 'ready';
    setPlayerHealth(state, `${providerName(providerKey)} · ${healthQuality(score)}`, score <= 1, score, result?.latencyMs);
  } catch (error) {
    if (probeToken !== _providerProbeToken || providerKey !== _currentProviderKey) return;
    console.warn('[provider probe]', error);
    _providerProbeFailures += 1;
    if (_providerProbeFailures >= 2 && getSettings().autoProviderFailover === true) {
      tryNextProvider(`${providerName(providerKey)} stopped responding`);
    } else {
      setPlayerHealth('slow', `${providerName(providerKey)} · Check connection`, true, 1);
    }
  }
}

function startProviderHealthProbes() {
  stopProviderHealthProbes();
  _providerProbeTimeout = setTimeout(probeCurrentProvider, 2500);
  _providerProbeInterval = setInterval(probeCurrentProvider, 15000);
}

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
  }, 60000); // one lightweight local save per minute
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

/* Observe the embed lifecycle without polling cross-origin state. */
let _iframeLoadHandler = null;

function attachIframeLoadListener() {
  if (!playerFrame || _iframeLoadHandler) return;
  _iframeLoadHandler = () => {
    clearHealthTimer();
    const latency = Math.max(0, performance.now() - _frameLoadStartedAt);
    const score = adjustScoreForConnection(connectionScoreForLatency(latency));
    _lastFrameScore = score;
    _providerProbeFailures = 0;
    setPlayerHealth(score <= 2 ? 'slow' : 'ready', `${providerName(_currentProviderKey)} · ${healthQuality(score)}`, false, score, latency);
    startProviderHealthProbes();
  };
  playerFrame.addEventListener('load', _iframeLoadHandler);
  _iframeErrorHandler = () => handleProviderFailure(`${providerName(_currentProviderKey)} failed to load`);
  playerFrame.addEventListener('error', _iframeErrorHandler);
}

function detachIframeLoadListener() {
  if (!playerFrame || !_iframeLoadHandler) return;
  playerFrame.removeEventListener('load', _iframeLoadHandler);
  if (_iframeErrorHandler) playerFrame.removeEventListener('error', _iframeErrorHandler);
  _iframeLoadHandler = null;
  _iframeErrorHandler = null;
}

function startFrameMonitoring() {
  attachIframeLoadListener();
}

function stopFrameMonitoring() {
  detachIframeLoadListener();
}

/* beforeunload: always do a final save */
window.addEventListener('beforeunload', () => {
  flushElapsedAndSave();
  recordCurrentSession();
});

function updateFullscreenButton(fullscreen) {
  _isPlayerFullscreen = fullscreen;
  document.body.classList.toggle('player-fullscreen', fullscreen);
  if (!playerFullscreenBtn) return;
  playerFullscreenBtn.setAttribute('aria-pressed', String(fullscreen));
  playerFullscreenBtn.setAttribute('aria-label', fullscreen ? 'Exit fullscreen' : 'Enter fullscreen');
  playerFullscreenBtn.title = fullscreen ? 'Exit fullscreen (F)' : 'Enter fullscreen (F)';
  const icon = playerFullscreenBtn.querySelector('i');
  if (icon) icon.className = fullscreen ? 'fas fa-compress' : 'fas fa-expand';
}

async function setPlayerFullscreen(fullscreen) {
  const setWebFullscreen = async () => {
    if (fullscreen) {
      const request = playerOverlay?.requestFullscreen || playerOverlay?.webkitRequestFullscreen;
      if (!request) throw new Error('Fullscreen is not supported');
      await request.call(playerOverlay);
    } else {
      const exit = document.exitFullscreen || document.webkitExitFullscreen;
      if (exit && (document.fullscreenElement || document.webkitFullscreenElement)) await exit.call(document);
    }
    return Boolean(document.fullscreenElement || document.webkitFullscreenElement);
  };

  try {
    if (isTauri()) {
      updateFullscreenButton(fullscreen);
      try {
        const actualState = await invokeDesktop('set_player_fullscreen', { fullscreen });
        updateFullscreenButton(Boolean(actualState));
        return;
      } catch (nativeError) {
        console.warn('[player fullscreen] native fullscreen failed, using web fallback', nativeError);
      }
    }
    updateFullscreenButton(await setWebFullscreen());
  } catch (error) {
    updateFullscreenButton(false);
    console.error('[player fullscreen]', error);
    showToast('Fullscreen could not be changed', 'error');
  }
}

function togglePlayerFullscreen() {
  return setPlayerFullscreen(!_isPlayerFullscreen);
}

function setPlayerHeaderAutohide(enabled, notify = true) {
  const isLaptop = document.body.classList.contains('device-laptop');
  _headerAutohide = Boolean(enabled && isLaptop);
  playerOverlay?.classList.toggle('player-header-autohide', _headerAutohide);
  playerOverlay?.setAttribute('data-header-mode', _headerAutohide ? 'auto-hide' : 'fixed');
  if (_headerAutohide && document.activeElement instanceof HTMLElement && document.activeElement.closest('.player-header-bar')) {
    document.activeElement.blur();
  }
  if (!notify) return;
  showToast(
    _headerAutohide
      ? 'Player bar hidden. Move to the top edge or press T to restore it.'
      : 'Player bar will stay visible.',
    'info'
  );
}

function togglePlayerHeaderAutohide() {
  setPlayerHeaderAutohide(!_headerAutohide);
}

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
        openExternal(`https://www.themoviedb.org/${playerState.type}/${playerState.id}`).catch(console.error);
      }
    });
  }
  playerRetryBtn?.addEventListener('click', () => {
    if (_metadataFailed) {
      initPlayerData();
      return;
    }
    resetProviderSession(playerState.type || 'movie');
    loadPlayerIframe();
  });
  playerFullscreenBtn?.addEventListener('click', togglePlayerFullscreen);
  window.addEventListener('offline', () => {
    if (!playerOverlay?.classList.contains('hidden')) setPlayerHealth('failed', `${providerName(_currentProviderKey)} · Offline`, true, 1);
  });
  window.addEventListener('online', () => {
    if (!playerOverlay?.classList.contains('hidden')) probeCurrentProvider();
  });
  window.addEventListener('opencloud:device-layout', (event) => {
    if (event.detail?.device !== 'laptop') setPlayerHeaderAutohide(false, false);
  });
  document.addEventListener('fullscreenchange', () => updateFullscreenButton(Boolean(document.fullscreenElement)));
  document.addEventListener('webkitfullscreenchange', () => updateFullscreenButton(Boolean(document.webkitFullscreenElement)));

  document.addEventListener('keydown', (e) => {
    const playerIsOpen = playerOverlay && !playerOverlay.classList.contains('hidden');
    const target = e.target;
    const isTyping = target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
    if (playerIsOpen && !isTyping && e.key.toLowerCase() === 't') {
      if (!document.body.classList.contains('device-laptop')) return;
      e.preventDefault();
      togglePlayerHeaderAutohide();
      return;
    }
    if (playerIsOpen && !isTyping && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      togglePlayerFullscreen();
      return;
    }
    if (e.key === 'Escape') {
      if (_isPlayerFullscreen) {
        e.preventDefault();
        setPlayerFullscreen(false);
      } else if (epPopoverOverlay && !epPopoverOverlay.classList.contains('hidden')) {
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
    return getProviderUrlFor(_currentProviderKey, 'movie', p.id);
  }
  return getProviderUrlFor(_currentProviderKey, 'tv', p.id, p.season, p.episode);
}

function loadPlayerIframe() {
  if (!playerFrame) return;
  clearHealthTimer();
  stopProviderHealthProbes();
  if (!_currentProviderKey) resetProviderSession(playerState.type || 'movie');
  _attemptedProviders.add(_currentProviderKey);
  _frameLoadStartedAt = performance.now();
  _lastFrameScore = 1;
  setPlayerHealth('connecting', `Connecting to ${providerName(_currentProviderKey)}…`, false, 2);
  playerFrame.src = getPlayerSrc();
  _healthTimer = setTimeout(() => {
    handleProviderFailure(`${providerName(_currentProviderKey)} is taking too long`);
  }, 12000);
}

export function closePlayer() {
  if (!playerOverlay) return;
  _metadataRequestId += 1;
  setPlayerHeaderAutohide(false, false);
  if (_isPlayerFullscreen) setPlayerFullscreen(false);
  flushElapsedAndSave();
  stopProgressInterval();
  stopFrameMonitoring();
  clearHealthTimer();
  stopProviderHealthProbes();
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
    setPlayerHealth('idle', 'Player idle', false, 1);
    _providerCandidates = [];
    _attemptedProviders.clear();
    _currentProviderKey = null;
    _metadataFailed = false;
    setPlayerState({ id: null, type: null, season: 1, episode: 1, tmdbData: null, epData: null, view: 'seasons' });
    unlockScroll();
  }, 150);
}

export async function openPlayer(id, type, season, episode) {
  if (!playerOverlay || !playerFrame) return;

  setPlayerHeaderAutohide(false, false);

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
  resetProviderSession(type);
  _metadataFailed = false;

  // Save immediately, without delaying the stream on cloud synchronization.
  if (type === 'tv') {
    persistProgress(id, startSeason, startEpisode).catch(console.error);
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
  startFrameMonitoring();
  updatePlayerTitle('Loading…', startSeason, startEpisode);
  loadPlayerIframe();
  initPlayerData();
}

function updatePlayerTitle(name, season, episode, episodeName = '') {
  const seriesText = playerState.type === 'tv'
    ? `${name || 'Series'} · S${season} E${episode}`
    : name;
  if (playerSeriesTitle) playerSeriesTitle.textContent = seriesText;
  else if (playerTitleText) playerTitleText.textContent = seriesText;
  if (playerEpisodeTitle) {
    playerEpisodeTitle.textContent = episodeName;
    playerEpisodeTitle.classList.toggle('hidden', !episodeName || playerState.type !== 'tv');
  }
}

async function initPlayerData() {
  const requestId = ++_metadataRequestId;
  const mediaId = playerState.id;
  const mediaType = playerState.type;
  try {
    _metadataFailed = false;
    if (mediaType === 'movie') {
      const url = `${BASE_URL}/movie/${mediaId}?language=en-US`;
      const data = await fetchWithAuth(url);
      if (requestId !== _metadataRequestId || playerState.id !== mediaId) return;
      updatePlayerTitle(data.original_title || data.title);
      if (playerNextBtn) playerNextBtn.style.display = 'none';
      if (playerEpBtn) {
        playerEpBtn.style.display = 'none';
        playerEpBtn.disabled = true;
      }
      addToUserHistory({ id: mediaId, media_type: mediaType, title: data.title || data.name, poster_path: data.poster_path, vote_average: data.vote_average, year: data.release_date?.slice(0, 4) }).catch(() => {});
    } else {
      const url = `${BASE_URL}/tv/${mediaId}?language=en-US`;
      const data = await fetchWithAuth(url);
      if (requestId !== _metadataRequestId || playerState.id !== mediaId) return;
      const newTmdbData = {
        title: data.name,
        poster_path: data.poster_path,
        vote_average: data.vote_average,
        year: data.first_air_date?.slice(0, 4),
        seasons: []
      };
      for (const season of data.seasons) {
        newTmdbData[season.season_number] = season.episode_count;
        if (season.season_number !== 0) newTmdbData.seasons.push(season.season_number);
      }
      setPlayerState({ ...playerState, tmdbData: newTmdbData, epData: playerState.epData || {} });
      updatePlayerTitle(data.name, playerState.season, playerState.episode);
      persistProgress(mediaId, playerState.season, playerState.episode).catch(console.error);
      addToUserHistory({ id: mediaId, media_type: mediaType, title: data.name, poster_path: data.poster_path, vote_average: data.vote_average, year: data.first_air_date?.slice(0, 4), season: playerState.season, episode: playerState.episode }).catch(() => {});
      configureNextButton(newTmdbData);
      if (playerEpBtn) {
        playerEpBtn.style.display = 'flex';
        playerEpBtn.disabled = true;
        playerEpBtn.innerHTML = '<i class="fas fa-spinner fa-spin" aria-hidden="true"></i>';
        playerEpBtn.setAttribute('aria-label', 'Loading episodes');
        playerEpBtn.title = 'Loading episodes';
      }
      loadSeasonData(playerState.season).catch(handleSeasonLoadFailure);
    }
  } catch (err) {
    if (requestId !== _metadataRequestId || playerState.id !== mediaId) return;
    _metadataFailed = true;
    updatePlayerTitle('Video details unavailable', playerState.season, playerState.episode);
    playerRetryBtn?.classList.remove('hidden');
    showToast('Video details could not be loaded. Playback will keep trying.', 'error');
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

function configureNextButton(tmdbData = playerState.tmdbData) {
  if (!playerNextBtn || !tmdbData) return;
  const [nextS, nextE] = getNextEp(playerState.season, playerState.episode, tmdbData);
  playerNextBtn.style.display = 'flex';
  playerNextBtn.disabled = nextS === null;
  const label = nextS === null ? 'No next episode' : `Next episode: season ${nextS}, episode ${nextE}`;
  playerNextBtn.title = label;
  playerNextBtn.setAttribute('aria-label', label);
  playerNextBtn.onclick = nextS === null ? null : () => switchEpisode(nextS, nextE);
}

function saveCurrentEpisodeElapsed() {
  const minutesWatched = addSessionElapsed();
  const progress = getCurrentProgress();
  const existing = progress[String(playerState.id)];
  if (existing) existing.elapsedMinutes = (existing.elapsedMinutes || 0) + minutesWatched;
  setCurrentProgress(progress);
  resetWatchSession();
}

async function switchEpisode(season, episode, knownName = '') {
  if (!playerState.id || playerState.type !== 'tv') return;
  saveCurrentEpisodeElapsed();
  setPlayerState({ ...playerState, season: Number(season), episode: Number(episode) });
  updatePlayerTitle(playerState.tmdbData?.title || 'Series', season, episode, knownName);
  configureNextButton();
  persistProgress(playerState.id, season, episode, { elapsedMinutes: 0 }).catch(console.error);
  loadPlayerIframe();
  window.dispatchEvent(new CustomEvent('watchStarted', { detail: { id: playerState.id, type: 'tv', season: Number(season), episode: Number(episode) } }));
  loadSeasonData(season).catch(handleSeasonLoadFailure);

  const info = playerState.tmdbData;
  if (info) {
    addToUserHistory({ id: playerState.id, media_type: 'tv', title: info.title, poster_path: info.poster_path, vote_average: info.vote_average, year: info.year, season: Number(season), episode: Number(episode) }).catch(() => {});
  }
}

function seasonCacheKey(showId, season) {
  return `${showId}:${Number(season)}`;
}

async function loadSeasonData(season) {
  const showId = playerState.id;
  if (!showId || playerState.type !== 'tv') return null;
  const key = seasonCacheKey(showId, season);
  let seasonData = _seasonCache.get(key);
  if (!seasonData) {
    const data = await fetchWithAuth(`${BASE_URL}/tv/${showId}/season/${season}?language=en-US`);
    seasonData = {
      name: data.name,
      air_date: data.air_date,
      episodes: data.episodes.map(ep => ({
        name: ep.name,
        episode_number: ep.episode_number,
        season_number: ep.season_number,
        air_date: ep.air_date,
        runtime: ep.runtime
      }))
    };
    _seasonCache.set(key, seasonData);
  }
  if (playerState.id !== showId) return seasonData;
  setPlayerState({ ...playerState, epData: { ...(playerState.epData || {}), [Number(season)]: seasonData } });

  if (String(playerState.season) === String(season)) {
    const currentEp = seasonData.episodes.find(ep => String(ep.episode_number) === String(playerState.episode));
    updatePlayerTitle(playerState.tmdbData?.title || 'Series', playerState.season, playerState.episode, currentEp?.name || '');
    if (currentEp?.runtime) {
      const progress = getCurrentProgress();
      if (progress[String(showId)]) {
        progress[String(showId)].episodeRuntime = currentEp.runtime;
        setCurrentProgress(progress);
      }
    }
  }
  if (playerEpBtn) {
    playerEpBtn.disabled = false;
    playerEpBtn.innerHTML = '<i class="fas fa-list" aria-hidden="true"></i>';
    playerEpBtn.setAttribute('aria-label', 'Episodes');
    playerEpBtn.title = 'Episodes';
    playerEpBtn.onclick = (event) => { event.stopPropagation(); openEpPopover(); };
  }
  return seasonData;
}

function handleSeasonLoadFailure(error) {
  console.error('[episode metadata]', error);
  if (playerEpBtn && !Object.keys(playerState.epData || {}).length) {
    playerEpBtn.disabled = false;
    playerEpBtn.innerHTML = '<i class="fas fa-rotate-right" aria-hidden="true"></i>';
    playerEpBtn.setAttribute('aria-label', 'Retry loading episodes');
    playerEpBtn.title = 'Retry loading episodes';
    playerEpBtn.onclick = () => loadSeasonData(playerState.season).catch(handleSeasonLoadFailure);
  }
}

function openEpPopover() {
  if (!epPopoverOverlay) return;
  if (!playerState.tmdbData) {
    showToast('Series details are still loading…', 'info');
    return;
  }
  epPopoverOverlay.classList.remove('hidden');
  showSeasons(playerState.tmdbData.title);
}

function closeEpPopover() {
  epPopoverOverlay?.classList.add('hidden');
}

function renderSeasonTabs(activeSeason) {
  if (!epPopoverTabs || !playerState.tmdbData) return;
  epPopoverTabs.innerHTML = playerState.tmdbData.seasons.map(season => {
    const s = playerState.epData?.[season];
    const label = s?.name || `Season ${season}`;
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
  if (!epPopoverList || !playerState.tmdbData) return;
  renderSeasonTabs(playerState.season);
  showEpisodes(playerState.season);
}

async function showEpisodes(season) {
  setPlayerState({ ...playerState, view: 'episodes' });
  if (!epPopoverList) return;
  renderSeasonTabs(season);
  epPopoverList.innerHTML = '<li class="ep-popover-loading"><div class="item-name">Loading episodes…</div></li>';
  let s = playerState.epData?.[season];
  if (!s) {
    try {
      s = await loadSeasonData(season);
    } catch (error) {
      epPopoverList.innerHTML = '<li class="ep-popover-loading"><div class="item-name">Could not load this season. Select it to retry.</div></li>';
      handleSeasonLoadFailure(error);
      return;
    }
  }
  if (!s || epPopoverOverlay?.classList.contains('hidden')) return;
  if (epPopoverTitle) epPopoverTitle.innerText = s.name;
  if (epPopoverBack) epPopoverBack.style.visibility = 'visible';
  renderSeasonTabs(season);

  epPopoverList.replaceChildren(...s.episodes.map(ep => {
    const item = document.createElement('li');
    item.dataset.season = ep.season_number;
    item.dataset.episode = ep.episode_number;
    item.dataset.name = ep.name || '';
    if (String(ep.season_number) === String(playerState.season) && String(ep.episode_number) === String(playerState.episode)) item.classList.add('current-ep');
    const name = document.createElement('div');
    name.className = 'item-name';
    name.textContent = `E${ep.episode_number} - ${ep.name}`;
    const details = document.createElement('div');
    details.className = 'item-details';
    details.textContent = [ep.air_date || '', ep.runtime ? `${ep.runtime}m` : ''].filter(Boolean).join(' · ');
    item.append(name, details);
    return item;
  }));

  epPopoverList.querySelectorAll('li').forEach(li => {
    li.addEventListener('click', () => {
      const newSeason = li.getAttribute('data-season');
      const newEpisode = li.getAttribute('data-episode');
      closeEpPopover();
      switchEpisode(newSeason, newEpisode, li.dataset.name || '');
    });
  });
}
