import { fetchSports } from './sports-api.js';
import { filterSportsMatches, normalizeSportsMatches, sportsStreams } from './sports-data.js';
import { createSportsPlayback } from './sports-playback.js';

let initialized = false;
const utcDate = () => new Date().toISOString().slice(0, 10);

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
  const playbackStatus = document.getElementById('sportsPlaybackStatus');
  const filters = [...view.querySelectorAll('[data-sports-phase]')];
  let matches = [], phase = 'all', active = false, timer = null;
  let requestController = null, loading = false, loadedDate = '', loadedAt = 0;
  let selected = null, streams = [], selection = 0, streamController = null;
  const playback = createSportsPlayback({ video, onState(state, message) {
    playbackStatus.textContent = message;
    playbackStatus.dataset.state = state;
    retry.classList.toggle('hidden', state !== 'error');
  } });
  date.value = utcDate();
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'your timezone';
  document.getElementById('sportsTimezone').textContent = `Kickoff times: ${timezone}. Match dates use UTC.`;

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function stopWatching(restoreFocus = false) {
    selection++;
    streamController?.abort(); streamController = null;
    playback.stop();
    player.classList.add('hidden');
    const previous = selected;
    selected = null; streams = [];
    if (restoreFocus) list.querySelector(`[data-match-id="${previous?.id}"]`)?.focus();
  }

  function team(name, logo) {
    const node = element('span', 'sports-team');
    if (logo) {
      const image = element('img'); image.src = logo; image.alt = ''; image.loading = 'lazy';
      image.width = 24; image.height = 24; image.referrerPolicy = 'no-referrer';
      image.addEventListener('error', () => { image.hidden = true; }, { once: true });
      node.append(image);
    }
    node.append(element('span', '', name));
    return node;
  }

  function render() {
    const focusedId = list.contains(document.activeElement) ? document.activeElement.dataset.matchId : null;
    const visible = filterSportsMatches(matches, { query: search.value, phase });
    list.replaceChildren();
    const liveCount = matches.filter(match => match.live).length;
    summary.textContent = `${visible.length} match${visible.length === 1 ? '' : 'es'}${liveCount ? ` · ${liveCount} live` : ''}`;
    if (!visible.length) {
      const empty = element('div', 'sports-empty');
      empty.append(element('h3', '', matches.length ? 'No matching fixtures' : 'No fixtures for this date'));
      empty.append(element('p', '', matches.length ? 'Try another team, league, or match filter.' : 'Choose another date or refresh the schedule.'));
      list.append(empty);
      return;
    }
    const groups = new Map();
    visible.forEach(match => {
      const key = `${match.phase}:${match.competitionId}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(match);
    });
    const phaseNames = { live: 'Live now', upcoming: 'Upcoming', results: 'Results' };
    let previousPhase = '';
    groups.forEach(group => {
      const first = group[0];
      if (first.phase !== previousPhase) {
        list.append(element('h3', 'sports-phase-heading', phaseNames[first.phase]));
        previousPhase = first.phase;
      }
      const section = element('section', 'sports-league');
      section.append(element('h4', 'sports-league-heading', first.competition));
      group.forEach(match => {
        const row = element('div', 'sports-match');
        if (selected?.id === match.id) row.classList.add('sports-match-selected');
        const timing = element('div', 'sports-match-time');
        const start = new Date(match.startTime);
        const time = element('time', '', Number.isFinite(match.startTime)
          ? start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'TBC');
        if (Number.isFinite(match.startTime)) time.dateTime = start.toISOString();
        timing.append(time, element('span', match.live ? 'sports-live' : '', `${match.live ? 'Live · ' : ''}${match.statusLabel}`));
        const teams = element('div', 'sports-teams');
        teams.append(team(match.home, match.homeLogo), team(match.away, match.awayLogo));
        const scores = element('div', 'sports-scores');
        scores.setAttribute('aria-label', match.homeScore == null ? 'No score yet' : `Score: ${match.homeScore} to ${match.awayScore}`);
        scores.append(element('span', '', match.homeScore ?? '–'), element('span', '', match.awayScore ?? '–'));
        const watch = element('button', 'btn btn-secondary sports-watch', match.watchable ? 'Watch live' : match.live ? 'Score only' : match.status === 8 ? 'Ended' : 'Not live');
        watch.type = 'button'; watch.dataset.matchId = match.id; watch.disabled = !match.watchable;
        watch.setAttribute('aria-label', `${match.watchable ? 'Watch' : 'No live stream for'} ${match.home} vs ${match.away}`);
        row.append(timing, teams, scores, watch);
        section.append(row);
      });
      list.append(section);
    });
    if (focusedId) list.querySelector(`[data-match-id="${focusedId}"]`)?.focus({ preventScroll: true });
  }

  async function loadSchedule() {
    if (!active || document.hidden || loading || !date.value || !date.validity.valid) return;
    requestController = new AbortController();
    const signal = requestController.signal;
    const requestedDate = date.value;
    loading = true; refresh.disabled = true;
    list.setAttribute('aria-busy', 'true');
    updated.textContent = 'Updating…';
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
      matches = normalizeSportsMatches(data);
      loadedDate = requestedDate; loadedAt = Date.now();
      render();
      updated.textContent = `Updated ${new Date(loadedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    } catch (error) {
      if (signal.aborted || !active) return;
      updated.textContent = loadedDate === requestedDate ? 'Update failed. Showing the last schedule.' : 'Schedule unavailable';
      if (loadedDate !== requestedDate) {
        list.replaceChildren(element('div', 'sports-empty', error?.message || 'Could not load fixtures. Try refreshing.'));
        summary.textContent = 'Use Refresh to try again';
      }
    } finally {
      if (requestController?.signal === signal) {
        loading = false; refresh.disabled = false; list.setAttribute('aria-busy', 'false');
      }
    }
  }

  async function watch(match) {
    stopWatching();
    selected = match;
    const run = selection;
    streamController = new AbortController();
    player.classList.remove('hidden');
    document.getElementById('sportsPlayerTitle').textContent = `${match.home} vs ${match.away}`;
    document.getElementById('sportsPlayerLeague').textContent = match.competition;
    playbackStatus.textContent = 'Finding live streams…'; playbackStatus.dataset.state = 'loading';
    retry.classList.add('hidden'); source.replaceChildren(); source.disabled = true;
    document.getElementById('sportsPlayerClose').focus({ preventScroll: true });
    player.scrollIntoView({ block: 'start', behavior: 'auto' });
    render();
    try {
      const available = sportsStreams(await fetchSports('streams', { matchId: match.id }, streamController.signal));
      if (run !== selection || !active) return;
      streams = available;
      if (!streams.length) throw new Error('Camel has no video stream for this match right now. Try again shortly.');
      streams.forEach((stream, index) => {
        const option = element('option', '', `Stream ${index + 1}${stream.backup ? ' (backup)' : ''}`);
        option.value = String(index); source.append(option);
      });
      source.disabled = streams.length < 2;
      await playback.start(streams[0].url);
    } catch (error) {
      if (run !== selection || !active) return;
      playbackStatus.textContent = error?.message || 'The stream could not be loaded.';
      playbackStatus.dataset.state = 'error'; retry.classList.remove('hidden');
    }
  }

  function activate() {
    const visible = !view.classList.contains('hidden') && !document.body.classList.contains('player-active');
    if (visible === active) return;
    active = visible;
    clearInterval(timer); timer = null;
    if (active) {
      if (Date.now() - loadedAt > 60000 || loadedDate !== date.value) loadSchedule();
      timer = setInterval(loadSchedule, 60000);
    } else {
      requestController?.abort(); requestController = null;
      loading = false; refresh.disabled = false; list.setAttribute('aria-busy', 'false');
      stopWatching();
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
    stopWatching(); matches = []; loadedAt = 0; render(); loadSchedule();
  });
  document.getElementById('sportsToday').addEventListener('click', () => {
    date.value = utcDate(); date.dispatchEvent(new Event('change'));
  });
  filters.forEach(button => button.addEventListener('click', () => {
    phase = button.dataset.sportsPhase;
    filters.forEach(filter => filter.setAttribute('aria-pressed', String(filter === button)));
    render();
  }));
  list.addEventListener('click', event => {
    const id = event.target.closest('[data-match-id]')?.dataset.matchId;
    const match = matches.find(item => item.id === id);
    if (match?.watchable) watch(match);
  });
  document.getElementById('sportsPlayerClose').addEventListener('click', () => { stopWatching(true); render(); });
  retry.addEventListener('click', () => { if (selected) watch(selected); });
  source.addEventListener('change', () => { if (streams[Number(source.value)]) playback.start(streams[Number(source.value)].url); });
  document.getElementById('sportsFullscreen').addEventListener('click', async () => {
    try {
      if (video.requestFullscreen) await video.requestFullscreen();
      else if (video.webkitEnterFullscreen) video.webkitEnterFullscreen();
      else playbackStatus.textContent = 'Use the video controls to enter fullscreen.';
    } catch { playbackStatus.textContent = 'Use the video controls to enter fullscreen.'; }
  });
  view.addEventListener('keydown', event => {
    if (event.key === 'Escape' && selected && !document.fullscreenElement && !video.webkitDisplayingFullscreen) {
      stopWatching(true); render(); event.preventDefault();
    }
  });
  activate();
}
