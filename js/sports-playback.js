import { fetchSports } from './sports-api.js';
import { authorizeSportsStream, sportsStreamName } from './sports-data.js';

/** Separate from the movie player: live sports never write history or progress. */
export function createSportsPlayback({ video, onState, request = fetchSports, loadHls = () => import('hls.js') }) {
  let generation = 0, controller = null, hls = null, timeout = null, listeners = [];
  const clearStartupTimeout = () => { clearTimeout(timeout); timeout = null; };

  function stop() {
    generation++;
    controller?.abort(); controller = null;
    clearStartupTimeout();
    listeners.forEach(([name, listener]) => video.removeEventListener(name, listener));
    listeners = [];
    hls?.destroy(); hls = null;
    video.pause();
    video.removeAttribute('src');
    video.load();
  }

  async function start(rawUrl, retry = 0) {
    stop();
    const run = generation;
    controller = new AbortController();
    const signal = controller.signal;
    const current = () => run === generation && !signal.aborted;
    const state = (name, message) => { if (current()) onState(name, message); };
    const failed = () => {
      if (!current()) return;
      clearStartupTimeout();
      if (retry < 1) start(rawUrl, retry + 1);
      else state('error', 'This stream is unavailable. Retry or choose another stream.');
    };
    const listen = (name, listener) => {
      video.addEventListener(name, listener);
      listeners.push([name, listener]);
    };
    const play = () => {
      if (!current()) return;
      state('ready', 'Press play if the stream does not start automatically.');
      video.play()?.catch(() => {
        if (!current()) return;
        clearStartupTimeout();
        state('paused', 'Press play to start the live stream.');
      });
    };
    state('loading', 'Connecting to Camel…');
    try {
      const token = await request('token', { streamName: sportsStreamName(rawUrl) }, signal);
      if (!current()) return;
      const url = await authorizeSportsStream(rawUrl, token);
      if (!current()) return;
      listen('playing', () => { clearStartupTimeout(); state('playing', 'Live stream playing'); });
      listen('waiting', () => state('buffering', 'Buffering live stream…'));
      listen('pause', () => state('paused', 'Paused'));
      listen('error', failed);
      timeout = setTimeout(() => state('error', 'No video received yet. Retry or choose another stream.'), 25000);
      if (video.canPlayType('application/vnd.apple.mpegurl')) {
        // WKWebView/Safari uses the operating system's HLS decoder, no browser shell.
        video.src = url;
        play();
      } else {
        const { default: Hls } = await loadHls();
        if (!current()) return;
        if (!Hls.isSupported()) throw new Error('Live video is not supported by this device.');
        hls = new Hls({ enableWorker: false, maxBufferLength: 30, backBufferLength: 30 });
        hls.on(Hls.Events.MANIFEST_PARSED, play);
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (!current() || !data.fatal) return;
          failed();
        });
        hls.loadSource(url);
        hls.attachMedia(video);
      }
    } catch (error) {
      if (!current()) return;
      clearStartupTimeout();
      state('error', error?.message || 'This stream could not be loaded. Try again.');
    }
  }

  return { start, stop };
}
