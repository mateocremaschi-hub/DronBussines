/**
 * Un escritor de ZIP mínimo, sin comprimir.
 *
 * Hace falta porque un KMZ es un ZIP y DJI no acepta otra cosa. Se escribe a
 * mano en vez de sumar una librería por dos razones: son noventa líneas, y
 * sobre todo porque asi la prueba puede verificar los bytes exactos — que las
 * rutas adentro del archivo sean `wpmz/template.kml` y `wpmz/waylines.wpml` y
 * no otra cosa es lo unico que decide si el dron lee la mision o la rechaza.
 *
 * Se guarda sin comprimir (metodo 0, "store"). El formato ZIP lo define desde
 * la primera version y lo lee cualquier implementacion, incluida la de
 * Android que usa DJI Pilot. Los dos archivos de una mision son texto de unos
 * pocos cientos de kilobytes, asi que comprimir no compraria nada y costaria
 * una dependencia mas.
 */

export interface EntradaZip {
  /** Ruta adentro del archivo, con barras normales. */
  ruta: string;
  /**
   * Texto —una mision es KML— o bytes crudos, para las fotos.
   *
   * Los bytes importan: la entrega al cliente incluye un ZIP con la foto de
   * cada defecto. Si un JPEG entra por aca como texto, se le aplica
   * `TextEncoder` a un arreglo de numeros y adentro del ZIP queda la cadena
   * "255,216,255,..." en vez de la foto. El ZIP abre igual y los archivos
   * estan todos, con el nombre correcto — solo que ninguno se puede ver.
   */
  contenido: string | Uint8Array;
}

/**
 * Arma el ZIP.
 *
 * La fecha se pasa desde afuera a proposito: sin eso el mismo contenido daria
 * un archivo distinto cada vez y no se podria comparar en una prueba.
 */
export function zip(entradas: EntradaZip[], fecha: Date): Uint8Array<ArrayBuffer> {
  const enc = new TextEncoder();
  const { hora, dia } = fechaDos(fecha);

  const locales: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const e of entradas) {
    const nombre = enc.encode(e.ruta);
    const datos = typeof e.contenido === "string" ? enc.encode(e.contenido) : e.contenido;
    const crc = crc32(datos);

    const cabecera = new Uint8Array(30 + nombre.length);
    const v = new DataView(cabecera.buffer);
    v.setUint32(0, 0x04034b50, true);   // firma de cabecera local
    v.setUint16(4, 20, true);           // version necesaria
    v.setUint16(6, 0x0800, true);       // bit 11: el nombre viene en UTF-8
    v.setUint16(8, 0, true);            // metodo 0 = sin comprimir
    v.setUint16(10, hora, true);
    v.setUint16(12, dia, true);
    v.setUint32(14, crc, true);
    v.setUint32(18, datos.length, true);
    v.setUint32(22, datos.length, true);
    v.setUint16(26, nombre.length, true);
    v.setUint16(28, 0, true);           // sin campo extra
    cabecera.set(nombre, 30);

    locales.push(cabecera, datos);

    const dir = new Uint8Array(46 + nombre.length);
    const d = new DataView(dir.buffer);
    d.setUint32(0, 0x02014b50, true);   // firma de entrada del directorio
    d.setUint16(4, 20, true);           // version con la que se creo
    d.setUint16(6, 20, true);           // version necesaria
    d.setUint16(8, 0x0800, true);
    d.setUint16(10, 0, true);
    d.setUint16(12, hora, true);
    d.setUint16(14, dia, true);
    d.setUint32(16, crc, true);
    d.setUint32(20, datos.length, true);
    d.setUint32(24, datos.length, true);
    d.setUint16(28, nombre.length, true);
    d.setUint32(38, 0, true);           // atributos externos
    d.setUint32(42, offset, true);      // donde arranca su cabecera local
    dir.set(nombre, 46);
    central.push(dir);

    offset += cabecera.length + datos.length;
  }

  const tamanoCentral = central.reduce((s, c) => s + c.length, 0);
  const fin = new Uint8Array(22);
  const f = new DataView(fin.buffer);
  f.setUint32(0, 0x06054b50, true);     // fin del directorio central
  f.setUint16(8, entradas.length, true);
  f.setUint16(10, entradas.length, true);
  f.setUint32(12, tamanoCentral, true);
  f.setUint32(16, offset, true);

  return unir([...locales, ...central, fin]);
}

function unir(partes: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const total = partes.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(new ArrayBuffer(total));
  let i = 0;
  for (const p of partes) { out.set(p, i); i += p.length; }
  return out;
}

/** Fecha y hora en el formato de MS-DOS, que es el que guarda el ZIP. */
function fechaDos(d: Date): { hora: number; dia: number } {
  return {
    hora: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    dia: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

const TABLA = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

export function crc32(datos: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < datos.length; i++) c = TABLA[(c ^ datos[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
