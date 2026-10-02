(function () {
  // Toggle off to test native scroll pacing without the wheel-pacing hijack below.
  const WHEEL_HIJACK_ENABLED = true;

  const scrolly = document.getElementById('exp-scrolly');
  if (!scrolly) return;

  const sticky = document.getElementById('exp-scrolly-sticky');
  const images = Array.from(scrolly.querySelectorAll('.exp-flicker-img'));
  const outlineItems = Array.from(scrolly.querySelectorAll('.exp-outline-item'));
  const zones = Array.from(scrolly.querySelectorAll('.exp-scroll-zone'));
  const titleEl = document.getElementById('exp-step-title');
  const textEl = document.getElementById('exp-step-text');
  const textBlock = textEl.closest('.exp-text-block');

  const steps = [
    {
      title: 'What does outcome-level reward miss?',
      text: 'Outcome-level rendering-based reinforcement learning, commonly used as a post-training step for image-to-code VLMs, aims to provide visual grounding for the generated code. By comparing the final rendered output to the target image, it assigns a single score per generation, weighting all tokens within a rollout equally.'
    },
    {
      title: 'Decisions in the generation trajectory',
      text: 'However, a program may contain both helpful and harmful decisions. In the example above, Rollouts 1 and 2 reach the same final quality through different trajectories, while Rollout 3 makes early progress that later operations reverse. Yet, a single outcome-level reward cannot distinguish such individual contributions, collapsing this information into a single scalar.'
    },
    {
      title: 'Render-progress reward',
      text: 'Our key observation is that the image-to-code generation trajectory exposes meaningful visual feedback. Intermediate prefixes can be rendered as partial programs, revealing how the reconstruction evolves toward the target. Based on this insight, we propose to use changes in visual score between consecutive renders (the arrows \\(\\Delta_j\\)) as a source of process supervision.'
    }
  ];

  let current = 0;
  let ticking = false;
  let navigating = false;
  let navigatingTimeout = null;

  function setActive(next) {
    if (next === current) return;
    images[current].classList.remove('is-active');
    images[next].classList.add('is-active');
    outlineItems[current].classList.remove('is-active');
    outlineItems[next].classList.add('is-active');

    const step = steps[next];
    if (titleEl) titleEl.textContent = step.title;
    if (textEl) {
      textEl.textContent = step.text;
      if (window.MathJax && window.MathJax.typesetPromise) {
        window.MathJax.typesetPromise([textEl]);
      }
    }

    current = next;
  }

  function triggerLine() {
    return sticky.getBoundingClientRect().bottom + 1;
  }

  function update() {
    ticking = false;
    if (navigating) return;
    const line = triggerLine();
    let next = 0;
    for (let i = 0; i < zones.length; i++) {
      const rect = zones[i].getBoundingClientRect();
      if (rect.top <= line) next = i;
    }
    setActive(next);
  }

  function requestUpdate() {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(update);
    }
  }

  // Steps have different amounts of text, which used to change the pinned
  // card's height as you moved between them. That made the gap to the next
  // section jump around, and made the scroll-margin used for click/keyboard
  // navigation go stale mid-interaction (landing on the wrong step). Locking
  // the text block to the tallest step's height keeps the card a fixed size.
  function lockTextBlockHeight() {
    if (!textBlock) return;
    const savedTitle = titleEl ? titleEl.textContent : '';
    const savedText = textEl.textContent;
    textBlock.style.minHeight = '';
    let max = 0;
    steps.forEach((step) => {
      if (titleEl) titleEl.textContent = step.title;
      textEl.textContent = step.text;
      max = Math.max(max, textBlock.getBoundingClientRect().height);
    });
    if (titleEl) titleEl.textContent = savedTitle;
    textEl.textContent = savedText;
    textBlock.style.minHeight = max + 'px';
  }

  function syncLayout() {
    lockTextBlockHeight();
    const stickyHeight = sticky.getBoundingClientRect().height;
    const offset = stickyHeight + 24;
    const available = Math.max(window.innerHeight - stickyHeight, 0);
    const zoneHeight = Math.max(15, Math.min(25, available * 0.015));
    zones.forEach((zone) => {
      zone.style.scrollMarginTop = offset + 'px';
      zone.style.minHeight = zoneHeight + 'px';
    });
  }

  // A click/keyboard jump can span multiple zones at once. The smooth-scroll
  // animation that follows physically passes through the zones in between,
  // and without this guard the scroll-position detector above would notice
  // those intermediate zones and flicker the image through each one before
  // landing on the target. So: set the target immediately, suppress the
  // detector for the duration of the animation, then let it resync once the
  // scroll actually settles (via the modern 'scrollend' event where
  // supported, with a fixed timeout as a fallback everywhere else).
  function goToStep(next) {
    if (next < 0 || next > zones.length - 1) return;
    navigating = true;
    clearTimeout(navigatingTimeout);
    setActive(next);
    zones[next].scrollIntoView({ behavior: 'smooth', block: 'start' });
    navigatingTimeout = setTimeout(endNavigation, 700);
  }

  function endNavigation() {
    clearTimeout(navigatingTimeout);
    navigating = false;
    update();
  }

  if ('onscrollend' in window) {
    window.addEventListener('scrollend', () => {
      if (navigating) endNavigation();
    });
  }

  function isEngaged() {
    return Math.abs(sticky.getBoundingClientRect().top - 24) < 2;
  }

  outlineItems.forEach((item) => {
    item.addEventListener('click', () => goToStep(Number(item.dataset.step)));
  });

  // Keyboard: while the card is pinned, treat arrow/page keys as discrete
  // step navigation instead of letting them scroll past a tiny zone's worth
  // of pixels (which could skip a step entirely).
  document.addEventListener('keydown', (e) => {
    const isDown = e.key === 'ArrowDown' || e.key === 'PageDown';
    const isUp = e.key === 'ArrowUp' || e.key === 'PageUp';
    if (!isDown && !isUp) return;
    if (!isEngaged()) return;
    const active = document.activeElement;
    if (active && ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(active.tagName)) return;
    const next = current + (isDown ? 1 : -1);
    if (next < 0 || next > zones.length - 1) return;
    e.preventDefault();
    goToStep(next);
  });

  // Mouse wheel / trackpad: only on devices with a precise pointer (desktop).
  // While pinned, accumulate wheel input and advance one step at a time once
  // enough has accumulated, instead of letting raw scroll distance (which is
  // deliberately kept small, to avoid extra white space) drive the step.
  // This stretches out the *feel* of the scroll without adding document
  // height. Touch devices are left on native scrolling.
  const canHijack = WHEEL_HIJACK_ENABLED && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  if (canHijack) {
    const WHEEL_STEP = 260;
    let wheelAccum = 0;

    window.addEventListener('wheel', (e) => {
      if (!isEngaged()) {
        wheelAccum = 0;
        return;
      }
      // Ignore stray near-zero deltas rather than letting them nudge direction.
      if (Math.abs(e.deltaY) < 1) return;

      wheelAccum += e.deltaY;
      // Direction comes from the net accumulated delta, not the latest event:
      // trackpads often emit a tiny reverse-sign delta at the tail of an
      // otherwise one-directional gesture, which previously could reset
      // progress or misfire a step in the wrong direction.
      const dir = wheelAccum > 0 ? 1 : -1;
      const next = current + dir;

      if (next < 0 || next > zones.length - 1) {
        // Would leave the pinned range in this direction — let native scroll
        // proceed instead of trapping the user.
        return;
      }

      e.preventDefault();
      if (Math.abs(wheelAccum) >= WHEEL_STEP) {
        wheelAccum = 0;
        setActive(next);
        zones[next].scrollIntoView({ behavior: 'instant', block: 'start' });
      }
    }, { passive: false });
  }

  window.addEventListener('scroll', requestUpdate, { passive: true });
  window.addEventListener('resize', () => {
    syncLayout();
    requestUpdate();
  });

  syncLayout();
  update();
})();
