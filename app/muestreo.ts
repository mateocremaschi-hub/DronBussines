/**
 * Revisar por muestreo en vez de panel por panel.
 *
 * El problema, dicho por el que lo sufre: "imaginate revisar mas de 3000
 * paneles a mano, me tardaria una eternidad".
 *
 * La salida no es revisar mas rapido: es revisar MENOS, y poder defenderlo. El
 * motor clasifica los tres mil por la forma de la mancha, una persona revisa
 * una muestra, y el informe declara cuantos revisó y en cuantos coincidio. Eso
 * ultimo es lo que convierte "lo clasifico una maquina" en un numero que un
 * cliente puede auditar.
 *
 * Dos cosas que la muestra NO es
 * -----------------------------
 * No es "los primeros N": eso revisa siempre los mismos y deja tipos enteros
 * sin mirar nunca. Se reparte POR TIPO de patron, porque los tipos no valen lo
 * mismo — la verificacion de campo del informe de la otra empresa lo muestra:
 *
 *     diodo de bypass   151 de 155 confirmados
 *     multi hotspot      41 de 71   (17 "nada visible", 11 eran suciedad)
 *     foreign object     0 de 16    (los 16 eran suciedad)
 *
 * Y no es al azar puro: lo que la maquina marca con poca confianza va ENTERO a
 * revision, no muestreado. Muestrear justo lo que uno sabe que falla es elegir
 * no enterarse.
 */

import type { Finding } from "./inspection";
import type { Confianza } from "./patron";

/** Que se revisa si o si, aunque caiga fuera de la muestra. */
export const SIEMPRE_SE_REVISA: Confianza[] = ["baja"];

export interface Muestra {
  /** Los que hay que mirar si o si. */
  aRevisar: Set<string>;
  /** Cuantos entraron por poca confianza y cuantos por sorteo. */
  porConfianza: number;
  porSorteo: number;
  /** Cuantos quedaron sin clasificar y por eso van a revision. */
  sinClasificar: number;
  total: number;
}

/**
 * Un sorteo que da lo mismo cada vez que se corre.
 *
 * Con `Math.random`, abrir el mismo vuelo dos veces cambia que paneles hay que
 * revisar, y lo que ya se reviso deja de estar en la muestra. El informe
 * tampoco se podria reproducir. La semilla sale del id del vuelo, asi que dos
 * vuelos distintos sortean distinto y el mismo vuelo sortea siempre igual.
 */
function sorteo(semilla: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < semilla.length; i++) {
    h ^= semilla.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h ^= h << 13; h ^= h >>> 17; h ^= h << 5;
    return ((h >>> 0) % 100000) / 100000;
  };
}

/**
 * Que hallazgos hay que revisar a mano.
 *
 * `fraccion` es el porcentaje de cada tipo que se sortea, de 0 a 1. Sobre eso
 * se agregan enteros los de poca confianza y los que no se pudieron clasificar:
 * la muestra es el PISO de lo que se revisa, no el techo.
 */
export function muestraARevisar(
  findings: Finding[],
  fraccion: number,
  semilla: string,
): Muestra {
  const aRevisar = new Set<string>();
  let porConfianza = 0;
  let sinClasificar = 0;

  // Por tipo de patron, para que ninguno quede sin mirar nunca.
  const porTipo = new Map<string, Finding[]>();
  for (const f of findings) {
    if (!f.patron) {
      // Sin forma leible no hay nada que auditar: va derecho a la persona.
      aRevisar.add(f.id);
      sinClasificar++;
      continue;
    }
    if (SIEMPRE_SE_REVISA.includes(f.patron.confianza)) {
      aRevisar.add(f.id);
      porConfianza++;
      continue;
    }
    const k = f.patron.patron;
    const lista = porTipo.get(k);
    if (lista) lista.push(f); else porTipo.set(k, [f]);
  }

  const dado = sorteo(semilla);
  let porSorteo = 0;
  for (const [tipo, lista] of [...porTipo.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    // Ordenados por id para que el sorteo no dependa del orden en que llegaron
    // las fotos.
    const ordenada = [...lista].sort((a, b) => a.id.localeCompare(b.id));
    // Al menos uno de cada tipo, aunque el porcentaje de tan pocos de cero: un
    // tipo entero sin una sola revision es justo lo que no se quiere.
    const cuantos = Math.max(1, Math.round(ordenada.length * Math.min(1, Math.max(0, fraccion))));
    const elegidos = new Set<number>();
    let vueltas = 0;
    while (elegidos.size < Math.min(cuantos, ordenada.length) && vueltas < ordenada.length * 20) {
      elegidos.add(Math.floor(dado() * ordenada.length));
      vueltas++;
    }
    for (const i of elegidos) {
      aRevisar.add(ordenada[i]!.id);
      porSorteo++;
    }
    void tipo;
  }

  return { aRevisar, porConfianza, porSorteo, sinClasificar, total: findings.length };
}

export interface Acuerdo {
  /** Cuantos de la muestra ya se revisaron. */
  revisados: number;
  /** En cuantos la persona dejo lo que propuso la maquina. */
  coinciden: number;
  /** Cuantos faltan revisar de la muestra. */
  faltan: number;
  /** De 0 a 1, o null si todavia no se reviso nada. */
  tasa: number | null;
  /** Lo mismo abierto por tipo, que es donde se ve cual falla. */
  porTipo: Array<{ patron: string; revisados: number; coinciden: number }>;
}

/**
 * Cuanto le acerto la maquina, sobre lo que una persona ya miro.
 *
 * Es el numero que hace defendible todo esto. Sin el, "lo clasifico una
 * maquina" es una afirmacion sin respaldo; con el, es "se revisaron 312 de
 * 3.156 y coincidio en el 94 %", que un cliente puede auditar — y que ademas
 * avisa CUANDO deja de servir: si la tasa de un tipo se cae, ese tipo hay que
 * revisarlo entero.
 */
export function acuerdoDeLaMuestra(findings: Finding[], muestra: Set<string>): Acuerdo {
  let revisados = 0, coinciden = 0;
  const tipos = new Map<string, { revisados: number; coinciden: number }>();

  for (const f of findings) {
    if (!muestra.has(f.id) || !f.patron) continue;
    // "Revisado" es que una persona lo haya cerrado, no que lo haya mirado: sin
    // un gesto explicito no hay forma de saber si paso por ahi.
    if (f.status === "pendiente") continue;
    revisados++;
    // Coincide si el que revisa dejo la anomalia que propuso la maquina.
    const igual = f.anomaly === f.patron.anomalia;
    if (igual) coinciden++;
    const t = tipos.get(f.patron.patron) ?? { revisados: 0, coinciden: 0 };
    t.revisados++;
    if (igual) t.coinciden++;
    tipos.set(f.patron.patron, t);
  }

  return {
    revisados,
    coinciden,
    faltan: muestra.size - revisados,
    tasa: revisados ? coinciden / revisados : null,
    porTipo: [...tipos.entries()]
      .map(([patron, v]) => ({ patron, ...v }))
      .sort((a, b) => b.revisados - a.revisados),
  };
}
