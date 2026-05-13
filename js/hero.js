/** Hero Carousel with Seamless Infinite Loop */
import { heroSlides, currentHeroIndex, setCurrentHeroIndex, setHeroSlideInterval, userCollection } from './state.js';
import { HERO_SLIDE_DURATION } from './config.js';
import { openPlayer } from './player.js';

let isTransitioning = false;
let slideElements = [];
let dotElements = [];
let progressBar = null;
let heroSection = null;
let slidesContainer = null;
let timerStart = 0;
let timerId = null;

export function initHero() {
  heroSection = document.getElementById('heroSection');
  slidesContainer = document.getElementById('heroSlides');
  progressBar = document.getElementById('heroProgressBar');

  if (heroSection) {
    heroSection.addEventListener('mouseenter', pauseHero);
    heroSection.addEventListener('mouseleave', resumeHero);
  }
}

export function renderHeroSlides() {
  if (!slidesContainer) return;
  const dotsContainer = document.getElementById('heroDots');
  if (!dotsContainer) return;

  const count = heroSlides.length;
  if (count === 0) {
    slidesContainer.innerHTML = '';
    dotsContainer.innerHTML = '';
    return;
  }

  // Build slides + clones for seamless loop
  const slidesHtml = heroSlides.map((item, i) => buildSlideHtml(item, i)).join('');
  const firstClone = buildSlideHtml(heroSlides[0], 0, true);
  const lastClone = buildSlideHtml(heroSlides[count - 1], count - 1, true);

  slidesContainer.innerHTML = lastClone + slidesHtml + firstClone;
  slideElements = slidesContainer.querySelectorAll('.hero-slide');

  // Position at the first real slide (index 1 because of lastClone)
  slidesContainer.style.transition = 'none';
  slidesContainer.style.transform = `translateX(-100%)`;
  setCurrentHeroIndex(0);

  // Dots for real slides only
  dotsContainer.innerHTML = heroSlides.map((_, i) =>
    `<button class="hero-dot ${i === 0 ? 'active' : ''}" data-index="${i}"></button>`
  ).join('');
  dotElements = dotsContainer.querySelectorAll('.hero-dot');

  dotElements.forEach(dot => {
    dot.addEventListener('click', () => {
      if (isTransitioning) return;
      const idx = parseInt(dot.dataset.index);
      goToSlide(idx);
    });
  });

  // Attach action listeners to real slides (skip clones)
  const realSlides = Array.from(slideElements).slice(1, -1);
  realSlides.forEach((slide, i) => {
    const item = heroSlides[i];

    const content = slide.querySelector('.hero-slide-content');
    if (content) {
      content.addEventListener('click', (e) => {
        if (e.target.closest('.hero-actions')) return;
        window.dispatchEvent(new CustomEvent('heroOpenModal', {
          detail: { id: item.id, type: item.media_type || 'movie' }
        }));
      });
    }

    const watchBtn = slide.querySelector('.hero-watch-btn');
    const colBtn = slide.querySelector('.hero-collection-btn');

    if (watchBtn) {
      watchBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openPlayer(item.id, item.media_type || 'movie');
      });
    }
    if (colBtn) {
      colBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        try {
          if (userCollection.some(c => c.id === item.id && c.media_type === item.media_type)) return;
          window.dispatchEvent(new CustomEvent('heroAddToCollection', { detail: item }));
          colBtn.innerHTML = '<i class="fas fa-check"></i> In Collection';
          colBtn.disabled = true;
        } catch (err) {
          console.error('[Hero collection btn] Error:', err);
        }
      });
    }
  });

  // Enable transition after initial positioning
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      slidesContainer.style.transition = 'transform 0.8s cubic-bezier(0.4, 0, 0.2, 1)';
      startHeroTimer();
    });
  });
}

