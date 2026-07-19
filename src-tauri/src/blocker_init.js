(() => {
  const CHANNEL = '__opencloud_blocker_v1__';
  const PLAYER_INPUT_CHANNEL = '__opencloud_player_input_v1__';
  const PLAYER_CONTROL_CHANNEL = '__opencloud_player_control_v1__';
  const MIN_CONTENT_DURATION_SECONDS = 180;
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

  const frameId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const instrumentedVideos = new WeakSet();
  const trackedVideos = new Set();
  const lastVideoReportAt = new WeakMap();
  const appliedResumeTargets = new WeakMap();
  let pendingResume = { seconds: 0, durationSeconds: 0, sessionKey: '' };
  let lastPointerActivityAt = 0;

  const forwardPlayerInput = (type, payload = {}) => {
    if (window.top === window) return;
    try { window.parent.postMessage({ channel: PLAYER_INPUT_CHANNEL, type, frameId, ...payload }, '*'); } catch (_) {}
  };

  const videoSample = (video) => {
    const rect = video.getBoundingClientRect?.();
    return {
      seconds: Number(video.currentTime),
      durationSeconds: Number(video.duration),
      paused: !!video.paused,
      ended: !!video.ended,
      readyState: Number(video.readyState) || 0,
      width: Number(video.videoWidth) || 0,
      height: Number(video.videoHeight) || 0,
      area: Math.max(0, Number(rect?.width) || 0) * Math.max(0, Number(rect?.height) || 0)
    };
  };

  const reportVideoProgress = (video, eventName, force = false) => {
    if (window.top === window) return;
    const now = Date.now();
    if (!force && now - (lastVideoReportAt.get(video) || 0) < 1500) return;
    const sample = videoSample(video);
    if (!Number.isFinite(sample.seconds) || !Number.isFinite(sample.durationSeconds)) return;
    lastVideoReportAt.set(video, now);
    forwardPlayerInput('playback-progress', { eventName, sample, sessionKey: pendingResume.sessionKey });
  };

  const applyPendingResume = (video) => {
    const duration = Number(video.duration);
    const resumeSeconds = Number(pendingResume.seconds);
    const expectedDuration = Number(pendingResume.durationSeconds);
    if (!Number.isFinite(resumeSeconds) || resumeSeconds < 1) return;
    if (!Number.isFinite(duration) || duration < MIN_CONTENT_DURATION_SECONDS) return;
    if (Number.isFinite(expectedDuration) && expectedDuration >= MIN_CONTENT_DURATION_SECONDS) {
      const allowedDifference = Math.max(30, expectedDuration * 0.08);
      if (Math.abs(duration - expectedDuration) > allowedDifference) return;
    } else if (duration < Math.max(600, resumeSeconds + 60)) {
      // Cloud-only checkpoints do not know the duration. Be conservative so a
      // pre-roll video cannot consume the resume seek before the feature starts.
      return;
    }
    if (resumeSeconds > duration - 3) return;
    const target = resumeSeconds;
    if (target < 1 || appliedResumeTargets.get(video) === target) return;
    try {
      video.currentTime = target;
      appliedResumeTargets.set(video, target);
      forwardPlayerInput('resume-applied', { seconds: target, durationSeconds: duration, sessionKey: pendingResume.sessionKey });
    } catch (_) {}
  };

  const instrumentVideo = (video) => {
    if (!video || instrumentedVideos.has(video)) return;
    instrumentedVideos.add(video);
    trackedVideos.add(video);
    ['loadedmetadata', 'durationchange', 'canplay'].forEach((eventName) => {
      video.addEventListener(eventName, () => {
        applyPendingResume(video);
        reportVideoProgress(video, eventName, true);
      }, true);
    });
    video.addEventListener('timeupdate', () => reportVideoProgress(video, 'timeupdate'), true);
    ['playing', 'pause', 'seeked', 'ended'].forEach((eventName) => {
      video.addEventListener(eventName, () => {
        if (eventName === 'playing') applyPendingResume(video);
        reportVideoProgress(video, eventName, true);
      }, true);
    });
    video.addEventListener('emptied', () => appliedResumeTargets.delete(video), true);
    applyPendingResume(video);
  };

  const scanForVideos = (root = document) => {
    try {
      if (root?.tagName === 'VIDEO') instrumentVideo(root);
      root?.querySelectorAll?.('video').forEach(instrumentVideo);
    } catch (_) {}
  };

  // Some providers create their media inside a closed shadow root. Those
  // elements cannot be found by querySelectorAll, but every played element
  // still passes through HTMLMediaElement.play().
  if (typeof HTMLMediaElement !== 'undefined' && typeof HTMLMediaElement.prototype?.play === 'function') {
    const originalMediaPlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (...args) {
      if (this?.tagName === 'VIDEO') instrumentVideo(this);
      return originalMediaPlay.apply(this, args);
    };
  }

  const flushVideoProgress = () => {
    try { trackedVideos.forEach(video => reportVideoProgress(video, 'pagehide', true)); } catch (_) {}
  };

  const broadcastPlayerControl = (type = 'resume') => {
    if (!pendingResume.sessionKey) return;
    try {
      document.querySelectorAll('iframe').forEach((frame) => {
        try {
          frame.contentWindow?.postMessage({
            channel: PLAYER_CONTROL_CHANNEL,
            type,
            seconds: pendingResume.seconds,
            durationSeconds: pendingResume.durationSeconds,
            sessionKey: pendingResume.sessionKey
          }, '*');
        } catch (_) {}
      });
    } catch (_) {}
  };

  window.addEventListener('keydown', (event) => {
    if (window.top === window || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target;
    const isTyping = target instanceof HTMLElement
      && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
    if (isTyping || event.key?.toLowerCase() !== 't') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    forwardPlayerInput('toggle-header');
  }, true);

  window.addEventListener('mousemove', () => {
    if (window.top === window) return;
    const now = Date.now();
    if (now - lastPointerActivityAt < 200) return;
    lastPointerActivityAt = now;
    forwardPlayerInput('pointer-activity');
  }, true);

  window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data) return;

    if (data.channel === PLAYER_CONTROL_CHANNEL && event.source === window.parent) {
      if (data.type === 'resume') {
        const seconds = Number(data.seconds);
        const durationSeconds = Number(data.durationSeconds);
        pendingResume = {
          seconds: Number.isFinite(seconds) && seconds > 0 ? seconds : 0,
          durationSeconds: Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : 0,
          sessionKey: String(data.sessionKey || '').slice(0, 160)
        };
        scanForVideos();
        try { document.querySelectorAll('video').forEach(applyPendingResume); } catch (_) {}
        broadcastPlayerControl();
      } else if (data.type === 'checkpoint') {
        pendingResume.sessionKey = String(data.sessionKey || pendingResume.sessionKey || '').slice(0, 160);
        scanForVideos();
        flushVideoProgress();
        broadcastPlayerControl('checkpoint');
      }
      return;
    }

    if (data.channel === PLAYER_INPUT_CHANNEL && event.source !== window) {
      const detail = {
        type: data.type,
        frameId: String(data.frameId || '').slice(0, 100),
        eventName: String(data.eventName || '').slice(0, 40),
        sample: data.sample,
        seconds: data.seconds,
        durationSeconds: data.durationSeconds,
        sessionKey: String(data.sessionKey || '').slice(0, 160)
      };
      if (window.top === window) {
        window.dispatchEvent(new CustomEvent('opencloud:player-frame-input', {
          detail
        }));
      } else if (event.source !== window.parent) {
        try { window.parent.postMessage({ channel: PLAYER_INPUT_CHANNEL, ...detail }, '*'); } catch (_) {}
      }
      return;
    }

    if (data.channel !== CHANNEL) return;

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
    flushVideoProgress();
    if (!policy.enabled || window.top === window) return;
    event.stopImmediatePropagation();
  }, true);

  document.addEventListener('DOMContentLoaded', () => {
    scanForVideos();
    forwardPlayerInput('bridge-ready');
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          scanForVideos(node);
          const frames = [];
          if (node?.tagName === 'IFRAME') frames.push(node);
          try { node?.querySelectorAll?.('iframe').forEach(frame => frames.push(frame)); } catch (_) {}
          frames.forEach((frame) => {
            frame.addEventListener('load', () => {
              try { frame.contentWindow?.postMessage({ channel: CHANNEL, type: 'policy', policy }, '*'); } catch (_) {}
              broadcastPlayerControl();
            });
          });
        }
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    broadcastPolicy();
  }, { once: true });
  window.addEventListener('pagehide', flushVideoProgress, true);
})();
