/**
 * El modelo de una inspeccion: un vuelo, sus hallazgos, y su revision.
 *
 * Los campos de condiciones y de clasificacion no son decorativos: la IEC TS
 * 62446-3 pide que un reporte de termografia documente la irradiancia, la
 * temperatura ambiente, el viento y el estado del cielo del momento de la
 * captura, y que cada hallazgo lleve su ubicacion a nivel de modulo, su ΔT y su
 * clase. Si no se cargan al momento, despues nadie se acuerda.
 */

import { del, get, keys, set } from "idb-keyval";
import type { Address, Warning } from "@locator";
import type { PhotoFix } from "./photos";

export type FindingStatus = "pendiente" | "confirmado" | "descartado";

/** Clases de la IEC TS 62446-3. Los umbrales son indicativos. */
export const CLASES = [
  { id: 1, label: "Clase 1 — sin anomalia", hint: "Dentro de la variacion normal. Queda como linea de base." },
  { id: 2, label: "Clase 2 — reparacion programada", hint: "Diferencia sostenida contra modulos comparables, del orden de 10 °C." },
  { id: 3, label: "Clase 3 — accion inmediata", hint: "ΔT del orden de 40 °C, o riesgo de incendio o descarga: caja de conexion, vidrio roto." },
] as const;

export const ANOMALIAS = [
  "Punto caliente",
  "Celda multiple",
  "Diodo de bypass",
  "String completo",
  "Modulo completo",
  "PID",
  "Suciedad",
  "Sombra",
  "Caja de conexion",
  "Vidrio roto",
  "Otro",
] as const;

export interface Finding {
  id: string;
  fileName: string;
  fix: PhotoFix;
  /** Lo que resolvio el motor. `null` si no habia geometria cerca. */
  address: Address | null;
  /** Los vecinos, para que el tecnico confirme contra la foto. */
  candidates: Address[];
  warnings: Warning[];

  // --- revision humana ---
  status: FindingStatus;
  anomaly?: string;
  klass?: 1 | 2 | 3;
  deltaT?: number;
  note?: string;
  /** Si el tecnico corrige el modulo mirando la foto, queda registrado aparte. */
  moduleCorregido?: number;
}

export interface Conditions {
  irradianceWm2?: number;
  ambientC?: number;
  windMs?: number;
  sky?: string;
  pilot?: string;
  equipment?: string;
}

export interface Inspection {
  id: string;
  farmId: string;
  farmName: string;
  name: string;
  createdAt: string;
  conditions: Conditions;
  findings: Finding[];
}

// ---------------------------------------------------------------------------
// Persistencia
// ---------------------------------------------------------------------------

const PREFIX = "inspection:";

export async function listInspections(farmId: string): Promise<Inspection[]> {
  const ks = (await keys()) as string[];
  const out: Inspection[] = [];
  for (const k of ks) {
    if (typeof k !== "string" || !k.startsWith(PREFIX)) continue;
    const v = await get<Inspection>(k);
    if (v && v.farmId === farmId) out.push(v);
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function saveInspection(i: Inspection): Promise<void> {
  await set(PREFIX + i.id, i);
}

export async function deleteInspection(id: string): Promise<void> {
  await del(PREFIX + id);
}

// ---------------------------------------------------------------------------
// Resumen y export
// ---------------------------------------------------------------------------

export interface Summary {
  total: number;
  pendientes: number;
  confirmados: number;
  descartados: number;
  sinUbicar: number;
  porClase: Record<1 | 2 | 3, number>;
  bloques: number;
}

export function summarize(findings: Finding[]): Summary {
  const porClase: Record<1 | 2 | 3, number> = { 1: 0, 2: 0, 3: 0 };
  const bloques = new Set<string>();
  let sinUbicar = 0;

  for (const f of findings) {
    if (f.klass) porClase[f.klass]++;
    if (f.address) bloques.add(f.address.block);
    else sinUbicar++;
  }

  return {
    total: findings.length,
    pendientes: findings.filter((f) => f.status === "pendiente").length,
    confirmados: findings.filter((f) => f.status === "confirmado").length,
    descartados: findings.filter((f) => f.status === "descartado").length,
    sinUbicar,
    porClase,
    bloques: bloques.size,
  };
}

const CSV_HEADERS = [
  "archivo", "fecha", "latitud", "longitud", "precision_m",
  "bloque", "tracker", "fila", "string", "modulo", "conteo_desde", "caja_dc",
  "modulo_corregido", "confianza", "anomalia", "clase", "delta_t", "estado", "nota", "avisos",
];

function csvCell(v: unknown): string {
  if (v == null) return "";
  const s = String(v);
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Las condiciones del vuelo, arriba de la tabla.
 *
 * La pantalla dice "la norma de termografia exige documentarlas en el reporte"
 * y despues las guardaba en la base y nada mas: el CSV, que ES el reporte que
 * se entrega, no las llevaba. Se cargaban seis campos en el campo, con frio,
 * para nada.
 *
 * Van como encabezado con una linea en blanco antes de la tabla: Excel lo abre
 * igual y el que recibe el archivo las ve sin tener que preguntar.
 */
function cabeceraDeCondiciones(i: Inspection): string[] {
  const c = i.conditions;
  const filas: Array<[string, unknown]> = [
    ["inspeccion", i.name],
    ["parque", i.farmName],
    ["fecha", i.createdAt],
    ["irradiancia_wm2", c.irradianceWm2],
    ["temperatura_ambiente_c", c.ambientC],
    ["viento_ms", c.windMs],
    ["cielo", c.sky],
    ["piloto", c.pilot],
    ["equipo", c.equipment],
  ];
  return [
    ...filas.map(([k, v]) => [k, v == null || v === "" ? "sin registrar" : v].map(csvCell).join(",")),
    "",
  ];
}

/** Exporta los hallazgos a CSV. Solo los descartados quedan afuera. */
export function toCsv(inspection: Inspection): string {
  const rows = [...cabeceraDeCondiciones(inspection), CSV_HEADERS.join(",")];

  for (const f of inspection.findings) {
    if (f.status === "descartado") continue;
    const a = f.address;
    rows.push(
      [
        f.fileName,
        f.fix.takenAt ?? "",
        f.fix.lat.toFixed(7),
        f.fix.lon.toFixed(7),
        f.fix.accuracyM ?? "",
        a?.block ?? "",
        a?.tracker ?? "",
        a?.row ?? "",
        a?.stringNumber ?? "",
        a?.module ?? "",
        a ? (a.countedFrom === "near-dc" ? "caja DC" : "punta lejana") : "",
        a?.dcBoxLabel ?? "",
        f.moduleCorregido ?? "",
        a ? (a.confidence * 100).toFixed(0) + "%" : "",
        f.anomaly ?? "",
        f.klass ?? "",
        f.deltaT ?? "",
        f.status,
        f.note ?? "",
        f.warnings.map((w) => w.code).join(" "),
      ]
        .map(csvCell)
        .join(","),
    );
  }

  return rows.join("\n");
}

export function download(name: string, content: string, mime: string): void {
  descargarBytes(name, content, mime);
}

/** Lo mismo, para un archivo binario — el KMZ del vuelo, por ejemplo. */
export function descargarBytes(name: string, content: BlobPart, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
