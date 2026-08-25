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
 * Presets orientativos. HAY QUE VERIFICARLOS contra la ficha de la camara
 * antes de volar: un campo de vision mal cargado se traduce en huecos entre
 * lineas, y los huecos no se ven hasta que se busca un panel y no esta.
 */
export const CAMARAS: Camera[] = [
  { name: "Termica 640x512 · 61° (tipo M3T / M30T)", imageW: 640, imageH: 512, hfovDeg: 61, vfovDeg: 48 },
  { name: "Termica 640x512 · 45°", imageW: 640, imageH: 512, hfovDeg: 45, vfovDeg: 37 },
  { name: "Visible 4000x3000 · 84°", imageW: 4000, imageH: 3000, hfovDeg: 84, vfovDeg: 68 },
];

const RAD = Math.PI / 180;
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
}

export const OPCIONES_POR_DEFECTO: Omit<MissionOptions, "camera"> = {
  altitudeM: 40,
  frontOverlap: 0.8,
  sideOverlap: 0.7,
  speedMps: 5,
  marginM: 10,
  alongRows: true,
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

/** Pixeles de ancho por modulo por debajo de los cuales no se distingue una celda. */
const PIXELES_MINIMOS = 8;

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
  if (pixelesPorModulo < PIXELES_MINIMOS) {
    avisos.push(
      `Cada modulo va a ocupar ${pixelesPorModulo.toFixed(1)} pixeles de ancho. Es poco: un punto ` +
      `caliente de una sola celda no se va a distinguir del ruido. Bajá la altura o usá una camara ` +
      `de mas resolucion.`,
    );
  }
  if (opts.sideOverlap < 0.6) {
    avisos.push(
      `Con ${Math.round(opts.sideOverlap * 100)} % de solape lateral las lineas quedan justas. Si el ` +
      `viento corre el dron, quedan huecos sin cubrir — y un hueco no se nota hasta que buscás un ` +
      `panel y no esta.`,
    );
  }
  if (opts.frontOverlap < 0.7) {
    avisos.push(`El solape frontal de ${Math.round(opts.frontOverlap * 100)} % es bajo para termica.`);
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
