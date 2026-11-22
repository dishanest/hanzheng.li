import * as THREE from "three";
import { photos, openingPhoto } from "./photos";
import { layout } from "./layout";
import { makeMaterials } from "./frames";
import { hang, updateLift, photoBleed, PHOTO_Z, type Hung } from "./wall";

/** A direction on screen: x right, y down, one of them 0. */
type Dir = { x: number; y: number };

const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const coarse = matchMedia("(pointer: coarse)").matches;
const photoInfo = document.getElementById("photo-info")!;
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
// iOS phones: the canvas extends under the status bar and toolbar (see resize() in init)
const bleed = document.documentElement.classList.contains("bleed");
const BLEED_TOP = 100, BLEED_BOTTOM = 140, PARK = 200; // CSS px
const BLEED_TOP_PX = bleed ? BLEED_TOP : 0;
// wide screens: the name fills the bottom for the opening, then shrinks into the corner (style.css)
const desk = document.documentElement.classList.contains("desk");
let settled = !desk; // phones keep the full-width name throughout
/** `now`: the user took over, so the bio shows at once instead of after the name has shrunk. */
function settle(now = false) {
  if (now) document.documentElement.classList.add("settled-now");
  if (settled) {
    // the bio is still waiting out its fade-in delay: show it now (a changed delay does not
    // reach a transition that has already started, so restart it with none)
    if (now) { const c = document.getElementById("caption")!; c.style.transition = "none"; void c.offsetWidth; c.style.transition = ""; }
    return;
  }
  settled = true;
  document.documentElement.classList.add("settled");
}

