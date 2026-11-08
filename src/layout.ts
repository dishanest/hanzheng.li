// Salon hang: one dense, even-gapped mass of frames with edges aligned to their neighbours.
// Frames are placed in small groups that each grow around their own centre, so the wall reads
// as hung by hand rather than in rows. Seeded, so the wall is the same on every visit.
import type { Photo } from "./photos";
import { frame } from "./frames";

export interface Placed {
  photo: Photo;
  index: number;
  x: number; // centre on the wall (y points up)
  y: number;
  pw: number; // photo size
  ph: number;
  outerW: number;
  outerH: number;
}

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const GAP = 45; // between neighbouring frames
const ASPECT = 1.6; // the wall grows about this much wider than tall

type Box = { x: number; y: number; w: number; h: number; c: number };

/**
 * @param anchor the photo the opening view centres on. It hangs first, at the origin.
 * @param floor true: nothing hangs below the anchor, so on phones the full-width name under the
 *   opening view covers no other frame. false: the wall grows around the anchor, which sits mid wall.
 */
export function layout(list: Photo[], anchor?: string, floor = true, seed = 7): { items: Placed[]; bounds: { minX: number; maxX: number; minY: number; maxY: number } } {
  const rand = rng(seed);
  const sized = list.map((photo, index) => {
    let long = 230 + rand() * 110;
    if (rand() < 0.15) long += 60; // the odd hero piece
    const ar = photo.w / photo.h;
    const pw = ar >= 1 ? long : long * ar;
    const ph = ar >= 1 ? long / ar : long;
    const border = photo.mat * 2 + frame.width * 2 - frame.overlap * 2;
    return { photo, index, pw, ph, outerW: pw + border, outerH: ph + border };
  });

  // anchor first, then the rest in list order, cut into clusters of 4 to 7
  const order = [...sized];
  const ai = order.findIndex((s) => s.photo.file === anchor);
  if (ai > 0) order.unshift(...order.splice(ai, 1));
  const cluster: number[] = [];
  for (let c = 0, i = 0; i < order.length; c++) {
    const n = 4 + Math.floor(rand() * 4);
    for (let k = 0; k < n && i < order.length; k++, i++) cluster.push(c);
  }

  // target size of the whole wall, used to keep the growth compact around one centre
  const area = order.reduce((a, s) => a + (s.outerW + GAP) * (s.outerH + GAP), 0) * 1.35;
  const wallH = Math.sqrt(area / ASPECT);

  const boxes: Box[] = [];
  const collides = (b: Box) => boxes.some((o) => {
    const g = GAP - 0.5;
    return Math.abs(o.x - b.x) * 2 < o.w + b.w + g * 2 && Math.abs(o.y - b.y) * 2 < o.h + b.h + g * 2;
  });

  let floorY = -Infinity; // bottom edge of the anchor when `floor` is set; nothing hangs below it
  const centre = { x: 0, y: 0 };
  order.forEach((s, i) => {
    const c = cluster[i];
    const w = s.outerW, h = s.outerH;
    if (i === 0) {
      boxes.push({ x: 0, y: 0, w, h, c });
      if (floor) { floorY = -h / 2; centre.y = floorY + wallH / 2; }
      return;
    }
    const mates = boxes.filter((o) => o.c === c);
    const neighbours = mates.length ? mates : boxes; // a new cluster starts beside any frame
    // the wall centre pulls hardest, keeping the wall dense; the group centre adds a little variety
    const pull = mates.length
      ? { x: mates.reduce((a, o) => a + o.x, 0) / mates.length, y: mates.reduce((a, o) => a + o.y, 0) / mates.length }
      : centre;
    let best: Box | null = null, bestCost = Infinity;
    const search = (near: Box[]) => { for (const o of near) {
      const g = GAP;
      const dx = (o.w + w) / 2 + g, dy = (o.h + h) / 2 + g;
      // beside it: top, middle or bottom aligned; above or below it: left, centre or right aligned
      const ys = [o.y + (o.h - h) / 2, o.y, o.y - (o.h - h) / 2];
      const xs = [o.x - (o.w - w) / 2, o.x, o.x + (o.w - w) / 2];
      const cands: [number, number][] = [
        ...ys.map((y) => [o.x - dx, y] as [number, number]),
        ...ys.map((y) => [o.x + dx, y] as [number, number]),
        ...xs.map((x) => [x, o.y + dy] as [number, number]),
        ...xs.map((x) => [x, o.y - dy] as [number, number]),
      ];
      for (const [x, y] of cands) {
        if (y - h / 2 < floorY - 0.5) continue;
        const b = { x, y, w, h, c };
        if (collides(b)) continue;
        const local = Math.hypot((x - pull.x) / 1.2, y - pull.y);
        const global = Math.hypot((x - centre.x) / ASPECT, y - centre.y);
        const cost = (mates.length ? local + global * 6 : global) + rand() * 25;
        if (cost < bestCost) { bestCost = cost; best = b; }
      }
    } };
    search(neighbours);
    // a cluster boxed in on every side: let the frame start beside any other frame instead
    if (!best) search(boxes);
    // last resort, never hit in practice: hang it clear above everything
    if (!best) best = { x: 0, y: Math.max(...boxes.map((o) => o.y + o.h / 2)) + GAP + h / 2, w, h, c };
    boxes.push(best);
  });

  const items: Placed[] = order.map((s, i) => ({ ...s, x: boxes[i].x, y: boxes[i].y }));
  // centre the wall's height on y = 0
  const minY = Math.min(...items.map((it) => it.y - it.outerH / 2));
  const maxY = Math.max(...items.map((it) => it.y + it.outerH / 2));
  for (const it of items) it.y -= (minY + maxY) / 2;
  items.sort((a, b) => a.index - b.index);

  const margin = 150;
  const bounds = {
    minX: Math.min(...items.map((it) => it.x - it.outerW / 2)) - margin,
    maxX: Math.max(...items.map((it) => it.x + it.outerW / 2)) + margin,
    minY: Math.min(...items.map((it) => it.y - it.outerH / 2)) - margin,
    maxY: Math.max(...items.map((it) => it.y + it.outerH / 2)) + margin,
  };
  return { items, bounds };
}
