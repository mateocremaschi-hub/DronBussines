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

const PREFIX = "farm:";
const ANALISIS = "analisis:";

export interface StoredFarm {
  profile: FarmProfile;
  rows: TrackerRow[];
  savedAt: string;
  source?: { fileName: string; sheetName: string; rowCount: number };
  /** Lo que se conto a mano en el campo. La evidencia del parque. */
  checks?: FieldCheck[];
  /**
   * Cuales de las medidas de geometria se midieron con cinta y cuales son
   * supuestos.
   *
   * Antes vivia solo en el estado de la pantalla de alta: se tildaba, servia
   * para el cuadre de esa sesion, y se perdia al guardar. Un mes despues nadie
   * podia saber si los 555 mm de la bahia salieron de una cinta o de un PDF, y
   * el cuadre volvia a acusar a la medida buena.
   *
   * Claves: `ancho`, `hueco`, `bahia`, `offset`.
   */
  medidos?: Record<string, boolean>;
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

/** Exporta un parque a un archivo, para pasarlo a otro dispositivo o guardarlo. */
export function downloadFarm(farm: StoredFarm): void {
  // Sin sangria: un parque son miles de filas y el archivo se manda por mail o
  // por WhatsApp de la compu al celular. Con sangria pesa el triple y no
  // aporta nada — no es un archivo para leer a mano.
  const blob = new Blob([JSON.stringify(farm)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  // Una sola extension: en iOS un nombre con dos puntos hace que el selector
  // de archivos no lo reconozca y lo muestre en gris.
  a.download = `${farm.profile.id}-pica.json`;
  a.click();
  URL.revokeObjectURL(url);
}
