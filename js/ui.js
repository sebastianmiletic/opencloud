/** UI Rendering: Search, Categories, Modals, Collection, History */
import {
  userCollection, userHistory, watchProgress, userFolders, currentTab, currentModalItem, setCurrentTab,
  setSearchTimeout, setCurrentModalItem, heroSlides, setHeroSlides,
  setUserCollection, setUserHistory, setWatchProgress, setUserFolders
} from './state.js';
import {
  getUserCollection, saveUserCollection, getUserHistory, saveUserHistory,
  getWatchProgress, saveWatchProgress, getUserFolders, saveUserFolders
} from './storage.js';
import { BASE_URL, IMG_BASE, STAR_WARS_SAGA_ORDER, API_KEY } from './config.js';
import { fetchWithAuth, getOMDBRatingsBatch, getOMDBRating } from './api.js';
import { showToast, lockScroll, unlockScroll, showConfirm } from './utils.js';
import { openPlayer } from './player.js';
import { renderHeroSlides } from './hero.js';

/* DOM refs */
const searchInput = document.getElementById('searchInput');
const searchResults = document.getElementById('searchResults');
const searchResultsBody = document.getElementById('searchResultsBody');
const searchResultsCount = document.getElementById('searchResultsCount');
const clearSearchBtn = document.getElementById('clearSearch');
const homeView = document.getElementById('homeView');
const collectionView = document.getElementById('collectionView');
const collectionGrid = document.getElementById('collectionGrid');
const historyView = document.getElementById('historyView');
const historyGrid = document.getElementById('historyGrid');
const itemModal = document.getElementById('itemModal');
const collectionSort = document.getElementById('collectionSort');
const historySort = document.getElementById('historySort');

/* Collection folder state */
let _collectionFolder = null; // null = show all (no folder filter)

/* Inline folder creation state */
let _creatingFolder = false;

/* Move popover state */
let _movePopoverOpen = false;

/* Nav */
export function initNav() {
  const navBtns = document.querySelectorAll('.nav-btn');
  navBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      navBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      setCurrentTab(btn.dataset.tab);
      toggleView(btn.dataset.tab);
    });
  });
}

function toggleView(tab) {
  homeView?.classList.toggle('hidden', tab !== 'home');
  collectionView?.classList.toggle('hidden', tab !== 'collection');
  historyView?.classList.toggle('hidden', tab !== 'history');
  if (tab === 'collection') renderUserCollection();
  if (tab === 'history') renderUserHistory();
  if (tab === 'home') {
    loadRecommendations();
    loadContinueWatching();
  }
}

/* Search */
export function initSearch() {
  if (!searchInput) return;

  searchInput.addEventListener('input', (e) => {
    const query = e.target.value.trim();
    clearSearchBtn?.classList.toggle('hidden', !query);
    clearTimeout(window._searchTimeout);
    if (query.length < 2) {
      searchResults?.classList.add('hidden');
      return;
    }
    if (searchResultsBody) {
      searchResultsBody.innerHTML = '<div class="search-loading"><i class="fas fa-spinner"></i> Searching...</div>';
    }
    searchResults?.classList.remove('hidden');
    window._searchTimeout = setTimeout(() => searchTMDB(query), 250);
  });

  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      clearTimeout(window._searchTimeout);
      const q = searchInput.value.trim();
      if (q.length >= 2) searchTMDB(q);
    }
    if (e.key === 'Escape') {
      searchResults?.classList.add('hidden');
      searchInput.blur();
    }
  });

  clearSearchBtn?.addEventListener('click', () => {
    searchInput.value = '';
    clearSearchBtn.classList.add('hidden');
    searchResults?.classList.add('hidden');
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-container')) {
      searchResults?.classList.add('hidden');
    }
  });

  collectionSort?.addEventListener('change', renderUserCollection);
  historySort?.addEventListener('change', renderUserHistory);
}

async function searchTMDB(query) {
  try {
    const [movieRes, tvRes] = await Promise.all([
      fetch(`${BASE_URL}/search/movie?query=${encodeURIComponent(query)}&page=1`, {
        headers: { 'Authorization': `Bearer ${API_KEY}`, 'Accept': 'application/json' }
      }),
      fetch(`${BASE_URL}/search/tv?query=${encodeURIComponent(query)}&page=1`, {
        headers: { 'Authorization': `Bearer ${API_KEY}`, 'Accept': 'application/json' }
      })
    ]);
    const movies = await movieRes.json();
    const tvShows = await tvRes.json();
    const results = [
      ...movies.results.map(item => ({ ...item, media_type: 'movie' })),
      ...tvShows.results.map(item => ({ ...item, media_type: 'tv' }))
    ].sort((a, b) => (b.popularity || 0) - (a.popularity || 0)).slice(0, 15);

    const omdbRatings = await getOMDBRatingsBatch(results);
    results.forEach(item => { if (omdbRatings[item.id]) item.omdbRating = omdbRatings[item.id]; });

    if (searchResultsCount) searchResultsCount.textContent = `${results.length} result${results.length !== 1 ? 's' : ''}`;
    renderSearchResults(results);
  } catch (error) {
    if (searchResultsBody) searchResultsBody.innerHTML = '<div class="search-loading">Search failed. Please try again.</div>';
    if (searchResultsCount) searchResultsCount.textContent = 'Error';
  }
}

