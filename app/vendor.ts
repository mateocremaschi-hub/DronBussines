/**
 * El informe de la empresa de termografia, leido con la geometria propia.
 *
 * Una inspeccion tercerizada llega como un CSV: una fila por anomalia, con
 * coordenada, etiqueta de string y numero de modulo. Todo eso ya viene
 * calculado por el proveedor — y ahi esta el problema, porque nadie lo
 * verifica nunca.
 *
 * Este modulo hace tres cosas que ningun proveedor hace por vos:
 *
 *   1. RECALCULA cada hallazgo desde su coordenada con la geometria del
 *      parque, y compara. Si el proveedor cuenta los modulos desde una punta
 *      fija en vez de desde la caja DC, la mitad del parque le sale espejada
 *      y esto lo muestra fila por fila.
 *   2. AGRUPA los hallazgos que en realidad son un solo evento. Una fila
 *      entera marcada modulo por modulo no son 56 defectos: es un tracker.
 *   3. MARCA los que se capturaron fuera de las condiciones que pide la norma,
 *      que en un informe real pueden ser la mitad.
 */

import { formatAddress, locate } from "@locator";
import type { Address, CompiledFarm, TrackerRow } from "@locator";
import { toNumber, type Sheet } from "./ingest";

// ---------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------

export interface VendorMapping {
  lat?: string;
  lon?: string;
  stringId?: string;
  moduleIndex?: string;
  anomaly?: string;
  iec?: string;
  severity?: string;
  deltaT?: string;
  irradiance?: string;
  takenAt?: string;
  thermalUrl?: string;
  rgbUrl?: string;
}

const WORDS: Record<keyof VendorMapping, string[][]> = {
  lat: [["latitude"], ["latitud"], ["lat"]],
  lon: [["longitude"], ["longitud"], ["lon"], ["lng"]],
  stringId: [["string", "id"], ["string"], ["cadena"]],
  moduleIndex: [["module", "coordinates"], ["module", "position"], ["modulo"], ["module"]],
  anomaly: [["anomaly", "type"], ["defect", "type"], ["anomalia"], ["tipo"]],
  iec: [["iec", "category"], ["iec"], ["clase"]],
  severity: [["severity"], ["severidad"], ["criticidad"]],
  deltaT: [["delta", "temperature"], ["delta", "t"], ["dt"]],
  irradiance: [["irradiation"], ["irradiance"], ["irradiancia"]],
  takenAt: [["capture", "datetime"], ["capture", "date"], ["fecha"], ["datetime"]],
  thermalUrl: [["thermal", "image", "url"], ["thermal", "url"], ["termica"]],
  rgbUrl: [["rgb", "image", "url"], ["rgb", "url"], ["visible"]],
};

function tokens(h: string): string[] {
  return String(h).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/).filter(Boolean);
}

export function suggestVendorMapping(headers: string[]): VendorMapping {
  const m: VendorMapping = {};
  const taken = new Set<string>();
  for (const [key, combos] of Object.entries(WORDS) as Array<[keyof VendorMapping, string[][]]>) {
    for (const combo of combos) {
      const hit = headers.find((h) => !taken.has(h) && combo.every((w) => tokens(h).includes(w)));
      if (hit) { m[key] = hit; taken.add(hit); break; }
    }
  }
  return m;
}

export interface VendorFinding {
  index: number;
  lat: number;
  lon: number;
  /** Como lo llamo el proveedor. Ej: S-1.1.1.2.1 */
  stringId?: string;
  /** Que numero de modulo dijo el proveedor. */
  moduleIndex?: number;
  anomaly?: string;
  iec?: string;
  severity?: string;
  deltaT?: number;
  irradiance?: number;
  takenAt?: string;
  thermalUrl?: string;
  rgbUrl?: string;
}

/**
 * Saca el numero de modulo aunque venga envuelto.
 *
 * Los proveedores lo escriben de formas distintas: "(1,25)", "25", "R1-25".
 * Se toma el ultimo numero, que es el que varia modulo a modulo.
 */
