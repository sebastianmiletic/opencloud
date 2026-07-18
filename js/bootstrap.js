import { exportElectronStorage, getPublicConfig, importLegacyElectronStorage, isTauri } from './desktop.js';

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}

function loadStyle(href) {
  return new Promise((resolve, reject) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.onload = resolve;
    link.onerror = () => reject(new Error(`Failed to load ${href}`));
    document.head.appendChild(link);
  });
}

async function prepareRuntime() {
  if (isTauri()) {
    const [{ createClient }] = await Promise.all([
      import('@supabase/supabase-js'),
      import('@fontsource/inter/300.css'),
      import('@fontsource/inter/400.css'),
      import('@fontsource/inter/500.css'),
      import('@fontsource/inter/600.css'),
      import('@fontsource/inter/700.css'),
      import('@fontsource/inter/800.css'),
      import('@fortawesome/fontawesome-free/css/all.min.css')
    ]);
    window.supabase = { createClient };
    window.ENV = await getPublicConfig();
    await importLegacyElectronStorage();
    return;
  }
  await Promise.all([
    loadStyle('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap'),
    loadStyle('https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css'),
    loadScript('/env.js?v=22'),
    loadScript('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js')
  ]);
}

async function bootstrap() {
  try {
    await prepareRuntime();
    await import('./main.js');
    if (!isTauri()) setTimeout(() => exportElectronStorage().catch(console.error), 1500);
  } catch (error) {
    console.error('[Bootstrap] Open Cloud failed to start', error);
    window._appLoaded = true;
    const moduleError = document.getElementById('moduleError');
    const message = document.getElementById('moduleErrorMsg');
    if (message) {
      message.innerHTML = `<p style="margin-bottom:1rem;color:#fff;font-weight:600;">App failed to load</p><p>${String(error?.message || error)}</p>`;
    }
    if (moduleError) moduleError.style.display = 'flex';
  }
}

bootstrap();
