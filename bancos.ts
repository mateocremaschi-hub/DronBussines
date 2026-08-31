/**
 * Los tramos de un bloque y la calle que los parte, leidos del plano.
 *
 * Esto existe por una pregunta que no tenia respuesta buena: "no entiendo por
 * que hace de suponer de vuelta las road y la distancia si tengo los planos
 * donde se ve cada tracker y de que lado esta cada uno".
 *
 * Tenia razon. La app deducia la calle del medio midiendo huecos entre las
 * coordenadas del relevamiento —`agruparPorCalle`— y en Wellington North erraba
 * en los 52 bloques de 52. Mientras tanto el plano lo trae escrito, en la misma
 * etiqueta de cada tracker, y el lector lo estaba TIRANDO con un comentario que
 * decia "las de atras son codigos de pila".
 *
 * La leyenda de la lamina:
 *
 *     R1-P1N  =  ROW 1 - PERIMETER 1 NORTH
 *     R1-C    =  ROW 1 - CENTER
 *     R1-P1S  =  ROW 1 - PERIMETER 1 SOUTH
 *
 * Leyendo los bancos de norte a sur, cada bloque de Wellington da la misma
 * forma. El 02, de ocho bancos:
 *
 *     N  .  .  S  |  N  .  .  .
 *
 * Donde una S toca una N esta el borde en que el perimetro sur de un banco se
 * encuentra con el perimetro norte del siguiente. Eso es la calle del medio.
 *
 * Lo que este modulo NO hace, y conviene tenerlo claro: no dice si las cajas de
 * continua estan sobre esa calle o en el borde de afuera del bloque. Eso el
 * plano de fundaciones no lo trae. Pero es UN BIT PARA TODO EL PARQUE
 * —`dcBoxPlacement`—, no una incognita por bloque: se confirma con un conteo,
 * una sola vez, en cualquier bloque. Cincuenta y dos problemas se vuelven uno.
 */

import type { TrackerRow } from "../src/types.js";

/**
 * El numero de tracker, venga escrito como venga.
 *
 * Los dos archivos escriben el mismo tracker distinto: el plano dice "07-001"
 * y la planilla de coordenadas puede traer "7-1", "07-001" o "1" pelado. Se usa
 * el ULTIMO grupo de digitos y se compara como numero, que es la misma regla
 * que ya usa `claveDeTracker` en plans.ts.
 *
 * Sin esto `Number("07-001")` da NaN y el tracker se cae del calculo sin ruido
 * — que es exactamente como el plano entraba y se aplicaba a nada.
 */
function numeroDeTracker(texto: string): number | null {
  const g = texto.match(/\d+/g);
  if (!g?.length) return null;
  const n = Number(g[g.length - 1]);
  return Number.isFinite(n) ? n : null;
}

/** Lo que el plano dice de un tracker, para este calculo. */
export interface TrackerDelPlano {
  block: string;
  tracker: string;
  perimetro?: "norte" | "sur" | "centro" | "perimetro-2";
}

/**
 * Un tramo de trackers consecutivos con la misma condicion de perimetro.
 *
 * OJO con el nombre, porque la tentacion es llamarlo "banco" y NO lo es. Dos
 * bancos fisicos pegados que estan los dos en el centro del bloque comparten la
 * marca `C`, asi que salen como un solo tramo. Contando por coordenadas el
 * bloque 02 da ocho bancos; contando por marca da cinco tramos. Los dos numeros
 * estan bien, cuentan cosas distintas.
 *
 * Y no importa, porque lo que hace falta no son los bancos: es el BORDE donde
 * un tramo sur toca uno norte. Ese borde es la calle del medio, y sale igual
 * con cinco tramos que con ocho bancos. Llamarlos bancos haria pensar que el
 * plano dice algo que no dice — que es como se llego al comentario de "codigos
 * de pila" que tiraba este dato.
 */
export interface TramoDelPlano {
  /** 1 = el primero en el orden de numeracion de trackers. */
  tramo: number;
  /** Numeros de tracker que caen en este tramo. */
  trackers: string[];
  borde: "norte" | "sur" | "centro" | "perimetro-2" | "sin-marca";
}

