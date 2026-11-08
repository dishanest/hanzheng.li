// The wall is plain HTML that the page itself scrolls, so panning, momentum and the edge
// rubber band are the browser's own (they track the fingers, which a page cannot see).
// Only the two zooms are scripted: the opening (whole wall to the resting view) and a focused
// photo. Both are a transform on #wall while page scrolling is locked.
import { photos, openingPhoto } from "./photos";
import { layout } from "./layout";
import { frame } from "./frames";

const root = document.documentElement;
history.scrollRestoration = "manual"; // the opening sets the scroll position itself
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const coarse = matchMedia("(pointer: coarse)").matches;
const wall = document.getElementById("wall")!; // holds the scroll size, never transformed
// The wall scrolls in #scroller, a fixed layer under the name, so the name and caption stay put
// while the wall rubber-bands (a scrolling page drags its fixed elements along on a Mac). iOS
// phones scroll the page itself instead: only page content is drawn under Safari's bars there.
const bleed = root.classList.contains("bleed");
const scroller = document.getElementById("scroller")!;
/** Arrow, space and page keys scroll whatever has focus: on desktop that must be #scroller. */
const focusScroller = () => { if (!bleed && !zoomed) scroller.focus({ preventScroll: true }); };
const sc = {
  get x() { return bleed ? window.scrollX : scroller.scrollLeft; },
  get y() { return bleed ? window.scrollY : scroller.scrollTop; },
  to(x: number, y: number) { if (bleed) window.scrollTo(x, y); else scroller.scrollTo(x, y); },
};
// the frames hang on this; the zooms transform it (transforming #wall itself would shrink what
// the page can scroll, and the browser would clamp the scroll position)
const hangEl = document.createElement("div");
hangEl.className = "hang";
wall.append(hangEl);
const captionEl = document.getElementById("caption")!;
const photoInfo = document.getElementById("photo-info")!;

// wide screens: the name fills the bottom for the opening, then shrinks into the corner (style.css)
const desk = root.classList.contains("desk");
let settled = !desk; // phones keep the full-width name throughout
/** `now`: the user took over, so the bio shows at once instead of after the name has shrunk. */
function settle(now = false) {
  if (now) root.classList.add("settled-now");
  if (settled) {
    // the bio is still waiting out its fade-in delay: show it now (a changed delay does not
    // reach a transition that has already started, so restart it with none)
    if (now) { captionEl.style.transition = "none"; void captionEl.offsetWidth; captionEl.style.transition = ""; }
    return;
  }
  settled = true;
  root.classList.add("settled");
}

// ---------- frames ----------
const describe = (p: (typeof photos)[number]) =>
  [p.title, p.camera, p.film ? `${p.film} film` : "", p.place, String(p.year)].filter(Boolean).join(", ") || "Photograph";

const { items, bounds } = layout(photos, openingPhoto, !desk);
const wallW = bounds.maxX - bounds.minX, wallH = bounds.maxY - bounds.minY; // wall units
wall.style.setProperty("--W", String(wallW));
wall.style.setProperty("--H", String(wallH));
wall.style.setProperty("--fw", String(frame.width));

const frames = items.map((it) => {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "frame";
  b.setAttribute("aria-label", describe(it.photo));
  const set = (k: string, v: number | string) => b.style.setProperty(k, String(v));
  set("--x", it.x - it.outerW / 2 - bounds.minX);
  set("--y", bounds.maxY - it.y - it.outerH / 2);
  set("--w", it.outerW);
  set("--h", it.outerH);
  set("--pw", it.pw);
  set("--ph", it.ph);
  set("--avg", it.photo.avg);
  const img = new Image();
  img.alt = "";
  img.decoding = "async";
  img.width = it.photo.w; img.height = it.photo.h;
  img.src = `${import.meta.env.BASE_URL}photos/${it.photo.file}`;
  if (it.photo.mat > 0) img.className = "matted";
  b.append(img);
  hangEl.append(b);
  return { el: b, img, item: it };
});

