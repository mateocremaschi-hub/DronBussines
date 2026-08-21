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

const PREFIX = "farm:";

export interface StoredFarm {
  profile: FarmProfile;
  rows: TrackerRow[];
  savedAt: string;
  source?: { fileName: string; sheetName: string; rowCount: number };
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
