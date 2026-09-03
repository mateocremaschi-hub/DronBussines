/**
 * Enganchar la rejilla de modulos a los paneles que se ven en la foto.
 *
 * El motor ubica cada modulo por GPS: sabe donde esta el dron, hacia donde
 * mira y cuanto abarca el cuadro, y con eso proyecta cada modulo del parque a
 * un pixel de la imagen. Eso funciona mientras el GPS sea bueno.
 *
 * No lo es. Un dron sin RTK trae 1 a 2 metros de error horizontal, y la caja
 * con la que se mide un modulo mide 1,3 m de ancho. Con 1,3 m de error la caja
 * se sale ENTERA del panel y aterriza en la franja de sombra fria que queda al
 * costado de cada fila.
 *
 * Y no avisa. Sigue midiendo, sigue dando un numero, y la comparacion contra
 * los hermanos de string tampoco lo detecta porque el error es SISTEMATICO:
 * todas las cajas de esa foto se corren igual, la mediana del string se corre
 * con ellas y cada modulo da delta T cero. Lo que sale es la textura del suelo
 * reportada como puntos calientes de celda. Medido sobre las fotos del 3 de
 * septiembre en Edenvale: 31 hallazgos en 3 fotos, todos falsos, todos
 * leyendo 31-34 °C cuando los paneles de esa misma foto estaban a 41-42.
 *
 * La salida es dejar de creerle al GPS para el ajuste fino. Un panel en una
 * termica es una superficie LISA; el pasto y la sombra del borde de la fila
 * son ruido. Asi que se corre la rejilla entera hasta que caiga sobre lo liso,
 * y esa correccion —unos pocos pixeles— se aplica a todas las cajas de esa
 * foto. El GPS sigue decidiendo QUE modulos entran en el cuadro, que es para
 * lo que alcanza de sobra; la foto decide DONDE estan.
 *
 * Medido sobre la foto real: el objetivo vale 0,23 °C bien alineado y 1,5 °C
 * corrido treinta pixeles, con pendiente suave alrededor — o sea que la
 * busqueda no tiene donde trabarse. Y las cajas pasan de 100 % lisas bien
 * alineadas a 17 % con el corrimiento que traia el vuelo.
 */

import type { Radiometric } from "./thermal";

/**
 * Cuan lisa es cada zona de la imagen: el desvio de cada pixel contra sus
 * vecinos.
 *
 * El interior de un panel da 0,15-0,56 °C. El pasto da 1,3-1,6. La franja de
 * sombra al borde de una fila da 1,3-2,6. Esa separacion es lo que hace
 * posible todo lo demas.
 *
 * Se calcula con sumas acumuladas —dos barridos de la imagen— porque hay que
 * hacerlo una vez por foto y un vuelo son cientos.
 */
export function desvioLocal(r: Radiometric, radio = 3): Float32Array {
  const { width: w, height: h, celsius } = r;
  // Sumas acumuladas de x y de x², con una fila y una columna de ceros
  // adelante para no tener que preguntar por los bordes adentro del ciclo.
  const s = new Float64Array((w + 1) * (h + 1));
  const s2 = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = celsius[y * w + x]!;
      const i = (y + 1) * (w + 1) + (x + 1);
      s[i] = v + s[i - 1]! + s[i - (w + 1)]! - s[i - (w + 2)]!;
      s2[i] = v * v + s2[i - 1]! + s2[i - (w + 1)]! - s2[i - (w + 2)]!;
    }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - radio), y1 = Math.min(h - 1, y + radio);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - radio), x1 = Math.min(w - 1, x + radio);
      const a = (y1 + 1) * (w + 1), b = y0 * (w + 1), c = x1 + 1, d = x0;
      const cuentas = (y1 - y0 + 1) * (x1 - x0 + 1);
      const suma = s[a + c]! - s[a + d]! - s[b + c]! + s[b + d]!;
      const suma2 = s2[a + c]! - s2[a + d]! - s2[b + c]! + s2[b + d]!;
      const media = suma / cuentas;
      out[y * w + x] = Math.sqrt(Math.max(0, suma2 / cuentas - media * media));
    }
  }
  return out;
}