function showFallback(why: unknown) {
  console.warn("Showing the plain gallery:", why);
  document.documentElement.classList.add("no-webgl");
  document.documentElement.classList.remove("zoomed");
  // undo the iOS full-bleed scroll setup: the plain gallery scrolls normally
  document.documentElement.classList.remove("bleed", "desk", "settled", "settled-now"); // the plain gallery keeps its own layout
  document.body.style.height = "";
  window.scrollTo(0, 0);
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
  const fill = new THREE.HemisphereLight(0xffffff, 0xf0eeea, 0.45);
  scene.add(fill);
  for (const l of [key, fill]) for (const n of [1, 2, 3]) l.layers.enable(n); // they light the focused and leaving frames' own layers too

  const FOV = 14;
  const camera = new THREE.PerspectiveCamera(FOV, 1, 10, 20000);
  const tanHalf = Math.tan(THREE.MathUtils.degToRad(FOV / 2));

  THREE.Cache.enabled = true;
  const loader = new THREE.TextureLoader();
  const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const mats = makeMaterials(loader);
  const { items, bounds } = layout(photos, openingPhoto, !desk);
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
  let reserveFull = 0; // full-width name (+ caption row on phones), css px
  let reserveSmall = 0; // wide screens once settled: the corner name and the bio beside it, css px
  const reserve = (s = settled) => (s ? reserveSmall : reserveFull); // room kept clear at the bottom
  let reserveFocused = 0; // caption only, css px
  const view = { x: 0, y: 0, vis: 1150 }; // vis = wall units visible vertically
  const raw = { x: 0, y: 0 }; // position the input drives, kept inside the bounds (no overscroll)
  let baseVis = 1150;
  let lastInput = 0;
  let zoomed: Hung | null = null;
  // `to.x/y` undefined = only zoom animates, panning stays live
  let anim: { from: typeof view; to: { x?: number; y?: number; vis: number }; t0: number; dur: number; smooth?: boolean } | null = null;
  let introTo: { x: number; y: number; vis: number } | null = null; // resting view the opening zoom lands on
  let mouse: { x: number; y: number } | null = null;

  function overviewVis() {
    // laptop: about a third of the height per frame; phone portrait: 2-3 frames across
    return vw / vh < 0.8 ? (820 * vh) / vw : 1150;
  }
  function unitsPerPx(vis = view.vis) { return vis / vh; }

  function limits(vis = view.vis, s = settled) {
    const halfW = (vis * vw) / vh / 2, halfH = vis / 2;
    // the name and caption cover the bottom of the screen; let the wall scroll up past them
    const nameUnits = reserve(s) * unitsPerPx(vis);
    const lim = {
      minX: bounds.minX + halfW, maxX: bounds.maxX - halfW,
      // on iOS the wall also shows under the status bar: keep the top margin visible there too
      minY: bounds.minY + halfH - nameUnits, maxY: bounds.maxY - halfH - BLEED_TOP_PX * unitsPerPx(vis),
      halfW, halfH,
    };
    if (lim.minX > lim.maxX) lim.minX = lim.maxX = (bounds.minX + bounds.maxX) / 2;
    if (lim.minY > lim.maxY) lim.minY = lim.maxY = (bounds.minY + bounds.maxY) / 2;
    return lim;
  }

  /** --pad (style.css) in px: a clamp(), so it is resolved by letting the browser lay out a probe. */
  const padProbe = document.createElement("div");
  padProbe.style.cssText = "position:absolute;visibility:hidden;width:var(--pad)";
  document.body.append(padProbe);
  const pad = () => padProbe.offsetWidth;
  /** Put the bio's last baseline on the name's baseline (--pad above the bottom on wide screens).
   *  Measured with a zero-size inline box, which sits exactly on the text's baseline. */
  function centreBio() {
    const bio = captionEl.querySelector<HTMLElement>(".bio")!;
    const probe = document.createElement("span");
    probe.style.cssText = "display:inline-block;width:0;height:0";
    bio.append(probe);
    const drop = bio.getBoundingClientRect().bottom - probe.getBoundingClientRect().bottom; // box bottom below the baseline
    probe.remove();
    if (Number.isFinite(drop)) captionEl.style.setProperty("--bio-bottom", `${pad() + (coarse ? 14 : 0) - drop}px`);
  }

  // ---------- resize (batched to one per frame) ----------
  let resizeQueued = false;
  function queueResize() {
    if (resizeQueued) return;
    resizeQueued = true;
    requestAnimationFrame(() => {
      resizeQueued = false;
      // iOS reports a pinch-zoom (and the toolbar sliding) as a resize. With the full-screen photo
      // open, only a real change of the page's width (a rotation, a window resize) rebuilds it;
      // otherwise the pinch would drop back to the focused photo.
      if (detail && document.documentElement.clientWidth === detailLayoutW) return;
      // the corner name's size follows --name-k at once, not by its 1.8 s shrink transition
      const name = document.querySelector<SVGElement>(".name")!, root = document.documentElement.style;
      const before = root.getPropertyValue("--name-k");
      try { resize(); } finally {
        // a changed corner size applies at once, not by the 1.8 s shrink (which a resize during
        // the opening must not cut short, so only when the size really changed)
        if (settled && !anim?.smooth && root.getPropertyValue("--name-k") !== before) {
          const t = name.style.transition;
          name.style.transition = "none";
          void getComputedStyle(name).transform;
          name.style.transition = t;
        }
      }
    });
  }
  // iOS Safari draws only document content (not fixed elements) under the status bar and the
  // toolbar, and only once the page has scrolled. So there the canvas is absolute, taller than the
  // layout viewport by BLEED_TOP / BLEED_BOTTOM, and the document is parked a little way down.
  // The camera still frames the layout viewport; the extra rows just show more wall.
  function placeCanvas() {
    if (stopped) return;
    // a swipe that starts on the caption link can scroll the page: put it back
    if (Math.abs(window.scrollY - PARK) > 1) window.scrollTo(0, PARK);
    canvas.style.top = `${window.scrollY - BLEED_TOP}px`;
  }
  if (bleed) window.addEventListener("scroll", placeCanvas, { passive: true });
  function resize() {
    vw = window.innerWidth; vh = window.innerHeight;
    // 1.5x: the type is HTML, so the canvas only draws the wall; ~45% fewer pixels than 2x
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    renderer.setPixelRatio(dpr);
    const top = bleed ? BLEED_TOP : 0, bottom = bleed ? BLEED_BOTTOM : 0;
    renderer.setSize(vw, vh + top + bottom, false);
    canvas.style.width = vw + "px"; canvas.style.height = vh + top + bottom + "px";
    camera.aspect = vw / vh;
    if (bleed) {
      camera.setViewOffset(vw, vh, 0, -top, vw, vh + top + bottom);
      document.body.style.height = `${PARK + vh + bottom + PARK}px`;
      window.scrollTo(0, PARK);
      placeCanvas();
    }
    // full-width height (index.html; wide screens inset it by --pad on each side, style.css)
    nameH = desk ? (vw - 2 * pad()) * 0.218569 + pad() : vw * 0.218569;
    const lineH = parseFloat(getComputedStyle(captionEl).lineHeight) || 19;
    if (desk) {
      // the opening shows no caption; afterwards the name and the bio share one row at the bottom
      const smallH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--name-small-h")) || 60;
      reserveFull = nameH + 14;
      reserveSmall = Math.max(smallH, lineH * 3) + 18;
      reserveFocused = reserveSmall + (coarse ? 30 : 0); // tablets: home-indicator inset
      // the corner name is the full-width one scaled down (style.css): --name-k is that scale
      document.documentElement.style.setProperty("--name-k", String((smallH * 4.57521) / (vw - 2 * pad())));
      centreBio();
    } else {
      // room for three caption lines above the name, whichever text is showing
      reserveFull = reserveSmall = nameH + 14 + lineH * 3 + 18;
      // while a photo is focused the name has sunk away: only the caption (now in the corner) needs room
      reserveFocused = Math.min(26, Math.max(14, vw * 0.02)) + lineH * 3 + 18 + (coarse ? 30 : 0); // phones: home-indicator inset
    }
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
    if (detail) { removeOverlays(); detail = null; } // the full-screen photo was sized for the old window
    if (zoomed) Object.assign(view, zoomTarget(zoomed));
    else view.vis = baseVis;
    raw.x = view.x; raw.y = view.y;
    if (!zoomed) { clampRaw(); applyRaw(); }
    dirty = true;
  }

  // ---------- panning ----------
  function applyRaw() {
    const L = limits();
    view.x = Math.min(L.maxX, Math.max(L.minX, raw.x));
    view.y = Math.min(L.maxY, Math.max(L.minY, raw.y));
    // raw follows the clamp, so a pan past an edge leaves nothing to unwind (the limits move
    // while a zoom-out runs, and clampRaw only knew the limits at the time of the pan)
    raw.x = view.x; raw.y = view.y;
    dirty = true;
  }

  function panBy(dxPx: number, dyPx: number) {
    if (zoomed) return; // a focused photo holds still
    if (anim?.smooth || introTo) {
      // the user took over during the opening zoom: keep their position, settle the scale
      anim = null; introTo = null;
      settle(true);
      raw.x = view.x; raw.y = view.y;
      settleRaw();
      animateTo({ vis: baseVis });
    }
    const u = unitsPerPx();
    raw.x += dxPx * u;
    raw.y -= dyPx * u;
    clampRaw(); // the wall stops at its edges: no overscroll
    lastInput = performance.now();
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

  window.addEventListener("wheel", (e) => {
    if (stopped || e.ctrlKey) return; // the fallback gallery scrolls natively; pinch / ctrl+scroll: browser zoom, or the full-screen photo's own
    if (detail) {
      // the full-screen photo pans natively; at its edge a sideways scroll would become the
      // browser's back / forward swipe, so it stops there
      const sx = Math.sign(e.deltaX);
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY) && sx && (!detail.isConnected || atEdge(detail, sx, 0))) e.preventDefault();
      return;
    }
    e.preventDefault();
    if (zoomed) return; // a focused photo holds still; click or Escape steps back
    let dx = e.deltaX, dy = e.deltaY;
    if (e.deltaMode === 1) { dx *= 16; dy *= 16; } else if (e.deltaMode === 2) { dx *= vw; dy *= vh; }
    if (e.shiftKey && dx === 0) { dx = dy; dy = 0; } // mouse wheel + Shift pans sideways
    if (Math.abs(dx) + Math.abs(dy) < 0.01) return;
    panBy(dx, dy);
  }, { passive: false });

  // touch: one-finger swipe with momentum; a small slop so taps stay taps
  const SLOP = 8;
  const SWIPE = 50; // px sideways that counts as a swipe to the next photo
  let touch: { id: number; sx: number; sy: number; x: number; y: number; t: number; vx: number; vy: number; moved: number; panning: boolean } | null = null;
  let suppressClick = false;
  let momentum: { vx: number; vy: number } | null = null;
  canvas.addEventListener("pointerdown", (e) => {
    suppressClick = false; // a stale guard from an earlier swipe must not eat this click
    if (e.pointerType === "mouse") return;
    touch = { id: e.pointerId, sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY, t: performance.now(), vx: 0, vy: 0, moved: 0, panning: false };
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
    suppressClick = true; // a drag, not a tap
    if (zoomed) return; // a focused photo holds still
    touch.panning = true;
    panBy(-dx, -dy);
  });
  /** The way a swipe sends you (screen axes, y down), or null if it is too short or diagonal. */
  function swipeDir(dx: number, dy: number): Dir | null {
    if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE) return null;
    if (Math.abs(dx) > 1.5 * Math.abs(dy)) return { x: dx < 0 ? 1 : -1, y: 0 };
    if (Math.abs(dy) > 1.5 * Math.abs(dx)) return { x: 0, y: dy < 0 ? 1 : -1 };
    return null;
  }
  const endTouch = (e: PointerEvent) => {
    if (!touch || e.pointerId !== touch.id) return;
    // taps arrive as the click event below
    if (zoomed && !detail) {
      // a focused photo: a swipe moves to the nearest photo the way the wall would come in (swipe
      // left: the one to the right), as if dragging the wall; not on a cancelled touch
      const d = swipeDir(e.clientX - touch.sx, e.clientY - touch.sy);
      if (e.type === "pointerup" && d) seek(d);
      touch = null;
      return;
    }
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
  // arrow keys held down, for the glide in the frame loop
  const heldKeys = new Set<string>();
  let pageAnim: object | null = null; // the running Page Up / Down glide, if any
  const keyVel = { x: 0, y: 0 }; // css px / s
  const KEY_SPEED = 1100;
  // macOS sends no keyup for an arrow released while Cmd is down: a modifier, a blur or a hidden
  // tab drops every held arrow, so the glide can never run on by itself
  window.addEventListener("keyup", (e) => { if (e.key === "Meta" || e.key === "Control" || e.key === "Alt") heldKeys.clear(); else heldKeys.delete(e.key); });
  window.addEventListener("blur", () => heldKeys.clear());
  document.addEventListener("visibilitychange", () => heldKeys.clear());
  window.addEventListener("keydown", (e) => {
    if (stopped) return;
    if (e.metaKey || e.ctrlKey || e.altKey) { heldKeys.clear(); return; } // keep browser shortcuts (Cmd+Left is Back)
    const arrow: Record<string, Dir> = { ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }, ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 } };
    if (zoomed && !detail && arrow[e.key]) { // full screen: the arrows pan the photo natively, nothing else
      const dir = arrow[e.key];
      e.preventDefault();
      if (!e.repeat) seek(dir); // a held key moves one photo, not a stream of them
      return;
    }
    if (detail) {
      if (e.key === "Escape") leaveDetail();
      if (e.key === " ") e.preventDefault(); // already all the way in (and no page-down scroll)
      return;
    }
    if (e.key.startsWith("Arrow")) {
      // held arrows glide (see the frame loop), they do not step
      e.preventDefault();
      if (!zoomed) {
        if (anim && anim === pageAnim) anim = null; // a Page Up / Down glide: the arrows take over
        heldKeys.add(e.key);
        dirty = true;
      }
      return;
    }
    if (e.key === "PageUp" || e.key === "PageDown") {
      e.preventDefault();
      if (zoomed) return;
      // a screen at a time, eased; a held key continues from the last target, not from mid-flight
      if (anim?.smooth || introTo) panBy(0, 0); // the opening: settle the name and the scale first, as a pan does
      const from = anim && anim.to.y !== undefined ? anim.to.y : view.y;
      const L = limits(baseVis), dy = (e.key === "PageDown" ? 1 : -1) * vh * 0.8 * unitsPerPx(baseVis);
      raw.x = view.x;
      animateTo({ x: Math.min(L.maxX, Math.max(L.minX, view.x)), y: Math.min(L.maxY, Math.max(L.minY, from - dy)), vis: baseVis }, 420);
      pageAnim = anim;
      return;
    }
    if (e.key === "Escape" && zoomed) { leaveZoom(); return; }
    if (e.key === " " && (e.target === canvas || e.target === document.body)) { // not on a link or a field
      e.preventDefault(); // not the browser's page scroll
      // Space moves in a level (wall -> focused -> full screen), Escape backs out
      if (!e.repeat) {
        if (!zoomed) zoomTo(nearestToCentre()); // the photo nearest the middle of the screen
        else enterDetail(zoomed, vw / 2, vh / 2, false);
      }
      return;
    }
    if (e.key === "Enter" && document.activeElement === canvas) {
      e.preventDefault();
      if (zoomed) enterDetail(zoomed, vw / 2, vh / 2, false); // no pointer: open on the photo's centre
      else zoomTo(nearestToCentre());
    }
  });

  // ---------- picking, hover, focus ----------
  // As on the plain-DOM site: clicking a frame flies to it while every other frame drifts outward
  // and fades (under a white veil), leaving the photo alone above its details. Scrolling does
  // nothing there. Clicking the photo again opens it full screen in its own native scroller;
  // clicking that, or anywhere off the photo, steps back. With the pointer off the photo (wide
  // screens), the others edge back in at 20% and the photo gives way a little: the "peek".
  const FOCUS_MS = 300, OTHERS_MS = 550, PEEK_MS = 400;
  const ray = new THREE.Raycaster();
  ray.layers.enableAll(); // the focused frame is drawn on its own layer
  const ndc = new THREE.Vector2();
  function pick(cx: number, cy: number): Hung | null {
    ndc.set((cx / vw) * 2 - 1, -(cy / vh) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(hung.map((h) => h.hit), false)[0];
    return hit ? hung[hit.object.userData.index] : null;
  }
  /** A tweened number: eases out over `dur` ms toward `to`. */
  type Tween = { v: number; from: number; to: number; t0: number; dur: number };
  const tween = (): Tween => ({ v: 0, from: 0, to: 0, t0: 0, dur: 1 });
  function tweenTo(t: Tween, to: number, dur: number) {
    Object.assign(t, { from: t.v, to, t0: performance.now(), dur: reduceMotion ? 0 : dur });
    dirty = true;
  }
  function stepTween(t: Tween, now: number) {
    if (t.v === t.to) return false;
    const k = t.dur <= 0 ? 1 : Math.max(0, Math.min(1, (now - t.t0) / t.dur)); // rAF time can precede t0
    t.v = k >= 1 ? t.to : t.from + (t.to - t.from) * (1 - Math.pow(1 - k, 3));
    return true;
  }
  const focusMix = tween(); // 0 = the wall, 1 = one photo alone
  const peekMix = tween(); // 1 = the pointer is off the focused photo
  // the frame drawn over the veil: the focused one, and the last one while the others come back
  let front: Hung | null = null;
  // Photos left by an arrow key: each on its own layer (2 or 3) between the veil and the front
  // frame, drifting out like the others and fading under a veil of its own (mix 1 -> 0). Two at
  // most, so a quick second press lets the first finish fading.
  type Leaver = { h: Hung; mix: Tween; n: 2 | 3 };
  let leavers: Leaver[] = [];
  const leaverOf = (h: Hung) => leavers.find((l) => l.h === h);
  const layer = (x: Hung, n: number) => { x.group.traverse((o) => o.layers.set(n)); x.shadow.layers.set(n); };
  function setFront(h: Hung | null) {
    if (front === h) return;
    if (front && !leaverOf(front)) layer(front, 0);
    front = h;
    if (h) { leavers = leavers.filter((l) => l.h !== h); layer(h, 1); } // a photo coming back stops leaving
    dirty = true;
  }
  function dropLeaver(l: Leaver) {
    leavers = leavers.filter((x) => x !== l);
    if (l.h !== front) layer(l.h, 0);
    leaveVeils[l.n].visible = false;
    dirty = true;
  }
  const dropLeaving = () => [...leavers].forEach(dropLeaver);
  function addLeaver(h: Hung) {
    if (leavers.length === 2) dropLeaver(leavers[0]);
    const n: 2 | 3 = leavers[0]?.n === 2 ? 3 : 2;
    const mix = tween();
    mix.v = 1;
    tweenTo(mix, 0, OTHERS_MS);
    leavers.push({ h, mix, n });
    layer(h, n);
  }
  const veil = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, toneMapped: false }),
  );
  veil.scale.set((bounds.maxX - bounds.minX) * 8, (bounds.maxY - bounds.minY) * 8, 1);
  veil.position.set((bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2, 60); // over every frame, even pushed and lifted
  veil.visible = false;
  scene.add(veil);
  const leaveVeils: Record<number, THREE.Mesh> = {};
  for (const n of [2, 3]) {
    const v = veil.clone();
    v.material = (veil.material as THREE.MeshBasicMaterial).clone();
    v.layers.set(n);
    scene.add(v);
    leaveVeils[n] = v;
  }

  let hovered: Hung | null = null;
  let peeking = false;
  /** `moved`: a real pointer move. The wall moving under a still pointer never starts a peek. */
  function hoverAt(cx: number, cy: number, moved = true) {
    const h = pick(cx, cy);
    if (zoomed) {
      const off = h !== zoomed;
      canvas.style.cursor = off ? "zoom-out" : "zoom-in";
      // phones have no hover peek; and it waits while a focus move runs
      if (moved && desk && !detail && !anim && off !== peeking) { peeking = off; tweenTo(peekMix, off ? 1 : 0, PEEK_MS); }
      return;
    }
    if (h === hovered) return;
    if (hovered) hovered.liftTarget = 0;
    hovered = h;
    if (h && !reduceMotion) h.liftTarget = 6;
    canvas.style.cursor = h ? "zoom-in" : "";
    dirty = true;
  }
  canvas.addEventListener("pointerleave", () => {
    mouse = null;
    if (peeking) { peeking = false; tweenTo(peekMix, 0, PEEK_MS); }
    if (hovered) { hovered.liftTarget = 0; hovered = null; dirty = true; }
  });

  function animateTo(to: { x?: number; y?: number; vis: number }, dur = 750) {
    if (reduceMotion) {
      view.vis = to.vis;
      if (to.x !== undefined && to.y !== undefined) { view.x = raw.x = to.x; view.y = raw.y = to.y; }
      else applyRaw();
      dirty = true;
      return;
    }
    anim = { from: { ...view }, to, t0: performance.now(), dur };
  }

  /** Camera view that fits a focused frame above the caption row, centred in that space. */
  function zoomTarget(h: Hung) {
    const t = Math.min(vw, vh) * 0.06;
    const availH = Math.max(vh * 0.3, vh - t - reserveFocused - 12), availW = vw - t * 2;
    const it = h.item;
    const unitsPer = Math.max(it.outerH / availH, it.outerW / availW);
    return { x: it.x, y: it.y - (vh / 2 - (t + availH / 2)) * unitsPer, vis: unitsPer * vh };
  }

  function zoomTo(h: Hung) {
    introTo = null;
    settle(true);
    if (hovered) { hovered.liftTarget = 0; hovered = null; }
    zoomed = h;
    setFront(h);
    momentum = null;
    peeking = false;
    tweenTo(peekMix, 0, 0);
    animateTo(zoomTarget(h), FOCUS_MS);
    tweenTo(focusMix, 1, OTHERS_MS);
    showInfo(h);
    document.documentElement.classList.add("zoomed");
    canvas.style.cursor = "zoom-in";
  }

  function clickAt(cx: number, cy: number) {
    if (detail) { if (!detail.isConnected) leaveDetail(); return; } // shown: the full-screen photo takes its own clicks
    const h = pick(cx, cy);
    if (zoomed) {
      if (h === zoomed) enterDetail(h, cx, cy);
      else leaveZoom();
      return;
    }
    if (h) zoomTo(h);
  }

  /** Back to the wall where it was. */
  function leaveZoom() {
    if (!zoomed) return;
    if (detail) { leaveDetail(); return; }
    zoomed = null;
    peeking = false;
    tweenTo(peekMix, 0, PEEK_MS);
    tweenTo(focusMix, 0, OTHERS_MS); // the front layer is dropped once the others are back
    document.documentElement.classList.remove("zoomed");
    canvas.style.cursor = "";
    const L = limits(baseVis);
    animateTo({
      x: Math.min(L.maxX, Math.max(L.minX, view.x)),
      y: Math.min(L.maxY, Math.max(L.minY, view.y)),
      vis: baseVis,
    }, FOCUS_MS);
  }

  // ---------- full screen ----------
  // The camera flies in until the photo just covers the screen (aspect fill), then an HTML copy
  // of the photo takes over in a native scroller, so it pans with the browser's own momentum.
  const PHOTO_PLANE = PHOTO_Z - 0.2; // the print's height off the wall (wall.ts)
  let detail: HTMLDivElement | null = null;
  let detailLayoutW = 0; // the page width when full screen opened (see queueResize)
  let renderVis = 1; // the camera's visible height at the wall, peek included
  /** Wall units per css px at the print's plane, for the camera as last drawn. */
  const photoUnitsPerPx = () => (renderVis - 2 * PHOTO_PLANE * tanHalf) / vh;

  /** Camera view that shows the print `m` css px per wall unit, scrolled to (sl, st). */
  function coverView(h: Hung, m: number, sl: number, st: number) {
    const it = h.item, u = 1 / m;
    return {
      x: it.x - it.pw / 2 + (sl + vw / 2) * u,
      y: it.y + it.ph / 2 - (st + vh / 2) * u,
      vis: vh * u + 2 * PHOTO_PLANE * tanHalf,
    };
  }
  // ---------- seeking ----------
  // An arrow key (or a swipe) on a focused photo moves to its nearest neighbour in that
  // direction on the wall. Full screen only pans.
  const SEEK_MS = 450;
  /** The nearest frame from `f` in screen direction `d` (y down): centre distance along that way,
   *  with distance to the side costing 2.5 times as much, inside a cone of about 56 degrees. The
   *  opposite key right after a move goes straight back. */
  let lastSeek: { from: Hung; to: Hung; dir: Dir } | null = null;
  function neighbour(f: Hung, d: Dir): Hung | null {
    if (lastSeek && lastSeek.to === f && lastSeek.dir.x === -d.x && lastSeek.dir.y === -d.y) return lastSeek.from;
    const a = f.item;
    let best: Hung | null = null, bs = Infinity;
    for (const h of hung) {
      if (h === f) continue;
      const rx = h.item.x - a.x, ry = -(h.item.y - a.y); // screen axes
      const along = rx * d.x + ry * d.y, side = Math.abs(rx * d.y - ry * d.x);
      if (along <= 0 || side > along * 1.5) continue; // not that way
      const score = along + 2.5 * side;
      if (score < bs) { bs = score; best = h; }
    }
    return best;
  }
  function seek(dir: Dir) {
    if (!zoomed) return;
    const next = neighbour(zoomed, dir);
    if (!next) return; // the edge of the wall
    const prev = zoomed;
    lastSeek = { from: prev, to: next, dir };
    zoomed = next;
    setFront(next);
    addLeaver(prev);
    showInfo(next);
    animateTo(zoomTarget(next), SEEK_MS); // the camera flies along the wall; both photos ride over the veil
  }
  /** The full-screen scroller is already at its edge in that direction (or cannot scroll that way). */
  function atEdge(d: HTMLElement, x: number, y: number) {
    const mx = d.scrollWidth - d.clientWidth, my = d.scrollHeight - d.clientHeight;
    if (x > 0) return d.scrollLeft >= mx - 1;
    if (x < 0) return d.scrollLeft <= 1;
    if (y > 0) return d.scrollTop >= my - 1;
    return d.scrollTop <= 1;
  }

  const coverScale = (h: Hung) => Math.max(vw / h.item.pw, vh / h.item.ph); // aspect fill
  /** The full-screen photo: a native scroller holding the print at `m` px per wall unit. Its
   *  decode starts at once; `ready` is false if the image failed. */
  function makeDetail(h: Hung, m: number) {
    const it = h.item, W = it.pw * m, H = it.ph * m;
    const d = document.createElement("div");
    d.className = "detail";
    d.tabIndex = -1; // focusable, so arrow keys scroll it
    // the wall's print is the middle of its texture (the edges run under the mat): crop the same
    const bl = photoBleed(it.photo.mat) / 2 * m;
    const box = document.createElement("div");
    const img = new Image();
    img.src = `${import.meta.env.BASE_URL}photos/${it.photo.file}`;
    img.alt = "";
    box.append(img);
    d.append(box);

    // Pinch zoom is the page's own, not the browser's: the browser zooms the whole page and its
    // fixed layers, and jumped when the fingers lifted. Here the photo itself grows inside the
    // native scroller, about the point between the fingers, so lifting changes nothing.
    let z = 1; // 1 = just covers the screen
    const size = () => {
      box.style.cssText = `width:${W * z}px;height:${H * z}px;overflow:hidden`;
      img.style.cssText = `width:${(W + 2 * bl) * z}px;height:${(H + 2 * bl) * z}px;margin:${-bl * z}px 0 0 ${-bl * z}px`;
    };
    size();
    /** Zoom to `nz`, keeping the photo point (fx, fy) (fractions of the photo) under screen point (cx, cy). */
    const apply = (nz: number, fx: number, fy: number, cx: number, cy: number) => {
      z = Math.min(4, Math.max(1, nz));
      size();
      d.scrollLeft = fx * W * z - cx;
      d.scrollTop = fy * H * z - cy;
    };
    // at most one layout per frame, however many touch events arrive
    let pending: Parameters<typeof apply> | null = null;
    let zt = 1; // the zoom asked for, ahead of the frame that applies it
    const zoomAt = (...a: Parameters<typeof apply>) => {
      zt = a[0] = Math.min(4, Math.max(1, a[0]));
      if (!pending) requestAnimationFrame(() => { if (pending) apply(...pending); pending = null; });
      pending = a;
    };
    const fracAt = (cx: number, cy: number) => ({ fx: (d.scrollLeft + cx) / (W * z), fy: (d.scrollTop + cy) / (H * z) });
    let pinch: { dist: number; z: number; fx: number; fy: number } | null = null;
    const two = (e: TouchEvent) => {
      const [a, b] = [e.touches[0], e.touches[1]];
      return { dist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), cx: (a.clientX + b.clientX) / 2, cy: (a.clientY + b.clientY) / 2 };
    };
    // a tap steps back out, but a pinch is not a tap: iOS can send a click when two fingers lift
    let multi = false, multiUntil = 0;
    d.addEventListener("touchstart", (e) => {
      if (e.touches.length < 2) return;
      multi = true;
      const t = two(e);
      pinch = { dist: Math.max(1, t.dist), z: zt, ...fracAt(t.cx, t.cy) };
      d.style.overflow = "hidden"; // stops a one-finger scroll or momentum already running, which would fight the pinch
    }, { passive: true });
    d.addEventListener("touchmove", (e) => {
      if (!pinch || e.touches.length < 2) return;
      if (e.cancelable) e.preventDefault(); // the photo zooms; the page does not scroll or zoom
      const t = two(e);
      zoomAt(pinch.z * (t.dist / pinch.dist), pinch.fx, pinch.fy, t.cx, t.cy); // moving both fingers pans too
    }, { passive: false });
    const lift = (e: TouchEvent) => {
      if (e.touches.length < 2 && pinch) { pinch = null; d.style.overflow = ""; }
      if (multi && !e.touches.length) { multi = false; multiUntil = performance.now() + 450; }
    };
    d.addEventListener("touchend", lift, { passive: true });
    d.addEventListener("touchcancel", lift, { passive: true }); // iOS may end a gesture this way
    // Safari: a trackpad pinch arrives as gesture events (iOS also sends them for a touch pinch,
    // which the touch handlers above already zoom, so they are skipped then)
    type Gesture = Event & { scale: number; clientX: number; clientY: number };
    let gesture: { z: number; fx: number; fy: number } | null = null;
    d.addEventListener("gesturestart", (e) => {
      e.preventDefault(); // never the browser's own page zoom
      const g = e as Gesture;
      gesture = pinch ? null : { z: zt, ...fracAt(g.clientX, g.clientY) };
    });
    d.addEventListener("gesturechange", (e) => {
      e.preventDefault();
      const g = e as Gesture;
      if (gesture && !pinch) zoomAt(gesture.z * g.scale, gesture.fx, gesture.fy, g.clientX, g.clientY);
    });
    d.addEventListener("gestureend", () => { gesture = null; });
    // other browsers: a trackpad pinch (or ctrl + mouse wheel) is a wheel event with ctrlKey
    d.addEventListener("wheel", (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY; // lines -> px
      const k = Math.min(1.25, Math.max(0.8, Math.exp(-dy * 0.01))); // a mouse-wheel notch zooms a step, not a leap
      const f = fracAt(e.clientX, e.clientY);
      zoomAt(zt * k, f.fx, f.fy, e.clientX, e.clientY);
    }, { passive: false });
    d.addEventListener("click", () => {
      if (multi || performance.now() < multiUntil) return;
      leaveDetail();
    });
    const ready = img.decode().then(() => true, () => img.naturalWidth > 0);
    return { d, ready };
  }

  /** Put an overlay on screen once its photo is decoded (Safari would show low-resolution tiles
   *  while it paints), if it is still wanted. */
  function showWhenReady(d: HTMLDivElement, ready: Promise<boolean>, wanted: () => boolean, sl: number, st: number, failed?: () => void) {
    ready.then((ok) => {
      if (!wanted()) return;
      if (!ok) { failed?.(); return; }
      document.body.append(d);
      d.scrollTo(sl, st);
      d.focus({ preventScroll: true });
    });
  }
  /** The full-screen overlay, shown or still decoding. */
  function removeOverlays() {
    document.querySelectorAll(".detail").forEach((x) => x.remove());
  }

  /** With a click: keep the point under the pointer where it is. From the keyboard (no point):
   *  open on the photo's centre, whatever the camera is doing. */
  function enterDetail(h: Hung, clickX = vw / 2, clickY = vh / 2, fromClick = true) {
    const it = h.item, u = photoUnitsPerPx();
    const m = coverScale(h); // aspect fill: covers the screen, pans along the longer side
    const W = it.pw * m, H = it.ph * m;
    const fx = fromClick ? (camera.position.x + (clickX - vw / 2) * u - (it.x - it.pw / 2)) / it.pw : 0.5;
    const fy = fromClick ? (it.y + it.ph / 2 - (camera.position.y - (clickY - vh / 2) * u)) / it.ph : 0.5;
    const sl = Math.max(0, Math.min(W - vw, fx * W - clickX)), st = Math.max(0, Math.min(H - vh, fy * H - clickY));
    peeking = false;
    tweenTo(peekMix, 0, FOCUS_MS);
    dropLeaving();
    animateTo(coverView(h, m, sl, st), FOCUS_MS);
    const { d, ready } = makeDetail(h, m); // decodes during the flight
    detail = d;
    detailLayoutW = document.documentElement.clientWidth;
    // until it shows, the wall's own photo stays; a failed image steps back
    window.setTimeout(() => showWhenReady(d, ready, () => detail === d, sl, st, leaveDetail), reduceMotion ? 0 : FOCUS_MS);
  }
  function leaveDetail() {
    const d = detail, h = zoomed;
    if (!d || !h) return;
    detail = null;
    // a height change was not applied while full screen was open (see queueResize): apply it now,
    // and skip the hand-over from the scroller, which was measured at the old size
    const resized = window.innerWidth !== vw || window.innerHeight !== vh;
    if (resized) queueResize();
    else if (d.isConnected) {
      // put the camera on what the scroller shows, then fly back out
      const m = d.scrollWidth / h.item.pw;
      anim = null;
      Object.assign(view, coverView(h, m, d.scrollLeft, d.scrollTop));
      raw.x = view.x; raw.y = view.y;
      dirty = true;
    }
    removeOverlays();
    animateTo(zoomTarget(h), FOCUS_MS);
    canvas.focus({ preventScroll: true });
  }

  // ---------- caption: photo details while zoomed ----------
  const stop = (t: string) => (!t || /[.!?]$/.test(t) ? t : `${t}.`); // end a phrase with one period
  function showInfo(h: Hung) {
    // title / camera · stock / place, year, skipping whatever is not filled in yet
    const p = h.item.photo;
    const lines = [
      p.title ? `<em>${p.title}</em>` : "",
      [p.camera, p.film].filter(Boolean).map(stop).join(" "),
      stop([p.place, p.year].filter(Boolean).join(", ")),
    ].filter(Boolean);
    photoInfo.innerHTML = lines.join("<br>");
  }
  function nearestToCentre(): Hung {
    // the middle of the wall in view: above the name and bio that cover the bottom
    const cy = view.y + (reserve() / 2) * unitsPerPx();
    let best = hung[0], bd = Infinity;
    for (const h of hung) {
      const d = (h.item.x - view.x) ** 2 + (h.item.y - cy) ** 2;
      if (d < bd) { bd = d; best = h; }
    }
    return best;
  }

  // ---------- opening ----------
  /** Resting view: centred on the opening photo (the swing) at the normal wall scale, above the bio. */
  function restingView() {
    const first = hung.find((h) => h.item.photo.file === openingPhoto) ?? hung[0];
    const topPx = Math.min(vw, vh) * 0.06;
    // centred in the space above the bottom row as it will be once the name has settled
    const x = first.item.x, y = first.item.y - ((reserve(true) - topPx) / 2) * unitsPerPx(baseVis);
    const L = limits(baseVis, true);
    return { x: Math.min(L.maxX, Math.max(L.minX, x)), y: Math.min(L.maxY, Math.max(L.minY, y)), vis: baseVis };
  }
  /** The whole wall in the space above the bio. */
  function wholeWallView() {
    const topPx = Math.min(vw, vh) * 0.06;
    const availH = Math.max(vh * 0.3, vh - topPx * 2 - reserveFull), availW = vw - topPx * 2;
    const per = Math.max((bounds.maxX - bounds.minX) / availW, (bounds.maxY - bounds.minY) / availH);
    return {
      x: (bounds.minX + bounds.maxX) / 2,
      y: (bounds.minY + bounds.maxY) / 2 - ((reserveFull - topPx) / 2) * per,
      vis: per * vh,
    };
  }
  /** Start on the whole wall; the frame loop zooms to the resting view once the photos are in. */
  function setupOpening() {
    const rest = restingView();
    if (reduceMotion) { Object.assign(view, rest); introTo = null; settle(); }
    else { Object.assign(view, wholeWallView()); introTo = rest; }
    raw.x = view.x; raw.y = view.y;
    dirty = true;
  }

  // ---------- drawing ----------
  // Two passes: the wall and the veil, then the front frame over them (its own layer).
  renderer.autoClear = false;
  function draw() {
    renderer.clear();
    camera.layers.set(0);
    renderer.render(scene, camera);
    if (!front) return;
    const bg = scene.background;
    scene.background = null; // keep the first pass
    for (const n of [...leavers.map((l) => l.n), 1]) { // the oldest leaving photo first
      renderer.clearDepth();
      camera.layers.set(n);
      renderer.render(scene, camera);
    }
    scene.background = bg;
  }

  // ---------- loop ----------
  let last = performance.now();
  function frame(now: number) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    let moved = false;

    if (anim) {
      if (anim.smooth && now >= anim.t0) settle(); // the name shrinks in step with the opening zoom
      const k = Math.max(0, Math.min(1, (now - anim.t0) / anim.dur));
      // the opening zoom eases in and out; everything else just eases out
      const e = anim.smooth ? (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2) : 1 - Math.pow(1 - k, 3);
      // zoom in log space so the scale changes at an even visual rate (linear vis crawls, then lurches)
      view.vis = anim.from.vis * Math.pow(anim.to.vis / anim.from.vis, e);
      if (anim.to.x !== undefined && anim.to.y !== undefined) {
        view.x = raw.x = anim.from.x + (anim.to.x - anim.from.x) * e;
        view.y = raw.y = anim.from.y + (anim.to.y - anim.from.y) * e;
      } else applyRaw(); // zoom-out while the user keeps panning
      if (k >= 1) anim = null; // land exactly
      dirty = moved = true;
    }
    if (momentum && !anim) {
      const decay = Math.exp(-dt * 3.2);
      // move directly (not panBy, which would end a zoom)
      const u = unitsPerPx();
      raw.x += momentum.vx * dt * 60 * u;
      raw.y -= momentum.vy * dt * 60 * u;
      // a flick that reaches an edge stops dead on that axis
      const L = limits();
      if (raw.x >= L.maxX || raw.x <= L.minX) momentum.vx = 0;
      if (raw.y >= L.maxY || raw.y <= L.minY) momentum.vy = 0;
      clampRaw();
      applyRaw();
      momentum.vx *= decay; momentum.vy *= decay;
      if (Math.hypot(momentum.vx, momentum.vy) < 0.05) momentum = null;
      moved = true;
    }
    // arrow keys: ease up to a steady glide while held, and ease to a stop on release
    if (zoomed) heldKeys.clear();
    if (heldKeys.size || keyVel.x || keyVel.y) {
      const tx = (heldKeys.has("ArrowRight") ? 1 : 0) - (heldKeys.has("ArrowLeft") ? 1 : 0);
      const ty = (heldKeys.has("ArrowDown") ? 1 : 0) - (heldKeys.has("ArrowUp") ? 1 : 0);
      const ease = (v: number, t: number) => {
        const k = 1 - Math.exp(-dt / (t ? 0.09 : 0.14)); // speeds up a little quicker than it stops
        const nv = v + (t * KEY_SPEED - v) * k;
        return !t && Math.abs(nv) < 8 ? 0 : nv;
      };
      keyVel.x = ease(keyVel.x, tx); keyVel.y = ease(keyVel.y, ty);
      if (keyVel.x || keyVel.y) { panBy(keyVel.x * dt, keyVel.y * dt); moved = true; dirty = true; }
    }
    if (now - lastInput < 50) moved = true;

    // focus: the others drift outward from the front frame and fade under the veil. They are
    // placed by where they show on screen, as on the DOM site: the camera zooms to the photo, so
    // they are pulled in and shrunk by the same zoom, or they would rush off the screen.
    const fStep = stepTween(focusMix, now), pStep = stepTween(peekMix, now);
    for (const l of [...leavers]) {
      if (!stepTween(l.mix, now)) continue;
      (leaveVeils[l.n].material as THREE.MeshBasicMaterial).opacity = 1 - l.mix.v;
      leaveVeils[l.n].visible = true;
      dirty = true;
      if (l.mix.v === 0) dropLeaver(l); // gone under the veil: back with the others
    }
    if (front && !zoomed && focusMix.v === 0 && focusMix.to === 0) {
      setFront(null);
      for (const h of hung) { h.dx = h.dy = 0; h.s = 1; }
    }
    if (fStep || pStep) {
      const o = focusMix.v * (1 - 0.2 * peekMix.v);
      (veil.material as THREE.MeshBasicMaterial).opacity = o;
      veil.visible = o > 0.001;
      dirty = true;
    }
    if (front && dirty) {
      const mix = focusMix.v, r = view.vis / (1 - 0.035 * peekMix.v) / baseVis; // screen scale: wall / now
      const fit = baseVis / zoomTarget(front).vis;
      const push = (0.35 + (fit - 1) * 0.25) * (1 - 0.1 * peekMix.v);
      const spread = 1 + ((1 + push) * r - 1) * mix, grow = 1 + (1.15 * r - 1) * mix;
      for (const h of hung) {
        // the leaving photo eases from where it was focused out to where the others are
        const l = leaverOf(h);
        const k = h === front ? 0 : l ? 1 - l.mix.v : 1;
        h.dx = (h.item.x - front.item.x) * (spread - 1) * k;
        h.dy = (h.item.y - front.item.y) * (spread - 1) * k;
        h.s = 1 + (grow - 1) * k;
      }
    } else if (fStep && !front) for (const h of hung) { h.dx = h.dy = 0; h.s = 1; }

    for (const h of hung) if (updateLift(h, dt)) dirty = true;

    if (dirty) {
      dirty = false;
      // the peek shrinks the focused photo a little about its own centre
      const pk = front ? 1 - 0.035 * peekMix.v : 1;
      const fx = front ? front.item.x : view.x, fy = front ? front.item.y : view.y;
      renderVis = view.vis / pk;
      camera.position.set(fx - (fx - view.x) / pk, fy - (fy - view.y) / pk, renderVis / 2 / tanHalf);
      camera.near = camera.position.z - 400; camera.far = camera.position.z + 50;
      camera.updateProjectionMatrix();
      // the wall moved under a still mouse: re-check what it is over
      if (moved && mouse) hoverAt(mouse.x, mouse.y, false);
      draw();
      if (assetsReady && !shownWall) {
        shownWall = true;
        document.documentElement.classList.add("loaded");
        // hold the overview while the wall fades in, then zoom to the resting view
        if (introTo) { anim = { from: { ...view }, to: introTo, t0: now + 1100, dur: 1800, smooth: true }; introTo = null; }
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

