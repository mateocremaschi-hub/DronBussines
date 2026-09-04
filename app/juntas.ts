/**
 * Donde estan de verdad las juntas entre modulos, contadas en la propia foto.
 *
 * Es el ultimo eslabon que faltaba, y el que rompia el informe de la peor
 * manera posible: con el numero de panel corrido uno.
 *
 * El enganche de `encaje.ts` solo corrige CRUZADO a la fila, y esa limitacion
 * estaba escrita a proposito: "una fila de modulos es igual a lo largo, asi
 * que el enganche no tiene con que ver la diferencia". Eso es falso, y las
 * fotos de Wellington lo muestran sin lugar a dudas. Una fila de modulos NO es
 * igual a lo largo: cada 24,8 px hay una junta —el marco de aluminio de dos
 * modulos, mas el aire entre ellos— y en la termica esa junta lee de 2 a 4 °C
 * mas fria que la celda. Sobre la fila 1-24-esclava de la foto 0334:
 *
 *     y 204 -> 35,4    y 228 -> 36,1    y 253 -> 34,8    y 277 -> 34,7
 *     ...entre junta y junta, panel a 37,5-38,2
 *
 * Con esa regla en la mano se puede preguntar algo que antes no se podia: la
 * rejilla que dibuja el parque, ¿cae sobre los modulos o entre ellos? En esa
 * fila cae 0,44 de modulo corrida. Es exactamente lo que Mateo vio a ojo —"el
 * cuadrado azul esta mitad en un panel y mitad en el otro"— y es lo que hacia
 * que la franja del diodo, que estaba en el modulo 26, se midiera dentro de la
 * caja del 25.
 *
 * Lo mismo explica el otro hallazgo falso. En la foto 0326 la caja del modulo
 * 28 se pasaba 7 px del final del panel y ahi adentro esta el motor del
 * tracker, a 50 °C. La caja media 38,6 de mediana y 46,9 de punto caliente: un
 * "+8,3 °C sobre el propio modulo" que no es un defecto, es un motor.
 *
 * Corrido el medio modulo, las dos cosas se arreglan de una: la caja del 26
 * agarra su franja y la del 28 no llega al motor.
 *
 * Lo importante de este corrimiento es que NO renumera nada. Se busca en
 * (-medio modulo, +medio modulo], asi que cada caja se va al modulo que ya
 * tenia mas cerca — nunca al de al lado. La numeracion del parque sigue
 * mandando; lo unico que cambia es que la caja del modulo 26 ahora se apoya
 * sobre el modulo 26.
 */



/**
 * Por que hacen falta las DOS reglas: la temperatura y la aspereza.
 *
 * La junta entre dos modulos se ve clarisima en la temperatura. Sobre la fila
 * 1-24-esclava de la foto 0334 la celda esta a 38 grados y la junta a 35, y el
 * borde es limpio: dos o tres pixeles. Esa es la regla PRECISA, la que ubica
 * la junta con menos de un pixel de error.
 *
 * Lo que la temperatura no sabe es de que lado. Entre modulo y modulo lo que
 * hay es suelo, y el suelo lee frio a la mañana y CALIENTE al mediodia — el
 * mismo pasto que en el hueco entre filas de este parque marca veinte grados
 * por encima del panel. Buscando un pozo frio con las juntas calientes, la
 * respuesta sale exactamente medio modulo corrida: cada caja apoyada justo en
 * el hueco entre dos paneles. Es el peor error posible y no da ningun sintoma,
 * porque las cajas siguen pareciendo igual de bien puestas.
 *
 * La aspereza no cambia de signo nunca. Un panel es una superficie lisa —el
 * desvio local de un modulo sano anda en 0,2 a 0,7— y todo lo que no es panel
 * es aspero: el pasto da 1,0, la sombra del borde de la fila 2 a 6, y la union
 * entre dos modulos es un escalon. Pero es una regla GRUESA: el desvio local
 * se calcula en un radio de 3 px, asi que el pico de la junta sale
 * desparramado y ubicarla con el solo cuesta un pixel o dos.
 *
 * Cada una para lo que sirve: la temperatura decide DONDE, la aspereza decide
 * de que lado. Y la aspereza es el mismo criterio con el que `encaje.ts`
 * acomoda la rejilla cruzado a la fila, asi que las dos correcciones hablan de
 * lo mismo.
 */

