/**
 * Planificacion del vuelo: de la geometria del parque a la ruta del dron.
 *
 * Esto se puede hacer bien porque el parque ya esta cargado. No hay que
 * dibujar un poligono a mano sobre un mapa satelital: las filas de modulos
 * dicen exactamente donde estan los paneles y hacia donde apuntan, asi que las
 * lineas de vuelo salen paralelas a las filas solas.
 *
 * Dos decisiones que estan metidas en el codigo y conviene que se vean:
 *
 *   - Se planifica para la camara TERMICA, no para la visible. La termica es
 *     de mucha menor resolucion, asi que su huella en el suelo es mas chica y
 *     necesita mas lineas. Un vuelo planificado con la visible deja huecos en
 *     la termica, que es la que importa.
 *   - Se informa cuantos PIXELES le tocan a cada modulo. Es el numero que
 *     decide si el vuelo sirve: con pocos pixeles por modulo, un punto
 *     caliente de una celda no se distingue del ruido por mas que la foto
 *     exista.
 */

import { makeFrame, toGeo, toLocal } from "@locator";
import type { FarmProfile, LatLon, TrackerRow } from "@locator";

const RAD = Math.PI / 180;

// ---------------------------------------------------------------------------
// Camara
// ---------------------------------------------------------------------------

export interface Camera {
  name: string;
  /** Ancho de la imagen en pixeles. */
  imageW: number;
  imageH: number;
  /** Campo de vision horizontal y vertical, en grados. */
  hfovDeg: number;
  vfovDeg: number;
}

/**
 * Presets sacados de las fichas oficiales.
 *
 * OJO con el dato que se carga: las fichas publican el campo de vision
 * DIAGONAL (DFOV) y lo que necesita el calculo es el horizontal y el vertical.
 * Confundirlos infla la huella y separa las lineas de mas — o sea, deja
 * HUECOS. Y un hueco no falla el dia del vuelo: aparece meses despues, cuando
 * alguien busca un panel y no hay foto. Por eso se derivan del diagonal con
 * la relacion de aspecto del sensor, en vez de cargarse a mano.
 */
function desdeDiagonal(name: string, dfovDeg: number, imageW: number, imageH: number): Camera {
  const d = Math.hypot(imageW, imageH);
  const t = Math.tan((dfovDeg * Math.PI) / 180 / 2);
  const grados = (x: number) => (2 * Math.atan(t * x)) / RAD;
  return { name, imageW, imageH, hfovDeg: grados(imageW / d), vfovDeg: grados(imageH / d) };
}

/** Diagonal de un cuadro de 35 mm, que es la referencia de la equivalencia. */
const DIAGONAL_35MM = Math.hypot(36, 24);

/**
 * La camara, sacada de la propia foto.
 *
 * Toda camara escribe en el EXIF su distancia focal equivalente a 35 mm, y de
 * ahi sale el campo de vision exacto sin depender de ninguna ficha. Es la
 * unica forma de no equivocarse: las fichas publican el angulo DIAGONAL, las
 * paginas de terceros lo copian mal, y un angulo mal cargado separa las lineas
 * de mas y deja huecos.
 *
 * Verificado contra las fotos reales de Edenvale: la camara visible del M3T
 * declara 24 mm y da DFOV 84.1, que es exactamente lo que publica DJI. Y la
 * termica declara 40 mm, o sea DFOV 56.8 — no los 41.2 que figuraban aca,
 * que venian de una pagina de terceros y estaban mal.
 */
export function camaraDesdeEquivalente35(
  name: string,
  mm35: number,
  imageW: number,
  imageH: number,
): Camera {
  const t = DIAGONAL_35MM / (2 * mm35);
  const d = Math.hypot(imageW, imageH);
  const grados = (x: number) => (2 * Math.atan(t * x)) / RAD;
  return { name, imageW, imageH, hfovDeg: grados(imageW / d), vfovDeg: grados(imageH / d) };
}

