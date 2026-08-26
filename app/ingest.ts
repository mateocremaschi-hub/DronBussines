/**
 * Ingesta: convierte el archivo que te dio el cliente en geometria que el motor
 * entiende.
 *
 * Principio de diseno, sacado directo de lo que salio mal en Edenvale: la
 * deteccion automatica de columnas es una SUGERENCIA, nunca una condicion.
 * Si no reconoce nada, no falla — te muestra las columnas y las elegis vos.
 * Un importador que se niega a trabajar porque no reconocio un encabezado es
 * un importador que no sirve para "cualquier parque".
 */

import { distanceM, makeFrame, toLocal, utmToWgs84 } from "@locator";
import type { FarmProfile, TrackerRow } from "@locator";

// ---------------------------------------------------------------------------
// Lectura del archivo
// ---------------------------------------------------------------------------

export interface Sheet {
  name: string;
  headers: string[];
  rows: Array<Record<string, unknown>>;
}

/**
 * Toma el contenido crudo, no un `File`, por dos razones: se puede testear en
 * Node sin navegador, y la libreria de Excel se carga solo cuando de verdad
 * hay un archivo — son 400 kB que la app de campo no tiene por que bajar.
 */
export async function readWorkbook(
  buf: ArrayBuffer,
  /** Fila donde estan los encabezados, 1-based. Algunas planillas traen dos filas de titulo. */
  headerRow = 1,
): Promise<Sheet[]> {
  const XLSX = await import("xlsx");

  /**
   * `raw: true` al PARSEAR, no solo al convertir a filas.
   *
   * Sin esto, el lector de CSV aplica la convencion contable: interpreta los
   * parentesis como signo negativo y la coma como separador de miles, asi que
   * "(1,25)" —la posicion del modulo 25 en el informe de una termografica—
   * entra como el numero -125.
   *
   * No es hipotetico: pasa con el archivo real de Edenvale, en las 3156 filas.
   * Y es el peor tipo de error, porque no falla nada: queda un numero valido y
   * equivocado. Es la misma convencion que aplica Excel al abrir ese CSV.
   */
  const wb = XLSX.read(buf, { cellDates: false, raw: true });

  const sheets: Sheet[] = [];
  // Recorre TODAS las hojas. En Edenvale, mirar solo la primera fue un bug real:
  // la hoja con los datos no siempre es la primera del archivo.
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws) continue;
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
      defval: null,
      raw: true,
      ...(headerRow > 1 ? { range: headerRow - 1 } : {}),
    });
    const headers = new Set<string>();
    for (const r of rows.slice(0, 200)) for (const k of Object.keys(r)) headers.add(k);
    sheets.push({ name, headers: [...headers], rows });
  }
  return sheets;
}

// ---------------------------------------------------------------------------
// Numeros
// ---------------------------------------------------------------------------

/**
 * Convierte a numero tolerando lo que aparece en planillas reales: separadores
 * de miles, coma decimal, espacios finos, celdas guardadas como texto.
 */