/**
 * Cuanto tiene que despegarse el centro del modulo de su junta, en grados.
 *
 * Sobre el vuelo entero de Wellington las filas bien vistas dan de 1,2 a 3,5.
 * Ocho decimas es bastante menos que la mas floja y varias veces el ruido de
 * la camara, que sobre panel liso anda en 0,2.
 *
 * Debajo de esto no se corrige nada, y esa es la decision correcta: sin juntas
 * visibles no hay regla, y correr la rejilla medio modulo detras del ruido es
 * exactamente el error que este archivo existe para no cometer.
 */
export const CONTRASTE_DE_JUNTAS_MINIMO_C = 0.8;

/**
 * Cuanto mas lisa tiene que quedar una alineacion que la otra para elegirla.
 *
 * Las dos candidatas estan medio modulo aparte: una pone los centros sobre los
 * paneles y la otra sobre los huecos. Si ninguna de las dos deja el panel mas
 * liso que la otra por este margen, lo que se esta mirando no son paneles y no
 * se corrige nada.
 */
const VENTAJA_DE_ASPEREZA = 0.04;


/**
 * Que parte del modulo cuenta como "el panel" y que parte como "la junta".
 *
 * La junta de verdad ocupa unos 3 px de los 24,8 del paso: el marco de los dos
 * modulos y el aire entre ellos. Se toma un poco mas ancha —el 18 % del paso,
 * unos 4,5 px— porque el borde esta emborronado por el propio pixel de la
 * camara, y un poco de panel adentro de la ventana de junta solo achica el
 * contraste, mientras que dejar junta afuera lo destruye.
 */
const VENTANA_DE_JUNTA = 0.18;
/** Y el centro del modulo, que es contra lo que se compara. */
const VENTANA_DE_CENTRO = 0.4;

/**
 * Cuanto mejor tiene que ser el mejor corrimiento que el tercero en discordia.
 *
 * Las dos candidatas de siempre —la que encontro la temperatura y su opuesta—
 * se excluyen de esta comparacion: son las dos caras de la misma respuesta.
 * Lo que este margen frena es la fila donde hay una TERCERA alineacion
 * plausible, que es lo que pasa cuando lo que se esta viendo no son las juntas
 * sino la sombra de otra cosa.
 */
const VENTAJA_MINIMA_C = 0.25;

/** Con menos modulos que esto en la foto no hay rejilla que buscar. */
const MODULOS_MINIMOS = 4;

export interface Juntas {
  /** Cuanto hay que correr la rejilla a lo largo de la fila, en pixeles. */
  corrimientoPx: number;
  /** Lo mismo en modulos, que es como se lee. */
  corrimientoModulos: number;
  /** Cuanto se despega el centro del modulo de su junta, en grados. */
  contraste: number;
  /** Cuantos modulos se usaron para medirlo. */
  modulos: number;
}

/**
 * El perfil a lo largo de la fila: un valor por pixel del eje.
 *
 * Se toma la MEDIANA cruzada y no el promedio, y eso importa: un modulo con un
 * defecto grande levanta el promedio de su franja cruzada lo suficiente como
 * para tapar la junta que tiene al lado. La mediana de veinte pixeles cruzados
 * la ignora.
 *
 * Y se toma solo el 70 % central del ancho de la fila. Los bordes traen el
 * marco largo del modulo y, con el tracker inclinado, un pedazo de suelo — dos
 * cosas que tienen su propia estructura y ninguna se repite cada modulo.
 */
