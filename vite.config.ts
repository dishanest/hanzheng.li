import { defineConfig, type Plugin } from "vite";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// Dev-only endpoint behind /edit.html: reads and saves src/photo-details.json.
// Not part of the production build (only index.html is built).
function photoDetailsEditor(): Plugin {
  const file = resolve(import.meta.dirname, "src/photo-details.json");
  const rollsFile = resolve(import.meta.dirname, "src/rolls.json");
  const fields = ["title", "camera", "film", "place", "year"] as const; // editable per photo on /edit.html
  return {
    name: "photo-details-editor",
    apply: "serve",
    // a save must not reload open pages (it wiped what you were typing in the editor)
    handleHotUpdate(ctx) {
      if (ctx.file === file || ctx.file === rollsFile) return [];
    },
    configureServer(server) {
      // /__rolls: GET { rolls, details }; POST { rolls, members: { photo: rollId | "" }, places: { photo: place } }.
      // Saving copies each roll's camera, film and year onto its photos; place is set per photo.
      server.middlewares.use("/__rolls", (req, res) => {
        const read = (f: string) => JSON.parse(readFileSync(f, "utf8"));
        if (req.method === "GET") {
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ rolls: read(rollsFile), details: read(file) }));
          return;
        }
        if (req.method !== "POST") { res.statusCode = 405; res.end(); return; }
        let body = "";
        req.on("data", (c) => { body += c; if (body.length > 1e6) req.destroy(); });
        req.on("end", () => {
          try {
            const { rolls, members, places = {} } = JSON.parse(body) as {
              rolls: Record<string, { name: string; camera: string; film: string; year: number | null }>;
              members: Record<string, string>;
              places?: Record<string, string>;
            };
            const all = read(file);
            for (const [photo, roll] of Object.entries(members)) {
              if (!all[photo]) throw new Error(`unknown photo ${photo}`);
              if (roll && !rolls[roll]) throw new Error(`unknown roll ${roll}`);
              all[photo].roll = roll;
              const r = roll ? rolls[roll] : null;
              if (!r) continue;
              for (const k of ["camera", "film"] as const) if (r[k]?.trim()) all[photo][k] = r[k].trim();
              if (r.year) all[photo].year = Number(r.year);
            }
            for (const [photo, place] of Object.entries(places)) {
              if (!all[photo]) throw new Error(`unknown photo ${photo}`);
              all[photo].place = String(place).trim();
            }
            writeFileSync(rollsFile, JSON.stringify(rolls, null, 2) + "\n");
            writeFileSync(file, JSON.stringify(all, null, 2) + "\n");
            for (const m of server.moduleGraph.getModulesByFile(file) ?? []) server.moduleGraph.invalidateModule(m);
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ rolls, details: all }));
          } catch (e) {
            res.statusCode = 400;
            res.end(String(e));
          }
        });
      });
      server.middlewares.use("/__details", (req, res) => {
        if (req.method === "GET") {
          res.setHeader("content-type", "application/json");
          res.end(readFileSync(file, "utf8"));
          return;
        }
        if (req.method !== "POST") { res.statusCode = 405; res.end(); return; }
        let body = "";
        req.on("data", (c) => { body += c; if (body.length > 1e6) req.destroy(); });
        req.on("end", () => {
          try {
            // body: { "41.jpg": { place: "...", ... }, ... } -- every unsaved change at once
            const changes: Record<string, Record<string, unknown>> = JSON.parse(body);
            const all = JSON.parse(readFileSync(file, "utf8"));
            for (const [photo, patch] of Object.entries(changes)) {
              if (!all[photo]) throw new Error(`unknown photo ${photo}`);
              for (const k of fields) {
                if (!(k in patch)) continue;
                all[photo][k] = k === "year" ? Number(patch[k]) || all[photo].year : String(patch[k]).trim();
              }
            }
            writeFileSync(file, JSON.stringify(all, null, 2) + "\n");
            // fresh data on the wall's next reload, without pushing a reload to open pages
            for (const m of server.moduleGraph.getModulesByFile(file) ?? []) server.moduleGraph.invalidateModule(m);
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify(all));
          } catch (e) {
            res.statusCode = 400;
            res.end(String(e));
          }
        });
      });
    },
  };
}

export default defineConfig({ plugins: [photoDetailsEditor()] });
