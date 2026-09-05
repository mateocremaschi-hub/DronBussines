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

/**
 * Cuanto se deja mover la escala a lo largo de la fila, y de a cuanto.
 *
 * Siete por ciento cubre el peor desvio visto entre el paso proyectado y el
 * contado en la imagen; medio por ciento son tres pixeles en la punta de una
 * fila de veinticinco modulos, que es la precision que hace falta.
 */
const ESCALA_MAXIMA = 0.07;
const PASO_DE_ESCALA = 0.005;
/** Con menos modulos que esto la escala no se puede estimar y se deja en uno. */
const MODULOS_PARA_LA_ESCALA = 8;

/** Con menos modulos que esto en la foto no hay rejilla que buscar. */
const MODULOS_MINIMOS = 4;

export interface Juntas {
  /**
   * Cuanto hay que correr la rejilla a lo largo de la fila, en pixeles,
   * DESPUES de aplicarle el factor de escala alrededor del centro de la fila.
   */
  corrimientoPx: number;
  /** Por cuanto hay que multiplicar las distancias al centro de la fila. */
  factor: number;
  /** El paso entre modulos que hay en la imagen: el de entrada por el factor. */
  pasoPx: number;
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
  /**
   * Los centros de modulo que predice el parque, sobre el eje t, MEDIDOS
   * DESDE EL CENTRO DE LA FILA EN EL CUADRO. El factor de escala se aplica
   * alrededor de t = 0, asi que de donde se mida importa.
   */
  centros: number[],
  pasoPx: number,
  /** Sin buscar la escala: solo la fase. Para preguntar rapido "¿hay juntas aca?". */
  soloFase = false,
): Juntas | null {
  if (centros.length < MODULOS_MINIMOS || !(pasoPx > 2)) return null;
  const orden = centros.slice().sort((a, b) => a - b);

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

  /*
    Se busca tambien la ESCALA, no solo la fase.

    El paso que trae la proyeccion sale de la altura y de la escala del vuelo,
    y en el borde del cuadro se despega del que hay en la imagen —la lente
    deforma, y un 1,3 % sobre doce modulos son cuatro pixeles. Con la escala
    fija, la fase que mejor ajusta es un promedio: bien en el medio de la fila
    y corrida en las puntas, que es justamente donde estan el modulo 1 y el 28.
    Sobre la fila 2-37 de la foto 0045 la caja del modulo 1 quedaba nueve
    pixeles corrida con la fase sola.

    El factor se aplica alrededor del centro de la fila en el cuadro. Con
    pocos modulos no hay con que estimarlo y se deja en uno.
  */
  const factores: number[] = [1];
  if (!soloFase && orden.length >= MODULOS_PARA_LA_ESCALA) {
    for (let f = 1 - ESCALA_MAXIMA; f <= 1 + ESCALA_MAXIMA + 1e-9; f += PASO_DE_ESCALA) {
      if (Math.abs(f - 1) > 1e-9) factores.push(f);
    }
  }

  const armar = (f: number) => {
    const cs = orden.map((t) => t * f);
    const paso = pasoPx * f;
    const juntas: number[] = [];
    for (let i = 0; i + 1 < cs.length; i++) {
      const d = cs[i + 1]! - cs[i]!;
      if (Math.abs(d - paso) < paso * 0.15) juntas.push((cs[i]! + cs[i + 1]!) / 2);
    }
    const hCentro = paso * VENTANA_DE_CENTRO / 2, hJunta = paso * VENTANA_DE_JUNTA / 2;
    return {
      paso,
      juntas,
      contraste: (d: number) => media(perfilC, cs, d, hCentro) - media(perfilC, juntas, d, hJunta),
      lisura: (d: number) => media(perfilAspero, juntas, d, hJunta) - media(perfilAspero, cs, d, hCentro),
    };
  };

  let mejorF = 1, mejorV = -Infinity;
  let mejorPuntajes: Array<[number, number]> = [];
  for (const f of factores) {
    const a = armar(f);
    if (a.juntas.length < MODULOS_MINIMOS - 1) continue;
    const puntajes: Array<[number, number]> = [];
    let v0 = -Infinity;
    for (let d = -a.paso / 2; d < a.paso / 2; d += 0.25) {
      const v = a.contraste(d);
      if (!Number.isFinite(v)) continue;
      puntajes.push([d, v]);
      if (v > v0) v0 = v;
    }
    if (puntajes.length < 8) continue;
    /*
      Entre escalas gana el contraste mas alto, y el empate lo gana la escala
      que menos se aparta de uno. El contraste crece de verdad cuando la
      escala es la correcta —todas las juntas caen en su ventana a la vez— y
      el margen de un decimo de grado esta para no correr la escala detras
      del ruido.
    */
    if (v0 > mejorV + 0.1 || (v0 > mejorV - 0.1 && Math.abs(f - 1) < Math.abs(mejorF - 1))) {
      if (v0 > mejorV) mejorV = v0;
      mejorF = f;
      mejorPuntajes = puntajes;
    }
  }
  if (!mejorPuntajes.length) return null;
  const a = armar(mejorF);
  const paso = a.paso;
  const topeLocal = Math.max(...mejorPuntajes.map(([, v]) => v));

  /*
    El mejor corrimiento es el CENTRO de la meseta, no el primero que la toca.

    La junta ocupa tres pixeles y la ventana con que se la mide, cuatro y
    medio: hay un tramo entero de corrimientos que puntuan casi igual.
    Quedarse con el primero deja la rejilla apoyada en el borde de ese tramo, y
    ese sesgo va siempre para el mismo lado — un pixel largo de error
    sistematico en la posicion de todas las cajas.
  */
  const meseta = mejorPuntajes.filter(([, v]) => v >= topeLocal - 1e-6).map(([d]) => d);
  const ang = meseta.map((d) => (2 * Math.PI * d) / paso);
  const crudo =
    (Math.atan2(
      ang.reduce((x, y) => x + Math.sin(y), 0),
      ang.reduce((x, y) => x + Math.cos(y), 0),
    ) * paso) / (2 * Math.PI);

  const vuelta = (d: number): number => {
    let x = d;
    while (x > paso / 2) x -= paso;
    while (x <= -paso / 2) x += paso;
    return x;
  };

  /*
    Y ahora de que lado. Las dos candidatas estan medio modulo aparte: la que
    encontro la temperatura y su opuesta. Gana la que deje el panel del lado
    LISO — no la que lo deje del lado caliente, que es lo que cambia con el sol.
  */
  const otro = vuelta(crudo + paso / 2);
  const lisoA = a.lisura(crudo), lisoB = a.lisura(otro);
  if (!Number.isFinite(lisoA) || !Number.isFinite(lisoB)) return null;
  if (Math.abs(lisoA - lisoB) < VENTAJA_DE_ASPEREZA) return null;
  const mejor = lisoA >= lisoB ? crudo : otro;

  const contrasteC = Math.abs(a.contraste(mejor));
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
  const lejos = (x: number, y: number): number => {
    const d = Math.abs(x - y) % paso;
    return Math.min(d, paso - d);
  };
  let segundo = -Infinity;
  for (const [d] of mejorPuntajes) {
    if (lejos(d, mejor) <= paso * 0.25 || lejos(d, otro) <= paso * 0.25) continue;
    const v = Math.abs(a.contraste(d));
    if (v > segundo) segundo = v;
  }
  if (Number.isFinite(segundo) && contrasteC - segundo < VENTAJA_MINIMA_C) return null;

  return {
    corrimientoPx: mejor,
    corrimientoModulos: mejor / paso,
    factor: mejorF,
    pasoPx: paso,
    contraste: contrasteC,
    modulos: orden.length,
  };
}

