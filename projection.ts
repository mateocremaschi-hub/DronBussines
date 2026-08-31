/**
 * Donde cae cada foto sobre el parque.
 *
 * Esta es la pieza que reemplaza al ortomosaico. Un procesador
 * fotogrametrico reconstruye la geometria del terreno desde cero porque no
 * sabe que esta mirando: tarda horas y cuesta plata. Aca no hace falta, por
 * dos motivos que valen para cualquier solar farm:
 *
 *   - El terreno es un plano. Los modulos estan todos a la misma altura.
 *   - Ese plano ya esta medido. Las picas del relevamiento dicen exactamente
 *     donde esta cada fila.
 *
 * Entonces ubicar una foto es trigonometria: con la posicion del dron, la
 * altura y hacia donde apuntaba la camara, la huella en el suelo sale de una.
 *
 * Lo que NO hace, y conviene tenerlo claro: no corrige el terreno, no une las
 * fotos con costura fina, y hereda entero el error del GPS del dron. Sirve de
 * fondo para mirar, no de fuente de coordenadas — la coordenada sale de la
 * geometria del parque, que es la que esta verificada.
 */

import { toLocal } from "@locator";
import type { LocalFrame } from "@locator";
import type { Camera } from "./mission";

const RAD = Math.PI / 180;

export interface Point {
  x: number;
  y: number;
}

/** Como estaba el dron y la camara cuando disparo. */
export interface PhotoPose {
  lat: number;
  lon: number;
  /** Altura sobre el terreno, en metros. */
  altitudeAglM: number;
  /** Hacia donde miraba la camara. 0 = norte, 90 = este. */
  gimbalYawDeg?: number;
  /** -90 es derecho para abajo. */
  gimbalPitchDeg?: number;
}

export interface Footprint {
  /** Las cuatro esquinas en el marco local, en metros: NO, NE, SE, SO de la imagen. */
  corners: [Point, Point, Point, Point];
  centre: Point;
  anchoM: number;
  altoM: number;
  /** Rotacion de la imagen respecto del norte, en grados. */
  rotacionDeg: number;
  /** Cuanto se corrio el centro por tener el gimbal inclinado. */
  tiltOffsetM: number;
  /**
   * Si se puede confiar en la huella como rectangulo.
   *
   * Con la camara a plomo la huella ES un rectangulo. Inclinada se convierte
   * en un trapecio, y aproximarla con un rectangulo corrido deja de servir.
   */
  confiable: boolean;
  /**
   * Que datos de la foto faltaban y se rellenaron con un supuesto.
   *
   * Va en plata: una huella "confiable" con el rumbo inventado ubica los
   * modulos en la fila de al lado, y el hallazgo sale con la misma confianza
   * que uno bueno.
   */
  faltantes: string[];
}

/** Desvio maximo del gimbal, en grados, para seguir tratando la huella como rectangulo. */
export const DESVIO_MAXIMO_DEG = 10;

export function footprint(frame: LocalFrame, pose: PhotoPose, camera: Camera): Footprint {
  const p = toLocal(frame, pose.lat, pose.lon);
  const h = Math.max(0.1, pose.altitudeAglM);

  const ancho = 2 * h * Math.tan((camera.hfovDeg * RAD) / 2);
  const alto = 2 * h * Math.tan((camera.vfovDeg * RAD) / 2);

  /**
   * Lo que falta NO se reemplaza en silencio.
   *
   * Sin rumbo del gimbal se asumia norte-arriba, y volando hacia el este eso
   * gira la huella 90 grados: en un cuadro de 42 x 34 m los modulos del borde
   * se van hasta 27 m, o sea a la fila de al lado. Sin angulo del gimbal se
   * asumia nadir perfecto Y ADEMAS se marcaba la huella como confiable.
   *
   * Ahora los dos casos quedan marcados. `confiable` era un campo que nadie
   * leia: existia, se testeaba, y no frenaba nada.
   */
  const sinYaw = pose.gimbalYawDeg == null;
  const sinPitch = pose.gimbalPitchDeg == null;

  const yaw = pose.gimbalYawDeg ?? 0;
  const pitch = pose.gimbalPitchDeg;
  const desvio = pitch == null ? 0 : Math.abs(90 - Math.abs(pitch));
  const tiltOffsetM = h * Math.tan(desvio * RAD);

  const faltantes: string[] = [];
  if (sinYaw) {
    faltantes.push(
      "la foto no trae el rumbo del gimbal, asi que se la ubica como si mirara al norte: " +
      "si el vuelo no era norte-sur, la huella esta girada y los modulos del borde caen en " +
      "otra fila",
    );
  }
  if (sinPitch) {
    faltantes.push(
      "la foto no trae el angulo del gimbal, asi que se la ubica como si estuviera a plomo: " +
      "con la camara inclinada el centro se corre la altura por la tangente del desvio",
    );
  }

  // La camara inclinada mira hacia adelante: el centro de la foto se corre en
  // la direccion en la que apunta.
  const centre: Point = {
    x: p.x + tiltOffsetM * Math.sin(yaw * RAD),
    y: p.y + tiltOffsetM * Math.cos(yaw * RAD),
  };

  // El eje "arriba" de la imagen apunta hacia el rumbo del gimbal.
  const cy = Math.cos(yaw * RAD), sy = Math.sin(yaw * RAD);
  const up = { x: sy, y: cy };
  const right = { x: cy, y: -sy };

  const esquina = (dx: number, dy: number): Point => ({
    x: centre.x + right.x * dx + up.x * dy,
    y: centre.y + right.y * dx + up.y * dy,
  });

  return {
    corners: [
      esquina(-ancho / 2, alto / 2),
      esquina(ancho / 2, alto / 2),
      esquina(ancho / 2, -alto / 2),
      esquina(-ancho / 2, -alto / 2),
    ],
    centre,
    anchoM: ancho,
    altoM: alto,
    rotacionDeg: yaw,
    tiltOffsetM,
    confiable: !sinYaw && !sinPitch && desvio <= DESVIO_MAXIMO_DEG,
    faltantes,
  };
}