// ---------- sizes ----------
let vw = 1, vh = 1;
let k = 1; // css px per wall unit at the resting scale
let topPx = 0;
let reserveFull = 0; // full-width name (+ caption row on phones), css px
let reserveSmall = 0; // wide screens once settled: the corner name and the bio beside it, css px
let reserveFocused = 0; // room the caption needs while a photo is focused
const reserve = (s = settled) => (s ? reserveSmall : reserveFull);

/** --pad (style.css) in px: a clamp(), so it is resolved by letting the browser lay out a probe. */
const padProbe = document.createElement("div");
padProbe.style.cssText = "position:absolute;visibility:hidden;width:var(--pad)";
document.body.append(padProbe);
const pad = () => padProbe.offsetWidth;

function measure() {
  vw = bleed ? root.clientWidth : scroller.clientWidth; vh = window.innerHeight;
  // laptop: about a third of the height per frame; phone portrait: 2-3 frames across
  const vis = vw / vh < 0.8 ? (820 * vh) / vw : 1150; // wall units visible vertically
  k = vh / vis;
  topPx = Math.min(vw, vh) * 0.06;
  // full-width height (index.html; wide screens inset it by --pad on each side, style.css)
  const nameH = desk ? (vw - 2 * pad()) * 0.218569 + pad() : vw * 0.218569;
  const lineH = parseFloat(getComputedStyle(captionEl).lineHeight) || 19;
  if (desk) {
    const smallH = parseFloat(getComputedStyle(root).getPropertyValue("--name-small-h")) || 60;
    reserveFull = nameH + 14;
    reserveSmall = Math.max(smallH, lineH * 3) + 18;
    reserveFocused = reserveSmall + (coarse ? 30 : 0); // tablets: home-indicator inset
    centreBio();
  } else {
    reserveFull = reserveSmall = nameH + 14 + lineH * 3 + 18;
    reserveFocused = Math.min(26, Math.max(14, vw * 0.02)) + lineH * 3 + 18 + (coarse ? 30 : 0);
  }
  wall.style.setProperty("--k", String(k));
  // let the wall scroll up past whatever covers the bottom of the screen
  wall.style.setProperty("--reserve", `${reserveFull}px`);
}

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

// ---------- views ----------
// A view puts wall point p (css px on the unscaled wall) at screen point q, at scale s.
// #wall then gets translate(q + scroll - s*p) scale(s), with its origin at the top left.
type View = { px: number; py: number; qx: number; qy: number; s: number };

const centreOf = (it: (typeof items)[number]) => ({ x: (it.x - bounds.minX) * k + wall.offsetLeft, y: (bounds.maxY - it.y) * k });
const opening = frames.find((f) => f.item.photo.file === openingPhoto) ?? frames[0];

/** The plain scrolled page: no transform. */
function identity(): View {
  const qx = vw / 2, qy = vh / 2;
  return { px: qx + sc.x - wall.offsetLeft, py: qy + sc.y, qx, qy, s: 1 };
}
/** Scroll position that centres the opening photo above the bottom row (as it is once settled). */
function restingScroll() {
  const c = centreOf(opening.item);
  const maxX = Math.max(0, wallW * k - vw), maxY = Math.max(0, wallH * k + reserveFull - vh);
  return {
    x: Math.max(0, Math.min(maxX, c.x - vw / 2)),
    y: Math.max(0, Math.min(maxY, c.y - (topPx + vh - reserve(true)) / 2)),
  };
}
/** The whole wall, in the space above the full-width name. */
function wholeWall(): View {
  const availW = vw - topPx * 2, availH = Math.max(vh * 0.3, vh - topPx * 2 - reserveFull);
  const s = Math.min(availW / (wallW * k), availH / (wallH * k));
  return { px: (wallW * k) / 2, py: (wallH * k) / 2, qx: vw / 2, qy: topPx + availH / 2, s };
}
let current: View | null = null; // null: no transform, the page scrolls
function apply(v: View | null) {
  current = v;
  if (!v) { hangEl.style.transform = ""; return; }
  const tx = v.qx + sc.x - wall.offsetLeft - v.s * v.px, ty = v.qy + sc.y - v.s * v.py;
  hangEl.style.transform = `translate(${tx}px, ${ty}px) scale(${v.s})`;
}

