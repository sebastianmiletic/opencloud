import { fetchSports } from './sports-api.js';
import { authorizeSportsStream, sportsStreamName } from './sports-data.js';

/** Independent live playback. Never writes movie history, accounts or progress. */
export function createSportsPlayback({ video, onState, onSourceChange = () => {}, request = fetchSports,
  loadHls = () => import('hls.js'), timers = globalThis, now = Date.now }) {
  let generation = 0, attempt = 0, controller = null, hls = null, listeners = [];
  let startupTimer = null, refreshTimer = null, watchdog = null;
  let sources = [], selected = 0, attempted = new Set(), tokenRetries = new Set();
  let refreshPending = false, wantsPlayback = true;

  function clearTimers() {
    timers.clearTimeout(startupTimer); startupTimer = null;
    timers.clearTimeout(refreshTimer); refreshTimer = null;
    timers.clearInterval(watchdog); watchdog = null;
  }

  function release() {
    attempt++;
    controller?.abort(); controller = null;
    clearTimers();
    listeners.forEach(([name, listener]) => video.removeEventListener(name, listener));
    listeners = [];
    hls?.destroy(); hls = null;
    video.pause();
    video.removeAttribute('src');
    video.load();
  }

  function stop() {
    generation++;
    release();
    sources = []; attempted.clear(); tokenRetries.clear(); refreshPending = false;
  }

  async function connect(index, message = 'Connecting to live stream…') {
    release();
    const run = generation, currentAttempt = attempt;
    selected = index; attempted.add(index); refreshPending = false;
    controller = new AbortController();
    const signal = controller.signal;
    const current = () => run === generation && currentAttempt === attempt && !signal.aborted;
    const state = (name, text) => { if (current()) onState(name, text); };
    let failed = false, mediaRecovery = false, recovering = false, startedPlaying = false;
    let lastProgress = now(), lastTime = video.currentTime;

    function fail(text = 'No working stream is available for this match right now.', reauthorize = false) {
      if (!current() || failed) return;
      failed = true;
      if ((reauthorize || sources.length === 1) && !tokenRetries.has(index)) {
        tokenRetries.add(index);
        void connect(index, 'Refreshing stream connection…');
        return;
      }
      const next = sources.findIndex((_source, candidate) => !attempted.has(candidate));
      if (next >= 0) {
        void connect(next, 'Trying another available stream…');
      } else {
        release();
        onState('error', text);
      }
    }

    const listen = (name, listener) => {
      video.addEventListener(name, listener);
      listeners.push([name, listener]);
    };
    const playVideo = () => {
      if (!current() || !wantsPlayback) return;
      state('ready', 'Starting live video…');
      Promise.resolve(video.play()).catch(() => {
        if (!current()) return;
        timers.clearTimeout(startupTimer); startupTimer = null;
        state('paused', 'Press play to watch the live stream.');
      });
    };

    state('loading', message);
    onSourceChange(index);
    // Includes token requests and the lazy HLS import, not only the media load.
    startupTimer = timers.setTimeout(() => fail('The provider is not delivering video. Try again shortly.'), 25000);
    try {
      const rawUrl = sources[index];
      const token = await request('token', { streamName: sportsStreamName(rawUrl) }, signal);
      if (!current()) return;
      const url = await authorizeSportsStream(rawUrl, token);
      if (!current()) return;
      listen('playing', () => {
        startedPlaying = true; recovering = false; lastProgress = now(); lastTime = video.currentTime;
        timers.clearTimeout(startupTimer); startupTimer = null;
        state('playing', 'Live');
      });
      listen('waiting', () => { if (wantsPlayback) state('buffering', 'Buffering…'); });
      listen('pause', () => {
        if (recovering || (!startedPlaying && video.readyState < 2)) return;
        wantsPlayback = false;
        timers.clearTimeout(startupTimer); startupTimer = null;
        state('paused', 'Paused');
      });
      listen('play', () => {
        wantsPlayback = true;
        if (refreshPending) void connect(index, 'Reconnecting to the live stream…');
      });
      listen('ended', () => { clearTimers(); state('ended', 'This live stream has ended.'); });
      listen('error', () => { if (!hls) fail(); });
      listen('timeupdate', () => {
        if (video.currentTime !== lastTime) {
          lastProgress = now(); lastTime = video.currentTime;
        }
      });
      watchdog = timers.setInterval(() => {
        if (!current() || !startedPlaying || video.paused || video.ended) return;
        if (video.currentTime !== lastTime) {
          lastTime = video.currentTime; lastProgress = now();
        } else if (now() - lastProgress > 15000) {
          fail('The live feed stopped responding. Try again shortly.');
        }
      }, 2000);
      // Camel's authorization expires. Renew before that, including native HLS.
      const expires = parseInt(token.txTime, 16) * 1000;
      if (Number.isFinite(expires) && expires > now()) {
        refreshTimer = timers.setTimeout(() => {
          if (!current()) return;
          if (video.paused || !wantsPlayback) refreshPending = true;
          else void connect(index, 'Refreshing live stream…');
        }, Math.min(2147483647, Math.max(10000, expires - now() - 30000)));
      }
      if (video.canPlayType('application/vnd.apple.mpegurl')) {
        // WKWebView/Safari stays on the operating system's native HLS decoder.
        video.src = url;
        if (wantsPlayback) playVideo();
        else state('paused', 'Paused');
      } else {
        const { default: Hls } = await loadHls();
        if (!current()) return;
        if (!Hls.isSupported()) {
          release();
          onState('error', 'This device does not support live HLS video.');
          return;
        }
        hls = new Hls({ enableWorker: false, maxBufferLength: 30, backBufferLength: 30,
          manifestLoadingTimeOut: 10000, manifestLoadingMaxRetry: 1,
          levelLoadingTimeOut: 10000, levelLoadingMaxRetry: 2,
          fragLoadingTimeOut: 12000, fragLoadingMaxRetry: 2,
          liveSyncDurationCount: 3, maxLiveSyncPlaybackRate: 1.2 });
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          if (wantsPlayback) playVideo();
          else state('paused', 'Paused');
        });
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (!current() || !data.fatal) return;
          if (data.type === Hls.ErrorTypes?.MEDIA_ERROR && !mediaRecovery && hls.recoverMediaError) {
            mediaRecovery = true; recovering = true;
            timers.clearTimeout(startupTimer);
            startupTimer = timers.setTimeout(() => fail(), 25000);
            hls.recoverMediaError();
            state('buffering', 'Recovering live video…');
            return;
          }
          const status = data.response?.code || data.response?.status;
          fail(undefined, status === 401 || status === 403);
        });
        hls.loadSource(url);
        hls.attachMedia(video);
      }
    } catch (error) {
      if (current()) fail(error?.message || 'The live stream could not be loaded.');
    }
  }

  async function start(available, preferred = 0) {
    stop();
    sources = (Array.isArray(available) ? available : [available]).map(source => typeof source === 'string' ? source : source?.url).filter(Boolean).slice(0, 8);
    if (!sources.length) { onState('error', 'No live streams are available for this match.'); return; }
    selected = Number.isInteger(preferred) && sources[preferred] ? preferred : 0;
    attempted = new Set(); tokenRetries = new Set(); wantsPlayback = true;
    await connect(selected);
  }

  async function play() {
    if (!sources.length) return;
    wantsPlayback = true;
    if (refreshPending) return connect(selected, 'Reconnecting to the live stream…');
    try { await video.play(); }
    catch { onState('paused', 'Your browser blocked playback. Use the video play control.'); }
  }

  return { start, stop, play };
}