function renderSearchResults(results) {
  if (!searchResultsBody) return;
  if (results.length === 0) {
    searchResultsBody.innerHTML = '<div class="search-loading">No results found</div>';
    return;
  }

  searchResultsBody.innerHTML = results.map(item => {
    const title = item.media_type === 'movie' ? item.title : item.name;
    const year = item.media_type === 'movie' ? item.release_date?.slice(0, 4) : item.first_air_date?.slice(0, 4);
    const poster = item.poster_path ? `${IMG_BASE}w92${item.poster_path}` : '';
    const rating = item.omdbRating ? item.omdbRating.toFixed(1) : (item.vote_average ? item.vote_average.toFixed(1) : 'N/A');
    const isInCollection = userCollection.some(c => c.id === item.id && c.media_type === item.media_type);

    return `
      <div class="search-result-item" data-id="${item.id}" data-type="${item.media_type}">
        <img src="${poster}" alt="${title}" loading="lazy" onerror="this.style.display='none'">
        <div class="search-result-info">
          <div class="search-result-title">${title}</div>
          <div class="search-result-meta">
            <span class="rating"><i class="fas fa-star"></i> ${rating}</span>
            <span>${year || 'Unknown'}</span>
          </div>
        </div>
        <span class="search-result-type">${item.media_type === 'movie' ? 'Movie' : 'TV'}</span>
        <div class="search-result-actions">
          <button class="search-watch-btn" title="Watch Now" data-id="${item.id}" data-type="${item.media_type}"><i class="fas fa-play"></i></button>
          <button class="search-collection-btn" title="Add to Collection" data-id="${item.id}" data-type="${item.media_type}" ${isInCollection ? 'disabled' : ''}><i class="fas ${isInCollection ? 'fa-check' : 'fa-plus'}"></i></button>
        </div>
      </div>`;
  }).join('');

  searchResultsBody.querySelectorAll('.search-result-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if (e.target.closest('.search-result-actions')) return;
      openItemModal(parseInt(item.dataset.id), item.dataset.type);
    });
  });

  searchResultsBody.querySelectorAll('.search-watch-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openPlayer(parseInt(btn.dataset.id), btn.dataset.type);
    });
  });

  searchResultsBody.querySelectorAll('.search-collection-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (btn.disabled) return;
      const id = parseInt(btn.dataset.id);
      const type = btn.dataset.type;
      try {
        const data = await fetchWithAuth(`${BASE_URL}/${type}/${id}?language=en-US`);
        addToUserCollection({ ...data, media_type: type });
        btn.innerHTML = '<i class="fas fa-check"></i>';
        btn.disabled = true;
      } catch (err) {
        console.error('[Search collection btn] Error:', err);
        showToast('Failed to add to collection', 'error');
      }
    });
  });
}

/* Categories */
export async function loadHomeCategories() {
  const endpoints = [
    { id: 'popularRow', url: `${BASE_URL}/movie/popular?language=en-US&page=1` },
    { id: 'nowPlayingRow', url: `${BASE_URL}/movie/now_playing?language=en-US&page=1` },
    { id: 'topRatedRow', url: `${BASE_URL}/movie/top_rated?language=en-US&page=1` },
    { id: 'comedyRow', url: `${BASE_URL}/discover/movie?with_genres=35&language=en-US&page=1` },
    { id: 'actionRow', url: `${BASE_URL}/discover/movie?with_genres=28&language=en-US&page=1` },
    { id: 'horrorRow', url: `${BASE_URL}/discover/movie?with_genres=27&language=en-US&page=1` },
    { id: 'scifiRow', url: `${BASE_URL}/discover/movie?with_genres=878&language=en-US&page=1` },
  ];

  for (const ep of endpoints) {
    const el = document.getElementById(ep.id);
    if (el) el.innerHTML = '<div class="row-loading"><i class="fas fa-spinner"></i></div>';
  }

  try {
    const results = await Promise.all(endpoints.map(ep => fetchWithAuth(ep.url)));
    results.forEach((data, i) => {
      renderCategoryRow(endpoints[i].id, data.results?.slice(0, 12) || [], 'movie');
    });

    const popularData = results[0];
    if (popularData.results?.length > 0) {
      const featured = popularData.results.slice(0, 5).map(r => ({ ...r, media_type: 'movie' }));
      const omdbRatings = await getOMDBRatingsBatch(featured);
      featured.forEach(item => { if (omdbRatings[item.id]) item.omdbRating = omdbRatings[item.id]; });
      setHeroSlides(featured);
      renderHeroSlides();
    }

    loadRecommendations();
    loadStarWarsSaga();
    loadContinueWatching();
  } catch (err) {
    endpoints.forEach(ep => {
      const el = document.getElementById(ep.id);
      if (el) el.innerHTML = '<div class="row-loading">Failed to load</div>';
    });
  }
}

export async function loadStarWarsSaga() {
  const section = document.getElementById('starWarsSection');
  const container = document.getElementById('starWarsRow');
  if (!section || !container) return;

  container.innerHTML = '<div class="row-loading"><i class="fas fa-spinner"></i></div>';

  try {
    const collectionData = await fetchWithAuth(`${BASE_URL}/collection/10?language=en-US`);
    if (collectionData.parts?.length > 0) {
      const sorted = sortStarWarsSaga(collectionData.parts.filter(p => p.poster_path));
      const omdbRatings = await getOMDBRatingsBatch(sorted);
      sorted.forEach(item => { if (omdbRatings[item.id]) item.omdbRating = omdbRatings[item.id]; });
      renderCategoryRow('starWarsRow', sorted.slice(0, 12), 'movie');
      return;
    }
  } catch (err) {
    try {
      const searchData = await fetchWithAuth(`${BASE_URL}/search/movie?query=Star%20Wars&language=en-US&page=1`);
      const filtered = sortStarWarsSaga(searchData.results.filter(r => r.poster_path));
      renderCategoryRow('starWarsRow', filtered.slice(0, 12), 'movie');
    } catch (e) {
      container.innerHTML = '<div class="row-loading">Failed to load</div>';
    }
  }
}