export function perfilALoLargo(
  valores: Float32Array,
  ancho: number,
  alto: number,
  cx: number,
  cy: number,
  rotRad: number,
  cruzadoPx: number,
  t0: number,
  t1: number,
): Float64Array {
  const ux = Math.cos(rotRad), uy = Math.sin(rotRad);
  const vx = -Math.sin(rotRad), vy = Math.cos(rotRad);
  const hw = Math.max(1, cruzadoPx * 0.35);
  const n = Math.max(0, Math.round(t1 - t0) + 1);
  const p = new Float64Array(n);
  const buf: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = t0 + i;
    buf.length = 0;
    for (let w = -hw; w <= hw; w += 1) {
      const x = Math.round(cx + t * ux + w * vx);
      const y = Math.round(cy + t * uy + w * vy);
      if (x < 0 || y < 0 || x >= ancho || y >= alto) continue;
      const v = valores[y * ancho + x]!;
      if (Number.isFinite(v)) buf.push(v);
    }
    if (!buf.length) { p[i] = NaN; continue; }
    buf.sort((a, b) => a - b);
    p[i] = buf[buf.length >> 1]!;
  }
  return p;
}

/** Lee el perfil en un t cualquiera, interpolando entre pixeles. */
function enT(p: Float64Array, t0: number, t: number): number {
  const x = t - t0;
  if (x < 0 || x > p.length - 1) return NaN;
  const i = Math.floor(x);
  const a = p[i]!, b = p[Math.min(p.length - 1, i + 1)]!;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return NaN;
  return a + (b - a) * (x - i);
}

/**
 * Cuanto hay que correr la rejilla del parque para que caiga sobre los modulos.
 *
 * `centros` son los centros de modulo que predice el parque, proyectados sobre
 * el eje de la fila. No se asume que esten parejos: entre el modulo 28 de un
 * string y el 1 del siguiente hay 555 mm de mas, y esa separacion ya viene en
 * las coordenadas. Por eso se puntua contra la lista de centros que se recibe
 * y no contra una periodicidad ideal — asumir periodo constante daria una fase
 * promedio entre dos strings que estan corridos entre si.
 */
