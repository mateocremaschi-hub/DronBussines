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

  // El plano indexa por tracker ("04-018") y lista que filas R tiene cada uno.
  //
  // El cruce va por tracker + fila, NO por el id de la fila. El id que arma la
  // importacion es `bloque-tracker-fila`, y como el tracker ya trae el bloque
  // adentro eso da "05-05-001-R1", que no se parece a nada del plano. Cruzar
  // por id parecia andar mientras las dos puntas eran de laboratorio y no
  // cruzaba una sola fila con los archivos de verdad — sin error, sin excepcion:
  // el plano entraba, se aplicaba a nada, y decia que habia resuelto cero.
  const porFila = new Map<string, { side?: TrackerRow["side"]; dcbox?: string }>();
  for (const bloque of Object.values(plano)) {
    for (const [tracker, t] of Object.entries(bloque.trackers ?? {})) {
      const lado = t.side ? LADOS[t.side.toLowerCase()] : undefined;
      const caja = t.dcbox ?? undefined;
      const dato = { ...(lado ? { side: lado } : {}), ...(caja ? { dcbox: caja } : {}) };
      for (const r of t.rows ?? []) porFila.set(`${tracker}-${r}`, dato);
      // Y el tracker pelado, para las filas que no tienen etiqueta R.
      porFila.set(tracker, dato);
    }
  }

  const out = rows.map((r) => {
    const p =
      (r.row ? porFila.get(`${r.tracker}-${r.row}`) : undefined) ??
      porFila.get(r.tracker) ??
      porFila.get(r.id);
    if (!p) { sinPlano.push(r.id); return r; }

    const next: TrackerRow = { ...r };
    if (p.side) {
      if (r.side && r.side !== p.side) {
        conflictos.push({ rowId: r.id, campo: "lado", cargado: r.side, plano: p.side });
      }
      next.side = p.side;
      conLado++;
    }
    if (p.dcbox) conCajaDc++;
    return next;
  });

  return {
    rows: out,
    conLado,
    conCajaDc,
    sinPlano,
    conflictos,
    notas: notasDe(conLado, conCajaDc, sinPlano.length, conflictos.length, rows.length),
  };
}

function notasDe(
  conLado: number, conCaja: number, sinPlano: number, conflictos: number, total: number,
): string[] {
  const notas: string[] = [];

  notas.push(
    `El plano resolvio el lado de ${conLado} de ${total} filas. Eso deja de ser una deduccion ` +
    "geometrica y pasa a ser un dato dibujado.",
  );

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