export function parseModuleIndex(v: unknown): number | undefined {
  if (v == null || v === "") return undefined;
  const nums = String(v).match(/\d+/g);
  if (!nums?.length) return undefined;
  const n = Number(nums[nums.length - 1]);
  return Number.isFinite(n) ? n : undefined;
}

export function readVendorFindings(sheet: Sheet, m: VendorMapping): VendorFinding[] {
  const out: VendorFinding[] = [];
  sheet.rows.forEach((r, i) => {
    const lat = m.lat ? toNumber(r[m.lat]) : null;
    const lon = m.lon ? toNumber(r[m.lon]) : null;
    if (lat == null || lon == null) return;

    const f: VendorFinding = { index: i + 1, lat, lon };
    const str = (k: keyof VendorMapping) => {
      const col = m[k];
      if (!col) return undefined;
      const v = r[col];
      const s = v == null ? "" : String(v).trim();
      return s || undefined;
    };
    const num = (k: keyof VendorMapping) => {
      const col = m[k];
      return col ? (toNumber(r[col]) ?? undefined) : undefined;
    };

    f.stringId = str("stringId");
    if (m.moduleIndex) f.moduleIndex = parseModuleIndex(r[m.moduleIndex]);
    f.anomaly = str("anomaly");
    f.iec = str("iec");
    f.severity = str("severity");
    f.deltaT = num("deltaT");
    f.irradiance = num("irradiance");
    f.takenAt = str("takenAt");
    f.thermalUrl = str("thermalUrl");
    f.rgbUrl = str("rgbUrl");
    out.push(f);
  });
  return out;
}

// ---------------------------------------------------------------------------
// Recalculo contra la geometria propia
// ---------------------------------------------------------------------------

/**
 * Como se compara lo que dijo el proveedor con lo que da la geometria.
 *
 * "espejado" es el caso que importa: mismo string, pero el numero de modulo
 * contado desde la punta opuesta. No es un error del proveedor —suele ser su
 * convencion, contar desde el norte— pero para el que camina desde la caja DC
 * es el numero equivocado, y en una fila de 28 modulos el 1 y el 28 estan a
 * 32 metros.
 */
export type Agreement = "coincide" | "espejado" | "otro-string" | "sin-ubicar" | "sin-declarar";

export interface Reconciled extends VendorFinding {
  /** Lo que da la geometria propia desde la coordenada. */
  address: Address | null;
  agreement: Agreement;
  /** Numero de modulo segun la geometria propia, contando desde la caja DC. */
  ownModule?: number;
  ownString?: string;
}

/** Cuantos modulos tiene un string, para saber cual es el espejo de cual. */
function modulesPerString(farm: CompiledFarm): number {
  return farm.profile.topology.modulesPerString;
}

export function reconcile(findings: VendorFinding[], farm: CompiledFarm): Reconciled[] {
  const n = modulesPerString(farm);
  return findings.map((f) => {
    const res = locate({ lat: f.lat, lon: f.lon }, farm);
    const a = res.best;
    const out: Reconciled = { ...f, address: a, agreement: "sin-ubicar" };
    if (!a) return out;

    out.ownModule = a.module;
    if (a.stringLabel) out.ownString = a.stringLabel;

    if (f.moduleIndex == null) { out.agreement = "sin-declarar"; return out; }

    // Si los dos lados nombran el string, tiene que ser el mismo.
    if (f.stringId && a.stringLabel && norm(f.stringId) !== norm(a.stringLabel)) {
      out.agreement = "otro-string";
      return out;
    }

    if (a.module === f.moduleIndex) out.agreement = "coincide";
    else if (a.module === n + 1 - f.moduleIndex) out.agreement = "espejado";
    else out.agreement = "otro-string";
    return out;
  });
}

const norm = (s: string) => s.trim().toUpperCase().replace(/\s+/g, "");

export interface ReconcileReport {
  total: number;
  ubicados: number;
  coinciden: number;
  espejados: number;
  otros: number;
  sinUbicar: number;
  /** Conclusion en castellano, para no tener que interpretar los numeros. */
  veredicto: string;
}