/**
 * Donde termina el panel, a lo largo de la fila. Es el ancla ABSOLUTA.
 *
 * Las juntas dicen donde esta la rejilla modulo a modulo, pero no cual es
 * cual: correr un modulo entero deja las juntas igual de bien puestas. Por eso
 * `corrimientoDeLaRejilla` busca en medio modulo para cada lado y no mas — y
 * ahi esta el agujero. Cuando el parque tiene la fila corrida justo medio
 * modulo, cualquiera de los dos lados vale lo mismo, y la app elige uno con
 * el ruido. Paso en la fila 2-37 del bloque 2: el parque decia 0,50, la caja
 * quedo sobre el ultimo panel de la fila y el informe lo llamo modulo 27. Es
 * el 28, y Mateo lo vio a ojo en la foto: es el ultimo antes de la calle.
 *
 * Lo que el vio es lo que se busca aca. La fila TERMINA, y donde termina se
 * ve: el desvio local pasa de 0,3 sobre el panel a mas de 1 sobre lo que
 * sigue, sea el motor, la calle o el pasto. Ese borde tiene nombre —es el
 * modulo 1 o el 28— asi que anclar la rejilla ahi fija no solo la fase sino
 * el NUMERO. Es exactamente contar desde la punta, que es lo que hace el
 * cliente con el informe en la mano.
 */