let tween: number | null = null;
/** Animate between views: scale moves in log space so the zoom runs at an even visual rate. */
function animate(from: View, to: View, dur: number, smooth: boolean, done?: () => void) {
  if (tween !== null) cancelAnimationFrame(tween);
  if (reduceMotion || dur <= 0) { tween = null; apply(to); done?.(); return; }
  const t0 = performance.now();
  const step = (now: number) => {
    const t = Math.min(1, (now - t0) / dur);
    const e = smooth ? (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2) : 1 - Math.pow(1 - t, 3);
    const s = from.s * Math.pow(to.s / from.s, e);
    const lerp = (a: number, b: number) => a + (b - a) * e;
    apply({ px: lerp(from.px, to.px), py: lerp(from.py, to.py), qx: lerp(from.qx, to.qx), qy: lerp(from.qy, to.qy), s });
    if (t < 1) tween = requestAnimationFrame(step);
    else { tween = null; done?.(); }
  };
  tween = requestAnimationFrame(step);
}

// ---------- opening ----------
let phase: "waiting" | "intro" | "free" = "waiting";
function startOpening() {
  measure();
  const rest = restingScroll();
  sc.to(rest.x, rest.y);
  focusScroller();
  if (reduceMotion) { finishOpening(); return; }
  root.classList.add("locked");
  if (!coarse) {
    // one composited layer for the zoom, drawn at full size first: the browser then scales a
    // finished picture instead of repainting 50 frames and their shadows every frame, and it
    // stays sharp as it grows (a layer first drawn zoomed out would be blurry when it lands)
    hangEl.style.willChange = "transform";
    requestAnimationFrame(() => requestAnimationFrame(() => { if (phase !== "free" && !current) apply(wholeWall()); }));
    return;
  }
  apply(wholeWall());
}
function runOpening() {
  if (phase !== "waiting") return;
  phase = "intro";
  window.setTimeout(() => {
    if (phase !== "intro") return;
    const from = current ?? wholeWall(); // photos came from cache before the zoomed-out view was set
    settle();
    animate(from, identity(), 1800, true, finishOpening);
  }, 1100);
}
function finishOpening() {
  phase = "free";
  if (tween !== null) { cancelAnimationFrame(tween); tween = null; }
  apply(null);
  hangEl.style.willChange = "";
  root.classList.remove("locked");
  settle();
  focusScroller();
}
/** The user took over during the opening: land on the resting view straight away. */
function interruptOpening() {
  if (phase === "free") return false;
  const from = current;
  phase = "free";
  settle(true);
  if (from && !reduceMotion) animate(from, identity(), 350, false, finishOpening);
  else finishOpening();
  return true;
}

// the wall fades in once its photos are in (or after 4 s, whichever is first)
let pending = frames.length;
const reveal = () => {
  if (root.classList.contains("loaded")) return;
  // photos from cache can arrive before the zoomed-out view is set: set it before showing the wall
  if (phase === "waiting" && !current && !reduceMotion) apply(wholeWall());
  root.classList.add("loaded");
  runOpening();
};
for (const f of frames) {
  const done = () => { f.img.classList.add("in"); if (--pending <= 0) reveal(); };
  if (f.img.complete && f.img.naturalWidth) done();
  else { f.img.addEventListener("load", done, { once: true }); f.img.addEventListener("error", done, { once: true }); }
}
window.setTimeout(reveal, 4000);

