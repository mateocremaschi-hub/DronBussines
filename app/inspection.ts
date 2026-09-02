/**
 * El modelo de un vuelo: sus hallazgos, lo que midio el motor y su revision.
 *
 * Los campos de condiciones y de clasificacion no son decorativos: la IEC TS
 * 62446-3 pide que un reporte de termografia documente la irradiancia, la
 * temperatura ambiente, el viento y el estado del cielo del momento de la
 * captura, y que cada hallazgo lleve su ubicacion a nivel de modulo, su ΔT y su
 * clase. Si no se cargan al momento, despues nadie se acuerda.
 *
 * Habia DOS modelos para lo mismo y no se hablaban.
 * ---------------------------------------------------------------------------
 * Un `Finding` era una FOTO clasificada a mano: se cargaba la carpeta, cada
 * foto daba un hallazgo, y el tecnico escribia el ΔT mirando la pantalla de la
 * camara. En paralelo, `StoredAnalysis` guardaba los `Hallazgo` del motor: un
 * MODULO medido contra sus 27 hermanos de string, con su delta calculado y el
 * recuadro de donde salio el numero. Cargando las mismas fotos en las dos
 * pantallas salian dos listas que no se conocian: la deteccion buena en una y
 * la revision buena en la otra.
 *
 * Ahora hay uno solo. El hallazgo sigue siendo lo que una persona revisa y
 * confirma, y ademas lleva adentro lo que midio el motor. Las dos mitades
 * viajan juntas: al informe, al guardado, y de vuelta cuando el vuelo se abre
 * un mes despues.
 */

import { del, get, keys, set } from "idb-keyval";
import type { Address, Warning } from "@locator";
import type { PhotoFix } from "./photos";
import type { Caja, EventoDeString, Severidad, Umbrales } from "./detect";

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

/**
 * Lo que midio el motor sobre un modulo.
 *
 * Es la mitad que antes vivia aparte, en el `Hallazgo` de la otra pantalla. Va
 * completa a proposito, incluida la caja: sin ella no se puede volver a marcar
 * el modulo sobre la foto, y recalcularla despues exige la pose, la camara, el
 * ajuste y el angulo del tracker de ESE instante — cuatro cosas que ya no
 * estan a mano cuando alguien discute un hallazgo seis meses despues.
 */
export interface Medicion {
  /** Temperatura del modulo: la mediana del 60 % central, sin marco ni suelo. */
  celsius: number;
  /** Cuanto se despega de sus hermanos del mismo string. */
  deltaT: number;
  /** Contra que se comparo. */
  referenciaC: number;
  /** Contra cuantos. */
  vecinos: number;
  /** Que vecindario se pudo usar. `string` es el bueno; los otros son flojos. */
  ambito: "string" | "fila" | "vuelo";
  severidad: Severidad;
  /** La zona mas caliente adentro del propio modulo. */
  puntoCalienteC?: number;
  /** Cuanto se despega esa zona del propio modulo. Es como se ve una celda. */
  deltaInterno?: number;
  severidadInterna?: Severidad;
  /** La peor de las dos comparaciones. Es la que ordena la lista. */
  peor: Severidad;
  /** Cual de las dos la disparo. */
  origen: "modulo" | "celda" | "ninguno";
  /** Sobre cuantos pixeles se midio. */
  pixeles: number;
  /** Cuantos pixeles cubria una celda. Debajo de 4 no se busca punto caliente. */
  pixelesPorCelda?: number;
  /** El recuadro que se midio, en pixeles de la imagen termica. */
  caja?: Caja;
}

export interface Finding {
  id: string;
  fileName: string;
  /**
   * La foto en la que se midio este modulo.
   *
   * Paso a ser opcional. Antes un hallazgo ERA una foto y sin coordenada no
   * existia; ahora es un MODULO, y su ubicacion sale de la geometria del
   * parque, que es exacta. La foto queda para poder decir a que hora se tomo y
   * con cuanto error de GPS se la ubico.
   */
  fix?: PhotoFix;
  /** Lo que resolvio el motor. `null` si no habia geometria cerca. */
  address: Address | null;
  /** Los vecinos, para que el tecnico confirme contra la foto. */
  candidates: Address[];
  warnings: Warning[];
  /**
   * Lo que midio el motor. Ausente en los vuelos cargados con el modelo viejo,
   * donde el ΔT lo escribia una persona a mano.
   */
  medicion?: Medicion;

  // --- revision humana ---
  status: FindingStatus;
  anomaly?: string;
  klass?: 1 | 2 | 3;
  /**
   * El ΔT que corrige el tecnico, si corrige alguno.
   *
   * NO pisa `medicion.deltaT`, igual que `moduleCorregido` no pisa el modulo
   * que calculo la app. Borrar de donde salio cada numero es lo que convierte
   * un informe en algo que no se puede defender: el que lo recibe tiene que
   * poder ver que midio la maquina y que cambio la persona.
   */
  deltaT?: number;
  note?: string;
  /** Si el tecnico corrige el modulo mirando la foto, queda registrado aparte. */
  moduleCorregido?: number;