export async function loadContinueWatching() {
  const section = document.getElementById('continueWatchingSection');
  const container = document.getElementById('continueWatchingRow');
  if (!section || !container) return;

  const progress = getWatchProgress();
  const entries = Object.entries(progress)
    .filter(([, v]) => v && v.season && v.episode)
    .sort((a, b) => new Date(b[1].updated_at || 0) - new Date(a[1].updated_at || 0))
    .slice(0, 12);

  if (entries.length === 0) {
    section.classList.add('hidden');
    return;
  }

  section.classList.remove('hidden');
  container.innerHTML = '<div class="row-loading"><i class="fas fa-spinner"></i></div>';

  try {
    const items = [];
    for (const [idStr, prog] of entries) {
      try {
        const [showData, seasonData] = await Promise.all([
          fetchWithAuth(`${BASE_URL}/tv/${idStr}?language=en-US`),
          fetchWithAuth(`${BASE_URL}/tv/${idStr}/season/${prog.season}?language=en-US`)
        ]);
        if (showData && showData.id) {
          const currentEp = seasonData.episodes?.find(ep => ep.episode_number === prog.episode);
          if (currentEp?.runtime && !prog.episodeRuntime) {
            prog.episodeRuntime = currentEp.runtime;
            // Cache it back to storage
            const allProgress = getWatchProgress();
            if (allProgress[idStr]) {
              allProgress[idStr].episodeRuntime = currentEp.runtime;
              saveWatchProgress(allProgress);
              setWatchProgress(allProgress);
            }
          }
          items.push({ ...showData, media_type: 'tv', _savedProgress: prog });
        }
      } catch (e) { /* skip invalid */ }
    }

    if (items.length === 0) {
      section.classList.add('hidden');
      return;
    }

    renderCategoryRow('continueWatchingRow', items, 'tv', true);
  } catch (err) {
    section.classList.add('hidden');
  }
}

export async function loadRecommendations() {
  const section = document.getElementById('recommendationsSection');
  const container = document.getElementById('recommendationsRow');
  if (!section || !container) return;

  // Recommendations based on collection (no history)
  if (userCollection.length < 3) {
    section.classList.add('hidden');
    return;
  }
  section.classList.remove('hidden');
  container.innerHTML = '<div class="row-loading"><i class="fas fa-spinner"></i></div>';

  try {
    const genreCounts = {};
    userCollection.forEach(item => {
      if (item.genre_ids) {
        item.genre_ids.forEach(gid => {
          genreCounts[gid] = (genreCounts[gid] || 0) + 1;
        });
      }
    });
    const topGenres = Object.entries(genreCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([id]) => id)
      .join(',');

    if (!topGenres) {
      section.classList.add('hidden');
      return;
    }

    const data = await fetchWithAuth(`${BASE_URL}/discover/movie?with_genres=${topGenres}&language=en-US&page=1&sort_by=popularity.desc`);
    const existingIds = new Set(userCollection.map(c => c.id));
    const filtered = data.results.filter(item => !existingIds.has(item.id)).slice(0, 12);

    if (filtered.length === 0) {
      section.classList.add('hidden');
      return;
    }
    renderCategoryRow('recommendationsRow', filtered, 'movie');
  } catch (err) {
    section.classList.add('hidden');
  }
}

function sortStarWarsSaga(items) {
  const orderMap = {};
  STAR_WARS_SAGA_ORDER.forEach((title, index) => { orderMap[title.toLowerCase()] = index; });
  return [...items].sort((a, b) => {
    const titleA = (a.title || '').toLowerCase();
    const titleB = (b.title || '').toLowerCase();
    let idxA = 999, idxB = 999;
    for (const [key, val] of Object.entries(orderMap)) {
      if (titleA.includes(key)) idxA = val;
      if (titleB.includes(key)) idxB = val;
    }
    return idxA - idxB;
  });
}

export function renderCategoryRow(containerId, items, type, showProgress = false) {
  const container = document.getElementById(containerId);
  if (!container) return;
  if (!items?.length) {
    container.innerHTML = '<div class="row-loading">No results</div>';
    return;
  }

  container.innerHTML = items.map(item => {
    const poster = item.poster_path ? `${IMG_BASE}w300${item.poster_path}` : '';
    const title = item.title || item.name;
    const year = (item.release_date || item.first_air_date || '').slice(0, 4);
    const rating = item.omdbRating ? item.omdbRating.toFixed(1) : (item.vote_average ? item.vote_average.toFixed(1) : 'N/A');
    const progressBadge = (showProgress && item._savedProgress)
      ? `<span class="card-progress">S${item._savedProgress.season} E${item._savedProgress.episode}</span>`
      : '';

    // Progress bar under poster for Continue Watching
    let progressBar = '';
    if (showProgress && item._savedProgress && item._savedProgress.episodeRuntime) {
      const elapsed = item._savedProgress.elapsedMinutes || 0;
      const runtime = item._savedProgress.episodeRuntime;
      const pct = Math.min(Math.round((elapsed / runtime) * 100), 100);
      progressBar = `
        <div class="card-progress-bar-wrap">
          <div class="card-progress-bar" style="width:${pct}%"></div>
        </div>`;
    }

    return `
      <div class="category-card" data-id="${item.id}" data-type="${type}">
        <div class="card-poster">
          <img src="${poster}" alt="${title}" loading="lazy" onerror="this.style.display='none'">
          <span class="card-rating"><i class="fas fa-star"></i> ${rating}</span>
          ${progressBadge}
        </div>
        ${progressBar}
        <div class="card-title">${title}</div>
        <div class="card-year">${year || ''}</div>
      </div>`;
  }).join('');

  container.querySelectorAll('.category-card').forEach(card => {
    card.addEventListener('click', () => {
      openItemModal(parseInt(card.dataset.id), card.dataset.type);
    });
  });
}