// ---------- focus ----------
// Clicking a frame brings it to the centre while every other frame flies outward from it and
// fades, leaving the photo alone above the name and its details. Scrolling does nothing there.
// Clicking the photo again opens it full screen in its own native scroller (pan with the
// browser's own momentum and edge bounce); clicking that, or anywhere off the photo, steps back.
type Frame = (typeof frames)[number];
let zoomed: Frame | null = null;
let peeking = false; // focused, and the pointer is off the photo
let peekUntil = 0;
let detail: HTMLDivElement | null = null;
const FOCUS_MS = 300; // the focused frame's transition in style.css (.frame) matches this
let busyUntil = 0; // a focus move is running: clicks wait for it (they would read moving rects)
const busy = () => performance.now() < busyUntil;
let movingTimer = 0, idleTimer = 0, bigTimer = 0;
/** A focus move starts: clicks wait for it, frames get their own layers, the hover peek pauses. */
function startMove() {
  busyUntil = performance.now() + FOCUS_MS + 60; // + the two frames a still() swap takes
  root.classList.add("moving");
  root.classList.remove("focus-idle");
  clearTimeout(movingTimer); clearTimeout(idleTimer); clearTimeout(bigTimer);
  movingTimer = window.setTimeout(() => root.classList.remove("moving"), 650); // the others' 0.55 s
  // sharpen as soon as the focused frame stops; the others can still be drifting away
  bigTimer = window.setTimeout(() => {
    if (zoomed && !detail && desk) setBig(zoomed); // phones: no hover peek, and a large layer costs memory
  }, reduceMotion ? 0 : FOCUS_MS + 40); // + the frame the transition can start late
  idleTimer = window.setTimeout(() => {
    if (zoomed && !detail) root.classList.add("focus-idle");
  }, 600);
}

/** Untransformed screen rect of a frame at the wall's scale (its place on the scrolled page). */
function homeRect(f: Frame, u = k) {
  const w = wall.getBoundingClientRect(), it = f.item;
  return {
    x: w.left + (it.x - it.outerW / 2 - bounds.minX) * u, y: w.top + (bounds.maxY - it.y - it.outerH / 2) * u,
    w: it.outerW * u, h: it.outerH * u,
  };
}
/** Where a focused frame sits: as large as fits above the caption row, centred in that space. */
function focusTarget(f: Frame) {
  const t = Math.min(vw, vh) * 0.06;
  const availH = Math.max(vh * 0.3, vh - t - reserveFocused - 12), availW = vw - t * 2;
  const r = homeRect(f);
  const s = Math.min(availW / r.w, availH / r.h);
  return { r, s, cx: vw / 2, cy: t + availH / 2 };
}
// A frame scaled up by transform is drawn at its small size and magnified, so it blurs whenever
// it animates. Once a focus move has finished, the focused frame is laid out at its focused size
// instead (its own --u), with no scale: then the hover peek shrinks a sharp picture.
let bigFrame: Frame | null = null;
let bigU = 0; // the big frame's --u
/** css px per wall unit the frame is laid out at now */
const unitOf = (f: Frame) => (bigFrame === f ? bigU : k);
/** Change a frame's transform with no transition. The transition comes back two frames later:
 *  Safari animates from the last painted value if it is restored in the same frame. */
