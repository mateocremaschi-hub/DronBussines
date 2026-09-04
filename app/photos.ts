/**
 * Lectura de fotos: coordenada, momento y miniatura.
 *
 * Una foto de dron o de celular trae el GPS adentro, en los metadatos EXIF.
 * Eso es lo que convierte un vuelo en un lote de hallazgos sin que nadie
 * transcriba coordenadas a mano.
 *
 * Regla de esta capa: una foto sin GPS no rompe el lote. Se marca con el motivo
 * y sigue el resto — en un vuelo de 400 fotos siempre hay alguna rara, y
 * abortar todo por una es inaceptable.
 */

export interface PhotoFix {
  fileName: string;
  lat: number;
  lon: number;
  /** Error declarado por la camara, si lo escribe. Los equipos RTK suelen hacerlo. */
  accuracyM?: number;
  altitudeM?: number;
  takenAt?: string;
  /** Miniatura en data URI, para revisar sin volver a abrir el archivo. */
  thumb?: string;

  /** Angulo del gimbal. -90 es mirando derecho para abajo. */
  gimbalPitchDeg?: number;
  /** Rumbo de la camara. 0 es al norte. */
  gimbalYawDeg?: number;
  /**
   * Distancia focal equivalente a 35 mm, que trae toda camara en el EXIF.
   *
   * Es lo que permite calcular el campo de vision exacto SIN depender de la
   * ficha del fabricante — que publica el angulo diagonal y que las paginas de
   * terceros copian mal. Verificado con fotos reales: la visible del M3T
   * declara 24 mm y da los 84 grados que publica DJI.
   */
  equiv35mm?: number;
  imageW?: number;
  imageH?: number;
  /** "InfraredCamera" o "WideCamera" en los DJI. Distingue la termica. */
  sensor?: string;
  /** Altura sobre el punto de despegue, que es lo que escriben los DJI. */
  relativeAltitudeM?: number;
  /**
   * Lo que midio el telemetro laser hasta lo que hay debajo, en metros.
   *
   * El Matrice 4T lo trae y lo escribe en cada foto, y es exactamente el numero
   * que necesita la huella: la distancia de la camara a los paneles. La altura
   * relativa del EXIF no es eso — es la altura sobre el PUNTO DE DESPEGUE, que
   * puede estar varios metros mas abajo. En el vuelo del bloque 1 de Wellington
   * el EXIF decia 52 m y el laser 46.9: cinco metros de diferencia, el 11 % de
   * la escala, y 593 hallazgos falsos.
   */
  laserM?: number;
  /**
   * Si esta foto se posiciono con RTK fijo.
   *
   * Cambia por completo la lectura de lo que sigue. Sin RTK, un corrimiento de
   * uno o dos metros es el GPS del dron y no hay nada que hacer. Con RTK fijo
   * la posicion tiene milimetros —en el vuelo del bloque 1, sigma de 2 mm— asi
   * que un corrimiento de un metro NO es el dron: es la geometria del parque
   * que no coincide con lo que hay en el campo, y eso se arregla una vez.
   */
  rtkFijo?: boolean;
  /**
   * Cuanto se corre el punto fotografiado por no estar la camara a plomo.
   *
   * La coordenada de la foto es la del DRON. Solo coincide con lo que se ve
   * abajo si el gimbal apunta derecho para abajo. Inclinado, el punto que
   * quedo en el centro del cuadro esta a `altura x tan(desvio)` de distancia
   * horizontal — y siempre para el mismo lado, que es lo que lo hace peligroso.
   * A 30 m de altura, 5 grados son 2.6 m: mas de dos modulos.
   */
  tiltOffsetM?: number;
}

export interface PhotoRead {
  fileName: string;
  fix?: PhotoFix;
  error?: string;
}

/** Lado mayor de la miniatura que se guarda con cada hallazgo. */
const THUMB_PX = 360;

