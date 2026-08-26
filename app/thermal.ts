/**
 * La temperatura de cada pixel, sacada del JPEG termico.
 *
 * Una foto termica de dron no es una imagen coloreada: es una matriz de
 * numeros con una imagen coloreada pegada al lado. Los valores crudos viajan
 * en segmentos APP3 del JPEG, dos bytes por pixel, y ahi esta la temperatura
 * real de cada punto del parque.
 *
 * Se creia que para leerlos hacia falta el SDK nativo del fabricante — que no
 * corre en un navegador y ata el producto a una plataforma. No hace falta: son
 * enteros de 16 bits en orden de lectura, y el JPEG dice sus dimensiones.
 * Verificado contra 8 fotos reales de Edenvale del 25 de marzo: la matriz
 * cruda correlaciona con la imagen visible a r = 0.99, y las temperaturas dan
 * 23-28 C de suelo a la sombra, 38-43 C de modulo y 52-56 C en los puntos
 * calientes. Exactamente lo que corresponde al mediodia en Queensland.
 *
 * Esto es lo que permite hacer la deteccion en la propia app en vez de pagarla
 * por megavatio.
 */

// ---------------------------------------------------------------------------
// Escalas
// ---------------------------------------------------------------------------

/**
 * Las formas conocidas de convertir el crudo a grados.
 *
 * Ningun fabricante la documenta igual, asi que en vez de suponer una se
 * prueban todas y se elige la que da temperaturas de este mundo. Si ninguna
 * cierra, se dice — no se devuelve un numero cualquiera.
 */
export interface Escala {
  nombre: string;
  aCelsius: (crudo: number) => number;
}

export const ESCALAS: Escala[] = [
  { nombre: "1/64 de kelvin", aCelsius: (v) => v / 64 - 273.15 },
  { nombre: "decikelvin", aCelsius: (v) => v / 10 - 273.15 },
  { nombre: "centikelvin", aCelsius: (v) => v / 100 - 273.15 },
  { nombre: "centigrados x100", aCelsius: (v) => v / 100 },
  { nombre: "centigrados x10", aCelsius: (v) => v / 10 },
];

/** Rango de temperaturas que puede tener una escena de este planeta. */
const MIN_PLAUSIBLE = -50;
const MAX_PLAUSIBLE = 200;

/**
 * Elige la escala mirando si el resultado tiene sentido fisico.
 *
 * No alcanza con que el promedio caiga en rango: una escena termica real
 * tiene CONTRASTE. Si todo da el mismo numero, la escala esta comprimiendo la
 * escena y el delta T —que es lo unico que importa— seria basura.
 */
