/**
 * La lista de strings: el archivo que cierra la numeracion.
 *
 * Es la planilla que mapea cada string a su tracker y a su caja DC. Trae los
 * tres datos que no salen de la geometria: el numero real del string, la caja
 * que lo alimenta, y —cruzando con la geometria— el orden de los trackers
 * dentro de su linea electrica.
 *
 * Regla que atraviesa este archivo: cada paso muestra cuanto matcheo y con que
 * ejemplos falla. Un import que dice "listo" sin decir sobre cuantas filas
 * trabajo es un import en el que no se puede confiar.
 */

import { makeFrame, toLocal } from "@locator";
import type { TrackerRow } from "@locator";
import type { Sheet } from "./ingest";

// ---------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------

export interface StringEntry {
  label: string;
  tracker: string;
  row?: string;
  dcBox?: string;
}

export interface StringMapping {
  label?: string;
  tracker?: string;
  row?: string;
  dcBox?: string;
}

const WORDS = {
  label: [["string"], ["cadena"], ["codigo", "string"]],
  tracker: [["tracker"], ["seguidor"], ["mesa"]],
  row: [["row"], ["fila"]],
  dcBox: [["dc", "box"], ["dcb"], ["caja", "dc"], ["combiner"], ["caja"]],
};

function tokens(h: string): string[] {
  return String(h).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/).filter(Boolean);
}

export function suggestStringMapping(headers: string[]): StringMapping {
  const m: StringMapping = {};
  const taken = new Set<string>();
  for (const [key, combos] of Object.entries(WORDS) as Array<[keyof StringMapping, string[][]]>) {
    for (const combo of combos) {
      const hit = headers.find((h) => !taken.has(h) && combo.every((w) => tokens(h).includes(w)));
      if (hit) { m[key] = hit; taken.add(hit); break; }
    }
  }
  return m;
}

/**
 * Rellena hacia abajo las columnas con celdas combinadas.
 *
 * En estas planillas la caja DC suele estar combinada sobre muchas filas, y al
 * leerlas solo aparece en la primera de cada bloque. Sin esto, el 90 % de los
 * strings queda sin caja.
 */
export function forwardFill(sheet: Sheet, columns: string[]): Sheet {
  const last: Record<string, unknown> = {};
  const rows = sheet.rows.map((r) => {
    const out = { ...r };
    for (const c of columns) {
      const v = out[c];
      if (v == null || v === "") out[c] = last[c] ?? null;
      else last[c] = v;
    }
    return out;
  });
  return { ...sheet, rows };
}