export function toNumber(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  let s = String(v).trim().replace(/\s| /g, "");
  if (s === "") return null;
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma > -1 && lastDot > -1) {
    // El separador decimal es el que aparece mas a la derecha.
    if (lastComma > lastDot) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
  } else if (lastComma > -1) {
    // Una sola coma: decimal si deja 1-3 digitos a la derecha y no es de miles.
    s = /,\d{3}$/.test(s) ? s.replace(/,/g, "") : s.replace(",", ".");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// Mapeo de columnas
// ---------------------------------------------------------------------------

export type FieldKey =
  | "block"
  | "tracker"
  | "row"
  | "startX"
  | "startY"
  | "endX"
  | "endY"
  | "side"
  | "pos"
  | "posTotal"
  | "stringNumbers";

export interface FieldSpec {
  key: FieldKey;
  label: string;
  help: string;
  required: boolean;
  /** Palabras que identifican la columna. Se comparan como token completo. */
  words?: string[][];
}

export const FIELDS: FieldSpec[] = [
  {
    key: "block",
    label: "Bloque",
    help: "Identificador del bloque o sector.",
    required: true,
    words: [["bloque"], ["block"], ["bl"], ["sector"]],
  },
  {
    key: "tracker",
    label: "Tracker",
    help: "Numero o codigo del tracker.",
    required: true,
    words: [["tracker"], ["seguidor"], ["trk"], ["mesa"]],
  },
  {
    key: "row",
    label: "Fila (R1, R2…)",
    help: "Fila de modulos dentro del tracker, si el parque las distingue. Puede ser una bandera si/no de fila motorizada.",
    required: false,
    words: [["motor", "row"], ["row"], ["fila"]],
  },
  { key: "startY", label: "Pica 1 · latitud / Norte", help: "Coordenada norte-sur de una punta del tracker.", required: true },
  { key: "startX", label: "Pica 1 · longitud / Este", help: "Coordenada este-oeste de esa misma punta.", required: true },
  { key: "endY", label: "Pica 2 · latitud / Norte", help: "Coordenada norte-sur de la punta opuesta.", required: true },
  { key: "endX", label: "Pica 2 · longitud / Este", help: "Coordenada este-oeste de la punta opuesta.", required: true },
  {
    key: "side",
    label: "Lado de la calle",
    help: "Norte / sur / este / oeste. Lo necesita la estrategia de conteo desde la caja DC. Si no lo tenes, la app puede deducirlo de la geometria.",
    required: false,
    words: [["lado"], ["side"]],
  },
  {
    key: "pos",
    label: "Posicion en la linea",
    help: "Que numero de tracker es dentro de su linea electrica. Lo necesita la regla del piercing connector.",
    required: false,
    words: [["pos"], ["posicion"], ["position"], ["orden"]],
  },
  {
    key: "posTotal",
    label: "Trackers en la linea",
    help: "Cuantos trackers tiene esa linea en total.",
    required: false,
    words: [["pos", "total"], ["total", "trackers"], ["largo", "linea"]],
  },
  {
    key: "stringNumbers",
    label: "Numeros de string",
    help: "Los strings de esta fila, separados por coma o guion. Ej: 5,6",
    required: false,
    words: [["strings"], ["string"], ["cadenas"], ["cadena"]],
  },
];

export type Mapping = Partial<Record<FieldKey, string>>;

/**
 * Parte un encabezado en palabras sueltas.
 *
 * Se compara por token completo y no con expresiones sobre el texto entero,
 * porque asi se cuela un error real: el patron para "este" matcheaba la E final
 * de "NORTE", y "PICA2_NORTE" terminaba asignada a la columna de longitud.
 */
function tokenize(header: string): string[] {
  return String(header)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/([a-z])(\d)/g, "$1 $2")
    .replace(/(\d)([a-z])/g, "$1 $2")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

// Palabras que nombran el eje sin ambiguedad.
const AXIS_Y = new Set(["lat", "latitud", "latitude", "northing", "y"]);
const AXIS_X = new Set(["lon", "lng", "long", "longitud", "longitude", "easting", "x"]);

// Rumbos: nombran el eje cuando no hay nada mejor, pero cuando SI lo hay pasan
// a nombrar la punta. "Y_NORTE" es la coordenada norte-sur de la pica norte.
const DIR_Y = new Set(["norte", "north", "n"]);
const DIR_X = new Set(["este", "east", "e"]);

const FIRST_WORDS = new Set(["1", "a", "inicio", "ini", "start", "desde", "from", "norte", "north"]);
const SECOND_WORDS = new Set(["2", "b", "fin", "final", "end", "hasta", "to", "sur", "south"]);

/** Que punta y que eje describe un encabezado de coordenada, si es que lo es. */
function readCoordinate(tokens: string[]): { end: 1 | 2; axis: "y" | "x" } | null {
  const hasStrictY = tokens.some((t) => AXIS_Y.has(t));
  const hasStrictX = tokens.some((t) => AXIS_X.has(t));

  let axis: "y" | "x";
  let usedForAxis: Set<string>;

  if (hasStrictY !== hasStrictX) {
    axis = hasStrictY ? "y" : "x";
    usedForAxis = hasStrictY ? AXIS_Y : AXIS_X;
  } else if (!hasStrictY && !hasStrictX) {
    // Sin palabra clara del eje, se cae a los rumbos.
    const looseY = tokens.some((t) => DIR_Y.has(t));
    const looseX = tokens.some((t) => DIR_X.has(t));
    if (looseY === looseX) return null;
    axis = looseY ? "y" : "x";
    usedForAxis = looseY ? DIR_Y : DIR_X;
  } else {
    // Nombra los dos ejes: no se puede decidir.
    return null;
  }

  // Lo que queda despues de sacar el token del eje puede decir que punta es.
  let axisConsumed = false;
  const pool = tokens.filter((t) => {
    if (!axisConsumed && usedForAxis.has(t)) {
      axisConsumed = true;
      return false;
    }
    return true;
  });

  if (pool.some((t) => SECOND_WORDS.has(t))) return { end: 2, axis };
  if (pool.some((t) => FIRST_WORDS.has(t))) return { end: 1, axis };
  return null;
}

/** Propone un mapeo mirando los encabezados. Es una sugerencia editable. */
export function suggestMapping(headers: string[]): Mapping {
  const mapping: Mapping = {};
  const taken = new Set<string>();
  const tokensOf = new Map(headers.map((h) => [h, tokenize(h)]));

  // Primero las coordenadas, que son las que mas se confunden entre si.
  for (const h of headers) {
    const coord = readCoordinate(tokensOf.get(h) ?? []);
    if (!coord) continue;
    const key: FieldKey =
      coord.end === 1 ? (coord.axis === "y" ? "startY" : "startX") : coord.axis === "y" ? "endY" : "endX";
    if (mapping[key]) continue;
    mapping[key] = h;
    taken.add(h);
  }

  // Despues el resto, por palabras completas y de la mas especifica a la menos.
  for (const field of FIELDS) {
    if (!field.words || mapping[field.key]) continue;
    for (const combo of field.words) {
      const hit = headers.find((h) => {
        if (taken.has(h)) return false;
        const toks = tokensOf.get(h) ?? [];
        return combo.every((w) => toks.includes(w));
      });
      if (hit) {
        mapping[field.key] = hit;
        taken.add(hit);
        break;
      }
    }
  }

  return mapping;
}

// ---------------------------------------------------------------------------
// Sistema de coordenadas
// ---------------------------------------------------------------------------

export type Crs =
  | { type: "wgs84" }
  | { type: "utm"; zone: number; hemisphere: "N" | "S" };

/**
 * Adivina si los numeros son grados o metros UTM mirando su magnitud.
 * Es una heuristica, y como toda heuristica de este proyecto, se muestra en
 * pantalla para que la confirmes en vez de aplicarse en silencio.
 */
export function guessCrs(samples: Array<{ x: number; y: number }>): Crs {
  const usable = samples.filter((s) => Number.isFinite(s.x) && Number.isFinite(s.y));
  if (usable.length === 0) return { type: "wgs84" };
  const looksGeographic = usable.every(
    (s) => Math.abs(s.y) <= 90 && Math.abs(s.x) <= 180,
  );
  if (looksGeographic) return { type: "wgs84" };
  const meanY = usable.reduce((a, s) => a + s.y, 0) / usable.length;
  // En el hemisferio sur las coordenadas UTM llevan un falso norte de 10.000.000.
  return { type: "utm", zone: 56, hemisphere: meanY > 5_000_000 ? "S" : "N" };
}

// ---------------------------------------------------------------------------
// Construccion de las filas
// ---------------------------------------------------------------------------

export interface BuildResult {
  rows: TrackerRow[];
  skipped: Array<{ index: number; reason: string }>;
  /** Las razones de descarte agrupadas, con el rango de filas de cada una. */
  skippedSummary: Array<{
    reason: string;
    count: number;
    firstRow: number;
    lastRow: number;
    /** Que decia de verdad alguna de esas filas, para no tener que abrir el Excel. */
    sample: Array<{ row: number; cells: string }>;
  }>;
  bounds: { minLat: number; maxLat: number; minLon: number; maxLon: number } | null;
}

/**
 * Algunas planillas usan la columna de fila como una BANDERA, no como etiqueta:
 * el `MOTOR ROW` de Edenvale trae YES/NO segun si esa fila lleva el motor. Poner
 * "YES" como nombre de fila no le sirve a nadie parado en el campo.
 *
 * Solo se traduce si TODA la columna esta dentro de ese vocabulario — asi una
 * planta que de verdad numere sus filas "1" y "0" no sale trastocada.
 */
const FLAG_WORDS: Record<string, string> = {
  yes: "motorizada", si: "motorizada", "sí": "motorizada", true: "motorizada", y: "motorizada",
  no: "esclava", "false": "esclava", n: "esclava",
};

function detectRowFlagColumn(sheet: Sheet, column: string | undefined): boolean {
  if (!column) return false;
  const seen = new Set<string>();
  for (const r of sheet.rows) {
    const v = r[column];
    if (v == null || v === "") continue;
    seen.add(String(v).trim().toLowerCase());
    if (seen.size > 4) return false;
  }
  return seen.size > 0 && [...seen].every((v) => v in FLAG_WORDS);
}

const SIDE_WORDS: Record<string, TrackerRow["side"]> = {
  n: "north", norte: "north", north: "north",
  s: "south", sur: "south", south: "south",
  e: "east", este: "east", east: "east",
  o: "west", w: "west", oeste: "west", west: "west",
};

function parseSide(v: unknown): TrackerRow["side"] | undefined {
  if (v == null) return undefined;
  const key = String(v).trim().toLowerCase();
  return SIDE_WORDS[key];
}

function parseStringNumbers(v: unknown): number[] | undefined {
  if (v == null || v === "") return undefined;
  const nums = String(v)
    .split(/[,;/\-\s]+/)
    .map((p) => toNumber(p))
    .filter((n): n is number => n != null);
  return nums.length ? nums : undefined;
}

export function buildRows(sheet: Sheet, mapping: Mapping, crs: Crs): BuildResult {
  const rows: TrackerRow[] = [];
  const skipped: BuildResult["skipped"] = [];

  const get = (r: Record<string, unknown>, key: FieldKey): unknown => {
    const col = mapping[key];
    return col ? r[col] : undefined;
  };

  const toLatLon = (x: number, y: number): { lat: number; lon: number } =>
    crs.type === "utm"
      ? utmToWgs84({ easting: x, northing: y, zone: crs.zone, hemisphere: crs.hemisphere })
      : { lat: y, lon: x };

  const seen = new Map<string, number>();
  const rowIsFlag = detectRowFlagColumn(sheet, mapping.row);

  sheet.rows.forEach((raw, i) => {
    const sx = toNumber(get(raw, "startX"));
    const sy = toNumber(get(raw, "startY"));
    const ex = toNumber(get(raw, "endX"));
    const ey = toNumber(get(raw, "endY"));

    if (sx == null || sy == null || ex == null || ey == null) {
      skipped.push({ index: i + 2, reason: "faltan coordenadas de alguna de las dos picas" });
      return;
    }

    const block = String(get(raw, "block") ?? "").trim();
    const tracker = String(get(raw, "tracker") ?? "").trim();
    if (!block || !tracker) {
      skipped.push({ index: i + 2, reason: "falta bloque o tracker" });
      return;
    }

    const rowLabel = get(raw, "row");
    let rowStr = rowLabel == null || rowLabel === "" ? undefined : String(rowLabel).trim();
    if (rowStr && rowIsFlag) rowStr = FLAG_WORDS[rowStr.toLowerCase()] ?? rowStr;

    const start = toLatLon(sx, sy);
    const end = toLatLon(ex, ey);
    if (start.lat === end.lat && start.lon === end.lon) {
      skipped.push({ index: i + 2, reason: "las dos picas estan en el mismo punto" });
      return;
    }

    // Ids unicos aunque el archivo repita combinaciones.
    const baseId = [block, tracker, rowStr].filter(Boolean).join("-");
    const n = (seen.get(baseId) ?? 0) + 1;
    seen.set(baseId, n);
    const id = n === 1 ? baseId : `${baseId}#${n}`;

    const out: TrackerRow = { id, block, tracker, start, end };
    if (rowStr) out.row = rowStr;

    const side = parseSide(get(raw, "side"));
    if (side) out.side = side;

    const pos = toNumber(get(raw, "pos"));
    if (pos != null) out.pos = pos;

    const posTotal = toNumber(get(raw, "posTotal"));
    if (posTotal != null) out.posTotal = posTotal;

    const strings = parseStringNumbers(get(raw, "stringNumbers"));
    if (strings) out.stringNumbers = strings;

    rows.push(out);
  });

  let bounds: BuildResult["bounds"] = null;
  if (rows.length) {
    let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
    for (const r of rows) {
      for (const p of [r.start, r.end]) {
        minLat = Math.min(minLat, p.lat); maxLat = Math.max(maxLat, p.lat);
        minLon = Math.min(minLon, p.lon); maxLon = Math.max(maxLon, p.lon);
      }
    }
    bounds = { minLat, maxLat, minLon, maxLon };
  }

  // Agrupar los descartes: "384 salteadas" no dice nada; "384 seguidas al final
  // del archivo" es un bloque de totales, y "384 desparramadas" son datos que
  // faltan de verdad. Son dos problemas distintos.
  const byReason = new Map<string, number[]>();
  for (const s of skipped) byReason.set(s.reason, [...(byReason.get(s.reason) ?? []), s.index]);

  /** Como se ve una fila del Excel, en pocas palabras. */
  const describir = (index: number): string => {
    const raw = sheet.rows[index - 2];
    if (!raw) return "(fila vacia)";
    const partes = Object.entries(raw)
      .filter(([, v]) => v != null && v !== "")
      .slice(0, 5)
      .map(([k, v]) => `${k}: ${String(v).slice(0, 22)}`);
    return partes.length ? partes.join("  ·  ") : "(todas las celdas vacias)";
  };

  const skippedSummary = [...byReason.entries()]
    .map(([reason, idx]) => ({
      reason,
      count: idx.length,
      firstRow: Math.min(...idx),
      lastRow: Math.max(...idx),
      // La primera, una del medio y la ultima: alcanza para ver de que se trata.
      sample: [...new Set([idx[0]!, idx[Math.floor(idx.length / 2)]!, idx[idx.length - 1]!])]
        .map((row) => ({ row, cells: describir(row) })),
    }))
    .sort((a, b) => b.count - a.count);

  return { rows, skipped, skippedSummary, bounds };
}

// ---------------------------------------------------------------------------
// Deduccion de parametros
// ---------------------------------------------------------------------------

/**
 * Despeja el offset de pica a partir del largo real de las filas.
 *
 * Las tres cantidades estan atadas:  largo = modulos x paso + 2 x offset.
 * Si conoces el modulo porque lo mediste a mano, el offset sale solo — y de
 * paso te dice si el numero que venias usando era el correcto.
 */
export function suggestEndpointOffsetMm(
  rows: TrackerRow[],
  modulesPerRow: number,
  pitchMm: number,
  opts: { moduleGapMm?: number; stringsPerRow?: number; stringGapMm?: number } = {},
): { medianLengthM: number; offsetMm: number; spreadMm: number } | null {
  if (!rows.length) return null;

  // Medir con el mismo marco que usa el motor, no con radios aproximados a
  // mano. Con constantes redondeadas la diferencia daba 19 cm en una fila de
  // 65 m — la sexta parte de un modulo, justo en el numero que se esta tratando
  // de despejar.
  const first = rows[0]!;
  const frame = makeFrame(first.start.lat, first.start.lon);
  const lengths = rows.map((r) => distanceM(frame, r.start, r.end)).sort((a, b) => a - b);

  const median = lengths[Math.floor(lengths.length / 2)]!;
  const p10 = lengths[Math.floor(lengths.length * 0.1)]!;
  const p90 = lengths[Math.floor(lengths.length * 0.9)]!;

  // Lo que ocupan los modulos: los tramos de cada string mas las bahias de
  // motor que los separan. Olvidarse de las bahias fue exactamente el error
  // que hizo despejar un offset equivocado la primera vez.
  const strings = opts.stringsPerRow ?? 1;
  const moduleGapMm = opts.moduleGapMm ?? 0;
  const stringSpanMm = (modulesPerRow / strings) * pitchMm - moduleGapMm;
  const extentMm = strings * stringSpanMm + (strings - 1) * (opts.stringGapMm ?? 0);

  return {
    medianLengthM: median,
    offsetMm: (median * 1000 - extentMm) / 2,
    spreadMm: (p90 - p10) * 1000,
  };
}

// ---------------------------------------------------------------------------
// Informe de capacidad
// ---------------------------------------------------------------------------

export interface Capability {
  label: string;
  available: boolean;
  detail: string;
}

/**
 * La respuesta a "sirve para cualquier parque segun la info que tenga".
 *
 * La app nunca se niega a funcionar: da la respuesta mas precisa que los datos
 * soportan y dice explicitamente que no pudo determinar. Eso ademas es lo que
 * la IEC TS 62446-3 pide documentar bajo "limitaciones" del reporte.
 */
export function capabilityReport(rows: TrackerRow[], profile: FarmProfile): Capability[] {
  const total = rows.length || 1;
  const pct = (n: number) => `${Math.round((n / total) * 100)} %`;

  const withSide = rows.filter((r) => r.side).length;
  const withChain = rows.filter((r) => r.pos != null && r.posTotal != null).length;
  const withStrings = rows.filter((r) => r.stringNumbers?.length).length;
  const withRowLabel = rows.filter((r) => r.row).length;

  const originNeedsSide = profile.addressing.originStrategy === "dc-box-end";
  const inversionNeedsChain = profile.addressing.inversionStrategy === "piercing-chain";

  return [
    {
      label: "Bloque, tracker y posicion del modulo en la fila",
      available: rows.length > 0,
      detail:
        rows.length > 0
          ? `${rows.length} filas de trackers cargadas. Alcanza para caminar hasta el panel.`
          : "Sin geometria no hay nada que localizar.",
    },
    {
      label: "Etiqueta de fila (R1, R2…)",
      available: withRowLabel > 0,
      detail:
        withRowLabel > 0
          ? `${pct(withRowLabel)} de las filas traen etiqueta.`
          : "El archivo no trae columna de fila. El resultado va a nombrar el tracker sin la fila.",
    },
    {
      label: "Desde que punta se cuenta el modulo 1",
      available: !originNeedsSide || withSide === rows.length,
      detail: !originNeedsSide
        ? `La estrategia "${profile.addressing.originStrategy}" no necesita el lado de la calle.`
        : withSide === rows.length
          ? "Todas las filas traen el lado de la calle."
          : `Solo ${pct(withSide)} de las filas trae el lado. Sin ese dato el conteo puede salir espejado. Pedile al cliente la columna, o cambia la estrategia a "fixed-end".`,
    },
    {
      label: "Cual de los strings de la fila",
      available: !inversionNeedsChain || withChain === rows.length,
      detail: !inversionNeedsChain
        ? `La estrategia "${profile.addressing.inversionStrategy}" no necesita la posicion en la linea.`
        : withChain === rows.length
          ? "Todas las filas traen posicion y total de su linea."
          : `Solo ${pct(withChain)} trae posicion en la linea. Sin eso, el string lejano puede quedar contado al reves.`,
    },
    {
      label: "Numero real del string",
      available: withStrings > 0,
      detail:
        withStrings > 0
          ? `${pct(withStrings)} de las filas trae numeros de string.`
          : "Sin la lista de strings, la app numera 1 y 2 por posicion. Sirve igual para ubicar, pero no coincide con las etiquetas del cliente.",
    },
    {
      label: "Numero de serie del panel",
      available: false,
      detail:
        "Requiere la lista de paneles del cliente. Para inspeccion no hace falta: el objetivo es ubicar el problema, no llevar inventario.",
    },
  ];
}

// ---------------------------------------------------------------------------
// Deduccion del lado de la calle
// ---------------------------------------------------------------------------

export interface SideDerivation {
  /** Lado deducido por fila, por id. */
  sides: Map<string, "north" | "south" | "east" | "west">;
  /** Que paso en cada bloque, para poder mirarlo antes de confiar. */
  blocks: Array<{
    block: string;
    rows: number;
    status: "dos-lados" | "un-solo-lado" | "escalonado" | "ambiguo";
    detail: string;
  }>;
}

/**
 * Deduce el lado de la calle a partir de la pura geometria.
 *
 * Las cajas DC estan en la calle del medio del bloque, asi que las filas caen
 * en dos grupos separados por esa calle — y la separacion es a lo largo del eje
 * de las propias filas, no perpendicular: las del lado norte terminan en la
 * calle y las del sur arrancan ahi.
 *
 * Se verifica solo: dentro de un grupo los centros de fila difieren unos pocos
 * metros, y entre grupos difieren mas de medio largo de fila. Si un bloque no
 * se parte limpio, lo dice en vez de inventar un lado.
 */
export function deriveSides(rows: TrackerRow[]): SideDerivation {
  const sides = new Map<string, "north" | "south" | "east" | "west">();
  const blocks: SideDerivation["blocks"] = [];

  const byBlock = new Map<string, TrackerRow[]>();
  for (const r of rows) byBlock.set(r.block, [...(byBlock.get(r.block) ?? []), r]);

  for (const [block, group] of [...byBlock.entries()].sort()) {
    const first = group[0];
    if (!first || group.length < 2) {
      blocks.push({
        block, rows: group.length, status: "ambiguo",
        detail: "Muy pocas filas para deducir nada.",
      });
      continue;
    }

    const frame = makeFrame(first.start.lat, first.start.lon);
    const local = group.map((r) => {
      const a = toLocal(frame, r.start.lat, r.start.lon);
      const b = toLocal(frame, r.end.lat, r.end.lon);
      return { row: r, a, b, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
    });

    // Direccion media de las filas, con el signo normalizado para que no se
    // cancelen entre si las que vienen con las picas al reves en el Excel.
    let ux = 0;
    let uy = 0;
    for (const l of local) {
      const dx = l.b.x - l.a.x;
      const dy = l.b.y - l.a.y;
      const len = Math.hypot(dx, dy) || 1;
      const sign = dy >= 0 ? 1 : -1; // apuntar siempre hacia el norte
      ux += (dx / len) * sign;
      uy += (dy / len) * sign;
    }
    const norm = Math.hypot(ux, uy) || 1;
    ux /= norm;
    uy /= norm;

    const lengths = local.map((l) => Math.hypot(l.b.x - l.a.x, l.b.y - l.a.y));
    const medianLength = lengths.sort((p, q) => p - q)[Math.floor(lengths.length / 2)] ?? 60;

    // Proyeccion de cada centro sobre el eje de las filas.
    const proj = local
      .map((l) => ({ row: l.row, t: l.mid.x * ux + l.mid.y * uy }))
      .sort((p, q) => p.t - q.t);

    let gapAt = -1;
    let gapSize = 0;
    for (let i = 1; i < proj.length; i++) {
      const d = proj[i]!.t - proj[i - 1]!.t;
      if (d > gapSize) { gapSize = d; gapAt = i; }
    }

    const threshold = medianLength * 0.5;
    if (gapAt < 1 || gapSize < threshold) {
      blocks.push({
        block, rows: group.length, status: "un-solo-lado",
        detail:
          `Las ${group.length} filas caen todas juntas (la mayor separacion es de ` +
          `${gapSize.toFixed(0)} m, y para ser dos lados de una calle harian falta mas de ` +
          `${threshold.toFixed(0)} m). No le asigno lado.`,
      });
      continue;
    }

    const lower = proj.slice(0, gapAt);
    const upper = proj.slice(gapAt);

    /**
     * El chequeo que separa una calle de un escalon.
     *
     * Dos filas enfrentadas a los lados de una calle tienen los centros
     * separados por medio largo de cada una MAS el ancho de la calle. O sea:
     * la separacion no puede ser menor que el promedio de los dos largos, ni
     * siquiera con la calle de ancho cero.
     *
     * Si el hueco es menor, los dos grupos se solapan a lo largo del eje —
     * estan uno al costado del otro, no uno enfrente del otro— y no puede
     * haber una calle en el medio. Es un escalon en el trazado, o un segundo
     * rango del mismo lado.
     *
     * Esto no es un detalle: darle lados opuestos a dos grupos que estan del
     * mismo lado invierte el conteo de uno de ellos entero.
     */
    const largoDe = (g: typeof proj) => {
      const ls = g
        .map((p) => local.find((l) => l.row.id === p.row.id)!)
        .map((l) => Math.hypot(l.b.x - l.a.x, l.b.y - l.a.y))
        .sort((a, b) => a - b);
      return ls[Math.floor(ls.length / 2)] ?? medianLength;
    };
    const minimoParaCalle = (largoDe(lower) + largoDe(upper)) / 2;

    if (gapSize < minimoParaCalle * 0.95) {
      const solape = minimoParaCalle - gapSize;
      blocks.push({
        block, rows: group.length, status: "escalonado",
        detail:
          `Hay dos grupos de ${upper.length} y ${lower.length} filas separados por ` +
          `${gapSize.toFixed(0)} m, pero eso NO puede ser una calle: dos filas enfrentadas ` +
          `tendrian los centros a mas de ${minimoParaCalle.toFixed(0)} m aunque la calle midiera ` +
          `cero. Con ${gapSize.toFixed(0)} m los dos grupos se solapan ${solape.toFixed(0)} m a lo ` +
          `largo, asi que estan del mismo lado, corridos entre si. No les asigno lado: ` +
          `partirlos invertiria el conteo de uno de los dos grupos entero.`,
      });
      continue;
    }

    // El grupo con proyeccion mayor esta hacia donde apunta `u`, que
    // normalizamos hacia el norte.
    for (const p of lower) sides.set(p.row.id, "south");
    for (const p of upper) sides.set(p.row.id, "north");

    blocks.push({
      block, rows: group.length, status: "dos-lados",
      detail:
        `${upper.length} filas al norte y ${lower.length} al sur, separadas por ` +
        `${gapSize.toFixed(0)} m entre centros — mas que los ${minimoParaCalle.toFixed(0)} m ` +
        `que ocuparian las filas solas, asi que hay una calle en el medio.`,
    });
  }

  return { sides, blocks };
}

// ---------------------------------------------------------------------------
// Fusion de geometria
// ---------------------------------------------------------------------------

export interface MergeResult {
  rows: TrackerRow[];
  nuevas: number;
  repetidas: number;
  /**
   * Filas con el mismo identificador pero en otro lugar del mundo. Casi siempre
   * significa que los dos archivos numeran bloques distintos con el mismo
   * numero — y fusionarlas asi pisaria geometria buena en silencio.
   */
  colisiones: Array<{ id: string; distanciaM: number }>;
}

/** A partir de aca, dos filas con el mismo id no pueden ser la misma fila. */
const DISTANCIA_SOSPECHOSA_M = 50;

/**
 * Suma geometria nueva a la que un parque ya tiene.
 *
 * En una planta grande los datos llegan de a pedazos: un Excel por transformador,
 * o por etapa de obra. Cargar el segundo no puede significar ni perder el primero
 * ni terminar con dos parques a medias.
 *
 * Una fila que ya existia se actualiza con la version nueva en vez de duplicarse,
 * asi que volver a cargar el mismo archivo no cambia nada — que es justo lo que
 * uno espera cuando no se acuerda si ya lo habia cargado.
 */
export function mergeRows(previas: TrackerRow[], entrantes: TrackerRow[]): MergeResult {
  const entrantesPorId = new Set(entrantes.map((r) => r.id));
  const previaPorId = new Map(previas.map((r) => [r.id, r]));

  const colisiones: MergeResult["colisiones"] = [];
  if (previas.length && entrantes.length) {
    const frame = makeFrame(previas[0]!.start.lat, previas[0]!.start.lon);
    for (const nueva of entrantes) {
      const vieja = previaPorId.get(nueva.id);
      if (!vieja) continue;
      const d = distanceM(frame, vieja.start, nueva.start);
      if (d > DISTANCIA_SOSPECHOSA_M) colisiones.push({ id: nueva.id, distanciaM: d });
    }
  }

  return {
    rows: [
      ...previas.filter((r) => !entrantesPorId.has(r.id)),
      ...entrantes.map((nueva) => conservarLoAplicado(previaPorId.get(nueva.id), nueva)),
    ],
    nuevas: entrantes.filter((r) => !previaPorId.has(r.id)).length,
    repetidas: entrantes.filter((r) => previaPorId.has(r.id)).length,
    colisiones,
  };
}

/**
 * Al reemplazar una fila, no tirar lo que se le habia aplicado aparte.
 *
 * Un Excel de picas trae GEOMETRIA y nada mas: dos coordenadas, el bloque, el
 * tracker. Todo lo demas —el numero de string, la etiqueta del cliente, la
 * posicion del tracker en su linea electrica, el lado de la calle deducido—
 * entro por otro lado y despues de bastante trabajo.
 *
 * Sin esto, volver a cargar el mismo Excel para corregir un parametro borraba
 * los 13.480 strings de Edenvale en silencio, y el unico sintoma habria sido
 * que la app deja de dar el numero de string un tiempo despues. Se pierde algo
 * que costo una sesion entera y no hay como recuperarlo salvo rehacerlo.
 *
 * La regla: la geometria la manda el archivo nuevo; lo aplicado aparte
 * sobrevive salvo que el archivo traiga ese mismo dato.
 */
function conservarLoAplicado(previa: TrackerRow | undefined, nueva: TrackerRow): TrackerRow {
  if (!previa) return nueva;
  const out: TrackerRow = { ...nueva };
  if (!out.stringNumbers?.length && previa.stringNumbers?.length) out.stringNumbers = previa.stringNumbers;
  if (!out.stringLabels?.length && previa.stringLabels?.length) out.stringLabels = previa.stringLabels;
  if (out.pos == null && previa.pos != null) out.pos = previa.pos;
  if (out.posTotal == null && previa.posTotal != null) out.posTotal = previa.posTotal;
  if (!out.side && previa.side) out.side = previa.side;
  if (!out.originEnd && previa.originEnd) out.originEnd = previa.originEnd;
  if (!out.stringInverted && previa.stringInverted) out.stringInverted = previa.stringInverted;
  if (out.pitchMmOverride == null && previa.pitchMmOverride != null) {
    out.pitchMmOverride = previa.pitchMmOverride;
  }
  return out;
}