/** Una caja de medicion, en pixeles de la imagen termica. */
export interface Caja {
  cx: number;
  cy: number;
  /** A lo largo de la fila. */
  largo: number;
  /** Cruzado a la fila. */
  cruzado: number;
  rotRad: number;
}

/**
 * Cuantos puntos se miran adentro de cada caja.
 *
 * Con 24 alcanza: no se busca el detalle del panel, se busca si la caja esta
 * sobre algo liso o sobre algo ruidoso, y eso se decide con pocas muestras.
 * Mirar todos los pixeles de todas las cajas para cada uno de los cientos de
 * corrimientos que se prueban costaria mil veces mas y no cambiaria el minimo.
 */
const FILAS_DE_SONDEO = 4;
const COLUMNAS_DE_SONDEO = 6;

/** Los puntos de sondeo de una caja, en su propio marco, de -0,5 a 0,5. */
const SONDEOS: Array<{ a: number; b: number }> = (() => {
  const out: Array<{ a: number; b: number }> = [];
  for (let i = 0; i < COLUMNAS_DE_SONDEO; i++) {
    for (let j = 0; j < FILAS_DE_SONDEO; j++) {
      out.push({
        a: (i + 0.5) / COLUMNAS_DE_SONDEO - 0.5,
        b: (j + 0.5) / FILAS_DE_SONDEO - 0.5,
      });
    }
  }
  return out;
})();

export interface Sondeo {
  /**
   * Cuan lisa esta la caja: la MEDIANA del desvio local de sus puntos.
   *
   * Mediana y no promedio, y esto no es un detalle. Un modulo con la franja
   * caliente de un diodo tiene bordes duros adentro: su desvio PROMEDIO da
   * 2,01 °C, igual que el pasto (1,84). Con la mediana da 1,56 contra 0,20 de
   * un modulo sano — pero lo que importa no es el numero, es que el defecto es
   * minoria adentro de su propia caja y la mediana lo ignora. Con el promedio,
   * el freno que busca cajas mal puestas descartaria justo los modulos rotos.
   */
  liso: number;
  /** La temperatura de la caja, por mediana de los mismos puntos. */
  celsius: number;
  /**
   * Que fraccion de los puntos de la caja cae sobre panel, punto por punto.
   *
   * Es lo que centra la caja, y hace falta aparte de `liso` por una razon
   * concreta: `liso` es una MEDIANA, asi que no se entera de que un sexto de
   * la caja este afuera del modulo. Y un sexto afuera alcanza para arruinar la
   * medicion, porque lo que hay al lado —pasto a +5 °C, sombra a −10— se
   * despega del panel mucho mas que cualquier defecto.
   *
   * Medido sobre el vuelo real: un modulo con la caja corrida cinco pixeles
   * daba una franja de 45 °C sobre un panel de 41,5, y salia clasificado como
   * "punto caliente". Era el pasto de al lado.
   *
   * Un punto es panel si esta liso y si su temperatura no se despega de la
   * MEDIANA DE SU PROPIA CAJA. Relativo a la caja y no a la foto: lo que rodea
   * a un modulo no siempre es pasto ruidoso — en el vuelo real lo que se comia
   * la caja era el riel de aluminio a 45 °C y el hueco frio a 39,6, los dos
   * tan lisos como el panel de 41,5 que hay en el medio.
   *
   * Este criterio si mira lo caliente, y por eso NO decide descartes: solo
   * centra. Un defecto es minoria en una foto —dos modulos entre cien— asi que
   * mueve el promedio un uno por ciento, mientras que una caja corrida afecta
   * a TODAS por igual. Los frenos que descartan siguen mirando solo el lado
   * frio.
   */
  fraccionPanel: number;
}

/**
 * Mira una caja por encima: cuan lisa esta y a que temperatura.
 *
 * Devuelve null si se sale del cuadro. Una caja a medias afuera no se puede
 * juzgar asi, y no hace falta: ese caso lo resuelve el conteo de pixeles
 * cuando se la mide de verdad, que ademas sabe distinguirlo de una caja mal
 * puesta.
 */