function buildSlideHtml(item, index, isClone = false) {
  const backdrop = item.backdrop_path ? `https://image.tmdb.org/t/p/original${item.backdrop_path}` : '';
  const title = item.title || item.name;
  const overview = item.overview || '';
  const year = (item.release_date || item.first_air_date || '').slice(0, 4);
  const rating = item.omdbRating ? item.omdbRating.toFixed(1) : (item.vote_average ? item.vote_average.toFixed(1) : 'N/A');
  const typeLabel = item.media_type === 'tv' ? 'TV Series' : 'Movie';
  const cloneAttr = isClone ? ' data-clone="true"' : '';
  const isInCollection = userCollection.some(c => c.id === item.id && c.media_type === item.media_type);
  const colBtnHtml = isInCollection
    ? `<button class="btn btn-secondary hero-collection-btn" data-index="${index}" disabled><i class="fas fa-check"></i> In Collection</button>`
    : `<button class="btn btn-secondary hero-collection-btn" data-index="${index}"><i class="fas fa-plus"></i> Add to Collection</button>`;

  return `
    <div class="hero-slide" data-index="${index}"${cloneAttr}>
      <div class="hero-slide-backdrop" style="background-image: url('${backdrop}')"></div>
      <div class="hero-slide-content">
        <div class="hero-info">
          <span class="hero-badge">${typeLabel}</span>
          <h1>${title}</h1>
          <p>${overview}</p>
          <div class="hero-meta">
            <span>${year || ''}</span>
            <span class="hero-rating"><i class="fas fa-star"></i> ${rating}</span>
          </div>
          <div class="hero-actions">
            <button class="btn btn-primary hero-watch-btn" data-index="${index}"><i class="fas fa-play"></i> Watch Now</button>
            ${colBtnHtml}
          </div>
        </div>
      </div>
    </div>`;
}

function startHeroTimer() {
  stopHeroTimer();
  timerStart = Date.now();
  if (progressBar) {
    progressBar.style.transition = 'none';
    progressBar.style.width = '0%';
    progressBar.offsetHeight;
    progressBar.style.transition = `width ${HERO_SLIDE_DURATION}ms linear`;
    progressBar.style.width = '100%';
  }
  timerId = setInterval(() => {
    if (!isTransitioning) {
      nextHeroSlide();
    }
  }, HERO_SLIDE_DURATION);
  setHeroSlideInterval(timerId);
}

function stopHeroTimer() {
  if (timerId) {
    clearInterval(timerId);
    timerId = null;
  }
  if (progressBar) {
    progressBar.style.transition = 'none';
    const elapsed = Date.now() - timerStart;
    const pct = Math.min(100, (elapsed / HERO_SLIDE_DURATION) * 100);
    progressBar.style.width = `${pct}%`;
  }
}

export function pauseHero() {
  stopHeroTimer();
}

export function resumeHero() {
  if (heroSlides.length > 0) {
    startHeroTimer();
  }
}

export function nextHeroSlide() {
  if (isTransitioning || heroSlides.length === 0) return;
  const nextIndex = (currentHeroIndex + 1) % heroSlides.length;
  goToSlide(nextIndex, 'next');
}

function goToSlide(index, explicitDirection = null) {
  if (isTransitioning || !slidesContainer || heroSlides.length === 0) return;
  isTransitioning = true;

  const count = heroSlides.length;

  let direction = explicitDirection;
  if (!direction) {
    if (index === 0 && currentHeroIndex === count - 1) direction = 'next';
    else if (index === count - 1 && currentHeroIndex === 0) direction = 'prev';
    else if (index > currentHeroIndex) direction = 'next';
    else direction = 'prev';
  }

  let targetPos = index + 1;
  const isWrappingNext = direction === 'next' && index === 0 && currentHeroIndex === count - 1;
  const isWrappingPrev = direction === 'prev' && index === count - 1 && currentHeroIndex === 0;

  if (isWrappingNext) targetPos = count + 1;
  else if (isWrappingPrev) targetPos = 0;

  slidesContainer.style.transition = 'transform 0.8s cubic-bezier(0.4, 0, 0.2, 1)';
  slidesContainer.style.transform = `translateX(-${targetPos * 100}%)`;

  updateDots(index);
  setCurrentHeroIndex(index);

  if (isWrappingNext || isWrappingPrev) {
    slidesContainer.addEventListener('transitionend', function handler(e) {
      if (e.target !== slidesContainer) return;
      slidesContainer.removeEventListener('transitionend', handler);

      slidesContainer.style.transition = 'none';
      if (isWrappingNext) {
        slidesContainer.style.transform = `translateX(-100%)`;
      } else {
        slidesContainer.style.transform = `translateX(-${count * 100}%)`;
      }

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          isTransitioning = false;
        });
      });
    }, { once: true });
  } else {
    setTimeout(() => {
      isTransitioning = false;
    }, 850);
  }

  startHeroTimer();
}

function updateDots(activeIndex) {
  dotElements.forEach((dot, i) => {
    dot.classList.toggle('active', i === activeIndex);
  });
}