export function corrimientoDeLaRejilla(
  /** Temperatura a lo largo de la fila. Dice DONDE estan las juntas. */
  perfilC: Float64Array,
  /** Desvio local a lo largo de la fila. Dice de que lado esta el panel. */
  perfilAspero: Float64Array,
  t0: number,
  centros: number[],
  pasoPx: number,
): Juntas | null {
  if (centros.length < MODULOS_MINIMOS || !(pasoPx > 2)) return null;

  const orden = centros.slice().sort((a, b) => a - b);
  const hCentro = pasoPx * VENTANA_DE_CENTRO / 2;
  const hJunta = pasoPx * VENTANA_DE_JUNTA / 2;

  /*
    Las juntas se ponen entre centros CONSECUTIVOS y solo cuando estan a un
    paso. Entre string y string la separacion es de 1,5 pasos y ahi no hay
    junta de modulo: hay 555 mm de nada, que lee distinto de punta a punta y
    arrastraria el puntaje sin decir nada sobre la fase.
  */
  const juntas: number[] = [];
  for (let i = 0; i + 1 < orden.length; i++) {
    const d = orden[i + 1]! - orden[i]!;
    if (Math.abs(d - pasoPx) < pasoPx * 0.15) juntas.push((orden[i]! + orden[i + 1]!) / 2);
  }
  if (juntas.length < MODULOS_MINIMOS - 1) return null;

  /*
    La ventana se recorre SIMETRICA alrededor del centro.

    Con `for (o = -h; o <= h; o += 1)` y h fraccionario, el ultimo paso no
    llega al otro extremo y la ventana termina descentrada: sobre la junta,
    cuya ventana mide 2,25 px, eso corria el centro de masa un cuarto de pixel
    y el corrimiento estimado un pixel y cuarto — mas de lo que hace falta para
    que una caja empiece a comerse el panel de al lado.
  */
  const media = (p: Float64Array, ts: number[], d: number, h: number): number => {
    const k = Math.max(1, Math.round(h));
    let s = 0, n = 0;
    for (const t of ts) {
      for (let o = -k; o <= k; o++) {
        const v = enT(p, t0, t + d + o);
        if (Number.isFinite(v)) { s += v; n++; }
      }
    }
    return n ? s / n : NaN;
  };

  /** Cuanto mas caliente esta el centro del modulo que su junta, con este corrimiento. */
  const contraste = (d: number): number =>
    media(perfilC, orden, d, hCentro) - media(perfilC, juntas, d, hJunta);
  /** Cuanto mas lisa queda la parte que se llama panel que la que se llama junta. */
  const lisura = (d: number): number =>
    media(perfilAspero, juntas, d, hJunta) - media(perfilAspero, orden, d, hCentro);

  let mejorV = -Infinity;
  const puntajes: Array<[number, number]> = [];
  for (let d = -pasoPx / 2; d < pasoPx / 2; d += 0.25) {
    const v = contraste(d);
    if (!Number.isFinite(v)) continue;
    puntajes.push([d, v]);
    if (v > mejorV) mejorV = v;
  }
  if (puntajes.length < 8) return null;

  /*
    El mejor corrimiento es el CENTRO de la meseta, no el primero que la toca.

    La junta ocupa tres pixeles y la ventana con que se la mide, cuatro y
    medio: hay un tramo entero de corrimientos que puntuan casi igual.
    Quedarse con el primero deja la rejilla apoyada en el borde de ese tramo, y
    ese sesgo va siempre para el mismo lado — un pixel largo de error
    sistematico en la posicion de todas las cajas.
  */
  const meseta = puntajes.filter(([, v]) => v >= mejorV - 1e-6).map(([d]) => d);
  const ang = meseta.map((d) => (2 * Math.PI * d) / pasoPx);
  const crudo =
    (Math.atan2(
      ang.reduce((a, x) => a + Math.sin(x), 0),
      ang.reduce((a, x) => a + Math.cos(x), 0),
    ) * pasoPx) / (2 * Math.PI);

  const vuelta = (d: number): number => {
    let x = d;
    while (x > pasoPx / 2) x -= pasoPx;
    while (x <= -pasoPx / 2) x += pasoPx;
    return x;
  };

  /*
    Y ahora de que lado. Las dos candidatas estan medio modulo aparte: la que
    encontro la temperatura y su opuesta. Gana la que deje el panel del lado
    LISO — no la que lo deje del lado caliente, que es lo que cambia con el sol.
  */
  const otro = vuelta(crudo + pasoPx / 2);
  const lisoA = lisura(crudo), lisoB = lisura(otro);
  if (!Number.isFinite(lisoA) || !Number.isFinite(lisoB)) return null;
  if (Math.abs(lisoA - lisoB) < VENTAJA_DE_ASPEREZA) return null;
  const mejor = lisoA >= lisoB ? crudo : otro;

  const contrasteC = Math.abs(contraste(mejor));
  if (contrasteC < CONTRASTE_DE_JUNTAS_MINIMO_C) return null;

  /*
    El "segundo mejor" se busca a distancia CIRCULAR de las DOS candidatas.

    El espacio de corrimientos da la vuelta: correr medio modulo para un lado y
    medio para el otro es la misma alineacion. Midiendo la distancia con una
    resta simple, el mejor y su propia imagen del otro lado del rango salen
    separados por un modulo entero, la funcion los toma por rivales y descarta
    la fila justo cuando la medicion era buena. Paso en la fila 1-24-esclava,
    que es la del diodo.

    Se compara el VALOR ABSOLUTO del contraste, porque con las juntas calientes
    la alineacion buena es la del puntaje mas negativo y el criterio tiene que
    ser el mismo en los dos casos.
  */
  const lejos = (a: number, b: number): number => {
    const d = Math.abs(a - b) % pasoPx;
    return Math.min(d, pasoPx - d);
  };
  let segundo = -Infinity;
  for (const [d] of puntajes) {
    if (lejos(d, mejor) <= pasoPx * 0.25 || lejos(d, otro) <= pasoPx * 0.25) continue;
    const v = Math.abs(contraste(d));
    if (v > segundo) segundo = v;
  }
  if (Number.isFinite(segundo) && contrasteC - segundo < VENTAJA_MINIMA_C) return null;

  return {
    corrimientoPx: mejor,
    corrimientoModulos: mejor / pasoPx,
    contraste: contrasteC,
    modulos: orden.length,
  };
}