const stillCount = new Map<Frame, number>(); // overlapping still() calls on one frame
function still(f: Frame, change: () => void) {
  stillCount.set(f, (stillCount.get(f) ?? 0) + 1);
  f.el.classList.add("still");
  change();
  getComputedStyle(f.el).transform;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const n = (stillCount.get(f) ?? 1) - 1;
    stillCount.set(f, n);
    if (n <= 0) f.el.classList.remove("still");
  }));
}
/** Lay the focused frame out at its focused size (sharp), from scaled-up; looks the same. */
function setBig(f: Frame) {
  if (bigFrame === f) return;
  still(f, () => { bigFrame = f; placeFocused(f, peeking, true); });
}
/** Back to the wall's scale, with no visible change (after it has been moved home). */
function unBig(f: Frame) {
  if (bigFrame !== f) return;
  still(f, () => { bigFrame = null; f.el.style.removeProperty("--u"); f.el.style.transform = ""; });
}
/** `peek`: the pointer is off the photo, so the others edge back in and the photo gives way a little. */
function placeFocused(f: Frame, peek = false, onlyFocused = false) {
  const { r, s: fit, cx, cy } = focusTarget(f);
  const fx = r.x + r.w / 2, fy = r.y + r.h / 2;
  if (bigFrame === f) {
    bigU = k * fit;
    f.el.style.setProperty("--u", `${bigU}px`);
    const b = homeRect(f, bigU);
    f.el.style.transform = `translate(${cx - (b.x + b.w / 2)}px, ${cy - (b.y + b.h / 2)}px) scale(${peek ? 0.965 : 1})`;
  } else {
    f.el.style.transform = `translate(${cx - fx}px, ${cy - fy}px) scale(${peek ? fit * 0.965 : fit})`;
  }
  if (onlyFocused) return;
  // the rest drift outward from it, a little larger, while they fade: out of its way, not off
  // the screen in one jump (as in the reference video)
  const push = (0.35 + (fit - 1) * 0.25) * (peek ? 0.9 : 1);
  for (const g of frames) {
    if (g === f) continue;
    const q = homeRect(g), gx = q.x + q.w / 2, gy = q.y + q.h / 2;
    g.el.style.transform = `translate(${cx - fx + (gx - fx) * push}px, ${cy - fy + (gy - fy) * push}px) scale(1.15)`;
  }
}

const stop = (t: string) => (!t || /[.!?]$/.test(t) ? t : `${t}.`); // end a phrase with one period
function showInfo(f: Frame) {
  // title / camera · stock / place, year, skipping whatever is not filled in yet
  const p = f.item.photo;
  const lines = [
    p.title ? `<em>${p.title}</em>` : "",
    [p.camera, p.film].filter(Boolean).map(stop).join(" "),
    stop([p.place, p.year].filter(Boolean).join(", ")),
  ].filter(Boolean);
  photoInfo.innerHTML = lines.join("<br>");
}
function focusOn(f: Frame) {
  if (phase !== "free" || tween !== null) finishOpening();
  if (bigFrame && bigFrame !== f) unBig(bigFrame); // still shrinking home from the last focus
  for (const g of frames) {
    if (g !== f) { g.el.classList.remove("focused"); g.el.inert = true; } // hidden frames are not Tab stops
  }
  startMove();
  peeking = false;
  root.classList.remove("peek");
  zoomed = f;
  root.classList.add("locked", "zoomed", "focusing");
  f.el.classList.add("focused");
  showInfo(f);
  placeFocused(f);
}
function leaveFocus() {
  if (!zoomed) return;
  if (detail) { leaveDetail(); return; }
  const f = zoomed;
  zoomed = null;
  startMove();
  root.classList.remove("zoomed", "peek", "focus-idle");
  for (const g of frames) { if (g !== f) g.el.style.transform = ""; g.el.inert = false; }
  if (bigFrame === f) {
    // still laid out large: shrink it onto its place on the wall, then drop the large layout
    const hs = homeRect(f), hb = homeRect(f, bigU);
    f.el.style.transform = `translate(${hs.x + hs.w / 2 - (hb.x + hb.w / 2)}px, ${hs.y + hs.h / 2 - (hb.y + hb.h / 2)}px) scale(${k / bigU})`;
  } else f.el.style.transform = "";
  window.setTimeout(() => {
    if (zoomed !== f) unBig(f);
    if (zoomed) return; // focused again meanwhile
    f.el.classList.remove("focused");
    root.classList.remove("locked", "focusing");
    focusScroller();
  }, reduceMotion ? 0 : FOCUS_MS);
}

