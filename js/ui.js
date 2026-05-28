/** UI Rendering: Search, Categories, Modals, Collection, History */
import {
  userCollection, userHistory, watchProgress, userFolders, currentTab, currentModalItem, setCurrentTab,
  setSearchTimeout, setCurrentModalItem, heroSlides, setHeroSlides,
  setUserCollection, setUserHistory, setWatchProgress, setUserFolders,
  searchGalleryResults, setSearchGalleryResults, searchGalleryQuery, setSearchGalleryQuery
} from './state.js';
import {
  getUserCollection, saveUserCollection, getUserHistory, saveUserHistory,
  getWatchProgress, saveWatchProgress, getUserFolders, saveUserFolders,
  addToUserCollection as storageAddCollection, removeFromUserCollection as storageRemoveCollection,
  addToUserHistory as storageAddHistory, removeFromUserHistory as storageRemoveHistory,
  saveUserFolders as storageSaveFolders
} from './storage.js';
import { BASE_URL, IMG_BASE, STAR_WARS_SAGA_ORDER, API_KEY } from './config.js';
import { fetchWithAuth, getOMDBRatingsBatch, getOMDBRating, getTrailer } from './api.js';
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
const searchView = document.getElementById('searchView');
const searchGrid = document.getElementById('searchGrid');
const searchQueryTitle = document.getElementById('searchQueryTitle');
const searchResultCount = document.getElementById('searchResultCount');
const searchBackBtn = document.getElementById('searchBackBtn');
const itemModal = document.getElementById('itemModal');
const collectionSort = document.getElementById('collectionSort');
const historySort = document.getElementById('historySort');

/* Collection folder state */
let _collectionFolder = null; // null = show all (no folder filter)

/* Inline folder creation state */
let _creatingFolder = false;

/* Move popover state */
let _movePopoverOpen = false;

/* Previous view for back navigation */
let _previousView = 'home';

/* Saved home scroll position for back navigation */
let _homeScrollY = 0;

/* Franchise / genre search mapping */
const FRANCHISE_MAP = {
  'marvel': { companies: [420], keywords: [180547, 335711], name: 'Marvel' },
  'star wars': { keywords: [1605, 161257], collections: [10], name: 'Star Wars' },
  'dc': { companies: [429], keywords: [234700, 270768], name: 'DC' },
  'dc comics': { companies: [429], keywords: [234700, 270768], name: 'DC' },
  'pixar': { companies: [3], name: 'Pixar' },
  'disney': { companies: [2], name: 'Disney' },
  'harry potter': { keywords: [2343, 2344], collections: [1241], name: 'Harry Potter' },
  'lord of the rings': { keywords: [12565, 1956], collections: [119], name: 'Lord of the Rings' },
  'hobbit': { keywords: [12565, 1956], collections: [121938], name: 'The Hobbit' },
  'fast and furious': { keywords: [13057], collections: [130], name: 'Fast & Furious' },
  'james bond': { keywords: [470], collections: [645], name: 'James Bond' },
  'jurassic park': { keywords: [10085], collections: [328], name: 'Jurassic Park' },
  'mission impossible': { keywords: [182778], collections: [87361], name: 'Mission: Impossible' },
  'transformers': { keywords: [9887], collections: [14890], name: 'Transformers' },
  'terminator': { keywords: [296], collections: [528], name: 'Terminator' },
  'batman': { keywords: [10065, 1945], collections: [120794], name: 'Batman' },
  'superman': { keywords: [10065, 8534], name: 'Superman' },
  'spider-man': { keywords: [10065, 9887], name: 'Spider-Man' },
  'spiderman': { keywords: [10065, 9887], name: 'Spider-Man' },
  'avengers': { keywords: [9926, 180547], name: 'Avengers' },
  'indiana jones': { keywords: [13302], collections: [84], name: 'Indiana Jones' },
  'matrix': { keywords: [1694], collections: [2344], name: 'The Matrix' },
  'pirates of the caribbean': { keywords: [335711], collections: [295], name: 'Pirates of the Caribbean' },
  'john wick': { keywords: [185106], collections: [404609], name: 'John Wick' },
  'rocky': { keywords: [5331], collections: [531], name: 'Rocky' },
  'alien': { keywords: [1601], collections: [8091], name: 'Alien' },
  'predator': { keywords: [184], collections: [166], name: 'Predator' },
  'godzilla': { keywords: [3947, 12654], collections: [535313], name: 'Godzilla' },
  'king kong': { keywords: [10263, 12654], collections: [535313], name: 'King Kong' },
  'sherlock holmes': { keywords: [414], name: 'Sherlock Holmes' },
  'planet of the apes': { keywords: [10266], collections: [173710], name: 'Planet of the Apes' },
  'mad max': { keywords: [417], collections: [5289], name: 'Mad Max' },
  'die hard': { keywords: [1711], collections: [1579], name: 'Die Hard' },
  'men in black': { keywords: [10370], collections: [86082], name: 'Men in Black' },
  'ghostbusters': { keywords: [2452], collections: [2980], name: 'Ghostbusters' },
  'back to the future': { keywords: [1601], collections: [264], name: 'Back to the Future' },
  'the mummy': { keywords: [2412], collections: [3535], name: 'The Mummy' },
  'hunger games': { keywords: [13183], collections: [131635], name: 'The Hunger Games' },
  'twilight': { keywords: [13184], collections: [33566], name: 'Twilight' },
  'divergent': { keywords: [13183], collections: [283597], name: 'Divergent' },
  ' maze runner': { keywords: [13183], collections: [227544], name: 'The Maze Runner' },
  'fantastic beasts': { keywords: [2343], collections: [435259], name: 'Fantastic Beasts' },
  'monsterverse': { keywords: [12654], collections: [535313], name: 'MonsterVerse' },
  'wizarding world': { keywords: [2343], name: 'Wizarding World' },
  'x-men': { keywords: [10065, 13290], name: 'X-Men' },
  'xmen': { keywords: [10065, 13290], name: 'X-Men' },
  'blade runner': { keywords: [221], collections: [422837], name: 'Blade Runner' },
  'dune': { keywords: [210024], collections: [726871], name: 'Dune' },
  'interstellar': { keywords: [10373], name: 'Interstellar' },
  'inception': { keywords: [10373], name: 'Inception' },
  'tenet': { keywords: [10373], name: 'Tenet' },
  'dark knight': { keywords: [10065, 1945], name: 'The Dark Knight' },
  'gladiator': { keywords: [10373], name: 'Gladiator' },
};

