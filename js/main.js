(() => {
  'use strict';

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- Video setup ---------- */
  const video = document.getElementById('heroVideo');
  let videoDuration = 0;
  let videoReady = false;

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
  function getVideoKeyframes(){
    const dur = videoDuration || 0;
    const endFrame = Math.max(0, dur - 0.02);
    return [
      { p: 0,                t: 0 },
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
  navBurger.addEventListener('click', () => {
    navMobile.classList.toggle('open');
  });
  navMobile.querySelectorAll('a').forEach(a => {
    a.addEventListener('click', () => navMobile.classList.remove('open'));
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

  /* ---------- CTA form (demo only) ---------- */
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