export function sondearCaja(
  r: Radiometric,
  sd: Float32Array,
  caja: Caja,
  dx = 0,
  dy = 0,
): Sondeo | null {
  const n = juntarSondeos(r, sd, caja, dx, dy);
  if (n == null) return null;
  const fraccionPanel = ULTIMOS_DE_PANEL / n;
  const celsius = ULTIMA_MEDIANA_C;
  return { liso: medianaEnSitio(BUF_LISO, n), celsius, fraccionPanel };
}

/**
 * Solo que fraccion de la caja cae sobre panel.
 *
 * Existe aparte porque la busqueda del corrimiento la llama unas seis mil
 * veces por foto y no necesita la mediana de textura, que es el ordenamiento
 * mas caro de los dos.
 */
function panelDeCaja(
  r: Radiometric,
  sd: Float32Array,
  caja: Caja,
  dx: number,
  dy: number,
): number | null {
  const n = juntarSondeos(r, sd, caja, dx, dy);
  return n == null ? null : ULTIMOS_DE_PANEL / n;
}

/*
  Los sondeos se juntan en dos buffers fijos que se reusan.

  Son 24 numeros por caja y la busqueda mira miles de cajas por foto: pedir dos
  arreglos nuevos cada vez es lo unico que se notaba en el perfil. No hay
  concurrencia — todo esto corre en un solo hilo, de a una foto.
*/
const BUF_LISO = new Float64Array(SONDEOS.length);
const BUF_TEMP = new Float64Array(SONDEOS.length);
const BUF_ORD = new Float64Array(SONDEOS.length);

/**
 * Cuanto se puede despegar un punto de la mediana de su caja y seguir siendo
 * panel.
 *
 * El interior de un modulo se mueve 0,4-0,8 °C, asi que un grado y medio es
 * mas de tres veces eso. Lo que queda afuera con este margen es lo que hay
 * alrededor del modulo: el riel a +3,5 y el hueco a -1,9.
 */
const MARGEN_DE_PANEL_C = 1.5;
/** Cuantos de los puntos del ultimo sondeo cayeron sobre panel. */
let ULTIMOS_DE_PANEL = 0;

function juntarSondeos(
  r: Radiometric,
  sd: Float32Array,
  caja: Caja,
  dx: number,
  dy: number,
): number | null {
  const { width: w, height: h } = r;
  const cos = Math.cos(caja.rotRad), sin = Math.sin(caja.rotRad);
  let n = 0;
  for (const { a, b } of SONDEOS) {
    const u = a * caja.largo, v = b * caja.cruzado;
    const x = Math.round(caja.cx + dx + u * cos - v * sin);
    const y = Math.round(caja.cy + dy + u * sin + v * cos);
    if (x < 0 || y < 0 || x >= w || y >= h) continue;
    BUF_LISO[n] = sd[y * w + x]!;
    BUF_TEMP[n] = r.celsius[y * w + x]!;
    n++;
  }
  if (n < SONDEOS.length * 0.75) return null;

  BUF_ORD.set(BUF_TEMP.subarray(0, n));
  const med = medianaEnSitio(BUF_ORD, n);
  let dePanel = 0;
  for (let i = 0; i < n; i++) {
    if (BUF_LISO[i]! <= LISO_C && Math.abs(BUF_TEMP[i]! - med) <= MARGEN_DE_PANEL_C) dePanel++;
  }
  ULTIMOS_DE_PANEL = dePanel;
  ULTIMA_MEDIANA_C = med;
  return n;
}

/** La mediana de temperatura del ultimo sondeo, ya calculada. */
let ULTIMA_MEDIANA_C = 0;

/** Mediana de los primeros `n` del buffer, ordenandolo en el lugar. */
function medianaEnSitio(buf: Float64Array, n: number): number {
  const v = buf.subarray(0, n);
  v.sort();
  const m = n >> 1;
  return n % 2 ? v[m]! : (v[m - 1]! + v[m]!) / 2;
}

/**
 * Hacia donde corren las filas en esta foto.
 *
 * Todas las cajas de una foto suelen tener el mismo angulo —es el rumbo de la
 * fila— pero pueden entrar dos bloques con rumbos apenas distintos, asi que se
 * promedia como direccion y no como numero: promediar 179° y -179° a mano da
 * cero grados, que es perpendicular a las dos.
 */
