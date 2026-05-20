/** Shared Mutable State */
export let accounts = [];
export let collection = [];
export let userCollection = [];
export let userHistory = [];
export let watchProgress = {};
export let userFolders = [];
export let currentTab = 'home';
export let searchTimeout = null;
export let currentModalItem = null;
export let heroSlides = [];
export let currentHeroIndex = 0;
export let heroSlideInterval = null;
export let playerState = {
  id: null,
  type: null,
  season: 1,
  episode: 1,
  tmdbData: null,
  epData: null,
  view: 'seasons'
};

export function setAccounts(v) { accounts = v; }
export function setCollection(v) { collection = v; }
export function setUserCollection(v) { userCollection = v; }
export function setUserHistory(v) { userHistory = v; }
export function setWatchProgress(v) { watchProgress = v; }
export function setUserFolders(v) { userFolders = v; }
export function setCurrentTab(v) { currentTab = v; }
export function setSearchTimeout(v) { searchTimeout = v; }
export function setCurrentModalItem(v) { currentModalItem = v; }
export function setHeroSlides(v) { heroSlides = v; }
export function setCurrentHeroIndex(v) { currentHeroIndex = v; }
export function setHeroSlideInterval(v) { heroSlideInterval = v; }
export function setPlayerState(v) { playerState = v; }
