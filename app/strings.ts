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

/**
 * Las tres partes de una referencia a un tracker, vengan juntas o separadas.
 *
 * La lista de strings suele escribirlas todas en una: "01-034-R2" es el bloque
 * 1, el tracker 34 y la fila R2. La planilla de coordenadas las trae en
 * columnas aparte. Sin partirlas igual de los dos lados, no cruza nada.
 */
export interface TrackerRef {
  block?: string;
  tracker: string;
  row?: string;
}

const soloNumero = (s: string): string => {
  const m = s.match(/\d+/);
  return m ? String(Number(m[0])) : s.trim().toLowerCase();
};

/**
 * Parte un texto como "01-034-R2" o "01-005-EXT-R1-L-S2" en sus componentes.
 *
 * Se lee por PARTES, no por formato, y por el mismo motivo que el lector de
 * planos: cada proyecto le agrega a la etiqueta los campos que se le ocurren.
 *
 * Esto estaba escrito como "el ultimo grupo de digitos es el tracker", que
 * funciona con "01-034-R2" y se rompe con
 *
 *     01-005-EXT-R1-L-S2
 *
 * donde el ultimo grupo de digitos es el "2" de "S2". El tracker 5 entraba como
 * el tracker 2 y la fila quedaba sin resolver: 13606 strings leidos, 0 cruzados,
 * y ni un error — la lista entraba entera y no servia para nada.
 *
 * Peor: el lector de planos ya se habia arreglado con esta misma regla y quedo
 * una SEGUNDA copia de la logica vieja aca. Ahora la regla vive en un solo
 * lugar y los dos lados la comparten.
 */
export function parseTrackerRef(texto: string, blockAparte?: string): TrackerRef {
  const t = String(texto).trim();
  const partes = t.split(/[-._/ ]+/).filter(Boolean);

  /*
    La fila: el PRIMER pedazo con forma de R+numero.

    El primero y no el ultimo porque atras vienen codigos de pila —P1S, P1N, S2—
    que no son filas. En "01-005-EXT-R1-L-S2" la fila es R1.
  */
  let row: string | undefined;
  let filaEn = -1;
  for (let i = 0; i < partes.length; i++) {
    const m = /^R(?:OW)?(\d{1,2})$/i.exec(partes[i]!);
    if (m) { row = `R${Number(m[1])}`; filaEn = i; break; }
  }
  // "ROW 2" escrito con espacio queda partido en dos pedazos.
  if (!row) {
    for (let i = 0; i < partes.length - 1; i++) {
      if (/^R(?:OW)?$/i.test(partes[i]!) && /^\d{1,2}$/.test(partes[i + 1]!)) {
        row = `R${Number(partes[i + 1]!)}`;
        filaEn = i;
        break;
      }
    }
  }

  /*
    El bloque y el tracker: los dos primeros pedazos con digitos que esten ANTES
    de la fila. Antes de la fila porque lo que viene despues son codigos.

    Si la fila esta primera —un parque que llama "R12" a sus trackers— entonces
    ese pedazo ES el nombre del tracker y no hay fila que sacar.
  */
  /*
    Si lo que parecia la fila es el PRIMER pedazo, no es una fila: es el nombre
    del tracker. Hay parques que los llaman "R12" —el numero de fila ES el
    nombre— y sacarle la "fila" lo dejaba sin nombre y sin cruzar con nada.
  */
  if (filaEn === 0) { row = undefined; filaEn = -1; }

  const hasta = filaEn > 0 ? filaEn : partes.length;
  const numeros: string[] = [];
  for (let i = 0; i < hasta; i++) {
    const m = /\d+/.exec(partes[i]!);
    if (m) numeros.push(m[0]!);
  }

  const ref: TrackerRef = { tracker: "" };
  if (numeros.length >= 2) {
    ref.block = String(Number(numeros[0]!));
    ref.tracker = String(Number(numeros[1]!));
  } else if (numeros.length === 1) {
    ref.tracker = String(Number(numeros[0]!));
  } else {
    ref.tracker = t.toLowerCase();
  }

  if (blockAparte) ref.block = soloNumero(blockAparte);
  if (row) ref.row = row;
  return ref;
}