  /**
   * Que dijo la maquina mirando la forma de la mancha, y por que.
   *
   * Va aparte de `anomaly` a proposito. `anomaly` es lo que se entrega, y una
   * persona lo puede cambiar; esto es lo que propuso el motor y no se pisa
   * nunca. Guardar los dos es lo que permite decir, en el informe, cuantos de
   * los revisados coincidieron — que es lo unico que hace defendible clasificar
   * por muestreo en vez de uno por uno.
   */
  patron?: import("./patron").Clasificacion;
}

/**
 * El ΔT que se entrega: el de la persona si lo corrigio, si no el del motor.
 *
 * Vale la pena que sea una funcion y no una lectura suelta: el informe, el
 * nombre de la foto y el color de la tarjeta tienen que elegir lo mismo, y
 * tres lugares eligiendo por su cuenta es como salen tres numeros distintos
 * para el mismo modulo en el mismo entregable.
 */
export function deltaTDe(f: Finding): number | undefined {
  return f.deltaT ?? f.medicion?.deltaT;
}

export interface Conditions {
  irradianceWm2?: number;
  ambientC?: number;
  windMs?: number;
  sky?: string;
  pilot?: string;
  equipment?: string;
}

/**
 * Lo que el vuelo NO permite afirmar.
 *
 * Es lo mas valioso que produce la deteccion y vivia suelto en el estado de la
 * pantalla de analisis: se calculaba, se mostraba, y se perdia al cerrar. Un
 * informe que no dice que NO miro no sirve para un reclamo — el que lo recibe
 * no puede distinguir "ese modulo esta sano" de "ese modulo no cayo en ninguna
 * foto", y son cosas opuestas.
 *
 * Por eso viaja con el vuelo, se guarda con el vuelo, y sale en los cuatro
 * formatos de entrega.
 */
export interface Cobertura {
  /** Cuando se corrio la deteccion. */
  analizadoEl: string;
  /** Archivos elegidos, y cuantos de esos traian temperatura adentro. */
  fotos: number;
  fotosTermicas: number;
  /** Centimetros por pixel del vuelo. Decide si una celda se puede ver. */
  gsdCm: number;
  /** Modulos que tiene el parque cargado. */
  totalModulos: number;
  /** Modulos que se pudieron medir. */
  modulosMedidos: number;
  /** Los que aparecieron SOLO cortados por el borde de alguna foto. */
  soloEnElBorde: number;
  /** Los que no cayeron en ninguna foto. */
  sinMedir: number;
  /** Con que umbrales se clasifico la lista. */
  umbrales: Umbrales;
  /** Fotos que se ubicaron con un supuesto porque les faltaba un dato. */
  posesSupuestas: Array<{ motivo: string; fotos: number }>;
  /** Strings enteros calientes: no son defectos de modulo, se arreglan en otro lado. */
  eventosDeString: EventoDeString[];
  /** Las frases, ya escritas, de lo que este vuelo no permite afirmar. */
  limitaciones: string[];
}

export interface Inspection {
  id: string;
  farmId: string;
  farmName: string;
  name: string;
  createdAt: string;
  conditions: Conditions;
  findings: Finding[];
  /** Ausente en los vuelos cargados con el modelo viejo, y en los que no se analizaron. */
  cobertura?: Cobertura;
}

/**
 * Si este vuelo viene del modelo anterior: una foto, un hallazgo, sin medicion.
 *
 * Se pregunta por los datos y no por un numero de version, porque nunca hubo
 * uno. Un vuelo viejo tiene hallazgos y ninguno trae lo que midio el motor;
 * uno nuevo sin fotos cargadas todavia no tiene hallazgos, y ese no es viejo:
 * esta vacio.
 */
export function esModeloViejo(i: Inspection): boolean {
  return i.findings.length > 0 && i.findings.every((f) => !f.medicion);
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
  /**
   * Cuantos hay de cada severidad medida.
   *
   * Es lo que antes solo se veia en la pantalla del analisis, y se perdia al
   * cerrarla: la clase IEC la pone una persona y tarda, asi que un vuelo recien
   * cargado tiene 400 hallazgos y cero clases. Sin esto, la unica cuenta que
   * mostraba el resumen era la humana y un vuelo entero sin revisar se veia
   * igual que uno sin nada.
   */
  porSeveridad: Record<Severidad, number>;
  bloques: number;
}

export function summarize(findings: Finding[]): Summary {
  const porClase: Record<1 | 2 | 3, number> = { 1: 0, 2: 0, 3: 0 };
  const porSeveridad: Record<Severidad, number> = {
    normal: 0, leve: 0, moderada: 0, critica: 0,
  };
  const bloques = new Set<string>();
  let sinUbicar = 0;

  for (const f of findings) {
    if (f.klass) porClase[f.klass]++;
    if (f.medicion) porSeveridad[f.medicion.peor]++;
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
    porSeveridad,
    bloques: bloques.size,
  };
}

/*
  El CSV se mudo a `informe.ts`.

  Vivia aca con su propia lista de columnas, al lado de la de `informe.ts` que
  usan el Excel y el HTML. Eran dos listas para la misma tabla: el mismo
  archivo de este mismo vuelo salia con una columna de diferencia segun por
  que boton se lo pidiera. Ahora los cuatro formatos de entrega estan en un
  solo lugar y sacan las columnas de la misma funcion.
*/

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
