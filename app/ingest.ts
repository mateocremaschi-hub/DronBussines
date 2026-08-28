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
 * Un CSV en UTF-8 sin BOM, decodificado como corresponde.
 *
 * La libreria de Excel, cuando le pasas bytes de un archivo de texto sin BOM,
 * asume la codificacion vieja de Windows. Un CSV exportado en UTF-8 —que es lo
 * que sale de QGIS, de un script de Python o de cualquier cosa que no sea Excel
 * en Windows— entra con los acentos rotos: "Ubicación" se lee "UbicaciÃ³n".
 *
 * Eso no rompe nada visiblemente. Lo que rompe es el reconocimiento automatico
 * de columnas: "Fila", "Posición", "Este inicial" dejan de parecerse a lo que
 * la app busca, y el operador tiene que asignar cuarenta columnas a mano — o
 * peor, elige mal una y no se entera.
 *
 * Devuelve el texto si el archivo ES texto y ES UTF-8 valido. Si no, `null` y
 * se sigue por el camino de siempre: un binario de Excel, o un CSV en la
 * codificacion vieja, que ese camino maneja bien.
 */
function entradaDeTexto(buf: ArrayBuffer): string | null {
  const b = new Uint8Array(buf);
  // Binarios de Excel: xlsx/xlsm son ZIP ("PK"), xls es un compuesto OLE.
  if (b[0] === 0x50 && b[1] === 0x4b) return null;
  if (b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0) return null;
  // Con BOM ya lo resuelve la libreria sola.
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return null;
  try {
    const texto = new TextDecoder("utf-8", { fatal: true }).decode(b);
    // Un texto ASCII puro se decodifica igual por los dos caminos; solo vale la
    // pena desviarlo si de verdad trae algo fuera de ASCII.
    return /[^\x00-\x7f]/.test(texto) ? texto : null;
  } catch {
    return null; // No es UTF-8: que lo lea con la codificacion vieja.
  }
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
  const texto = entradaDeTexto(buf);
  const wb = texto != null
    ? XLSX.read(texto, { cellDates: false, raw: true, type: "string" })
    : XLSX.read(buf, { cellDates: false, raw: true });

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
  const comas = (s.match(/,/g) ?? []).length;
  const puntos = (s.match(/\./g) ?? []).length;

  if (comas && puntos) {
    // Los dos separadores presentes: el decimal es el que esta mas a la derecha.
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
  } else if (comas > 1) {
    s = s.replace(/,/g, "");            // 1,234,567
  } else if (puntos > 1) {
    s = s.replace(/\./g, "");           // 1.234.567 — miles a la europea
  } else if (comas === 1) {
    /**
     * Una sola coma: DECIMAL.
     *
     * Antes se trataba como separador de miles cuando dejaba exactamente tres
     * digitos a la derecha, y eso multiplicaba por mil una coordenada al
     * milimetro escrita a la europea: "512345,678" entraba como 512.345.678.
     * Es la convencion estandar en Espana, Argentina, Italia, Francia y
     * Alemania — la mitad de los parques del mundo— y el error no se veia: con
     * los valores x1000 la deteccion de sistema de coordenadas los tomaba por
     * UTM y las filas se construian sin una sola queja.
     *
     * Un separador de miles de verdad casi nunca viene solo. "1.234.567" y
     * "1,234,567" traen varios y caen en las ramas de arriba; una coma sola en
     * una columna de coordenadas es decimal.
     */
    s = s.replace(",", ".");
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

/*
  Que punta del tracker nombra el encabezado.

  Las dos listas tienen que ser SIMETRICAS. No lo eran: "final" estaba y
  "inicial" no, asi que en una planilla con "ESTE INICIAL / ESTE FINAL / NORTE
  INICIAL / NORTE FINAL" —que es como las escribe medio mundo— se reconocian
  dos columnas de cuatro. Y eso es peor que no reconocer ninguna: el asistente
  muestra la mitad asignada, parece que anduvo, y las dos que faltan se pasan
  por alto hasta que el parque sale con todas las filas de largo cero.
*/
const FIRST_WORDS = new Set([
  "1", "a", "inicio", "inicial", "ini", "comienzo", "principio", "arranque", "origen",
  "start", "inicial1", "desde", "from", "norte", "north",
]);
const SECOND_WORDS = new Set([
  "2", "b", "fin", "final", "termino", "cierre", "llegada", "destino",
  "end", "hasta", "to", "sur", "south",
]);

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

  /*
    Despues el resto, de la regla MAS especifica a la menos — no campo por campo.

    Antes se recorrian los campos en orden y cada uno se quedaba con el primer
    encabezado que le encajara. `pos` va antes que `posTotal` en la lista, su
    regla es ["pos"], y una columna "POS TOTAL" tiene el token "pos": se la
    llevaba `pos`, y "Trackers en la linea" quedaba sin asignar. Justo el dato
    que decide si una fila es la ultima de su linea electrica, o sea el que
    decide de que punta se cuenta — silenciosamente ausente.

    Ordenando por cantidad de palabras de la regla, ["pos","total"] reclama
    "POS TOTAL" antes de que ["pos"] llegue a mirarla. Y a igualdad de regla se
    prefiere el encabezado con menos palabras de sobra, asi "POS" le gana a
    "POS TOTAL" para el campo `pos`.
  */
  const reglas = FIELDS.flatMap((field) =>
    (field.words ?? []).map((combo, orden) => ({ field, combo, orden })),
  ).sort((a, b) => b.combo.length - a.combo.length || a.orden - b.orden);

  for (const { field, combo } of reglas) {
    if (mapping[field.key]) continue;
    let mejor: string | null = null;
    let sobra = Infinity;
    for (const h of headers) {
      if (taken.has(h)) continue;
      const toks = tokensOf.get(h) ?? [];
      if (!combo.every((w) => toks.includes(w))) continue;
      const extra = toks.length - combo.length;
      if (extra < sobra) { sobra = extra; mejor = h; }
    }
    if (mejor) {
      mapping[field.key] = mejor;
      taken.add(mejor);
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

export interface CrsDetectado {
  crs: Crs;
  /**
   * `true` cuando los numeros solo pueden ser una cosa. Con UTM nunca lo es:
   * la zona no esta en el archivo y el hemisferio tampoco.
   */
  seguro: boolean;
  /** Lo que hay que confirmar a mano antes de seguir. */
  aConfirmar: string[];
}

/**
 * Que sistema de coordenadas trae el archivo.
 *
 * Distinguir grados de metros UTM es facil y sale de la magnitud. Lo que NO se
 * puede sacar de los numeros es la ZONA ni el HEMISFERIO, y eso hay que decirlo
 * en vez de rellenarlo:
 *
 *   - La zona no viaja en la coordenada. Un easting de 470.341 existe en las 60
 *     zonas. Aca habia un 56 fijo —el de Edenvale— y cualquier otro parque
 *     entraba corrido miles de kilometros SIN UN SOLO SINTOMA: las filas siguen
 *     midiendo 65 m, el dibujo sale bien, el cuadre cierra. El unico sintoma
 *     aparece parado en el campo, cuando el GPS dice que el parque esta del
 *     otro lado del mundo. Es exactamente el dia de viaje perdido.
 *
 *   - El hemisferio tampoco. Un northing de 5.098.424 es lat 46,0 N o lat
 *     -44,2 S, las dos validas. La regla vieja —"mas de 5.000.000 es sur"— es
 *     el ecuador dicho al reves y se rompe en todo lo que este arriba de los
 *     45 grados norte: Francia, Alemania, el Reino Unido, Canada, medio
 *     Estados Unidos.
 *
 * Asi que con UTM se propone lo mas probable y se marca como sin confirmar. La
 * pantalla muestra donde cae el parque con ese ajuste, que es la unica
 * verificacion que no se puede fingir: o el punto cae en el parque, o no.
 */
export function detectarCrs(samples: Array<{ x: number; y: number }>): CrsDetectado {
  const usable = samples.filter((s) => Number.isFinite(s.x) && Number.isFinite(s.y));
  if (usable.length === 0) {
    return { crs: { type: "wgs84" }, seguro: false, aConfirmar: ["No hay ninguna coordenada para mirar."] };
  }

  const geografico = usable.every((s) => Math.abs(s.y) <= 90 && Math.abs(s.x) <= 180);
  if (geografico) return { crs: { type: "wgs84" }, seguro: true, aConfirmar: [] };

  const meanY = usable.reduce((a, s) => a + s.y, 0) / usable.length;
  return {
    crs: { type: "utm", zone: 0, hemisphere: meanY > 5_000_000 ? "S" : "N" },
    seguro: false,
    aConfirmar: [
      "La zona UTM no viene en el archivo: el mismo par de numeros existe en las 60 zonas. " +
      "Escribila y fijate que el parque caiga donde tiene que caer.",
      "El hemisferio tampoco: un northing de 5.098.424 es lat 46 norte o lat 44 sur, las dos " +
      "validas. La propuesta sale de suponer que arriba de 5.000.000 es sur, que falla en todo " +
      "lo que este por encima de los 45 grados norte.",
    ],
  };
}

/** Compatibilidad: la version vieja, que devolvia solo el sistema. */
export function guessCrs(samples: Array<{ x: number; y: number }>): Crs {
  return detectarCrs(samples).crs;
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
  /**
   * Lo que no cierra de las coordenadas ya convertidas.
   *
   * Nada de esto impide seguir, y por eso existe: son los casos donde el
   * archivo entra sin una sola queja y el error recien aparece parado en el
   * campo, a un viaje de distancia.
   */
  sospechas: string[];
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

/**
 * Que valores distintos trae una columna, para poder mostrarlos.
 *
 * La traduccion de la bandera de fila se hacia EN SILENCIO. La app terminaba
 * diciendo "motorizada, esclava" en pantalla sobre un parque donde nadie habia
 * escrito esas palabras, y no habia forma de saber de donde salieron: ni el
 * nombre de la columna, ni los valores originales, ni cuantas filas cayeron de
 * cada lado. Una conclusion que el usuario no puede rastrear es una conclusion
 * en la que no puede confiar.
 */
function valoresDe(sheet: Sheet, column: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of sheet.rows) {
    const v = r[column];
    if (v == null || v === "") continue;
    const k = String(v).trim();
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
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

  /**
   * Sin zona no se puede convertir, y eso no es un error: es un paso que falta.
   *
   * La zona empieza en cero justamente para que nadie la herede de otro parque,
   * asi que este caso se da siempre al cargar un archivo UTM. Reventar aca
   * dejaba la pantalla de alta en blanco; lo correcto es no construir ninguna
   * fila y decir que falta la zona.
   */
  const zonaValida = crs.type !== "utm" || (crs.zone >= 1 && crs.zone <= 60);

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

    if (!zonaValida) {
      skipped.push({ index: i + 2, reason: "falta elegir la zona UTM" });
      return;
    }

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

  /**
   * Que las coordenadas sean coordenadas.
   *
   * Antes no habia ningun chequeo: una latitud de 152 —lat y lon dados vuelta,
   * el error mas comun que existe— construia las filas igual. Y no se notaba
   * porque los largos siguen dando 65 m: el marco local se arma sobre el propio
   * punto, asi que un parque puesto en cualquier lado del planeta conserva sus
   * distancias internas. El cuadre cierra, el dibujo sale bien, el aviso de
   * largo no salta. Todo perfecto, y el parque en otro continente.
   */
  const sospechas: string[] = [];

  /*
    Si la columna de fila era una bandera si/no, DECIRLO.

    De aca sale que un parque "tenga filas motorizadas y esclavas", que es una
    afirmacion fuerte sobre el racking. No la dedujo nadie: estaba en el archivo,
    en esa columna. Pero si no se nombra la columna ni se muestran los valores,
    el que la carga no tiene como saber si la app leyo lo que el cree.
  */
  if (rowIsFlag && mapping.row) {
    const vals = valoresDe(sheet, mapping.row);
    const detalle = [...vals.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([v, n]) => `${n} filas con "${v}" → ${FLAG_WORDS[v.toLowerCase()]}`)
      .join(", ");
    sospechas.push(
      `La columna "${mapping.row}" no trae nombres de fila sino una bandera si/no, asi que la lei ` +
      `como "esta fila lleva el motor": ${detalle}. Si esa columna significa otra cosa, asignala a ` +
      `"sin asignar" — porque de aca sale cual de las dos filas de cada tracker es la motorizada.`,
    );
  }
  if (bounds) {
    const { minLat, maxLat, minLon, maxLon } = bounds;
    const fuera = rows.filter(
      (r) => [r.start, r.end].some((p) => Math.abs(p.lat) > 90 || Math.abs(p.lon) > 180),
    ).length;
    if (fuera) {
      sospechas.push(
        `${fuera} filas quedaron con una coordenada imposible (latitud fuera de ±90 o longitud ` +
        "fuera de ±180). Casi siempre es el sistema de coordenadas mal elegido, o las columnas " +
        "de latitud y longitud cambiadas entre si.",
      );
    } else if (Math.abs(minLat) <= 90 && Math.abs(maxLon) <= 90 && Math.abs(minLat) > 1) {
      // Con |lat| y |lon| los dos <= 90 —Europa, Chile, casi toda Africa— dar
      // vuelta las columnas produce un punto perfectamente valido en otro
      // continente, y nada mas lo puede detectar.
      sospechas.push(
        "Con estos valores, latitud y longitud dadas vuelta darian un punto igual de valido en " +
        "otro lado del mundo, y nada dentro de la app lo podria distinguir. Mirá abajo dónde cae " +
        "el parque antes de seguir.",
      );
    }

    const anchoKm = (maxLon - minLon) * 111 * Math.cos((minLat * Math.PI) / 180);
    const altoKm = (maxLat - minLat) * 111;
    if (anchoKm > 60 || altoKm > 60) {
      sospechas.push(
        `Las filas se extienden ${Math.round(Math.max(anchoKm, altoKm))} km. Un parque no mide ` +
        "eso: o hay filas de otro proyecto mezcladas, o alguna coordenada esta mal convertida.",
      );
    }
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

  return { rows, skipped, skippedSummary, bounds, sospechas };
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
  opts: {
    moduleGapMm?: number; stringsPerRow?: number; stringGapMm?: number;
    /** Los huecos grandes uno por uno. Si vienen, mandan sobre stringGapMm. */
    gaps?: Array<{ afterModule: number; mm: number }>;
  } = {},
): { medianLengthM: number; offsetMm: number; spreadMm: number; extentMm: number } | null {
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

  // Lo que ocupan los modulos: los paneles, los huequitos que quedan entre
  // ellos, y los huecos grandes. Olvidarse de los huecos grandes fue
  // exactamente el error que hizo despejar un offset equivocado la primera vez.
  const strings = opts.stringsPerRow ?? 1;
  const moduleGapMm = opts.moduleGapMm ?? 0;
  const anchoMm = pitchMm - moduleGapMm;
  const grandes = opts.gaps?.length
    ? opts.gaps.map((g) => g.mm)
    : Array.from({ length: Math.max(0, strings - 1) }, () => opts.stringGapMm ?? 0);
  // Cada hueco grande reemplaza a un huequito entre modulos, no se le suma.
  const huequitos = Math.max(0, modulesPerRow - 1 - grandes.length);
  const extentMm =
    modulesPerRow * anchoMm + huequitos * moduleGapMm + grandes.reduce((s2, g) => s2 + g, 0);

  return {
    medianLengthM: median,
    offsetMm: (median * 1000 - extentMm) / 2,
    spreadMm: (p90 - p10) * 1000,
    // Se devuelve para poder MOSTRAR la cuenta y no solo el resultado. El
    // cartel decia "con 56 modulos de 1155 mm eso deja -25 mm", y esa cuenta no
    // da -25: le faltaban la bahia y el hueco que el ultimo modulo no tiene.
    // El numero estaba bien y la explicacion no, que es la peor combinacion —
    // el que la revisa a mano concluye que el numero esta mal.
    extentMm,
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
    status: "dos-lados" | "un-solo-lado" | "escalonado" | "varias-calles" | "ambiguo";
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
/**
 * Los dos grupos de filas que separa la calle del medio de un bloque.
 *
 * Se usa para dos cosas distintas —deducir el lado y deducir desde que punta se
 * cuenta— y por eso vive aparte. Antes estaba adentro de `deriveSides`, y tener
 * la geometria escondida ahi fue justamente lo que hizo pasar el sentido del
 * conteo por una etiqueta cardinal en vez de sacarlo directo del terreno.
 */
export interface GruposDeCalle {
  status: "ok" | "un-solo-lado" | "escalonado" | "varias-calles" | "ambiguo";
  detail: string;
  /** Direccion media de las filas, normalizada hacia el norte (o hacia el este si corren E-O). */
  u?: { x: number; y: number };
  /**
   * Hacia donde apunta `u`, y por lo tanto como se llaman los dos grupos.
   *
   * Con filas norte-sur los dos lados de la calle son norte y sur. Con filas
   * que corren este-oeste son este y oeste, y llamarlos norte y sur es
   * directamente falso: la estrategia `dc-box-end` busca "el extremo que apunta
   * al norte" de una fila que no tiene extremo norte, y elige por ruido.
   */
  eje?: "norte-sur" | "este-oeste";
  frame?: ReturnType<typeof makeFrame>;
  /** Proyeccion sobre el eje: el grupo de proyeccion menor y el mayor. */
  lower?: TrackerRow[];
  upper?: TrackerRow[];
  /** Donde cae la calle sobre ese eje. */
  corte?: number;
}

export function agruparPorCalle(group: TrackerRow[]): GruposDeCalle {
  const first = group[0];
  if (!first || group.length < 2) {
    return { status: "ambiguo", detail: "Muy pocas filas para deducir nada." };
  }

  const frame = makeFrame(first.start.lat, first.start.lon);
  const local = group.map((r) => {
    const a = toLocal(frame, r.start.lat, r.start.lon);
    const b = toLocal(frame, r.end.lat, r.end.lon);
    return { row: r, a, b, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
  });

  /*
    Direccion media de las filas, con el signo normalizado para que no se
    cancelen entre si las que vienen con las picas al reves en el Excel.

    El signo se normalizaba SIEMPRE por la componente norte-sur. En un parque
    con las filas corriendo este-oeste esa componente es casi cero, asi que el
    signo de cada fila lo decidian milimetros de ruido del relevamiento: unas
    filas apuntaban a un lado y otras al opuesto, se cancelaban entre si, y el
    eje medio salia de cualquier lado. Sin un solo aviso.

    Primero se mira hacia donde corren las filas y recien despues se elige por
    que componente normalizar.
  */
  let ejeX = 0;
  let ejeY = 0;
  for (const l of local) {
    ejeX += Math.abs(l.b.x - l.a.x);
    ejeY += Math.abs(l.b.y - l.a.y);
  }
  const esteOeste = ejeX > ejeY;

  let ux = 0;
  let uy = 0;
  for (const l of local) {
    const dx = l.b.x - l.a.x;
    const dy = l.b.y - l.a.y;
    const len = Math.hypot(dx, dy) || 1;
    // Hacia el norte si las filas corren norte-sur; hacia el este si corren E-O.
    const sign = (esteOeste ? dx : dy) >= 0 ? 1 : -1;
    ux += (dx / len) * sign;
    uy += (dy / len) * sign;
  }
  const norm = Math.hypot(ux, uy) || 1;
  ux /= norm;
  uy /= norm;

  const lengths = local.map((l) => Math.hypot(l.b.x - l.a.x, l.b.y - l.a.y));
  const medianLength = lengths.sort((p, q) => p - q)[Math.floor(lengths.length / 2)] ?? 60;

  const proj = local
    .map((l) => ({ row: l.row, t: l.mid.x * ux + l.mid.y * uy }))
    .sort((p, q) => p.t - q.t);

  let gapAt = -1;
  let gapSize = 0;
  // Todos los cortes que dan la talla, no solo el mayor. Ver abajo por que
  // quedarse con el mayor era peor que no contestar.
  const cortes: Array<{ at: number; size: number }> = [];
  const threshold = medianLength * 0.5;
  for (let i = 1; i < proj.length; i++) {
    const d = proj[i]!.t - proj[i - 1]!.t;
    if (d > gapSize) { gapSize = d; gapAt = i; }
    if (d >= threshold) cortes.push({ at: i, size: d });
  }

  if (gapAt < 1 || gapSize < threshold) {
    return {
      status: "un-solo-lado",
      detail:
        `Las ${group.length} filas caen todas juntas (la mayor separacion es de ` +
        `${gapSize.toFixed(0)} m, y para ser dos lados de una calle harian falta mas de ` +
        `${threshold.toFixed(0)} m).`,
    };
  }

  /*
    Mas de una calle: el bloque tiene tres bancos o mas.

    Esto es lo mas peligroso que hacia esta funcion. Se quedaba con el corte
    MAS GRANDE y devolvia "ok" — con dos grupos armados por una diferencia de
    centimetros entre calles practicamente iguales. Un bloque de cuatro bancos
    quedaba partido dos y dos, y despues el sentido de conteo se decidia por
    "que punta cae mas cerca del corte", que para los dos bancos de las orillas
    da la punta equivocada. La mitad del bloque contando al reves, sin un solo
    aviso y con el cartel en verde.

    Con varias calles la geometria sola NO alcanza: hay que saber en cual de
    ellas estan las cajas, y eso no esta en un archivo de coordenadas. Lo
    correcto es decirlo y esperar el plano.
  */
  if (cortes.length > 1) {
    const anchos = cortes.map((c) => c.size).sort((a, b) => b - a);
    return {
      status: "varias-calles",
      detail:
        `El bloque tiene ${cortes.length + 1} bancos de filas separados por ${cortes.length} calles ` +
        `(de ${anchos.map((a) => a.toFixed(0)).join(", ")} m entre centros). Con una sola calle se ` +
        `sabe que punta da a las cajas; con ${cortes.length} no, porque no hay nada en las ` +
        `coordenadas que diga en cual de ellas estan.`,
    };
  }

  const lower = proj.slice(0, gapAt);
  const upper = proj.slice(gapAt);

  /**
   * El chequeo que separa una calle de un escalon.
   *
   * Dos filas enfrentadas a los lados de una calle tienen los centros separados
   * por medio largo de cada una MAS el ancho de la calle. O sea: la separacion
   * no puede ser menor que el promedio de los dos largos, ni siquiera con la
   * calle de ancho cero.
   *
   * Si el hueco es menor, los dos grupos se solapan a lo largo del eje — estan
   * uno al costado del otro, no uno enfrente del otro. Es un escalon en el
   * trazado, o un segundo rango del mismo lado. Partirlos invertiria el conteo
   * de uno de los dos grupos entero.
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
    return {
      status: "escalonado",
      detail:
        `Hay dos grupos de ${upper.length} y ${lower.length} filas separados por ` +
        `${gapSize.toFixed(0)} m, pero eso NO puede ser una calle: dos filas enfrentadas ` +
        `tendrian los centros a mas de ${minimoParaCalle.toFixed(0)} m aunque la calle midiera ` +
        `cero. Con ${gapSize.toFixed(0)} m los dos grupos se solapan ${solape.toFixed(0)} m a lo ` +
        `largo, asi que estan del mismo lado, corridos entre si.`,
    };
  }

  return {
    status: "ok",
    detail:
      `Dos grupos de ${lower.length} y ${upper.length} filas separados por ${gapSize.toFixed(0)} m.`,
    u: { x: ux, y: uy },
    eje: esteOeste ? "este-oeste" : "norte-sur",
    frame,
    lower: lower.map((p) => p.row),
    upper: upper.map((p) => p.row),
    // La calle cae en el medio del hueco entre los dos grupos.
    corte: (proj[gapAt - 1]!.t + proj[gapAt]!.t) / 2,
  };
}

export function deriveSides(rows: TrackerRow[]): SideDerivation {
  const sides = new Map<string, "north" | "south" | "east" | "west">();
  const blocks: SideDerivation["blocks"] = [];

  const byBlock = new Map<string, TrackerRow[]>();
  for (const r of rows) byBlock.set(r.block, [...(byBlock.get(r.block) ?? []), r]);

  for (const [block, group] of [...byBlock.entries()].sort()) {
    const g = agruparPorCalle(group);
    if (g.status !== "ok") {
      // El agrupador describe lo que ve; la consecuencia la pone quien lo usa.
      // Para el lado, no poder separar los dos grupos significa no asignarlo —
      // y decirlo importa: partir mal dos grupos invierte el conteo de uno
      // entero, que es peor que dejarlo sin lado.
      const consecuencia =
        g.status === "escalonado"
          ? " No les asigno lado: partirlos invertiria el conteo de uno de los dos grupos entero."
          : g.status === "varias-calles"
            ? " No les asigno lado: con mas de dos bancos, \"norte y sur\" no nombra nada."
            : " No le asigno lado.";
      blocks.push({ block, rows: group.length, status: g.status, detail: g.detail + consecuencia });
      continue;
    }
    const lower = g.lower!.map((row) => ({ row }));
    const upper = g.upper!.map((row) => ({ row }));

    /*
      El grupo con proyeccion mayor esta hacia donde apunta `u`.

      Los dos lados se llamaban norte y sur SIEMPRE, aunque las filas corrieran
      este-oeste. Con filas E-O eso es una etiqueta falsa, y la estrategia
      `dc-box-end` la usa en serio: busca "el extremo que apunta al norte" de
      una fila cuyos dos extremos estan a la misma latitud, y lo elige por
      ruido. Ahora los lados se llaman como el eje que de verdad los separa.
    */
    const [menor, mayor] = g.eje === "este-oeste"
      ? (["west", "east"] as const)
      : (["south", "north"] as const);
    for (const p of lower) sides.set(p.row.id, menor);
    for (const p of upper) sides.set(p.row.id, mayor);

    const nombre = { north: "al norte", south: "al sur", east: "al este", west: "al oeste" };
    blocks.push({
      block, rows: group.length, status: "dos-lados",
      detail:
        `${upper.length} filas ${nombre[mayor]} y ${lower.length} ${nombre[menor]}. ` +
        (g.eje === "este-oeste" ? "Las filas de este bloque corren este-oeste. " : "") +
        g.detail,
    });
  }

  return { sides, blocks };
}

/**
 * De que punta se cuenta cada fila, sacado del terreno y no de una etiqueta.
 *
 * Esta funcion existe porque el diseño anterior estaba mal, y vale la pena
 * dejar escrito por que.
 *
 * Antes el sentido del conteo salia de una cadena de tres pasos: se le ponia
 * al tracker una etiqueta cardinal (`side: "north"`), despues se la invertia
 * (`opposite[side]`), y despues se buscaba el extremo que apuntaba hacia ahi.
 * Tres lugares donde se puede dar vuelta un signo, para expresar algo que es
 * directo: cual de las dos puntas de esta fila da a la calle donde estan las
 * cajas de continua.
 *
 * Eso no hay que declararlo ni deducirlo de un nombre. Se mide: se proyectan
 * las dos puntas sobre el eje de las filas y gana la que cae mas cerca del
 * corte entre los dos grupos. Es geometria pura, sale igual en los 36 bloques,
 * y no hay ninguna moneda al aire.
 *
 * Lo unico que queda por declarar es una cosa por PARQUE, no por bloque: si las
 * cajas estan en la calle del medio o en el borde de afuera. Un solo bit, que
 * un conteo de campo confirma para todo el parque de una vez.
 */
export interface OriginDerivation {
  origins: Map<string, "start" | "end">;
  blocks: Array<{
    block: string;
    rows: number;
    status: "ok" | "un-solo-lado" | "escalonado" | "varias-calles" | "ambiguo";
    detail: string;
  }>;
}

export function deriveOriginEnds(
  rows: TrackerRow[],
  dcBoxPlacement: "center-road" | "outer-edge" = "center-road",
): OriginDerivation {
  const origins = new Map<string, "start" | "end">();
  const blocks: OriginDerivation["blocks"] = [];

  const byBlock = new Map<string, TrackerRow[]>();
  for (const r of rows) byBlock.set(r.block, [...(byBlock.get(r.block) ?? []), r]);

  for (const [block, group] of [...byBlock.entries()].sort()) {
    const g = agruparPorCalle(group);
    if (g.status !== "ok") {
      blocks.push({
        block, rows: group.length, status: g.status,
        detail:
          g.detail +
          " Sin la calle no se puede saber que punta da a las cajas, asi que estas filas quedan " +
          "con el sentido sin resolver.",
      });
      continue;
    }

    const { u, frame, corte } = g;
    let asignadas = 0;
    for (const r of group) {
      const a = toLocal(frame!, r.start.lat, r.start.lon);
      const b = toLocal(frame!, r.end.lat, r.end.lon);
      const ta = a.x * u!.x + a.y * u!.y;
      const tb = b.x * u!.x + b.y * u!.y;

      // La punta que da a la calle es la que cae mas cerca del corte.
      const haciaLaCalle: "start" | "end" =
        Math.abs(ta - corte!) <= Math.abs(tb - corte!) ? "start" : "end";

      // Con las cajas en el borde de afuera, se cuenta desde la otra punta.
      const elegida: "start" | "end" =
        dcBoxPlacement === "center-road"
          ? haciaLaCalle
          : haciaLaCalle === "start" ? "end" : "start";

      origins.set(r.id, elegida);
      asignadas++;
    }

    blocks.push({
      block, rows: group.length, status: "ok",
      detail:
        `${asignadas} filas con el sentido resuelto por geometria. ${g.detail} ` +
        (dcBoxPlacement === "center-road"
          ? "Se cuenta desde la punta que da a la calle del medio."
          : "Se cuenta desde la punta de afuera, que es donde estan las cajas."),
    });
  }

  return { origins, blocks };
}

/** Escribe el sentido deducido en las filas, para que quede a la vista. */
export function aplicarOrigenes(rows: TrackerRow[], d: OriginDerivation): TrackerRow[] {
  return rows.map((r) => {
    const o = d.origins.get(r.id);
    return o ? { ...r, originEnd: o } : r;
  });
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

// ---------------------------------------------------------------------------
// Tipos de tracker
// ---------------------------------------------------------------------------

export interface GrupoDeLargo {
  /** Largo mediano del grupo, en metros. */
  largoM: number;
  filas: number;
  /** Los dos extremos del grupo, para ver cuanto se dispersa. */
  minM: number;
  maxM: number;
  /** Un par de ids de ejemplo, para poder ir a mirarlos al Excel. */
  ejemplos: string[];
}

/**
 * Cuantos LARGOS de tracker distintos hay en el parque.
 *
 * Existe por una pregunta del campo: "y si esos trackers cortos estan metidos
 * en la misma lista de strings y en los mismos mapas que el resto, ¿subo los
 * mapas dos veces?". La respuesta tiene que ser que no, y para eso lo primero
 * es DARSE CUENTA de que el parque tiene dos tipos — sin que nadie lo declare,
 * porque el archivo de picas no trae una columna de tipo de tracker.
 *
 * El metodo es el mismo que encuentra la calle en un plano: ordenar los largos
 * y buscar el vacio grande. Dos tipos de tracker se separan por metros (un
 * tracker de 28 modulos mide 32 m y uno de 56 mide 65), mientras que la
 * dispersion adentro de un mismo tipo es de centimetros. Si el vacio mas grande
 * no llega a ser una fraccion seria del largo, es un solo tipo con ruido.
 */
export function tiposDeTracker(
  rows: TrackerRow[],
  /** Cuanto tiene que separar el vacio, como fraccion del largo mayor. */
  separacionMinima = 0.12,
): GrupoDeLargo[] {
  if (rows.length < 2) return [];

  const frame = makeFrame(rows[0]!.start.lat, rows[0]!.start.lon);
  const largos = rows
    .map((r) => {
      const a = toLocal(frame, r.start.lat, r.start.lon);
      const b = toLocal(frame, r.end.lat, r.end.lon);
      return { id: r.id, m: Math.hypot(b.x - a.x, b.y - a.y) };
    })
    .filter((x) => x.m > 0)
    .sort((x, y) => x.m - y.m);

  if (largos.length < 2) return [];

  const mayor = largos[largos.length - 1]!.m;

  // Cortar donde el salto entre dos largos consecutivos es grande de verdad.
  const cortes: number[] = [];
  for (let i = 1; i < largos.length; i++) {
    if (largos[i]!.m - largos[i - 1]!.m > mayor * separacionMinima) cortes.push(i);
  }
  if (!cortes.length) return [];

  const grupos: GrupoDeLargo[] = [];
  let desde = 0;
  for (const corte of [...cortes, largos.length]) {
    const trozo = largos.slice(desde, corte);
    desde = corte;
    if (!trozo.length) continue;
    grupos.push({
      largoM: trozo[Math.floor(trozo.length / 2)]!.m,
      filas: trozo.length,
      minM: trozo[0]!.m,
      maxM: trozo[trozo.length - 1]!.m,
      ejemplos: trozo.slice(0, 2).map((x) => x.id),
    });
  }

  // De mayor a menor: el tipo principal suele ser el mas largo y el mas comun.
  return grupos.sort((a, b) => b.filas - a.filas || b.largoM - a.largoM);
}

/**
 * Cuantos modulos entran en un largo dado, con la geometria del tipo principal.
 *
 * Sirve para proponer los numeros de una variante sin que nadie los cuente: si
 * el parque tiene trackers de 32,8 m y el panel mide 1134 mm con 10 de hueco,
 * son 28 modulos. Es una PROPUESTA — se muestra para confirmar, igual que todo
 * lo demas de esta pantalla.
 */
export function modulosQueEntran(
  largoM: number,
  anchoModuloMm: number,
  huecoModuloMm: number,
  /** Lo que se lleva la bahia del motor y los voladizos, en mm. */
  descuentoMm = 0,
): number {
  const paso = (anchoModuloMm + huecoModuloMm) / 1000;
  if (paso <= 0) return 0;
  const util = largoM - descuentoMm / 1000 + huecoModuloMm / 1000;
  return Math.max(1, Math.round(util / paso));
}