export const CAMARAS: Camera[] = [
  camaraDesdeEquivalente35("Mavic 3T · termica 640x512 (40 mm eq)", 40, 640, 512),
  desdeDiagonal("Matrice 4T · termica 640x512 (DFOV 45°)", 45, 640, 512),
  desdeDiagonal("Zenmuse H30T · termica 1280x1024 (DFOV 45.2°)", 45.2, 1280, 1024),
  camaraDesdeEquivalente35("Mavic 3T · visible 4000x3000 (24 mm eq)", 24, 4000, 3000),
];

const huella = (alturaM: number, fovDeg: number) => 2 * alturaM * Math.tan((fovDeg * RAD) / 2);

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

export interface MissionOptions {
  camera: Camera;
  /** Altura sobre el terreno, en metros. */
  altitudeM: number;
  /** Solape entre fotos consecutivas de la misma linea, 0 a 1. */
  frontOverlap: number;
  /** Solape entre lineas vecinas, 0 a 1. */
  sideOverlap: number;
  speedMps: number;
  /** Cuanto se extiende el area mas alla de los modulos, en metros. */
  marginM: number;
  /** Volar a lo largo de las filas. Cruzarlas obliga a mas giros. */
  alongRows: boolean;
  /**
   * Si el dron sigue la linea con precision de centimetros.
   *
   * No es un dato de lujo: es lo que decide cuanto solape hace falta, y el
   * solape decide cuantas horas dura el trabajo. Sin RTK el dron se puede ir
   * varios metros de la linea, y el solape tiene que absorber esa deriva.
   */
  rtk: boolean;
}

/**
 * Solapes segun lo que el dron pueda seguir la linea.
 *
 * OJO con el numero de arriba: 70 % de solape lateral es lo que pide la
 * FOTOGRAMETRIA para poder coser las fotos en un mosaico. Esta app no cose
 * nada — proyecta cada foto por separado sobre el parque, que ya esta
 * medido — asi que ese solape no hace falta. Solo tiene que alcanzar para
 * que no queden huecos cuando el dron se corre de la linea.
 *
 * Con RTK se corre centimetros y 45 % sobra. Sin RTK se puede ir 2 a 5 metros,
 * y sobre una franja de 30 m eso es un 15 % para cada lado: hace falta el 70 %.
 * La diferencia, en un parque grande, es la mitad de los dias de trabajo.
 */
export const SOLAPES = {
  conRtk: { sideOverlap: 0.45, frontOverlap: 0.5 },
  sinRtk: { sideOverlap: 0.7, frontOverlap: 0.7 },
};

export const OPCIONES_POR_DEFECTO: Omit<MissionOptions, "camera"> = {
  altitudeM: 50,
  ...SOLAPES.sinRtk,
  speedMps: 5,
  marginM: 10,
  alongRows: true,
  rtk: false,
};

export interface MissionLine {
  a: LatLon;
  b: LatLon;
  largoM: number;
}

export interface MissionStats {
  lineas: number;
  /** Separacion entre lineas vecinas, en metros. */
  separacionM: number;
  /** Cada cuantos metros dispara la camara. */
  disparoCadaM: number;
  fotos: number;
  distanciaM: number;
  minutos: number;
  /** Centimetros de terreno por pixel. */
  gsdCm: number;
  /** Cuantos pixeles de ancho ocupa un modulo. Es el numero que decide todo. */
  pixelesPorModulo: number;
  huellaAnchoM: number;
  huellaLargoM: number;
  /** Lo que hay que mirar antes de volar. */
  avisos: string[];
}

export interface Mission {
  lines: MissionLine[];
  /** Los vertices en orden de vuelo, ida y vuelta. */
  waypoints: LatLon[];
  stats: MissionStats;
}

/**
 * Centimetros por pixel por encima de los cuales una celda deja de verse.
 *
 * El limite no lo pone el modulo sino la CELDA, que es donde nace el punto
 * caliente. Una celda mide entre 15 y 20 cm, asi que para que se distinga del
 * ruido hacen falta unos 3 pixeles de ancho sobre ella: unos 5 cm por pixel.
 *
 * Medirlo en modulos engaña: a 120 m un modulo todavia da 10 pixeles y parece
 * suficiente, pero cada celda queda en uno y medio.
 */
