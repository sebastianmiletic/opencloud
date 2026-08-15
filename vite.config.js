import { defineConfig, loadEnv } from 'vite';
import packageJson from './package.json' with { type: 'json' };

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const publicConfig = {
    TMDB_BEARER_TOKEN: env.TMDB_BEARER_TOKEN || '',
    OMDB_API_KEY: env.OMDB_API_KEY || '',
    SUPABASE_URL: env.SUPABASE_URL || '',
    SUPABASE_ANON_KEY: env.SUPABASE_ANON_KEY || '',
    APP_VERSION: packageJson.version,
    APP_PLATFORM: 'web',
    APP_ARCHITECTURE: 'browser'
  };

  return {
    clearScreen: false,
    plugins: [{
      name: 'opencloud-local-env',
      configureServer(server) {
        server.middlewares.use('/env.js', (_request, response) => {
          response.setHeader('Content-Type', 'application/javascript; charset=utf-8');
          response.setHeader('Cache-Control', 'no-store');
          response.end(`window.ENV = ${JSON.stringify(publicConfig)};`);
        });
      }
    }],
    server: {
      host: '127.0.0.1',
      port: 1420,
      strictPort: true
    },
    build: {
      outDir: 'web-dist',
      emptyOutDir: true,
      sourcemap: true,
      target: ['es2020', 'safari13']
    }
  };
});
