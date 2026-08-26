/**
 * Almacenamiento local de parques.
 *
 * IndexedDB y no localStorage: un parque grande son miles de filas y
 * localStorage se llena a los 5 MB. Ademas, la geometria tiene que sobrevivir
 * offline en el campo — es lo unico que la app necesita para funcionar sin
 * senal.
 */

import { del, get, keys, set } from "idb-keyval";
import type { FarmProfile, TrackerRow } from "@locator";
import type { FieldCheck } from "./checks";
import type { Hallazgo } from "./detect";
import type { Cobertura, Condiciones } from "./warranty";

const PREFIX = "farm:";
const ANALISIS = "analisis:";
const GARANTIA = "garantia:";

export interface StoredFarm {
  profile: FarmProfile;
  rows: TrackerRow[];
  savedAt: string;
  source?: { fileName: string; sheetName: string; rowCount: number };
  /** Lo que se conto a mano en el campo. La evidencia del parque. */
  checks?: FieldCheck[];
}

export async function listFarms(): Promise<StoredFarm[]> {
  const ks = (await keys()) as string[];
  const farms: StoredFarm[] = [];
  for (const k of ks) {
    if (typeof k !== "string" || !k.startsWith(PREFIX)) continue;
    const value = await get<StoredFarm>(k);
    if (value) farms.push(value);
  }
  return farms.sort((a, b) => a.profile.name.localeCompare(b.profile.name));
}

export async function loadFarm(id: string): Promise<StoredFarm | undefined> {
  return get<StoredFarm>(PREFIX + id);
}

export async function saveFarm(farm: StoredFarm): Promise<void> {
  await set(PREFIX + farm.profile.id, farm);
}

export async function deleteFarm(id: string): Promise<void> {
  await del(PREFIX + id);
}

// ---------------------------------------------------------------------------
// El vuelo analizado
// ---------------------------------------------------------------------------

/**
 * El resultado de un analisis, guardado.
 *
 * Se guardan solo los hallazgos que no son normales. Un parque entero son
 * cientos de miles de modulos y no tiene sentido guardar los sanos: lo que se
 * necesita despues es la lista corta, la que se clasifica a mano.
 */
export interface StoredAnalysis {
  farmId: string;
  hallazgos: Hallazgo[];
  gsdCm: number;
  fotos: number;
  savedAt: string;
}

export async function saveAnalysis(a: StoredAnalysis): Promise<void> {
  await set(ANALISIS + a.farmId, a);
}

export async function loadAnalysis(farmId: string): Promise<StoredAnalysis | undefined> {
  return get<StoredAnalysis>(ANALISIS + farmId);
}

// ---------------------------------------------------------------------------
// La clasificacion a mano
// ---------------------------------------------------------------------------

/**
 * Lo que pone una persona mirando cada hallazgo.
 *
 * Esto se guarda aparte del analisis y sobrevive a un vuelo nuevo por una
 * razon practica: clasificar doscientos modulos a mano son horas de trabajo, y
 * perderlas por recargar la pagina seria inaceptable.
 *
 * Los Map y Set van como arrays porque IndexedDB los serializa mal entre
 * versiones del navegador.
 */
export interface StoredWarranty {
  farmId: string;
  cobertura: Cobertura;
  condiciones: Condiciones;
  /** Clave de modulo → tipo de anomalia asignado a mano. */
  anomalias: Array<[string, string]>;
  /** Claves de modulo que tienen foto visible archivada. */
  conRgb: string[];
  savedAt: string;
}

export async function saveWarranty(w: StoredWarranty): Promise<void> {
  await set(GARANTIA + w.farmId, w);
}

export async function loadWarranty(farmId: string): Promise<StoredWarranty | undefined> {
  return get<StoredWarranty>(GARANTIA + farmId);
}

/** Exporta un parque a un archivo, para pasarlo a otro dispositivo o guardarlo. */
export function downloadFarm(farm: StoredFarm): void {
  const blob = new Blob([JSON.stringify(farm, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${farm.profile.id}.pica.json`;
  a.click();
  URL.revokeObjectURL(url);
}