export function summarizeReconcile(rows: Reconciled[]): ReconcileReport {
  const c = (a: Agreement) => rows.filter((r) => r.agreement === a).length;
  const coinciden = c("coincide");
  const espejados = c("espejado");
  const otros = c("otro-string") + c("sin-declarar");
  const sinUbicar = c("sin-ubicar");
  const comparables = coinciden + espejados;

  let veredicto: string;
  if (comparables === 0) {
    veredicto = "No hubo con que comparar: el archivo no trae numero de modulo, o ninguna coordenada cayo sobre el parque.";
  } else if (espejados / comparables > 0.9) {
    veredicto =
      `Practicamente todo el archivo esta espejado (${espejados} de ${comparables}). ` +
      "El proveedor cuenta los modulos desde una punta fija del parque, no desde la caja DC. " +
      "Para el que camina desde la caja, esos numeros estan al reves.";
  } else if (espejados / comparables > 0.25) {
    veredicto =
      `${espejados} de ${comparables} estan espejados y ${coinciden} coinciden. ` +
      "Esa mezcla es la firma de contar desde una punta fija: coincide de un lado de la calle " +
      "y sale al reves del otro.";
  } else if (coinciden / comparables > 0.9) {
    veredicto =
      `Coinciden ${coinciden} de ${comparables}. Las dos numeraciones hablan el mismo idioma, ` +
      "asi que el archivo se puede usar tal cual.";
  } else {
    veredicto =
      `${coinciden} coinciden, ${espejados} espejados y ${otros} no cierran de ninguna de las dos formas. ` +
      "Conviene mirar unos casos a mano antes de confiar en el archivo.";
  }

  return { total: rows.length, ubicados: rows.length - sinUbicar, coinciden, espejados, otros, sinUbicar, veredicto };
}

// ---------------------------------------------------------------------------
// Eventos de tracker
// ---------------------------------------------------------------------------

/**
 * Junta los hallazgos que son un solo problema contado muchas veces.
 *
 * Cuando un tracker queda parado en el angulo equivocado, el detector marca
 * TODOS sus modulos, uno por uno. En el informe real de Edenvale eso convirtio
 * 15 trackers desalineados en 767 "defectos de modulo", y 18 filas que la
 * camara no pudo leer en 515 "modulos faltantes": el 41 % del archivo.
 *
 * Quien lee eso ve un problema de modulos donde hay un problema de trackers —
 * que se arregla de otra manera, lo hace otra persona, y muchas veces entra
 * en otra garantia.
 */
export interface TrackerEvent {
  rowId: string;
  block: string;
  tracker: string;
  row?: string;
  anomaly: string;
  modulos: number;
  /** Que fraccion de la fila quedo marcada. Cerca de 1 es la fila entera. */
  fraccion: number;
}

export function trackerEvents(
  rows: Reconciled[],
  geometry: TrackerRow[],
  farm: CompiledFarm,
  minFraccion = 0.5,
): TrackerEvent[] {
  const porFila = farm.profile.topology.modulesPerString * farm.profile.topology.stringsPerRow;
  const info = new Map(geometry.map((r) => [r.id, r]));
  const grupos = new Map<string, Reconciled[]>();

  for (const r of rows) {
    if (!r.address || !r.anomaly) continue;
    const k = `${r.address.rowId}|${r.anomaly}`;
    grupos.set(k, [...(grupos.get(k) ?? []), r]);
  }

  const out: TrackerEvent[] = [];
  for (const [k, g] of grupos) {
    const fraccion = g.length / porFila;
    if (fraccion < minFraccion) continue;
    const rowId = k.slice(0, k.lastIndexOf("|"));
    const geo = info.get(rowId);
    const ev: TrackerEvent = {
      rowId,
      block: g[0]!.address!.block,
      tracker: g[0]!.address!.tracker,
      anomaly: g[0]!.anomaly!,
      modulos: g.length,
      fraccion,
    };
    if (geo?.row) ev.row = geo.row;
    out.push(ev);
  }
  return out.sort((a, b) => b.modulos - a.modulos);
}

// ---------------------------------------------------------------------------
// Condiciones de captura
// ---------------------------------------------------------------------------