function getMatchedFranchise(query) {
  const lower = query.toLowerCase();
  for (const [key, value] of Object.entries(FRANCHISE_MAP)) {
    if (lower.includes(key)) return value;
  }
  return null;
}

async function fetchFranchiseResults(franchise) {
  const results = [];
  const seen = new Set();
  const opts = { headers: { 'Authorization': `Bearer ${API_KEY}`, 'Accept': 'application/json' } };

  const addItems = (items, mediaType) => {
    items.forEach(item => {
      if (!item?.id || seen.has(item.id)) return;
      seen.add(item.id);
      results.push({ ...item, media_type: mediaType });
    });
  };

  // 1. Try collection endpoints (most reliable)
  if (franchise.collections?.length) {
    await Promise.all(franchise.collections.map(async (id) => {
      try {
        const res = await fetch(`${BASE_URL}/collection/${id}?language=en-US`, opts);
        if (!res.ok) return;
        const data = await res.json();
        if (data.parts?.length) addItems(data.parts, 'movie');
      } catch (e) { /* skip */ }
    }));
  }

  // 2. Try search as fallback (very reliable)
  try {
    const searchRes = await fetch(
      `${BASE_URL}/search/movie?query=${encodeURIComponent(franchise.name)}&language=en-US&page=1`,
      opts
    );
    if (searchRes.ok) {
      const searchData = await searchRes.json();
      if (searchData.results?.length) addItems(searchData.results.slice(0, 20), 'movie');
    }
  } catch (e) { /* skip */ }

  // 3. Try discover for movies
  try {
    const params = new URLSearchParams({
      language: 'en-US', page: '1', sort_by: 'popularity.desc',
      include_adult: 'false'
    });
    if (franchise.companies?.length) params.append('with_companies', franchise.companies.join(','));
    if (franchise.keywords?.length) params.append('with_keywords', franchise.keywords.join(','));
    const discRes = await fetch(`${BASE_URL}/discover/movie?${params.toString()}`, opts);
    if (discRes.ok) {
      const discData = await discRes.json();
      if (discData.results?.length) addItems(discData.results, 'movie');
    }
  } catch (e) { /* skip */ }

  // 4. Try TV discover
  try {
    const tvParams = new URLSearchParams({
      language: 'en-US', page: '1', sort_by: 'popularity.desc',
      include_adult: 'false'
    });
    if (franchise.keywords?.length) tvParams.append('with_keywords', franchise.keywords.join(','));
    const tvRes = await fetch(`${BASE_URL}/discover/tv?${tvParams.toString()}`, opts);
    if (tvRes.ok) {
      const tvData = await tvRes.json();
      if (tvData.results?.length) addItems(tvData.results, 'tv');
    }
  } catch (e) { /* skip */ }

  return results;
}

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
  searchView?.classList.add('hidden');
  document.getElementById('collectionsView')?.classList.add('hidden');
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
      if (q.length >= 2) showSearchGallery(q);
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
    if (searchView && !searchView.classList.contains('hidden')) {
      const prevBtn = document.querySelector(`.nav-btn[data-tab="${currentTab}"]`);
      if (prevBtn) prevBtn.click();
      // Restore home scroll position if going back to home
      if (currentTab === 'home') {
        requestAnimationFrame(() => {
          window.scrollTo(0, _homeScrollY);
        });
      }
    }
  });

  searchBackBtn?.addEventListener('click', () => {
    searchView?.classList.add('hidden');
    if (_previousView === 'collections') {
      document.getElementById('collectionsView')?.classList.remove('hidden');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      const prevBtn = document.querySelector(`.nav-btn[data-tab="${currentTab}"]`);
      if (prevBtn) prevBtn.click();
      // Restore home scroll position
      requestAnimationFrame(() => {
        window.scrollTo(0, _homeScrollY);
      });
    }
  });

  // Collections view back button
  const collectionsBackBtn = document.getElementById('collectionsBackBtn');
  collectionsBackBtn?.addEventListener('click', () => {
    document.getElementById('collectionsView')?.classList.add('hidden');
    homeView?.classList.remove('hidden');
    const homeBtn = document.querySelector('.nav-btn[data-tab="home"]');
    if (homeBtn) homeBtn.click();
    // Restore home scroll position
    requestAnimationFrame(() => {
      window.scrollTo(0, _homeScrollY);
    });
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-container')) {
      searchResults?.classList.add('hidden');
    }
  });

  collectionSort?.addEventListener('change', renderUserCollection);
  historySort?.addEventListener('change', renderUserHistory);

  // Search gallery filter dropdown toggle
  const filtersToggle = document.getElementById('searchFiltersToggle');
  const filtersDropdown = document.getElementById('searchFiltersDropdown');
  if (filtersToggle && filtersDropdown) {
    filtersToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = !filtersDropdown.classList.contains('hidden');
      if (isOpen) {
        filtersDropdown.classList.add('hidden');
        filtersToggle.classList.remove('active');
      } else {
        filtersDropdown.classList.remove('hidden');
        filtersToggle.classList.add('active');
      }
    });
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.search-filters-dropdown-wrap')) {
        filtersDropdown.classList.add('hidden');
        filtersToggle.classList.remove('active');
      }
    });
  }

  // Search gallery filter listeners
  ['searchFilterType', 'searchFilterRating', 'searchFilterSort'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', () => {
      if (searchGalleryResults.length > 0) renderSearchGallery(searchGalleryResults, searchGalleryQuery);
    });
  });
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
    let results = [
      ...movies.results.map(item => ({ ...item, media_type: 'movie' })),
      ...tvShows.results.map(item => ({ ...item, media_type: 'tv' }))
    ];

    // Franchise search: if query matches a known franchise, merge discover results
    const franchise = getMatchedFranchise(query);
    if (franchise) {
      const franchiseResults = await fetchFranchiseResults(franchise);
      const seen = new Set(results.map(r => r.id));
      franchiseResults.forEach(item => {
        if (!seen.has(item.id)) {
          seen.add(item.id);
          results.push(item);
        }
      });
    }

    results.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
    results = results.slice(0, 15);

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