function anguloTipico(cajas: Caja[]): number {
  let sx = 0, sy = 0;
  for (const c of cajas) { sx += Math.cos(2 * c.rotRad); sy += Math.sin(2 * c.rotRad); }
  return Math.atan2(sy, sx) / 2;
}

function mediana(v: number[]): number {
  const o = [...v].sort((a, b) => a - b);
  const m = o.length >> 1;
  return o.length % 2 ? o[m]! : (o[m - 1]! + o[m]!) / 2;
}

/** El corrimiento que encontro el enganche, en pixeles de la imagen. */
export interface Encaje {
  dx: number;
  dy: number;
  /**
   * Cuanto hay que girar el cuadro, en grados.
   *
   * Con corrimiento solo no alcanzaba, y el retrato de los modulos decia por
   * que: el borde de la caja se despegaba -3,5 °C en una punta de la fila y
   * +1,5 en la otra, cambiando de a poco entre medio. Eso no es un
   * corrimiento, es un GIRO — y tiene de donde salir: la huella de la foto se
   * orienta con el rumbo del gimbal, y una brujula de dron trae uno o dos
   * grados de error. Un grado sobre una huella de 32 m son 56 cm en el borde
   * del cuadro, mas que el margen que deja la caja.
   */
  giroDeg: number;
  /** Que fraccion de lo medido caia sobre panel antes de correr las cajas, y despues. */
  antes: number;
  despues: number;
  /** Cuanto se corrio, en metros sobre el terreno. Es lo que se le muestra. */
  metros: number;
}

/** Desvio local por debajo del cual una caja esta sobre un panel. */
export const LISO_C = 1;

/**
 * Cuantas cajas mas tienen que quedar sobre un panel para creerle al
 * corrimiento, como fraccion del total.
 *
 * El objetivo CUENTA cajas lisas en vez de promediar cuan lisas estan, y eso
 * no es un detalle: con el promedio, la busqueda se escapa de cualquier cosa
 * que tenga estructura, incluido un modulo roto. En una escena de prueba con
 * un solo modulo caliente sobre un campo parejo, el promedio bajaba de 0,345 a
 * 0 corriendo la rejilla 23 px justo para dejar el defecto afuera. Contando
 * cajas eso no puede pasar: una caja que ya esta lisa no se puede mejorar, y
 * un modulo roto entre cientos mueve el conteo en uno.
 *
 * Un cinco por ciento es mucho mas que el ruido y mucho menos que lo que hay
 * en juego: en la foto real el corrimiento llevaba las cajas lisas del 17 % al
 * 100 %. Puede quedar bajo porque el enganche solo se mueve a donde MAS cajas
 * caen sobre panel, asi que moverse nunca empeora — el umbral esta para no
 * moverse al pedo, no para protegerse de moverse.
 */
const MEJORA_MINIMA_FRACCION = 0.05;

/** Con menos cajas que esto no hay con que promediar y no se engancha. */
const CAJAS_MINIMAS = 8;

/**
 * Busca el corrimiento de esta foto.
 *
 * `maxPx` acota la busqueda y es lo mas importante de la funcion: tiene que
 * ser menos de MEDIA separacion entre filas. Si se le deja mas, el mejor
 * puntaje lo puede dar la fila de al lado —que tambien es lisa y tambien es un
 * panel— y entonces el enganche queda perfecto y todos los modulos son el
 * vecino. Un informe entero corrido una fila, sin un solo sintoma.
 *
 * Barre grueso y despues fino: primero cada 2 px sobre todo el rango, despues
 * de a 1 px alrededor del mejor. Un barrido fino de todo el rango costaria
 * cuatro veces mas para encontrar el mismo minimo, porque la pendiente es
 * suave.
 */
