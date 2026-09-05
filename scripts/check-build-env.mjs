const required = ['TMDB_BEARER_TOKEN', 'OMDB_API_KEY', 'SUPABASE_URL', 'SUPABASE_ANON_KEY'];
const missing = required.filter(name => !String(process.env[name] || '').trim());

if (missing.length) {
  console.error(`Missing required build configuration: ${missing.join(', ')}`);
  process.exit(1);
}
console.log('Required build configuration is present (values suppressed)');