const GSD_MAXIMO_CM = 5;

export function planMission(
  rows: TrackerRow[],
  profile: FarmProfile,
  opts: MissionOptions,
): Mission | null {
  if (!rows.length) return null;

  const frame = makeFrame(rows[0]!.start.lat, rows[0]!.start.lon);
  const puntas = rows.flatMap((r) => [toLocal(frame, r.start.lat, r.start.lon), toLocal(frame, r.end.lat, r.end.lon)]);

  // Direccion media de las filas, con el signo normalizado para que no se
  // cancelen las que vienen con las picas al reves en el Excel.
  let ux = 0, uy = 0;
  for (const r of rows) {
    const a = toLocal(frame, r.start.lat, r.start.lon);
    const b = toLocal(frame, r.end.lat, r.end.lon);
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const s = dy >= 0 ? 1 : -1;
    ux += (dx / len) * s;
    uy += (dy / len) * s;
  }
  const n = Math.hypot(ux, uy) || 1;
  ux /= n; uy /= n;

  // Eje de vuelo y su perpendicular.
  const [fx, fy] = opts.alongRows ? [ux, uy] : [-uy, ux];
  const [px, py] = [-fy, fx];

  const along = puntas.map((p) => p.x * fx + p.y * fy);
  const across = puntas.map((p) => p.x * px + p.y * py);
  const a0 = Math.min(...along) - opts.marginM;
  const a1 = Math.max(...along) + opts.marginM;
  const c0 = Math.min(...across) - opts.marginM;
  const c1 = Math.max(...across) + opts.marginM;

  const anchoHuella = huella(opts.altitudeM, opts.camera.hfovDeg);
  const largoHuella = huella(opts.altitudeM, opts.camera.vfovDeg);
  const separacion = Math.max(0.5, anchoHuella * (1 - opts.sideOverlap));
  const disparoCada = Math.max(0.5, largoHuella * (1 - opts.frontOverlap));

  const cantidad = Math.max(1, Math.ceil((c1 - c0) / separacion) + 1);
  // Centrar las lineas dentro del area en vez de arrancar pegado al borde.
  const sobra = (cantidad - 1) * separacion - (c1 - c0);
  const inicio = c0 - sobra / 2;

  const lines: MissionLine[] = [];
  const waypoints: LatLon[] = [];
  for (let i = 0; i < cantidad; i++) {
    const c = inicio + i * separacion;
    // Serpenteo: cada linea al reves de la anterior, para no volver en vacio.
    const [d0, d1] = i % 2 === 0 ? [a0, a1] : [a1, a0];
    const A = toGeo(frame, fx * d0 + px * c, fy * d0 + py * c);
    const B = toGeo(frame, fx * d1 + px * c, fy * d1 + py * c);
    lines.push({ a: A, b: B, largoM: Math.abs(a1 - a0) });
    waypoints.push(A, B);
  }

  const largoLinea = a1 - a0;
  const distancia = cantidad * largoLinea + (cantidad - 1) * separacion;
  const fotos = cantidad * (Math.floor(largoLinea / disparoCada) + 1);
  // Los giros no son gratis: se asume medio minuto por giro entre lineas.
  const minutos = distancia / opts.speedMps / 60 + ((cantidad - 1) * 30) / 60;

  const gsdCm = (anchoHuella * 100) / opts.camera.imageW;
  const pasoModulo = profile.module.widthMm / 1000;
  const pixelesPorModulo = pasoModulo / (gsdCm / 100);

  const avisos: string[] = [];
  if (gsdCm > GSD_MAXIMO_CM) {
    avisos.push(
      `A ${gsdCm.toFixed(1)} cm por pixel, una celda de 16 cm entra en ${(16 / gsdCm).toFixed(1)} ` +
      `pixeles. Un punto caliente de una sola celda no se va a distinguir del ruido. ` +
      `(El modulo entero igual da ${pixelesPorModulo.toFixed(0)} pixeles, que es el numero que ` +
      `engaña: lo que hay que resolver es la celda.) Bajá a ` +
      // Hacia ABAJO, no al entero mas cercano. Redondeando al mas cercano el
      // consejo se pasa de largo: a 70 m decia "bajá a 38" y a 38 m volvia a
      // avisar. Un consejo que, seguido al pie de la letra, sigue quejandose
      // no es un consejo — es ruido, y el que lo lee deja de leer los avisos.
      `${Math.floor(opts.altitudeM * GSD_MAXIMO_CM / gsdCm)} m o menos.`,
    );
  }
  // Sin RTK el dron se va metros de la linea, y el solape tiene que absorberlo.
  if (!opts.rtk && opts.sideOverlap < 0.6) {
    avisos.push(
      `Con ${Math.round(opts.sideOverlap * 100)} % de solape lateral y sin RTK las lineas quedan ` +
      `justas: el dron se puede ir varios metros y dejar huecos sin cubrir. Un hueco no se nota ` +
      `hasta que buscás un panel y no hay foto.`,
    );
  }
  if (opts.rtk && opts.sideOverlap < 0.3) {
    avisos.push(
      `${Math.round(opts.sideOverlap * 100)} % de solape es poco incluso con RTK: el terreno ` +
      `desparejo cambia la altura y con ella el ancho de la franja.`,
    );
  }
  if (minutos > 20) {
    avisos.push(
      `Son ${minutos.toFixed(0)} minutos de vuelo: no entra en una bateria. Hay que partirlo por ` +
      `bloques o llevar repuestos.`,
    );
  }

  return {
    lines,
    waypoints,
    stats: {
      lineas: cantidad,
      separacionM: separacion,
      disparoCadaM: disparoCada,
      fotos,
      distanciaM: distancia,
      minutos,
      gsdCm,
      pixelesPorModulo,
      huellaAnchoM: anchoHuella,
      huellaLargoM: largoHuella,
      avisos,
    },
  };
}