export function engancharFoto(
  r: Radiometric,
  sd: Float32Array,
  cajas: Caja[],
  maxPx: number,
  mPorPx: number,
): Encaje | null {
  if (cajas.length < CAJAS_MINIMAS || maxPx < 1) return null;

  /**
   * Que fraccion de TODO lo que se va a medir cae sobre panel.
   *
   * Se cuenta punto por punto y no caja por caja, y ahi esta la diferencia que
   * importa: contando cajas, una caja con un sexto afuera del modulo cuenta
   * igual que una perfecta, y la busqueda se queda conforme dejandola corrida.
   * Fue exactamente lo que paso en el vuelo real — el enganche puso las cajas
   * "sobre panel" pero cinco pixeles corridas, y una franja de pasto a 45 °C
   * entro en la medicion de un panel de 41,5 y salio como punto caliente.
   */
  const centroX = r.width / 2, centroY = r.height / 2;
  const puntaje = (dx: number, dy: number, giroDeg: number): { panel: number; n: number } => {
    let suma = 0, n = 0;
    for (const c0 of cajas) {
      const c = girar(c0, giroDeg, centroX, centroY);
      const f = panelDeCaja(r, sd, c, dx, dy);
      if (f == null) continue;
      suma += f;
      n++;
    }
    return { panel: n ? suma / n : 0, n };
  };

  const base = puntaje(0, 0, 0);
  if (base.n < CAJAS_MINIMAS) return null;

  /*
    Se corrige SOLO cruzado a la fila, y esto es una limitacion de verdad, no
    una simplificacion.

    Una fila de modulos es igual a lo largo: correr la rejilla un metro en ese
    sentido la deja cayendo sobre panel igual, asi que el enganche no tiene con
    que ver la diferencia y elegiria cualquier cosa. Cruzado a la fila es al
    reves — medio metro para el costado y la caja empieza a comer pasto.

    Y justo cruzado es donde el error hace dano: un corrimiento a lo largo
    reporta el modulo de al lado (la cuadrilla camina un panel de mas y el
    defecto esta ahi), uno cruzado mide el suelo y lo llama defecto.
  */
  const ang = anguloTipico(cajas);
  const ux = -Math.sin(ang), uy = Math.cos(ang);

  let mejorT = 0, mejorGiro = 0, mejor = base;
  const considerar = (t: number, giroDeg: number) => {
    const dx = Math.round(t * ux), dy = Math.round(t * uy);
    const p = puntaje(dx, dy, giroDeg);
    // Se exige que la foto siga juzgandose con casi las mismas cajas: sin eso,
    // correr la rejilla hacia adentro del cuadro "mejora" el promedio sumando
    // cajas que antes se salian, sin que nada se haya acomodado.
    if (p.n < CAJAS_MINIMAS || p.n < base.n * 0.8) return;
    const gana =
      p.panel > mejor.panel + 1e-9 ||
      (Math.abs(p.panel - mejor.panel) <= 1e-9 && Math.abs(t) < Math.abs(mejorT));
    if (gana) { mejor = p; mejorT = t; mejorGiro = giroDeg; }
  };

  const lim = Math.round(maxPx);
  for (let g = -GIRO_MAXIMO_DEG; g <= GIRO_MAXIMO_DEG + 1e-9; g += PASO_DE_GIRO_DEG) {
    for (let t = -lim; t <= lim; t += 2) considerar(t, g);
  }
  for (let t = mejorT - 2; t <= mejorT + 2; t++) considerar(t, mejorGiro);

  const mejorX = Math.round(mejorT * ux), mejorY = Math.round(mejorT * uy);

  /*
    Si no mejora bastante, no se toca nada. Este es el freno que impide
    "mejorar" una foto que ya estaba bien: sin el, la rejilla se correria unos
    pixeles detras del ruido.
  */
  if (mejor.panel - base.panel < MEJORA_MINIMA_FRACCION) return null;
  return {
    dx: mejorX,
    dy: mejorY,
    antes: base.panel,
    despues: mejor.panel,
    giroDeg: mejorGiro,
    metros: Math.hypot(mejorX, mejorY) * mPorPx,
  };
}

/**
 * Cuanto se acepta girar el cuadro.
 *
 * Es el error de una brujula de dron. Mas que esto ya no es la brujula: seria
 * la geometria del parque, y eso no se arregla girando una foto.
 */
const GIRO_MAXIMO_DEG = 1.5;
const PASO_DE_GIRO_DEG = 0.25;

/** Gira una caja alrededor del centro del cuadro. */
export function girar(c: Caja, giroDeg: number, centroX: number, centroY: number): Caja {
  if (!giroDeg) return c;
  const a = (giroDeg * Math.PI) / 180;
  const cos = Math.cos(a), sin = Math.sin(a);
  const dx = c.cx - centroX, dy = c.cy - centroY;
  return {
    ...c,
    cx: centroX + dx * cos - dy * sin,
    cy: centroY + dx * sin + dy * cos,
    rotRad: c.rotRad + a,
  };
}