/* Search Gallery View */
function showSearchGallery(query) {
  if (!query || query.length < 2) return;
  _previousView = 'home';
  _homeScrollY = window.scrollY;
  searchResults?.classList.add('hidden');
  homeView?.classList.add('hidden');
  collectionView?.classList.add('hidden');
  historyView?.classList.add('hidden');
  document.getElementById('collectionsView')?.classList.add('hidden');
  searchView?.classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
  searchTMDBGallery(query);
}

async function searchTMDBGallery(query) {
  if (!searchGrid) return;
  document.getElementById('collectionsView')?.classList.add('hidden');
  searchGrid.innerHTML = '<div class="search-loading"><i class="fas fa-spinner"></i> Searching...</div>';
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
    let results = [
      ...movies.results.map(item => ({ ...item, media_type: 'movie' })),
      ...tvShows.results.map(item => ({ ...item, media_type: 'tv' }))
    ];

    // Franchise search: if query matches a known franchise, merge discover results
    const franchise = getMatchedFranchise(query);
    if (franchise) {
      const franchiseResults = await fetchFranchiseResults(franchise);
      const seen = new Set(results.map(r => r.id));
      franchiseResults.forEach(item => {
        if (!seen.has(item.id)) {
          seen.add(item.id);
          results.push(item);
        }
      });
    }

    results.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));

    const omdbRatings = await getOMDBRatingsBatch(results);
    results.forEach(item => { if (omdbRatings[item.id]) item.omdbRating = omdbRatings[item.id]; });

    setSearchGalleryResults(results);
    setSearchGalleryQuery(query);
    renderSearchGallery(results, query);
  } catch (error) {
    searchGrid.innerHTML = '<div class="search-loading">Search failed. Please try again.</div>';
    if (searchResultCount) searchResultCount.textContent = 'Error';
  }
}

function getSearchFilters() {
  return {
    type: document.getElementById('searchFilterType')?.value || 'all',
    rating: document.getElementById('searchFilterRating')?.value || 'all',
    sort: document.getElementById('searchFilterSort')?.value || 'popularity'
  };
}

function applySearchFilters(results) {
  const filters = getSearchFilters();
  let filtered = [...results];

  if (filters.type !== 'all') {
    filtered = filtered.filter(item => item.media_type === filters.type);
  }
  if (filters.rating !== 'all') {
    const min = parseFloat(filters.rating);
    filtered = filtered.filter(item => {
      const r = item.omdbRating || item.vote_average || 0;
      return r >= min;
    });
  }

  switch (filters.sort) {
    case 'rating-desc': filtered.sort((a, b) => (b.omdbRating || b.vote_average || 0) - (a.omdbRating || a.vote_average || 0)); break;
    case 'rating-asc': filtered.sort((a, b) => (a.omdbRating || a.vote_average || 0) - (b.omdbRating || b.vote_average || 0)); break;
    case 'year-desc': filtered.sort((a, b) => ((b.release_date || b.first_air_date || '').localeCompare(a.release_date || a.first_air_date || ''))); break;
    case 'year-asc': filtered.sort((a, b) => ((a.release_date || a.first_air_date || '').localeCompare(b.release_date || b.first_air_date || ''))); break;
    default: filtered.sort((a, b) => (b.popularity || 0) - (a.popularity || 0)); break;
  }

  return filtered;
}

/* Genre Gallery */
export async function showGenreGallery(genreId, genreName) {
  _previousView = 'home';
  _homeScrollY = window.scrollY;
  searchResults?.classList.add('hidden');
  homeView?.classList.add('hidden');
  collectionView?.classList.add('hidden');
  historyView?.classList.add('hidden');
  document.getElementById('collectionsView')?.classList.add('hidden');
  searchView?.classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });

  if (!searchGrid) return;
  searchGrid.innerHTML = '<div class="search-loading"><i class="fas fa-spinner"></i> Loading...</div>';
  if (searchQueryTitle) searchQueryTitle.textContent = genreName || 'Genre Results';
  if (searchResultCount) searchResultCount.textContent = '';

  try {
    const [movieRes, tvRes] = await Promise.all([
      fetch(`${BASE_URL}/discover/movie?with_genres=${genreId}&language=en-US&page=1&sort_by=popularity.desc`, {
        headers: { 'Authorization': `Bearer ${API_KEY}`, 'Accept': 'application/json' }
      }),
      fetch(`${BASE_URL}/discover/tv?with_genres=${genreId}&language=en-US&page=1&sort_by=popularity.desc`, {
        headers: { 'Authorization': `Bearer ${API_KEY}`, 'Accept': 'application/json' }
      })
    ]);
    const movies = await movieRes.json();
    const tvShows = await tvRes.json();
    const results = [
      ...movies.results.map(item => ({ ...item, media_type: 'movie' })),
      ...tvShows.results.map(item => ({ ...item, media_type: 'tv' }))
    ].sort((a, b) => (b.popularity || 0) - (a.popularity || 0));

    const omdbRatings = await getOMDBRatingsBatch(results);
    results.forEach(item => { if (omdbRatings[item.id]) item.omdbRating = omdbRatings[item.id]; });

    setSearchGalleryResults(results);
    setSearchGalleryQuery('');
    renderSearchGallery(results, '', `${genreName} Movies & TV Shows`);
  } catch (error) {
    searchGrid.innerHTML = '<div class="search-loading">Failed to load genre results.</div>';
  }
}

