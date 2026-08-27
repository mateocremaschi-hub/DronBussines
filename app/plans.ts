/**
 * Cargar los planos de interconexion, en vez de deducir lo que ya esta dibujado.
 *
 * Esta pieza es la respuesta a una critica que tenia razon: si para cada parque
 * hay que ir al campo a contar modulos para descubrir de que lado esta cada
 * bloque, el seteo cuesta mas que el vuelo. Y no hacia falta — los PDF de
 * interconexion que el proyecto ya tiene traen dibujado el lado, la caja de
 * continua de cada tracker y que filas R tiene cada uno.
 *
 * Lo que se importa aca es la salida del extractor de planos (`all_blocks.json`,
 * del pipeline del Tracker Finder), que ya esta validado sobre 3458 trackers de
 * Edenvale sin un solo nulo. Pica no vuelve a extraer nada: consume.
 *
 * Y hay un dato que NO se importa, a proposito, aunque este ahi con un nombre
 * que invita: el `pos` del plano es la posicion FISICA del tracker contando
 * desde la calle, y el `pos` de Pica es la posicion ELECTRICA dentro de su
 * linea, que es la que decide si el string lejano se cuenta invertido. Son dos
 * cosas distintas con el mismo nombre. Copiar una sobre la otra daria un parque
 * entero de conteos invertidos en los lugares equivocados.
 */

import type { TrackerRow } from "@locator";

// ---------------------------------------------------------------------------
// Lo que trae el archivo del extractor
// ---------------------------------------------------------------------------

interface TrackerDelPlano {
  rows?: string[];
  cx?: number;
  cy?: number;
  side?: string;
  dcbox?: string | null;
  /** Rango fisico desde la calle. NO es la posicion electrica. */
  pos?: number;
  pos_total?: number;
}

interface BloqueDelPlano {
  trackers?: Record<string, TrackerDelPlano>;
  dcbox?: Array<{ name: string; x: number; y: number }>;
  strings?: Array<{ n: string; s?: string; t?: string; r?: string }>;
  road?: number;
  axis?: string;
}

export type PlanoDeParque = Record<string, BloqueDelPlano>;

export interface ResumenDelPlano {
  bloques: number;
  trackers: number;
  cajas: number;
  strings: number;
  /** Trackers del plano que no aparecen en la geometria cargada. */
  sinGeometria: string[];
}

export function leerPlano(texto: string): { plano: PlanoDeParque; resumen: ResumenDelPlano } | { error: string } {
  let crudo: unknown;
  try { crudo = JSON.parse(texto); } catch { return { error: "El archivo no es un JSON valido." }; }
  if (!crudo || typeof crudo !== "object" || Array.isArray(crudo)) {
    return { error: "Esperaba el all_blocks.json del extractor de planos: un objeto con un bloque por clave." };
  }

  const plano = crudo as PlanoDeParque;
  const bloques = Object.keys(plano);
  if (!bloques.length) return { error: "El archivo no tiene ningun bloque." };

  const alguno = plano[bloques[0]!];
  if (!alguno || typeof alguno !== "object" || !alguno.trackers) {
    return {
      error:
        "El archivo no parece el all_blocks.json del extractor: a los bloques les falta la lista de trackers.",
    };
  }

  let trackers = 0, cajas = 0, strings = 0;
  for (const b of Object.values(plano)) {
    trackers += Object.keys(b.trackers ?? {}).length;
    cajas += (b.dcbox ?? []).length;
    strings += (b.strings ?? []).length;
  }

  return { plano, resumen: { bloques: bloques.length, trackers, cajas, strings, sinGeometria: [] } };
}

// ---------------------------------------------------------------------------
// Aplicarlo a la geometria
// ---------------------------------------------------------------------------

export interface Conflicto {
  rowId: string;
  campo: string;
  cargado: string;
  plano: string;
}

export interface AplicacionDelPlano {
  rows: TrackerRow[];
  /** Cuantas filas recibieron cada dato. */
  conLado: number;
  conCajaDc: number;
  /** Filas de la geometria que el plano no menciona. */
  sinPlano: string[];
  /**
   * Donde el plano contradice lo que ya estaba cargado.
   *
   * No se ocultan ni se resuelven solos: el plano es mas confiable que una
   * deduccion, pero si contradice un dato que vino de otro archivo del cliente
   * eso es justamente lo que hay que mirar antes de volar.
   */
  conflictos: Conflicto[];
  notas: string[];
}

const LADOS: Record<string, TrackerRow["side"]> = {
  north: "north", south: "south", east: "east", west: "west",
};

/**
 * Cruza el plano con la geometria cargada.
 *
 * El plano manda sobre las deducciones —esta dibujado, no inferido— pero no
 * pisa en silencio: cada desacuerdo con lo que ya estaba queda listado.
 */