export function elegirEscala(crudo: Uint16Array): Escala | null {
  const muestra = muestrear(crudo, 4000);
  const lo = percentil(muestra, 1);
  const hi = percentil(muestra, 99);

  for (const e of ESCALAS) {
    const a = e.aCelsius(lo);
    const b = e.aCelsius(hi);
    if (a < MIN_PLAUSIBLE || b > MAX_PLAUSIBLE) continue;
    // Una escena termica de una planta solar al sol abarca varios grados.
    if (b - a < 1 || b - a > 120) continue;
    return e;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Lectura del JPEG
// ---------------------------------------------------------------------------

export interface Radiometric {
  width: number;
  height: number;
  /** Grados centigrados, un valor por pixel, de arriba a abajo y de izquierda a derecha. */
  celsius: Float32Array;
  escala: string;
}

const APP3 = 0xe3;
const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

/**
 * Recorre los segmentos del JPEG juntando el crudo termico y las dimensiones.
 *
 * Devuelve null —y no un error— cuando la foto simplemente no es radiometrica:
 * en un lote mezclado de visibles y termicas eso es lo normal, no una falla.
 */
export function readRadiometric(buf: ArrayBuffer): Radiometric | null {
  const d = new DataView(buf);
  const u8 = new Uint8Array(buf);
  if (d.byteLength < 4 || d.getUint16(0) !== 0xffd8) return null;

  const trozos: Uint8Array[] = [];
  let width = 0;
  let height = 0;
  let i = 2;

  while (i < d.byteLength - 3) {
    if (u8[i] !== 0xff) break;
    const marker = u8[i + 1]!;
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { i += 2; continue; }
    if (marker === 0xda || marker === 0xd9) break; // arranca la imagen comprimida
    const len = d.getUint16(i + 2);
    if (len < 2) break;

    if (marker === APP3) trozos.push(u8.subarray(i + 4, i + 2 + len));
    if (SOF.has(marker) && height === 0) {
      height = d.getUint16(i + 5);
      width = d.getUint16(i + 7);
    }
    i += 2 + len;
  }

  if (!trozos.length || !width || !height) return null;

  const esperado = width * height * 2;
  const total = trozos.reduce((s, t) => s + t.length, 0);
  // Se acepta que sobre (algunos equipos meten un encabezado), nunca que falte.
  if (total < esperado) return null;

  const junto = new Uint8Array(total);
  let off = 0;
  for (const t of trozos) { junto.set(t, off); off += t.length; }

  // Little endian, verificado contra las fotos reales del M3T.
  const crudo = new Uint16Array(esperado / 2);
  const desde = total - esperado; // si sobra, el encabezado va adelante
  for (let p = 0; p < crudo.length; p++) {
    crudo[p] = junto[desde + p * 2]! | (junto[desde + p * 2 + 1]! << 8);
  }

  const escala = elegirEscala(crudo);
  if (!escala) return null;

  const celsius = new Float32Array(crudo.length);
  for (let p = 0; p < crudo.length; p++) celsius[p] = escala.aCelsius(crudo[p]!);

  return { width, height, celsius, escala: escala.nombre };
}

// ---------------------------------------------------------------------------
// Medir una zona
// ---------------------------------------------------------------------------

/**
 * Temperatura de un rectangulo de la imagen, por mediana.
 *
 * Mediana y no promedio a proposito: en el borde de un modulo entran pixeles
 * del suelo, que al sol esta mucho mas frio o mas caliente. Un solo pixel de
 * suelo corre el promedio varios grados; a la mediana no la mueve.
 */
export interface Medicion {
  /** La temperatura de trabajo del modulo: la mediana de su parte util. */
  celsius: number;
  /**
   * La temperatura de la zona mas caliente del tamaño de una celda.
   *
   * Es la mediana de los `kCaliente` pixeles mas calientes de la caja, no el
   * maximo. El maximo de una termica es un pixel de ruido; la mediana del
   * conjunto mas caliente del tamaño de una celda es una celda caliente.
   */
  puntoCalienteC: number;
  pixeles: number;
}

/**
 * Mide un modulo: su temperatura de trabajo y su punto mas caliente.
 *
 * Las dos cosas hacen falta y miden cosas distintas.
 *
 * La MEDIANA es la temperatura del modulo. Es la que sirve para compararlo
 * contra sus hermanos de string, y es mediana y no promedio porque un pixel de
 * pasto o de marco de aluminio corre un promedio varios grados.
 *
 * Pero por eso mismo la mediana es CIEGA al defecto mas comun de todos. Una
 * celda caliente ocupa el 3 % del area del modulo: la mediana no se mueve ni
 * un decimo de grado. Para verla hay que mirar la parte mas caliente del
 * modulo y compararla contra el propio modulo — que ademas es como lo plantea
 * la norma, y tiene la ventaja de no depender de ningun vecino: la suciedad,
 * la irradiancia y la edad afectan al modulo entero por igual y se cancelan.
 */
export function medirCaja(
  r: Radiometric,
  cx: number,
  cy: number,
  anchoPx: number,
  altoPx: number,
  kCaliente: number,
): Medicion | null {
  const vals = pixelesDeCaja(r, cx, cy, anchoPx, altoPx);
  if (!vals) return null;

  const orden = Array.from(vals).sort((a, b) => a - b);
  const k = Math.max(1, Math.min(Math.round(kCaliente), Math.floor(orden.length / 4)));
  const calientes = orden.slice(orden.length - k);

  return {
    celsius: percentil(orden, 50),
    puntoCalienteC: percentil(calientes, 50),
    pixeles: orden.length,
  };
}

function pixelesDeCaja(
  r: Radiometric,
  cx: number,
  cy: number,
  anchoPx: number,
  altoPx: number,
): number[] | null {
  const x0 = Math.max(0, Math.round(cx - anchoPx / 2));
  const x1 = Math.min(r.width - 1, Math.round(cx + anchoPx / 2));
  const y0 = Math.max(0, Math.round(cy - altoPx / 2));
  const y1 = Math.min(r.height - 1, Math.round(cy + altoPx / 2));
  if (x1 < x0 || y1 < y0) return null;

  const vals: number[] = [];
  for (let y = y0; y <= y1; y++) {
    const fila = y * r.width;
    for (let x = x0; x <= x1; x++) vals.push(r.celsius[fila + x]!);
  }
  return vals.length ? vals : null;
}

export function medianaEnCaja(
  r: Radiometric,
  cx: number,
  cy: number,
  anchoPx: number,
  altoPx: number,
): { celsius: number; pixeles: number } | null {
  const x0 = Math.max(0, Math.round(cx - anchoPx / 2));
  const x1 = Math.min(r.width - 1, Math.round(cx + anchoPx / 2));
  const y0 = Math.max(0, Math.round(cy - altoPx / 2));
  const y1 = Math.min(r.height - 1, Math.round(cy + altoPx / 2));
  if (x1 < x0 || y1 < y0) return null;

  const vals: number[] = [];
  for (let y = y0; y <= y1; y++) {
    const fila = y * r.width;
    for (let x = x0; x <= x1; x++) vals.push(r.celsius[fila + x]!);
  }
  if (!vals.length) return null;
  return { celsius: percentil(vals, 50), pixeles: vals.length };
}

// ---------------------------------------------------------------------------

export function percentil(vals: ArrayLike<number>, p: number): number {
  const a = Array.from(vals).sort((x, y) => x - y);
  if (!a.length) return NaN;
  const i = Math.min(a.length - 1, Math.max(0, Math.round(((p / 100) * (a.length - 1)))));
  return a[i]!;
}

function muestrear(a: Uint16Array, n: number): number[] {
  const paso = Math.max(1, Math.floor(a.length / n));
  const out: number[] = [];
  for (let i = 0; i < a.length; i += paso) out.push(a[i]!);
  return out;
}