/* Item Modal */
export async function openItemModal(id, type) {
  if (!itemModal) return;
  closeModalFolderDropdown();
  try {
    const data = await fetchWithAuth(`${BASE_URL}/${type}/${id}?language=en-US`);
    setCurrentModalItem({ ...data, media_type: type });
    const isInCollection = userCollection.some(c => c.id === id && c.media_type === type);

    const title = type === 'movie' ? data.title : data.name;
    const year = type === 'movie' ? data.release_date?.slice(0, 4) : data.first_air_date?.slice(0, 4);
    const poster = data.poster_path ? `${IMG_BASE}w300${data.poster_path}` : '';
    const backdrop = data.backdrop_path ? `${IMG_BASE}original${data.backdrop_path}` : '';
    const genres = data.genres?.map(g => `<span class="genre-tag">${g.name}</span>`).join('') || '';
    const omdbRating = await getOMDBRating(title, year);
    const rating = omdbRating ? omdbRating.toFixed(1) : (data.vote_average ? data.vote_average.toFixed(1) : 'N/A');

    const modalTitle = document.getElementById('modalTitle');
    const modalYear = document.getElementById('modalYear');
    const modalRating = document.getElementById('modalRating');
    const modalType = document.getElementById('modalType');
    const modalOverview = document.getElementById('modalOverview');
    const modalGenres = document.getElementById('modalGenres');
    const modalPoster = document.getElementById('modalPoster');

    if (modalTitle) modalTitle.textContent = title;
    if (modalYear) modalYear.textContent = year || 'Unknown';
    if (modalRating) {
      const span = modalRating.querySelector('span');
      if (span) span.textContent = rating;
    }
    if (modalType) modalType.textContent = type === 'movie' ? 'Movie' : 'TV Show';
    if (modalOverview) modalOverview.textContent = data.overview || 'No overview available.';
    if (modalGenres) modalGenres.innerHTML = genres;
    if (modalPoster) {
      modalPoster.src = poster;
      modalPoster.style.display = poster ? 'block' : 'none';
    }

    const backdropEl = document.querySelector('.modal-backdrop');
    if (backdropEl) {
      if (backdrop) {
        backdropEl.style.backgroundImage = `url(${backdrop})`;
        backdropEl.style.display = 'block';
      } else {
        backdropEl.style.display = 'none';
      }
    }

    const watchBtn = document.getElementById('modalWatchBtn');
    const colBtn = document.getElementById('modalCollectionBtn');

    const savedProg = type === 'tv' ? watchProgress[String(id)] : null;
    const hasProgress = savedProg && savedProg.season && savedProg.episode;

    if (watchBtn) {
      if (hasProgress) {
        watchBtn.innerHTML = `<i class="fas fa-play"></i> Resume S${savedProg.season} E${savedProg.episode}`;
      } else {
        watchBtn.innerHTML = '<i class="fas fa-play"></i> Watch Now';
      }
      watchBtn.onclick = () => openPlayer(id, type);
    }

    // Collection button: transforms into folder picker after adding
    if (colBtn) {
      colBtn.disabled = false;
      if (isInCollection) {
        renderModalFolderPicker(colBtn, id, type);
      } else {
        colBtn.innerHTML = '<i class="fas fa-plus"></i> Add to Collection';
        colBtn.className = 'btn btn-secondary';
        colBtn.onclick = () => {
          try {
            if (currentModalItem) {
              addToUserCollection(currentModalItem, null);
              renderModalFolderPicker(colBtn, id, type);
            }
          } catch (err) {
            console.error('[Modal collection btn] Error:', err);
            showToast('Failed to add to collection', 'error');
          }
        };
      }
    }

    // Remove from Continue Watching button (for TV shows with progress)
    let removeCWBtn = document.getElementById('modalRemoveCWBtn');
    const modalActions = document.querySelector('.modal-actions');
    if (type === 'tv' && hasProgress && modalActions) {
      if (!removeCWBtn) {
        removeCWBtn = document.createElement('button');
        removeCWBtn.id = 'modalRemoveCWBtn';
        removeCWBtn.className = 'btn btn-secondary';
        modalActions.appendChild(removeCWBtn);
      }
      removeCWBtn.style.display = 'inline-flex';
      removeCWBtn.innerHTML = '<i class="fas fa-clock-rotate-left"></i> Remove from Continue Watching';
      removeCWBtn.onclick = () => {
        const progress = getWatchProgress();
        if (progress[String(id)]) {
          delete progress[String(id)];
          saveWatchProgress(progress);
          setWatchProgress(progress);
          showToast('Removed from Continue Watching', 'success');
          removeCWBtn.style.display = 'none';
          // Refresh Continue Watching section if on home
          if (currentTab === 'home') loadContinueWatching();
          // Re-render modal buttons
          openItemModal(id, type);
        }
      };
    } else if (removeCWBtn) {
      removeCWBtn.style.display = 'none';
    }

    itemModal.classList.remove('hidden');
    searchResults?.classList.add('hidden');
    lockScroll();
  } catch (error) {
    showToast('Failed to load item details', 'error');
  }
}

