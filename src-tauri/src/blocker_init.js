(() => {
  const CHANNEL = '__opencloud_blocker_v1__';
  if (window.__openCloudNativeBlockerInstalled) return;
  window.__openCloudNativeBlockerInstalled = true;

  let policy = {
    enabled: true,
    blockAllTabs: true,
    blockAllWindows: true,
    allowSelfPages: false,
    allowExtensionPages: false
  };

  const currentUrl = () => {
    try { return window.location.href; } catch (_) { return ''; }
  };

  const isSameOrigin = (url) => {
    try { return new URL(url, currentUrl()).origin === window.location.origin; } catch (_) { return false; }
  };

  const shouldBlock = (url, kind) => {
    if (!policy.enabled) return false;
    const normalized = String(url || 'about:blank');
    if (policy.allowSelfPages && isSameOrigin(normalized)) return false;
    if (policy.allowExtensionPages && /^(tauri|ipc):/i.test(normalized)) return false;
    return kind === 'tab' ? policy.blockAllTabs : policy.blockAllWindows;
  };

  const report = (url, reason) => {
    const payload = {
      channel: CHANNEL,
      type: 'blocked',
      entry: {
        url: String(url || 'about:blank').slice(0, 4096),
        sourceUrl: currentUrl().slice(0, 4096),
        reason: String(reason || 'blocked').slice(0, 200),
        time: new Date().toISOString()
      }
    };
    try {
      if (window.top === window) {
        window.dispatchEvent(new CustomEvent('opencloud:blocker-event', { detail: payload.entry }));
      } else {
        window.top.postMessage(payload, '*');
      }
    } catch (_) {}
  };

  const broadcastPolicy = () => {
    try {
      document.querySelectorAll('iframe').forEach((frame) => {
        try { frame.contentWindow?.postMessage({ channel: CHANNEL, type: 'policy', policy }, '*'); } catch (_) {}
      });
    } catch (_) {}
  };

  window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || data.channel !== CHANNEL) return;

    if (data.type === 'policy') {
      const fromTrustedParent = window.top === window ? event.source === window : event.source === window.parent;
      if (!fromTrustedParent || !data.policy || typeof data.policy !== 'object') return;
      policy = { ...policy, ...data.policy };
      broadcastPolicy();
      return;
    }

    if (data.type === 'blocked' && window.top === window && event.source !== window) {
      const entry = data.entry || {};
      window.dispatchEvent(new CustomEvent('opencloud:blocker-event', {
        detail: {
          url: String(entry.url || 'unknown').slice(0, 4096),
          sourceUrl: String(entry.sourceUrl || 'child-frame').slice(0, 4096),
          reason: String(entry.reason || 'child-frame popup blocked').slice(0, 200),
          time: entry.time || new Date().toISOString()
        }
      }));
    }
  }, true);

  const originalOpen = window.open;
  window.open = function(url, target) {
    const kind = target === '_blank' || target === '_new' || target === 'popup' || !target ? 'window' : 'tab';
    if (shouldBlock(url, kind)) {
      report(url, 'window.open blocked');
      return null;
    }
    return originalOpen.apply(window, arguments);
  };

  document.addEventListener('click', (event) => {
    if (!policy.enabled) return;
    const target = event.target;
    const link = target?.closest?.('a,area');
    const form = target?.closest?.('form');
    const element = link || form;
    if (!element) return;
    const url = link?.href || form?.action || '';
    const targetName = element.getAttribute('target') || '';
    const javascriptUrl = /^javascript:/i.test(url);
    const popupTarget = targetName === '_blank' || targetName === '_new' || targetName === 'popup';
    if (javascriptUrl || (popupTarget && shouldBlock(url, 'tab'))) {
      event.preventDefault();
      event.stopImmediatePropagation();
      report(url, javascriptUrl ? 'javascript URL blocked' : 'new-tab click blocked');
    }
  }, true);

  const originalClick = HTMLElement.prototype.click;
  HTMLElement.prototype.click = function() {
    const tag = this.tagName;
    const url = tag === 'FORM' ? this.action : this.href || this.getAttribute?.('href') || '';
    const target = this.getAttribute?.('target') || '';
    const popupTarget = target === '_blank' || target === '_new' || target === 'popup';
    if ((tag === 'A' || tag === 'AREA' || tag === 'FORM') && popupTarget && shouldBlock(url, 'tab')) {
      report(url, 'programmatic popup click blocked');
      return;
    }
    return originalClick.apply(this, arguments);
  };

  // Install first and stop later provider traps without creating an unload
  // confirmation of our own. The app's own save handler is installed on the
  // top frame after this listener and does not attempt to cancel unloading.
  window.addEventListener('beforeunload', (event) => {
    if (!policy.enabled || window.top === window) return;
    event.stopImmediatePropagation();
  }, true);

  document.addEventListener('DOMContentLoaded', () => {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node?.tagName !== 'IFRAME') continue;
          node.addEventListener('load', () => {
            try { node.contentWindow?.postMessage({ channel: CHANNEL, type: 'policy', policy }, '*'); } catch (_) {}
          });
        }
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    broadcastPolicy();
  }, { once: true });
})();
