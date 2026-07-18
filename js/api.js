/** API Fetch Functions */
import { API_KEY, BASE_URL, OMDB_KEY, OMDB_URL } from './config.js';
import { getOMDBCache, setOMDBCache } from './storage.js';

const responseCache = new Map();
const pendingRequests = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000;

export async function fetchWithAuth(url, options = {}) {
  const cacheKey = String(url);
  const now = Date.now();
  const cached = responseCache.get(cacheKey);
  if (!options.fresh && cached && now - cached.timestamp < CACHE_TTL_MS) return cached.value;
  if (!options.fresh && pendingRequests.has(cacheKey)) return pendingRequests.get(cacheKey);

  const request = fetch(url, {
    signal: options.signal,
    headers: { 'Authorization': `Bearer ${API_KEY}`, 'Accept': 'application/json' }
  }).then(async res => {
    if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
    const value = await res.json();
    responseCache.set(cacheKey, { timestamp: Date.now(), value });
    return value;
  }).finally(() => pendingRequests.delete(cacheKey));

  pendingRequests.set(cacheKey, request);
  return request;
}

export async function getOMDBRating(title, year) {
  const cacheKey = `${title}_${year}`;
  const cache = getOMDBCache();
  const cached = cache[cacheKey];
  if (cached && Date.now() - cached.timestamp < 7 * 24 * 60 * 60 * 1000) return cached.value;
  try {
    const res = await fetch(`${OMDB_URL}?apikey=${OMDB_KEY}&t=${encodeURIComponent(title)}&y=${year}`);
    const data = await res.json();
    if (data.Response === 'True' && data.imdbRating && data.imdbRating !== 'N/A') {
      const rating = parseFloat(data.imdbRating);
      setOMDBCache(cacheKey, rating);
      return rating;
    }
  } catch (e) {}
  return null;
}

export async function getOMDBRatingsBatch(items) {
  const results = {};
  await Promise.all(items.map(async (item) => {
    const title = item.title || item.name;
    const year = (item.release_date || item.first_air_date || item.year || '').slice(0, 4);
    const rating = await getOMDBRating(title, year);
    if (rating !== null) results[item.id] = rating;
  }));
  return results;
}
