import { fetchSports } from './sports-api.js';
import { filterSportsMatches, isMainFootballMatch, normalizeSportsMatches, sportsStreams, sportsStreamLabel } from './sports-data.js';
import { createSportsPlayback } from './sports-playback.js';

let initialized = false;
const scheduleCache = new Map();
const CACHE_MS = 60000;
const HOME_DAYS = [0, 1];
const SEARCH_DAYS = [0, 1, 2];
const utcDate = (offset = 0) => {
  const day = new Date(); day.setUTCDate(day.getUTCDate() + offset);
  return day.toISOString().slice(0, 10);
};

function mergeMatches(groups) {
  const merged = new Map();
  groups.flat().forEach(match => {
    const previous = merged.get(match.id);
    if (!previous || match.live || (match.providerUpdatedAt || 0) > (previous.providerUpdatedAt || 0)) merged.set(match.id, match);
  });
  return [...merged.values()];
}

async function loadMatchDay(offset, { force = false, signal } = {}) {
  const date = utcDate(offset);
  const cached = scheduleCache.get(date);
  if (!force && cached && Date.now() - cached.loadedAt < CACHE_MS) return cached.matches;
  const data = await fetchSports('schedule', { date: date.replace(/-/g, '') }, signal);
  const matches = normalizeSportsMatches(data).filter(isMainFootballMatch).map(match => ({ ...match, scheduleDate: date }));
  scheduleCache.set(date, { matches, loadedAt: Date.now() });
  return matches;
}

/** Search only current/future real provider fixtures. Supports “country vs country”. */
export async function searchLiveGames(query) {
  if (String(query || '').trim().length < 2) return [];
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const settled = await Promise.allSettled(SEARCH_DAYS.map(offset => loadMatchDay(offset, { signal: controller.signal })));
    const available = settled.filter(result => result.status === 'fulfilled').map(result => result.value);
    if (!available.length) SEARCH_DAYS.forEach(offset => {
      const cached = scheduleCache.get(utcDate(offset));
      if (cached) available.push(cached.matches);
    });
    return filterSportsMatches(mergeMatches(available), { query })
      .filter(match => match.live || match.status === 1 || match.status === 13)
      .slice(0, 24);
  } finally { clearTimeout(timeout); }
}

let openKnownGame = () => false;
export function openLiveGame(matchId, options) { return openKnownGame(matchId, options); }

