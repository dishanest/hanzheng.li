import * as THREE from "three";
import { photos, openingPhoto } from "./photos";
import { layout } from "./layout";
import { makeMaterials } from "./frames";
import { hang, updateLift, type Hung } from "./wall";

const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const coarse = matchMedia("(pointer: coarse)").matches;
const photoInfo = document.getElementById("photo-info")!;
const nameEl = document.querySelector<SVGSVGElement>(".name")!;
const captionEl = document.getElementById("caption")!;

// ---------- accessible + fallback content ----------
const describe = (p: (typeof photos)[number]) =>
  [p.title, p.camera, p.film ? `${p.film} film` : "", p.place, String(p.year)].filter(Boolean).join(", ") || "Photograph";
// Images only get a src when the fallback is shown, so the WebGL page does not fetch every photo twice.
const list = document.getElementById("photo-list")!;
for (const p of photos) {
  const li = document.createElement("li");
  li.innerHTML = `<img data-src="${import.meta.env.BASE_URL}photos/${p.file}" alt="${describe(p)}" width="${p.w}" height="${p.h}"><span>${describe(p)}</span>`;
  list.appendChild(li);
}

let stopped = false; // set when the fallback takes over, ends the render loop

function showFallback(why: unknown) {
  console.warn("Showing the plain gallery:", why);
  document.documentElement.classList.add("no-webgl");
  document.documentElement.classList.remove("zoomed");
  stopped = true;
  document.getElementById("wall")?.remove();
  list.querySelectorAll<HTMLImageElement>("img[data-src]").forEach((img) => { img.loading = "lazy"; img.src = img.dataset.src!; });
}

try {
  init();
} catch (err) {
  showFallback(err);
}

