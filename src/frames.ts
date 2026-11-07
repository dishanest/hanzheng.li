// Gallery frames: a thin matte-black moulding swept around a bevel-cut mat.
// Units are wall units, roughly millimetres. +z points out of the wall.
import * as THREE from "three";

/** One point of a profile. u = distance out from the opening, z = height off the wall. */
interface P { u: number; z: number; hard?: boolean }

export interface Part { pts: P[]; mat: string }

const h = (u: number, z: number): P => ({ u, z, hard: true });
const p = (u: number, z: number): P => ({ u, z });

function arc(cu: number, cz: number, r: number, a0: number, a1: number, n: number): P[] {
  const out: P[] = [];
  for (let i = 0; i <= n; i++) {
    const a = THREE.MathUtils.degToRad(a0 + ((a1 - a0) * i) / n);
    out.push(p(cu + Math.cos(a) * r, cz + Math.sin(a) * r));
  }
  return out;
}

/** The moulding: 20 mm face, 32 mm deep, slightly eased edges, lip overlapping the mat by 4 mm. */
export const frame = {
  width: 20,
  depth: 32,
  overlap: 4,
  parts: (pz: number): Part[] => [{
    mat: "black",
    pts: [h(0, pz), p(0, 30), ...arc(1.5, 30, 1.5, 180, 90, 3), p(18.5, 31.5), ...arc(18.5, 30, 1.5, 90, 0, 3), h(20, 0)],
  }],
};

/** Mat board with a bevelled window: the white core shows on the 45-degree cut. */
/** Mat board thickness, wall units. */
export const MAT_T = 2.5;

export function matProfiles(width: number, pz: number): Part[] {
  const th = MAT_T;
  return [
    { mat: "matCore", pts: [h(0, pz), h(th, pz + th)] },
    { mat: "mat", pts: [h(th, pz + th), h(width + 6, pz + th)] },
  ];
}

const MAT_GLOW = 0.6;

export interface MaterialSet { [k: string]: THREE.Material }

export function makeMaterials(loader: THREE.TextureLoader): MaterialSet {
  const grain = loader.load(`${import.meta.env.BASE_URL}tex/ebony_nrm.jpg`);
  grain.wrapS = grain.wrapT = THREE.RepeatWrapping;
  return {
    // matte black paint over wood: almost no reflection, a faint grain in the raking light
    black: new THREE.MeshStandardMaterial({
      color: "#0b0b0b", roughness: 0.82, envMapIntensity: 0.35, vertexColors: true,
      normalMap: grain, normalScale: new THREE.Vector2(0.25, 0.25),
    }),
    // Mats are museum white. Under the gallery light alone they rendered grey, so they get a
    // little self-light (emissive) and skip tone mapping, which compressed them toward cream.
    mat: new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 1, vertexColors: true, emissive: "#fbfaf7", emissiveIntensity: MAT_GLOW, toneMapped: false }),
    matCore: new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 1, vertexColors: true, emissive: "#ffffff", emissiveIntensity: MAT_GLOW + 0.05, toneMapped: false }),
  };
}

// ---------- sweep ----------

interface Side { o: [number, number]; t: [number, number]; d: number; L: number }

/**
 * Sweep a profile around a rectangular opening of half-size (a, b).
 * Corners are mitred because every profile row runs from -(L+u) to +(L+u).
 */
export function sweep(pts: P[], a: number, b: number): THREE.BufferGeometry {
  // duplicate hard points so normals split there
  const prof: P[] = [];
  pts.forEach((q, i) => {
    prof.push(q);
    if (q.hard && i > 0 && i < pts.length - 1) prof.push({ ...q });
  });
  const arcLen: number[] = [0];
  for (let i = 1; i < prof.length; i++) arcLen.push(arcLen[i - 1] + Math.hypot(prof[i].u - prof[i - 1].u, prof[i].z - prof[i - 1].z));
  const n2: [number, number][] = prof.map((_, i) => {
    const a0 = prof[Math.max(0, i - 1)], a1 = prof[Math.min(prof.length - 1, i + 1)];
    let du = a1.u - a0.u, dz = a1.z - a0.z;
    const l = Math.hypot(du, dz) || 1; du /= l; dz /= l;
    return [-dz, du];
  });

  // Ambient occlusion baked into vertex colours: darker toward the wall, where less light reaches.
  const zs = prof.map((q) => q.z), zMin = Math.min(...zs), zMax = Math.max(...zs);
  const ao = prof.map((q) => (zMax > zMin ? 0.72 + (0.28 * (q.z - zMin)) / (zMax - zMin) : 1));

  const sides: Side[] = [
    { o: [0, 1], t: [1, 0], d: b, L: a },
    { o: [1, 0], t: [0, -1], d: a, L: b },
    { o: [0, -1], t: [-1, 0], d: b, L: a },
    { o: [-1, 0], t: [0, 1], d: a, L: b },
  ];
  const pos: number[] = [], uv: number[] = [], col: number[] = [], idx: number[] = [];
  const TEX = 260; // wall units per texture repeat

  sides.forEach((sd, si) => {
    const base = pos.length / 3;
    for (let i = 0; i < prof.length; i++) {
      const q = prof[i];
      const half = sd.L + q.u;
      for (const s of [-half, half]) {
        pos.push(sd.o[0] * (sd.d + q.u) + sd.t[0] * s, sd.o[1] * (sd.d + q.u) + sd.t[1] * s, q.z);
        uv.push(s / TEX + si * 0.71, arcLen[i] / TEX);
        col.push(ao[i], ao[i], ao[i]);
      }
    }
    // winding: make the first non-degenerate quad face along its profile normal
    let flip = false;
    for (let i = 0; i < prof.length - 1; i++) {
      const i0 = base + i * 2, i1 = base + (i + 1) * 2;
      const A = new THREE.Vector3().fromArray(pos, i0 * 3), B = new THREE.Vector3().fromArray(pos, i1 * 3), C = new THREE.Vector3().fromArray(pos, (i0 + 1) * 3);
      const nrm = new THREE.Vector3().subVectors(B, A).cross(new THREE.Vector3().subVectors(C, A));
      if (nrm.lengthSq() < 1e-6) continue;
      flip = nrm.dot(new THREE.Vector3(sd.o[0] * n2[i][0], sd.o[1] * n2[i][0], n2[i][1])) < 0;
      break;
    }
    for (let i = 0; i < prof.length - 1; i++) {
      const a0 = base + i * 2, b0 = base + (i + 1) * 2, c0 = a0 + 1, d0 = b0 + 1;
      if (flip) idx.push(a0, c0, b0, b0, c0, d0); else idx.push(a0, b0, c0, b0, d0, c0);
    }
  });

  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