/**
 * Lleva la etiqueta de fila a una forma comun.
 *
 * La lista de strings dice R2 o R3; la geometria de Edenvale dice "motorizada"
 * o "esclava", porque su columna era una bandera si/no. El perfil ya declara
 * cuales filas llevan motor, asi que se usa eso en vez de inventar una regla.
 */
export function canonRow(row: string | undefined, naming?: RowNaming): string | undefined {
  if (!row) return undefined;
  const r = row.trim().toLowerCase();
  if (r === "motorizada" || r === "esclava") return r;
  const upper = row.trim().toUpperCase();
  if (naming?.motorized?.some((m) => m.toUpperCase() === upper)) return "motorizada";
  if (naming?.slave?.some((m) => m.toUpperCase() === upper)) return "esclava";
  return r;
}

export interface RowNaming {
  motorized?: string[];
  slave?: string[];
  /**
   * Cual de las filas de un tracker es la motorizada, cuando los dos lados
   * usan vocabularios distintos y no hay lista que los una.
   *
   * En Edenvale la lista de strings numera las filas de corrido por bloque
   * (tracker 33 → R1, tracker 34 → R2 y R3, tracker 35 → R4 y R5) mientras la
   * geometria solo sabe "motorizada" o "esclava", porque su columna era una
   * bandera si/no. Ninguna lista de R fijas sirve ahi: cambia en cada bloque.
   * Lo que si se mantiene es el ORDEN adentro del tracker.
   */
  orderWithinTracker?: "lowest-first" | "highest-first";
}

export interface MatchOptions {
  naming?: RowNaming;
  /** Orden de las filas de la geometria adentro de un tracker. */
  geometryOrder?: string[];
}

/** El orden en que la geometria nombra las filas de un tracker. */
const ORDEN_GEOMETRIA = ["motorizada", "esclava"];

export interface MatchReport {
  strategy: string;
  matched: number;
  total: number;
  rowsWithStrings: number;
  unmatchedExamples: string[];
  /** Como quedo entendida una referencia de cada lado, para ver por que no cruza. */
  preview: Array<{ desde: string; entendido: string; geometria: string }>;
  /**
   * Que fila del archivo quedo asignada a que fila de la geometria.
   *
   * Es lo unico que hace verificable el emparejamiento por orden: el criterio
   * no se puede deducir de las coordenadas —las dos opciones dan una geometria
   * igual de consistente— asi que en vez de esconderlo se muestra la decision
   * concreta para que se pueda mirar y desmentir.
   */
  pairing?: Array<{ tracker: string; pares: string[] }>;
}

export interface MatchResult {
  byRow: Map<string, { labels: string[]; dcBox?: string }>;
  report: MatchReport;
}

/** Las formas de armar la clave, de la mas exigente a la mas suelta. */
const CLAVES: Array<{ name: string; fn: (r: TrackerRef) => string | null }> = [
  { name: "bloque + tracker + fila", fn: (r) => (r.block && r.row ? `${r.block}|${r.tracker}|${r.row}` : null) },
  { name: "bloque + tracker", fn: (r) => (r.block ? `${r.block}|${r.tracker}` : null) },
  { name: "tracker + fila", fn: (r) => (r.row ? `${r.tracker}|${r.row}` : null) },
  { name: "tracker solo", fn: (r) => r.tracker },
];

type Lado = { row: TrackerRow; ref: TrackerRef };
type Fuente = { entry: StringEntry; ref: TrackerRef };

const trackerKey = (r: TrackerRef): string | null => (r.block ? `${r.block}|${r.tracker}` : null);

