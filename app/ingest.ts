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

import { utmToWgs84 } from "@locator";
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
export async function readWorkbook(buf: ArrayBuffer): Promise<Sheet[]> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(buf, { cellDates: false });

  const sheets: Sheet[] = [];
  // Recorre TODAS las hojas. En Edenvale, mirar solo la primera fue un bug real:
  // la hoja con los datos no siempre es la primera del archivo.
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws) continue;
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
      defval: null,
      raw: true,
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
  patterns: RegExp[];
}

export const FIELDS: FieldSpec[] = [
  {
    key: "block",
    label: "Bloque",
    help: "Identificador del bloque o sector.",
    required: true,
    patterns: [/^bloque$/i, /^block$/i, /\bbloque\b/i, /\bblock\b/i, /^bl$/i],
  },
  {
    key: "tracker",
    label: "Tracker",
    help: "Numero o codigo del tracker.",
    required: true,
    patterns: [/^tracker$/i, /\btracker\b/i, /seguidor/i, /\btrk\b/i, /^mesa$/i],
  },
  {
    key: "row",
    label: "Fila (R1, R2…)",
    help: "Fila de modulos dentro del tracker, si el parque las distingue.",
    required: false,
    patterns: [/motor.*row/i, /^row$/i, /^fila$/i, /\brow\b/i],
  },
  {
    key: "startY",
    label: "Pica 1 · latitud / Norte",
    help: "Coordenada de una punta del tracker.",
    required: true,
    patterns: [/pica.?1.*(lat|norte|north|y|n)\b/i, /(lat|norte|north)\D*1\b/i, /^lat1$/i, /^y1$/i, /^norte1$/i, /^north1$/i, /^n1$/i],
  },
  {
    key: "startX",
    label: "Pica 1 · longitud / Este",
    help: "La otra coordenada de esa misma punta.",
    required: true,
    patterns: [/pica.?1.*(lon|lng|este|east|x|e)\b/i, /(lon|lng|este|east)\D*1\b/i, /^lon1$/i, /^lng1$/i, /^x1$/i, /^este1$/i, /^east1$/i, /^e1$/i],
  },
  {
    key: "endY",
    label: "Pica 2 · latitud / Norte",
    help: "Coordenada de la punta opuesta.",
    required: true,
    patterns: [/pica.?2.*(lat|sur|south|y|n)\b/i, /(lat|norte|north)\D*2\b/i, /^lat2$/i, /^y2$/i, /^norte2$/i, /^north2$/i, /^n2$/i],
  },
  {
    key: "endX",
    label: "Pica 2 · longitud / Este",
    help: "La otra coordenada de la punta opuesta.",
    required: true,
    patterns: [/pica.?2.*(lon|lng|este|east|x|e)\b/i, /(lon|lng|este|east)\D*2\b/i, /^lon2$/i, /^lng2$/i, /^x2$/i, /^este2$/i, /^east2$/i, /^e2$/i],
  },
  {
    key: "side",
    label: "Lado de la calle",
    help: "Norte / sur / este / oeste. Lo necesita la estrategia de conteo desde la caja DC.",
    required: false,
    patterns: [/^side$/i, /^lado$/i, /\bside\b/i],
  },
  {
    key: "pos",
    label: "Posicion en la linea",
    help: "Que numero de tracker es dentro de su linea electrica. Lo necesita la regla del piercing connector.",
    required: false,
    patterns: [/^pos$/i, /posicion/i, /position/i, /\border\b/i],
  },
  {
    key: "posTotal",
    label: "Trackers en la linea",
    help: "Cuantos trackers tiene esa linea en total.",
    required: false,
    patterns: [/pos.?total/i, /total.*tracker/i, /\bde\b.*total/i],
  },
  {
    key: "stringNumbers",
    label: "Numeros de string",
    help: "Los strings de esta fila, separados por coma o guion. Ej: 5,6",
    required: false,
    patterns: [/string/i, /\bcadena\b/i],
  },
];

export type Mapping = Partial<Record<FieldKey, string>>;

/** Propone un mapeo mirando los encabezados. Es una sugerencia editable. */
export function suggestMapping(headers: string[]): Mapping {
  const mapping: Mapping = {};
  const taken = new Set<string>();
  for (const field of FIELDS) {
    for (const pattern of field.patterns) {
      const hit = headers.find((h) => !taken.has(h) && pattern.test(String(h).trim()));
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
  bounds: { minLat: number; maxLat: number; minLon: number; maxLon: number } | null;
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
    const rowStr = rowLabel == null || rowLabel === "" ? undefined : String(rowLabel).trim();

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

  return { rows, skipped, bounds };
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