/* Modals close handling */
export function initModals() {
  const itemModalOverlay = itemModal?.querySelector('.modal-overlay');
  const addAccountModal = document.getElementById('addAccountModal');
  const manageAccountsModal = document.getElementById('manageAccountsModal');
  const settingsModal = document.getElementById('settingsModal');

  function closeModal(modal) {
    if (!modal) return;
    modal.classList.add('hidden');
    // Close any open folder dropdown
    closeModalFolderDropdown();
    // Only unlock scroll if no other modals are open
    const anyOpen = [itemModal, addAccountModal, manageAccountsModal, settingsModal]
      .some(m => m && !m.classList.contains('hidden'));
    if (!anyOpen) unlockScroll();
  }

  // Close on overlay click
  [itemModal, addAccountModal, manageAccountsModal, settingsModal].forEach(modal => {
    if (!modal) return;
    const overlay = modal.querySelector('.modal-overlay');
    if (overlay) {
      overlay.addEventListener('click', () => closeModal(modal));
    }
  });

  // Close buttons
  document.querySelectorAll('.modal-close').forEach(btn => {
    btn.addEventListener('click', () => {
      const modal = btn.closest('.modal');
      closeModal(modal);
    });
  });

  // Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      [itemModal, addAccountModal, manageAccountsModal, settingsModal].forEach(modal => {
        closeModal(modal);
      });
      closeMovePopover();
      closeModalFolderDropdown();
    }
  });

  // Close move popover when clicking outside
  document.addEventListener('click', (e) => {
    if (_movePopoverOpen && !e.target.closest('.move-popover') && !e.target.closest('.move-btn')) {
      closeMovePopover();
    }
  });
}

function closeMovePopover() {
  const popover = document.getElementById('movePopover');
  if (popover) popover.remove();
  _movePopoverOpen = false;
}

function closeModalFolderDropdown() {
  const dropdown = document.getElementById('modalFolderDropdown');
  if (dropdown) dropdown.classList.add('hidden');
}

/* Modal folder picker: transforms the collection button into a folder dropdown */
function renderModalFolderPicker(btn, id, type) {
  const item = userCollection.find(c => c.id === id && c.media_type === type);
  if (!item) return;

  btn.className = 'btn btn-secondary modal-folder-picker';
  const currentFolder = item.folder || 'All';

  // Build options: All + custom folders
  const folders = ['All', ...userFolders.filter(f => f)];
  const options = folders.map(f => {
    const icon = f === currentFolder ? '<i class="fas fa-check"></i>' : '<i class="fas fa-folder"></i>';
    return `<span class="modal-folder-option" data-folder="${f}">${icon} ${f}</span>`;
  }).join('');

  btn.innerHTML = `<span class="modal-folder-label"><i class="fas fa-check"></i> In Collection</span><i class="fas fa-chevron-down" style="font-size:0.6rem;margin-left:0.25rem;"></i>`;

  let dropdown = document.getElementById('modalFolderDropdown');
  if (!dropdown) {
    dropdown = document.createElement('div');
    dropdown.id = 'modalFolderDropdown';
    dropdown.className = 'modal-folder-dropdown';
    document.body.appendChild(dropdown);
  }

  btn.onclick = (e) => {
    e.stopPropagation();
    const isOpen = !dropdown.classList.contains('hidden');
    if (isOpen) {
      dropdown.classList.add('hidden');
      return;
    }

    // Rebuild options to reflect current folder
    const currentF = item.folder || 'All';
    dropdown.innerHTML = folders.map(f => {
      const isActive = f === currentF;
      return `<button class="modal-folder-option-btn ${isActive ? 'active' : ''}" data-folder="${f}">${f === 'All' ? '<i class="fas fa-layer-group"></i>' : '<i class="fas fa-folder"></i>'} ${f}${isActive ? ' <i class="fas fa-check" style="margin-left:auto;"></i>' : ''}</button>`;
    }).join('');

    dropdown.classList.remove('hidden');

    // Position below button
    const rect = btn.getBoundingClientRect();
    dropdown.style.top = `${rect.bottom + 6}px`;
    dropdown.style.left = `${rect.left}px`;

    dropdown.querySelectorAll('.modal-folder-option-btn').forEach(opt => {
      opt.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const targetFolder = opt.dataset.folder;
        const chosen = targetFolder === 'All' ? null : targetFolder;
        if (chosen !== item.folder) {
          item.folder = chosen;
          saveUserCollection([...userCollection]);
          setUserCollection([...userCollection]);
          showToast(chosen ? `Moved to ${chosen}` : 'Moved to All', 'success');
        }
        dropdown.classList.add('hidden');
      });
    });
  };

  // Close dropdown on outside click
  const outsideClick = (e) => {
    if (!e.target.closest('.modal-folder-picker') && !e.target.closest('.modal-folder-dropdown')) {
      dropdown.classList.add('hidden');
      document.removeEventListener('click', outsideClick);
    }
  };
  document.addEventListener('click', outsideClick);
}