/** Minimo de irradiancia que pide la IEC TS 62446-3 para una termografia valida. */
export const IRRADIANCIA_MINIMA = 600;

export interface ConditionsReport {
  conDato: number;
  sinDato: number;
  bajoMinimo: number;
  minima?: number;
  nota: string;
}

export function checkConditions(rows: VendorFinding[]): ConditionsReport {
  const con = rows.filter((r) => r.irradiance != null);
  const bajo = con.filter((r) => r.irradiance! < IRRADIANCIA_MINIMA);
  const minima = con.length ? Math.min(...con.map((r) => r.irradiance!)) : undefined;

  const partes: string[] = [];
  if (rows.length - con.length > 0) {
    partes.push(
      `${rows.length - con.length} hallazgos (${pct(rows.length - con.length, rows.length)}) ` +
      "no traen irradiancia registrada",
    );
  }
  if (bajo.length) {
    partes.push(
      `${bajo.length} se capturaron por debajo de ${IRRADIANCIA_MINIMA} W/m2` +
      (minima != null ? ` (el minimo fue ${minima})` : ""),
    );
  }

  const r: ConditionsReport = {
    conDato: con.length,
    sinDato: rows.length - con.length,
    bajoMinimo: bajo.length,
    nota: partes.length
      ? `${partes.join(", y ")}. La norma pide 600 W/m2 o mas: esos hallazgos hay que declararlos como limitacion.`
      : "Todos los hallazgos traen irradiancia y estan por encima del minimo de la norma.",
  };
  if (minima != null) r.minima = minima;
  return r;
}

const pct = (n: number, total: number) => `${Math.round((n / Math.max(1, total)) * 100)} %`;

// ---------------------------------------------------------------------------
// Exportacion
// ---------------------------------------------------------------------------

const esc = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * El mismo informe, pero numerado para caminarlo.
 *
 * Se conserva el numero del proveedor al lado del propio a proposito: sin eso
 * nadie puede cotejar las dos versiones, y un entregable que no se puede
 * cotejar contra el original no se lo cree nadie.
 */
export function toWalkCsv(rows: Reconciled[]): string {
  const head = [
    "bloque", "tracker", "fila", "string", "modulo_desde_caja_dc",
    "string_proveedor", "modulo_proveedor", "coincidencia",
    "anomalia", "clase_iec", "severidad", "delta_t", "irradiancia",
    "latitud", "longitud", "foto_termica", "foto_rgb",
  ];
  const lines = [head.join(",")];

  const orden = [...rows].sort((a, b) => {
    const A = a.address, B = b.address;
    if (!A || !B) return A ? -1 : B ? 1 : 0;
    return (
      A.block.localeCompare(B.block, undefined, { numeric: true }) ||
      A.tracker.localeCompare(B.tracker, undefined, { numeric: true }) ||
      (A.module ?? 0) - (B.module ?? 0)
    );
  });

  for (const r of orden) {
    const a = r.address;
    lines.push([
      a?.block ?? "", a?.tracker ?? "", a?.row ?? "",
      a?.stringLabel ?? a?.stringNumber ?? "", a?.module ?? "",
      r.stringId ?? "", r.moduleIndex ?? "", r.agreement,
      r.anomaly ?? "", r.iec ?? "", r.severity ?? "", r.deltaT ?? "", r.irradiance ?? "",
      r.lat, r.lon, r.thermalUrl ?? "", r.rgbUrl ?? "",
    ].map(esc).join(","));
  }
  return lines.join("\n");
}

/** Resumen de los eventos de tracker, que es lo que se lleva a la reunion. */
export function toEventsCsv(events: TrackerEvent[]): string {
  const head = ["bloque", "tracker", "fila", "anomalia", "modulos_marcados", "fraccion_de_la_fila"];
  const lines = [head.join(",")];
  for (const e of events) {
    lines.push([
      e.block, e.tracker, e.row ?? "", e.anomaly, e.modulos, e.fraccion.toFixed(2),
    ].map(esc).join(","));
  }
  return lines.join("\n");
}

export { formatAddress };
