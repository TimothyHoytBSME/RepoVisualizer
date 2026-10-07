const TYPING = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

export function attachControls(el, api) {
  const pts = new Map();
  let rect = el.getBoundingClientRect();
  let moved = false, sx0 = 0, sy0 = 0, timer = 0, longPress = false, pinch = null;
  const loc = e => [e.clientX - rect.left, e.clientY - rect.top];
  const pinchState = () => {
    const [a, b] = [...pts.values()];
    return { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2 - rect.left, my: (a.y + b.y) / 2 - rect.top };
  };

  el.addEventListener('pointerdown', e => {
    if (e.button > 0 || (e.target !== el && !(e.target instanceof HTMLCanvasElement))) return;
    rect = el.getBoundingClientRect();
    el.focus({ preventScroll: true });
    el.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 1) {
      moved = false; longPress = false;
      sx0 = e.clientX; sy0 = e.clientY;
      clearTimeout(timer);
      if (e.pointerType !== 'mouse') {
        const [lx, ly] = loc(e);
        timer = setTimeout(() => { if (!moved) { longPress = true; api.peekAt(lx, ly); } }, 420);
      }
    } else {
      clearTimeout(timer);
      moved = true;
      if (pts.size === 2) pinch = pinchState();
    }
  });

  el.addEventListener('pointermove', e => {
    const p = pts.get(e.pointerId);
    if (!p) {
      if (e.pointerType === 'mouse') { rect = el.getBoundingClientRect(); api.hoverAt(...loc(e)); }
      return;
    }
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (pts.size === 1) {
      if (!moved && Math.hypot(e.clientX - sx0, e.clientY - sy0) > 6) { moved = true; clearTimeout(timer); if (longPress) { api.peekEnd(); longPress = false; } }
      if (moved) api.pan(dx, dy);
    } else if (pts.size === 2 && pinch) {
      const q = pinchState();
      api.zoomAt(q.d / pinch.d, q.mx, q.my);
      api.pan(q.mx - pinch.mx, q.my - pinch.my);
      pinch = q;
    }
  });

  const up = e => {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    clearTimeout(timer);
    if (pts.size === 0) {
      if (longPress) api.peekEnd();
      else if (!moved && e.type === 'pointerup') api.tapAt(...loc(e), e.pointerType);
      longPress = false;
      pinch = null;
    } else if (pts.size === 1) pinch = null;
    else if (pts.size === 2) pinch = pinchState();
  };
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse' && !pts.size) api.hoverAt(-1, -1); });
  el.addEventListener('wheel', e => {
    e.preventDefault();
    rect = el.getBoundingClientRect();
    const k = e.deltaMode === 1 ? 0.05 : e.deltaMode === 2 ? 0.5 : 0.0015;
    api.zoomAt(Math.exp(-e.deltaY * k * (e.ctrlKey ? 4 : 1)), ...loc(e));
  }, { passive: false });
  el.addEventListener('contextmenu', e => e.preventDefault());
  let gs = 1;
  el.addEventListener('gesturestart', e => { e.preventDefault(); gs = e.scale || 1; rect = el.getBoundingClientRect(); });
  el.addEventListener('gesturechange', e => {
    e.preventDefault();
    const s = e.scale || 1;
    api.zoomAt(s / gs, e.clientX - rect.left, e.clientY - rect.top);
    gs = s;
  });
  el.addEventListener('gestureend', e => e.preventDefault());

  window.addEventListener('keydown', e => {
    const t = e.target;
    if (t && t !== el && (TYPING.has(t.tagName) || t.isContentEditable || t.closest?.('dialog'))) {
      if (e.key === 'Escape' && TYPING.has(t.tagName)) t.blur();
      return;
    }
    if (t && (t.tagName === 'BUTTON' || t.tagName === 'A' || t.tagName === 'SUMMARY') && (e.key === 'Enter' || e.key === ' ')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const P = 70;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const map = {
      ArrowLeft: () => (e.shiftKey ? api.pan(P, 0) : api.move(-1, 0)),
      ArrowRight: () => (e.shiftKey ? api.pan(-P, 0) : api.move(1, 0)),
      ArrowUp: () => (e.shiftKey ? api.pan(0, P) : api.move(0, -1)),
      ArrowDown: () => (e.shiftKey ? api.pan(0, -P) : api.move(0, 1)),
      a: () => api.pan(P, 0), d: () => api.pan(-P, 0), w: () => api.pan(0, P), s: () => api.pan(0, -P),
      Enter: () => api.activate(), ' ': () => api.activate(),
      '+': () => api.zoomAt(1.25), '=': () => api.zoomAt(1.25), '-': () => api.zoomAt(0.8), _: () => api.zoomAt(0.8),
      '[': () => api.depth(-1), ']': () => api.depth(1),
      '/': () => api.focusSearch(), Escape: () => api.escape(), Backspace: () => api.back(),
      c: () => api.recenter(), Home: () => api.recenter(), f: () => api.fit(), t: () => api.toggleTests(),
      p: () => api.togglePanel(), m: () => api.cycleMap(), o: () => api.openSource(),
    };
    const f = map[k];
    if (!f) return;
    e.preventDefault();
    f();
  });
}

export function makeGamepad(api) {
  const prev = [];
  const rep = [];
  let stickNav = 0;
  const dead = v => (Math.abs(v) < 0.18 ? 0 : (v - Math.sign(v) * 0.18) / 0.82);
  return function poll(now) {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let gp = null;
    for (const p of pads) if (p && p.connected) { gp = p; break; }
    if (!gp) return false;
    let active = false;
    const lx = dead(gp.axes[0] || 0), ly = dead(gp.axes[1] || 0);
    if (lx || ly) { api.pan(-lx * 16, -ly * 16); active = true; }
    const rx = gp.axes[2] || 0, ry = gp.axes[3] || 0;
    const mag = Math.hypot(rx, ry);
    if (mag > 0.6) {
      if (now - stickNav > 260) { stickNav = now; api.move(rx / mag, ry / mag); }
      active = true;
    } else stickNav = 0;
    const b = i => gp.buttons[i] ? gp.buttons[i].value || (gp.buttons[i].pressed ? 1 : 0) : 0;
    const zt = b(7) - b(6);
    if (Math.abs(zt) > 0.05) { api.zoomAt(Math.exp(zt * 0.04)); active = true; }
    const acts = {
      0: () => api.activate(), 1: () => api.back(), 10: () => api.recenter(), 11: () => api.recenter(), 2: () => api.togglePanel(), 3: () => api.cycleMap(),
      4: () => api.depth(-1), 5: () => api.depth(1), 8: () => api.fit(), 9: () => api.openSource(),
      12: () => api.move(0, -1), 13: () => api.move(0, 1), 14: () => api.move(-1, 0), 15: () => api.move(1, 0),
    };
    for (const i in acts) {
      const down = b(+i) > 0.5;
      if (down && !prev[i]) { acts[i](); rep[i] = now + 380; active = true; }
      else if (down && i >= 12 && now > rep[i]) { acts[i](); rep[i] = now + 140; active = true; }
      prev[i] = down;
    }
    return active || gp.buttons.some(x => x.pressed);
  };
}