/** Desvio del gimbal respecto de mirar derecho para abajo, en grados. */
export function offNadirDeg(pitchDeg: number | undefined | null): number | undefined {
  if (pitchDeg == null || !Number.isFinite(pitchDeg)) return undefined;
  return Math.abs(90 - Math.abs(pitchDeg));
}

/**
 * Cuanto se corre el punto fotografiado, por altura y desvio del gimbal.
 *
 * Es geometria de secundaria —cateto opuesto— pero es la diferencia entre
 * ubicar el modulo y ubicar el de tres mas alla.
 */
export function tiltOffsetM(alturaM: number, desvioDeg: number): number {
  return alturaM * Math.tan((desvioDeg * Math.PI) / 180);
}

function firstNumber(meta: Record<string, unknown>, claves: string[]): number | undefined {
  for (const k of claves) {
    const v = meta[k];
    const n = typeof v === "string" ? Number(v) : v;
    if (typeof n === "number" && Number.isFinite(n)) return n;
  }
  return undefined;
}

export async function readPhoto(
  file: File,
  /**
   * Generar la miniatura o no.
   *
   * Se generaba SIEMPRE, y la pantalla de analisis —la que procesa las 400
   * fotos del vuelo— nunca la usa: decodifica la foto entera, la dibuja en un
   * canvas y la vuelve a comprimir a JPEG, por foto, para tirarla. En un
   * telefono eso son varios minutos de vuelo perdidos y memoria que despues
   * falta para la matriz de temperaturas.
   *
   * La pantalla de inspecciones si la muestra, asi que ahi sigue en true.
   */
  conMiniatura = true,
): Promise<PhotoRead> {
  let gps: { latitude?: number; longitude?: number } | undefined;
  let meta: Record<string, unknown> = {};

  try {
    const exifr = await import("exifr");
    gps = (await exifr.gps(file)) ?? undefined;
    meta = ((await exifr.parse(file, [
      "DateTimeOriginal",
      "CreateDate",
      "GPSAltitude",
      "GPSHPositioningError",
      "FocalLengthIn35mmFormat",
      "ExifImageWidth",
      "ExifImageHeight",
      "Make",
      "Model",
    ])) ?? {}) as Record<string, unknown>;

    // Los DJI escriben el angulo del gimbal y la altura en el XMP, no en EXIF.
    //
    // `chunked: false` no es un detalle: por defecto se lee solo el arranque
    // del archivo, y en una foto termica el XMP puede quedar detras de los
    // 650 kB de datos de temperatura. Sin esto el gimbal y la altura se
    // pierden en silencio y la proyeccion queda sin altura.
    try {
      // `chunked` no esta en los tipos de la libreria pero si en su API.
      const opciones = { xmp: true, tiff: false, exif: false, gps: false, chunked: false };
      const xmp = (await exifr.parse(file, opciones as Parameters<typeof exifr.parse>[1])) as
        | Record<string, unknown>
        | undefined;
      if (xmp) meta = { ...xmp, ...meta };
    } catch {
      // Sin XMP se sigue igual: se pierde el chequeo del gimbal, no la foto.
    }
  } catch (e) {
    return {
      fileName: file.name,
      error: `No pude leer los metadatos: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  if (gps?.latitude == null || gps.longitude == null) {
    return {
      fileName: file.name,
      error:
        "La foto no trae coordenada GPS. Fijate que la camara tuviera el GPS activado, " +
        "y que el archivo no haya pasado por algo que borre los metadatos (WhatsApp los saca).",
    };
  }

  const fix: PhotoFix = { fileName: file.name, lat: gps.latitude, lon: gps.longitude };

  const err = meta["GPSHPositioningError"];
  if (typeof err === "number" && Number.isFinite(err) && err > 0) fix.accuracyM = err;

  const alt = meta["GPSAltitude"];
  if (typeof alt === "number" && Number.isFinite(alt)) fix.altitudeM = alt;

  const when = meta["DateTimeOriginal"] ?? meta["CreateDate"];
  if (when instanceof Date && !Number.isNaN(when.getTime())) fix.takenAt = when.toISOString();

  // Cada fabricante lo nombra distinto; se prueban las formas conocidas.
  const pitch = firstNumber(meta, [
    "GimbalPitchDegree", "drone-dji:GimbalPitchDegree", "GimbalPitch", "CameraPitch",
  ]);
  const yaw = firstNumber(meta, [
    "GimbalYawDegree", "drone-dji:GimbalYawDegree", "GimbalYaw",
  ]);
  const eq = firstNumber(meta, ["FocalLengthIn35mmFormat", "FocalLengthIn35mmFilm"]);
  const iw = firstNumber(meta, ["ExifImageWidth", "ImageWidth"]);
  const ih = firstNumber(meta, ["ExifImageHeight", "ImageHeight"]);
  const src = meta["ImageSource"] ?? meta["drone-dji:ImageSource"];

  if (yaw != null) fix.gimbalYawDeg = yaw;
  if (eq != null && eq > 0) fix.equiv35mm = eq;
  if (iw != null && iw > 0) fix.imageW = iw;
  if (ih != null && ih > 0) fix.imageH = ih;
  if (typeof src === "string" && src) fix.sensor = src;
  const relAlt = firstNumber(meta, [
    "RelativeAltitude", "drone-dji:RelativeAltitude", "AboveGroundAltitude",
  ]);
  if (pitch != null) fix.gimbalPitchDeg = pitch;
  if (relAlt != null) fix.relativeAltitudeM = Math.abs(relAlt);

  /*
    RTK fijo. DJI lo dice de dos maneras y se aceptan las dos: `GpsStatus` en
    "RTK" y `RtkFlag` en 50, que es el codigo de solucion fija (16 es GPS
    suelto y 34 es flotante, y ninguno de los dos da centimetros).
  */
  const rtkFlag = firstNumber(meta, ["RtkFlag", "drone-dji:RtkFlag"]);
  const gpsStatus = meta["GpsStatus"] ?? meta["drone-dji:GpsStatus"];
  if (rtkFlag === 50 || gpsStatus === "RTK") fix.rtkFijo = true;

  /*
    El telemetro laser, cuando la camara lo tiene y dio una lectura buena.

    `LRFStatus` dice si la lectura sirve: fuera de rango escribe "TooFar" y deja
    la distancia en cero. Un cero pasando por altura pondria la huella en cero
    metros, asi que se descarta explicitamente en vez de confiar en el estado.
  */
  const laser = firstNumber(meta, ["LRFTargetDistance", "drone-dji:LRFTargetDistance"]);
  const estado = meta["LRFStatus"] ?? meta["drone-dji:LRFStatus"];
  if (laser != null && laser > 1 && (estado == null || estado === "Normal")) {
    fix.laserM = laser;
  }

  const off = offNadirDeg(pitch);
  if (off != null && fix.relativeAltitudeM != null) {
    fix.tiltOffsetM = fix.relativeAltitudeM * Math.tan((off * Math.PI) / 180);
  }

  if (conMiniatura) {
    const thumb = await makeThumb(file);
    if (thumb) fix.thumb = thumb;
  }

  return { fileName: file.name, fix };
}

/**
 * Miniatura chica en JPEG.
 *
 * Se guarda la miniatura y no la foto entera a proposito: 400 hallazgos con su
 * miniatura son unos pocos MB y entran en el dispositivo; con las fotos
 * originales serian varios GB.
 */
async function makeThumb(file: File): Promise<string | undefined> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = THUMB_PX / Math.max(bitmap.width, bitmap.height);
    const w = Math.max(1, Math.round(bitmap.width * Math.min(1, scale)));
    const h = Math.max(1, Math.round(bitmap.height * Math.min(1, scale)));

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined;
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    return canvas.toDataURL("image/jpeg", 0.7);
  } catch {
    // Una miniatura que no sale no invalida el hallazgo.
    return undefined;
  }
}
