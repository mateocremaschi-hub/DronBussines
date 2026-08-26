/**
 * Abrir los PDF y sacar el texto con su posicion.
 *
 * Es lo unico que este proyecto le pide a pdf.js, y es a proposito: la
 * geometria vive en `planpdf.ts`, que no importa nada y por eso se puede
 * probar. Aca solo pasa que un archivo se convierte en una lista de etiquetas.
 *
 * pdf.js se carga con un import dinamico. No es una optimizacion de tamano
 * —aunque lo sea, el worker pesa mas que el resto de la app junta—: es que asi
 * el modulo se puede importar en un test sin que Node intente resolver el
 * worker, y sobre todo que el que nunca carga un plano nunca lo baja.
 */

import type { Etiqueta } from "./planpdf";

export interface LecturaDePdfs {
  etiquetas: Etiqueta[];
  /** Archivos que no se pudieron abrir, con el motivo. */
  avisos: string[];
}

let pdfjs: typeof import("pdfjs-dist") | null = null;

async function motor(): Promise<typeof import("pdfjs-dist")> {
  if (pdfjs) return pdfjs;
  const mod = await import("pdfjs-dist");
  // El worker se sirve desde el mismo origen. Con la URL construida asi, Vite
  // lo emite como un archivo mas del build, con hash, y entonces el service
  // worker lo precachea junto con todo lo demas.
  mod.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();
  pdfjs = mod;
  return mod;
}

/** Saca de un PDF cada etiqueta con su centro, en coordenadas de arriba a abajo. */
async function etiquetasDe(file: File): Promise<Etiqueta[]> {
  const lib = await motor();
  // Se guarda la tarea, no solo el documento: es la que apaga el worker. Con 36
  // planos seguidos, no apagarlo deja 36 workers vivos y el navegador se cae.
  const tarea = lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const doc = await tarea.promise;
  const out: Etiqueta[] = [];
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const alto = page.getViewport({ scale: 1 }).height;
      const contenido = await page.getTextContent();
      for (const item of contenido.items) {
        if (!("str" in item)) continue;
        const t = item.str.trim();
        if (!t) continue;
        const tr = item.transform as number[];
        // Dos correcciones, las dos silenciosas si faltan:
        //
        // El PDF mide la altura desde abajo y el resto del pipeline desde
        // arriba. Sin dar vuelta la Y, el norte y el sur salen cambiados.
        //
        // Y pdf.js da el origen del texto —la esquina de abajo a la izquierda—
        // mientras que las reglas portadas trabajan sobre el CENTRO del rotulo.
        // Sin centrarlo, cada etiqueta queda corrida media palabra, que es
        // justo del orden de lo que separa una fila de la de al lado.
        out.push({
          x: tr[4]! + (item.width ?? 0) / 2,
          y: alto - tr[5]! - (item.height ?? 0) / 2,
          t,
        });
      }
      page.cleanup();
    }
  } finally {
    await tarea.destroy();
  }
  return out;
}

/**
 * Lee varios PDF y junta todas las etiquetas.
 *
 * No importa en que lamina estaba cada bloque ni en que orden llegan los
 * archivos: el numero de bloque esta adentro del nombre de cada tracker. Se
 * pueden arrastrar los 36 planos de una vez.
 *
 * Un PDF que no abre no corta la corrida. Con treinta y pico de archivos, que
 * uno este roto y se pierda el trabajo de los otros veintinueve seria peor que
 * el problema.
 */
export async function etiquetasDePdfs(
  files: File[],
  alAvanzar?: (hecho: number, total: number, archivo: string) => void,
): Promise<LecturaDePdfs> {
  const etiquetas: Etiqueta[] = [];
  const avisos: string[] = [];

  for (let i = 0; i < files.length; i++) {
    const f = files[i]!;
    alAvanzar?.(i, files.length, f.name);
    try {
      etiquetas.push(...(await etiquetasDe(f)));
    } catch (e) {
      avisos.push(`${f.name}: no pude abrirlo (${e instanceof Error ? e.message : String(e)}).`);
    }
  }
  alAvanzar?.(files.length, files.length, "");

  return { etiquetas, avisos };
}
