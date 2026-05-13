/** Player Overlay & Episode Picker */
import { playerState, setPlayerState } from './state.js';
import { getProviderUrl } from './config.js';
import { fetchWithAuth } from './api.js';
import { BASE_URL, API_KEY } from './config.js';
import { showToast, lockScroll, unlockScroll } from './utils.js';

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
  if (playerFrame) playerFrame.src = getPlayerSrc();
}

export function closePlayer() {
  if (!playerOverlay) return;
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

  setPlayerState({
    id,
    type,
    season: season || 1,
    episode: episode || 1,
    tmdbData: null,
    epData: null,
    view: 'seasons'
  });

  playerOverlay.classList.remove('hidden');
  playerOverlay.classList.remove('closing');
  lockScroll();
  window.dispatchEvent(new CustomEvent('watchStarted', { detail: { id, type } }));
  initPlayerData();
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
      if (playerTitleText) playerTitleText.textContent = data.original_title || data.title;
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

      if (playerTitleText) {
        playerTitleText.textContent = `${data.name} S${p.season} E${p.episode}`;
      }

      const [nextS, nextE] = getNextEp(p.season, p.episode, newTmdbData);
      if (nextS !== null && playerNextBtn) {
        playerNextBtn.style.display = 'flex';
        playerNextBtn.disabled = false;
        playerNextBtn.title = `Next: S${nextS} E${nextE}`;
        playerNextBtn.onclick = () => {
          setPlayerState({ ...playerState, season: nextS, episode: nextE });
          if (playerTitleText) {
            playerTitleText.textContent = `${newTmdbData.title} S${nextS} E${nextE}`;
          }
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
      setPlayerState({ ...playerState, season: newSeason, episode: newEpisode });
      closeEpPopover();
      initPlayerData();
    });
  });
}