/** Full screen: the photo alone, larger than the screen, in a native scroller. */
function enterDetail(f: Frame, clickX: number, clickY: number) {
  startMove();
  const r = photoRect(f); // on screen now, with the focus transform
  const cover = Math.max(vw / r.width, vh / r.height);
  const m = cover; // aspect fill: the photo just covers the screen, panning along its longer side
  const W = r.width * m, H = r.height * m;
  // keep the point under the pointer where it is
  const fx = (clickX - r.left) / r.width, fy = (clickY - r.top) / r.height;
  const sx = Math.max(0, Math.min(W - vw, fx * W - clickX)), sy = Math.max(0, Math.min(H - vh, fy * H - clickY));
  // grow the focused frame until its photo covers that rect, then hand over to the scroller.
  // Works in whichever size the frame is laid out at (large once settled, wall size before).
  const s = parseScale(f.el), cur = parseTranslate(f.el);
  const home = homeRect(f, unitOf(f)), hx = home.x + home.w / 2, hy = home.y + home.h / 2;
  const s2 = s * m;
  // photo's top left in frame space (relative to the frame's centre, untransformed)
  const ox = (r.left - (hx + cur.x)) / s, oy = (r.top - (hy + cur.y)) / s;
  f.el.style.transform = `translate(${-sx - hx - s2 * ox}px, ${-sy - hy - s2 * oy}px) scale(${s2})`;
  const d = document.createElement("div");
  d.className = "detail";
  d.tabIndex = -1; // focusable, so arrow keys scroll it
  const img = new Image();
  img.src = f.img.src;
  img.alt = "";
  img.style.width = `${W}px`; img.style.height = `${H}px`;
  d.append(img);
  detail = d;
  // decoded first, so Safari does not show the overlay's low-resolution tiles while it paints
  // (at most 500 ms more: a slow decode must not leave the scaled frame on screen)
  const decoded = Promise.race([img.decode().catch(() => {}), new Promise((r) => setTimeout(r, 500))]);
  window.setTimeout(() => decoded.then(() => {
    if (detail !== d) return;
    document.body.append(d);
    d.scrollTo(sx, sy);
    d.focus({ preventScroll: true });
  }), reduceMotion ? 0 : FOCUS_MS);
}
function leaveDetail() {
  const d = detail, f = zoomed;
  if (!d || !f) return;
  detail = null;
  if (d.isConnected) {
    // put the frame exactly where the scrolled photo is, then let it settle back
    const r = photoRect(f), W = d.scrollWidth;
    const k2 = W / r.width, cur = parseTranslate(f.el), sNow = parseScale(f.el);
    const home = homeRect(f, unitOf(f)), hx = home.x + home.w / 2, hy = home.y + home.h / 2;
    const ox = (r.left - (hx + cur.x)) / sNow, oy = (r.top - (hy + cur.y)) / sNow;
    const s2 = sNow * k2;
    // put the frame where the scrolled photo is, show it, then let it settle back next frame
    still(f, () => { f.el.style.transform = `translate(${-d.scrollLeft - hx - s2 * ox}px, ${-d.scrollTop - hy - s2 * oy}px) scale(${s2})`; });
    d.remove();
    startMove();
    requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => { if (zoomed === f && !detail) placeFocused(f, peeking); })));
    f.el.focus({ preventScroll: true });
    return;
  }
  startMove();
  placeFocused(f);
  f.el.focus({ preventScroll: true });
}
/** The print itself on screen: the img box minus the mat's bevel border. */
function photoRect(f: Frame) {
  const r = f.img.getBoundingClientRect();
  const b = (f.img.offsetWidth - f.img.clientWidth) / 2 * (r.width / f.img.offsetWidth);
  return { left: r.left + b, top: r.top + b, width: r.width - 2 * b, height: r.height - 2 * b };
}
const parseTranslate = (el: HTMLElement) => {
  const m = /translate\(([-\d.e]+)px, ([-\d.e]+)px\)/.exec(el.style.transform);
  return { x: m ? +m[1] : 0, y: m ? +m[2] : 0 };
};
const parseScale = (el: HTMLElement) => +(/scale\(([-\d.e]+)\)/.exec(el.style.transform)?.[1] ?? 1);

