import { fetchSports } from './sports-api.js';
import { filterSportsMatches, isMainFootballMatch, normalizeSportsMatches, sportsStreams, sportsStreamLabel } from './sports-data.js';
import { createSportsPlayback } from './sports-playback.js';

let initialized = false;
const utcDate = (offset = 0) => {
  const day = new Date(); day.setUTCDate(day.getUTCDate() + offset);
  return day.toISOString().slice(0, 10);
};

export function initSports() {
  if (initialized) return;
  const view = document.getElementById('sportsView');
  if (!view) return;
  initialized = true;
  const list = document.getElementById('sportsMatches');
  const search = document.getElementById('sportsSearch');
  const date = document.getElementById('sportsDate');
  const refresh = document.getElementById('sportsRefresh');
  const summary = document.getElementById('sportsSummary');
  const updated = document.getElementById('sportsUpdated');
  const player = document.getElementById('sportsPlayer');
  const video = document.getElementById('sportsVideo');
  const source = document.getElementById('sportsStream');
  const retry = document.getElementById('sportsRetry');
  const playButton = document.getElementById('sportsPlay');
  const sound = document.getElementById('sportsSound');
  const playbackStatus = document.getElementById('sportsPlaybackStatus');
  const filters = [...view.querySelectorAll('[data-sports-phase]')];
  const days = [...view.querySelectorAll('[data-sports-day]')];
  let matches = [], phase = 'all', active = false, timer = null, stale = false;
  let requestController = null, loading = false, loadedDate = '', loadedAt = 0;
  let selected = null, streams = [], selection = 0, streamController = null;

  const playback = createSportsPlayback({ video, onSourceChange(index) { source.value = String(index); },
    onState(state, message) {
      playbackStatus.textContent = message; playbackStatus.dataset.state = state;
      player.dataset.state = state;
      document.getElementById('sportsVideoMessage').textContent = message;
      retry.classList.toggle('hidden', state !== 'error' && state !== 'ended');
      playButton.classList.toggle('hidden', state !== 'paused');
      const label = list.querySelector(`[data-match-id="${selected?.id}"] span`);
      if (label) label.textContent = state === 'playing' ? 'Watching' : state === 'loading' || state === 'buffering' ? 'Connecting' : 'Watch';
    }
  });
  date.value = utcDate();
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'your timezone';
  document.getElementById('sportsTimezone').textContent = `Times in ${timezone}. Match days use UTC.`;
  const header = document.querySelector('.main-header');
  if (header && typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => view.style.setProperty('--sports-header-height', `${header.getBoundingClientRect().height}px`)).observe(header);
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
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
    if (restoreFocus) list.querySelector(`[data-match-id="${previous?.id}"]`)?.focus();
  }

  function team(name, logo, side) {
    const node = element('span', `sports-team sports-${side}`);
    if (logo) {
      const image = element('img'); image.src = logo; image.alt = ''; image.loading = 'lazy';
      image.width = 24; image.height = 24; image.referrerPolicy = 'no-referrer';
      image.addEventListener('error', () => { image.hidden = true; }, { once: true });
      node.append(image);
    }
    node.append(element('span', '', name));
    return node;
  }

  function setPhase(value) {
    phase = value;
    filters.forEach(filter => filter.setAttribute('aria-pressed', String(filter.dataset.sportsPhase === phase)));
    render();
  }

  function render() {
    const focusedId = list.contains(document.activeElement) ? document.activeElement.dataset.matchId : null;
    const visible = filterSportsMatches(matches, { query: search.value, phase });
    list.replaceChildren();
    document.getElementById('sportsLiveCount').textContent = String(matches.filter(match => match.live).length);
    summary.textContent = `${visible.length} match${visible.length === 1 ? '' : 'es'}`;
    if (!visible.length) {
      const empty = element('div', 'sports-empty');
      const searched = !!search.value.trim();
      empty.append(element('h3', '', searched ? 'No matching teams or competitions'
        : !matches.length ? 'No main fixtures for this day' : phase === 'live' ? 'No main matches live right now' : `No ${phase === 'results' ? 'results' : 'upcoming matches'} for this day`));
      empty.append(element('p', '', searched ? 'Try a different team or competition.'
        : !matches.length ? 'Choose another day. Youth, reserve and lower-profile competitions stay hidden.'
          : 'Check the other fixtures. Streams appear when Camel reports live video.'));
      if (searched || matches.length) {
        const reset = element('button', 'sports-control', searched ? 'Clear search' : 'Show matches');
        reset.type = 'button'; reset.addEventListener('click', () => { search.value = ''; setPhase('all'); });
        empty.append(reset);
      }
      list.append(empty); return;
    }
    const groups = new Map();
    visible.forEach(match => {
      if (!groups.has(match.competitionId)) groups.set(match.competitionId, []);
      groups.get(match.competitionId).push(match);
    });
    groups.forEach(group => {
      const section = element('section', 'sports-league');
      section.append(element('h3', 'sports-league-heading', group[0].competition));
      group.forEach(match => {
        const row = element('div', `sports-match${selected?.id === match.id ? ' sports-match-selected' : ''}`);
        row.dataset.fixtureId = match.id;
        const timing = element('div', 'sports-match-time');
        if (match.live) {
          timing.append(element('span', stale ? '' : 'sports-live', stale ? 'Last reported' : 'Live'));
        } else {
          const start = new Date(match.startTime);
          const time = element('time', '', Number.isFinite(match.startTime) && match.status !== 13
            ? start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'TBC');
          if (Number.isFinite(match.startTime)) time.dateTime = start.toISOString();
          timing.append(time);
        }
        timing.append(element('span', '', match.statusLabel));
        const fixture = element('div', 'sports-fixture');
        const scores = element('span', `sports-scores${match.homeScore == null && match.awayScore == null ? ' sports-scores-pending' : ''}`);
        scores.setAttribute('aria-label', match.homeScore == null && match.awayScore == null ? 'Score not available'
          : `Score: ${match.homeScore ?? 'unavailable'} to ${match.awayScore ?? 'unavailable'}`);
        scores.append(element('span', '', match.homeScore ?? '–'), element('span', 'sports-score-separator', ':'), element('span', '', match.awayScore ?? '–'));
        fixture.append(team(match.home, match.homeLogo, 'home'), scores, team(match.away, match.awayLogo, 'away'));
        row.append(timing, fixture);
        if (match.watchable) {
          const watching = selected?.id === match.id;
          const watch = element('button', 'sports-watch');
          watch.append(element('i', 'fas fa-play'), element('span', '', watching && player.dataset.state === 'playing' ? 'Watching' : stale ? 'Check stream' : 'Watch'));
          watch.firstChild.setAttribute('aria-hidden', 'true');
          watch.type = 'button'; watch.dataset.matchId = match.id;
          watch.setAttribute('aria-pressed', String(watching));
          watch.setAttribute('aria-label', `Watch ${match.home} vs ${match.away}`);
          row.append(watch);
        } else {
          row.append(element('span', 'sports-availability', match.live ? 'No stream' : match.status === 8 ? 'Full-time' : match.status === 1 ? 'Starts later' : ''));
        }
        section.append(row);
      });
      list.append(section);
    });
    if (focusedId) list.querySelector(`[data-match-id="${focusedId}"]`)?.focus({ preventScroll: true });
  }

  async function loadSchedule() {
    if (!active || document.hidden || loading || !date.value || !date.validity.valid) return;
    requestController = new AbortController();
    const signal = requestController.signal, requestedDate = date.value;
    loading = true; refresh.disabled = true; list.setAttribute('aria-busy', 'true');
    updated.textContent = 'Checking…';
    if (loadedDate !== requestedDate) {
      list.replaceChildren();
      for (let i = 0; i < 4; i++) {
        const skeleton = element('div', 'sports-skeleton'); skeleton.setAttribute('aria-hidden', 'true'); list.append(skeleton);
      }
      summary.textContent = 'Loading fixtures…';
    }
    try {
      const data = await fetchSports('schedule', { date: requestedDate.replace(/-/g, '') }, signal);
      if (signal.aborted || !active || requestedDate !== date.value) return;
      matches = normalizeSportsMatches(data).filter(isMainFootballMatch);
      loadedDate = requestedDate; loadedAt = Date.now(); stale = false;
      updated.dataset.stale = 'false';
      render();
      updated.textContent = `Checked ${new Date(loadedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
      const currentMatch = selected && matches.find(match => match.id === selected.id);
      if (currentMatch) {
        selected = currentMatch;
        document.getElementById('sportsPlayerLeague').textContent = `${selected.competition} · ${selected.statusLabel}`;
      }
    } catch (error) {
      if (signal.aborted || !active) return;
      stale = true; updated.dataset.stale = 'true';
      updated.textContent = loadedDate === requestedDate ? 'Connection lost. Last checked fixtures.' : 'Feed unavailable';
      if (loadedDate === requestedDate) render();
      else {
        const empty = element('div', 'sports-empty');
        empty.append(element('h3', '', 'The football feed is unavailable'), element('p', '', error?.message || 'Use Refresh to try again.'));
        list.replaceChildren(empty); summary.textContent = 'No current data';
      }
    } finally {
      if (requestController?.signal === signal) {
        loading = false; refresh.disabled = false; list.setAttribute('aria-busy', 'false');
      }
    }
  }

  async function watch(match) {
    stopWatching(); selected = match;
    const run = selection;
    streamController = new AbortController();
    player.classList.remove('hidden'); player.dataset.state = 'loading';
    document.getElementById('sportsPlayerTitle').textContent = `${match.home} vs ${match.away}`;
    document.getElementById('sportsPlayerLeague').textContent = `${match.competition} · ${match.statusLabel}`;
    playbackStatus.textContent = 'Finding available streams…'; playbackStatus.dataset.state = 'loading';
    document.getElementById('sportsVideoMessage').textContent = 'Finding available streams…';
    retry.classList.add('hidden'); playButton.classList.add('hidden');
    source.replaceChildren(); source.disabled = true;
    document.getElementById('sportsSourceField').classList.add('hidden');
    // Muted first play is reliable under browser autoplay policies; sound is one click.
    video.muted = true; updateSound();
    document.getElementById('sportsPlayerClose').focus({ preventScroll: true });
    player.scrollIntoView({ block: 'start', behavior: 'auto' }); render();
    try {
      const available = sportsStreams(await fetchSports('streams', { matchId: match.id }, streamController.signal));
      if (run !== selection || !active) return;
      streams = available;
      if (!streams.length) throw new Error('Camel has no video feed for this match right now. Try again shortly.');
      streams.forEach((stream, index) => {
        const option = element('option', '', sportsStreamLabel(stream, index));
        option.value = String(index); source.append(option);
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

  function activate() {
    const visible = !view.classList.contains('hidden') && !document.body.classList.contains('player-active');
    if (visible === active) return;
    active = visible; document.body.classList.toggle('sports-active', active);
    clearInterval(timer); timer = null;
    if (active) {
      if (Date.now() - loadedAt > 60000 || loadedDate !== date.value) loadSchedule();
      timer = setInterval(loadSchedule, 60000);
    } else {
      requestController?.abort(); requestController = null; loading = false;
      refresh.disabled = false; list.setAttribute('aria-busy', 'false'); stopWatching();
    }
  }
  const visibilityObserver = new MutationObserver(activate);
  visibilityObserver.observe(view, { attributes: true, attributeFilter: ['class'] });
  visibilityObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  document.addEventListener('visibilitychange', () => { if (active && !document.hidden && Date.now() - loadedAt > 60000) loadSchedule(); });
  window.addEventListener('pagehide', () => { clearInterval(timer); requestController?.abort(); stopWatching(); });
  refresh.addEventListener('click', loadSchedule);
  search.addEventListener('input', render);
  date.addEventListener('change', () => {
    requestController?.abort(); requestController = null; loading = false;
    stopWatching(); matches = []; loadedAt = 0; stale = false;
    days.forEach(day => day.setAttribute('aria-pressed', String(utcDate(Number(day.dataset.sportsDay)) === date.value)));
    render(); loadSchedule();
  });
  days.forEach(day => day.addEventListener('click', () => { date.value = utcDate(Number(day.dataset.sportsDay)); date.dispatchEvent(new Event('change')); }));
  filters.forEach(button => button.addEventListener('click', () => setPhase(button.dataset.sportsPhase)));
  list.addEventListener('click', event => {
    const id = event.target.closest('[data-match-id]')?.dataset.matchId;
    const match = matches.find(item => item.id === id);
    if (!match?.watchable) return;
    if (selected?.id === id && !['error', 'ended'].includes(player.dataset.state)) {
      player.scrollIntoView({ block: 'start', behavior: 'auto' });
      if (player.dataset.state === 'paused') void playback.play();
    } else void watch(match);
  });
  document.getElementById('sportsPlayerClose').addEventListener('click', () => { stopWatching(true); render(); });
  retry.addEventListener('click', () => { if (selected) void watch(selected); });
  playButton.addEventListener('click', () => { void playback.play(); });
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
  view.addEventListener('keydown', event => {
    if (event.key === 'Escape' && selected && !document.fullscreenElement && !video.webkitDisplayingFullscreen) {
      stopWatching(true); render(); event.preventDefault();
    }
  });
  activate();
}
