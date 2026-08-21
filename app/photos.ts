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
}

export interface PhotoRead {
  fileName: string;
  fix?: PhotoFix;
  error?: string;
}

/** Lado mayor de la miniatura que se guarda con cada hallazgo. */
const THUMB_PX = 360;

export async function readPhoto(file: File): Promise<PhotoRead> {
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
    ])) ?? {}) as Record<string, unknown>;
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

  const thumb = await makeThumb(file);
  if (thumb) fix.thumb = thumb;

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