/* Collection Gallery */
export async function showCollectionGallery(collectionId, collectionName) {
  const fromCollections = !document.getElementById('collectionsView')?.classList.contains('hidden');
  _previousView = fromCollections ? 'collections' : 'home';
  if (!fromCollections) _homeScrollY = window.scrollY;
  searchResults?.classList.add('hidden');
  homeView?.classList.add('hidden');
  collectionView?.classList.add('hidden');
  historyView?.classList.add('hidden');
  document.getElementById('collectionsView')?.classList.add('hidden');
  searchView?.classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });

  if (!searchGrid) return;
  searchGrid.innerHTML = '<div class="search-loading"><i class="fas fa-spinner"></i> Loading...</div>';
  if (searchQueryTitle) searchQueryTitle.textContent = collectionName || 'Collection';
  if (searchResultCount) searchResultCount.textContent = '';

  const seen = new Set();
  const results = [];
  const opts = { headers: { 'Authorization': `Bearer ${API_KEY}`, 'Accept': 'application/json' } };

  // 1. Try collection endpoint
  try {
    const data = await fetchWithAuth(`${BASE_URL}/collection/${collectionId}?language=en-US`);
    if (data.parts?.length) {
      data.parts.forEach(item => {
        if (!item.poster_path || seen.has(item.id)) return;
        seen.add(item.id);
        results.push({ ...item, media_type: 'movie' });
      });
    }
  } catch (e) { /* skip */ }

  // 2. Always search by collection name to find more movies
  if (collectionName) {
    try {
      const searchRes = await fetch(`${BASE_URL}/search/movie?query=${encodeURIComponent(collectionName)}&language=en-US&page=1`, opts);
      if (searchRes.ok) {
        const searchData = await searchRes.json();
        if (searchData.results?.length) {
          searchData.results.forEach(item => {
            if (!item.poster_path || seen.has(item.id)) return;
            seen.add(item.id);
            results.push({ ...item, media_type: 'movie' });
          });
        }
      }
    } catch (e) { /* skip */ }
  }

  // 3. Always try franchise discover to get ALL franchise movies (merges with collection)
  if (collectionName) {
    const franchise = getMatchedFranchise(collectionName);
    if (franchise) {
      const franchiseResults = await fetchFranchiseResults(franchise);
      franchiseResults.forEach(item => {
        if (!item.poster_path || seen.has(item.id)) return;
        seen.add(item.id);
        results.push(item);
      });
    }
  }

  // Sort by release date
  results.sort((a, b) => {
    const aDate = a.release_date || a.first_air_date || '';
    const bDate = b.release_date || b.first_air_date || '';
    return aDate.localeCompare(bDate);
  });

  if (results.length === 0) {
    searchGrid.innerHTML = '<div class="search-loading">No movies found in this collection.</div>';
    return;
  }

  const omdbRatings = await getOMDBRatingsBatch(results);
  results.forEach(item => { if (omdbRatings[item.id]) item.omdbRating = omdbRatings[item.id]; });

  setSearchGalleryResults(results);
  setSearchGalleryQuery('');
  renderSearchGallery(results, '', collectionName);
}

/* Popular Collections on Home — verified TMDB collection IDs */
const POPULAR_COLLECTIONS = [
  { id: 1241, name: 'Harry Potter' },
  { id: 10, name: 'Star Wars' },
  { id: 86311, name: 'Marvel: The Infinity Saga' },
  { id: 119, name: 'The Lord of the Rings' },
  { id: 121938, name: 'The Hobbit' },
  { id: 130, name: 'Fast & Furious' },
  { id: 645, name: 'James Bond' },
  { id: 328, name: 'Jurassic Park' },
  { id: 528, name: 'Terminator' },
  { id: 120794, name: 'Batman' },
  { id: 84, name: 'Indiana Jones' },
  { id: 2344, name: 'The Matrix' },
  { id: 295, name: 'Pirates of the Caribbean' },
  { id: 404609, name: 'John Wick' },
  { id: 531, name: 'Rocky' },
  { id: 8091, name: 'Alien' },
  { id: 166, name: 'Predator' },
  { id: 5289, name: 'Mad Max' },
  { id: 1579, name: 'Die Hard' },
  { id: 86082, name: 'Men in Black' },
  { id: 2980, name: 'Ghostbusters' },
  { id: 264, name: 'Back to the Future' },
  { id: 3535, name: 'The Mummy' },
  { id: 131635, name: 'The Hunger Games' },
  { id: 33566, name: 'Twilight' },
  { id: 283597, name: 'Divergent' },
  { id: 227544, name: 'The Maze Runner' },
  { id: 435259, name: 'Fantastic Beasts' },
  { id: 748, name: 'X-Men' },
  { id: 726871, name: 'Dune' },
  { id: 264, name: 'Back to the Future' },
  { id: 14890, name: 'Transformers' },
  { id: 87361, name: 'Mission: Impossible' },
  { id: 1241, name: 'Harry Potter' },
  { id: 10, name: 'Star Wars' },
];