// ---------------------------------------------------------------------------
// De la foto al terreno y de vuelta
// ---------------------------------------------------------------------------

/**
 * En que pixel de la foto cae un punto del terreno.
 *
 * Es lo que permite recortar el modulo de la imagen: se sabe donde esta el
 * modulo, se busca que foto lo cubre, y se pide su recorte. Nadie tiene que
 * mirar la foto entera para encontrar un panel.
 *
 * Devuelve null si el punto queda fuera del cuadro.
 */
export function pixelOf(f: Footprint, punto: Point, camera: Camera): { px: number; py: number } | null {
  const dx = punto.x - f.centre.x;
  const dy = punto.y - f.centre.y;

  const yaw = f.rotacionDeg * RAD;
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  // Proyeccion sobre los ejes de la imagen.
  const u = dx * cy - dy * sy;   // derecha en la imagen
  const v = dx * sy + dy * cy;   // arriba en la imagen

  if (Math.abs(u) > f.anchoM / 2 || Math.abs(v) > f.altoM / 2) return null;

  return {
    px: (u / f.anchoM + 0.5) * camera.imageW,
    // El eje Y de una imagen crece hacia abajo.
    py: (0.5 - v / f.altoM) * camera.imageH,
  };
}

/** Si el punto cae dentro del cuadro de la foto. */
export function cubre(f: Footprint, punto: Point, camera: Camera): boolean {
  return pixelOf(f, punto, camera) != null;
}

export interface Cobertura<T> {
  foto: T;
  huella: Footprint;
  /** Distancia del punto al centro de la foto, en metros. */
  distanciaAlCentroM: number;
}

/**
 * Que fotos cubren un punto, la mejor primero.
 *
 * "Mejor" es la que lo tiene mas cerca del centro del cuadro. Con 80 % de
 * solape un mismo modulo aparece en varias fotos, y no dan lo mismo: en el
 * borde del cuadro la camara lo ve de costado, con mas distorsion y —en
 * termica— con la temperatura afectada por el angulo de vision.
 */
export function fotosQueCubren<T>(
  punto: Point,
  fotos: Array<{ foto: T; huella: Footprint }>,
  camera: Camera,
): Array<Cobertura<T>> {
  const out: Array<Cobertura<T>> = [];
  for (const { foto, huella } of fotos) {
    if (!cubre(huella, punto, camera)) continue;
    out.push({
      foto,
      huella,
      distanciaAlCentroM: Math.hypot(punto.x - huella.centre.x, punto.y - huella.centre.y),
    });
  }
  return out.sort((a, b) => a.distanciaAlCentroM - b.distanciaAlCentroM);
}

// ---------------------------------------------------------------------------
// Ajuste manual
// ---------------------------------------------------------------------------

/**
 * Corrimiento comun a todas las fotos de un vuelo.
 *
 * El GPS del dron se equivoca parejo: todo el vuelo corrido para el mismo
 * lado. Eso, que suele ser invisible, aca se VE — las fotos no coinciden con
 * la grilla de modulos — y se arregla con un solo arrastre para el vuelo
 * entero, en vez de corregir hallazgo por hallazgo.
 */
export interface Ajuste {
  dxM: number;
  dyM: number;
}

export const SIN_AJUSTE: Ajuste = { dxM: 0, dyM: 0 };

export function aplicarAjuste(f: Footprint, a: Ajuste): Footprint {
  if (a.dxM === 0 && a.dyM === 0) return f;
  const mover = (p: Point): Point => ({ x: p.x + a.dxM, y: p.y + a.dyM });
  return {
    ...f,
    centre: mover(f.centre),
    corners: [mover(f.corners[0]), mover(f.corners[1]), mover(f.corners[2]), mover(f.corners[3])],
  };
}
