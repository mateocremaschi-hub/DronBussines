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
  /** La escala con la que se convirtio esta foto. */
  escala: string;
  /**
   * La escala que la busqueda automatica habria elegido para ESTA foto sola.
   *
   * Cuando se le fija una escala al vuelo entero, este campo es el que permite
   * darse cuenta de que una foto no se parece a las demas. La eleccion es por
   * foto y se decide por contraste: una foto de una nube, del hangar o del
   * despegue puede caer en otra escala, y esa foto entra al analisis con las
   * temperaturas multiplicadas por seis. Nadie lo nota, porque 240 °C se
   * reporta como una anomalia critica y ya estabamos buscando anomalias.
   */
  escalaAuto: string;
  /**
   * La temperatura mas alta de la foto, y que fraccion de la foto esta ahi.
   *
   * Una camara termica tiene un rango elegido: arriba de ese tope todo se
   * guarda con el MISMO valor. Un modulo con un punto caliente de verdad, un
   * conector quemado o un reflejo del sol pueden pasarse, y entonces lo que se
   * mide no es su temperatura sino el techo del sensor.
   *
   * Eso no se puede detectar mirando un modulo solo: se detecta mirando cuanta
   * foto quedo pegada al mismo numero maximo. Si es una mancha grande, la
   * camara esta saturando y los ΔT de esa foto son un piso, no una medida.
   */
  topeC: number;
  fraccionEnElTope: number;
  /**
   * La foto venia guardada al doble del tamano real del sensor.
   *
   * No rompe nada —se mide sobre el crudo, que es lo real— pero conviene
   * avisarle al piloto: la mitad de cada archivo son pixeles inventados y el
   * vuelo pesa cuatro veces mas de lo necesario.
   */
  superResolucion?: boolean;
}

const APP3 = 0xe3;
const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

/**
 * Recorre los segmentos del JPEG juntando el crudo termico y las dimensiones.
 *
 * Devuelve null —y no un error— cuando la foto simplemente no es radiometrica:
 * en un lote mezclado de visibles y termicas eso es lo normal, no una falla.
 */
export function readRadiometric(
  buf: ArrayBuffer,
  /** Escala a usar para todo el vuelo, por nombre. Sin esto, se elige por foto. */
  escalaFijada?: string,
): Radiometric | null {
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

  const total = trozos.reduce((s, t) => s + t.length, 0);

  /*
   * El JPEG puede ser mas grande que el sensor.
   *
   * El Matrice 4T tiene una opcion —"Super Resolution"— que guarda la imagen
   * termica al doble: 1280x1024 en el encabezado del JPEG, cuando el sensor
   * es de 640x512. Los pixeles de mas son inventados por interpolacion, pero
   * el crudo radiometrico del APP3 sigue viniendo al tamano real del sensor.
   *
   * Si se cree lo que dice el encabezado, se esperan cuatro veces mas bytes de
   * los que hay y la foto se descarta entera: la camara nueva quedaba muda.
   * Asi que cuando el crudo no alcanza para el tamano declarado, se prueba la
   * mitad exacta, que es lo unico que hace el modo. Se exige coincidencia
   * exacta para no adivinar con fotos truncadas.
   */
  let esperado = width * height * 2;
  let superResolucion = false;
  if (total < esperado && width % 2 === 0 && height % 2 === 0) {
    const mitad = (width / 2) * (height / 2) * 2;
    if (total === mitad) {
      width /= 2;
      height /= 2;
      esperado = mitad;
      superResolucion = true;
    }
  }
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

  const auto = elegirEscala(crudo);
  const fijada = escalaFijada ? ESCALAS.find((e) => e.nombre === escalaFijada) : undefined;
  const escala = fijada ?? auto;
  if (!escala) return null;

  const celsius = new Float32Array(crudo.length);
  for (let p = 0; p < crudo.length; p++) celsius[p] = escala.aCelsius(crudo[p]!);

  // El tope se cuenta sobre el CRUDO: ahi la saturacion es un entero repetido
  // exacto, mientras que en grados es un flotante que puede no comparar igual.
  let tope = 0;
  for (let p = 0; p < crudo.length; p++) if (crudo[p]! > tope) tope = crudo[p]!;
  let enElTope = 0;
  for (let p = 0; p < crudo.length; p++) if (crudo[p] === tope) enElTope++;

  return {
    width, height, celsius,
    escala: escala.nombre,
    escalaAuto: auto?.nombre ?? escala.nombre,
    topeC: escala.aCelsius(tope),
    fraccionEnElTope: crudo.length ? enElTope / crudo.length : 0,
    superResolucion,
  };
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
  /** Cuantos pixeles entraron en la caja. */
  pixeles: number;
  /**
   * Cuantos le TOCABAN, si el modulo hubiera entrado entero en el cuadro.
   *
   * La diferencia con `pixeles` es lo que dice si quedo partido por el borde
   * del sensor. Sale de la misma cuenta que los recorre, a proposito: tenerlo
   * calculado aparte fue como se desincronizaron las dos versiones de la caja.
   */
  esperados: number;
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
  /** Giro de la caja respecto de los ejes de la imagen, en radianes. */
  anguloRad = 0,
): Medicion | null {
  const vals = pixelesDeCaja(r, cx, cy, anchoPx, altoPx, anguloRad);
  if (!vals) return null;

  const orden = Array.from(vals.dentro).sort((a, b) => a - b);
  const k = Math.max(1, Math.min(Math.round(kCaliente), Math.floor(orden.length / 4)));
  const calientes = orden.slice(orden.length - k);

  return {
    celsius: percentil(orden, 50),
    puntoCalienteC: percentil(calientes, 50),
    pixeles: orden.length,
    esperados: vals.esperados,
  };
}

