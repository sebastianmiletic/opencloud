/** In-App Ad/Tab Blocker — aggressive web-compatible popup killer */
import { showToast } from './utils.js';

/* Settings */
const STORAGE_KEY = 'openccloud_blocker_settings';

let settings = {
  enabled: true,
  blockAllTabs: true,    // default ON — block all new tabs
  blockAllWindows: true, // default ON — block all new windows
  allowSelfPages: false, // default OFF — don't even allow same-origin popups
  allowExtensionPages: false,
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
  if (!settings.enabled) return;
  settings.logs.unshift(entry);
  if (settings.logs.length > 500) settings.logs = settings.logs.slice(0, 500);
  saveSettings();
}

export function clearBlockLogs() {
  settings.logs = [];
  saveSettings();
}

/* ─── Helpers ─── */

function getHostname(url) {
  try { return new URL(url).hostname; } catch (e) { return ''; }
}

function isSameOrigin(a, b) {
  try { return new URL(a).origin === new URL(b).origin; } catch (e) { return false; }
}

function shouldBlock(url, sourceUrl) {
  if (!settings.enabled) return false;

  const hostname = getHostname(url);
  const isInternal = !hostname || url.startsWith('about:') || url.startsWith('chrome://') || url.startsWith('javascript:');

  // Allow internal browser pages
  if (isInternal) return false;

  // Allow same-origin if explicitly permitted
  if (settings.allowSelfPages && sourceUrl) {
    if (isSameOrigin(url, sourceUrl)) return false;
  }

  // Block all new tabs / windows by default (aggressive mode)
  if (settings.blockAllTabs || settings.blockAllWindows) return true;

  // Even with both toggles off, block known ad/popup patterns
  const lower = url.toLowerCase();
  if (lower.includes('popup') || lower.includes('ad.') || lower.includes('track')) return true;

  return false;
}

/* ─── 1. Override window.open (non-configurable so embeds can't restore it) ─── */
let _origWindowOpen = null;

function initWindowOpenBlocker() {
  if (_origWindowOpen) return;
  _origWindowOpen = window.open;

  const blocker = function(url, target, features) {
    const sourceUrl = window.location.href;

    // Block any target that opens a new context
    if (target === '_blank' || target === '_new' || target === 'popup' || !target) {
      if (shouldBlock(url, sourceUrl)) {
        incrementCounter();
        addBlockLog({ url, sourceUrl, reason: 'window.open blocked', time: new Date().toISOString() });
        showToast('Blocked popup', 'info');
        console.log('[Blocker] Blocked window.open:', url);
        return null;
      }
    }

    return _origWindowOpen.apply(window, arguments);
  };

  // Use defineProperty so external scripts cannot overwrite window.open
  try {
    Object.defineProperty(window, 'open', {
      value: blocker,
      writable: false,
      configurable: false
    });
  } catch (e) {
    // Fallback if defineProperty fails
    window.open = blocker;
  }
}

/* ─── 2. Intercept ALL link clicks (capture phase) ─── */
function initClickInterceptor() {
  document.addEventListener('click', (e) => {
    if (!settings.enabled) return;

    const a = e.target.closest('a');
    if (!a) return;

    const href = a.getAttribute('href') || '';
    const target = a.getAttribute('target') || '';
    const sourceUrl = window.location.href;

    // Block target="_blank" / _new unconditionally when aggressive
    if (target === '_blank' || target === '_new') {
      if (shouldBlock(href, sourceUrl)) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        incrementCounter();
        addBlockLog({ url: href, sourceUrl, reason: 'link click blocked', time: new Date().toISOString() });
        showToast('Blocked new tab', 'info');
        console.log('[Blocker] Blocked link:', href);
        return false;
      }
    }

    // Block javascript: scheme links
    if (href.startsWith('javascript:')) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      incrementCounter();
      addBlockLog({ url: href, sourceUrl, reason: 'javascript: link blocked', time: new Date().toISOString() });
      console.log('[Blocker] Blocked javascript: link');
      return false;
    }
  }, true);
}

