/**
 * Watch Sessions & Stats (local-only)
 *
 * All watch session data is stored in localStorage.
 * There is no server. This is 100% offline-local.
 */

const SESSIONS_KEY = 'openccloud_watch_sessions';

function safeParse(value, fallback) {
  if (!value) return fallback;
  try { return JSON.parse(value); } catch (e) { return fallback; }
}

function getLocalSessions() {
  return safeParse(localStorage.getItem(SESSIONS_KEY), []);
}

function saveLocalSessions(sessions) {
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
}

/* ─── Sync (no-op since everything is local) ─── */

export function scheduleSync() {
  // Local-only: nothing to sync
}

/* ─── Watch Sessions / Stats ─── */

export async function recordWatchSession(session) {
  const sessions = getLocalSessions();
  sessions.push(session);
  // Keep last 500 to prevent unbounded growth
  if (sessions.length > 500) sessions.splice(0, sessions.length - 500);
  saveLocalSessions(sessions);
}

export async function getWatchSessions(days = 365) {
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sessions = getLocalSessions();
  return sessions.filter(s => new Date(s.started_at) >= since);
}

export function aggregateStats(sessions) {
  const stats = {
    totalSeconds: 0,
    movies: 0,
    episodes: 0,
    daily: {}, // key: 'YYYY-MM-DD' -> seconds
    dayOfWeek: [0, 0, 0, 0, 0, 0, 0], // Sun-Sat -> seconds
    streak: 0
  };
  if (!sessions?.length) return stats;
  const uniqueDays = new Set();
  sessions.forEach(s => {
    const dur = s.duration_seconds || 0;
    stats.totalSeconds += dur;
    if (s.type === 'movie') stats.movies += 1;
    else stats.episodes += 1;
    const date = new Date(s.started_at);
    const dateKey = date.toISOString().slice(0, 10);
    stats.daily[dateKey] = (stats.daily[dateKey] || 0) + dur;
    stats.dayOfWeek[date.getDay()] += dur;
    uniqueDays.add(dateKey);
  });
  // Calculate streak
  let streak = 0;
  let check = new Date();
  while (true) {
    const key = check.toISOString().slice(0, 10);
    if (uniqueDays.has(key)) {
      streak++;
      check.setDate(check.getDate() - 1);
    } else {
      break;
    }
  }
  stats.streak = streak;
  return stats;
}