/**
 * Los pixeles que caen dentro de la caja del modulo.
 *
 * La caja GIRA con la fila. Antes estaba siempre alineada a los ejes de la
 * imagen, y eso solo coincide con el modulo cuando el dron vuela exactamente
 * paralelo o perpendicular a las filas; en cualquier otro rumbo la caja tomaba
 * esquinas de cuatro modulos y el punto caliente de uno aparecia como defecto
 * del vecino sano. Es la diferencia entre mandar a la cuadrilla al panel
 * correcto o al de al lado.
 *
 * Se recorre el rectangulo envolvente y se descarta lo que cae afuera de la
 * caja girada. Con 2000 pixeles por modulo el costo no se mide, y a cambio la
 * caja es la del modulo y no la de su sombra sobre los ejes.
 */
function pixelesDeCaja(
  r: Radiometric,
  cx: number,
  cy: number,
  anchoPx: number,
  altoPx: number,
  anguloRad = 0,
): { dentro: number[]; esperados: number } | null {
  const cos = Math.cos(anguloRad);
  const sin = Math.sin(anguloRad);
  const hw = anchoPx / 2;
  const hh = altoPx / 2;

  // Envolvente de la caja girada.
  const extX = Math.abs(hw * cos) + Math.abs(hh * sin);
  const extY = Math.abs(hw * sin) + Math.abs(hh * cos);

  // Sin recortar y recortado por el cuadro. El primero es cuantos pixeles le
  // TOCAN a este modulo; el segundo, cuantos entraron. La diferencia entre los
  // dos es lo que dice si el modulo quedo partido por el borde del sensor, y
  // por eso los dos salen de la misma cuenta: tenerlo escrito dos veces era
  // como se desincronizaban.
  const bx0 = Math.round(cx - extX), bx1 = Math.round(cx + extX);
  const by0 = Math.round(cy - extY), by1 = Math.round(cy + extY);

  const x0 = Math.max(0, bx0), x1 = Math.min(r.width - 1, bx1);
  const y0 = Math.max(0, by0), y1 = Math.min(r.height - 1, by1);
  if (x1 < x0 || y1 < y0) return null;

  const dentro: number[] = [];
  let esperados = 0;
  for (let y = by0; y <= by1; y++) {
    const dy = y - cy;
    const enY = y >= 0 && y < r.height;
    const fila = y * r.width;
    for (let x = bx0; x <= bx1; x++) {
      const dx = x - cx;
      // Al marco de la caja: girar el punto al reves que la caja.
      const u = dx * cos + dy * sin;
      const v = -dx * sin + dy * cos;
      if (Math.abs(u) > hw || Math.abs(v) > hh) continue;
      esperados++;
      if (enY && x >= 0 && x < r.width) dentro.push(r.celsius[fila + x]!);
    }
  }
  return dentro.length ? { dentro, esperados } : null;
}

