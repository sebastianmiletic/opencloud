/** Player Overlay & Episode Picker */
import { playerState, setPlayerState, setWatchProgress } from './state.js';
import { getProviderCandidates, getProviderUrlFor, getSettings, saveSettings, PROVIDERS } from './config.js';
import { fetchWithAuth } from './api.js';
import { BASE_URL } from './config.js';
import { showToast, lockScroll, unlockScroll } from './utils.js';
import { recordWatchSession } from './supabase.js';
import { getWatchProgress, saveWatchProgress, syncWatchProgressItem, addToUserHistory } from './storage.js';
import { invokeDesktop, isTauri, openExternal } from './desktop.js';
import { connectionScoreForLatency, connectionScoreForPlayback, stallThresholdsForConnection } from './player-health.js';
import { getSavedPlaybackDuration, getSavedPlaybackSeconds, isPlausiblePlaybackSample, mergePlaybackCheckpoint } from './playback-progress.js';

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
let _headerHideTimer = null;
let _lastHeaderToggleAt = Number.NEGATIVE_INFINITY;
let _metadataRequestId = 0;
let _playerFrameSessionToken = 0;
let _activePlaybackFrameId = null;
let _activePlaybackDuration = 0;
let _activePlaybackFrameSeenAt = 0;
let _lastPlaybackCheckpoint = null;
let _lastCloudCheckpointAt = 0;
let _lastLocalCheckpointAt = 0;
let _resumeConfirmationKey = null;
let _checkpointResolvers = [];
let _sessionResumePoint = null;
let _playbackWatchdogTimer = null;
let _playbackBufferingSince = 0;
let _playbackRecoverySent = false;
let _playbackLastAdvancedAt = 0;
let _playbackLastSeconds = null;
let _playbackSignalsActive = false;
const _seasonCache = new Map();
const _preconnectedProviderOrigins = new Set();
const PLAYER_HEADER_IDLE_MS = 5000;
const PLAYER_CONTROL_CHANNEL = '__opencloud_player_control_v1__';
const CLOUD_CHECKPOINT_INTERVAL_MS = 30000;
const LOCAL_CHECKPOINT_INTERVAL_MS = 5000;

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

function clearPlaybackWatchdog() {
  if (_playbackWatchdogTimer) clearTimeout(_playbackWatchdogTimer);
  _playbackWatchdogTimer = null;
}

function resetPlaybackMonitoring() {
  clearPlaybackWatchdog();
  _playbackBufferingSince = 0;
  _playbackRecoverySent = false;
  _playbackLastAdvancedAt = 0;
  _playbackLastSeconds = null;
  _playbackSignalsActive = false;
}

function sendPlaybackRecovery() {
  const sessionKey = playbackContextKey();
  if (!playerFrame?.contentWindow || !sessionKey) return;
  playerFrame.contentWindow.postMessage({
    channel: PLAYER_CONTROL_CHANNEL,
    type: 'recover',
    sessionKey
  }, '*');
}

function finishPlaybackStall(sample = null) {
  const wasBuffering = _playbackBufferingSince > 0;
  clearPlaybackWatchdog();
  _playbackBufferingSince = 0;
  _playbackRecoverySent = false;
  if (!sample) return;
  const score = adjustScoreForConnection(connectionScoreForPlayback(
    sample.bufferedAheadSeconds,
    sample.readyState,
    false,
    sample.mediaErrorCode
  ));
  _lastFrameScore = score;
  setPlayerHealth(score <= 2 ? 'slow' : 'ready', `${providerName(_currentProviderKey)} · ${healthQuality(score)}`, false, score);
  if (wasBuffering) console.info('[player health] playback recovered');
}

