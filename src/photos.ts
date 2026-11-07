// Photos from the "TO SHARE/Site" album in Photos (exported 2026-11-06, resized to 1200px).
// Film stock (from the lab's filenames), year (from the scan date), title, camera and place live
// in photo-details.json; the caption shows whichever are set. Every photo hangs in
// the same matte-black gallery frame. Mats are chosen per photo: busy, bold or graphic images go
// edge to edge (0); quiet ones with small subjects get wide mats; the rest sit in between.
import details from "./photo-details.json";

export interface Details {
  title: string;
  camera: string;
  film: string;
  place: string;
  year: number;
  roll?: string; // id in rolls.json; set on /rolls.html (dev only)
}

export interface Photo extends Details {
  file: string;
  w: number;
  h: number;
  avg: string;
  mat: number; // mat width in wall units (mm-ish); 0 = no mat, the frame lip sits on the print
}

/** The photo the page opens centred on (the swing). It sits mid bottom row of the wall. */
export const openingPhoto = "41.jpg";

const hung: Omit<Photo, keyof Details>[] = [
  { file: "01.jpg", w: 796, h: 1200, avg: "#777777", mat: 60 }, // ilford_hp5_plus_01_27_2025_000418100020
  { file: "02.jpg", w: 1200, h: 796, avg: "#afa89e", mat: 0 }, // 000562060026
  { file: "03.jpg", w: 796, h: 1200, avg: "#8d8d8d", mat: 90 }, // ilford_hp5_plus_01_14_2025_000002660011
  { file: "04.jpg", w: 1200, h: 796, avg: "#4e4e4e", mat: 50 }, // ilford_400_bw_26829_90866_201229_002018830025
  { file: "05.jpg", w: 796, h: 1200, avg: "#717067", mat: 40 }, // kodak_professional_portra_400_09_16_2024_000129100020
  { file: "06.jpg", w: 796, h: 1200, avg: "#453329", mat: 0 }, // kodak_400_c_41_26829_95343_212365_002123650026
  { file: "07.jpg", w: 796, h: 1200, avg: "#96916e", mat: 0 }, // kodak_professional_portra_400_12_02_2024_000164070030
  { file: "08.jpg", w: 1200, h: 796, avg: "#9b958c", mat: 40 }, // IMG_3875
  { file: "09.jpg", w: 1200, h: 795, avg: "#797061", mat: 50 }, // IMG_2144
  { file: "10.jpg", w: 796, h: 1200, avg: "#878787", mat: 75 }, // 000149350031
  { file: "11.jpg", w: 796, h: 1200, avg: "#736963", mat: 0 }, // kodak_professional_portra_400_04_22_2025_000252310033
  { file: "12.jpg", w: 795, h: 1200, avg: "#716c56", mat: 50 }, // cinestill_xpro_c-41_800_tungsten_(800t)_12_02_2024_000164090035
  { file: "13.jpg", w: 1200, h: 796, avg: "#a38777", mat: 0 }, // kodak_400_c_41_26829_113101_255630_000007470018
  { file: "14.jpg", w: 1200, h: 795, avg: "#acafb0", mat: 90 }, // kodak_400_c_41_26829_100802_225110_002227820011
  { file: "15.jpg", w: 796, h: 1200, avg: "#4a473c", mat: 40 }, // kodak_professional_portra_400_12_02_2024_000164050031
  { file: "16.jpg", w: 796, h: 1200, avg: "#625053", mat: 0 }, // kodak_400_c_41_26829_113101_255627_000007440020
  { file: "17.jpg", w: 1200, h: 796, avg: "#7d8384", mat: 90 }, // IMG_1490
  { file: "18.jpg", w: 796, h: 1200, avg: "#31617f", mat: 0 }, // kodak_professional_portra_400_12_02_2024_000164060010
  { file: "19.jpg", w: 1200, h: 796, avg: "#435b70", mat: 40 }, // kodak_400_c_41_26829_115243_260154_002601540003
  { file: "20.jpg", w: 1200, h: 796, avg: "#6b5b5c", mat: 0 }, // 000130340012
  { file: "21.jpg", w: 796, h: 1200, avg: "#535452", mat: 90 }, // kodak_professional_portra_400_12_02_2024_000164030032
  { file: "22.jpg", w: 796, h: 1200, avg: "#7a7a7a", mat: 60 }, // ilford_400_bw_26829_90866_201231_002018820027
  { file: "23.jpg", w: 1200, h: 796, avg: "#504e41", mat: 0 }, // 000130020034
  { file: "24.jpg", w: 1200, h: 796, avg: "#5c4e3d", mat: 40 }, // kodak_400_c_41_26829_115243_260152_002601520035
  { file: "25.jpg", w: 1200, h: 796, avg: "#777e76", mat: 50 }, // kodak_800_c_41_26829_131809_294050_002940500038
  { file: "26.jpg", w: 1200, h: 796, avg: "#a6a29a", mat: 75 }, // kodak_professional_portra_400_09_16_2024_000129090020
  { file: "27.jpg", w: 796, h: 1200, avg: "#82766f", mat: 30 }, // kodak_professional_portra_800_09_16_2024_000129130005
  { file: "28.jpg", w: 1200, h: 796, avg: "#795b4e", mat: 0 }, // kodak_400_c_41_26829_113101_255628_000007450016
  { file: "29.jpg", w: 796, h: 1200, avg: "#8e857c", mat: 30 }, // kodak_400_c_41_26829_100802_225109_002227810010
  { file: "30.jpg", w: 796, h: 1200, avg: "#7b7b7b", mat: 60 }, // ilford_400_bw_26829_90866_201229_002018830001
  { file: "31.jpg", w: 1200, h: 796, avg: "#464942", mat: 40 }, // kodak_professional_portra_400_09_16_2024_000129150016
  { file: "32.jpg", w: 1200, h: 796, avg: "#787779", mat: 75 }, // kodak_400_c_41_26829_115243_260151_002601510001
  { file: "33.jpg", w: 1200, h: 796, avg: "#57423f", mat: 0 }, // 000130340026
  { file: "34.jpg", w: 1200, h: 795, avg: "#906e62", mat: 60 }, // 187196010008
  { file: "35.jpg", w: 796, h: 1200, avg: "#72685b", mat: 60 }, // IMG_3872
  { file: "36.jpg", w: 796, h: 1200, avg: "#6c6c6c", mat: 50 }, // ilford_hp5_plus_01_27_2025_000418100034
  { file: "37.jpg", w: 795, h: 1200, avg: "#6f5947", mat: 0 }, // kodak_professional_portra_400_12_02_2024_000164070028
  { file: "38.jpg", w: 1200, h: 795, avg: "#8c8d8e", mat: 50 }, // 187196010018
  { file: "39.jpg", w: 796, h: 1200, avg: "#2c2a25", mat: 75 }, // kodak_professional_portra_400_12_02_2024_000164050025
  { file: "40.jpg", w: 1200, h: 796, avg: "#938d83", mat: 90 }, // kodak_professional_portra_400_09_16_2024_000129100036
  { file: "48.jpg", w: 796, h: 1200, avg: "#3d332c", mat: 40 }, // kodak_400_c_41_26829_115243_260155_002601550035
  { file: "42.jpg", w: 796, h: 1200, avg: "#817976", mat: 75 }, // kodak_professional_portra_400_12_02_2024_000164060024
  { file: "43.jpg", w: 1200, h: 795, avg: "#414146", mat: 40 }, // IMG_5874
  { file: "44.jpg", w: 1200, h: 796, avg: "#545542", mat: 40 }, // cinestill_xpro_c-41_800_tungsten_(800t)_12_02_2024_000164080006
  { file: "45.jpg", w: 1200, h: 796, avg: "#908981", mat: 60 }, // kodak_professional_portra_400_09_16_2024_000129100018
  { file: "46.jpg", w: 796, h: 1200, avg: "#6a6f51", mat: 50 }, // kodak_400_c_41_26829_98199_218813_000006410008
  { file: "47.jpg", w: 1200, h: 796, avg: "#83736b", mat: 0 }, // kodak_professional_portra_800_09_16_2024_000129130017
  { file: "41.jpg", w: 1200, h: 796, avg: "#4a4b4b", mat: 60 }, // kodak_400_c_41_26829_93321_207425_001934480024
  { file: "49.jpg", w: 796, h: 1200, avg: "#695c50", mat: 40 }, // kodak_professional_portra_400_09_16_2024_000129090007
  { file: "50.jpg", w: 1200, h: 796, avg: "#5d6974", mat: 75 }, // kodak_400_c_41_26829_115243_260154_002601540006
];

/** Title, camera, film, place and year live in photo-details.json, edited at /edit.html (dev only). */
export const photos: Photo[] = hung.map((p) => ({ ...p, ...(details as Record<string, Details>)[p.file] }));