/** Por debajo de esto es panel; por encima, no. En desvio local. */
const PANEL_LISO = 0.8;
const NO_ES_PANEL = 1.1;
/**
 * Cuanto antes del borde fisico empieza a subir el desvio local.
 *
 * `desvioLocal` mira un radio de 3 px, asi que un pixel a 3 px del borde ya ve
 * lo que hay del otro lado. El cruce del umbral cae unos 3 px antes del
 * borde; se corrige sumandolos.
 */
const ADELANTO_DEL_BORDE_PX = 3;
/**
 * Hasta cuanto puede estar corrido el final de la fila. Mas es otro error.
 *
 * Dos modulos. Sobre Wellington el parque llega a tener la punta un modulo y
 * cuarto corrida (fila 1-9-motorizada, -1,25), y con uno y medio de busqueda
 * el borde real quedaba justo afuera del alcance en las filas peores.
 */
const BUSQUEDA_DEL_BORDE_MODULOS = 2;

export function bordeDelPanel(
  perfilAspero: Float64Array,
  t0: number,
  /** Centro del ultimo modulo que predice el parque, sobre el eje t. */
  centroUltimo: number,
  /** Hacia donde esta el final de la fila: +1 o -1 sobre t. */
  hacia: 1 | -1,
  pasoPx: number,
): number | null {
  const lee = (t: number) => enT(perfilAspero, t0, t);
  const alcance = BUSQUEDA_DEL_BORDE_MODULOS * pasoPx;

  /*
    Primero adentro, despues afuera. Se camina desde bien adentro de la fila
    hacia el final, y el borde es donde el panel se termina POR ULTIMA VEZ:
    el ultimo tramo liso seguido de un tramo aspero que no vuelve a ser liso
    en medio modulo. Asi una junta —aspera dos pixeles y liso otra vez— no
    se toma por el final.
  */
  const desde = centroUltimo - hacia * alcance;
  const hasta = centroUltimo + hacia * alcance;
  let ultimoLiso: number | null = null;
  let t = desde;
  while ((hasta - t) * hacia >= 0) {
    const v = lee(t);
    if (!Number.isFinite(v)) return null;          // se salio del cuadro: no hay borde que ver
    if (v < PANEL_LISO) ultimoLiso = t;
    else if (v >= NO_ES_PANEL && ultimoLiso != null) {
      // ¿Se queda aspero medio modulo? Si vuelve a ser liso, era una junta.
      let sigueAspero = true;
      for (let k = 1; k <= pasoPx * 0.5; k++) {
        const w = lee(t + hacia * k);
        if (!Number.isFinite(w)) break;
        if (w < PANEL_LISO) { sigueAspero = false; break; }
      }
      if (sigueAspero) return ultimoLiso + hacia * ADELANTO_DEL_BORDE_PX;
    }
    t += hacia * 0.5;
  }
  return null;
}

/**
 * Cuanto se repite el modulo a lo largo de un perfil: la prueba rapida de
 * "¿esto son modulos?".
 *
 * Es la autocorrelacion del perfil, con la tendencia sacada, a un paso de
 * modulo menos a medio paso. Una fila de paneles da 0,4 a 0,9: cada paso hay
 * una junta igual a la anterior, y a medio paso hay lo contrario. La sombra
 * del panel, la calle y el pasto dan cero o negativo: no tienen nada que se
 * repita cada 24,8 px.
 *
 * Se resta la de medio paso a proposito. La autocorrelacion sola le da un
 * numero alto al ruido con la tendencia sacada —se vio, 0,69 en ruido blanco—
 * y a medio paso ese ruido da lo mismo, asi que la resta lo deja en cero.
 *
 * Es mucho mas barata que buscar la rejilla entera, y por eso es la que se
 * usa para elegir entre las bandas lisas al alcance de una fila: hay que
 * preguntarlo en cada corrimiento posible, decenas de veces por fila.
 */
