import { isTauri, invokeDesktop } from './desktop.js';
import { camelData, sportsUpstream } from './sports-data.js';

export async function fetchSports(resource, parameters = {}, signal) {
  const upstream = sportsUpstream(resource, parameters);
  if (!upstream) throw new Error('Invalid sports request.');
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  let data;
  if (isTauri()) {
    data = await invokeDesktop('fetch_sports', {
      resource, date: parameters.date || null,
      matchId: parameters.matchId || null, streamName: parameters.streamName || null
    });
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  } else {
    // Render proxies only these three fixed, public API routes. Vite and the
    // legacy shell can use Camel's CORS-enabled API directly.
    const url = window.ENV?.APP_PLATFORM === 'web' && window.ENV?.TMDB_API_BASE
      ? `/api/sports?${new URLSearchParams({ resource, ...parameters })}` : upstream;
    const response = await fetch(url, {
      signal, cache: 'no-store', credentials: 'omit', headers: { Accept: 'application/json' }
    });
    if (!response.ok) throw new Error('Camel could not be reached. Try refreshing.');
    data = await response.json();
  }
  return camelData(data);
}