/* All Collections for See All view */
const ALL_COLLECTIONS = [
  ...POPULAR_COLLECTIONS,
  { id: 553717, name: 'Creed' },
  { id: 168, name: 'Planet of the Apes' },
  { id: 2604, name: 'Scream' },
  { id: 2607, name: 'Friday the 13th' },
  { id: 8580, name: 'A Nightmare on Elm Street' },
  { id: 10451, name: 'Child\'s Play' },
  { id: 91361, name: 'Halloween' },
  { id: 402322, name: 'The Conjuring Universe' },
  { id: 259187, name: 'Annabelle' },
  { id: 230932, name: 'Kick-Ass' },
  { id: 391860, name: 'Kingsman' },
  { id: 430863, name: 'Now You See Me' },
  { id: 128, name: 'Ocean\'s' },
  { id: 86119, name: 'The Hangover' },
  { id: 151687, name: 'The Transporter' },
  { id: 5039, name: 'Rambo' },
  { id: 126125, name: 'The Expendables' },
  { id: 332402, name: 'Taken' },
  { id: 372983, name: 'The Mechanic' },
  { id: 111583, name: 'Crank' },
  { id: 222938, name: 'Anchorman' },
  { id: 250616, name: 'Zoolander' },
  { id: 252374, name: 'Step Brothers' },
  { id: 146130, name: 'Wedding Crashers' },
  { id: 139370, name: 'Old School' },
  { id: 306809, name: 'Ted' },
  { id: 352854, name: 'Neighbors' },
  { id: 392562, name: '21 Jump Street' },
  { id: 630322, name: 'The Equalizer' },
  { id: 172699, name: 'RED' },
  { id: 392583, name: 'Olympus Has Fallen' },
  { id: 848, name: 'The Naked Gun' },
  { id: 221147, name: 'Pitch Perfect' },
  { id: 386770, name: 'Ride Along' },
  { id: 306810, name: 'Get Hard' },
  { id: 306812, name: 'Horrible Bosses' },
  { id: 306813, name: 'Bridesmaids' },
  { id: 504359, name: 'Central Intelligence' },
  { id: 392861, name: 'We\'re the Millers' },
  { id: 392862, name: 'Identity Thief' },
  { id: 392863, name: 'The Heat' },
  { id: 392864, name: 'Spy' },
  { id: 392865, name: 'Girls Trip' },
  { id: 392866, name: 'Night School' },
  { id: 378386, name: 'Think Like a Man' },
  { id: 306811, name: 'About Last Night' },
  { id: 238155, name: 'The Best Man' },
  { id: 159440, name: 'Barbershop' },
  { id: 120658, name: 'Ride Along' },
  { id: 96601, name: 'Evil Dead' },
  { id: 65633, name: 'Saw' },
  { id: 231617, name: 'The Texas Chainsaw Massacre' },
  { id: 142638, name: 'The Hills Have Eyes' },
  { id: 158097, name: 'The Grudge' },
  { id: 102322, name: 'The Ring' },
  { id: 223247, name: 'Paranormal Activity' },
  { id: 855094, name: 'Joker' },
  { id: 2746, name: 'The Crow' },
  { id: 3167, name: 'RoboCop' },
  { id: 5282, name: 'Total Recall' },
  { id: 136835, name: 'Starship Troopers' },
  { id: 3945, name: 'Stargate' },
  { id: 173311, name: 'Independence Day' },
  { id: 230, name: 'Spaceballs' },
  { id: 15121, name: 'Super Troopers' },
  { id: 302322, name: 'Hot Shots!' },
  { id: 118990, name: 'Austin Powers' },
  { id: 5350, name: 'Wayne\'s World' },
  { id: 91766, name: 'Bill & Ted' },
  { id: 531242, name: 'The Lego Movie' },
  { id: 173710, name: 'Planet of the Apes (Reboot)' },
  { id: 535313, name: 'MonsterVerse' },
  { id: 422837, name: 'Blade Runner' },
  { id: 529892, name: 'DC Extended Universe' },
  { id: 531241, name: 'Spider-Man (MCU)' },
  { id: 531241, name: 'Spider-Man' },
];