function evaluatePlaybackStall(providerKey, sessionKey) {
  _playbackWatchdogTimer = null;
  if (!_playbackBufferingSince
    || providerKey !== _currentProviderKey
    || sessionKey !== playbackContextKey()
    || playerOverlay?.classList.contains('hidden')) return;

  const thresholds = stallThresholdsForConnection(
    navigator.connection || navigator.mozConnection || navigator.webkitConnection
  );
  const elapsed = Date.now() - _playbackBufferingSince;
  if (!_playbackRecoverySent && elapsed >= thresholds.recoverAfterMs) {
    _playbackRecoverySent = true;
    sendPlaybackRecovery();
    setPlayerHealth('buffering', `${providerName(providerKey)} · Recovering playback…`, false, 1);
  }

  if (elapsed >= thresholds.failoverAfterMs) {
    const reason = `${providerName(providerKey)} kept buffering`;
    clearPlaybackWatchdog();
    if (getSettings().autoProviderFailover === true) {
      requestFreshPlaybackCheckpoint(180).catch(() => false).finally(() => {
        if (_playbackBufferingSince
          && providerKey === _currentProviderKey
          && sessionKey === playbackContextKey()) {
          _playbackBufferingSince = 0;
          tryNextProvider(reason);
        }
      });
    } else {
      _playbackBufferingSince = 0;
      setPlayerHealth('slow', `${providerName(providerKey)} · Playback stalled`, true, 1);
    }
    return;
  }

  _playbackWatchdogTimer = setTimeout(
    () => evaluatePlaybackStall(providerKey, sessionKey),
    Math.min(1000, Math.max(250, thresholds.failoverAfterMs - elapsed))
  );
}

function beginPlaybackStall(sample, eventName) {
  if (sample.paused || sample.ended) return;
  const now = Date.now();
  if (!_playbackBufferingSince) {
    const thresholds = stallThresholdsForConnection(
      navigator.connection || navigator.mozConnection || navigator.webkitConnection
    );
    _playbackBufferingSince = Number(sample.mediaErrorCode) > 0
      ? now - thresholds.failoverAfterMs + 2500
      : now;
    _playbackRecoverySent = false;
  }
  const label = Number(sample.mediaErrorCode) > 0 || eventName === 'error'
    ? 'Playback error'
    : 'Buffering';
  setPlayerHealth('buffering', `${providerName(_currentProviderKey)} · ${label}…`, false, 1);
  if (!_playbackWatchdogTimer) {
    _playbackWatchdogTimer = setTimeout(
      () => evaluatePlaybackStall(_currentProviderKey, playbackContextKey()),
      500
    );
  }
}

