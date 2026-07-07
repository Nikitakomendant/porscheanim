(() => {
  'use strict';

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- Video setup ---------- */
  const video = document.getElementById('heroVideo');
  const videoBg = document.getElementById('heroVideoBg');
  let videoDuration = 0;
  let videoReady = false;

  // The blurred full-bleed background video is only needed on narrow/mobile
  // viewports (desktop already fills the screen with the sharp video via
  // object-fit:cover). Loading a second video decoder is not free, so only
  // start it where it's actually used, and keep it in sync cheaply.
  const mobileMedia = window.matchMedia('(max-width:760px)');
  let bgVideoStarted = false;

  function ensureBgVideo(){
    if(bgVideoStarted || !mobileMedia.matches) return;
    bgVideoStarted = true;
    videoBg.preload = 'auto';
    videoBg.load();
  }
  ensureBgVideo();
  mobileMedia.addEventListener('change', ensureBgVideo);

  let lastBgSync = 0;
  function syncBgVideo(now){
    if(!bgVideoStarted || videoBg.readyState < 1) return;
    // ~8 updates/sec is plenty since the layer is heavily blurred — no need
    // to burn extra decode/seek work keeping it frame-perfect.
    if(now - lastBgSync < 120) return;
    lastBgSync = now;
    try{ videoBg.currentTime = video.currentTime; }catch(e){ /* ignore */ }
  }

  const loaderEl = document.getElementById('loader');
  const loaderBar = document.getElementById('loaderBar');
  const loaderPct = document.getElementById('loaderPct');

  function setLoaderPct(pct){
    pct = Math.max(0, Math.min(100, Math.round(pct)));
    loaderBar.style.width = pct + '%';
    loaderPct.textContent = pct + '%';
  }

  video.addEventListener('progress', () => {
    if(video.duration && video.buffered.length){
      const buffered = video.buffered.end(video.buffered.length - 1);
      setLoaderPct((buffered / video.duration) * 100);
    }
  });

  video.addEventListener('loadedmetadata', () => {
    videoDuration = video.duration || 0;
  });

  function onVideoReady(){
    if(videoReady) return;
    videoReady = true;
    setLoaderPct(100);
    setTimeout(() => loaderEl.classList.add('hidden'), 250);
    startExperience();
  }

  video.addEventListener('canplaythrough', onVideoReady, { once:true });
  // Safety net in case canplaythrough never fires (slow/odd network conditions)
  video.addEventListener('loadeddata', () => {
    setTimeout(() => { if(!videoReady) onVideoReady(); }, 800);
  }, { once:true });
  // Hard failsafe: whatever happens with the video (slow connection, decode
  // error, unsupported format on some device) the loader must NEVER stay up
  // and block the whole site forever — that would make every button,
  // including the burger menu, feel "broken" when it's really just stuck
  // behind an invisible full-screen overlay.
  video.addEventListener('error', () => { if(!videoReady) onVideoReady(); });
  setTimeout(() => { if(!videoReady) onVideoReady(); }, 6000);

  video.load();

  let pendingTime = null;
  let isSeeking = false;

  function setVideoTime(t){
    if(!videoDuration) return;
    pendingTime = Math.max(0, Math.min(videoDuration - 0.001, t));
    requestSeek();
  }

  function requestSeek(){
    if(isSeeking || pendingTime === null) return;
    // Already close enough to the target — nothing to do.
    if(Math.abs(video.currentTime - pendingTime) <= 0.004){
      pendingTime = null;
      return;
    }
    isSeeking = true;
    video.currentTime = pendingTime;
    pendingTime = null;
  }

  // Only ask the decoder for the next frame once it has actually delivered
  // the previous one — this is what keeps scrubbing smooth instead of
  // flooding the pipeline with seeks that get dropped (which read as low FPS).
  video.addEventListener('seeked', () => {
    isSeeking = false;
    requestSeek();
  });

  /* ---------- Scroll-driven state ---------- */
  const heroSection = document.getElementById('top');
  const speedVal = document.getElementById('speedVal');
  const accelVal = document.getElementById('accelVal');
  const gearVal = document.getElementById('gearVal');
  const scrollFill = document.getElementById('scrollFill');
  const scrollHint = document.getElementById('scrollHint');
  const lines = [
    document.getElementById('line1'),
    document.getElementById('line2'),
    document.getElementById('line3'),
  ];
  const navEl = document.getElementById('nav');

  const TOP_SPEED = 308;
  const TOP_ACCEL = 3.5;
  const CAPTION_SWITCH_1 = 0.32;
  const CAPTION_SWITCH_2 = 0.70;

  // Smoothing: how fast visuals chase actual scroll position.
  const SMOOTHING = 0.07;
  const SNAP_EPSILON = 0.0004;

  function easeOutCubic(t){ return 1 - Math.pow(1 - t, 3); }
  function easeInOutCubic(t){ return t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t + 2, 3) / 2; }
  function lerp(a, b, t){ return a + (b - a) * t; }

  // Video keyframes — continuous, no pauses/holds.
  //
  // The source footage has a ~20% "dead" intro where the car barely moves
  // (camera just creeps in on a straight-on shot) before the turntable
  // rotation actually kicks in around frame 28/142 (~0.18 of the duration).
  // Mapped 1:1 to scroll, that meant the speed counter was already climbing
  // while the car visibly sat still — feels broken. So we fast-forward
  // through that dead zone in just the first sliver of scroll (0 → 0.04),
  // then spend the rest of the first caption band on the part that actually
  // rotates.
  function getVideoKeyframes(){
    const dur = videoDuration || 0;
    const endFrame = Math.max(0, dur - 0.02);
    return [
      { p: 0,                t: 0 },
      { p: 0.04,              t: dur * 0.183 },
      { p: CAPTION_SWITCH_1, t: dur * 0.33 },
      { p: CAPTION_SWITCH_2, t: dur * 0.72 },
      { p: 1,                t: endFrame },
    ];
  }

  // Linear interpolation between keyframes keeps playback speed continuous
  // across segment boundaries. Easing per-segment (e.g. easeInOutCubic) makes
  // velocity hit zero at every keyframe, which reads as the video "stopping"
  // each time a caption switch point is crossed — that's the stutter we're
  // removing here.
  function videoTimeForProgress(progress){
    const kf = getVideoKeyframes();
    for(let i = 0; i < kf.length - 1; i++){
      const a = kf[i], b = kf[i + 1];
      if(progress <= b.p || i === kf.length - 2){
        const span = b.p - a.p;
        const localT = span > 0 ? Math.min(1, Math.max(0, (progress - a.p) / span)) : 1;
        return a.t + (b.t - a.t) * localT;
      }
    }
    return kf[kf.length - 1].t;
  }

  let targetProgress = 0;
  let smoothProgress = 0;
  let loopStarted = false;

  // Cache viewport height instead of reading window.innerHeight every frame —
  // on mobile Safari/Chrome the address bar shows/hides while scrolling and
  // innerHeight changes with it, which otherwise makes the scroll progress
  // (and the video) jitter mid-scrub. We only refresh this on real resize/
  // orientation events, not continuously.
  let viewportH = window.visualViewport ? window.visualViewport.height : window.innerHeight;

  function computeTargetProgress(){
    const rect = heroSection.getBoundingClientRect();
    const total = heroSection.offsetHeight - viewportH;
    targetProgress = Math.max(0, Math.min(1, total > 0 ? (-rect.top) / total : 0));
  }

  function refreshViewportH(){
    viewportH = window.visualViewport ? window.visualViewport.height : window.innerHeight;
    computeTargetProgress();
    renderVisuals(smoothProgress);
  }

  /* ---------- Touch scrub (mobile) ---------- */
  // On mobile the hero section is tall (700vh) and the browser's native scroll
  // already drives it. We just need to make sure touch events are NOT blocked.
  // The video scrub is purely driven by window.scrollY, so no extra touch
  // handling is needed — the browser handles momentum scrolling natively.

  function renderVisuals(progress){
    const eased = easeOutCubic(progress);

    setVideoTime(videoTimeForProgress(progress));
    syncBgVideo(performance.now());

    speedVal.textContent = Math.round(eased * TOP_SPEED);
    accelVal.innerHTML = (eased * TOP_ACCEL).toFixed(1) + '<small>с</small>';
    scrollFill.style.width = (progress * 100) + '%';

    const gear = Math.min(7, 1 + Math.floor(eased * 7));
    gearVal.textContent = progress > 0.02 ? String(gear) : 'N';

    const bandIndex = progress < CAPTION_SWITCH_1 ? 0 : (progress < CAPTION_SWITCH_2 ? 1 : 2);
    lines.forEach((el, i) => el.classList.toggle('active', i === bandIndex));

    scrollHint.classList.toggle('fade', progress > 0.04);
    navEl.classList.toggle('scrolled', window.scrollY > window.innerHeight * 0.2);
  }

  function tick(){
    computeTargetProgress();

    if(reduceMotion){
      smoothProgress = targetProgress;
    } else if(Math.abs(targetProgress - smoothProgress) < SNAP_EPSILON){
      smoothProgress = targetProgress;
    } else {
      smoothProgress = lerp(smoothProgress, targetProgress, SMOOTHING);
    }

    renderVisuals(smoothProgress);
    window.requestAnimationFrame(tick);
  }

  function startExperience(){
    computeTargetProgress();
    smoothProgress = targetProgress;
    renderVisuals(smoothProgress);
    if(!loopStarted){
      loopStarted = true;
      window.requestAnimationFrame(tick);
    }
  }

  window.addEventListener('resize', refreshViewportH);
  window.addEventListener('orientationchange', refreshViewportH);

  /* ---------- Mobile nav ---------- */
  const navBurger = document.getElementById('navBurger');
  const navMobile = document.getElementById('navMobile');
  navBurger.setAttribute('aria-expanded', 'false');
  navBurger.addEventListener('click', () => {
    const willOpen = !navMobile.classList.contains('open');
    navMobile.classList.toggle('open', willOpen);
    navBurger.classList.toggle('open', willOpen);
    navBurger.setAttribute('aria-expanded', String(willOpen));
  });
  navMobile.querySelectorAll('a').forEach(a => {
    a.addEventListener('click', () => {
      navMobile.classList.remove('open');
      navBurger.classList.remove('open');
      navBurger.setAttribute('aria-expanded', 'false');
    });
  });

  /* ---------- Spec counters (count up when in view) ---------- */
  const counters = document.querySelectorAll('.specs-val[data-count]');
  const counterObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if(entry.isIntersecting){
        animateCounter(entry.target);
        counterObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.5 });
  counters.forEach(el => counterObserver.observe(el));

  function animateCounter(el){
    const target = parseFloat(el.dataset.count);
    const decimals = parseInt(el.dataset.decimal || '0', 10);
    const suffix = el.querySelector('small');
    const duration = 1200;
    const start = performance.now();

    function frame(now){
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const value = target * eased;
      el.firstChild.textContent = value.toFixed(decimals);
      if(t < 1){
        requestAnimationFrame(frame);
      } else {
        el.firstChild.textContent = target.toFixed(decimals);
      }
    }
    if(reduceMotion){
      el.firstChild.textContent = target.toFixed(decimals);
    } else {
      requestAnimationFrame(frame);
    }
  }

  /* ---------- Scroll reveal ---------- */
  const revealEls = document.querySelectorAll('.reveal');
  revealEls.forEach(el => {
    if(el.dataset.delay) el.style.setProperty('--rd', el.dataset.delay);
  });
  if(reduceMotion){
    revealEls.forEach(el => el.classList.add('in-view'));
  } else {
    const revealObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if(entry.isIntersecting){
          entry.target.classList.add('in-view');
          revealObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.15, rootMargin: '0px 0px -6% 0px' });
    revealEls.forEach(el => revealObserver.observe(el));
  }

  /* ---------- Gallery lightbox ---------- */
  const lightbox = document.getElementById('lightbox');
  const lightboxImg = document.getElementById('lightboxImg');
  const lightboxClose = document.getElementById('lightboxClose');
  const galleryImgs = document.querySelectorAll('.gallery-strip img');

  function openLightbox(img){
    lightboxImg.src = img.currentSrc || img.src;
    lightboxImg.alt = img.alt || '';
    lightbox.classList.add('open');
    document.body.style.overflow = 'hidden';
  }
  function closeLightbox(){
    lightbox.classList.remove('open');
    document.body.style.overflow = '';
  }
  galleryImgs.forEach(img => {
    img.addEventListener('click', () => openLightbox(img));
  });
  if(lightboxClose){
    lightboxClose.addEventListener('click', closeLightbox);
    lightbox.addEventListener('click', (e) => { if(e.target === lightbox) closeLightbox(); });
    document.addEventListener('keydown', (e) => { if(e.key === 'Escape') closeLightbox(); });
  }

  /* ---------- Color picker (updates preview image tone) ---------- */
  const colorItems = document.querySelectorAll('.color-item');
  const colorPreviewImg = document.getElementById('colorPreviewImg');
  const colorPreviewTag = document.getElementById('colorPreviewTag');

  function hexToHSL(hex){
    hex = hex.replace('#', '');
    const r = parseInt(hex.substring(0, 2), 16) / 255;
    const g = parseInt(hex.substring(2, 4), 16) / 255;
    const b = parseInt(hex.substring(4, 6), 16) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0;
    const l = (max + min) / 2;
    if(max !== min){
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch(max){
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        default: h = (r - g) / d + 4;
      }
      h /= 6;
    }
    return { h: h * 360, s: s * 100, l: l * 100 };
  }

  // Since we only have one reference photo, we approximate each paint color
  // as a tone-shifted preview via CSS filters rather than pretending to have
  // a real studio shot per colorway.
  function filterForColor(hex){
    const { h, s, l } = hexToHSL(hex);
    if(s < 12 || l > 85 || l < 8){
      const bright = (0.3 + (l / 100) * 0.85).toFixed(2);
      const contrast = l < 15 ? 1.2 : 1.05;
      return `saturate(0.25) brightness(${bright}) contrast(${contrast})`;
    }
    const rotate = Math.round(h - 28);
    const sat = l < 20 ? 2.6 : 3.4;
    const bright = l < 20 ? 0.6 : 0.88;
    return `sepia(0.5) saturate(${sat}) hue-rotate(${rotate}deg) brightness(${bright}) contrast(1.08)`;
  }

  function selectColor(btn){
    colorItems.forEach(b => {
      b.classList.remove('active');
      b.setAttribute('aria-pressed', 'false');
    });
    btn.classList.add('active');
    btn.setAttribute('aria-pressed', 'true');
    if(colorPreviewImg){
      colorPreviewImg.style.filter = filterForColor(btn.dataset.color);
    }
    if(colorPreviewTag){
      colorPreviewTag.textContent = btn.dataset.name || '';
    }
  }

  colorItems.forEach(btn => {
    btn.addEventListener('click', () => selectColor(btn));
  });
  if(colorItems.length){
    selectColor(document.querySelector('.color-item.active') || colorItems[0]);
  }


  const ctaForm = document.getElementById('ctaForm');
  if(ctaForm){
    ctaForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const btn = ctaForm.querySelector('button');
      const original = btn.textContent;
      btn.textContent = 'Заявка отправлена ✓';
      ctaForm.reset();
      setTimeout(() => { btn.textContent = original; }, 2600);
    });
  }
})();