/** El numero que trae una etiqueta de fila, para poder ordenarlas. Ej: R12 → 12 */
const numeroDeFila = (row: string): number => {
  const m = row.match(/\d+/);
  return m ? Number(m[0]) : Number.POSITIVE_INFINITY;
};

/**
 * Empareja las filas de cada tracker por ORDEN, no por nombre.
 *
 * Es la unica salida cuando los dos lados usan vocabularios que no se tocan:
 * el archivo dice R2 y R3, la geometria dice motorizada y esclava, y no hay
 * ninguna lista que los una porque los numeros de fila corren de corrido por
 * el bloque entero. Lo que si se conserva es el orden adentro del tracker, y
 * eso alcanza: si el tracker tiene dos filas de cada lado, la primera es la
 * primera.
 *
 * Solo empareja cuando las cantidades coinciden. Un tracker con dos filas en
 * la geometria y tres etiquetas en el archivo queda sin cruzar, que es lo
 * correcto: mejor decir que no se pudo que inventar una correspondencia.
 */
function pairByOrder(
  geo: Lado[],
  strings: Fuente[],
  opts: MatchOptions,
): { mapa: Map<string, TrackerRow>; ejemplos: Array<{ tracker: string; pares: string[] }> } {
  const orden = opts.geometryOrder ?? ORDEN_GEOMETRIA;
  const desc = opts.naming?.orderWithinTracker === "highest-first";

  const geoPorTracker = new Map<string, Lado[]>();
  for (const g of geo) {
    const k = trackerKey(g.ref);
    if (k) geoPorTracker.set(k, [...(geoPorTracker.get(k) ?? []), g]);
  }

  const filasPorTracker = new Map<string, Set<string>>();
  for (const s of strings) {
    const k = trackerKey(s.ref);
    if (!k || !s.ref.row) continue;
    const set = filasPorTracker.get(k) ?? new Set<string>();
    set.add(s.ref.row);
    filasPorTracker.set(k, set);
  }

  // Clave "bloque|tracker|fila del archivo" → la fila de la geometria.
  const mapa = new Map<string, TrackerRow>();
  const ejemplos: Array<{ tracker: string; pares: string[] }> = [];

  for (const [k, lados] of geoPorTracker) {
    const etiquetas = [...(filasPorTracker.get(k) ?? [])].sort((a, b) =>
      desc ? numeroDeFila(b) - numeroDeFila(a) : numeroDeFila(a) - numeroDeFila(b),
    );
    if (!etiquetas.length || etiquetas.length !== lados.length) continue;

    const geoOrdenado = [...lados].sort((a, b) => {
      const ia = orden.indexOf(a.ref.row ?? "");
      const ib = orden.indexOf(b.ref.row ?? "");
      return (ia < 0 ? orden.length : ia) - (ib < 0 ? orden.length : ib);
    });

    etiquetas.forEach((fila, i) => mapa.set(`${k}|${fila}`, geoOrdenado[i]!.row));

    // Los que tienen mas de una fila son los unicos donde la decision se juega.
    if (lados.length > 1 && ejemplos.length < 4) {
      const [bloque, tracker] = k.split("|");
      ejemplos.push({
        tracker: `bloque ${bloque} · tracker ${tracker}`,
        pares: etiquetas.map((fila, i) => `${fila} → ${geoOrdenado[i]!.ref.row ?? "sin fila"}`),
      });
    }
  }

  return { mapa, ejemplos };
}