export function periodicidadDeModulos(perfilCrudo: Float64Array, pasoPx: number): number {
  /*
    Lo que cae fuera del cuadro no cuenta, pero tampoco anula.

    Una fila que cruza la foto entera termina fuera del cuadro por las dos
    puntas, y el perfil se pide medio modulo mas alla de la ultima caja: ahi no
    hay pixeles y el perfil trae NaN. Con un solo NaN esta prueba devolvia
    cero, y en el vuelo del bloque 2 eso paso en TODAS las filas vecinas —la
    repeticion no se vio nunca, y sin repeticion decidia la lisura, que
    prefiere la sombra. Se recortan las puntas vacias y se mide lo que hay.
  */
  let a = 0, b = perfilCrudo.length;
  while (a < b && !Number.isFinite(perfilCrudo[a]!)) a++;
  while (b > a && !Number.isFinite(perfilCrudo[b - 1]!)) b--;
  const perfil = perfilCrudo.subarray(a, b);
  const n = perfil.length;
  const k = Math.round(pasoPx), k2 = Math.round(pasoPx / 2);
  if (!(k > 2) || n < k * 3) return 0;

  const ventana = Math.max(3, Math.round(pasoPx * 2));
  const suave = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    // Un hueco en el medio si anula: no se sabe que hay ahi.
    if (!Number.isFinite(perfil[i]!)) return 0;
    let s = 0, m = 0;
    for (let j = Math.max(0, i - ventana); j <= Math.min(n - 1, i + ventana); j++) { s += perfil[j]!; m++; }
    suave[i] = perfil[i]! - s / m;
  }
  let cero = 0;
  for (let i = 0; i < n; i++) cero += suave[i]! * suave[i]!;
  if (cero <= 0) return 0;
  const r = (lag: number): number => {
    let s = 0;
    for (let i = 0; i + lag < n; i++) s += suave[i]! * suave[i + lag]!;
    return s / cero;
  };
  return r(k) - r(k2);
}

/**
 * Si en este punto de la fila hay un MODULO: una banda lisa con sus dos
 * bordes.
 *
 * Es la pregunta que le faltaba a `bordeDelPanel`. El final de la fila se
 * buscaba solo por aspereza a lo largo, y hay suelo que engaña: en la foto
 * 0215 del bloque 2, pasando el ultimo panel de la fila 2-8-esclava hay un
 * parche de tierra pisada, liso —0,6 a 1,0 de desvio local, lo mismo que una
 * junta— y siete grados mas caliente que el panel. El borde se encontro un
 * modulo mas alla, el modulo 1 se midio sobre ese parche y salio a +5,8 °C.
 *
 * Lo que el parche no tiene es forma de modulo: un panel visto desde arriba
 * es una banda lisa de un ancho conocido, con el suelo o la sombra a los dos
 * costados, y en esos dos costados el desvio local pega un salto. El parche
 * es liso para todos lados. Se mira el perfil de aspereza CRUZADO por el
 * centro del candidato: adentro tiene que ser liso y en los dos bordes,
 * aspero. Si un borde cae fuera del cuadro no se puede saber y se da por
 * bueno, como antes.
 */
export function tieneBordesCruzados(
  sd: Float32Array,
  ancho: number,
  alto: number,
  /** Centro del candidato, en pixeles de la imagen. */
  px: number,
  py: number,
  rotRad: number,
  /** Ancho del modulo cruzado a la fila, en pixeles. */
  cruzadoModuloPx: number,
  /** Paso entre modulos a lo largo, en pixeles: cuanto promediar a lo largo. */
  pasoPx: number,
): boolean {
  const medio = cruzadoModuloPx / 2;
  // El perfil "a lo largo" girado un cuarto de vuelta es el perfil cruzado, y
  // el ancho que promedia pasa a ser a lo largo de la fila: medio modulo.
  const p = perfilALoLargo(sd, ancho, alto, px, py, rotRad + Math.PI / 2, pasoPx * 0.6 / 0.35, -medio * 1.15, medio * 1.15);
  const t0 = -medio * 1.15;
  const lee = (v: number) => enT(p, t0, v);
  const adentro: number[] = [];
  for (let v = -medio * 0.4; v <= medio * 0.4; v += 1) {
    const x = lee(v);
    if (Number.isFinite(x)) adentro.push(x);
  }
  if (adentro.length < medio * 0.5) return true;
  adentro.sort((a, b) => a - b);
  const liso = adentro[adentro.length >> 1]!;

  const bordes = [-1, 1].map((lado) => {
    let tope = -Infinity, vistos = 0;
    for (let v = medio * 0.7; v <= medio * 1.15; v += 1) {
      const x = lee(lado * v);
      if (!Number.isFinite(x)) continue;
      vistos++;
      if (x > tope) tope = x;
    }
    return vistos ? tope : null;
  });
  // Un costado fuera del cuadro: no se puede saber, y se da por bueno.
  if (bordes.some((b) => b == null)) return true;
  return bordes.every((b) => b! >= BORDE_CRUZADO_MINIMO && b! >= liso * BORDE_SOBRE_EL_INTERIOR);
}

/**
 * Cuanto desvio local tiene que haber en el borde del modulo, y cuanto mas
 * que en su interior. Un borde de panel contra pasto o sombra da 1,4 a 2,9 en
 * las fotos de Wellington; el interior, 0,2 a 0,35. El parche de tierra da
 * 0,6 a 1,0 en todos lados: no tiene borde.
 */
const BORDE_CRUZADO_MINIMO = 1.0;
const BORDE_SOBRE_EL_INTERIOR = 2;
