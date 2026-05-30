/** In-App Ad/Tab Blocker — port of AdTab Killer logic for web context */
import { showToast } from './utils.js';

const STORAGE_KEY = 'openccloud_blocker_settings';

let settings = {
  enabled: true,
  blockAllTabs: true,
  blockAllWindows: true,
  allowSelfPages: false,
  allowExtensionPages: false,
  counter: 0,
  logs: []
};

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) settings = { ...settings, ...JSON.parse(raw) };
  } catch (e) {}
}

function saveSettings() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function getBlockerSettings() { return { ...settings }; }
export function setBlockerSetting(key, value) { settings[key] = value; saveSettings(); }
export function incrementCounter() { settings.counter++; saveSettings(); updateCounterUI(); }
export function addBlockLog(entry) {
  if (!settings.enabled) return;
  settings.logs.unshift(entry);
  if (settings.logs.length > 500) settings.logs = settings.logs.slice(0, 500);
  saveSettings();
}
export function clearBlockLogs() { settings.logs = []; saveSettings(); }

function getHostname(url) { try { return new URL(url).hostname; } catch (e) { return ''; } }
function isSameOrigin(a, b) { try { return new URL(a).origin === new URL(b).origin; } catch (e) { return false; } }

function shouldBlock(url, sourceUrl) {
  if (!settings.enabled) return false;
  const hostname = getHostname(url);
  if (!hostname || url.startsWith('about:') || url.startsWith('chrome://')) return false;
  if (settings.allowSelfPages && sourceUrl && isSameOrigin(url, sourceUrl)) return false;
  if (settings.blockAllTabs || settings.blockAllWindows) return true;
  return false;
}

/* ─── 1. window.open ─── */
let _origOpen = null;
function initWindowOpenBlocker() {
  if (_origOpen) return;
  _origOpen = window.open;
  window.open = function(url, target, features) {
    if (!settings.enabled) return _origOpen.apply(window, arguments);
    if (target === '_blank' || target === '_new' || target === 'popup' || !target) {
      if (shouldBlock(url, window.location.href)) {
        incrementCounter();
        addBlockLog({ url, sourceUrl: window.location.href, reason: 'window.open blocked', time: new Date().toISOString() });
        console.log('[Blocker] Blocked window.open:', url);
        return null;
      }
    }
    return _origOpen.apply(window, arguments);
  };
}

/* ─── 2. ALL click interception (capture phase) ─── */
function initClickInterceptor() {
  document.addEventListener('click', (e) => {
    if (!settings.enabled) return;
    const a = e.target.closest('a');
    if (!a) return;
    const href = a.getAttribute('href') || '';
    const target = a.getAttribute('target') || '';
    const sourceUrl = window.location.href;

    if ((target === '_blank' || target === '_new') && shouldBlock(href, sourceUrl)) {
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      incrementCounter();
      addBlockLog({ url: href, sourceUrl, reason: 'link click blocked', time: new Date().toISOString() });
      console.log('[Blocker] Blocked link:', href);
      return false;
    }

    if (href.startsWith('javascript:')) {
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      incrementCounter();
      addBlockLog({ url: href, sourceUrl, reason: 'javascript: blocked', time: new Date().toISOString() });
      return false;
    }
  }, true);
}

/* ─── 3. Programmatic .click() on links ─── */
function initProgrammaticClickBlocker() {
  const orig = HTMLElement.prototype.click;
  HTMLElement.prototype.click = function() {
    if (this.tagName === 'A') {
      const href = this.getAttribute('href') || '';
      const target = this.getAttribute('target') || '';
      if ((target === '_blank' || target === '_new') && settings.enabled && shouldBlock(href, window.location.href)) {
        incrementCounter();
        addBlockLog({ url: href, sourceUrl: window.location.href, reason: 'programmatic click blocked', time: new Date().toISOString() });
        console.log('[Blocker] Blocked programmatic click:', href);
        return;
      }
    }
    return orig.apply(this, arguments);
  };
}

/* ─── 4. beforeunload traps ─── */
function initBeforeunloadBlocker() {
  window.addEventListener('beforeunload', (e) => {
    if (settings.enabled) { e.preventDefault(); e.returnValue = ''; }
  });
}

