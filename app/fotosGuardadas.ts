/**
 * Las fotos de los hallazgos, guardadas con el vuelo.
 *
 * El vuelo entero no se guarda y no tiene por que: son miles de JPEG de 1,5 MB
 * y ocho gigas por parque. Pero el ENTREGABLE son decenas de fotos —una por
 * hallazgo— y esas son justo las que la app necesita para bajar el informe,
 * armar el ZIP y mostrar la termica en la revision.
 *
 * Sin esto, cerrar la pestaña costaba volver a elegir la carpeta del disco
 * para cualquier cosa: Mateo apretaba "Report" al dia siguiente y le abria el
 * Finder despues de haber esperado diez minutos a que se midieran 568 fotos.
 * Peor todavia en el celular en el campo, donde esa carpeta directamente no
 * esta.
 *
 * Se guarda el archivo CRUDO y no la imagen dibujada: la revision y el informe
 * leen la temperatura de adentro del JPEG, y una imagen ya pintada no la
 * tiene. Y se guardan las de TODOS los hallazgos, tambien los descartados: un
 * hallazgo se puede volver a abrir, y el descarte no borra la evidencia.
 */

import { del, get, keys, set } from "idb-keyval";

const PREFIX = "fotos:";

/**
 * Cuanto se deja guardar por vuelo.
 *
 * IndexedDB da gigabytes, pero llenarlos con un vuelo deja a la app sin lugar
 * para los parques —que es lo unico que TIENE que sobrevivir offline en el
 * campo— y en iOS el navegador borra el origen entero cuando aprieta. Con 300
 * fotos entra cualquier vuelo real; el tope de bytes es el que manda.
 */
export const TOPE_FOTOS = 300;
export const TOPE_BYTES = 250 * 1024 * 1024;

export interface FotosGuardadas {
  /** Cuantas entraron. */
  guardadas: number;
  /** Cuantas se pidieron. Si es mayor, no entraron todas. */
  pedidas: number;
}

interface Guardada {
  name: string;
  type: string;
  blob: Blob;
}

/**
 * Guarda las fotos que nombra `nombres` y tira el resto.
 *
 * Devuelve cuantas entraron para poder decirlo en pantalla: un entregable al
 * que le faltan fotos y no avisa es peor que uno que las pide.
 */
export async function guardarFotos(
  vueloId: string,
  archivos: File[],
  nombres: Set<string>,
): Promise<FotosGuardadas> {
  const porNombre = new Map(archivos.map((f) => [f.name, f]));
  const quiero = [...nombres].filter((n) => porNombre.has(n)).sort();
  const guardar: Guardada[] = [];
  let bytes = 0;
  for (const n of quiero.slice(0, TOPE_FOTOS)) {
    const f = porNombre.get(n)!;
    if (bytes + f.size > TOPE_BYTES) break;
    bytes += f.size;
    guardar.push({ name: f.name, type: f.type || "image/jpeg", blob: f });
  }
  if (!guardar.length) {
    await del(PREFIX + vueloId);
    return { guardadas: 0, pedidas: quiero.length };
  }
  await set(PREFIX + vueloId, guardar);
  return { guardadas: guardar.length, pedidas: quiero.length };
}

/** Las que haya guardadas de ese vuelo, como File para el resto de la app. */
export async function leerFotos(vueloId: string): Promise<File[]> {
  const g = await get<Guardada[]>(PREFIX + vueloId);
  if (!g?.length) return [];
  return g.map((x) => new File([x.blob], x.name, { type: x.type }));
}

export async function borrarFotos(vueloId: string): Promise<void> {
  await del(PREFIX + vueloId);
}

/**
 * Las fotos de los vuelos que ya no existen.
 *
 * Un vuelo borrado dejaba sus fotos ocupando lugar para siempre. Se limpian al
 * arrancar, contra la lista de vuelos que hay.
 */
export async function limpiarHuerfanas(vivos: Set<string>): Promise<number> {
  const ks = (await keys()) as string[];
  let n = 0;
  for (const k of ks) {
    if (typeof k !== "string" || !k.startsWith(PREFIX)) continue;
    if (vivos.has(k.slice(PREFIX.length))) continue;
    await del(k);
    n++;
  }
  return n;
}