/* Add / Remove from Collection */
export function addToUserCollection(item, folder = null) {
  console.log('[addToUserCollection] Called with:', item, 'folder:', folder);

  if (!item || !item.id || !item.media_type) {
    console.error('[addToUserCollection] Invalid item:', item);
    showToast('Cannot add: invalid item data', 'error');
    return;
  }

  if (!Array.isArray(userCollection)) {
    console.error('[addToUserCollection] userCollection is not an array:', userCollection);
    showToast('Cannot add: collection data corrupted', 'error');
    return;
  }

  if (userCollection.some(c => c.id === item.id && c.media_type === item.media_type)) {
    showToast('Already in collection', 'info');
    return;
  }

  const title = item.title || item.name || 'Unknown';
  const year = (item.release_date || item.first_air_date || '').slice(0, 4);

  console.log('[addToUserCollection] Adding:', { id: item.id, media_type: item.media_type, title, year, folder });

  try {
    const newItem = {
      id: item.id,
      media_type: item.media_type,
      title: title,
      year: year,
      poster_path: item.poster_path || null,
      vote_average: item.vote_average || 0,
      folder: folder || null,
      added_at: new Date().toISOString()
    };

    userCollection.unshift(newItem);
    saveUserCollection(userCollection);
    console.log('[addToUserCollection] Saved to localStorage');

    if (currentTab === 'collection') renderUserCollection();
    if (currentTab === 'history') renderUserHistory();
    showToast(`${title} added to collection`, 'success');
  } catch (err) {
    console.error('[addToUserCollection] Save error:', err);
    showToast('Failed to add to collection', 'error');
  }
}

async function removeFromUserCollection(id, type) {
  const item = userCollection.find(c => c.id === id && c.media_type === type);
  if (!item) return;
  const confirmed = await showConfirm('Remove from Collection?', `Remove "${item.title}" from your collection? This cannot be undone.`);
  if (!confirmed) return;
  const newCollection = userCollection.filter(c => !(c.id === id && c.media_type === type));
  saveUserCollection(newCollection);
  setUserCollection(newCollection);
  if (currentTab === 'collection') renderUserCollection();
  showToast(`${item.title} removed from collection`, 'success');
}

/* Collection rendering */
function getSortedUserCollection() {
  let sorted = [...userCollection];
  const sort = collectionSort?.value || 'date-desc';
  switch (sort) {
    case 'date-desc': sorted.sort((a, b) => new Date(b.added_at) - new Date(a.added_at)); break;
    case 'date-asc': sorted.sort((a, b) => new Date(a.added_at) - new Date(b.added_at)); break;
    case 'title-asc': sorted.sort((a, b) => a.title.localeCompare(b.title)); break;
    case 'title-desc': sorted.sort((a, b) => b.title.localeCompare(a.title)); break;
    case 'rating-desc': sorted.sort((a, b) => (b.vote_average || 0) - (a.vote_average || 0)); break;
  }
  return sorted;
}

export function renderUserCollection() {
  if (!collectionGrid) return;
  const sorted = getSortedUserCollection();

  // Render folder tabs above the grid
  const folderTabsEl = document.getElementById('collectionFolderTabs');
  if (folderTabsEl) {
    // Build tabs: All + custom folders (no "Default")
    const customFolders = userFolders.filter(f => f);
    const allTabs = ['All', ...customFolders];

    let tabsHtml = allTabs.map(folder => {
      const isActive = (_collectionFolder === folder) || (folder === 'All' && !_collectionFolder);
      const count = folder === 'All'
        ? sorted.length
        : sorted.filter(item => item.folder === folder).length;
      return `<button class="folder-tab ${isActive ? 'active' : ''}" data-folder="${folder}">${folder} <span class="folder-count">${count}</span></button>`;
    }).join('');

    // Inline create-folder form or + button
    if (_creatingFolder) {
      tabsHtml += `
        <div class="folder-tab folder-tab-create">
          <input type="text" id="newFolderInput" placeholder="Folder name..." maxlength="24" autocomplete="off">
          <button id="saveNewFolderBtn" title="Create"><i class="fas fa-check"></i></button>
          <button id="cancelNewFolderBtn" title="Cancel"><i class="fas fa-times"></i></button>
        </div>`;
    } else {
      tabsHtml += `<button class="folder-tab folder-tab-new" id="addFolderBtn" title="New Folder"><i class="fas fa-plus"></i></button>`;
    }

    folderTabsEl.innerHTML = tabsHtml;

    folderTabsEl.querySelectorAll('.folder-tab[data-folder]').forEach(tab => {
      tab.addEventListener('click', () => {
        const folder = tab.dataset.folder;
        _collectionFolder = folder === 'All' ? null : folder;
        renderUserCollection();
      });
    });

    if (_creatingFolder) {
      const input = document.getElementById('newFolderInput');
      const saveBtn = document.getElementById('saveNewFolderBtn');
      const cancelBtn = document.getElementById('cancelNewFolderBtn');

      if (input) {
        input.focus();
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') saveNewFolder(input.value.trim());
          if (e.key === 'Escape') cancelNewFolder();
        });
      }
      saveBtn?.addEventListener('click', () => saveNewFolder(input?.value.trim() || ''));
      cancelBtn?.addEventListener('click', cancelNewFolder);
    } else {
      const addFolderBtn = document.getElementById('addFolderBtn');
      if (addFolderBtn) {
        addFolderBtn.onclick = () => {
          _creatingFolder = true;
          renderUserCollection();
        };
      }
    }
  }

  // Filter by selected folder
  const filtered = _collectionFolder
    ? sorted.filter(item => item.folder === _collectionFolder)
    : sorted;

  if (filtered.length === 0) {
    collectionGrid.innerHTML = `
      <div class="empty-state">
        <i class="fas fa-layer-group"></i>
        <h3>${_collectionFolder ? `No items in "${_collectionFolder}"` : 'Your collection is empty'}</h3>
        <p>Browse or search to add movies and shows to your collection</p>
      </div>`;
    return;
  }

  collectionGrid.innerHTML = filtered.map(item => {
    const poster = item.poster_path ? `${IMG_BASE}w300${item.poster_path}` : '';
    const rating = item.vote_average ? item.vote_average.toFixed(1) : 'N/A';
    const prog = item.media_type === 'tv' ? watchProgress[String(item.id)] : null;
    const progressBadge = prog ? `<span class="grid-progress">S${prog.season} E${prog.episode}</span>` : '';
    return `
      <div class="grid-item" data-id="${item.id}" data-type="${item.media_type}">
        <div class="item-poster">
          <img src="${poster}" alt="${item.title}" loading="lazy" onerror="this.style.display='none'">
          <span class="type-badge">${item.media_type === 'movie' ? 'Movie' : 'TV'}</span>
          ${progressBadge}
          <div class="item-overlay">
            <div class="item-actions">
              <button class="item-action-btn watch-btn" data-id="${item.id}" data-type="${item.media_type}" title="Watch Now"><i class="fas fa-play"></i></button>
              <button class="item-action-btn move-btn" data-id="${item.id}" data-type="${item.media_type}" title="Move to Folder"><i class="fas fa-folder"></i></button>
              <button class="item-action-btn delete-btn" data-id="${item.id}" data-type="${item.media_type}"><i class="fas fa-trash"></i></button>
            </div>
          </div>
        </div>
        <div class="item-info">
          <div class="item-title">${item.title}</div>
          <div class="item-meta">
            <span class="item-rating"><i class="fas fa-star"></i> ${rating}</span>
            <span style="color:var(--text-muted);font-size:0.625rem;">${item.year || ''}</span>
          </div>
        </div>
      </div>`;
  }).join('');

  collectionGrid.querySelectorAll('.watch-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openPlayer(parseInt(btn.dataset.id), btn.dataset.type);
    });
  });

  collectionGrid.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      removeFromUserCollection(parseInt(btn.dataset.id), btn.dataset.type);
    });
  });

  collectionGrid.querySelectorAll('.move-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = parseInt(btn.dataset.id);
      const type = btn.dataset.type;
      const item = userCollection.find(c => c.id === id && c.media_type === type);
      if (!item) return;
      openMovePopover(btn, item);
    });
  });
}