export interface TramosDelBloque {
  block: string;
  tramos: TramoDelPlano[];
  /**
   * Entre que dos tramos cae la calle del medio, 1-based sobre `tramos`: el
   * valor `k` significa "entre el tramo k y el k+1". `null` si el plano no
   * marca ningun borde S|N.
   */
  calleDespuesDelTramo: number | null;
  /**
   * Por que salio o no salio la calle. Los dos motivos de fracaso NO son lo
   * mismo y llevan a hacer cosas distintas:
   *
   * - `sin-borde`: el plano no marca ningun perimetro norte-sur en ese bloque.
   *   No hay nada mas que sacarle; se cierra con un conteo o con el plano de
   *   interconexion.
   * - `varias-calles`: el plano marca DOS o mas calles internas. El dato esta,
   *   lo que falta es cual de ellas lleva las cajas. Eso lo contesta el plano
   *   de interconexion de UN bloque de esos.
   *
   * Decir "o una o la otra" obliga a la persona a ir a averiguar cual, que es
   * justo el trabajo que esta pantalla tiene que ahorrarle.
   */
  motivo: "una-calle" | "sin-borde" | "varias-calles";
  detail: string;
}

/**
 * Partir los trackers de un bloque en tramos y encontrar la calle del medio.
 *
 * Se trabaja sobre el NUMERO de tracker, no sobre coordenadas. Es a proposito:
 * las coordenadas son justamente lo que fallaba, y la numeracion ya recorre el
 * bloque en orden. Un tramo es una corrida de numeros consecutivos con la misma
 * marca de perimetro.
 *
 * Los trackers SIN marca no cortan nada. En Wellington los de la zona EXT vienen
 * como `01-004-EXT-R1-L-S2`, sin el campo de perimetro, y aparecen salteados en
 * el medio de una corrida. Tratarlos como una marca propia partia el bloque 02
 * en nueve pedazos en vez de cinco y hacia perder el borde que importa. Se
 * pegan al tramo que vienen siguiendo.
 */
export function bancosDelBloque(trackers: TrackerDelPlano[]): TramosDelBloque | null {
  if (!trackers.length) return null;
  const block = trackers[0]!.block;

  // Un solo registro por numero de tracker: R1 y R2 traen la misma marca.
  const marcas = new Map<number, TrackerDelPlano["perimetro"]>();
  for (const t of trackers) {
    const n = numeroDeTracker(t.tracker);
    if (n == null) continue;
    if (t.perimetro || !marcas.has(n)) marcas.set(n, t.perimetro);
  }
  const nums = [...marcas.keys()].sort((a, b) => a - b);
  if (!nums.length) return null;

  const tramos: TramoDelPlano[] = [];
  let actual: number[] = [];
  let marcaActual: TramoDelPlano["borde"] = "sin-marca";
  for (const n of nums) {
    const m = marcas.get(n);
    if (!m) { actual.push(n); continue; }   // sin marca: sigue el tramo en curso
    if (actual.length && m !== marcaActual) {
      tramos.push({ tramo: tramos.length + 1, trackers: actual.map(String), borde: marcaActual });
      actual = [];
    }
    marcaActual = m;
    actual.push(n);
  }
  if (actual.length) {
    tramos.push({ tramo: tramos.length + 1, trackers: actual.map(String), borde: marcaActual });
  }

  /*
    La calle: el borde donde un tramo marcado SUR toca uno marcado NORTE.

    Se busca la ADYACENCIA y no un orden, porque el numero de tracker no
    garantiza por si solo que la numeracion vaya de norte a sur. Que lado es
    cada uno lo dice la marca, no el orden.
  */
  let calle: number | null = null;
  let varias = false;
  for (let i = 0; i < tramos.length - 1; i++) {
    const a = tramos[i]!.borde;
    const b = tramos[i + 1]!.borde;
    if ((a === "sur" && b === "norte") || (a === "norte" && b === "sur")) {
      if (calle != null) { varias = true; break; }
      calle = i + 1;
    }
  }

  const forma = tramos
    .map((t) => ({ norte: "N", sur: "S", centro: ".", "perimetro-2": "2", "sin-marca": "?" }[t.borde]))
    .join(" ");

  if (varias) {
    // Elegir uno seria volver a adivinar, que es de donde venimos.
    return {
      block, tramos, calleDespuesDelTramo: null, motivo: "varias-calles",
      detail:
        `El plano marca ${tramos.length} tramos (${forma}) y mas de un borde norte-sur, asi que no ` +
        `hay una sola calle del medio. Hace falta el plano de interconexion para saber cual lleva ` +
        `las cajas.`,
    };
  }

  return {
    block,
    tramos,
    calleDespuesDelTramo: calle,
    motivo: calle != null ? "una-calle" : "sin-borde",
    detail:
      calle != null
        ? `El plano marca ${tramos.length} tramos (${forma}) y la calle del medio entre el ${calle} ` +
          `y el ${calle + 1}, donde el perimetro sur de uno toca el perimetro norte del otro. ` +
          `No hace falta deducirla de las coordenadas.`
        : `El plano marca ${tramos.length} tramos (${forma}), pero ningun borde donde un perimetro ` +
          `sur toque uno norte, asi que no dice donde esta la calle del medio.`,
  };
}

