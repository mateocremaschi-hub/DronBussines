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
 *
 * Y se usa la version `legacy`, que no es la vieja: es la que trae adentro los
 * rellenos de las funciones de JavaScript que los navegadores de hace un par de
 * anios todavia no tienen. La compilacion normal llama a `Iterator.prototype`
 * de una, y en un Safari que no lo tiene el modulo se muere ANTES de abrir el
 * primer archivo, con un "Can't find variable: Iterator" que no se parece en
 * nada al problema. Pasa en la Mac de todos los dias, no en un caso raro.
 */

import type { Etiqueta } from "./planpdf";

type Pdfjs = typeof import("pdfjs-dist");

export interface LecturaDePdfs {
  etiquetas: Etiqueta[];
  /** Archivos que no se pudieron abrir, con el motivo. */
  avisos: string[];
}

let pdfjs: Pdfjs | null = null;

async function motor(): Promise<Pdfjs> {
  if (pdfjs) return pdfjs;
  const mod = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as Pdfjs;
  // El worker se sirve desde el mismo origen. Con la URL construida asi, Vite
  // lo emite como un archivo mas del build, con hash, y entonces el service
  // worker lo precachea junto con todo lo demas. Tambien el legacy: un worker
  // moderno con un pdf.js legacy falla igual, y del lado del worker el error ni
  // siquiera llega a la pantalla.
  mod.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
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
          // De que lamina salio. Cada PDF tiene su propio sistema de
          // coordenadas, y un bloque que aparece en dos no se puede armar
          // promediando las dos. Ver `armarBloque`.
          hoja: `${file.name}#${p}`,
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

  // Primero se prende el motor, una sola vez y aparte.
  //
  // Si el que no puede es el navegador, falla en TODOS los archivos por el
  // mismo motivo, y repetir treinta y seis veces el mismo error de JavaScript
  // esconde el unico dato que sirve: que no es culpa de los PDF.
  try {
    await motor();
  } catch (e) {
    return {
      etiquetas: [],
      avisos: [
        "Este navegador no puede abrir PDF: se cayo al cargar el lector, antes de tocar un solo " +
        "archivo. No es culpa de los planos. Probá con Chrome, o actualizá Safari desde " +
        `Preferencias del Sistema. (${e instanceof Error ? e.message : String(e)})`,
      ],
    };
  }

  // Los fallos se juntan por motivo: treinta y seis lineas iguales no dicen mas
  // que una, y tapan a la que es distinta.
  const fallas = new Map<string, string[]>();

  for (let i = 0; i < files.length; i++) {
    const f = files[i]!;
    alAvanzar?.(i, files.length, f.name);
    try {
      etiquetas.push(...(await etiquetasDe(f)));
    } catch (e) {
      const motivo = e instanceof Error ? e.message : String(e);
      const antes = fallas.get(motivo);
      if (antes) antes.push(f.name); else fallas.set(motivo, [f.name]);
    }
  }
  alAvanzar?.(files.length, files.length, "");

  const avisos = [...fallas].map(([motivo, nombres]) =>
    nombres.length === 1
      ? `No pude abrir ${nombres[0]}: ${motivo}.`
      : `No pude abrir ${nombres.length} archivos, todos por lo mismo (${motivo}): ` +
        `${nombres.slice(0, 4).join(", ")}${nombres.length > 4 ? ", …" : ""}.`,
  );

  return { etiquetas, avisos };
}
