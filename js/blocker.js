/** In-App Ad/Tab Blocker — web-compatible port of AdTab Killer logic */
import { showToast } from './utils.js';

/* Settings */
const STORAGE_KEY = 'openccloud_blocker_settings';

let settings = {
  enabled: true,
  blockAllTabs: false,
  blockAllWindows: false,
  allowSelfPages: true,
  allowExtensionPages: true,
  counter: 0,
  logs: []
};

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      settings = { ...settings, ...parsed };
    }
  } catch (e) {}
}

function saveSettings() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function getBlockerSettings() {
  return { ...settings };
}

export function setBlockerSetting(key, value) {
  settings[key] = value;
  saveSettings();
}

export function incrementCounter() {
  settings.counter++;
  saveSettings();
  updateCounterUI();
}

export function addBlockLog(entry) {
  settings.logs.unshift(entry);
  if (settings.logs.length > 500) settings.logs = settings.logs.slice(0, 500);
  saveSettings();
}

export function clearBlockLogs() {
  settings.logs = [];
  saveSettings();
}

/* Helpers */
function getHostname(url) {
  try {
    return new URL(url).hostname;
  } catch (e) {
    return '';
  }
}

function isSameOrigin(a, b) {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch (e) {
    return false;
  }
}

function shouldBlock(url, sourceUrl) {
  if (!settings.enabled) return false;

  const hostname = getHostname(url);
  const isInternal = !hostname || url.startsWith('about:') || url.startsWith('chrome://') || url.startsWith('javascript:');

  // Allow internal browser pages
  if (isInternal) return false;

  // Block all new tabs
  if (settings.blockAllTabs) {
    // Check self-page rule
    if (settings.allowSelfPages && sourceUrl) {
      if (isSameOrigin(url, sourceUrl)) return false;
    }
    return true;
  }

  // Block all new windows (treated the same in web context)
  if (settings.blockAllWindows) {
    if (settings.allowSelfPages && sourceUrl) {
      if (isSameOrigin(url, sourceUrl)) return false;
    }
    return true;
  }

  return false;
}

/* Override window.open */
let originalOpen = null;

function initWindowOpenBlocker() {
  if (originalOpen) return;
  originalOpen = window.open;

  window.open = function(url, target, features) {
    const sourceUrl = window.location.href;

    if (shouldBlock(url, sourceUrl)) {
      incrementCounter();
      addBlockLog({ url, sourceUrl, reason: 'window.open blocked', time: new Date().toISOString() });
      showToast('Blocked popup', 'info');
      console.log('[Blocker] Blocked window.open:', url);
      return null;
    }

    return originalOpen.apply(window, arguments);
  };
}

/* Intercept link clicks */
function initClickInterceptor() {
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a');
    if (!a) return;

    const href = a.getAttribute('href') || '';
    const target = a.getAttribute('target') || '';
    const sourceUrl = window.location.href;

    // Block target="_blank" and _new when blocker rules apply
    if (target === '_blank' || target === '_new') {
      if (shouldBlock(href, sourceUrl)) {
        e.preventDefault();
        e.stopPropagation();
        incrementCounter();
        addBlockLog({ url: href, sourceUrl, reason: 'link click blocked', time: new Date().toISOString() });
        showToast('Blocked new tab', 'info');
        console.log('[Blocker] Blocked link:', href);
        return;
      }
    }

    // Block javascript: scheme links
    if (href.startsWith('javascript:')) {
      if (settings.enabled) {
        e.preventDefault();
        e.stopPropagation();
        incrementCounter();
        addBlockLog({ url: href, sourceUrl, reason: 'javascript: link blocked', time: new Date().toISOString() });
        console.log('[Blocker] Blocked javascript: link');
      }
    }
  }, true);
}