/* Full Franchises for See All view (uses discover, not collections) */
const FULL_FRANCHISES = [
  { key: 'marvel', name: 'Marvel Cinematic Universe', gradient: 'linear-gradient(135deg, #8B0000 0%, #DC143C 50%, #FF4500 100%)' },
  { key: 'star wars', name: 'Star Wars Saga', gradient: 'linear-gradient(135deg, #0B1426 0%, #1a3a5c 50%, #4a90c2 100%)' },
  { key: 'dc', name: 'DC Universe', gradient: 'linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%)' },
  { key: 'harry potter', name: 'Wizarding World', gradient: 'linear-gradient(135deg, #1a0a00 0%, #4a2511 50%, #8B6914 100%)' },
  { key: 'lord of the rings', name: 'Middle-earth', gradient: 'linear-gradient(135deg, #0f2027 0%, #203a43 50%, #2c5364 100%)' },
  { key: 'fast and furious', name: 'Fast & Furious', gradient: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #e94560 100%)' },
  { key: 'james bond', name: 'James Bond', gradient: 'linear-gradient(135deg, #000000 0%, #1a1a1a 50%, #4a4a4a 100%)' },
  { key: 'jurassic park', name: 'Jurassic World', gradient: 'linear-gradient(135deg, #0a2f0a 0%, #1a5c1a 50%, #2e8b57 100%)' },
  { key: 'mission impossible', name: 'Mission: Impossible', gradient: 'linear-gradient(135deg, #1a0a1a 0%, #4a1a4a 50%, #8B008B 100%)' },
  { key: 'transformers', name: 'Transformers', gradient: 'linear-gradient(135deg, #1a1a00 0%, #4a4a1a 50%, #8B8B00 100%)' },
  { key: 'terminator', name: 'Terminator', gradient: 'linear-gradient(135deg, #1a0000 0%, #4a0a0a 50%, #8B0000 100%)' },
  { key: 'batman', name: 'Batman', gradient: 'linear-gradient(135deg, #050505 0%, #1a1a1a 50%, #333333 100%)' },
  { key: 'spider-man', name: 'Spider-Man', gradient: 'linear-gradient(135deg, #1a0000 0%, #4a0000 50%, #8B0000 100%)' },
  { key: 'x-men', name: 'X-Men', gradient: 'linear-gradient(135deg, #0a0a2e 0%, #1a1a5e 50%, #4a4a8B 100%)' },
  { key: 'avengers', name: 'The Avengers', gradient: 'linear-gradient(135deg, #2e0000 0%, #5c0000 50%, #8B0000 100%)' },
  { key: 'indiana jones', name: 'Indiana Jones', gradient: 'linear-gradient(135deg, #3d2b1f 0%, #6b4423 50%, #8B6914 100%)' },
  { key: 'matrix', name: 'The Matrix', gradient: 'linear-gradient(135deg, #000000 0%, #003300 50%, #00cc00 100%)' },
  { key: 'pirates of the caribbean', name: 'Pirates of the Caribbean', gradient: 'linear-gradient(135deg, #0a1a2e 0%, #1a3a5c 50%, #2e5c8B 100%)' },
  { key: 'john wick', name: 'John Wick', gradient: 'linear-gradient(135deg, #1a0a00 0%, #3d2b1f 50%, #5c4033 100%)' },
  { key: 'rocky', name: 'Rocky / Creed', gradient: 'linear-gradient(135deg, #2e0000 0%, #5c1a1a 50%, #8B4513 100%)' },
  { key: 'alien', name: 'Alien / Prometheus', gradient: 'linear-gradient(135deg, #0a0a0a 0%, #1a1a1a 50%, #2e2e2e 100%)' },
  { key: 'predator', name: 'Predator', gradient: 'linear-gradient(135deg, #0a1a0a 0%, #1a3a1a 50%, #2e5c2e 100%)' },
  { key: 'godzilla', name: 'Godzilla / King Kong', gradient: 'linear-gradient(135deg, #1a1a1a 0%, #0a2e0a 50%, #1a5c1a 100%)' },
  { key: 'planet of the apes', name: 'Planet of the Apes', gradient: 'linear-gradient(135deg, #2e2e1a 0%, #4a4a2e 50%, #6b6b4a 100%)' },
  { key: 'mad max', name: 'Mad Max', gradient: 'linear-gradient(135deg, #3d2b1f 0%, #5c4033 50%, #8B4513 100%)' },
  { key: 'die hard', name: 'Die Hard', gradient: 'linear-gradient(135deg, #2e0000 0%, #5c0000 50%, #8B0000 100%)' },
  { key: 'men in black', name: 'Men in Black', gradient: 'linear-gradient(135deg, #0a0a0a 0%, #1a1a2e 50%, #2e2e5c 100%)' },
  { key: 'ghostbusters', name: 'Ghostbusters', gradient: 'linear-gradient(135deg, #0a1a0a 0%, #1a3a1a 50%, #2e5c2e 100%)' },
  { key: 'back to the future', name: 'Back to the Future', gradient: 'linear-gradient(135deg, #2e2e1a 0%, #5c5c2e 50%, #8B8B00 100%)' },
  { key: 'hunger games', name: 'The Hunger Games', gradient: 'linear-gradient(135deg, #2e0000 0%, #5c1a0a 50%, #8B4513 100%)' },
  { key: 'twilight', name: 'The Twilight Saga', gradient: 'linear-gradient(135deg, #0a0a1a 0%, #1a1a3a 50%, #2e2e5c 100%)' },
  { key: 'dune', name: 'Dune', gradient: 'linear-gradient(135deg, #3d2b1f 0%, #5c4033 50%, #8B6914 100%)' },
  { key: 'blade runner', name: 'Blade Runner', gradient: 'linear-gradient(135deg, #0a1a2e 0%, #1a3a4a 50%, #2e5c6b 100%)' },
  { key: 'pixar', name: 'Pixar', gradient: 'linear-gradient(135deg, #0a2e5c 0%, #1a5c8B 50%, #4a90c2 100%)' },
  { key: 'disney', name: 'Disney Animation', gradient: 'linear-gradient(135deg, #2e2e5c 0%, #4a4a8B 50%, #6b6bb6 100%)' },
];

export async function loadPopularCollections() {
  const section = document.getElementById('popularCollectionsSection');
  const container = document.getElementById('popularCollectionsRow');
  if (!section || !container) return;

  section.classList.remove('hidden');
  container.innerHTML = '<div class="row-loading"><i class="fas fa-spinner"></i></div>';

  const seen = new Set();
  const collections = [];

  for (const col of POPULAR_COLLECTIONS) {
    if (seen.has(col.id)) continue;
    seen.add(col.id);
    try {
      const data = await fetchWithAuth(`${BASE_URL}/collection/${col.id}?language=en-US`);
      if (data.parts?.length > 0) {
        const backdrop = data.backdrop_path || data.parts[0]?.backdrop_path || '';
        collections.push({
          id: col.id,
          name: data.name || col.name,
          count: data.parts.length,
          backdrop,
        });
      }
    } catch (e) { /* skip invalid collection IDs */ }
  }

  if (collections.length === 0) {
    section.classList.add('hidden');
    return;
  }

  // Render as horizontal cards in a row (first 10 only)
  const toShow = collections.slice(0, 10);
  container.innerHTML = toShow.map(col => {
    const bg = col.backdrop ? `${IMG_BASE}w780${col.backdrop}` : '';
    return `
      <div class="collection-card" data-id="${col.id}" data-name="${col.name}">
        <div class="collection-card-bg" style="background-image:url('${bg}')"></div>
        <div class="collection-card-overlay"></div>
        <div class="collection-card-content">
          <div class="collection-card-name">${col.name}</div>
          <div class="collection-card-count">${col.count} movies</div>
        </div>
      </div>`;
  }).join('');

  container.querySelectorAll('.collection-card').forEach(card => {
    card.addEventListener('click', () => {
      showCollectionGallery(parseInt(card.dataset.id), card.dataset.name);
    });
  });

  // Wire up See All button
  const seeAllBtn = document.getElementById('seeAllCollectionsBtn');
  if (seeAllBtn) {
    seeAllBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      showCollectionsGallery();
    });
  }
}