function updatePlaybackHealth(detail) {
  const sample = detail.sample || {};
  const eventName = String(detail.eventName || '');
  const now = Date.now();
  const seconds = Number(sample.seconds);
  const previousSeconds = _playbackLastSeconds;
  const advanced = Number.isFinite(previousSeconds)
    && Number.isFinite(seconds)
    && (seconds > previousSeconds + 0.2 || seconds < previousSeconds - 1);

  _playbackSignalsActive = true;
  if (Number.isFinite(seconds)) _playbackLastSeconds = seconds;

  if (sample.paused || sample.ended || eventName === 'pause' || eventName === 'ended') {
    clearPlaybackWatchdog();
    _playbackBufferingSince = 0;
    _playbackRecoverySent = false;
    return;
  }

  if (advanced || eventName === 'playing' || eventName === 'seeked') {
    _playbackLastAdvancedAt = now;
    finishPlaybackStall(sample);
    return;
  }

  const explicitStall = ['waiting', 'stalled', 'error', 'abort'].includes(eventName)
    || Number(sample.mediaErrorCode) > 0;
  const stoppedAdvancing = _playbackLastAdvancedAt > 0
    && now - _playbackLastAdvancedAt >= 3500
    && ['heartbeat', 'recovery-attempt'].includes(eventName);
  if (explicitStall || stoppedAdvancing) beginPlaybackStall(sample, eventName);
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
    const playbackRecentlyAdvanced = _playbackSignalsActive
      && Date.now() - _playbackLastAdvancedAt < 8000;
    if (playbackRecentlyAdvanced) {
      _providerProbeFailures = 0;
      return;
    }
    if (score === 1) _providerProbeFailures += 1;
    else _providerProbeFailures = 0;

    if (_providerProbeFailures >= 2 && getSettings().autoProviderFailover === true) {
      tryNextProvider(`${providerName(providerKey)} stopped responding`);
      return;
    }

    if (_playbackBufferingSince) return;
    const state = score <= 2 ? 'slow' : 'ready';
    setPlayerHealth(state, `${providerName(providerKey)} · ${healthQuality(score)}`, score <= 1, score, result?.latencyMs);
  } catch (error) {
    if (probeToken !== _providerProbeToken || providerKey !== _currentProviderKey) return;
    console.warn('[provider probe]', error);
    if (_playbackSignalsActive && Date.now() - _playbackLastAdvancedAt < 8000) return;
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

function currentPlaybackContext() {
  if (!playerState.id || !playerState.type) return null;
  return {
    id: String(playerState.id),
    type: playerState.type,
    season: playerState.type === 'tv' ? Number(playerState.season) || 1 : null,
    episode: playerState.type === 'tv' ? Number(playerState.episode) || 1 : null
  };
}

function playbackContextKey(context = currentPlaybackContext()) {
  if (!context) return '';
  return context.type === 'tv'
    ? `tv:${context.id}:s${context.season}:e${context.episode}`
    : `movie:${context.id}`;
}

function getCurrentResumePoint() {
  const context = currentPlaybackContext();
  if (!context) return { seconds: 0, durationSeconds: 0 };
  const progressItem = getCurrentProgress()[context.id];
  return {
    seconds: getSavedPlaybackSeconds(progressItem, context.type, context.season, context.episode),
    durationSeconds: getSavedPlaybackDuration(progressItem, context.type, context.season, context.episode)
  };
}

function sendResumeToProviderFrames() {
  const sessionKey = playbackContextKey();
  if (!playerFrame?.contentWindow || !sessionKey) return;
  const resumePoint = _sessionResumePoint?.contextKey === sessionKey && _sessionResumePoint.active
    ? _sessionResumePoint
    : { seconds: 0, durationSeconds: 0 };
  playerFrame.contentWindow.postMessage({
    channel: PLAYER_CONTROL_CHANNEL,
    type: 'resume',
    seconds: resumePoint.seconds,
    durationSeconds: resumePoint.durationSeconds,
    sessionKey
  }, '*');
}

function requestFreshPlaybackCheckpoint(timeoutMs = 120) {
  const sessionKey = playbackContextKey();
  if (!playerFrame?.contentWindow || !sessionKey) return Promise.resolve(false);
  return new Promise(resolve => {
    const finish = (saved) => {
      _checkpointResolvers = _checkpointResolvers.filter(candidate => candidate !== finish);
      resolve(saved);
    };
    _checkpointResolvers.push(finish);
    playerFrame.contentWindow.postMessage({
      channel: PLAYER_CONTROL_CHANNEL,
      type: 'checkpoint',
      sessionKey
    }, '*');
    setTimeout(() => finish(false), timeoutMs);
  });
}

function scheduleResumeAttempts() {
  const sessionToken = _playerFrameSessionToken;
  [0, 300, 1000, 3000].forEach(delay => {
    setTimeout(() => {
      if (sessionToken === _playerFrameSessionToken && !playerOverlay?.classList.contains('hidden')) {
        sendResumeToProviderFrames();
      }
    }, delay);
  });
}

function formatPlaybackTime(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainder = total % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    : `${minutes}:${String(remainder).padStart(2, '0')}`;
}

function isActivePlaybackSample(detail) {
  if (detail?.sessionKey !== playbackContextKey()) return false;
  if (!isPlausiblePlaybackSample(detail?.sample)) return false;
  if (_sessionResumePoint?.active && _sessionResumePoint.contextKey === detail.sessionKey) {
    if (Number(detail.sample.seconds) < _sessionResumePoint.seconds - 2) return false;
  }
  const now = Date.now();
  const frameId = String(detail.frameId || 'provider-frame');
  const duration = Number(detail.sample.durationSeconds);
  const context = currentPlaybackContext();
  const progressItem = context ? getCurrentProgress()[context.id] : null;
  const expectedDuration = context
    ? getSavedPlaybackDuration(progressItem, context.type, context.season, context.episode)
    : 0;
  if (expectedDuration >= 180) {
    const allowedDifference = Math.max(30, expectedDuration * 0.08);
    if (Math.abs(duration - expectedDuration) > allowedDifference) return false;
  }
  if (!_activePlaybackFrameId || _activePlaybackFrameId === frameId) {
    _activePlaybackFrameId = frameId;
  } else {
    const activeFrameStale = now - _activePlaybackFrameSeenAt > 8000;
    const clearlyLongerContent = duration > _activePlaybackDuration + 60;
    if (!activeFrameStale && !clearlyLongerContent) return false;
    _activePlaybackFrameId = frameId;
  }
  _activePlaybackDuration = duration;
  _activePlaybackFrameSeenAt = now;
  return true;
}

function persistPlaybackSample(detail, forceCloud = false) {
  if (!isActivePlaybackSample(detail)) return false;
  const context = currentPlaybackContext();
  if (!context) return false;
  const now = Date.now();
  _lastPlaybackCheckpoint = { contextKey: playbackContextKey(context), detail };
  if (_sessionResumePoint?.contextKey === _lastPlaybackCheckpoint.contextKey
    && Number(detail.sample.seconds) >= _sessionResumePoint.seconds - 2) {
    _sessionResumePoint.active = false;
  }
  const checkpointResolvers = _checkpointResolvers.splice(0);
  checkpointResolvers.forEach(resolve => resolve(true));

  const shouldPersistLocal = forceCloud || now - _lastLocalCheckpointAt >= LOCAL_CHECKPOINT_INTERVAL_MS;
  if (!shouldPersistLocal) return true;
  _lastLocalCheckpointAt = now;
  const progress = { ...getCurrentProgress() };
  const merged = mergePlaybackCheckpoint(progress[context.id], context, {
    seconds: detail.sample.seconds,
    durationSeconds: detail.sample.durationSeconds,
    updatedAt: new Date(now).toISOString()
  });
  progress[context.id] = merged;
  setCurrentProgress(progress);

  const shouldSyncCloud = forceCloud || now - _lastCloudCheckpointAt >= CLOUD_CHECKPOINT_INTERVAL_MS;
  if (shouldSyncCloud) {
    _lastCloudCheckpointAt = now;
    syncWatchProgressItem(
      context.id,
      context.type,
      context.season,
      context.episode,
      merged.progress_seconds
    ).catch(error => console.warn('[playback checkpoint sync]', error));
  }
  return true;
}

function flushPlaybackCheckpoint() {
  const contextKey = playbackContextKey();
  if (!_lastPlaybackCheckpoint || _lastPlaybackCheckpoint.contextKey !== contextKey) return false;
  return persistPlaybackSample(_lastPlaybackCheckpoint.detail, true);
}

function handlePlayerFrameInput(detail) {
  if (detail?.type === 'toggle-header') handlePlayerHeaderShortcut();
  if (detail?.type === 'pointer-activity') showPlayerHeaderForMouseActivity();
  if (detail?.type === 'bridge-ready') sendResumeToProviderFrames();
  if (detail?.type === 'playback-progress') {
    const forceCloud = ['pause', 'seeked', 'ended', 'pagehide'].includes(detail.eventName);
    if (persistPlaybackSample(detail, forceCloud)) updatePlaybackHealth(detail);
  }
  if (detail?.type === 'resume-applied') {
    if (detail.sessionKey !== playbackContextKey()) return;
    if (_sessionResumePoint?.contextKey === detail.sessionKey
      && Number(detail.seconds) >= _sessionResumePoint.seconds - 2) {
      _sessionResumePoint.active = false;
    }
    const key = `${playbackContextKey()}:${Math.round(Number(detail.seconds) || 0)}`;
    if (Number(detail.seconds) >= 1 && key !== _resumeConfirmationKey) {
      _resumeConfirmationKey = key;
      showToast(`Resumed at ${formatPlaybackTime(detail.seconds)}`, 'info');
    }
  }
}

async function persistProgress(id, season, episode, extra = {}) {
  if (!id || season == null || episode == null) return;
  try {
    const sid = String(id);
    const progress = getCurrentProgress();
    const existing = progress[sid] || {};
    const playbackSeconds = extra.playbackSeconds
      ?? getSavedPlaybackSeconds(existing, 'tv', season, episode);
    const durationSeconds = getSavedPlaybackDuration(existing, 'tv', season, episode);
    const merged = {
      ...existing,
      season: parseInt(season),
      episode: parseInt(episode),
      updated_at: new Date().toISOString(),
      playbackSeconds,
      progress_seconds: Math.round(playbackSeconds),
      durationSeconds,
      elapsedMinutes: extra.elapsedMinutes ?? (playbackSeconds / 60),
      episodeRuntime: extra.episodeRuntime ?? (durationSeconds > 0 ? durationSeconds / 60 : null),
      ...extra
    };
    progress[sid] = merged;
    setCurrentProgress(progress);
    await syncWatchProgressItem(sid, 'tv', merged.season, merged.episode, merged.progress_seconds);
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
      if (_lastPlaybackCheckpoint?.contextKey === playbackContextKey()) {
        _playerOpenedAt = Date.now();
        return;
      }
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
  if (_lastPlaybackCheckpoint?.contextKey === playbackContextKey()) {
    flushPlaybackCheckpoint();
    _playerOpenedAt = Date.now();
    return;
  }
  const minutes = addSessionElapsed();
  const sid = String(p.id);
  const progress = getCurrentProgress();
  const existing = progress[sid] || {};
  progress[sid] = {
    ...existing,
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
  if (document.hidden) {
    flushPlaybackCheckpoint();
    pauseWatch();
  }
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
    if (!_playbackSignalsActive && !_playbackBufferingSince) {
      setPlayerHealth(score <= 2 ? 'slow' : 'ready', `${providerName(_currentProviderKey)} · ${healthQuality(score)}`, false, score, latency);
    }
    startProviderHealthProbes();
    scheduleResumeAttempts();
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
  flushPlaybackCheckpoint();
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

function clearPlayerHeaderHideTimer() {
  if (_headerHideTimer) clearTimeout(_headerHideTimer);
  _headerHideTimer = null;
}

function showPlayerHeaderForMouseActivity() {
  if (!_headerAutohide || !document.body.classList.contains('device-laptop')) return;
  playerOverlay?.classList.add('player-header-visible');
  clearPlayerHeaderHideTimer();
  _headerHideTimer = setTimeout(() => {
    _headerHideTimer = null;
    playerOverlay?.classList.remove('player-header-visible');
  }, PLAYER_HEADER_IDLE_MS);
}

function setPlayerHeaderAutohide(enabled, notify = true, persist = false) {
  const isLaptop = document.body.classList.contains('device-laptop');
  _headerAutohide = Boolean(enabled && isLaptop);
  clearPlayerHeaderHideTimer();
  playerOverlay?.classList.toggle('player-header-autohide', _headerAutohide);
  playerOverlay?.classList.remove('player-header-visible');
  playerOverlay?.setAttribute('data-header-mode', _headerAutohide ? 'auto-hide' : 'fixed');
  if (_headerAutohide && document.activeElement instanceof HTMLElement && document.activeElement.closest('.player-header-bar')) {
    document.activeElement.blur();
  }
  if (persist) {
    const settings = getSettings();
    if (settings.playerHeaderAutoHide !== _headerAutohide) {
      saveSettings({ ...settings, playerHeaderAutoHide: _headerAutohide });
    }
  }
  if (!notify) return;
  showToast(
    _headerAutohide
      ? 'Player bar hidden. Move the mouse to show it for 5 seconds, or press T to restore it.'
      : 'Player bar will stay visible.',
    'info'
  );
}

function togglePlayerHeaderAutohide() {
  setPlayerHeaderAutohide(!_headerAutohide, true, true);
}

function handlePlayerHeaderShortcut() {
  if (playerOverlay?.classList.contains('hidden') || !document.body.classList.contains('device-laptop')) return false;
  const now = performance.now();
  if (now - _lastHeaderToggleAt < 250) return true;
  _lastHeaderToggleAt = now;
  togglePlayerHeaderAutohide();
  return true;
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
  playerOverlay?.addEventListener('mousemove', showPlayerHeaderForMouseActivity);
  window.addEventListener('opencloud:player-frame-input', (event) => {
    handlePlayerFrameInput(event.detail);
  });
  window.addEventListener('offline', () => {
    if (!playerOverlay?.classList.contains('hidden')) setPlayerHealth('failed', `${providerName(_currentProviderKey)} · Offline`, true, 1);
  });
  window.addEventListener('online', () => {
    if (!playerOverlay?.classList.contains('hidden')) probeCurrentProvider();
  });
  window.addEventListener('opencloud:device-layout', (event) => {
    const enabled = event.detail?.device === 'laptop' && getSettings().playerHeaderAutoHide === true;
    setPlayerHeaderAutohide(enabled, false);
  });
  document.addEventListener('fullscreenchange', () => updateFullscreenButton(Boolean(document.fullscreenElement)));
  document.addEventListener('webkitfullscreenchange', () => updateFullscreenButton(Boolean(document.webkitFullscreenElement)));

  document.addEventListener('keydown', (e) => {
    const playerIsOpen = playerOverlay && !playerOverlay.classList.contains('hidden');
    const target = e.target;
    const isTyping = target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
    if (playerIsOpen && !isTyping && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === 't') {
      if (!handlePlayerHeaderShortcut()) return;
      e.preventDefault();
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

function getPlayerSrc(providerKey = _currentProviderKey) {
  const p = playerState;
  if (p.type === 'movie') {
    return getProviderUrlFor(providerKey, 'movie', p.id);
  }
  return getProviderUrlFor(providerKey, 'tv', p.id, p.season, p.episode);
}

function preconnectProvider(url) {
  try {
    const origin = new URL(url).origin;
    if (_preconnectedProviderOrigins.has(origin)) return;
    _preconnectedProviderOrigins.add(origin);
    const link = document.createElement('link');
    link.rel = 'preconnect';
    link.href = origin;
    link.crossOrigin = 'anonymous';
    document.head.appendChild(link);
  } catch (_) {}
}

function loadPlayerIframe() {
  if (!playerFrame) return;
  flushPlaybackCheckpoint();
  _playerFrameSessionToken += 1;
  _activePlaybackFrameId = null;
  _activePlaybackDuration = 0;
  _activePlaybackFrameSeenAt = 0;
  resetPlaybackMonitoring();
  const resumePoint = getCurrentResumePoint();
  _sessionResumePoint = {
    contextKey: playbackContextKey(),
    seconds: resumePoint.seconds,
    durationSeconds: resumePoint.durationSeconds,
    active: resumePoint.seconds >= 1
  };
  clearHealthTimer();
  stopProviderHealthProbes();
  if (!_currentProviderKey) resetProviderSession(playerState.type || 'movie');
  _attemptedProviders.add(_currentProviderKey);
  _frameLoadStartedAt = performance.now();
  _lastFrameScore = 1;
  setPlayerHealth('connecting', `Connecting to ${providerName(_currentProviderKey)}…`, false, 2);
  const playerSrc = getPlayerSrc();
  preconnectProvider(playerSrc);
  if (getSettings().autoProviderFailover === true) {
    const nextProvider = _providerCandidates.find(key => key !== _currentProviderKey && !_attemptedProviders.has(key));
    if (nextProvider) preconnectProvider(getPlayerSrc(nextProvider));
  }
  playerFrame.loading = 'eager';
  playerFrame.setAttribute('fetchpriority', 'high');
  playerFrame.src = playerSrc;
  scheduleResumeAttempts();
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  const initialLoadTimeoutMs = stallThresholdsForConnection(connection).failoverAfterMs === 20000 ? 20000 : 12000;
  _healthTimer = setTimeout(() => {
    handleProviderFailure(`${providerName(_currentProviderKey)} is taking too long`);
  }, initialLoadTimeoutMs);
}

export function closePlayer() {
  if (!playerOverlay) return;
  _metadataRequestId += 1;
  setPlayerHeaderAutohide(false, false);
  if (_isPlayerFullscreen) setPlayerFullscreen(false);
  requestFreshPlaybackCheckpoint().catch(() => {});
  flushPlaybackCheckpoint();
  flushElapsedAndSave();
  _playerFrameSessionToken += 1;
  stopProgressInterval();
  stopFrameMonitoring();
  clearHealthTimer();
  resetPlaybackMonitoring();
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
    _activePlaybackFrameId = null;
    _lastPlaybackCheckpoint = null;
    _sessionResumePoint = null;
    setPlayerState({ id: null, type: null, season: 1, episode: 1, tmdbData: null, epData: null, view: 'seasons' });
    unlockScroll();
  }, 150);
}

export async function openPlayer(id, type, season, episode) {
  if (!playerOverlay || !playerFrame) return;

  _lastHeaderToggleAt = Number.NEGATIVE_INFINITY;
  setPlayerHeaderAutohide(getSettings().playerHeaderAutoHide === true, false);

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
  _activePlaybackFrameId = null;
  _activePlaybackDuration = 0;
  _activePlaybackFrameSeenAt = 0;
  _lastPlaybackCheckpoint = null;
  _lastCloudCheckpointAt = 0;
  _lastLocalCheckpointAt = 0;
  _resumeConfirmationKey = null;
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
  if (flushPlaybackCheckpoint()) {
    _playerOpenedAt = Date.now();
    resetWatchSession();
    return;
  }
  const minutesWatched = addSessionElapsed();
  const progress = getCurrentProgress();
  const existing = progress[String(playerState.id)];
  if (existing) existing.elapsedMinutes = (existing.elapsedMinutes || 0) + minutesWatched;
  setCurrentProgress(progress);
  resetWatchSession();
}

async function switchEpisode(season, episode, knownName = '') {
  if (!playerState.id || playerState.type !== 'tv') return;
  await requestFreshPlaybackCheckpoint();
  saveCurrentEpisodeElapsed();
  setPlayerState({ ...playerState, season: Number(season), episode: Number(episode) });
  _lastPlaybackCheckpoint = null;
  _resumeConfirmationKey = null;
  updatePlayerTitle(playerState.tmdbData?.title || 'Series', season, episode, knownName);
  configureNextButton();
  persistProgress(playerState.id, season, episode).catch(console.error);
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