export function initLiveGames() {
  if (initialized) return;
  const section = document.getElementById('liveGamesSection');
  if (!section) return;
  initialized = true;
  const homeView = document.getElementById('homeView');
  const board = document.getElementById('liveGamesBoard');
  const liveList = document.getElementById('liveGamesLive');
  const upcomingList = document.getElementById('liveGamesUpcoming');
  const refresh = document.getElementById('liveGamesRefresh');
  const updated = document.getElementById('liveGamesUpdated');
  const player = document.getElementById('sportsPlayer');
  const video = document.getElementById('sportsVideo');
  const source = document.getElementById('sportsStream');
  const retry = document.getElementById('sportsRetry');
  const playButton = document.getElementById('sportsPlay');
  const sound = document.getElementById('sportsSound');
  const playbackStatus = document.getElementById('sportsPlaybackStatus');
  let matches = [], active = false, stale = false, timer = null, loadedAt = 0;
  let scheduleController = null, loading = false, selected = null, streams = [];
  let selection = 0, streamController = null;

  const playback = createSportsPlayback({ video, onSourceChange(index) { source.value = String(index); },
    onState(state, message) {
      playbackStatus.textContent = message; playbackStatus.dataset.state = state;
      player.dataset.state = state;
      document.getElementById('sportsVideoMessage').textContent = message;
      retry.classList.toggle('hidden', state !== 'error' && state !== 'ended');
      playButton.classList.toggle('hidden', state !== 'paused');
      document.querySelectorAll(`[data-live-match-id="${selected?.id}"] .live-game-watch-label`).forEach(label => {
        label.textContent = state === 'playing' ? 'Watching' : state === 'loading' || state === 'buffering' ? 'Connecting' : 'Watch';
      });
    }
  });
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'your timezone';
  document.getElementById('liveGamesTimezone').textContent = `Times in ${timezone}. Match days use UTC.`;

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function team(name, logo) {
    const row = element('span', 'live-game-team');
    if (logo) {
      const image = element('img'); image.src = logo; image.alt = ''; image.loading = 'lazy';
      image.width = 22; image.height = 22; image.referrerPolicy = 'no-referrer';
      image.addEventListener('error', () => { image.hidden = true; }, { once: true });
      row.append(image);
    }
    row.append(element('span', 'live-game-team-name', name));
    return row;
  }

  function updateSound() {
    const audible = !video.muted && video.volume > 0;
    sound.setAttribute('aria-pressed', String(audible));
    sound.setAttribute('aria-label', audible ? 'Mute sound' : 'Enable sound');
    sound.querySelector('span').textContent = audible ? 'Sound on' : 'Sound off';
    sound.querySelector('i').className = audible ? 'fas fa-volume-high' : 'fas fa-volume-xmark';
  }
  video.addEventListener('volumechange', updateSound); updateSound();

  function stopWatching(restoreFocus = false) {
    selection++;
    streamController?.abort(); streamController = null;
    playback.stop(); player.classList.add('hidden'); playButton.classList.add('hidden');
    const previous = selected;
    selected = null; streams = [];
    renderGames();
    if (restoreFocus && previous) document.querySelector(`[data-live-match-id="${previous.id}"] button`)?.focus();
  }

  function renderLiveMatch(match) {
    const item = element('article', `live-game-live-match${selected?.id === match.id ? ' selected' : ''}`);
    item.dataset.liveMatchId = match.id;
    const meta = element('div', 'live-game-meta');
    meta.append(element('span', 'live-game-competition', match.competition), element('span', stale ? 'live-game-last-reported' : 'live-game-now', stale ? 'Last reported' : match.statusLabel));
    const teams = element('div', 'live-game-teams');
    const home = team(match.home, match.homeLogo), away = team(match.away, match.awayLogo);
    home.append(element('strong', '', match.homeScore ?? '–')); away.append(element('strong', '', match.awayScore ?? '–'));
    teams.append(home, away);
    item.append(meta, teams);
    const footer = element('div', 'live-game-live-footer');
    if (match.watchable) {
      const watch = element('button', 'live-game-watch');
      watch.type = 'button'; watch.dataset.matchId = match.id;
      watch.setAttribute('aria-pressed', String(selected?.id === match.id));
      watch.setAttribute('aria-label', `Watch ${match.home} vs ${match.away}`);
      const icon = element('i', 'fas fa-play'); icon.setAttribute('aria-hidden', 'true');
      watch.append(icon, element('span', 'live-game-watch-label', selected?.id === match.id && player.dataset.state === 'playing' ? 'Watching' : stale ? 'Check stream' : 'Watch'));
      footer.append(watch);
    } else footer.append(element('span', 'live-game-no-stream', 'Score only'));
    item.append(footer);
    return item;
  }

  function dayLabel(match) {
    if (match.scheduleDate === utcDate()) return 'Today';
    if (match.scheduleDate === utcDate(1)) return 'Tomorrow';
    const value = new Date(`${match.scheduleDate}T00:00:00Z`);
    return Number.isFinite(value.getTime()) ? value.toLocaleDateString([], { weekday: 'short', timeZone: 'UTC' }) : 'Upcoming';
  }

  function renderUpcomingMatch(match) {
    const item = element('article', 'live-game-upcoming-match');
    item.dataset.liveMatchId = match.id; item.tabIndex = -1;
    const start = new Date(match.startTime);
    const time = Number.isFinite(match.startTime) && match.status !== 13
      ? start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'TBC';
    const top = element('div', 'live-game-upcoming-time');
    top.append(element('span', '', dayLabel(match)), element('time', '', time));
    if (Number.isFinite(match.startTime)) top.lastChild.dateTime = start.toISOString();
    const competition = element('p', 'live-game-competition', match.competition);
    const teams = element('div', 'live-game-teams'); teams.append(team(match.home, match.homeLogo), team(match.away, match.awayLogo));
    item.append(top, competition, teams);
    return item;
  }

  function renderGames() {
    const focusedId = section.contains(document.activeElement) ? document.activeElement.closest('[data-live-match-id]')?.dataset.liveMatchId : null;
    const live = filterSportsMatches(matches, { phase: 'live' });
    const upcoming = filterSportsMatches(matches, { phase: 'upcoming' }).filter(match => match.status === 1 || match.status === 13);
    document.getElementById('liveGamesLiveCount').textContent = String(live.length);
    liveList.replaceChildren(); upcomingList.replaceChildren();
    if (!live.length) {
      const empty = element('div', 'live-games-empty');
      empty.append(element('i', 'fas fa-circle-check'), element('span', '', 'No main games are live right now.'));
      empty.firstChild.setAttribute('aria-hidden', 'true'); liveList.append(empty);
    } else live.forEach(match => liveList.append(renderLiveMatch(match)));
    if (!upcoming.length) {
      const empty = element('div', 'live-games-empty live-games-upcoming-empty');
      empty.append(element('i', 'fas fa-calendar'), element('span', '', 'No main fixtures coming up.'));
      empty.firstChild.setAttribute('aria-hidden', 'true'); upcomingList.append(empty);
    } else upcoming.forEach(match => upcomingList.append(renderUpcomingMatch(match)));
    if (focusedId) {
      const target = document.querySelector(`[data-live-match-id="${focusedId}"]`);
      (target?.querySelector('button') || target)?.focus({ preventScroll: true });
    }
  }

  function showLoading() {
    liveList.replaceChildren(element('div', 'live-games-skeleton'));
    upcomingList.replaceChildren(...Array.from({ length: 4 }, () => element('div', 'live-games-skeleton live-games-upcoming-skeleton')));
  }

  async function loadGames(force = false) {
    if (!active || document.hidden || loading) return;
    scheduleController = new AbortController();
    const signal = scheduleController.signal;
    loading = true; refresh.disabled = true; board.setAttribute('aria-busy', 'true');
    updated.textContent = 'Checking…';
    if (!matches.length) showLoading();
    try {
      const settled = await Promise.allSettled(HOME_DAYS.map(offset => loadMatchDay(offset, { force, signal })));
      if (signal.aborted || !active) return;
      const available = [];
      settled.forEach((result, index) => {
        if (result.status === 'fulfilled') available.push(result.value);
        else {
          const cached = scheduleCache.get(utcDate(HOME_DAYS[index]));
          if (cached) available.push(cached.matches);
        }
      });
      if (!settled.some(result => result.status === 'fulfilled')) {
        throw settled.find(result => result.status === 'rejected')?.reason || new Error('Live games are unavailable.');
      }
      matches = mergeMatches(available);
      loadedAt = Date.now(); stale = settled.some(result => result.status === 'rejected');
      updated.dataset.stale = String(stale);
      updated.textContent = stale ? 'Some fixtures unavailable' : `Updated ${new Date(loadedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
      renderGames();
      const current = selected && matches.find(match => match.id === selected.id);
      if (current) {
        selected = current;
        document.getElementById('sportsPlayerLeague').textContent = `${selected.competition} · ${selected.statusLabel}`;
      }
    } catch (error) {
      if (signal.aborted || !active) return;
      stale = true; updated.dataset.stale = 'true';
      if (matches.length) {
        updated.textContent = 'Connection lost. Last checked fixtures.'; renderGames();
      } else {
        updated.textContent = 'Games unavailable';
        liveList.replaceChildren(element('div', 'live-games-empty', error?.message || 'Could not load live games.'));
        upcomingList.replaceChildren(element('div', 'live-games-empty live-games-upcoming-empty', 'Use refresh to try again.'));
      }
    } finally {
      if (scheduleController?.signal === signal) {
        loading = false; refresh.disabled = false; board.setAttribute('aria-busy', 'false');
      }
    }
  }

  async function watch(match) {
    if (!match?.live || !match.watchable) return;
    stopWatching(); selected = match;
    const run = selection;
    streamController = new AbortController();
    player.classList.remove('hidden'); player.dataset.state = 'loading';
    document.getElementById('sportsPlayerTitle').textContent = `${match.home} vs ${match.away}`;
    document.getElementById('sportsPlayerLeague').textContent = `${match.competition} · ${match.statusLabel}`;
    playbackStatus.textContent = 'Finding available streams…'; playbackStatus.dataset.state = 'loading';
    document.getElementById('sportsVideoMessage').textContent = 'Finding available streams…';
    retry.classList.add('hidden'); playButton.classList.add('hidden');
    source.replaceChildren(); source.disabled = true; document.getElementById('sportsSourceField').classList.add('hidden');
    video.muted = true; updateSound(); renderGames();
    player.scrollIntoView({ block: 'center', behavior: 'auto' });
    try {
      const available = sportsStreams(await fetchSports('streams', { matchId: match.id }, streamController.signal));
      if (run !== selection || !active) return;
      streams = available;
      if (!streams.length) throw new Error('Camel has no video feed for this match right now. Try again shortly.');
      streams.forEach((stream, index) => {
        const option = element('option', '', sportsStreamLabel(stream, index)); option.value = String(index); source.append(option);
      });
      source.disabled = streams.length < 2;
      document.getElementById('sportsSourceField').classList.toggle('hidden', streams.length < 2);
      await playback.start(streams);
    } catch (error) {
      if (run !== selection || !active) return;
      playbackStatus.textContent = error?.message || 'The live feed could not be loaded.';
      playbackStatus.dataset.state = 'error'; player.dataset.state = 'error';
      document.getElementById('sportsVideoMessage').textContent = playbackStatus.textContent;
      retry.classList.remove('hidden');
    }
  }

  function knownMatch(id) {
    const current = matches.find(match => match.id === id);
    if (current) return current;
    for (const entry of scheduleCache.values()) {
      const found = entry.matches.find(match => match.id === id);
      if (found) return found;
    }
    return null;
  }

  openKnownGame = (matchId, { play = true } = {}) => {
    const match = knownMatch(String(matchId));
    if (!match) return false;
    if (!matches.some(item => item.id === match.id)) matches = mergeMatches([matches, [match]]);
    document.querySelector('.nav-btn[data-tab="home"]')?.click();
    renderGames();
    requestAnimationFrame(() => {
      if (play && match.live && match.watchable) void watch(match);
      else {
        const target = document.querySelector(`[data-live-match-id="${match.id}"]`) || section;
        target.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
        (target.querySelector('button') || target).focus({ preventScroll: true });
      }
    });
    return true;
  };

  function activate() {
    const visible = !homeView?.classList.contains('hidden') && !document.body.classList.contains('player-active');
    if (visible === active) return;
    active = visible; clearInterval(timer); timer = null;
    if (active) {
      if (Date.now() - loadedAt > CACHE_MS) void loadGames();
      timer = setInterval(() => void loadGames(true), CACHE_MS);
    } else {
      scheduleController?.abort(); scheduleController = null; loading = false;
      refresh.disabled = false; board.setAttribute('aria-busy', 'false'); stopWatching();
    }
  }

  const visibilityObserver = new MutationObserver(activate);
  visibilityObserver.observe(homeView, { attributes: true, attributeFilter: ['class'] });
  visibilityObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      scheduleController?.abort(); scheduleController = null; loading = false;
      refresh.disabled = false; board.setAttribute('aria-busy', 'false');
      if (selected) stopWatching();
    } else if (active && Date.now() - loadedAt > CACHE_MS) void loadGames(true);
  });
  window.addEventListener('pagehide', () => { clearInterval(timer); scheduleController?.abort(); stopWatching(); });
  refresh.addEventListener('click', () => void loadGames(true));
  liveList.addEventListener('click', event => {
    const id = event.target.closest('[data-match-id]')?.dataset.matchId;
    const match = knownMatch(id); if (!match) return;
    if (selected?.id === id && !['error', 'ended'].includes(player.dataset.state)) {
      player.scrollIntoView({ block: 'center', behavior: 'smooth' });
      if (player.dataset.state === 'paused') void playback.play();
    } else void watch(match);
  });
  document.getElementById('sportsPlayerClose').addEventListener('click', () => stopWatching(true));
  retry.addEventListener('click', () => { if (selected) void watch(selected); });
  playButton.addEventListener('click', () => void playback.play());
  sound.addEventListener('click', () => {
    const audible = !video.muted && video.volume > 0;
    video.muted = audible;
    if (!audible && video.volume === 0) video.volume = 1;
    updateSound();
  });
  source.addEventListener('change', () => { if (streams[Number(source.value)]) void playback.start(streams, Number(source.value)); });
  document.getElementById('sportsFullscreen').addEventListener('click', async () => {
    try {
      if (video.requestFullscreen) await video.requestFullscreen();
      else if (video.webkitEnterFullscreen) video.webkitEnterFullscreen();
      else playbackStatus.textContent = 'Use the video fullscreen control.';
    } catch { playbackStatus.textContent = 'Use the video fullscreen control.'; }
  });
  section.addEventListener('keydown', event => {
    if (event.key === 'Escape' && selected && !document.fullscreenElement && !video.webkitDisplayingFullscreen) {
      stopWatching(true); event.preventDefault();
    }
  });
  renderGames(); activate();
}