function init() {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  if (!renderer.capabilities.isWebGL2) throw new Error("WebGL2 required");

  // ---------- renderer, scene, camera ----------
  const canvas = renderer.domElement;
  canvas.id = "wall";
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", "A wall of framed photographs by Han Li");
  canvas.tabIndex = 0;
  document.body.prepend(canvas);
  renderer.setClearColor(0xffffff, 1);
  canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); showFallback("WebGL context lost"); });

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xffffff);
  // Gallery lighting: one key from high upper-left at a raking angle, so the frame edges and mat
  // bevels get real light-to-dark gradients, plus a soft fill.
  renderer.toneMapping = THREE.NeutralToneMapping; // filmic roll-off that keeps base colours
  const key = new THREE.DirectionalLight(0xfffaf4, 3.0);
  key.position.set(-0.55, 0.83, 0.55);
  scene.add(key);
  scene.add(new THREE.HemisphereLight(0xffffff, 0xf0eeea, 0.45));

  const FOV = 14;
  const camera = new THREE.PerspectiveCamera(FOV, 1, 10, 20000);
  const tanHalf = Math.tan(THREE.MathUtils.degToRad(FOV / 2));

  THREE.Cache.enabled = true;
  const loader = new THREE.TextureLoader();
  const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const mats = makeMaterials(loader);
  const { items, bounds } = layout(photos, openingPhoto);
  let dirty = true;
  const hung: Hung[] = hang(items, mats, loader, maxAniso, () => { dirty = true; });
  for (const h of hung) { scene.add(h.group); scene.add(h.shadow); }
  // the wall fades in once its textures are in (or after 4 s, whichever is first)
  let assetsReady = false, shownWall = false;
  THREE.DefaultLoadingManager.onLoad = () => { assetsReady = true; dirty = true; };
  setTimeout(() => { assetsReady = true; dirty = true; }, 4000);
  THREE.DefaultLoadingManager.onProgress = () => { dirty = true; };

  // ---------- view state ----------
  let vw = 1, vh = 1, dpr = 1;
  let nameH = 0; // on-screen height of HAN LI, css px
  let reserveBottom = 0; // name + caption row, css px
  let reserveFocused = 0; // caption only, css px
  const view = { x: 0, y: 0, vis: 1150 }; // vis = wall units visible vertically
  const raw = { x: 0, y: 0 }; // position the input drives; may sit past the bounds while rubber-banding
  let baseVis = 1150;
  let lastInput = 0;
  let zoomed: Hung | null = null;
  let wheelGuardUntil = 0; // swallow trackpad inertia right after a zoom
  // `to.x/y` undefined = only zoom animates, panning stays live
  let anim: { from: typeof view; to: { x?: number; y?: number; vis: number }; t0: number; dur: number; smooth?: boolean } | null = null;
  let introTo: { x: number; y: number; vis: number } | null = null; // resting view the opening zoom lands on
  let mouse: { x: number; y: number } | null = null;

  function overviewVis() {
    // laptop: about a third of the height per frame; phone portrait: 2-3 frames across
    return vw / vh < 0.8 ? (820 * vh) / vw : 1150;
  }
  function unitsPerPx(vis = view.vis) { return vis / vh; }

  function limits(vis = view.vis) {
    const halfW = (vis * vw) / vh / 2, halfH = vis / 2;
    // the name and caption cover the bottom of the screen; let the wall scroll up past them
    const nameUnits = reserveBottom * unitsPerPx(vis);
    const lim = {
      minX: bounds.minX + halfW, maxX: bounds.maxX - halfW,
      minY: bounds.minY + halfH - nameUnits, maxY: bounds.maxY - halfH,
      halfW, halfH,
    };
    if (lim.minX > lim.maxX) lim.minX = lim.maxX = (bounds.minX + bounds.maxX) / 2;
    if (lim.minY > lim.maxY) lim.minY = lim.maxY = (bounds.minY + bounds.maxY) / 2;
    return lim;
  }

  // ---------- resize (batched to one per frame) ----------
  let resizeQueued = false;
  function queueResize() {
    if (resizeQueued) return;
    resizeQueued = true;
    requestAnimationFrame(() => { resizeQueued = false; resize(); });
  }
  function resize() {
    vw = window.innerWidth; vh = window.innerHeight;
    // 1.5x: the type is HTML, so the canvas only draws the wall; ~45% fewer pixels than 2x
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    renderer.setPixelRatio(dpr);
    renderer.setSize(vw, vh, false);
    canvas.style.width = vw + "px"; canvas.style.height = vh + "px";
    camera.aspect = vw / vh;
    nameH = nameEl.getBoundingClientRect().height;
    // room for three caption lines above the name, whichever text is showing
    const lineH = parseFloat(getComputedStyle(captionEl).lineHeight) || 19;
    reserveBottom = nameH + 14 + lineH * 3 + 18;
    // while a photo is focused the name has sunk away: only the caption (now in the corner) needs room
    reserveFocused = Math.min(26, Math.max(14, vw * 0.02)) + lineH * 3 + 18 + (coarse ? 30 : 0); // phones: home-indicator inset
    baseVis = overviewVis();
    if (introTo && !anim) { setupOpening(); dirty = true; return; } // opening not started yet: re-plan it for the new size
    if (anim?.smooth) {
      // The opening zoom survives resizes (Safari fires one when the web font arrives, which
      // used to cut the zoom short): re-aim it, and re-plan the start if it has not begun.
      anim.to = restingView();
      if (performance.now() < anim.t0) { anim.from = wholeWallView(); Object.assign(view, anim.from); raw.x = view.x; raw.y = view.y; }
      dirty = true;
      return;
    }
    anim = null;
    if (zoomed) Object.assign(view, zoomTarget(zoomed));
    else view.vis = baseVis;
    // drop any stretch: restart from the clamped position at the new size
    bounce.x = bounce.y = null;
    raw.x = view.x; raw.y = view.y;
    if (!zoomed) { clampRaw(); applyRaw(); }
    dirty = true;
  }

  // ---------- panning ----------
  function rubber(over: number, dim: number) {
    // the further past the edge, the harder it resists, but it never stops: logarithmic, no ceiling
    return 0.55 * dim * Math.log1p(over / dim);
  }
  /** Inverse of rubber(): how far raw must be past the edge to show `shown` of overshoot. */
  function unrubber(shown: number, dim: number) {
    return dim * Math.expm1(shown / (0.55 * dim));
  }

  function applyRaw() {
    const L = limits();
    const fx = (v: number, lo: number, hi: number, dim: number) =>
      reduceMotion ? Math.min(hi, Math.max(lo, v)) : v < lo ? lo - rubber(lo - v, dim) : v > hi ? hi + rubber(v - hi, dim) : v;
    view.x = fx(raw.x, L.minX, L.maxX, L.halfW);
    view.y = fx(raw.y, L.minY, L.maxY, L.halfH);
    dirty = true;
  }

  function panBy(dxPx: number, dyPx: number) {
    if (zoomed) leaveZoom(false);
    if (anim?.smooth || introTo) {
      // the user took over during the opening zoom: keep their position, settle the scale
      anim = null; introTo = null;
      raw.x = view.x; raw.y = view.y;
      settleRaw();
      animateTo({ vis: baseVis });
    }
    const u = unitsPerPx();
    const now = performance.now();
    // input velocity (wall units / s), smoothed; the bounce starts with it, as on iOS
    const gap = Math.max(4, Math.min(100, now - lastInput));
    const k = gap >= 100 ? 1 : 0.5;
    vel.x += ((dxPx * u * 1000) / gap - vel.x) * k;
    vel.y += ((-dyPx * u * 1000) / gap - vel.y) * k;
    raw.x += dxPx * u;
    raw.y -= dyPx * u;
    if (reduceMotion) clampRaw(); // no overscroll: nothing to scroll back through
    lastInput = now;
    coastRelease = false;
    bounce.x = bounce.y = null; // the user has hold of it again
    applyRaw();
  }
  function clampRaw() {
    const L = limits();
    raw.x = Math.min(L.maxX, Math.max(L.minX, raw.x));
    raw.y = Math.min(L.maxY, Math.max(L.minY, raw.y));
  }
  /** Pull raw inside the overview bounds before zooming out to them, so nothing pops. */
  function settleRaw() {
    const L = limits(baseVis);
    raw.x = Math.min(L.maxX, Math.max(L.minX, raw.x));
    raw.y = Math.min(L.maxY, Math.max(L.minY, raw.y));
  }
  let coastRelease = false; // the trackpad is coasting: the fingers have lifted
  const vel = { x: 0, y: 0 };
  // per-axis bounce-back: d = visible overshoot past the edge (wall units), v = its rate of change
  type Bounce = { d: number; v: number; side: 1 | -1 };
  const bounce: { x: Bounce | null; y: Bounce | null } = { x: null, y: null };
  let notchy = false; // last wheel input looked like a mouse wheel (big discrete steps)

  window.addEventListener("wheel", (e) => {
    if (stopped || e.ctrlKey) return; // fallback gallery scrolls natively; pinch / ctrl+scroll stays browser zoom
    e.preventDefault();
    let dx = e.deltaX, dy = e.deltaY;
    if (e.deltaMode === 1) { dx *= 16; dy *= 16; } else if (e.deltaMode === 2) { dx *= vw; dy *= vh; }
    if (e.shiftKey && dx === 0) { dx = dy; dy = 0; } // mouse wheel + Shift pans sideways
    const now = performance.now();
    // Coasting detection: after the fingers lift, a trackpad keeps sending a smooth stream of
    // shrinking deltas. Two drops in size count as coasting.
    const ax = Math.abs(dx), ay = Math.abs(dy);
    const gap = now - lastWheel.t;
    // The coasting tail repeats equal deltas (3, 3, 2, 2, 1, 1, 1...): a repeat keeps the count, so
    // only a speed-up, a turn or a pause ends coasting. Resetting on repeats let the tail push the
    // wall further past the edge and restart the spring on every event, which stalled the bounce.
    const same = gap < 150 && Math.sign(dx) === lastWheel.sx && Math.sign(dy) === lastWheel.sy;
    const sum = ax + ay, lastSum = lastWheel.ax + lastWheel.ay;
    shrinking = !same || sum > lastSum ? 0 : sum < lastSum ? shrinking + 1 : shrinking;
    lastWheel = { t: now, ax, ay, sx: Math.sign(dx), sy: Math.sign(dy) };
    const coasting = shrinking >= 2;
    notchy = e.deltaMode !== 0 || (dx === 0 && Number.isInteger(dy) && ay >= 50);
    if (coasting) coastRelease = true; // fingers are off: release now (cleared by the next real input)

    if (zoomed && now < wheelGuardUntil) { wheelGuardUntil = now + 150; coastRelease = false; return; } // inertia from before the click
    if (ax + ay < (zoomed ? 4 : 0.01)) return;
    if (coasting && !zoomed) {
      // Coasting never pushes past an edge: it stops at the edge (or is ignored if already
      // past it), so the spring-back starts the moment the fingers lift, as on iOS.
      const L = limits(), u = unitsPerPx();
      if (dx > 0 && raw.x + dx * u > L.maxX) dx = Math.max(0, (L.maxX - raw.x) / u);
      if (dx < 0 && raw.x + dx * u < L.minX) dx = Math.min(0, (L.minX - raw.x) / u);
      if (dy < 0 && raw.y - dy * u > L.maxY) dy = Math.min(0, (raw.y - L.maxY) / u);
      if (dy > 0 && raw.y - dy * u < L.minY) dy = Math.max(0, (raw.y - L.minY) / u);
      if (dx === 0 && dy === 0) return;
      panBy(dx, dy);
      coastRelease = true;
      return;
    }
    panBy(dx, dy);
  }, { passive: false });
  let lastWheel = { t: 0, ax: 0, ay: 0, sx: 0, sy: 0 };
  let shrinking = 0; // consecutive wheel events with falling magnitude

  // touch: one-finger swipe with momentum; a small slop so taps stay taps
  const SLOP = 8;
  let touch: { id: number; x: number; y: number; t: number; vx: number; vy: number; moved: number; panning: boolean } | null = null;
  let suppressClick = false;
  let momentum: { vx: number; vy: number } | null = null;
  canvas.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse") return;
    touch = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), vx: 0, vy: 0, moved: 0, panning: false };
    momentum = null;
    suppressClick = false;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (e.pointerType === "mouse") { mouse = { x: e.clientX, y: e.clientY }; hoverAt(e.clientX, e.clientY); return; }
    if (!touch || e.pointerId !== touch.id) return;
    const now = performance.now(), dt = Math.max(1, now - touch.t);
    const dx = e.clientX - touch.x, dy = e.clientY - touch.y;
    touch.moved += Math.abs(dx) + Math.abs(dy);
    touch.vx = 0.8 * (-dx / dt) + 0.2 * touch.vx;
    touch.vy = 0.8 * (-dy / dt) + 0.2 * touch.vy;
    touch.x = e.clientX; touch.y = e.clientY; touch.t = now;
    if (!touch.panning && touch.moved < SLOP) return;
    touch.panning = true;
    suppressClick = true;
    panBy(-dx, -dy);
  });
  const endTouch = (e: PointerEvent) => {
    if (!touch || e.pointerId !== touch.id) return;
    // taps arrive as the click event below
    if (!reduceMotion && touch.panning && performance.now() - touch.t < 80) momentum = { vx: touch.vx * 16, vy: touch.vy * 16 };
    touch = null;
  };
  canvas.addEventListener("pointerup", endTouch);
  canvas.addEventListener("pointercancel", endTouch);
  canvas.addEventListener("click", (e) => {
    if (suppressClick) { suppressClick = false; return; }
    clickAt(e.clientX, e.clientY);
  });

  // keyboard: arrows / page keys pan, Enter zooms the centred photo, Escape returns
  window.addEventListener("keydown", (e) => {
    if (stopped || e.metaKey || e.ctrlKey || e.altKey) return; // keep browser shortcuts (Cmd+Left is Back)
    const step = 90, page = vh * 0.8;
    const keys: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step],
      PageUp: [0, -page], PageDown: [0, page],
    };
    if (keys[e.key]) { e.preventDefault(); const [dx, dy] = keys[e.key]; panBy(dx, dy); return; }
    if (e.key === "Escape" && zoomed) { leaveZoom(true); return; }
    if (e.key === "Enter" && document.activeElement === canvas) { e.preventDefault(); if (zoomed) leaveZoom(true); else zoomTo(nearestToCentre()); }
  });

  // ---------- picking, hover, zoom ----------
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  function pick(cx: number, cy: number): Hung | null {
    ndc.set((cx / vw) * 2 - 1, -(cy / vh) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(hung.map((h) => h.hit), false)[0];
    return hit ? hung[hit.object.userData.index] : null;
  }
  let hovered: Hung | null = null;
  function hoverAt(cx: number, cy: number) {
    const h = pick(cx, cy);
    if (h === hovered) return;
    if (hovered) hovered.liftTarget = 0;
    hovered = h;
    if (h && !reduceMotion) h.liftTarget = 6;
    canvas.style.cursor = h ? (h === zoomed ? "zoom-out" : "zoom-in") : "";
    dirty = true;
  }
  canvas.addEventListener("pointerleave", () => {
    mouse = null;
    if (hovered) { hovered.liftTarget = 0; hovered = null; dirty = true; }
  });

  function animateTo(to: { x?: number; y?: number; vis: number }) {
    if (reduceMotion) {
      view.vis = to.vis;
      if (to.x !== undefined && to.y !== undefined) { view.x = raw.x = to.x; view.y = raw.y = to.y; }
      else applyRaw();
      dirty = true;
      return;
    }
    bounce.x = bounce.y = null;
    anim = { from: { ...view }, to, t0: performance.now(), dur: 750 };
  }

  /** Camera position that fits a focused frame above the caption (the name has sunk out of view). */
  function zoomTarget(h: Hung) {
    const topPx = Math.min(vw, vh) * 0.06;
    const availH = Math.max(vh * 0.3, vh - topPx - reserveFocused), availW = vw - topPx * 2;
    const it = h.item;
    const unitsPer = Math.max(it.outerH / (availH * 0.94), it.outerW / (availW * 0.94));
    const centreOffsetPx = (reserveFocused - topPx) / 2; // frame sits above screen centre by this much
    return { x: it.x, y: it.y - centreOffsetPx * unitsPer, vis: unitsPer * vh };
  }

  function zoomTo(h: Hung) {
    introTo = null;
    bounce.x = bounce.y = null;
    zoomed = h;
    momentum = null;
    wheelGuardUntil = performance.now() + 400;
    animateTo(zoomTarget(h));
    showInfo(h);
    document.documentElement.classList.add("zoomed");
    canvas.style.cursor = "zoom-out";
  }

  function clickAt(cx: number, cy: number) {
    const h = pick(cx, cy);
    if (!h) { if (zoomed) leaveZoom(true); return; }
    if (zoomed === h) { leaveZoom(true); return; }
    zoomTo(h);
  }

  /** Back to the overview. `glide` animates the position too; otherwise only the zoom animates and panning stays live. */
  function leaveZoom(glide: boolean) {
    if (!zoomed) return;
    zoomed = null;
    document.documentElement.classList.remove("zoomed");
    canvas.style.cursor = "";
    if (!glide) { settleRaw(); animateTo({ vis: baseVis }); return; }
    const L = limits(baseVis);
    animateTo({
      x: Math.min(L.maxX, Math.max(L.minX, view.x)),
      y: Math.min(L.maxY, Math.max(L.minY, view.y)),
      vis: baseVis,
    });
  }

  // ---------- caption: photo details while zoomed ----------
  function showInfo(h: Hung) {
    // title / camera · stock / place, year, skipping whatever is not filled in yet
    const p = h.item.photo;
    const lines = [
      p.title ? `<em>${p.title}</em>` : "",
      [p.camera, p.film].filter(Boolean).join(" &middot; "),
      [p.place, p.year].filter(Boolean).join(", "),
    ].filter(Boolean);
    photoInfo.innerHTML = lines.join("<br>");
  }
  function nearestToCentre(): Hung {
    let best = hung[0], bd = Infinity;
    for (const h of hung) {
      const d = (h.item.x - view.x) ** 2 + (h.item.y - view.y) ** 2;
      if (d < bd) { bd = d; best = h; }
    }
    return best;
  }

  // ---------- opening ----------
  /** Resting view: centred on the opening photo (the swing) at the normal wall scale, above the bio. */
  function restingView() {
    const first = hung.find((h) => h.item.photo.file === openingPhoto) ?? hung[0];
    const topPx = Math.min(vw, vh) * 0.06;
    const L = limits(baseVis);
    const x = first.item.x, y = first.item.y - ((reserveBottom - topPx) / 2) * unitsPerPx(baseVis);
    return { x: Math.min(L.maxX, Math.max(L.minX, x)), y: Math.min(L.maxY, Math.max(L.minY, y)), vis: baseVis };
  }
  /** The whole wall in the space above the bio. */
  function wholeWallView() {
    const topPx = Math.min(vw, vh) * 0.06;
    const availH = Math.max(vh * 0.3, vh - topPx * 2 - reserveBottom), availW = vw - topPx * 2;
    const per = Math.max((bounds.maxX - bounds.minX) / availW, (bounds.maxY - bounds.minY) / availH);
    return {
      x: (bounds.minX + bounds.maxX) / 2,
      y: (bounds.minY + bounds.maxY) / 2 - ((reserveBottom - topPx) / 2) * per,
      vis: per * vh,
    };
  }
  /** Start on the whole wall; the frame loop zooms to the resting view once the photos are in. */
  function setupOpening() {
    const rest = restingView();
    if (reduceMotion) { Object.assign(view, rest); introTo = null; }
    else { Object.assign(view, wholeWallView()); introTo = rest; }
    raw.x = view.x; raw.y = view.y;
    dirty = true;
  }

  // ---------- loop ----------
  let last = performance.now();
  function frame(now: number) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    let moved = false;

    if (anim) {
      const k = Math.max(0, Math.min(1, (now - anim.t0) / anim.dur));
      // the opening zoom eases in and out; everything else just eases out
      const e = anim.smooth ? (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2) : 1 - Math.pow(1 - k, 3);
      // zoom in log space so the scale changes at an even visual rate (linear vis crawls, then lurches)
      view.vis = anim.from.vis * Math.pow(anim.to.vis / anim.from.vis, e);
      if (anim.to.x !== undefined && anim.to.y !== undefined) {
        view.x = raw.x = anim.from.x + (anim.to.x - anim.from.x) * e;
        view.y = raw.y = anim.from.y + (anim.to.y - anim.from.y) * e;
      } else applyRaw(); // zoom-out while the user keeps panning
      if (k >= 1) { anim = null; bounce.x = bounce.y = null; } // land exactly; no leftover spring
      dirty = moved = true;
    }
    if (momentum && !anim) {
      const decay = Math.exp(-dt * 3.2);
      // move directly (not panBy, which would reset the bounce on the other axis every frame)
      const u = unitsPerPx();
      raw.x += momentum.vx * dt * 60 * u;
      raw.y -= momentum.vy * dt * 60 * u;
      if (reduceMotion) clampRaw();
      applyRaw();
      momentum.vx *= decay; momentum.vy *= decay;
      // a flick that runs past an edge hands its speed to the bounce on that axis, as on iOS
      const L = limits();
      if ((raw.x > L.maxX && momentum.vx > 0) || (raw.x < L.minX && momentum.vx < 0)) { vel.x = momentum.vx * 60 * u; momentum.vx = 0; }
      if ((raw.y > L.maxY && momentum.vy < 0) || (raw.y < L.minY && momentum.vy > 0)) { vel.y = -momentum.vy * 60 * u; momentum.vy = 0; }
      if (Math.hypot(momentum.vx, momentum.vy) < 0.05) momentum = null;
      moved = true;
    }
    // Bounce back after overscroll, like an iOS scroll view: once the fingers lift (input pauses,
    // or the trackpad starts coasting), a critically damped spring pulls the visible overshoot
    // back to the edge, starting from the speed the wall was moving at.
    // a trackpad sends nothing while fingers rest, so a short pause also counts as letting go;
    // a lift with any motion is caught sooner by the coasting check in the wheel handler
    const released = momentum || coastRelease || now - lastInput > (notchy ? 130 : 50);
    // input speed fades when nothing is moving it (e.g. a finger held still past the edge)
    if (now - lastInput > 32) { vel.x *= Math.exp(-dt * 12); vel.y *= Math.exp(-dt * 12); }
    if (!anim && !introTo && !touch && !zoomed && released) { // not while the opening is waiting to zoom
      const L = limits();
      const W = 13; // spring stiffness (rad/s): settles in ~0.4 s
      const axis = (key: "x" | "y", lo: number, hi: number, dim: number) => {
        const r = raw[key];
        let b = bounce[key];
        if (!b) {
          if (r > hi || r < lo) {
            const over = r > hi ? r - hi : lo - r, out: 1 | -1 = r > hi ? 1 : -1;
            const slope = 0.55 / (1 + over / dim); // d(visible)/d(raw) at this stretch
            b = bounce[key] = { d: rubber(over, dim), v: Math.max(0, vel[key] * out) * slope, side: out };
          } else return;
        }
        b.v += (-W * W * b.d - 2 * W * b.v) * dt;
        b.d += b.v * dt;
        if (b.d <= 0.05 && Math.abs(b.v) < 5) { b.d = 0; bounce[key] = null; }
        const over = unrubber(Math.max(0, b.d), dim);
        raw[key] = b.side > 0 ? hi + over : lo - over;
        moved = true;
      };
      axis("x", L.minX, L.maxX, L.halfW);
      axis("y", L.minY, L.maxY, L.halfH);
      if (moved) applyRaw();
    }
    if (now - lastInput < 50) moved = true;

    for (const h of hung) if (updateLift(h, dt)) dirty = true;

    if (dirty) {
      dirty = false;
      camera.position.set(view.x, view.y, view.vis / 2 / tanHalf);
      camera.near = camera.position.z - 400; camera.far = camera.position.z + 50;
      camera.updateProjectionMatrix();
      // the wall moved under a still mouse: re-check what it is over
      if (moved && mouse) hoverAt(mouse.x, mouse.y);
      renderer.render(scene, camera);
      if (assetsReady && !shownWall) {
        shownWall = true;
        document.documentElement.classList.add("loaded");
        // hold the overview while the wall fades in, then zoom to the resting view
        if (introTo) { bounce.x = bounce.y = null; anim = { from: { ...view }, to: introTo, t0: now + 1100, dur: 1800, smooth: true }; introTo = null; }
      }
    }
    if (!stopped) requestAnimationFrame(frame);
  }

  async function start() {
    try { await document.fonts.load('400 100px "Geist Serif"'); } catch { /* falls back to Georgia */ }
    resize();
    setupOpening();
    window.addEventListener("resize", queueResize);
    // the caption's line height depends on the web font: re-measure once it has loaded
    document.fonts.ready.then(queueResize);
    document.documentElement.classList.add("ready");
    if (!stopped) requestAnimationFrame(frame);
  }
  start().catch(showFallback);
}