/* ─── 3. Intercept Element.prototype.click to stop programmatic clicks ─── */
function initProgrammaticClickBlocker() {
  const origClick = HTMLElement.prototype.click;
  HTMLElement.prototype.click = function() {
    if (this.tagName === 'A') {
      const href = this.getAttribute('href') || '';
      const target = this.getAttribute('target') || '';
      if ((target === '_blank' || target === '_new' || href.startsWith('javascript:')) && settings.enabled) {
        if (shouldBlock(href, window.location.href)) {
          incrementCounter();
          addBlockLog({ url: href, sourceUrl: window.location.href, reason: 'programmatic click blocked', time: new Date().toISOString() });
          console.log('[Blocker] Blocked programmatic click on link:', href);
          return;
        }
      }
    }
    return origClick.apply(this, arguments);
  };
}

/* ─── 4. Block beforeunload popup traps ─── */
function initBeforeunloadBlocker() {
  window.addEventListener('beforeunload', (e) => {
    if (settings.enabled) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
}

/* ─── 5. Override document.open (some ads use this) ─── */
function initDocumentOpenBlocker() {
  const orig = document.open;
  document.open = function() {
    if (settings.enabled) {
      console.log('[Blocker] Blocked document.open');
      incrementCounter();
      addBlockLog({ url: window.location.href, sourceUrl: window.location.href, reason: 'document.open blocked', time: new Date().toISOString() });
      return null;
    }
    return orig.apply(document, arguments);
  };
}

/* ─── 6. Override window.location.replace / assign for suspicious URLs ─── */
function initLocationBlocker() {
  const origReplace = window.location.replace;
  window.location.replace = function(url) {
    if (settings.enabled && shouldBlock(url, window.location.href)) {
      console.log('[Blocker] Blocked location.replace:', url);
      incrementCounter();
      addBlockLog({ url, sourceUrl: window.location.href, reason: 'location.replace blocked', time: new Date().toISOString() });
      return;
    }
    return origReplace.apply(window.location, arguments);
  };

  const origAssign = window.location.assign;
  window.location.assign = function(url) {
    if (settings.enabled && shouldBlock(url, window.location.href)) {
      console.log('[Blocker] Blocked location.assign:', url);
      incrementCounter();
      addBlockLog({ url, sourceUrl: window.location.href, reason: 'location.assign blocked', time: new Date().toISOString() });
      return;
    }
    return origAssign.apply(window.location, arguments);
  };
}

/* ─── 7. Intercept iframe navigation ─── */
function initIframeInterceptor() {
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (node.tagName === 'IFRAME') {
          try {
            const iframeSrc = node.src || '';
            if (!iframeSrc) return;

            // Same-origin iframes only
            if (new URL(iframeSrc).origin === window.location.origin && node.contentWindow) {
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

/* ─── 8. Remove dynamically injected ad/popup links ─── */
function initDynamicLinkRemover() {
  const observer = new MutationObserver((mutations) => {
    if (!settings.enabled) return;
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        const links = node.matches?.('a') ? [node] : node.querySelectorAll?.('a') || [];
        links.forEach((a) => {
          const target = a.getAttribute('target') || '';
          const href   = (a.getAttribute('href') || '').toLowerCase();
          if (target === '_blank' || target === '_new' || href.startsWith('javascript:') || href.includes('popup') || href.includes('ad.')) {
            a.removeAttribute('href');
            a.removeAttribute('target');
            a.style.pointerEvents = 'none';
            a.style.opacity = '0.3';
            console.log('[Blocker] Removed dynamic popup link');
          }
        });
      });
    });
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

/* ─── UI ─── */
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

/* ─── Init ─── */
export function initBlocker() {
  loadSettings();
  initWindowOpenBlocker();
  initClickInterceptor();
  initProgrammaticClickBlocker();
  initBeforeunloadBlocker();
  initDocumentOpenBlocker();
  initLocationBlocker();
  initIframeInterceptor();
  initDynamicLinkRemover();
}
