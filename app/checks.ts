/**
 * Verificaciones de campo: la unica prueba de que el parque esta bien cargado.
 *
 * Todo lo demas en esta app es aritmetica sobre coordenadas que alguien
 * escribio en un Excel. Que cierre no prueba nada: el modelo de Edenvale
 * cerraba perfecto con 373 mm de offset y estaba mal, porque nadie sabia que
 * habia una bahia de motor en el medio. Lo unico que separa "el calculo da"
 * de "el calculo es correcto" es alguien parado en el tracker contando
 * modulos.
 *
 * Por eso las verificaciones se registran DONDE OCURREN —en el campo, en el
 * telefono, apenas se cuenta— y no en un documento aparte que se actualiza
 * despues y que nadie mira.
 *
 * Y por eso se registran los desacuerdos igual que los acuerdos. Un parque con
 * tres coincidencias y un choque no es un parque verificado: es un parque con
 * algo sin explicar.
 */

import type { LocateResult, TrackerRow } from "@locator";

export interface FieldCheck {
  id: string;
  at: string;
  coord: { lat: number; lon: number };
  accuracyM?: number;
  /** Lo que dijo la app, en texto, tal como lo vio la persona. */
  said: string;
  rowId: string;
  block: string;
  tracker: string;
  row?: string;
  stringNumber?: number;
  module?: number;
  /** Desde que punta conto la app. Es lo que ejercita la regla de inversion. */
  countedFrom?: "near-dc" | "far-end";
  /** De que lado de la calle cae la fila. Ejercita la deduccion del lado. */
  side?: TrackerRow["side"];
  outcome: "match" | "mismatch";
  /** Que modulo conto la persona, cuando no coincide. */
  countedModule?: number;
  note?: string;
}

// ---------------------------------------------------------------------------
// Que reglas quedan ejercitadas
// ---------------------------------------------------------------------------

/**
 * Las tres cosas distintas que hay que probar en un parque.
 *
 * No alcanza con verificar tres puntos: si los tres caen en el mismo tracker
 * del mismo lado de la calle, se probo una sola regla tres veces. Estas son
 * las tres que fallan por separado, y cada una de un modo distinto:
 *
 *   - contar desde la caja DC (el caso comun)
 *   - contar desde la punta lejana (la regla del piercing connector, la mas
 *     fragil de todas: es la que da el resultado espejado)
 *   - los dos lados de la calle (la deduccion geometrica del lado)
 */
export interface RuleCoverage {
  key: string;
  label: string;
  why: string;
  covered: boolean;
}

export function coverage(checks: FieldCheck[], rows: TrackerRow[]): RuleCoverage[] {
  const ok = checks.filter((c) => c.outcome === "match");
  const lados = new Set(ok.map((c) => c.side).filter(Boolean));
  const ladosEnElParque = new Set(rows.map((r) => r.side).filter(Boolean));

  return [
    {
      key: "near-dc",
      label: "Un modulo contado desde la caja DC",
      why: "El caso comun. Prueba el paso, el voladizo y la bahia del motor.",
      covered: ok.some((c) => c.countedFrom === "near-dc"),
    },
    {
      key: "far-end",
      label: "Un modulo de un string que cuenta invertido",
      why:
        "La regla del piercing connector, que es la que da el resultado espejado cuando esta mal. " +
        "Buscá un tracker que NO sea el ultimo de su linea electrica.",
      covered: ok.some((c) => c.countedFrom === "far-end"),
    },
    {
      key: "sides",
      label: "Un modulo de cada lado de la calle",
      why:
        "El lado se deduce de la pura geometria. Si esta al reves, el conteo entero sale espejado " +
        "en medio parque.",
      // Si el parque tiene un solo lado, no hay nada que probar.
      covered: ladosEnElParque.size < 2 || lados.size >= 2,
    },
  ];
}

export interface ChecksSummary {
  total: number;
  matches: number;
  mismatches: number;
  coverage: RuleCoverage[];
  status: "unverified" | "partial" | "field-verified";
  /** Que falta para poder decir que el parque esta verificado. */
  missing: RuleCoverage[];
}

export function summarize(checks: FieldCheck[], rows: TrackerRow[]): ChecksSummary {
  const matches = checks.filter((c) => c.outcome === "match").length;
  const mismatches = checks.filter((c) => c.outcome === "mismatch").length;
  const cov = coverage(checks, rows);
  const missing = cov.filter((c) => !c.covered);

  // Un choque sin explicar tira el parque atras a "parcial", por mas
  // coincidencias que haya. Es el punto entero de registrarlos.
  const status: ChecksSummary["status"] =
    matches === 0 ? "unverified" : missing.length === 0 && mismatches === 0 ? "field-verified" : "partial";

  return { total: checks.length, matches, mismatches, coverage: cov, status, missing };
}

// ---------------------------------------------------------------------------
// Registro
// ---------------------------------------------------------------------------

/** Arma la verificacion a partir del resultado que la persona esta mirando. */
export function checkFromResult(
  result: LocateResult,
  coord: { lat: number; lon: number },
  said: string,
  row: TrackerRow | undefined,
  outcome: FieldCheck["outcome"],
  extra: { accuracyM?: number | null; countedModule?: number; note?: string } = {},
): FieldCheck | null {
  const best = result.best;
  if (!best) return null;

  const c: FieldCheck = {
    id: `${Date.now()}-${best.rowId}`,
    at: new Date().toISOString(),
    coord,
    said,
    rowId: best.rowId,
    block: best.block,
    tracker: best.tracker,
    outcome,
  };
  if (best.row) c.row = best.row;
  if (best.stringNumber != null) c.stringNumber = best.stringNumber;
  if (best.module != null) c.module = best.module;
  if (best.countedFrom) c.countedFrom = best.countedFrom;
  if (row?.side) c.side = row.side;
  if (extra.accuracyM != null) c.accuracyM = extra.accuracyM;
  if (extra.countedModule != null) c.countedModule = extra.countedModule;
  if (extra.note) c.note = extra.note;
  return c;
}

/**
 * Pasa las verificaciones al perfil, que es lo que viaja con el parque.
 *
 * Se escribe en `calibration` y no en un archivo aparte para que al exportar
 * el parque —o al mandarselo a otra persona— vaya junto la evidencia de que
 * las reglas se probaron, y cuales no.
 */
export function toCalibration(
  checks: FieldCheck[],
  rows: TrackerRow[],
): { status: ChecksSummary["status"]; verifiedCases: string[]; unverified: string[] } {
  const s = summarize(checks, rows);
  const verifiedCases = checks
    .filter((c) => c.outcome === "match")
    .map((c) => `${c.said} — contado a mano y coincide (${c.at.slice(0, 10)})`);
  const choques = checks
    .filter((c) => c.outcome === "mismatch")
    .map(
      (c) =>
        `SIN EXPLICAR: la app dijo "${c.said}" y el conteo a mano dio ` +
        `${c.countedModule ?? "otro numero"} (${c.at.slice(0, 10)})${c.note ? ` — ${c.note}` : ""}`,
    );
  return {
    status: s.status,
    verifiedCases,
    unverified: [...choques, ...s.missing.map((m) => `${m.label}: ${m.why}`)],
  };
}