export function readEntries(sheet: Sheet, mapping: StringMapping): StringEntry[] {
  const out: StringEntry[] = [];
  for (const r of sheet.rows) {
    const label = mapping.label ? String(r[mapping.label] ?? "").trim() : "";
    const tracker = mapping.tracker ? String(r[mapping.tracker] ?? "").trim() : "";
    if (!label || !tracker) continue;
    const e: StringEntry = { label, tracker };
    const row = mapping.row ? String(r[mapping.row] ?? "").trim() : "";
    if (row) e.row = row;
    const dc = mapping.dcBox ? String(r[mapping.dcBox] ?? "").trim() : "";
    if (dc) e.dcBox = dc;
    out.push(e);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Numero de string dentro de la etiqueta
// ---------------------------------------------------------------------------

/** Los numeros que aparecen en una etiqueta, en orden. Ej: S-1.2.15.2.4 → [1,2,15,2,4] */
export function numericFields(label: string): number[] {
  return (label.match(/\d+/g) ?? []).map(Number);
}

/**
 * Cuantos campos numericos tienen las etiquetas, y que valores toma cada uno.
 *
 * Se muestra en pantalla para elegir cual es el numero de string: en un parque
 * puede ser el ultimo campo y en otro el anteultimo, y adivinarlo es
 * exactamente el tipo de suposicion que este proyecto trata de no hacer.
 */
export function describeFields(labels: string[]): Array<{ index: number; distintos: number; ejemplos: number[] }> {
  const muestra = labels.slice(0, 500).map(numericFields);
  const largo = Math.max(0, ...muestra.map((f) => f.length));
  const out = [];
  for (let i = 0; i < largo; i++) {
    const vals = muestra.map((f) => f[i]).filter((v): v is number => v != null);
    const set = [...new Set(vals)].sort((a, b) => a - b);
    out.push({ index: i, distintos: set.length, ejemplos: set.slice(0, 6) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Matcheo contra la geometria
// ---------------------------------------------------------------------------

/** Normalizaciones que se prueban, de la mas estricta a la mas suelta. */
const NORMS: Array<{ name: string; fn: (block: string, tracker: string, row?: string) => string }> = [
  {
    name: "tracker + fila tal cual",
    fn: (_b, t, r) => `${clean(t)}|${clean(r ?? "")}`,
  },
  {
    name: "tracker solo",
    fn: (_b, t) => clean(t),
  },
  {
    name: "bloque + numero de tracker",
    fn: (b, t) => `${num(b)}-${num(t, -1)}`,
  },
  {
    name: "bloque + numero de tracker + fila",
    fn: (b, t, r) => `${num(b)}-${num(t, -1)}|${clean(r ?? "")}`,
  },
];

const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
/** El n-esimo grupo de digitos de un texto. -1 = el ultimo. */
function num(s: string, which = 0): string {
  const all = s.match(/\d+/g) ?? [];
  const pick = which < 0 ? all[all.length + which] : all[which];
  return pick ? String(Number(pick)) : "";
}

export interface MatchReport {
  strategy: string;
  matched: number;
  total: number;
  rowsWithStrings: number;
  unmatchedExamples: string[];
}

export interface MatchResult {
  /** Por id de fila de geometria: las etiquetas de string que le corresponden. */
  byRow: Map<string, { labels: string[]; dcBox?: string }>;
  report: MatchReport;
}

/**
 * Cruza la lista de strings con la geometria, probando varias formas de
 * escribir el mismo tracker y quedandose con la que mas matchea.
 */
export function matchEntries(entries: StringEntry[], rows: TrackerRow[]): MatchResult {
  let best: MatchResult | null = null;

  for (const norm of NORMS) {
    const index = new Map<string, TrackerRow[]>();
    for (const r of rows) {
      const k = norm.fn(r.block, r.tracker, r.row);
      if (!k || k === "|" || k.startsWith("-|") || k === "-") continue;
      index.set(k, [...(index.get(k) ?? []), r]);
    }

    const byRow = new Map<string, { labels: string[]; dcBox?: string }>();
    const sinMatch: string[] = [];
    let matched = 0;

    for (const e of entries) {
      // La lista de strings no suele traer bloque; se prueba contra todos.
      const candidatos =
        index.get(norm.fn("", e.tracker, e.row)) ??
        index.get(norm.fn(num(e.tracker), e.tracker, e.row)) ??
        index.get(norm.fn(e.tracker.split(/[^0-9]/)[0] ?? "", e.tracker, e.row));

      if (!candidatos || candidatos.length !== 1) {
        if (sinMatch.length < 6) sinMatch.push(`${e.tracker}${e.row ? " " + e.row : ""} → ${e.label}`);
        continue;
      }
      matched++;
      const row = candidatos[0]!;
      const prev = byRow.get(row.id) ?? { labels: [] };
      prev.labels.push(e.label);
      if (e.dcBox) prev.dcBox = e.dcBox;
      byRow.set(row.id, prev);
    }

    const result: MatchResult = {
      byRow,
      report: {
        strategy: norm.name,
        matched,
        total: entries.length,
        rowsWithStrings: byRow.size,
        unmatchedExamples: sinMatch,
      },
    };
    if (!best || result.report.matched > best.report.matched) best = result;
  }

  return best!;
}

// ---------------------------------------------------------------------------
// Lineas electricas
// ---------------------------------------------------------------------------

export interface ChainReport {
  dcBox: string;
  rows: number;
  forma: "cadena" | "paralelas" | "mixta";
  detail: string;
}

export interface ChainResult {
  /** Por id de fila: su posicion en la linea y el largo de la linea. */
  chains: Map<string, { pos: number; posTotal: number }>;
  reports: ChainReport[];
}

/**
 * Deduce la posicion de cada tracker dentro de su linea electrica.
 *
 * Aca esta la parte que NO se adivina. Los trackers que cuelgan de una misma
 * caja DC pueden estar de dos formas, y cada una significa algo distinto:
 *
 *   - En CADENA, uno atras del otro sobre el mismo eje. Entonces hay piercing
 *     connectors entre ellos y el orden importa: el string lejano de todos
 *     menos el ultimo cuenta invertido.
 *   - En PARALELO, uno al lado del otro. Entonces cada uno es su propia linea,
 *     y ninguno invierte.
 *
 * La diferencia se ve en las coordenadas: en cadena los centros caen sobre una
 * misma recta a lo largo del eje de los modulos; en paralelo caen al costado.
 * Asi que se mide, no se supone.
 */
export function deriveChains(
  rows: TrackerRow[],
  byRow: Map<string, { labels: string[]; dcBox?: string }>,
): ChainResult {
  const chains = new Map<string, { pos: number; posTotal: number }>();
  const reports: ChainReport[] = [];

  const porCaja = new Map<string, TrackerRow[]>();
  for (const r of rows) {
    const dc = byRow.get(r.id)?.dcBox;
    if (!dc) continue;
    porCaja.set(dc, [...(porCaja.get(dc) ?? []), r]);
  }

  for (const [dcBox, group] of [...porCaja.entries()].sort()) {
    if (group.length === 1) {
      chains.set(group[0]!.id, { pos: 1, posTotal: 1 });
      reports.push({ dcBox, rows: 1, forma: "cadena", detail: "Un solo tracker: no invierte." });
      continue;
    }

    const frame = makeFrame(group[0]!.start.lat, group[0]!.start.lon);
    const geo = group.map((r) => {
      const a = toLocal(frame, r.start.lat, r.start.lon);
      const b = toLocal(frame, r.end.lat, r.end.lon);
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      return { row: r, a, b, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, ux: (b.x - a.x) / len, uy: (b.y - a.y) / len, len };
    });

    // Eje medio de los modulos, con el signo normalizado.
    let ux = 0, uy = 0;
    for (const g of geo) { const s = g.uy >= 0 ? 1 : -1; ux += g.ux * s; uy += g.uy * s; }
    const n = Math.hypot(ux, uy) || 1;
    ux /= n; uy /= n;

    // Dispersion a lo largo del eje contra dispersion perpendicular.
    const along = geo.map((g) => g.mid.x * ux + g.mid.y * uy);
    const across = geo.map((g) => -g.mid.x * uy + g.mid.y * ux);
    const rango = (v: number[]) => Math.max(...v) - Math.min(...v);
    const largoMedio = geo.reduce((s, g) => s + g.len, 0) / geo.length;

    const enCadena = rango(along) > largoMedio * 0.5 && rango(along) > rango(across);

    if (enCadena) {
      const orden = geo
        .map((g, i) => ({ id: g.row.id, t: along[i]! }))
        .sort((p, q) => p.t - q.t);
      orden.forEach((o, i) => chains.set(o.id, { pos: i + 1, posTotal: orden.length }));
      reports.push({
        dcBox, rows: group.length, forma: "cadena",
        detail:
          `${group.length} trackers en cadena, uno atras del otro sobre ${rango(along).toFixed(0)} m. ` +
          `El string lejano de los primeros ${group.length - 1} cuenta invertido.`,
      });
    } else if (rango(across) > rango(along)) {
      for (const g of geo) chains.set(g.row.id, { pos: 1, posTotal: 1 });
      reports.push({
        dcBox, rows: group.length, forma: "paralelas",
        detail:
          `${group.length} trackers uno al lado del otro, separados ${rango(across).toFixed(0)} m. ` +
          `Cada uno es su propia linea: ninguno invierte.`,
      });
    } else {
      reports.push({
        dcBox, rows: group.length, forma: "mixta",
        detail:
          `${group.length} trackers que no caen ni claramente en cadena ni claramente en paralelo ` +
          `(${rango(along).toFixed(0)} m a lo largo, ${rango(across).toFixed(0)} m al costado). No le asigno posicion.`,
      });
    }
  }

  return { chains, reports };
}

// ---------------------------------------------------------------------------
// Aplicacion
// ---------------------------------------------------------------------------

export interface ApplyOptions {
  /** Que campo numerico de la etiqueta es el numero de string. */
  fieldIndex: number;
  byRow: Map<string, { labels: string[]; dcBox?: string }>;
  chains: Map<string, { pos: number; posTotal: number }>;
}

/** Deja la geometria con numeros de string, etiquetas y posicion en la linea. */
export function applyStrings(rows: TrackerRow[], opts: ApplyOptions): TrackerRow[] {
  return rows.map((r) => {
    const hit = opts.byRow.get(r.id);
    const chain = opts.chains.get(r.id);
    if (!hit && !chain) return r;

    const out: TrackerRow = { ...r };
    if (hit?.labels.length) {
      // Ordenar por el numero elegido: el menor es el mas cercano a la caja DC.
      const pares = hit.labels
        .map((label) => ({ label, n: numericFields(label)[opts.fieldIndex] ?? 0 }))
        .sort((a, b) => a.n - b.n);
      out.stringNumbers = pares.map((p) => p.n);
      out.stringLabels = pares.map((p) => p.label);
    }
    if (chain) { out.pos = chain.pos; out.posTotal = chain.posTotal; }
    return out;
  });
}