/**
 * Escribir el sentido de conteo de cada fila usando la calle que dice el plano.
 *
 * Misma regla que ya usaba la app cuando lograba encontrar la calle midiendo:
 * se cuenta desde la punta que da a la calle de las cajas. Lo unico que cambia
 * —y es todo— es de donde sale la calle.
 *
 * Devuelve solo las filas que pudo resolver. Las demas quedan como estaban.
 */
export function sentidoDesdeElPlano(
  rows: TrackerRow[],
  bloques: TramosDelBloque[],
  dcBoxPlacement: "center-road" | "outer-edge" = "center-road",
): { origins: Map<string, "start" | "end">; resueltos: string[]; sinCalle: string[] } {
  const origins = new Map<string, "start" | "end">();
  const resueltos: string[] = [];
  const sinCalle: string[] = [];

  for (const b of bloques) {
    if (b.calleDespuesDelTramo == null) { sinCalle.push(b.block); continue; }

    /*
      Los trackers de cada lado de la calle.

      Cual de los dos grupos es el del norte lo dice la MARCA, no el orden de la
      numeracion: el tramo que toca la calle por su lado sur es el del norte.
    */
    const cortado = b.tramos[b.calleDespuesDelTramo - 1]!;
    const primerGrupoEsNorte = cortado.borde === "sur";
    const alNorte = new Set<string>();
    const alSur = new Set<string>();
    for (const tramo of b.tramos) {
      const primerGrupo = tramo.tramo <= b.calleDespuesDelTramo;
      const destino = primerGrupo === primerGrupoEsNorte ? alNorte : alSur;
      for (const t of tramo.trackers) destino.add(t);
    }

    const filas = rows.filter((r) => r.block === b.block);
    if (!filas.length) { sinCalle.push(b.block); continue; }

    let escritas = 0;
    for (const r of filas) {
      const n = numeroDeTracker(r.tracker);
      if (n == null) continue;
      const norte = alNorte.has(String(n));
      const sur = alSur.has(String(n));
      if (norte === sur) continue; // no se pudo ubicar, o esta en los dos

      /*
        Los bancos al norte de la calle la tienen a su SUR, y viceversa. La
        punta que da a la calle es entonces la de menor latitud para los del
        norte y la de mayor para los del sur.
      */
      const haciaLaCalle: "start" | "end" = norte
        ? (r.start.lat <= r.end.lat ? "start" : "end")
        : (r.start.lat >= r.end.lat ? "start" : "end");

      origins.set(
        r.id,
        dcBoxPlacement === "center-road"
          ? haciaLaCalle
          : haciaLaCalle === "start" ? "end" : "start",
      );
      escritas++;
    }
    if (escritas) resueltos.push(b.block); else sinCalle.push(b.block);
  }

  return { origins, resueltos, sinCalle };
}