/* ─── 5. Dynamic popup link remover ─── */
function initDynamicLinkRemover() {
  const observer = new MutationObserver((mutations) => {
    if (!settings.enabled) return;
    mutations.forEach((m) => {
      m.addedNodes.forEach((node) => {
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        const links = node.matches?.('a') ? [node] : node.querySelectorAll?.('a') || [];
        links.forEach((a) => {
          const target = a.getAttribute('target') || '';
          const href = (a.getAttribute('href') || '').toLowerCase();
          if (target === '_blank' || target === '_new' || href.startsWith('javascript:') || href.includes('popup')) {
            a.removeAttribute('href');
            a.removeAttribute('target');
            a.style.pointerEvents = 'none';
            console.log('[Blocker] Removed dynamic popup link');
          }
        });
      });
    });
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

/* ─── 6. Inject blocker script into every new iframe ─── */
function initIframeInterceptor() {
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((m) => {
      m.addedNodes.forEach((node) => {
        if (node.tagName === 'IFRAME') {
          try {
            const src = node.src || '';
            if (!src) return;
            if (new URL(src).origin === window.location.origin && node.contentWindow) {
              const win = node.contentWindow;
              const orig = win.open;
              win.open = function(url, target, features) {
                if (shouldBlock(url, src)) {
                  incrementCounter();
                  addBlockLog({ url, sourceUrl: src, reason: 'iframe window.open blocked', time: new Date().toISOString() });
                  console.log('[Blocker] Blocked iframe popup:', url);
                  return null;
                }
                return orig.apply(win, arguments);
              };
            }
          } catch (e) {}
        }
      });
    });
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

/* ─── UI ─── */
let counterEl = null;
function updateCounterUI() { if (counterEl) counterEl.textContent = settings.counter; }

export function initBlockerUI() {
  counterEl = document.getElementById('blockerCounter');
  updateCounterUI();

  const ids = {
    toggle: 'blockerToggle',
    blockTabs: 'blockerBlockTabs',
    blockWindows: 'blockerBlockWindows',
    allowSelf: 'blockerAllowSelf',
    allowExt: 'blockerAllowExt',
    resetBtn: 'blockerResetCounter',
    clearLogsBtn: 'blockerClearLogs'
  };

  const toggle = document.getElementById(ids.toggle);
  if (toggle) {
    toggle.checked = settings.enabled;
    toggle.addEventListener('change', () => {
      setBlockerSetting('enabled', toggle.checked);
      showToast(toggle.checked ? 'Blocker enabled' : 'Blocker disabled', toggle.checked ? 'success' : 'info');
    });
  }

  const blockTabs = document.getElementById(ids.blockTabs);
  if (blockTabs) {
    blockTabs.checked = settings.blockAllTabs;
    blockTabs.addEventListener('change', () => {
      setBlockerSetting('blockAllTabs', blockTabs.checked);
      showToast(blockTabs.checked ? 'Block all tabs enabled' : 'Block all tabs disabled', 'info');
    });
  }

  const blockWindows = document.getElementById(ids.blockWindows);
  if (blockWindows) {
    blockWindows.checked = settings.blockAllWindows;
    blockWindows.addEventListener('change', () => {
      setBlockerSetting('blockAllWindows', blockWindows.checked);
      showToast(blockWindows.checked ? 'Block all windows enabled' : 'Block all windows disabled', 'info');
    });
  }

  const allowSelf = document.getElementById(ids.allowSelf);
  if (allowSelf) {
    allowSelf.checked = settings.allowSelfPages;
    allowSelf.addEventListener('change', () => {
      setBlockerSetting('allowSelfPages', allowSelf.checked);
      showToast(allowSelf.checked ? 'Same-site tabs allowed' : 'Same-site tabs blocked', 'info');
    });
  }

  const allowExt = document.getElementById(ids.allowExt);
  if (allowExt) {
    allowExt.checked = settings.allowExtensionPages;
    allowExt.addEventListener('change', () => {
      setBlockerSetting('allowExtensionPages', allowExt.checked);
      showToast(allowExt.checked ? 'Extension pages allowed' : 'Extension pages blocked', 'info');
    });
  }

  const resetBtn = document.getElementById(ids.resetBtn);
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      settings.counter = 0;
      saveSettings();
      updateCounterUI();
      showToast('Counter reset', 'info');
    });
  }

  const clearLogsBtn = document.getElementById(ids.clearLogsBtn);
  if (clearLogsBtn) {
    clearLogsBtn.addEventListener('click', () => {
      clearBlockLogs();
      renderBlockLogs();
      showToast('Logs cleared', 'info');
    });
  }

  renderBlockLogs();
}

function renderBlockLogs() {
  const logList = document.getElementById('blockerLogList');
  if (!logList) return;
  if (settings.logs.length === 0) {
    logList.innerHTML = '<div class="blocker-empty-logs">No blocked popups yet</div>';
    return;
  }
  logList.innerHTML = settings.logs.map(log => {
    const time = new Date(log.time).toLocaleTimeString();
    const url = log.url || 'unknown';
    return `<div class="blocker-log-item">
      <span class="blocker-log-time">${time}</span>
      <span class="blocker-log-url" title="${url}">${url}</span>
      <span class="blocker-log-reason">${log.reason}</span>
    </div>`;
  }).join('');
}

/* ─── Init ─── */
export function initBlocker() {
  loadSettings();
  initWindowOpenBlocker();
  initClickInterceptor();
  initProgrammaticClickBlocker();
  initBeforeunloadBlocker();
  initDynamicLinkRemover();
  initIframeInterceptor();
}