export function matchEntries(
  entries: StringEntry[],
  rows: TrackerRow[],
  opts: MatchOptions = {},
): MatchResult {
  const naming = opts.naming;

  // Las dos referencias, partidas igual.
  const geo: Lado[] = rows.map((r) => ({
    row: r,
    ref: { ...parseTrackerRef(r.tracker, r.block), row: canonRow(r.row, naming) } as TrackerRef,
  }));
  const strings: Fuente[] = entries.map((e) => ({
    entry: e,
    ref: (() => {
      const base = parseTrackerRef(e.tracker);
      const row = canonRow(e.row ?? base.row, naming);
      return row ? { ...base, row } : base;
    })(),
  }));

  // Para el informe: contra que filas de la geometria compite cada ejemplo.
  const porTracker = new Map<string, Lado[]>();
  for (const g of geo) {
    const k = trackerKey(g.ref);
    if (k) porTracker.set(k, [...(porTracker.get(k) ?? []), g]);
  }

  const preview = strings.slice(0, 3).map((s) => {
    const k = trackerKey(s.ref);
    const rivales = k ? porTracker.get(k) : undefined;
    return {
      desde: s.entry.tracker + (s.entry.row ? ` ${s.entry.row}` : ""),
      entendido: `bloque ${s.ref.block ?? "?"} · tracker ${s.ref.tracker} · fila ${s.ref.row ?? "?"}`,
      geometria: rivales?.length
        ? `${rivales.length} fila(s) en ese tracker: ${rivales.map((r) => r.ref.row ?? "sin fila").join(", ")}`
        : "no hay ninguna fila con ese bloque y tracker",
    };
  });

  let best: MatchResult | null = null;

  for (const clave of CLAVES) {
    const index = new Map<string, TrackerRow[]>();
    for (const g of geo) {
      const k = clave.fn(g.ref);
      if (!k) continue;
      index.set(k, [...(index.get(k) ?? []), g.row]);
    }

    const byRow = new Map<string, { labels: string[]; dcBox?: string }>();
    const sinMatch: string[] = [];
    let matched = 0;

    for (const s of strings) {
      const k = clave.fn(s.ref);
      const candidatos = k ? index.get(k) : undefined;
      if (!candidatos || candidatos.length !== 1) {
        if (sinMatch.length < 6) {
          sinMatch.push(`${s.entry.tracker}${s.entry.row ? " " + s.entry.row : ""} → ${s.entry.label}`);
        }
        continue;
      }
      matched++;
      const row = candidatos[0]!;
      const prev = byRow.get(row.id) ?? { labels: [] };
      prev.labels.push(s.entry.label);
      if (s.entry.dcBox) prev.dcBox = s.entry.dcBox;
      byRow.set(row.id, prev);
    }

    const result: MatchResult = {
      byRow,
      report: {
        strategy: clave.name,
        matched,
        total: entries.length,
        rowsWithStrings: byRow.size,
        unmatchedExamples: sinMatch,
        preview,
      },
    };
    if (!best || result.report.matched > best.report.matched) best = result;
  }

  // Ultimo recurso, y el que salva el caso de Edenvale: emparejar por orden
  // adentro del tracker. Va al final a proposito — si cruzar por nombre ya
  // funciono, eso manda.
  const { mapa, ejemplos } = pairByOrder(geo, strings, opts);
  if (mapa.size) {
    const byRow = new Map<string, { labels: string[]; dcBox?: string }>();
    const sinMatch: string[] = [];
    let matched = 0;

    for (const s of strings) {
      const k = trackerKey(s.ref);
      const row = k && s.ref.row ? mapa.get(`${k}|${s.ref.row}`) : undefined;
      if (!row) {
        if (sinMatch.length < 6) {
          sinMatch.push(`${s.entry.tracker}${s.entry.row ? " " + s.entry.row : ""} → ${s.entry.label}`);
        }
        continue;
      }
      matched++;
      const prev = byRow.get(row.id) ?? { labels: [] };
      prev.labels.push(s.entry.label);
      if (s.entry.dcBox) prev.dcBox = s.entry.dcBox;
      byRow.set(row.id, prev);
    }

    const orden = opts.naming?.orderWithinTracker === "highest-first" ? "mas alta" : "mas baja";
    const result: MatchResult = {
      byRow,
      report: {
        strategy: `bloque + tracker + orden de fila (la ${orden} es la motorizada)`,
        matched,
        total: entries.length,
        rowsWithStrings: byRow.size,
        unmatchedExamples: sinMatch,
        preview,
        pairing: ejemplos,
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