wall.addEventListener("click", (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>(".frame");
  const f = el && frames.find((x) => x.el === el);
  if (phase === "waiting" || busy()) return;
  if (phase === "intro" && !f) { interruptOpening(); return; }
  if (zoomed) {
    // a keyboard Enter has no pointer position: zoom on the photo's centre
    const pr = photoRect(f ?? zoomed);
    const cx = e.detail === 0 ? pr.left + pr.width / 2 : e.clientX, cy = e.detail === 0 ? pr.top + pr.height / 2 : e.clientY;
    if (f === zoomed && !detail) {
      // the photo may still be easing back from the peek: zoom from where it lands
      const wait = Math.max(0, peekUntil - performance.now());
      const go = () => { if (zoomed === f && !detail) enterDetail(f, cx, cy); };
      if (wait) { busyUntil = performance.now() + wait; window.setTimeout(go, wait); } else go();
    }
    else leaveFocus();
    return;
  }
  if (f) focusOn(f);
});
document.addEventListener("click", (e) => {
  const t = e.target as HTMLElement;
  if (t.closest("a") || busy()) return;
  if (detail && detail.contains(t)) { leaveDetail(); return; }
  if (zoomed && !wall.contains(t)) leaveFocus();
});

// while the page is locked (the opening, or a focused photo) scrolling does nothing; during the
// opening it lands the zoom at once. The full-screen photo scrolls itself. The listeners exist only
// while locked: a non-passive wheel or touch listener makes the browser wait on script before every
// native scroll, which is the smoothness this page is built on.
function onWheel(e: WheelEvent) {
  if (e.ctrlKey || detail?.contains(e.target as Node)) return;
  e.preventDefault();
  interruptOpening();
}
function onTouchMove(e: TouchEvent) {
  if (detail?.contains(e.target as Node)) return;
  e.preventDefault();
  interruptOpening();
}
new MutationObserver(() => {
  const on = root.classList.contains("locked");
  if (on) { window.addEventListener("wheel", onWheel, { passive: false }); window.addEventListener("touchmove", onTouchMove, { passive: false }); }
  else { window.removeEventListener("wheel", onWheel); window.removeEventListener("touchmove", onTouchMove); }
}).observe(root, { attributes: true, attributeFilter: ["class"] });
// hovering off the focused photo hints at the way back: the others edge in, the photo gives way
window.addEventListener("pointermove", (e) => {
  if (e.pointerType !== "mouse" || !zoomed || detail || busy()) return;
  const over = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest(".frame") === zoomed.el;
  if (over === !peeking) return;
  peeking = !over;
  peekUntil = performance.now() + 420; // the peek eases for 0.4 s: the photo's rect is moving
  root.classList.toggle("peek", peeking);
  placeFocused(zoomed, peeking);
});
root.addEventListener("mouseleave", () => {
  if (!peeking || !zoomed || detail) return;
  peeking = false; root.classList.remove("peek"); placeFocused(zoomed);
});