/* Collections Gallery (See All) */
export async function showCollectionsGallery() {
  const view = document.getElementById('collectionsView');
  const movieGrid = document.getElementById('movieCollectionsGrid');
  const franchiseGrid = document.getElementById('franchisesGrid');
  const movieCount = document.getElementById('movieCollectionsCount');
  const franchiseCount = document.getElementById('franchisesCount');

  if (!view) return;

  // Save scroll position before leaving home
  _homeScrollY = window.scrollY;

  // Hide other views
  homeView?.classList.add('hidden');
  collectionView?.classList.add('hidden');
  historyView?.classList.add('hidden');
  searchView?.classList.add('hidden');
  view.classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });

  // Render franchises grid immediately
  if (franchiseGrid) {
    franchiseGrid.innerHTML = FULL_FRANCHISES.map(f => `
      <div class="franchise-tile" data-key="${f.key}" data-name="${f.name}">
        <div class="franchise-tile-bg" style="background:${f.gradient};"></div>
        <div class="franchise-tile-overlay"></div>
        <div class="franchise-tile-content">
          <div class="franchise-tile-name">${f.name}</div>
          <div class="franchise-tile-desc">Movies & TV Shows</div>
        </div>
      </div>
    `).join('');

    franchiseGrid.querySelectorAll('.franchise-tile').forEach(tile => {
      tile.addEventListener('click', () => {
        const franchise = getMatchedFranchise(tile.dataset.key);
        if (franchise) {
          showFranchiseGallery(franchise, tile.dataset.name);
        }
      });
    });
  }
  if (franchiseCount) franchiseCount.textContent = FULL_FRANCHISES.length;

  // Load all movie collections
  if (movieGrid) {
    movieGrid.innerHTML = '<div class="row-loading"><i class="fas fa-spinner"></i> Loading collections...</div>';
    const collections = [];
    for (const col of ALL_COLLECTIONS) {
      try {
        const data = await fetchWithAuth(`${BASE_URL}/collection/${col.id}?language=en-US`);
        if (data.parts?.length > 0) {
          const backdrop = data.backdrop_path || data.parts[0]?.backdrop_path || '';
          const poster = data.parts[0]?.poster_path || '';
          collections.push({
            id: col.id,
            name: data.name || col.name,
            count: data.parts.length,
            backdrop,
            poster,
          });
        }
      } catch (e) { /* skip invalid */ }
    }

    if (collections.length === 0) {
      movieGrid.innerHTML = '<div class="row-loading">No collections found</div>';
    } else {
      movieGrid.innerHTML = collections.map(col => {
        const bg = col.backdrop ? `${IMG_BASE}w780${col.backdrop}` : (col.poster ? `${IMG_BASE}w300${col.poster}` : '');
        return `
          <div class="collection-tile" data-id="${col.id}" data-name="${col.name}">
            <div class="collection-tile-bg" style="background-image:url('${bg}')"></div>
            <div class="collection-tile-overlay"></div>
            <div class="collection-tile-content">
              <div class="collection-tile-name">${col.name}</div>
              <div class="collection-tile-count">${col.count} movies</div>
            </div>
          </div>`;
      }).join('');

      movieGrid.querySelectorAll('.collection-tile').forEach(tile => {
        tile.addEventListener('click', () => {
          showCollectionGallery(parseInt(tile.dataset.id), tile.dataset.name);
        });
      });
    }
    if (movieCount) movieCount.textContent = collections.length;
  }
}

/* Show a full franchise gallery (all movies + TV) */
async function showFranchiseGallery(franchise, displayName) {
  _previousView = 'collections';
  searchResults?.classList.add('hidden');
  homeView?.classList.add('hidden');
  collectionView?.classList.add('hidden');
  historyView?.classList.add('hidden');
  document.getElementById('collectionsView')?.classList.add('hidden');
  searchView?.classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });

  if (!searchGrid) return;
  searchGrid.innerHTML = '<div class="search-loading"><i class="fas fa-spinner"></i> Loading franchise...</div>';
  if (searchQueryTitle) searchQueryTitle.textContent = displayName || 'Franchise Results';
  if (searchResultCount) searchResultCount.textContent = '';

  try {
    const results = await fetchFranchiseResults(franchise);
    results.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));

    const omdbRatings = await getOMDBRatingsBatch(results);
    results.forEach(item => { if (omdbRatings[item.id]) item.omdbRating = omdbRatings[item.id]; });

    setSearchGalleryResults(results);
    setSearchGalleryQuery('');
    renderSearchGallery(results, '', displayName);
  } catch (error) {
    searchGrid.innerHTML = '<div class="search-loading">Failed to load franchise results.</div>';
  }
}