/**
 * Que fraccion de las cajas tiene que estar sobre un panel para creerle a la
 * foto.
 *
 * Es generoso a proposito: un vuelo real trae modulos rotos, filas de punta y
 * cajas medio afuera del cuadro, y ninguna de esas cosas es un problema. Lo
 * que este numero tiene que agarrar es la foto que quedo entera corrida, que
 * es un caso muy distinto: sobre la foto real, bien alineada da 100 % de cajas
 * lisas, y con el corrimiento que traia el vuelo da 17 %.
 */
export const FRACCION_LISA_MINIMA = 0.5;

/**
 * Cuanto mas fria que su propia foto puede estar una caja antes de no creerle.
 *
 * Este freno mira solo el lado FRIO, y es a proposito. Un defecto siempre
 * calienta: no existe el modulo que se rompe y se enfria. Asi que descartar
 * por frio no puede tirar un hallazgo, mientras que descartar por caliente o
 * por textura si — la franja de un diodo de bypass tiene la misma textura que
 * el pasto.
 *
 * Lo que si esta frio es la sombra al borde de la fila: 31 °C contra 41-46 de
 * los paneles de la misma foto.
 */
export const FRIO_QUE_NO_ES_PANEL_C = 5;

/** Como quedo una foto despues de intentar engancharla. */
export interface Confianza {
  /** Que fraccion de lo que se va a medir cayo sobre panel. */
  fraccionLisa: number;
  /** La temperatura tipica de las cajas de esta foto. */
  medianaC: number;
  /** Si se le puede creer a la foto. */
  sirve: boolean;
}

/**
 * Decide si la foto quedo bien puesta, mirando TODAS sus cajas juntas.
 *
 * Este es el freno que faltaba, y es a nivel foto y no a nivel caja por una
 * razon: la falla que hubo que arreglar corre a todas las cajas por igual, asi
 * que se ve en el conjunto y no en ninguna caja sola. Al reves, un modulo
 * suelto que se ve raro es justo lo que se esta buscando — un freno por caja
 * que mire textura descartaria los defectos.
 */
export function confianzaDeFoto(sondeos: Array<Sondeo | null>): Confianza {
  const vivos = sondeos.filter((s): s is Sondeo => s != null);
  if (!vivos.length) return { fraccionLisa: 0, medianaC: 0, sirve: false };
  const fraccionLisa =
    vivos.reduce((a, s) => a + s.fraccionPanel, 0) / vivos.length;
  return {
    fraccionLisa,
    medianaC: mediana(vivos.map((s) => s.celsius)),
    sirve: fraccionLisa >= FRACCION_LISA_MINIMA,
  };
}


// ---------------------------------------------------------------------------
// La escala, sacada de la propia imagen
// ---------------------------------------------------------------------------

/**
 * Cuanto hay que achicar o agrandar la huella de la foto.
 *
 * La huella se calcula con la altura del EXIF y el campo de vision de la
 * camara, y sale mal. Medido sobre las tres fotos del Matrice 4T contra dos
 * distancias que Mateo midio con cinta —el paso entre modulos, 1155 mm, y la
 * separacion entre filas, 5460— el EXIF exagera la escala un 4 a 5 % en las
 * tres.
 *
 * La causa mas probable es que la "altura relativa" del EXIF se mide contra el
 * punto de despegue, que es el SUELO, y los paneles estan dos metros mas
 * arriba. A cincuenta metros, dos metros son exactamente el 4 %.
 *
 * Cuatro por ciento parece poco y no lo es: sobre un cuadro de 640 px son 26
 * px en el borde, que a 5 cm/px son 1,3 m sobre el terreno. Es del mismo
 * tamaño que el error de GPS que costo el dia entero — y peor, porque un error
 * de escala CRECE desde el centro hacia afuera, asi que no lo arregla ningun
 * corrimiento ni ningun giro.
 *
 * La imagen tiene la respuesta: los modulos se repiten con un paso conocido,
 * medido con cinta, y ese paso se puede contar en pixeles. Contra eso se
 * calibra la escala sin creerle ni a la altura ni al campo de vision.
 */