// ---------------------------------------------------------------------------
// Exportacion
// ---------------------------------------------------------------------------

/** KML: se abre en Google Earth y lo importan casi todas las apps de vuelo. */
export function toKml(mission: Mission, nombre: string): string {
  const coords = mission.waypoints.map((w) => `${w.lon},${w.lat},0`).join(" ");
  const lineas = mission.lines
    .map(
      (l, i) =>
        `    <Placemark><name>Linea ${i + 1}</name><LineString><coordinates>` +
        `${l.a.lon},${l.a.lat},0 ${l.b.lon},${l.b.lat},0` +
        `</coordinates></LineString></Placemark>`,
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${escapeXml(nombre)}</name>
    <Placemark><name>Recorrido</name><LineString><tessellate>1</tessellate>
      <coordinates>${coords}</coordinates>
    </LineString></Placemark>
${lineas}
  </Document>
</kml>`;
}

const escapeXml = (s: string) =>
  s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c]!));

/** Lista de waypoints en CSV, que es lo que come casi cualquier planificador. */
export function toWaypointCsv(mission: Mission, opts: MissionOptions): string {
  const head = ["n", "latitud", "longitud", "altura_m", "velocidad_mps", "gimbal_grados"];
  const lines = [head.join(",")];
  mission.waypoints.forEach((w, i) => {
    // -90 es mirando derecho para abajo, que es lo unico que sirve para mapear.
    lines.push([i + 1, w.lat, w.lon, opts.altitudeM, opts.speedMps, -90].join(","));
  });
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Por bloque
// ---------------------------------------------------------------------------

/**
 * Un parque entero no es una mision: es un proyecto.
 *
 * Edenvale son 23 horas de vuelo. Nadie vuela eso de un saque — la empresa que
 * lo hizo tardo cuatro dias. La unidad util no es la farm sino el BLOQUE, y no
 * por una razon tecnica sino porque es la unidad en la que ya piensa todo el
 * mundo en la planta: los bloques tienen nombre, los defectos se reportan por
 * bloque y la cuadrilla trabaja por bloque.
 *
 * Ademas un bloque entra en una o dos baterias, que es la otra unidad real.
 */

export interface BlockPlan {
  block: string;
  filas: number;
  mission: Mission;
  baterias: number;
}

export interface BlockPlanSet {
  bloques: BlockPlan[];
  totalMinutos: number;
  totalFotos: number;
  totalBaterias: number;
  /** Cuantas salidas de campo, si en cada una se llevan las baterias que hay. */
  salidas: number;
}

/** Minutos de vuelo util por bateria, ya descontada la reserva y el traslado. */
export const MINUTOS_POR_BATERIA = 20;

export function planByBlock(
  rows: TrackerRow[],
  profile: FarmProfile,
  opts: MissionOptions,
  bateriasDisponibles = 4,
): BlockPlanSet {
  const porBloque = new Map<string, TrackerRow[]>();
  for (const r of rows) porBloque.set(r.block, [...(porBloque.get(r.block) ?? []), r]);

  const bloques: BlockPlan[] = [];
  for (const [block, group] of [...porBloque.entries()].sort((a, b) =>
    a[0].localeCompare(b[0], undefined, { numeric: true }),
  )) {
    const mission = planMission(group, profile, opts);
    if (!mission) continue;
    bloques.push({
      block,
      filas: group.length,
      mission,
      baterias: Math.max(1, Math.ceil(mission.stats.minutos / MINUTOS_POR_BATERIA)),
    });
  }

  const totalMinutos = bloques.reduce((s, b) => s + b.mission.stats.minutos, 0);
  const totalBaterias = bloques.reduce((s, b) => s + b.baterias, 0);

  return {
    bloques,
    totalMinutos,
    totalFotos: bloques.reduce((s, b) => s + b.mission.stats.fotos, 0),
    totalBaterias,
    salidas: Math.max(1, Math.ceil(totalBaterias / Math.max(1, bateriasDisponibles))),
  };
}

// ---------------------------------------------------------------------------
// Bloques que se pisan
// ---------------------------------------------------------------------------

/**
 * Eje de vuelo y su perpendicular, en el marco local del parque.
 *
 * Se saca aparte porque lo necesitan tanto la planificacion como la deteccion
 * de bloques que se solapan, y calcularlo dos veces por separado es como se
 * desincronizan las cosas.
 */
function ejeDe(rows: TrackerRow[], frame: ReturnType<typeof makeFrame>, alongRows: boolean) {
  let ux = 0, uy = 0;
  for (const r of rows) {
    const a = toLocal(frame, r.start.lat, r.start.lon);
    const b = toLocal(frame, r.end.lat, r.end.lon);
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const s = dy >= 0 ? 1 : -1;
    ux += (dx / len) * s;
    uy += (dy / len) * s;
  }
  const n = Math.hypot(ux, uy) || 1;
  ux /= n; uy /= n;
  const [fx, fy] = alongRows ? [ux, uy] : [-uy, ux];
  return { fx, fy, px: -fy, py: fx };
}

/** Cuanto ocupa un bloque sobre el eje perpendicular al vuelo. */
function franjaDe(
  rows: TrackerRow[],
  frame: ReturnType<typeof makeFrame>,
  eje: ReturnType<typeof ejeDe>,
): { min: number; max: number } {
  const v = rows.flatMap((r) => [
    toLocal(frame, r.start.lat, r.start.lon),
    toLocal(frame, r.end.lat, r.end.lon),
  ]).map((p) => p.x * eje.px + p.y * eje.py);
  return { min: Math.min(...v), max: Math.max(...v) };
}

export interface GrupoDeVuelo {
  /** Los bloques que se vuelan juntos. */
  bloques: string[];
  filas: number;
  mission: Mission;
  baterias: number;
}

export interface PlanAgrupado {
  grupos: GrupoDeVuelo[];
  totalMinutos: number;
  totalBaterias: number;
  salidas: number;
  /** Cuantos bloques quedaron pegados a otro por pisarse. */
  bloquesAgrupados: number;
  /** Minutos que se ahorran contra volar bloque por bloque. */
  ahorroMinutos: number;
}

/**
 * Agrupa los bloques que comparten pasada.
 *
 * Los bloques de una planta no son rectangulos prolijos: se escalonan y se
 * meten unos entre otros. Cuando dos bloques ocupan la misma franja
 * perpendicular al vuelo, volarlos por separado repite las mismas pasadas dos
 * veces — y sumando los 36 bloques esa repeticion infla el total.
 *
 * Volarlos juntos no pierde nada: la unidad de REPORTE sigue siendo el bloque,
 * porque cada foto se ubica sola contra la geometria. Lo unico que cambia es
 * que el dron no pasa dos veces por el mismo lugar.
 */
export function planByGroup(
  rows: TrackerRow[],
  profile: FarmProfile,
  opts: MissionOptions,
  bateriasDisponibles = 4,
): PlanAgrupado {
  const porBloque = new Map<string, TrackerRow[]>();
  for (const r of rows) porBloque.set(r.block, [...(porBloque.get(r.block) ?? []), r]);
  const bloques = [...porBloque.keys()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  if (!rows.length) {
    return { grupos: [], totalMinutos: 0, totalBaterias: 0, salidas: 1, bloquesAgrupados: 0, ahorroMinutos: 0 };
  }

  const frame = makeFrame(rows[0]!.start.lat, rows[0]!.start.lon);
  const eje = ejeDe(rows, frame, opts.alongRows);
  const franjas = new Map(bloques.map((b) => [b, franjaDe(porBloque.get(b)!, frame, eje)]));

  // Union-find sobre "comparten franja". Dos bloques que se pisan sobre el eje
  // perpendicular comparten pasadas, y volarlos aparte las repite.
  const padre = new Map(bloques.map((b) => [b, b]));
  const raiz = (b: string): string => {
    let x = b;
    while (padre.get(x) !== x) x = padre.get(x)!;
    return x;
  };
  for (let i = 0; i < bloques.length; i++) {
    for (let j = i + 1; j < bloques.length; j++) {
      const a = franjas.get(bloques[i]!)!;
      const c = franjas.get(bloques[j]!)!;
      const solape = Math.min(a.max, c.max) - Math.max(a.min, c.min);
      // Se agrupan solo si el solape es una parte real del bloque mas chico:
      // rozarse por un metro no justifica juntarlos.
      const menor = Math.min(a.max - a.min, c.max - c.min);
      if (solape > Math.max(opts.marginM, menor * 0.25)) {
        padre.set(raiz(bloques[i]!), raiz(bloques[j]!));
      }
    }
  }

  const juntos = new Map<string, string[]>();
  for (const b of bloques) {
    const r = raiz(b);
    juntos.set(r, [...(juntos.get(r) ?? []), b]);
  }

  const grupos: GrupoDeVuelo[] = [];
  for (const lista of [...juntos.values()].sort((a, b) =>
    a[0]!.localeCompare(b[0]!, undefined, { numeric: true }),
  )) {
    const filas = lista.flatMap((b) => porBloque.get(b)!);
    const mission = planMission(filas, profile, opts);
    if (!mission) continue;
    grupos.push({
      bloques: lista,
      filas: filas.length,
      mission,
      baterias: Math.max(1, Math.ceil(mission.stats.minutos / MINUTOS_POR_BATERIA)),
    });
  }

  const totalMinutos = grupos.reduce((s, g) => s + g.mission.stats.minutos, 0);
  const totalBaterias = grupos.reduce((s, g) => s + g.baterias, 0);
  const sueltos = planByBlock(rows, profile, opts, bateriasDisponibles);

  return {
    grupos,
    totalMinutos,
    totalBaterias,
    salidas: Math.max(1, Math.ceil(totalBaterias / Math.max(1, bateriasDisponibles))),
    bloquesAgrupados: grupos.filter((g) => g.bloques.length > 1).reduce((s, g) => s + g.bloques.length, 0),
    ahorroMinutos: sueltos.totalMinutos - totalMinutos,
  };
}