function saveNewFolder(name) {
  if (!name) {
    cancelNewFolder();
    return;
  }
  const cleanName = name.trim();
  if (!cleanName) {
    cancelNewFolder();
    return;
  }
  if (userFolders.includes(cleanName) || cleanName.toLowerCase() === 'all') {
    showToast('Folder already exists', 'error');
    return;
  }
  const nextFolders = [...userFolders, cleanName];
  saveUserFolders(nextFolders);
  setUserFolders(nextFolders);
  _creatingFolder = false;
  _collectionFolder = cleanName;
  renderUserCollection();
  showToast(`Folder "${cleanName}" created`, 'success');
}

function cancelNewFolder() {
  _creatingFolder = false;
  renderUserCollection();
}

function openMovePopover(button, item) {
  closeMovePopover();
  _movePopoverOpen = true;

  const rect = button.getBoundingClientRect();
  const popover = document.createElement('div');
  popover.id = 'movePopover';
  popover.className = 'move-popover';

  const currentFolder = item.folder || null;
  const availableFolders = userFolders.filter(f => f && f !== currentFolder);

  let html = '<div class="move-popover-header"><span>Move to...</span><button id="closeMovePopover"><i class="fas fa-times"></i></button></div>';
  html += '<div class="move-popover-list">';

  if (currentFolder) {
    html += `<button class="move-popover-item" data-folder=""><i class="fas fa-minus-circle"></i> Remove from folder</button>`;
  }

  availableFolders.forEach(folder => {
    html += `<button class="move-popover-item" data-folder="${folder}"><i class="fas fa-folder"></i> ${folder}</button>`;
  });

  if (availableFolders.length === 0 && !currentFolder) {
    html += '<div class="move-popover-empty">No folders yet. Create one first.</div>';
  }

  html += '</div>';
  popover.innerHTML = html;

  document.body.appendChild(popover);

  // Position popover
  const popRect = popover.getBoundingClientRect();
  let top = rect.bottom + 8;
  let left = rect.left;
  if (top + popRect.height > window.innerHeight) top = rect.top - popRect.height - 8;
  if (left + popRect.width > window.innerWidth) left = window.innerWidth - popRect.width - 16;
  popover.style.top = `${top}px`;
  popover.style.left = `${left}px`;

  // Close button
  document.getElementById('closeMovePopover')?.addEventListener('click', closeMovePopover);

  // Folder selection
  popover.querySelectorAll('.move-popover-item[data-folder]').forEach(el => {
    el.addEventListener('click', () => {
      const targetFolder = el.dataset.folder || null;
      if (targetFolder === currentFolder) {
        closeMovePopover();
        return;
      }
      item.folder = targetFolder;
      saveUserCollection([...userCollection]);
      setUserCollection([...userCollection]);
      renderUserCollection();
      closeMovePopover();
      showToast(targetFolder ? `Moved to ${targetFolder}` : 'Removed from folder', 'success');
    });
  });
}