function renderSearchGallery(results, query, customTitle = null) {
  if (!searchGrid) return;
  const filtered = applySearchFilters(results);
  if (searchQueryTitle) {
    if (customTitle) {
      searchQueryTitle.textContent = customTitle;
    } else {
      const franchise = query ? getMatchedFranchise(query) : null;
      if (franchise) {
        searchQueryTitle.textContent = `${franchise.name} Franchise Results`;
      } else {
        searchQueryTitle.textContent = query ? `Results for "${query}"` : 'Search Results';
      }
    }
  }
  if (searchResultCount) searchResultCount.textContent = `${filtered.length} result${filtered.length !== 1 ? 's' : ''}`;

  if (filtered.length === 0) {
    searchGrid.innerHTML = `
      <div class="empty-state">
        <i class="fas fa-search"></i>
        <h3>No results match your filters</h3>
        <p>Try adjusting the filters above</p>
      </div>`;
    return;
  }

  searchGrid.innerHTML = filtered.map(item => {
    const poster = item.poster_path ? `${IMG_BASE}w300${item.poster_path}` : '';
    const title = item.media_type === 'movie' ? item.title : item.name;
    const year = item.media_type === 'movie' ? item.release_date?.slice(0, 4) : item.first_air_date?.slice(0, 4);
    const rating = item.omdbRating ? item.omdbRating.toFixed(1) : (item.vote_average ? item.vote_average.toFixed(1) : 'N/A');
    const isInCollection = userCollection.some(c => c.id === item.id && c.media_type === item.media_type);

    return `
      <div class="grid-item" data-id="${item.id}" data-type="${item.media_type}">
        <div class="item-poster">
          <img src="${poster}" alt="${title}" loading="lazy" onerror="this.style.display='none'">
          <span class="type-badge">${item.media_type === 'movie' ? 'Movie' : 'TV'}</span>
          <div class="item-overlay">
            <div class="item-actions">
              <button class="item-action-btn watch-btn" data-id="${item.id}" data-type="${item.media_type}" title="Watch Now"><i class="fas fa-play"></i></button>
              <button class="item-action-btn collection-btn" data-id="${item.id}" data-type="${item.media_type}" title="Save to Collection" ${isInCollection ? 'disabled' : ''}><i class="fas ${isInCollection ? 'fa-check' : 'fa-plus'}"></i></button>
            </div>
          </div>
        </div>
        <div class="item-info">
          <div class="item-title">${title}</div>
          <div class="item-meta">
            <span class="item-rating"><i class="fas fa-star"></i> ${rating}</span>
            <span style="color:var(--text-muted);font-size:0.625rem;">${year || ''}</span>
          </div>
        </div>
      </div>`;
  }).join('');

  searchGrid.querySelectorAll('.grid-item').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.item-actions')) return;
      openItemModal(parseInt(card.dataset.id), card.dataset.type);
    });
  });

  searchGrid.querySelectorAll('.watch-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openPlayer(parseInt(btn.dataset.id), btn.dataset.type);
    });
  });

  searchGrid.querySelectorAll('.collection-btn').forEach(btn => {
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
    loadPopularCollections();

    // Attach See All listeners to genre headers
    document.querySelectorAll('.category-header[data-genre]').forEach(header => {
      const btn = header.querySelector('.see-all-btn');
      if (btn) {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const genreId = header.dataset.genre;
          const genreName = header.dataset.genreName;
          if (genreId && genreName) {
            showGenreGallery(genreId, genreName);
          }
        });
      }
    });
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

    // Trailer button
    const trailerBtn = document.getElementById('modalTrailerBtn');
    if (trailerBtn) {
      trailerBtn.style.display = 'none';
      getTrailer(id, type).then(url => {
        if (url && trailerBtn) {
          trailerBtn.style.display = 'inline-flex';
          trailerBtn.onclick = () => {
            window.open(url, '_blank');
          };
        }
      }).catch(() => {
        if (trailerBtn) trailerBtn.style.display = 'none';
      });
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
export async function addToUserCollection(item, folder = null) {
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
    await saveUserCollection(userCollection);
    await storageAddCollection(item);
    console.log('[addToUserCollection] Saved to Supabase');

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
  await saveUserCollection(newCollection);
  setUserCollection(newCollection);
  await storageRemoveCollection(id);
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

    // Progress bar for items with watch progress (same as Continue Watching)
    let progressBar = '';
    if (prog && prog.episodeRuntime) {
      const elapsed = prog.elapsedMinutes || 0;
      const runtime = prog.episodeRuntime;
      const pct = Math.min(Math.round((elapsed / runtime) * 100), 100);
      progressBar = `
        <div class="card-progress-bar-wrap">
          <div class="card-progress-bar" style="width:${pct}%"></div>
        </div>`;
    }

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
        ${progressBar}
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

async function saveNewFolder(name) {
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
  await saveUserFolders(nextFolders);
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

  await saveUserHistory(nextHistory);
  setUserHistory(getUserHistory());
  await storageAddHistory(historyItem);
  if (currentTab === 'history') renderUserHistory();
}

async function removeFromUserHistory(id, type) {
  const item = userHistory.find(h => h.id === id && h.media_type === type);
  if (!item) return;
  const confirmed = await showConfirm('Remove from History?', `Remove "${item.title}" from your history?`);
  if (!confirmed) return;
  const nextHistory = userHistory.filter(h => !(h.id === id && h.media_type === type));
  await saveUserHistory(nextHistory);
  setUserHistory(nextHistory);
  await storageRemoveHistory(id, type);

  // Also remove from Continue Watching / progress
  if (type === 'tv') {
    const progress = getWatchProgress();
    if (progress[String(id)]) {
      delete progress[String(id)];
      await saveWatchProgress(progress);
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