/** Cuanto se acepta corregir la escala. Mas que esto no es la altura del panel. */
const CORRECCION_MAXIMA = 0.15;

/** Debajo de esta fuerza de repeticion no se le cree al paso detectado. */
const REPETICION_MINIMA = 0.2;

/**
 * Cuenta el paso entre modulos a lo largo de una fila, en pixeles.
 *
 * Se muestrea la imagen sobre la linea que recorre la fila —ya se sabe hacia
 * donde corre, la trae la geometria del parque— y se autocorrelaciona el
 * perfil. Las juntas entre modulos se ven como minimos regulares.
 */
export function pasoEnLaImagen(
  r: Radiometric,
  centro: { cx: number; cy: number },
  rotRad: number,
  largoPx: number,
  cruzadoPx: number,
  pasoEsperadoPx: number,
): { pasoPx: number; fuerza: number } | null {
  const cos = Math.cos(rotRad), sin = Math.sin(rotRad);
  // Un tramo largo a lo largo de la fila: cuantos mas modulos entren, mejor
  // sale la cuenta. Y angosto cruzado, para no tocar el borde del panel.
  const n = Math.round(largoPx);
  if (n < pasoEsperadoPx * 4) return null;
  /*
    Se promedia sobre casi todo el ancho del panel. Con una tira angosta la
    repeticion de las juntas se pierde en el ruido del sensor: sobre las fotos
    reales, con el 30 % del ancho contaba una fila de cinco, y con el 80 %
    cuentan casi todas.
  */
  const anchoMedio = Math.max(1, Math.round(cruzadoPx * 0.4));

  const perfil = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const u = i - n / 2;
    let suma = 0, m = 0;
    for (let k = -anchoMedio; k <= anchoMedio; k++) {
      const x = Math.round(centro.cx + u * cos - k * sin);
      const y = Math.round(centro.cy + u * sin + k * cos);
      if (x < 0 || y < 0 || x >= r.width || y >= r.height) continue;
      suma += r.celsius[y * r.width + x]!;
      m++;
    }
    if (!m) return null;
    perfil[i] = suma / m;
  }

  // Sacarle la tendencia lenta: lo que interesa es la repeticion, no que un
  // extremo de la fila este mas caliente que el otro.
  const ventana = Math.max(3, Math.round(pasoEsperadoPx * 2));
  const suave = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0, m = 0;
    for (let k = -ventana; k <= ventana; k++) {
      const j = i + k;
      if (j < 0 || j >= n) continue;
      s += perfil[j]!; m++;
    }
    suave[i] = perfil[i]! - s / m;
  }

  let cero = 0;
  for (let i = 0; i < n; i++) cero += suave[i]! * suave[i]!;
  if (cero <= 0) return null;

  // El pico de autocorrelacion mas fuerte, buscado alrededor de lo esperado.
  const desde = Math.max(4, Math.floor(pasoEsperadoPx * 0.7));
  const hasta = Math.min(n - 2, Math.ceil(pasoEsperadoPx * 1.4));
  let mejorK = 0, mejor = 0;
  for (let k = desde; k <= hasta; k++) {
    let s = 0;
    for (let i = 0; i + k < n; i++) s += suave[i]! * suave[i + k]!;
    const v = s / cero;
    if (v > mejor) { mejor = v; mejorK = k; }
  }
  return mejorK && mejor >= REPETICION_MINIMA ? { pasoPx: mejorK, fuerza: mejor } : null;
}

/**
 * El factor por el que hay que multiplicar la huella de la foto.
 *
 * Uno significa que la escala del EXIF estaba bien. Devuelve null cuando no se
 * pudo contar el paso en ninguna fila: entonces se deja la escala del EXIF,
 * que es lo unico que hay.
 */
export function escalaDeLaImagen(
  medidas: Array<{ pasoPx: number; esperadoPx: number }>,
): number | null {
  const factores = medidas
    .map((m) => m.esperadoPx / m.pasoPx)
    .filter((f) => Math.abs(f - 1) <= CORRECCION_MAXIMA);
  if (factores.length < 2) return null;
  const f = mediana(factores);
  return Math.abs(f - 1) < 0.005 ? 1 : f;
}