// Safari on a Mac locks trackpad scrolling to one axis once a swipe leans that way, so a
// diagonal swipe only moves straight. The wheel events still carry both deltas. Once a frame
// shows the browser dropped an axis that the swipe clearly has, every following event in that
// swipe adds that axis itself, as it arrives, so both axes move together each frame. Rubber-
// banding stays native on the axis Safari kept. (Chrome moves both axes, so nothing is added.)
let fill: "x" | "y" | null = null; // the axis being added for the current swipe
let lastWheel = 0, frameSum = { x: 0, y: 0 }, added = { x: 0, y: 0 }, frameFrom: { x: number; y: number } | null = null;
function insideBounds() {
  const maxX = scroller.scrollWidth - scroller.clientWidth, maxY = scroller.scrollHeight - scroller.clientHeight;
  return sc.x >= 0 && sc.y >= 0 && sc.x <= maxX && sc.y <= maxY;
}
if (!bleed) scroller.addEventListener("wheel", (e) => {
  if (e.ctrlKey || e.shiftKey || root.classList.contains("locked") || e.deltaMode !== 0) return;
  const now = performance.now();
  if (now - lastWheel > 150) fill = null; // a new swipe
  lastWheel = now;
  if (fill && insideBounds()) {
    const dx = fill === "x" ? e.deltaX : 0, dy = fill === "y" ? e.deltaY : 0;
    scroller.scrollBy(dx, dy);
    added.x += dx; added.y += dy;
  }
  frameSum.x += e.deltaX; frameSum.y += e.deltaY;
  if (frameFrom) return;
  frameFrom = { x: sc.x, y: sc.y };
  requestAnimationFrame(() => {
    const moved = { x: sc.x - frameFrom!.x - added.x, y: sc.y - frameFrom!.y - added.y }; // the browser's own share
    const want = frameSum;
    frameFrom = null; frameSum = { x: 0, y: 0 }; added = { x: 0, y: 0 };
    if (root.classList.contains("locked")) return;
    if (fill) {
      if (Math.abs(fill === "x" ? moved.x : moved.y) > 0.5) fill = null; // the browser moves it again
      return;
    }
    // a real diagonal only: the minor axis must be a fair share of the major one, not noise
    const ax = Math.abs(want.x), ay = Math.abs(want.y);
    if (ax > 2 && ax > 0.25 * ay && Math.abs(moved.x) < 0.5 && Math.abs(moved.y) > 0.5) fill = "x";
    else if (ay > 2 && ay > 0.25 * ax && Math.abs(moved.y) < 0.5 && Math.abs(moved.x) > 0.5) fill = "y";
    // catch up this frame's share so the switch-over does not lag
    if (fill && insideBounds()) scroller.scrollBy(fill === "x" ? want.x : 0, fill === "y" ? want.y : 0);
  });
}, { passive: true });

window.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === "Escape") { if (busy()) return; if (detail) leaveDetail(); else leaveFocus(); return; }
  if (root.classList.contains("locked") && !detail?.isConnected && /^(Arrow|Page|Home|End| $)/.test(e.key)) { e.preventDefault(); interruptOpening(); }
});

// ---------- resize ----------
let resizeQueued = false;
window.addEventListener("resize", () => {
  if (resizeQueued) return;
  resizeQueued = true;
  requestAnimationFrame(() => {
    resizeQueued = false;
    // Safari's toolbar collapsing while scrolling changes only the height: rescaling then would
    // stop the native momentum and move the wall under the finger
    if (coarse && phase === "free" && !zoomed && (bleed ? root.clientWidth : scroller.clientWidth) === vw) return;
    // keep the wall point at the screen centre where it is
    const oldK = k, cx = (sc.x + vw / 2 - wall.offsetLeft) / oldK, cy = (sc.y + vh / 2) / oldK;
    measure();
    if (phase === "waiting") { startOpening(); return; }
    if (phase === "intro") { finishOpening(); }
    sc.to(cx * k + wall.offsetLeft - vw / 2, cy * k - vh / 2);
    if (zoomed) {
      if (detail) { detail.remove(); detail = null; }
      const z = zoomed;
      still(z, () => placeFocused(z, peeking)); // a large frame is laid out again at the new size
    }
  });
});

// ---------- start ----------
document.fonts.load('400 100px "Geist Serif"').catch(() => {}).finally(() => {
  startOpening();
  root.classList.add("ready");
  // the caption's line height depends on the web font: re-measure once it has loaded
  document.fonts.ready.then(() => { if (phase !== "intro") measure(); });
});
