/**
 * El parque como mapa de navegacion: parque -> bloque -> modulo -> su foto.
 *
 * La version anterior dibujaba un solo lienzo con TODOS los modulos medidos,
 * cada uno de un pixel y medio, sin un nombre escrito en ningun lado. Sobre un
 * parque de cincuenta y dos bloques eso es una nube gris: no se sabe que bloque
 * se esta mirando, no se puede llegar a uno, y tocarlo devuelve una direccion
 * de un modulo que no se sabia que se estaba tocando. El operador lo dijo en
 * una linea: "no entiendo el mapa ese de arriba, me parece medio malo".
 *
 * Tenia razon, y el problema no era el dibujo: era que el mapa no servia para
 * NAVEGAR. Un mapa de un parque de mil hectareas tiene dos escalas, no una.
 *
 *   - La del parque: donde estan los bloques y en cual hay trabajo. Se dibujan
 *     los bloques, con su nombre encima y pintados por lo que falta revisar.
 *   - La del bloque: donde cae cada hallazgo adentro. Se dibujan las filas y
 *     los hallazgos como puntos, y tocar uno lo abre en la revision.
 *
 * Este archivo no dibuja nada: arma los datos que las dos escalas necesitan, y
 * los arma UNA vez por vuelo. Es a proposito — la geometria de un parque de
 * 6.803 filas no se puede recorrer en cada cuadro de animacion.
 */

import { modulesOfRow } from "@locator";
import type { CompiledFarm, CompiledRow } from "@locator";
import type { Finding } from "./inspection";

export interface CajaDelMapa {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Un tramo de fila, en metros del marco local. */
export interface Tramo {
  rowId: string;
  tracker: string;
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

export interface BloqueDelMapa {
  block: string;
  caja: CajaDelMapa;
  tramos: Tramo[];
  /** Hallazgos de este bloque, por estado. Es lo que decide el color. */
  total: number;
  pendientes: number;
  criticas: number;
}

/** Un hallazgo ya ubicado en el marco local, listo para dibujar. */
export interface PuntoDeHallazgo {
  id: string;
  block: string;
  x: number;
  y: number;
}

export function unirCajas(cajas: CajaDelMapa[]): CajaDelMapa | null {
  if (!cajas.length) return null;
  return cajas.reduce((a, b) => ({
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  }));
}

const cajaDeFila = (r: CompiledRow): CajaDelMapa => ({
  minX: Math.min(r.a.x, r.b.x),
  minY: Math.min(r.a.y, r.b.y),
  maxX: Math.max(r.a.x, r.b.x),
  maxY: Math.max(r.a.y, r.b.y),
});

/**
 * De un id de hallazgo a la fila y la posicion que nombra.
 *
 * El id es `rowId#posicion` y el rowId puede traer cualquier cosa adentro
 * —vienen del Excel del cliente—, asi que se parte por el ULTIMO numeral y no
 * por el primero.
 */
export function partirId(id: string): { rowId: string; positionInRow: number } | null {
  const i = id.lastIndexOf("#");
  if (i <= 0) return null;
  const n = Number(id.slice(i + 1));
  if (!Number.isFinite(n) || n < 1) return null;
  return { rowId: id.slice(0, i), positionInRow: n };
}

/**
 * Donde cae cada hallazgo, en metros del marco local del parque.
 *
 * Se resuelve por el id —que ES la fila y la posicion— y no por la direccion:
 * la direccion trae el numero de modulo DENTRO de su string, que sin el string
 * al lado no ubica nada. El id no depende de como se numeren los strings en
 * este parque, que es justo lo que cambia de un parque a otro.
 *
 * Solo se recorren las filas que tienen hallazgos. Un parque grande son cientos
 * de miles de modulos y los hallazgos de un vuelo son decenas: recorrerlo entero
 * para ubicar cuarenta puntos es el tipo de cosa que hace que la pantalla tarde
 * dos segundos en cada click.
 */
export function puntosDeHallazgos(farm: CompiledFarm, findings: Finding[]): Map<string, PuntoDeHallazgo> {
  const porFila = new Map<string, CompiledRow>();
  for (const r of farm.rows) porFila.set(r.source.id, r);

  // Agrupados por fila: cada fila se resuelve una sola vez.
  const porRowId = new Map<string, Array<{ id: string; positionInRow: number }>>();
  for (const f of findings) {
    const p = partirId(f.id);
    if (!p || !porFila.has(p.rowId)) continue;
    const lista = porRowId.get(p.rowId);
    const item = { id: f.id, positionInRow: p.positionInRow };
    if (lista) lista.push(item);
    else porRowId.set(p.rowId, [item]);
  }

  const salida = new Map<string, PuntoDeHallazgo>();
  for (const [rowId, pedidos] of porRowId) {
    const row = porFila.get(rowId)!;
    const porPosicion = new Map(modulesOfRow(row, farm).map((m) => [m.positionInRow, m]));
    for (const { id, positionInRow } of pedidos) {
      const m = porPosicion.get(positionInRow);
      if (!m) continue;
      salida.set(id, { id, block: row.source.block, x: m.x, y: m.y });
    }
  }
  return salida;
}

/**
 * Los bloques del parque con su geometria y lo que falta revisar en cada uno.
 *
 * Los bloques salen del PARQUE, no de los hallazgos: un bloque sin ninguna
 * anomalia tiene que aparecer igual, en gris. Que no haya nada marcado ahi es
 * un resultado —el bloque esta sano, o el vuelo no lo cubrio— y esconderlo hace
 * que el mapa mienta por omision.
 */
export function bloquesDelParque(
  farm: CompiledFarm,
  findings: Finding[],
  puntos: Map<string, PuntoDeHallazgo>,
): BloqueDelMapa[] {
  const porBloque = new Map<string, BloqueDelMapa>();

  for (const r of farm.rows) {
    const block = r.source.block;
    let b = porBloque.get(block);
    if (!b) {
      b = { block, caja: cajaDeFila(r), tramos: [], total: 0, pendientes: 0, criticas: 0 };
      porBloque.set(block, b);
    } else {
      b.caja = unirCajas([b.caja, cajaDeFila(r)])!;
    }
    b.tramos.push({
      rowId: r.source.id,
      tracker: r.source.tracker,
      ax: r.a.x, ay: r.a.y, bx: r.b.x, by: r.b.y,
    });
  }

  for (const f of findings) {
    // El bloque sale de donde cae el modulo; si no se pudo ubicar, de la
    // direccion. Un hallazgo sin ninguno de los dos no pertenece a ningun
    // bloque y no se cuenta en ninguno: contarlo en uno cualquiera seria
    // mandar a alguien a caminar el bloque equivocado.
    const block = puntos.get(f.id)?.block ?? f.address?.block;
    if (!block) continue;
    const b = porBloque.get(block);
    if (!b) continue;
    b.total++;
    if (f.status === "pendiente") b.pendientes++;
    if (f.medicion?.peor === "critica") b.criticas++;
  }

  return [...porBloque.values()].sort((a, b) => a.block.localeCompare(b.block, "es", { numeric: true }));
}
