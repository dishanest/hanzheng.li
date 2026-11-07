// Builds the hung frames: moulding, mat, photo, inner shade, wall shadow.
import * as THREE from "three";
import { frame as st, sweep, matProfiles, MAT_T, type MaterialSet } from "./frames";
import type { Placed } from "./layout";

const PHOTO_Z = 8;
// light comes from the upper left
const LIGHT = new THREE.Vector2(-0.55, 0.83).normalize();

export interface Hung {
  item: Placed;
  group: THREE.Group;
  hit: THREE.Mesh; // invisible plane for picking
  shadow: THREE.Mesh;
  lift: number; // current hover lift
  liftTarget: number;
  shadowBase: { x: number; y: number };
}

/** Soft drop shadow: a blurred rectangle drawn with canvas shadowBlur (works in every browser). */
function shadowTexture(w: number, h: number, blur: number, alpha: number): THREE.CanvasTexture {
  const scale = 0.5; // texture px per wall unit
  const pad = blur * 2.2;
  const cw = Math.ceil((w + pad * 2) * scale), ch = Math.ceil((h + pad * 2) * scale);
  const c = document.createElement("canvas");
  c.width = cw; c.height = ch;
  const g = c.getContext("2d")!;
  g.shadowColor = `rgba(20,16,12,${alpha})`;
  g.shadowBlur = blur * scale;
  g.shadowOffsetX = cw * 4; // draw the rect off-canvas so only its shadow lands
  g.fillStyle = "#000";
  g.fillRect(pad * scale - cw * 4, pad * scale, w * scale, h * scale);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Shade cast by the moulding onto the mat/photo: darker along the top and left inner edges. */
function innerShadeTexture(w: number, h: number, depth: number): THREE.CanvasTexture {
  const scale = 0.5;
  const cw = Math.max(8, Math.ceil(w * scale)), ch = Math.max(8, Math.ceil(h * scale));
  const c = document.createElement("canvas");
  c.width = cw; c.height = ch;
  const g = c.getContext("2d")!;
  const reach = Math.min(depth * 0.9, Math.min(w, h) * 0.3) * scale;
  const edge = (x0: number, y0: number, x1: number, y1: number, a: number) => {
    const gr = g.createLinearGradient(x0, y0, x1, y1);
    gr.addColorStop(0, `rgba(25,20,15,${a})`);
    gr.addColorStop(0.35, `rgba(25,20,15,${a * 0.35})`);
    gr.addColorStop(1, "rgba(25,20,15,0)");
    g.fillStyle = gr;
    g.fillRect(0, 0, cw, ch);
  };
  const k = Math.min(1, depth / 40);
  edge(0, 0, reach, 0, 0.42 * k);              // left
  edge(0, 0, 0, reach, 0.5 * k);               // top
  edge(cw, 0, cw - reach * 0.4, 0, 0.14 * k);  // right, faint
  edge(0, ch, 0, ch - reach * 0.4, 0.12 * k);  // bottom, faint
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function hang(items: Placed[], mats: MaterialSet, loader: THREE.TextureLoader, maxAniso: number, onPhoto: () => void): Hung[] {
  return items.map((item) => {
    const { photo } = item;
    const group = new THREE.Group();
    group.position.set(item.x, item.y, 0);
    const pa = item.pw / 2, pb = item.ph / 2;

    // photo + placeholder colour that fades out when the photo arrives
    const photoMat = new THREE.MeshBasicMaterial({ color: 0xf6f6f6, toneMapped: false });
    const bleed = photo.mat > 0 || st.overlap > 0 ? 6 : 0; // hidden under the mat or lip
    const ph = new THREE.Mesh(new THREE.PlaneGeometry(item.pw + bleed, item.ph + bleed), photoMat);
    ph.position.z = PHOTO_Z - 0.2;
    group.add(ph);
    const veil = new THREE.Mesh(
      new THREE.PlaneGeometry(item.pw + bleed, item.ph + bleed),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(photo.avg), transparent: true, opacity: 1, depthWrite: false, toneMapped: false }),
    );
    veil.position.z = PHOTO_Z - 0.1;
    group.add(veil);
    loader.load(`${import.meta.env.BASE_URL}photos/${photo.file}`, (t) => {
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = maxAniso;
      photoMat.map = t;
      photoMat.color.set(0xf4f4f4); // prints are a touch below paper white
      photoMat.needsUpdate = true;
      const start = performance.now();
      const fade = () => {
        const k = Math.min(1, (performance.now() - start) / 600);
        (veil.material as THREE.MeshBasicMaterial).opacity = 1 - k;
        onPhoto();
        if (k < 1) requestAnimationFrame(fade); else veil.visible = false;
      };
      fade();
    });

    // mat
    let openA = pa, openB = pb;
    if (photo.mat > 0) {
      for (const part of matProfiles(photo.mat, PHOTO_Z)) {
        group.add(new THREE.Mesh(sweep(part.pts, pa, pb), mats[part.mat]));
      }
      openA += photo.mat; openB += photo.mat;
    }
    openA -= st.overlap; openB -= st.overlap;
    const matZ = PHOTO_Z + (photo.mat > 0 ? MAT_T : 0);

    // moulding
    for (const part of st.parts(matZ)) {
      const m = new THREE.Mesh(sweep(part.pts, openA, openB), mats[part.mat]);
      group.add(m);
    }

    // inner shade over mat + photo
    const shadeW = openA * 2, shadeH = openB * 2;
    const shade = new THREE.Mesh(
      new THREE.PlaneGeometry(shadeW, shadeH),
      new THREE.MeshBasicMaterial({ map: innerShadeTexture(shadeW, shadeH, st.depth - matZ), transparent: true, depthWrite: false, toneMapped: false }),
    );
    shade.position.z = matZ + 2.7;
    group.add(shade);

    // wall shadow
    const ow = item.outerW, oh = item.outerH;
    const blur = 10 + st.depth * 0.55;
    const sh = new THREE.Mesh(
      new THREE.PlaneGeometry(ow + blur * 4.4, oh + blur * 4.4),
      new THREE.MeshBasicMaterial({ map: shadowTexture(ow, oh, blur, 0.5), transparent: true, depthWrite: false, toneMapped: false }),
    );
    const off = st.depth * 0.32;
    const shadowBase = { x: item.x - LIGHT.x * off, y: item.y - LIGHT.y * off };
    sh.position.set(shadowBase.x, shadowBase.y, 0.3);
    sh.renderOrder = -1;

    const hit = new THREE.Mesh(new THREE.PlaneGeometry(ow, oh), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.z = st.depth;
    hit.userData.index = item.index;
    group.add(hit);

    return { item, group, hit, shadow: sh, lift: 0, liftTarget: 0, shadowBase };
  });
}

/** Ease hover lift; returns true while still moving. */
export function updateLift(h: Hung, dt: number): boolean {
  const k = 1 - Math.exp(-dt * 14);
  h.lift += (h.liftTarget - h.lift) * k;
  h.group.position.z = h.lift;
  const off = (st.depth + h.lift) * 0.32;
  h.shadow.position.set(h.item.x - LIGHT.x * off, h.item.y - LIGHT.y * off, 0.3);
  const s = 1 + h.lift * 0.004;
  h.shadow.scale.set(s, s, 1);
  (h.shadow.material as THREE.MeshBasicMaterial).opacity = 1 - h.lift * 0.03;
  return Math.abs(h.liftTarget - h.lift) > 0.01;
}