/* Block beforeunload popup traps */
function initBeforeunloadBlocker() {
  window.addEventListener('beforeunload', (e) => {
    if (settings.enabled && settings.blockAllTabs) {
      // Prevent sites from showing "Are you sure you want to leave?" popups
      e.preventDefault();
      e.returnValue = '';
    }
  });
}

/* Intercept iframe load to inject popup blocker into same-origin iframes */
function initIframeInterceptor() {
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (node.tagName === 'IFRAME') {
          try {
            const iframeSrc = node.src || '';
            const parentOrigin = window.location.origin;
            if (!iframeSrc) return;

            // Same-origin iframes only
            if (new URL(iframeSrc).origin === parentOrigin && node.contentWindow) {
              const iframeWin = node.contentWindow;
              const orig = iframeWin.open;
              iframeWin.open = function(url, target, features) {
                if (shouldBlock(url, iframeSrc)) {
                  incrementCounter();
                  addBlockLog({ url, sourceUrl: iframeSrc, reason: 'iframe window.open blocked', time: new Date().toISOString() });
                  console.log('[Blocker] Blocked iframe popup:', url);
                  return null;
                }
                return orig.apply(iframeWin, arguments);
              };
            }
          } catch (e) {
            // Cross-origin iframe — can't access contentWindow
          }
        }
      });
    });
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

/* UI updater for counter */
let counterEl = null;

function updateCounterUI() {
  if (counterEl) counterEl.textContent = settings.counter;
}

export function initBlockerUI() {
  counterEl = document.getElementById('blockerCounter');
  updateCounterUI();

  const toggle = document.getElementById('blockerToggle');
  const blockTabs = document.getElementById('blockerBlockTabs');
  const blockWindows = document.getElementById('blockerBlockWindows');
  const allowSelf = document.getElementById('blockerAllowSelf');
  const allowExt = document.getElementById('blockerAllowExt');
  const resetBtn = document.getElementById('blockerResetCounter');
  const clearLogsBtn = document.getElementById('blockerClearLogs');
  const logList = document.getElementById('blockerLogList');

  if (toggle) {
    toggle.checked = settings.enabled;
    toggle.addEventListener('change', () => {
      setBlockerSetting('enabled', toggle.checked);
      showToast(toggle.checked ? 'Blocker enabled' : 'Blocker disabled', toggle.checked ? 'success' : 'info');
    });
  }

  if (blockTabs) {
    blockTabs.checked = settings.blockAllTabs;
    blockTabs.addEventListener('change', () => {
      setBlockerSetting('blockAllTabs', blockTabs.checked);
      showToast(blockTabs.checked ? 'Block all tabs enabled' : 'Block all tabs disabled', 'info');
    });
  }

  if (blockWindows) {
    blockWindows.checked = settings.blockAllWindows;
    blockWindows.addEventListener('change', () => {
      setBlockerSetting('blockAllWindows', blockWindows.checked);
      showToast(blockWindows.checked ? 'Block all windows enabled' : 'Block all windows disabled', 'info');
    });
  }

  if (allowSelf) {
    allowSelf.checked = settings.allowSelfPages;
    allowSelf.addEventListener('change', () => {
      setBlockerSetting('allowSelfPages', allowSelf.checked);
      showToast(allowSelf.checked ? 'Same-site tabs allowed' : 'Same-site tabs blocked', 'info');
    });
  }

  if (allowExt) {
    allowExt.checked = settings.allowExtensionPages;
    allowExt.addEventListener('change', () => {
      setBlockerSetting('allowExtensionPages', allowExt.checked);
      showToast(allowExt.checked ? 'Extension pages allowed' : 'Extension pages blocked', 'info');
    });
  }

  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      settings.counter = 0;
      saveSettings();
      updateCounterUI();
      showToast('Counter reset', 'info');
    });
  }

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

/* Init */
export function initBlocker() {
  loadSettings();
  initWindowOpenBlocker();
  initClickInterceptor();
  initBeforeunloadBlocker();
  initIframeInterceptor();
}
