/**
 * Watch Sessions & Stats — Supabase-backed
 */
import { fetchWatchSessions as fetchSessionsFromSync, recordWatchSession as syncRecordSession } from './sync.js';
import { getCurrentAuthUser } from './auth.js';

function safeParse(value, fallback) {
  if (!value) return fallback;
  try { return JSON.parse(value); } catch (e) { return fallback; }
}

/* ─── Watch Sessions / Stats ─── */

export async function recordWatchSession(session) {
  const user = getCurrentAuthUser();
  if (!user?.id) return;
  await syncRecordSession(user.id, session);
}

export async function getWatchSessions(days = 365) {
  const user = getCurrentAuthUser();
  if (!user?.id) return [];
  return await fetchSessionsFromSync(user.id, days);
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
    if (s.media_type === 'movie') stats.movies += 1;
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