export async function addToUserHistory(item) {
  if (!item || !item.id || !item.media_type) return;

  let historyItem = item;
  if (!historyItem.title && !historyItem.name) {
    try {
      const data = await fetchWithAuth(`${BASE_URL}/${item.media_type}/${item.id}?language=en-US`);
      historyItem = { ...data, media_type: item.media_type };
    } catch (err) {
      historyItem = { ...item };
    }
  }

  const title = historyItem.title || historyItem.name || 'Unknown';
  const year = (historyItem.release_date || historyItem.first_air_date || '').slice(0, 4);

  const existing = userHistory.filter(h => !(h.id === item.id && h.media_type === item.media_type));
  const nextHistory = [
    {
      id: item.id,
      media_type: item.media_type,
      title,
      year,
      poster_path: historyItem.poster_path || null,
      vote_average: historyItem.vote_average || 0,
      watched_at: new Date().toISOString()
    },
    ...existing
  ].slice(0, 200);

  saveUserHistory(nextHistory);
  setUserHistory(getUserHistory());
  if (currentTab === 'history') renderUserHistory();
}

async function removeFromUserHistory(id, type) {
  const item = userHistory.find(h => h.id === id && h.media_type === type);
  if (!item) return;
  const confirmed = await showConfirm('Remove from History?', `Remove "${item.title}" from your history?`);
  if (!confirmed) return;
  const nextHistory = userHistory.filter(h => !(h.id === id && h.media_type === type));
  saveUserHistory(nextHistory);
  setUserHistory(nextHistory);

  // Also remove from Continue Watching / progress
  if (type === 'tv') {
    const progress = getWatchProgress();
    if (progress[String(id)]) {
      delete progress[String(id)];
      saveWatchProgress(progress);
      setWatchProgress(progress);
      // Refresh Continue Watching if on home
      if (currentTab === 'home') loadContinueWatching();
    }
  }

  if (currentTab === 'history') renderUserHistory();
  showToast(`${item.title} removed from history`, 'success');
}

function getSortedUserHistory() {
  const sorted = [...userHistory];
  const sort = historySort?.value || 'date-desc';
  switch (sort) {
    case 'date-desc': sorted.sort((a, b) => new Date(b.watched_at) - new Date(a.watched_at)); break;
    case 'date-asc': sorted.sort((a, b) => new Date(a.watched_at) - new Date(b.watched_at)); break;
    case 'title-asc': sorted.sort((a, b) => a.title.localeCompare(b.title)); break;
    case 'title-desc': sorted.sort((a, b) => b.title.localeCompare(a.title)); break;
    case 'rating-desc': sorted.sort((a, b) => (b.vote_average || 0) - (a.vote_average || 0)); break;
  }
  return sorted;
}

export function renderUserHistory() {
  if (!historyGrid) return;
  const sorted = getSortedUserHistory();

  if (sorted.length === 0) {
    historyGrid.innerHTML = `
      <div class="empty-state">
        <i class="fas fa-clock-rotate-left"></i>
        <h3>Your history is empty</h3>
        <p>Start watching to build your history</p>
      </div>`;
    return;
  }

  historyGrid.innerHTML = sorted.map(item => {
    const poster = item.poster_path ? `${IMG_BASE}w300${item.poster_path}` : '';
    const rating = item.vote_average ? item.vote_average.toFixed(1) : 'N/A';
    const isInCollection = userCollection.some(c => c.id === item.id && c.media_type === item.media_type);
    const prog = item.media_type === 'tv' ? watchProgress[String(item.id)] : null;
    const progressBadge = prog ? `<span class="grid-progress">S${prog.season} E${prog.episode}</span>` : '';
    return `
      <div class="grid-item" data-id="${item.id}" data-type="${item.media_type}">
        <div class="item-poster">
          <img src="${poster}" alt="${item.title}" loading="lazy" onerror="this.style.display='none'">
          <span class="type-badge">${item.media_type === 'movie' ? 'Movie' : 'TV'}</span>
          ${progressBadge}
          <div class="item-overlay">
            <div class="item-actions">
              <button class="item-action-btn watch-btn" data-id="${item.id}" data-type="${item.media_type}" title="Watch Now"><i class="fas fa-play"></i></button>
              <button class="item-action-btn collection-btn" data-id="${item.id}" data-type="${item.media_type}" title="Save to Collection" ${isInCollection ? 'disabled' : ''}><i class="fas ${isInCollection ? 'fa-check' : 'fa-plus'}"></i></button>
              <button class="item-action-btn delete-btn" data-id="${item.id}" data-type="${item.media_type}" title="Remove from History"><i class="fas fa-trash"></i></button>
            </div>
          </div>
        </div>
        <div class="item-info">
          <div class="item-title">${item.title}</div>
          <div class="item-meta">
            <span class="item-rating"><i class="fas fa-star"></i> ${rating}</span>
            <span style="color:var(--text-muted);font-size:0.625rem;">${item.year || ''}</span>
          </div>
        </div>
      </div>`;
  }).join('');

  historyGrid.querySelectorAll('.watch-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openPlayer(parseInt(btn.dataset.id), btn.dataset.type);
    });
  });

  historyGrid.querySelectorAll('.collection-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (btn.disabled) return;
      const id = parseInt(btn.dataset.id);
      const type = btn.dataset.type;
      const item = userHistory.find(h => h.id === id && h.media_type === type);
      if (!item) return;
      addToUserCollection(item);
      btn.innerHTML = '<i class="fas fa-check"></i>';
      btn.disabled = true;
    });
  });

  historyGrid.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      removeFromUserHistory(parseInt(btn.dataset.id), btn.dataset.type);
    });
  });
}
