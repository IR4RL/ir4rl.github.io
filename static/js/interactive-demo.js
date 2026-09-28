// Interactive render-progress reward demo.
//
// Mirrors rl.visualize_path_rendering.compute_normalized_reward and the
// delta_t = reward_t - reward_{t-1} step used by rl.token_rewards
// .compute_token_deltas: each committed path segment is one "step", scored
// against a blank white canvas baseline, exactly like the paper's Delta_j.
(function () {
  const DISPLAY_SIZE = 440;
  const COMPUTE_SIZE = 96;
  const FILL_COLOR = '#FBB03B';
  const TARGET_SRC = 'static/images/star.png';

  const root = document.getElementById('interactive-demo');
  if (!root) return;

  const canvas = document.getElementById('demo-canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = DISPLAY_SIZE;
  canvas.height = DISPLAY_SIZE;

  const ghostToggle = document.getElementById('demo-ghost-toggle');
  const undoBtn = document.getElementById('demo-undo');
  const resetBtn = document.getElementById('demo-reset');
  const scoreEl = document.getElementById('demo-score');
  const stepEl = document.getElementById('demo-step');
  const plotSvg = document.getElementById('demo-plot');
  const codeEl = document.getElementById('demo-code');
  const hintEl = document.getElementById('demo-hint');
  const lineToolBtn = document.getElementById('demo-tool-line');
  const curveToolBtn = document.getElementById('demo-tool-curve');
  const pendingActionsEl = document.getElementById('demo-pending-actions');
  const confirmBtn = document.getElementById('demo-confirm');
  const dragHandleEl = document.getElementById('demo-drag-handle');
  const canvasWrapEl = canvas.parentElement;
  const finishBtn = document.getElementById('demo-finish');
  const outcomeEl = document.getElementById('demo-outcome');
  const outcomeValueEl = document.getElementById('demo-outcome-value');

  // Coarse (touch) pointers get a bigger hit zone and a bigger drawn dot for
  // the bezier handles — a fingertip is far less precise than a mouse cursor.
  // Mouse/trackpad users get exactly the original values, unchanged.
  const IS_COARSE_POINTER = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  const HANDLE_HIT_R = IS_COARSE_POINTER ? 20 : 11;
  const HANDLE_DRAW_R = IS_COARSE_POINTER ? 10 : 6;
  const HINT_DEFAULT = 'Click to place your first point, then keep clicking to add segments.';
  const HINT_PENDING = 'Drag the handles to shape the curve, then confirm to score the step.';
  const HINT_CONCLUDED = 'Drawing complete — see the outcome reward on the right. Click Reset to start over.';

  // The target canvas is a real, visible panel (always-on reference so the
  // ghost overlay toggle is optional, not load-bearing). scoreCanvas is an
  // offscreen scratch buffer for the current committed path — no ghost
  // overlay, no pending-segment preview, just what would actually render.
  const targetCanvas = document.getElementById('demo-target-canvas');
  targetCanvas.width = DISPLAY_SIZE;
  targetCanvas.height = DISPLAY_SIZE;
  const targetCtx = targetCanvas.getContext('2d');

  const scoreCanvas = document.createElement('canvas');
  scoreCanvas.width = DISPLAY_SIZE;
  scoreCanvas.height = DISPLAY_SIZE;
  const scoreCtx = scoreCanvas.getContext('2d');

  const computeCanvas = document.createElement('canvas');
  computeCanvas.width = COMPUTE_SIZE;
  computeCanvas.height = COMPUTE_SIZE;
  const computeCtx = computeCanvas.getContext('2d');

  let targetNorm = null; // Float32Array, pre-normalized target pixels
  let baselineReward = 0;

  // path: [{x,y}] or [{x,y,type:'C',c1:{x,y},c2:{x,y}}] in canvas pixel
  // space. First point is the pen-down (M); every point after that is an
  // already-committed L or C segment endpoint.
  let path = [];
  let history = []; // [{reward, delta}], index 0 = blank-canvas baseline
  let hoverPoint = null; // live rubber-band cursor position while drawing

  let tool = 'line'; // 'line' | 'curve'
  let pending = null; // {x,y,c1:{x,y},c2:{x,y}} — an uncommitted curve segment
  let draggingHandle = null; // 'c1' | 'c2' | null
  let concluded = false; // true once "Finish Drawing" has locked in the outcome

  // ---------------------------------------------------------------------
  // Math: exact port of visualize_path_rendering.compute_normalized_reward
  // ---------------------------------------------------------------------
  function meanStd(arr) {
    let sum = 0;
    for (let i = 0; i < arr.length; i++) sum += arr[i];
    const mean = sum / arr.length;
    let sq = 0;
    for (let i = 0; i < arr.length; i++) {
      const d = arr[i] - mean;
      sq += d * d;
    }
    const std = Math.sqrt(sq / arr.length);
    return { mean, std };
  }

  function normalizePixels(arr) {
    const { mean, std } = meanStd(arr);
    if (std < 0.01) return null;
    const out = new Float32Array(arr.length);
    for (let i = 0; i < arr.length; i++) out[i] = (arr[i] - mean) / std;
    return out;
  }

  function imageDataToFloatRGB(imgData) {
    const { data } = imgData;
    const n = data.length / 4;
    const out = new Float32Array(n * 3);
    for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
      out[j] = data[i] / 255;
      out[j + 1] = data[i + 1] / 255;
      out[j + 2] = data[i + 2] / 255;
    }
    return out;
  }

  function computeNormalizedReward(renderedNorm, precomputedTargetNorm) {
    if (renderedNorm === null || precomputedTargetNorm === null) return -1;
    const n = renderedNorm.length;
    let l2sq = 0;
    for (let i = 0; i < n; i++) {
      const d = renderedNorm[i] - precomputedTargetNorm[i];
      l2sq += d * d;
    }
    let reward = 1 - l2sq / n;
    if (reward > 1) reward = 1;
    if (reward < -1) reward = -1;
    return reward;
  }

  function downsampleToComputeArray(bigCanvas) {
    computeCtx.clearRect(0, 0, COMPUTE_SIZE, COMPUTE_SIZE);
    computeCtx.drawImage(bigCanvas, 0, 0, DISPLAY_SIZE, DISPLAY_SIZE, 0, 0, COMPUTE_SIZE, COMPUTE_SIZE);
    const imgData = computeCtx.getImageData(0, 0, COMPUTE_SIZE, COMPUTE_SIZE);
    return imageDataToFloatRGB(imgData);
  }

  // ---------------------------------------------------------------------
  // Rendering: fill white, then the committed path (matches cairosvg's
  // background_color="white" + a filled <path>).
  // ---------------------------------------------------------------------
  function paintPath(targetCtxRef, pts, extra) {
    targetCtxRef.fillStyle = '#ffffff';
    targetCtxRef.fillRect(0, 0, DISPLAY_SIZE, DISPLAY_SIZE);
    if (pts.length >= 2) {
      targetCtxRef.beginPath();
      targetCtxRef.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) {
        const p = pts[i];
        if (p.type === 'C') {
          targetCtxRef.bezierCurveTo(p.c1.x, p.c1.y, p.c2.x, p.c2.y, p.x, p.y);
        } else {
          targetCtxRef.lineTo(p.x, p.y);
        }
      }
      targetCtxRef.closePath();
      targetCtxRef.fillStyle = FILL_COLOR;
      targetCtxRef.fill('nonzero');
      targetCtxRef.lineWidth = 1.5;
      targetCtxRef.strokeStyle = 'rgba(0,0,0,0.25)';
      targetCtxRef.stroke();
    }
    if (extra) extra(targetCtxRef);
  }

  function scoreCurrentPath() {
    paintPath(scoreCtx, path);
    if (path.length < 2) return baselineReward === undefined ? -1 : baselineReward;
    const renderedArr = downsampleToComputeArray(scoreCanvas);
    const renderedNorm = normalizePixels(renderedArr);
    return computeNormalizedReward(renderedNorm, targetNorm);
  }

  function drawDisplayCanvas() {
    paintPath(ctx, path, (c) => {
      if (ghostToggle.checked) {
        c.save();
        c.globalAlpha = 0.16;
        c.drawImage(targetCanvas, 0, 0);
        c.restore();
      }

      // Committed anchor points
      c.fillStyle = 'rgba(26,86,196,0.9)';
      for (let i = 0; i < path.length; i++) {
        c.beginPath();
        c.arc(path[i].x, path[i].y, 4, 0, Math.PI * 2);
        c.fill();
      }
      if (path.length > 0) {
        const start = path[0];
        c.strokeStyle = '#1a56c4';
        c.lineWidth = 2;
        c.beginPath();
        c.arc(start.x, start.y, 6, 0, Math.PI * 2);
        c.stroke();
      }

      // Rubber-band preview line to the cursor (only while choosing where
      // the next segment ends — not while a curve is already pending).
      if (path.length > 0 && hoverPoint && !pending) {
        const last = path[path.length - 1];
        c.setLineDash([5, 4]);
        c.strokeStyle = 'rgba(26,86,196,0.6)';
        c.lineWidth = 1.5;
        c.beginPath();
        c.moveTo(last.x, last.y);
        c.lineTo(hoverPoint.x, hoverPoint.y);
        c.stroke();
        c.setLineDash([]);
      }

      // Pending curve: dashed preview + draggable control handles.
      if (pending) {
        const start = path[path.length - 1];

        c.setLineDash([4, 4]);
        c.strokeStyle = 'rgba(26,86,196,0.75)';
        c.lineWidth = 1.8;
        c.beginPath();
        c.moveTo(start.x, start.y);
        c.bezierCurveTo(pending.c1.x, pending.c1.y, pending.c2.x, pending.c2.y, pending.x, pending.y);
        c.stroke();
        c.setLineDash([]);

        // Guide lines from each anchor to its own handle.
        c.strokeStyle = 'rgba(26,86,196,0.3)';
        c.lineWidth = 1;
        c.beginPath();
        c.moveTo(start.x, start.y);
        c.lineTo(pending.c1.x, pending.c1.y);
        c.moveTo(pending.x, pending.y);
        c.lineTo(pending.c2.x, pending.c2.y);
        c.stroke();

        // Pending endpoint marker.
        c.fillStyle = 'rgba(26,86,196,0.9)';
        c.beginPath();
        c.arc(pending.x, pending.y, 4, 0, Math.PI * 2);
        c.fill();

        // Draggable handle dots.
        [pending.c1, pending.c2].forEach((h) => {
          c.beginPath();
          c.arc(h.x, h.y, HANDLE_DRAW_R, 0, Math.PI * 2);
          c.fillStyle = '#ffffff';
          c.fill();
          c.lineWidth = 2;
          c.strokeStyle = '#1a56c4';
          c.stroke();
        });
      }
    });
  }

  // ---------------------------------------------------------------------
  // Stats + plot
  // ---------------------------------------------------------------------
  function fmt(v) {
    return (v >= 0 ? '+' : '') + v.toFixed(3);
  }

  const SUBSCRIPT_DIGITS = ['₀', '₁', '₂', '₃', '₄', '₅', '₆', '₇', '₈', '₉'];
  function toSubscript(n) {
    return String(n).split('').map((d) => SUBSCRIPT_DIGITS[+d] ?? d).join('');
  }

  function updateStats() {
    const last = history[history.length - 1];
    scoreEl.textContent = last.reward.toFixed(3);
    stepEl.textContent = String(history.length - 1);
  }

  const PLOT_W = 400;
  const PLOT_H = 260;
  const PAD_L = 30;
  const PAD_R = 14;
  const PAD_T = 14;
  const PAD_B = 24;

  function svgEl(tag, attrs) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    return el;
  }

  function renderPlot() {
    plotSvg.setAttribute('viewBox', `0 0 ${PLOT_W} ${PLOT_H}`);
    plotSvg.innerHTML = '';

    if (history.length < 2) {
      const txt = svgEl('text', {
        x: PLOT_W / 2, y: PLOT_H / 2, 'text-anchor': 'middle', class: 'demo-plot-empty',
      });
      txt.textContent = 'Add a segment to start the reward curve.';
      plotSvg.appendChild(txt);
      drawAxes([-1, 1]);
      return;
    }

    const rewards = history.map((h) => h.reward);
    const yMin = -1, yMax = 1;
    const innerW = PLOT_W - PAD_L - PAD_R;
    const innerH = PLOT_H - PAD_T - PAD_B;
    const n = history.length;
    const xFor = (i) => PAD_L + (n === 1 ? 0 : (i / (n - 1)) * innerW);
    const yFor = (v) => PAD_T + innerH - ((v - yMin) / (yMax - yMin)) * innerH;

    drawAxes([yMin, 0, yMax]);

    // Arrow marker defs, one per color so each segment can point the right way.
    const defs = svgEl('defs', {});
    ['green', 'red', 'neutral'].forEach((name) => {
      const marker = svgEl('marker', {
        id: `demo-arrow-${name}`, viewBox: '0 0 10 10', refX: '8', refY: '5',
        markerWidth: '7', markerHeight: '7', orient: 'auto-start-reverse',
      });
      const color = name === 'green' ? 'var(--demo-green)' : name === 'red' ? 'var(--demo-red)' : 'var(--demo-neutral)';
      marker.appendChild(svgEl('path', { d: 'M0,0 L10,5 L0,10 z', fill: color }));
      defs.appendChild(marker);
    });
    plotSvg.appendChild(defs);

    for (let i = 1; i < n; i++) {
      const delta = history[i].delta;
      const colorName = delta > 1e-9 ? 'green' : delta < -1e-9 ? 'red' : 'neutral';
      const colorVar = `var(--demo-${colorName})`;
      const x1 = xFor(i - 1), y1 = yFor(rewards[i - 1]);
      const x2 = xFor(i), y2 = yFor(rewards[i]);

      // Shorten the line slightly so the arrowhead doesn't overlap the point.
      const dx = x2 - x1, dy = y2 - y1;
      const len = Math.hypot(dx, dy) || 1;
      const shrink = 7;
      const ex = x2 - (dx / len) * shrink;
      const ey = y2 - (dy / len) * shrink;

      plotSvg.appendChild(svgEl('line', {
        x1, y1, x2: ex, y2: ey, stroke: colorVar, 'stroke-width': 2.2,
        'marker-end': `url(#demo-arrow-${colorName})`,
      }));

      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2 - 6;
      const label = svgEl('text', {
        x: mx, y: my, 'text-anchor': 'middle', class: 'demo-delta-label', fill: colorVar,
      });
      label.textContent = `Δ${toSubscript(i)} ${fmt(delta)}`;
      plotSvg.appendChild(label);
    }

    for (let i = 0; i < n; i++) {
      const isLast = i === n - 1;
      plotSvg.appendChild(svgEl('circle', {
        cx: xFor(i), cy: yFor(rewards[i]), r: isLast ? 5 : 3.2,
        fill: isLast ? '#1a56c4' : '#ffffff',
        stroke: '#1a56c4', 'stroke-width': isLast ? 0 : 1.6,
      }));
    }
  }

  function drawAxes(yTicks) {
    const innerW = PLOT_W - PAD_L - PAD_R;
    const innerH = PLOT_H - PAD_T - PAD_B;
    const yMin = -1, yMax = 1;
    const yFor = (v) => PAD_T + innerH - ((v - yMin) / (yMax - yMin)) * innerH;

    plotSvg.appendChild(svgEl('line', {
      x1: PAD_L, y1: PAD_T, x2: PAD_L, y2: PAD_T + innerH, stroke: 'var(--color-card-border)', 'stroke-width': 1,
    }));
    plotSvg.appendChild(svgEl('line', {
      x1: PAD_L, y1: PAD_T + innerH, x2: PAD_L + innerW, y2: PAD_T + innerH, stroke: 'var(--color-card-border)', 'stroke-width': 1,
    }));

    yTicks.forEach((v) => {
      const y = yFor(v);
      plotSvg.appendChild(svgEl('line', {
        x1: PAD_L, y1: y, x2: PAD_L + innerW, y2: y,
        stroke: v === 0 ? 'var(--color-card-border)' : 'transparent', 'stroke-width': 1, 'stroke-dasharray': '3,3',
      }));
      const t = svgEl('text', { x: PAD_L - 6, y: y + 3, 'text-anchor': 'end', class: 'demo-axis-label' });
      t.textContent = v.toFixed(0);
      plotSvg.appendChild(t);
    });

    const stepLabel = svgEl('text', {
      x: PAD_L + innerW / 2, y: PLOT_H - 4, 'text-anchor': 'middle', class: 'demo-axis-label',
    });
    stepLabel.textContent = 'Step';
    plotSvg.appendChild(stepLabel);
  }

  // ---------------------------------------------------------------------
  // Generated-code strip: <svg><path d="M x y L x y ..." — coordinates are
  // rounded to int (matching how OmniSVG tokenizes path coordinates), and
  // the most recently committed command is highlighted, echoing the
  // old/new bold-text convention in visualize_path_rendering.py's own viz.
  // ---------------------------------------------------------------------
  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function hexToRgbString(hex) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgb(${r},${g},${b})`;
  }

  const CODE_PREFIX = `<svg><path fill="${hexToRgbString(FILL_COLOR)}" d="`;

  function updateCode() {
    const prefix = CODE_PREFIX;
    if (path.length === 0) {
      codeEl.innerHTML = `<span class="code-muted">${escapeHtml(prefix)}</span>`;
    } else {
      const commands = path.map((p, i) => {
        if (i === 0) return `M ${p.x} ${p.y}`;
        if (p.type === 'C') return `C ${p.c1.x} ${p.c1.y} ${p.c2.x} ${p.c2.y} ${p.x} ${p.y}`;
        return `L ${p.x} ${p.y}`;
      });
      const last = commands.pop();
      const mutedText = prefix + (commands.length ? commands.join(' ') + ' ' : '');
      codeEl.innerHTML =
        `<span class="code-muted">${escapeHtml(mutedText)}</span>` +
        `<span class="code-new">${escapeHtml(last)}</span>`;
    }
    const wrap = codeEl.parentElement;
    // Roll to the tail to reveal the newest command — except with nothing
    // committed yet, where there's no "newest" and the opening tag itself
    // is what matters, especially once it's wider than a narrow viewport.
    wrap.scrollLeft = path.length === 0 ? 0 : wrap.scrollWidth;
  }

  // ---------------------------------------------------------------------
  // Commit / undo / reset
  // ---------------------------------------------------------------------
  function commitPoint(pt) {
    const rounded = pt.type === 'C'
      ? {
          type: 'C',
          x: Math.round(pt.x), y: Math.round(pt.y),
          c1: { x: Math.round(pt.c1.x), y: Math.round(pt.c1.y) },
          c2: { x: Math.round(pt.c2.x), y: Math.round(pt.c2.y) },
        }
      : { x: Math.round(pt.x), y: Math.round(pt.y) };
    path.push(rounded);
    const reward = scoreCurrentPath();
    const prev = history[history.length - 1].reward;
    history.push({ reward, delta: reward - prev });
    hoverPoint = null;
    drawDisplayCanvas();
    updateStats();
    renderPlot();
    updateCode();
    updateFinishAvailability();
  }

  function undo() {
    if (pending || concluded || path.length === 0) return;
    path.pop();
    history.pop();
    hoverPoint = null;
    drawDisplayCanvas();
    updateStats();
    renderPlot();
    updateCode();
    updateFinishAvailability();
  }

  function reset() {
    if (pending) return;
    path = [];
    history = [{ reward: baselineReward, delta: 0 }];
    hoverPoint = null;
    concluded = false;
    outcomeEl.hidden = true;
    lineToolBtn.disabled = false;
    curveToolBtn.disabled = false;
    undoBtn.disabled = false;
    canvas.classList.remove('is-locked');
    hintEl.textContent = HINT_DEFAULT;
    drawDisplayCanvas();
    updateStats();
    renderPlot();
    updateCode();
    updateFinishAvailability();
  }

  function updateFinishAvailability() {
    finishBtn.disabled = !!pending || concluded || path.length < 2;
  }

  function finishDrawing() {
    if (pending || concluded || path.length < 2) return;
    concluded = true;
    const outcome = history[history.length - 1].reward;
    outcomeValueEl.textContent = outcome.toFixed(3);
    outcomeEl.hidden = false;
    lineToolBtn.disabled = true;
    curveToolBtn.disabled = true;
    undoBtn.disabled = true;
    canvas.classList.add('is-locked');
    hintEl.textContent = HINT_CONCLUDED;
    updateFinishAvailability();
  }

  // ---------------------------------------------------------------------
  // Tool switching + pending-segment state machine
  // ---------------------------------------------------------------------
  function setControlsDisabled(disabled) {
    lineToolBtn.disabled = disabled;
    curveToolBtn.disabled = disabled;
    undoBtn.disabled = disabled;
    resetBtn.disabled = disabled;
    updateFinishAvailability();
  }

  function setTool(next) {
    if (pending) return;
    tool = next;
    lineToolBtn.classList.toggle('is-active', tool === 'line');
    curveToolBtn.classList.toggle('is-active', tool === 'curve');
  }

  function startPendingCurve(endPt) {
    const start = path[path.length - 1];
    const dx = endPt.x - start.x;
    const dy = endPt.y - start.y;
    const len = Math.hypot(dx, dy) || 1;
    // Bow the default handles off the straight line (rather than placing
    // them collinear at 1/3 and 2/3) so the curve visibly isn't just a
    // line — it signals right away that the handles are there to drag.
    const nx = -dy / len;
    const ny = dx / len;
    const bow = Math.min(Math.max(len * 0.18, 14), 45);
    pending = {
      x: endPt.x, y: endPt.y,
      c1: { x: start.x + dx / 3 + nx * bow, y: start.y + dy / 3 + ny * bow },
      c2: { x: start.x + dx * 2 / 3 + nx * bow, y: start.y + dy * 2 / 3 + ny * bow },
    };
    hoverPoint = null;
    pendingActionsEl.hidden = false;
    resetPendingActionsPosition();
    hintEl.textContent = HINT_PENDING;
    setControlsDisabled(true);
    drawDisplayCanvas();
  }

  function resetPendingActionsPosition() {
    pendingActionsEl.style.left = '';
    pendingActionsEl.style.top = '';
    pendingActionsEl.style.bottom = '';
    pendingActionsEl.style.transform = '';
  }

  function confirmPending() {
    if (!pending) return;
    const segment = { type: 'C', x: pending.x, y: pending.y, c1: pending.c1, c2: pending.c2 };
    pending = null;
    pendingActionsEl.hidden = true;
    hintEl.textContent = HINT_DEFAULT;
    setControlsDisabled(false);
    commitPoint(segment);
  }

  function handleHitTest(pt) {
    if (!pending) return null;
    for (const key of ['c1', 'c2']) {
      const h = pending[key];
      if (Math.hypot(pt.x - h.x, pt.y - h.y) <= HANDLE_HIT_R) return key;
    }
    return null;
  }

  // ---------------------------------------------------------------------
  // Pointer interaction (mouse + touch, unified)
  // ---------------------------------------------------------------------
  function canvasPointFromEvent(evt) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = DISPLAY_SIZE / rect.width;
    const scaleY = DISPLAY_SIZE / rect.height;
    return {
      x: Math.max(0, Math.min(DISPLAY_SIZE, (evt.clientX - rect.left) * scaleX)),
      y: Math.max(0, Math.min(DISPLAY_SIZE, (evt.clientY - rect.top) * scaleY)),
    };
  }

  canvas.addEventListener('pointerdown', (evt) => {
    if (concluded) return;
    const pt = canvasPointFromEvent(evt);

    if (pending) {
      const hit = handleHitTest(pt);
      if (hit) {
        draggingHandle = hit;
        canvas.setPointerCapture(evt.pointerId);
      }
      return;
    }

    if (path.length === 0) {
      commitPoint(pt);
      return;
    }

    if (tool === 'curve') {
      startPendingCurve(pt);
    } else {
      commitPoint(pt);
    }
  });

  canvas.addEventListener('pointermove', (evt) => {
    const pt = canvasPointFromEvent(evt);
    if (draggingHandle && pending) {
      pending[draggingHandle] = pt;
      drawDisplayCanvas();
      return;
    }
    if (!concluded && path.length > 0 && !pending) {
      hoverPoint = pt;
      drawDisplayCanvas();
    }
  });

  canvas.addEventListener('pointerup', (evt) => {
    if (draggingHandle) {
      draggingHandle = null;
      try { canvas.releasePointerCapture(evt.pointerId); } catch (e) { /* already released */ }
    }
  });

  canvas.addEventListener('pointerleave', () => {
    if (!draggingHandle) {
      hoverPoint = null;
      drawDisplayCanvas();
    }
  });

  lineToolBtn.addEventListener('click', () => setTool('line'));
  curveToolBtn.addEventListener('click', () => setTool('curve'));
  confirmBtn.addEventListener('click', confirmPending);
  undoBtn.addEventListener('click', undo);
  resetBtn.addEventListener('click', reset);
  finishBtn.addEventListener('click', finishDrawing);
  ghostToggle.addEventListener('change', drawDisplayCanvas);

  // ---------------------------------------------------------------------
  // Drag-to-reposition the pending-segment pill, so it can be moved off
  // whatever part of the curve it happens to be covering.
  // ---------------------------------------------------------------------
  let pillDrag = null;

  dragHandleEl.addEventListener('pointerdown', (evt) => {
    const wrapRect = canvasWrapEl.getBoundingClientRect();
    const pillRect = pendingActionsEl.getBoundingClientRect();
    pillDrag = {
      pointerId: evt.pointerId,
      offsetX: evt.clientX - pillRect.left,
      offsetY: evt.clientY - pillRect.top,
      wrapRect,
    };
    pendingActionsEl.style.transform = 'none';
    pendingActionsEl.style.bottom = 'auto';
    pendingActionsEl.style.left = `${pillRect.left - wrapRect.left}px`;
    pendingActionsEl.style.top = `${pillRect.top - wrapRect.top}px`;
    pendingActionsEl.classList.add('is-dragging');
    dragHandleEl.setPointerCapture(evt.pointerId);
    evt.preventDefault();
  });

  dragHandleEl.addEventListener('pointermove', (evt) => {
    if (!pillDrag || evt.pointerId !== pillDrag.pointerId) return;
    const { wrapRect, offsetX, offsetY } = pillDrag;
    const pillW = pendingActionsEl.offsetWidth;
    const pillH = pendingActionsEl.offsetHeight;
    const left = Math.max(4, Math.min(wrapRect.width - pillW - 4, evt.clientX - wrapRect.left - offsetX));
    const top = Math.max(4, Math.min(wrapRect.height - pillH - 4, evt.clientY - wrapRect.top - offsetY));
    pendingActionsEl.style.left = `${left}px`;
    pendingActionsEl.style.top = `${top}px`;
  });

  dragHandleEl.addEventListener('pointerup', (evt) => {
    if (pillDrag && evt.pointerId === pillDrag.pointerId) {
      pillDrag = null;
      pendingActionsEl.classList.remove('is-dragging');
      try { dragHandleEl.releasePointerCapture(evt.pointerId); } catch (e) { /* already released */ }
    }
  });

  // ---------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------
  const targetImg = new Image();
  targetImg.onload = () => {
    targetCtx.fillStyle = '#ffffff';
    targetCtx.fillRect(0, 0, DISPLAY_SIZE, DISPLAY_SIZE);
    targetCtx.drawImage(targetImg, 0, 0, DISPLAY_SIZE, DISPLAY_SIZE);

    const targetArr = downsampleToComputeArray(targetCanvas);
    targetNorm = normalizePixels(targetArr);

    // Baseline: blank white canvas vs target.
    const blankArr = new Float32Array(COMPUTE_SIZE * COMPUTE_SIZE * 3).fill(1);
    baselineReward = computeNormalizedReward(normalizePixels(blankArr), targetNorm);

    history = [{ reward: baselineReward, delta: 0 }];
    drawDisplayCanvas();
    updateStats();
    renderPlot();
    updateCode();
    updateFinishAvailability();
  };
  targetImg.src = TARGET_SRC;
})();