/**
 * El modulo remuestreado en una grilla de su PROPIO marco.
 *
 * `pixelesDeCaja` devuelve los pixeles en una lista plana, sin coordenadas:
 * alcanza para sacar una mediana y no alcanza para ver una FORMA. Y la forma es
 * lo que dice que defecto es — una franja que cruza el modulo es un diodo de
 * bypass, tres manchitas sueltas son celdas.
 *
 * Se remuestrea a una grilla chica —12 x 6 es la forma de un modulo de 72
 * celdas— y no se trabaja sobre los pixeles crudos por dos razones. Una: a 5 cm
 * por pixel el modulo entra en unos 22 x 45 pixeles, asi que la grilla no
 * pierde nada que la camara haya visto. La otra: la grilla es del marco del
 * MODULO, con el lado largo siempre en el mismo eje, asi que la franja del
 * diodo se busca siempre en la misma direccion sin importar como volo el dron.
 *
 * Cada celda de la grilla toma la mediana de los pixeles que le caen adentro,
 * que es lo que evita que un pixel muerto del sensor invente un punto caliente.
 */
export function retratoDeCaja(
  r: Radiometric,
  cx: number,
  cy: number,
  /** Lado del modulo que va a lo largo de la fila, en pixeles. */
  largoPx: number,
  /** Lado del modulo que cruza la fila, en pixeles. Es el lado largo. */
  cruzadoPx: number,
  anguloRad = 0,
  filas = 12,
  columnas = 6,
): { celdas: Float32Array; filas: number; columnas: number } | null {
  const cos = Math.cos(anguloRad);
  const sin = Math.sin(anguloRad);
  const hw = largoPx / 2;
  const hh = cruzadoPx / 2;
  if (hw <= 0 || hh <= 0) return null;

  const cubos: number[][] = Array.from({ length: filas * columnas }, () => []);

  const extX = Math.abs(hw * cos) + Math.abs(hh * sin);
  const extY = Math.abs(hw * sin) + Math.abs(hh * cos);
  const x0 = Math.max(0, Math.round(cx - extX)), x1 = Math.min(r.width - 1, Math.round(cx + extX));
  const y0 = Math.max(0, Math.round(cy - extY)), y1 = Math.min(r.height - 1, Math.round(cy + extY));

  for (let y = y0; y <= y1; y++) {
    const dy = y - cy;
    const base = y * r.width;
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx;
      // Al marco del modulo: girar el punto al reves que la caja.
      const u = dx * cos + dy * sin;      // a lo largo de la fila
      const v = -dx * sin + dy * cos;     // cruzando la fila: el lado largo
      if (Math.abs(u) > hw || Math.abs(v) > hh) continue;
      const c = Math.min(columnas - 1, Math.max(0, Math.floor(((u + hw) / (2 * hw)) * columnas)));
      const f = Math.min(filas - 1, Math.max(0, Math.floor(((v + hh) / (2 * hh)) * filas)));
      cubos[f * columnas + c]!.push(r.celsius[base + x]!);
    }
  }

  const celdas = new Float32Array(filas * columnas);
  let vacias = 0;
  for (let i = 0; i < celdas.length; i++) {
    const c = cubos[i]!;
    if (!c.length) { vacias++; celdas[i] = NaN; continue; }
    celdas[i] = percentil(c, 50);
  }
  // Con la mitad de la grilla vacia el modulo entro tan chico —o tan cortado
  // por el borde— que su forma no se puede leer. Decirlo es mejor que
  // clasificar sobre agujeros.
  if (vacias > celdas.length / 2) return null;

  // Los huecos sueltos se rellenan con la mediana de lo que si se midio, para
  // que no cuenten como frios ni como calientes.
  const medida = percentil(Array.from(celdas).filter((v) => !Number.isNaN(v)), 50);
  for (let i = 0; i < celdas.length; i++) if (Number.isNaN(celdas[i]!)) celdas[i] = medida;

  return { celdas, filas, columnas };
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
