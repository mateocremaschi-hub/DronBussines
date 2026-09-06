/**
 * Que ve la camara REFLEJADO en el vidrio del modulo.
 *
 * Un modulo es un espejo en infrarrojo. Lo que le llega a la camara no es solo
 * lo que el panel emite: es eso mas lo que el vidrio le devuelve de donde
 * apunta su rayo reflejado. Si ese rayo va al cielo, lo que devuelve es frio y
 * parejo, y en una comparacion contra los hermanos del string se cancela. Si
 * va al horizonte, devuelve filas vecinas y suelo —que en el vuelo del 4/9
 * estaban a 44-47 °C contra paneles a 37-40—, y encima con gradiente a lo
 * ancho del cuadro: ahi es cuando aparecen los bordes calientes y las filas
 * vecinas a +4 °C que Mateo vio a las 14:20.
 *
 * Y aparte esta el reflejo del SOL, que es otra cosa y mucho peor: una mancha
 * que satura. En un tracker de un eje norte-sur cae a lo largo de la fila, no
 * cruzado, porque el eje solo persigue la componente este-oeste del sol.
 *
 * Todo lo de aca es geometria de espejo: se conoce el angulo del tracker, la
 * inclinacion de la camara y donde esta el sol, y con eso alcanza. Lo que NO
 * modela es el backtracking —el motor tampoco—, y eso importa aca: al
 * aplanar el tracker de mas, el backtracking ACERCA el reflejo del sol al
 * cuadro. Fuera de 9 a 15 h el veredicto del sol es optimista y se dice.
 */

import { posicionSolar } from "@locator";

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

type V3 = readonly [number, number, number];

/** Vector unitario al sol, en este-norte-arriba. */
function alSol(alturaDeg: number, azimutDeg: number): V3 {
  const e = alturaDeg * RAD;
  const a = azimutDeg * RAD;
  return [Math.cos(e) * Math.sin(a), Math.cos(e) * Math.cos(a), Math.sin(e)];
}

/** El perpendicular del panel. `theta` positivo = mirando al este. */
function perpendicular(thetaDeg: number): V3 {
  const t = thetaDeg * RAD;
  return [Math.sin(t), 0, Math.cos(t)];
}

/** Refleja `v` en el espejo de perpendicular `n`. */
function espejar(n: V3, v: V3): V3 {
  const d = 2 * (n[0] * v[0] + n[1] * v[1] + n[2] * v[2]);
  return [d * n[0] - v[0], d * n[1] - v[1], d * n[2] - v[2]];
}

const elevacion = (v: V3) => Math.asin(Math.max(-1, Math.min(1, v[2]))) * DEG;

export interface Reflejo {
  /** Elevacion del rayo reflejado en el centro del cuadro, en grados. */
  centroDeg: number;
  /** La PEOR de las dos, que es la que manda: el borde lejano al dron. */
  bordeDeg: number;
  /** El reflejo del sol cae adentro del cuadro. */
  solEnElCuadro: boolean;
  /** A cuantos grados del borde del cuadro queda el reflejo del sol. */
  margenDelSolDeg: number;
  /** El veredicto en una palabra. */
  veredicto: "limpio" | "al filo" | "sucio";
  /** Por que, para decirlo en pantalla. */
  porQue: string;
}

/**
 * Cuanto tiene que subir el rayo reflejado para dar el cuadro por limpio.
 *
 * Veinte grados: por debajo de eso el vidrio empieza a devolver las filas
 * vecinas del parque —que a 5,3 m de paso y 30 m de altura entran en el cuadro
 * a partir de unos 20 grados de elevacion— y no cielo.
 */
export const CIELO_LIMPIO_DEG = 20;

/**
 * Que va a ver la camara reflejado, a esa hora y con esa inclinacion.
 *
 * `desvioDeg` es la inclinacion de la camara desde la vertical, con el mismo
 * signo que el angulo del tracker: igual al del tracker es perpendicular al
 * panel, cero es a plomo.
 */
