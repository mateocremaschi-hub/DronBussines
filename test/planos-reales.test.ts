/**
 * El lector de planos contra PDF DE VERDAD.
 *
 * Las otras pruebas usan etiquetas inventadas y un PDF escrito a mano de
 * cuarenta lineas. Ninguna habria cazado lo que paso en el campo: los planos de
 * Wellington North rotulan los trackers "17-017-INT-R1-C-L-S2" —bloque,
 * tracker, tipo de pila, fila, y tres codigos mas atras— y el lector, que tenia
 * una lista de formatos conocidos, no reconocia una sola etiqueta.
 *
 * Corre solo si hay PDF en `fixtures/planos/`. Esos archivos son del proyecto
 * del cliente y no van al repositorio, asi que la prueba se saltea sola cuando
 * no estan — pero cuando estan, es la unica que prueba el camino completo:
 * pdf.js abriendo un PDF real, con su texto real y sus coordenadas reales.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { analizarEtiqueta, formaEstructural, planoDeEtiquetas, type Etiqueta } from "../app/planpdf";

const DIR = join(process.cwd(), "fixtures", "planos");
const archivos = (() => {
  try { return readdirSync(DIR).filter((f) => f.toLowerCase().endsWith(".pdf")); }
  catch { return []; }
})();

/** Las etiquetas con posicion, sacadas con la misma pdf.js que usa la app. */
async function etiquetasDe(rutas: string[]): Promise<Etiqueta[]> {
  const mod = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const out: Etiqueta[] = [];
  for (const ruta of rutas) {
    const datos = new Uint8Array(readFileSync(ruta));
    const doc = await (mod as any).getDocument({ data: datos, useSystemFonts: true }).promise;
    for (let i = 1; i <= doc.numPages; i++) {
      const pagina = await doc.getPage(i);
      const alto = pagina.getViewport({ scale: 1 }).height;
      const contenido = await pagina.getTextContent();
      for (const item of contenido.items as any[]) {
        const t = String(item.str ?? "").trim();
        if (!t) continue;
        const tr = item.transform as number[];
        out.push({
          x: tr[4]! + (item.width ?? 0) / 2,
          y: alto - tr[5]! - (item.height ?? 0) / 2,
          t,
        });
      }
    }
  }
  return out;
}

describe.skipIf(!archivos.length)("planos reales del proyecto", () => {
  it("lee las etiquetas y arma los bloques", { timeout: 120_000 }, async () => {
    const etiquetas = await etiquetasDe(archivos.map((f) => join(DIR, f)));
    const r = planoDeEtiquetas(etiquetas);

    console.log(`\n  ${archivos.length} PDF · ${etiquetas.length} textos`);
    console.log(`  reconocidos: ${JSON.stringify(r.leidas)}`);
    const muestras = etiquetas
      .map((e) => ({ e, a: analizarEtiqueta(e.t) }))
      .filter((x) => x.a?.tipo === "tracker")
      .slice(0, 4);
    for (const { e, a } of muestras) {
      console.log(`  ${e.t.padEnd(24)} forma ${formaEstructural(e.t).padEnd(20)} -> bloque ${a!.bloque}, tracker ${a!.tracker}, fila ${a!.fila ?? "—"}`);
    }
    for (const [b, v] of Object.entries(r.plano)) {
      console.log(`  bloque ${b}: ${Object.keys(v.trackers ?? {}).length} trackers, lados ${[...new Set(Object.values(v.trackers ?? {}).map((t) => t.side))].join("/")}`);
    }
    for (const a of r.avisos.slice(0, 6)) console.log("  aviso: " + a);

    // Lo que tiene que salir bien: reconocer trackers y armar bloques.
    expect(r.leidas.trackers).toBeGreaterThan(100);
    expect(Object.keys(r.plano).length).toBeGreaterThan(0);
  });
});