export function aplicarPlano(rows: TrackerRow[], plano: PlanoDeParque): AplicacionDelPlano {
  const conflictos: Conflicto[] = [];
  const sinPlano: string[] = [];
  let conLado = 0;
  let conCajaDc = 0;

  // El cruce va por TRACKER, no por fila.
  //
  // No es un atajo: en el plano el lado y la caja de continua son datos del
  // tracker, iguales para todas sus filas R. Meter la fila en la clave solo
  // agrega una manera de no encontrarse.
  //
  // Y la clave se normaliza a numeros porque los dos archivos escriben el
  // mismo tracker distinto. El plano dice "04-018"; la planilla de coordenadas
  // trae el bloque en una columna y el tracker en otra, y segun el parque eso
  // puede ser "04-018", "4-18" o "18" pelado. Comparar los textos parecia
  // andar en el ejemplo y cruzaba CERO de 6748 filas con Edenvale entero, sin
  // error y sin excepcion: el plano entraba, se aplicaba a nada, y lo decia
  // con un numero que era facil leer como "faltan PDF".
  const porTracker = new Map<string, { side?: TrackerRow["side"]; dcbox?: string }>();
  const ejemplosPlano: string[] = [];
  for (const [bloqueId, bloque] of Object.entries(plano)) {
    for (const [tracker, t] of Object.entries(bloque.trackers ?? {})) {
      const clave = claveDeTracker(bloqueId, tracker);
      if (!clave) continue;
      const lado = t.side ? LADOS[t.side.toLowerCase()] : undefined;
      const caja = t.dcbox ?? undefined;
      porTracker.set(clave, {
        ...(lado ? { side: lado } : {}),
        ...(caja ? { dcbox: caja } : {}),
      });
      if (ejemplosPlano.length < 3) ejemplosPlano.push(`${bloqueId} / ${tracker}`);
    }
  }

  const ejemplosGeometria: string[] = [];
  const out = rows.map((r) => {
    const clave = claveDeTracker(r.block, r.tracker);
    const p = clave ? porTracker.get(clave) : undefined;
    if (!p) {
      sinPlano.push(r.id);
      if (ejemplosGeometria.length < 3) ejemplosGeometria.push(`${r.block} / ${r.tracker}`);
      return r;
    }

    const next: TrackerRow = { ...r };
    if (p.side) {
      if (r.side && r.side !== p.side) {
        conflictos.push({ rowId: r.id, campo: "lado", cargado: r.side, plano: p.side });
      }
      next.side = p.side;
      conLado++;
    }
    // Antes esto solo CONTABA la caja y la tiraba. El informe decia "N filas
    // con caja de continua" y despues la caja no aparecia en ningun lado: ni en
    // la fila, ni en la direccion que se da en el campo, ni en el CSV. La caja
    // es por donde se entra caminando, o sea la mitad de la utilidad del plano.
    if (p.dcbox) {
      next.dcBoxLabel = p.dcbox;
      conCajaDc++;
    }
    return next;
  });

  return {
    rows: out,
    conLado,
    conCajaDc,
    sinPlano,
    conflictos,
    notas: notasDe(conLado, conCajaDc, sinPlano.length, conflictos.length, rows.length,
                   ejemplosPlano, ejemplosGeometria),
  };
}

/**
 * La misma clave de tracker aunque los dos archivos lo escriban distinto.
 *
 * Se queda con el ULTIMO grupo de digitos de cada uno y los compara como
 * numeros. Asi "04" + "04-018", "4" + "4-18" y "04" + "18" caen todos en la
 * misma clave, que es lo que son: el tracker 18 del bloque 4. Los ceros a la
 * izquierda son formato, no identidad.
 *
 * El ultimo grupo y no el primero porque el prefijo suele ser el que sobra: un
 * bloque escrito "T2-05" es el bloque 5 del transformador 2, y quedarse con el
 * primer numero lo mandaria al bloque 2.
 */
function claveDeTracker(block: string | undefined, tracker: string | undefined): string | null {
  const ultimo = (s: string | undefined): string | undefined => {
    const d = (s ?? "").match(/\d+/g);
    return d ? d[d.length - 1] : undefined;
  };
  const b = ultimo(block);
  const t = ultimo(tracker);
  if (b == null || t == null) return null;
  return `${Number(b)}-${Number(t)}`;
}

function notasDe(
  conLado: number, conCaja: number, sinPlano: number, conflictos: number, total: number,
  ejemplosPlano: string[] = [], ejemplosGeometria: string[] = [],
): string[] {
  const notas: string[] = [];

  notas.push(
    `El plano resolvio el lado de ${conLado} de ${total} filas. Eso deja de ser una deduccion ` +
    "geometrica y pasa a ser un dato dibujado.",
  );

  /**
   * Cero es un caso aparte, no "pocas".
   *
   * Si no cruzo NINGUNA, no faltan PDF: los dos archivos nombran los trackers
   * de maneras que no se tocan. Decirlo con un ejemplo de cada lado convierte
   * media hora de adivinar en diez segundos de mirar.
   */
  if (!conLado && total) {
    notas.push(
      "No cruzo ni una sola fila, asi que no es que falten planos: los dos archivos escriben el " +
      "tracker distinto. El plano dice " + (ejemplosPlano.join(", ") || "(nada)") +
      " y la geometria cargada dice " + (ejemplosGeometria.join(", ") || "(nada)") +
      " (bloque / tracker). Mandame esos dos ejemplos y lo emparejo.",
    );
  }

  if (conCaja) {
    notas.push(
      `${conCaja} filas quedaron con su caja de continua de entrada, que es por donde se llega ` +
      "caminando. Va al informe: no es lo mismo decir «tracker 18» que decir «entrá por la DCB-1.2.15».",
    );
  }

  if (conflictos) {
    notas.push(
      `${conflictos} filas donde el plano contradice lo que ya estaba cargado. El plano manda ` +
      "—esta dibujado, no inferido— pero conviene mirar esas: si el dato viejo venia de un archivo " +
      "del cliente y no de una deduccion, ahi hay algo que no cierra.",
    );
  }

  if (sinPlano) {
    notas.push(
      `${sinPlano} filas de la geometria no aparecen en el plano. Puede faltar el PDF de ese ` +
      "bloque, o los trackers estar numerados distinto entre los dos archivos.",
    );
  }

  notas.push(
    "Lo que NO se importa: el «pos» del plano es el rango fisico desde la calle, y el de Pica es " +
    "la posicion electrica en la linea, que es la que decide si el string lejano se cuenta " +
    "invertido. Mismo nombre, cosas distintas.",
  );

  return notas;
}