export function reflejoDelVidrio(
  lat: number,
  lon: number,
  cuando: Date,
  trackerDeg: number,
  desvioDeg: number,
  hfovDeg: number,
  vfovDeg: number,
): Reflejo {
  const n = perpendicular(trackerDeg);
  const sol = posicionSolar(lat, lon, cuando);
  const s = alSol(sol.alturaDeg, sol.azimutDeg);

  // El rayo de la camara, en el centro y en los dos bordes cruzados.
  const elevaciones = [0, -hfovDeg / 2, hfovDeg / 2].map((borde) => {
    const p = (desvioDeg + borde) * RAD;
    return elevacion(espejar(n, [Math.sin(p), 0, Math.cos(p)]));
  });
  const centroDeg = elevaciones[0]!;
  const bordeDeg = Math.min(elevaciones[1]!, elevaciones[2]!);

  /*
    Y el reflejo del sol, en coordenadas del cuadro.

    Cruzado es el eje sobre el que gira el tracker; a lo largo es el eje del
    tracker, que es donde el cuadro es mas angosto y donde cae el reflejo del
    sol en un tracker de un eje.
  */
  const m = espejar(n, s);
  const p = desvioDeg * RAD;
  const v: V3 = [Math.sin(p), 0, Math.cos(p)];
  const cruz: V3 = [Math.cos(p), 0, -Math.sin(p)];
  const largo: V3 = [0, 1, 0];
  const haciaAdelante = m[0] * v[0] + m[1] * v[1] + m[2] * v[2];
  let solEnElCuadro = false;
  let margenDelSolDeg = 90;
  if (haciaAdelante > 0) {
    const c = Math.atan2(m[0] * cruz[0] + m[2] * cruz[2], haciaAdelante) * DEG;
    const l = Math.atan2(m[1] * largo[1], haciaAdelante) * DEG;
    const mc = hfovDeg / 2 - Math.abs(c);
    const ml = vfovDeg / 2 - Math.abs(l);
    solEnElCuadro = mc > 0 && ml > 0;
    margenDelSolDeg = solEnElCuadro ? -Math.min(mc, ml) : Math.max(mc, ml) < 0
      ? Math.min(Math.abs(mc), Math.abs(ml))
      : Math.max(-mc, -ml);
  }

  if (solEnElCuadro) {
    return {
      centroDeg, bordeDeg, solEnElCuadro, margenDelSolDeg,
      veredicto: "sucio",
      porQue: "El reflejo del sol cae adentro del cuadro: va a salir una mancha que satura. " +
        "Corré el vuelo una hora, o volá con la cámara a plomo y aceptá el reflejo del horizonte.",
    };
  }
  if (bordeDeg >= CIELO_LIMPIO_DEG) {
    return {
      centroDeg, bordeDeg, solEnElCuadro, margenDelSolDeg,
      veredicto: "limpio",
      porQue: `Todo el cuadro refleja cielo: ${bordeDeg.toFixed(0)}° de elevación en el borde ` +
        "más bajo. Lo que el vidrio devuelve es frío y parejo, y se cancela al comparar " +
        "contra los hermanos del string.",
    };
  }
  if (bordeDeg >= 0) {
    return {
      centroDeg, bordeDeg, solEnElCuadro, margenDelSolDeg,
      veredicto: "al filo",
      porQue: `El borde del cuadro refleja a ${bordeDeg.toFixed(0)}° de elevación: cerca del ` +
        "horizonte. Puede aparecer algo de las filas vecinas en ese borde. Una hora más tarde " +
        "se limpia.",
    };
  }
  return {
    centroDeg, bordeDeg, solEnElCuadro, margenDelSolDeg,
    veredicto: "sucio",
    porQue: `El borde del cuadro refleja por DEBAJO del horizonte (${bordeDeg.toFixed(0)}°): ` +
      "el vidrio devuelve suelo y filas vecinas, más caliente que los paneles y con gradiente " +
      "a lo ancho de la foto. Es lo que ensucia la comparación entre hermanos de string.",
  };
}
