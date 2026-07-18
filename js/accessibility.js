const INTERACTIVE_SELECTOR = [
  '.category-card', '.grid-item', '.search-result-item', '.collection-card',
  '.collection-tile', '.franchise-tile', '.provider-card', '.avatar-preset', '#logoHome',
  '.ep-popover-list li'
].join(',');

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])', 'a[href]', 'input:not([disabled])', 'select:not([disabled])',
  'textarea:not([disabled])', '[role="button"]', '[tabindex]:not([tabindex="-1"])'
].join(',');

let lastFocusedBeforeDialog = null;

function isVisible(element) {
  if (!element || element.closest('.hidden')) return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function accessibleName(element) {
  const imageAlt = element.querySelector?.('img[alt]')?.alt;
  return element.getAttribute('aria-label') || element.getAttribute('title') ||
    element.querySelector?.('.card-title,.item-title,.collection-card-name,.provider-card-name,.item-name')?.textContent?.trim() ||
    imageAlt || element.textContent?.trim().replace(/\s+/g, ' ').slice(0, 120) || 'Open item';
}

function enhanceElement(element) {
  if (!(element instanceof HTMLElement)) return;
  if (element.matches(INTERACTIVE_SELECTOR) && !element.matches('button,a,input,select,textarea')) {
    element.setAttribute('role', 'button');
    if (!element.hasAttribute('tabindex')) element.tabIndex = 0;
    if (!element.hasAttribute('aria-label')) element.setAttribute('aria-label', accessibleName(element));
  }
  if (element.matches('.modal,.ep-popover-overlay')) {
    element.setAttribute('role', 'dialog');
    element.setAttribute('aria-modal', 'true');
  }
  element.querySelectorAll?.(INTERACTIVE_SELECTOR).forEach(enhanceElement);
  element.querySelectorAll?.('.modal,.ep-popover-overlay').forEach(enhanceElement);
}

function activeDialog() {
  return [...document.querySelectorAll('.modal:not(.hidden),.ep-popover-overlay:not(.hidden),.player-overlay:not(.hidden)')]
    .filter(isVisible)
    .at(-1) || null;
}

function closeTopLayer() {
  const dialog = activeDialog();
  if (dialog) {
    const close = dialog.querySelector('#epPopoverClose,#playerBackBtn,.modal-close,[data-dialog-close]');
    if (close) {
      close.click();
      return true;
    }
  }
  const dropdown = document.getElementById('accountDropdown');
  if (dropdown && !dropdown.classList.contains('hidden')) {
    dropdown.classList.add('hidden');
    document.getElementById('accountBtn')?.focus();
    return true;
  }
  const search = document.getElementById('searchResults');
  if (search && !search.classList.contains('hidden')) {
    search.classList.add('hidden');
    document.getElementById('searchInput')?.focus();
    return true;
  }
  return false;
}

function moveSpatially(current, key) {
  const currentRect = current.getBoundingClientRect();
  const originX = currentRect.left + currentRect.width / 2;
  const originY = currentRect.top + currentRect.height / 2;
  const candidates = [...document.querySelectorAll(FOCUSABLE_SELECTOR)]
    .filter(element => element !== current && isVisible(element));

  let best = null;
  let bestScore = Infinity;
  for (const candidate of candidates) {
    const rect = candidate.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const dx = x - originX;
    const dy = y - originY;
    const inDirection = (key === 'ArrowLeft' && dx < -4) || (key === 'ArrowRight' && dx > 4) ||
      (key === 'ArrowUp' && dy < -4) || (key === 'ArrowDown' && dy > 4);
    if (!inDirection) continue;
    const primary = key === 'ArrowLeft' || key === 'ArrowRight' ? Math.abs(dx) : Math.abs(dy);
    const secondary = key === 'ArrowLeft' || key === 'ArrowRight' ? Math.abs(dy) : Math.abs(dx);
    const score = primary + secondary * 2.2;
    if (score < bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  best?.focus({ preventScroll: true });
  best?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  return Boolean(best);
}

function handleKeydown(event) {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;

  if (event.key === 'Escape' && closeTopLayer()) {
    event.preventDefault();
    event.stopImmediatePropagation();
    return;
  }

  if ((event.key === 'Enter' || event.key === ' ') && target.matches('[role="button"]') && !target.matches('button,a')) {
    event.preventDefault();
    target.click();
    return;
  }

  if (event.key === 'Tab') {
    const dialog = activeDialog();
    if (!dialog) return;
    const focusable = [...dialog.querySelectorAll(FOCUSABLE_SELECTOR)].filter(isVisible);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && target === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && target === last) { event.preventDefault(); first.focus(); }
    return;
  }

  if (!event.key.startsWith('Arrow')) return;
  if (target.matches('input,textarea,select') || target.closest('iframe')) return;
  const useSpatialNavigation = document.body.classList.contains('device-tv') || target.matches(INTERACTIVE_SELECTOR);
  if (useSpatialNavigation && moveSpatially(target, event.key)) event.preventDefault();
}

function observeDialogs() {
  const knownVisible = new WeakSet();
  const observer = new MutationObserver(mutations => {
    for (const mutation of mutations) {
      if (mutation.type === 'childList') mutation.addedNodes.forEach(enhanceElement);
      if (mutation.type !== 'attributes') continue;
      const element = mutation.target;
      if (!(element instanceof HTMLElement) || !element.matches('.modal,.ep-popover-overlay,.player-overlay')) continue;
      if (!element.classList.contains('hidden') && !knownVisible.has(element)) {
        lastFocusedBeforeDialog = document.activeElement;
        knownVisible.add(element);
        requestAnimationFrame(() => element.querySelector(FOCUSABLE_SELECTOR)?.focus());
      } else if (element.classList.contains('hidden') && knownVisible.has(element)) {
        knownVisible.delete(element);
        if (lastFocusedBeforeDialog instanceof HTMLElement && document.contains(lastFocusedBeforeDialog)) {
          requestAnimationFrame(() => lastFocusedBeforeDialog.focus());
        }
      }
    }
  });
  observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
}

export function announce(message) {
  const region = document.getElementById('appAnnouncements');
  if (!region) return;
  region.textContent = '';
  requestAnimationFrame(() => { region.textContent = message; });
}

export function initAccessibility() {
  enhanceElement(document.body);
  observeDialogs();
  document.addEventListener('keydown', handleKeydown, true);

  const iconLabels = {
    clearSearch: 'Clear search', settingsClose: 'Close settings', updateModalClose: 'Close update',
    epPopoverBack: 'Back to seasons', epPopoverClose: 'Close episode selector'
  };
  Object.entries(iconLabels).forEach(([id, label]) => document.getElementById(id)?.setAttribute('aria-label', label));
}
