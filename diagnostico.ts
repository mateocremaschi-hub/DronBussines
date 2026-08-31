/**
 * Que regla esta mal, a partir de los desacuerdos.
 *
 * La app venia diciendo "un desacuerdo es un dato, no un error: casi siempre
 * hay una regla que falta declarar" y despues no hacia nada con el dato. Este
 * modulo cumple esa promesa.
 *
 * El caso que lo motivo, con numeros reales de Edenvale, tracker 04-018:
 *
 *     la app dijo 11 → conto 19      suma 30
 *     la app dijo 26 → conto  3      suma 29
 *     la app dijo  2 → conto 25      suma 27
 *     la app dijo  1 → conto 28      suma 29
 *
 * Cuatro desacuerdos que parecian un desastre. Pero en un string de 28, contar
 * desde la otra punta convierte el modulo k en el 29 − k: si las sumas dan 29,
 * no esta mal, esta al reves. Y ademas prueba algo que ninguna cuenta podia
 * probar — que el paso y los huecos estan bien, porque si estuvieran mal las
 * sumas se irian corriendo de una punta a la otra en vez de quedarse en 29.
 *
 * El diagnostico no se hace con esa aritmetica, igual. Se hace PROBANDO: se
 * recompila la fila con cada combinacion de reglas y se mira cual habria
 * acertado los conteos. Es la misma decision que en el buscador de offset —
 * la fuerza bruta no se equivoca de signo, y estas reglas son justamente las
 * que se prestan a eso.
 */

import { compileFarm, locate } from "@locator";
import type { FarmProfile, TrackerRow } from "@locator";
import type { FieldCheck } from "./checks";

export interface Hipotesis {
  id: string;
  titulo: string;
  /** Que habria que cambiar en el perfil para que sea esto. */
  comoSeArregla: string;
  aciertos: number;
  total: number;
}

export interface DiagnosticoReglas {
  usados: number;
  /** Ordenadas por cuantos conteos explican. */
  hipotesis: Hipotesis[];
  /** La que explica mas, si le gana claramente a como esta ahora. */
  mejor: Hipotesis | null;
  /**
   * Los bloques donde el conteo salio espejado, para poder dar vuelta el lado.
   *
   * Es la accion concreta: el lado se deduce de la geometria y las dos
   * opciones son igual de consistentes, asi que un conteo es lo unico que lo
   * decide — y cuando lo decide, hay que poder aplicarlo sin editar un JSON.
   */
  bloquesParaVoltear: string[];
  /** Cuantos explica la configuracion actual. */
  actual: number;
  notas: string[];
}

/**
 * Las variantes que se prueban.
 *
 * Son las dos reglas que deciden desde donde se cuenta, y son justo las dos
 * que no se pueden deducir de las coordenadas: las dos opciones dan una
 * geometria igual de consistente, espejada. Por eso se declaran por parque, y
 * por eso un conteo en el campo es lo unico que las decide.
 */
interface Variante {
  id: string;
  titulo: string;
  comoSeArregla: string;
  aplicar: (p: FarmProfile, r: TrackerRow) => { profile: FarmProfile; row: TrackerRow };
}

const conOrigen = (extremo: "start" | "end"): Variante["aplicar"] => (p, r) => ({
  profile: { ...p, addressing: { ...p.addressing, originStrategy: "per-row-flag" } },
  row: { ...r, originEnd: extremo },
});

const VARIANTES: Variante[] = [
  {
    id: "actual",
    titulo: "Como esta configurado ahora",
    comoSeArregla: "No hay nada que cambiar.",
    aplicar: (p, r) => ({ profile: p, row: r }),
  },
  {
    id: "origen-start",
    titulo: "Se cuenta desde la otra punta de la fila",
    comoSeArregla:
      "La regla de origen esta eligiendo el extremo equivocado. En un parque con las cajas DC " +
      "en la calle del medio, eso suele ser el lado del tracker deducido al reves: revisá el " +
      "lado del bloque antes de tocar la estrategia.",
    aplicar: conOrigen("start"),
  },
  {
    id: "origen-end",
    titulo: "Se cuenta desde la otra punta de la fila",
    comoSeArregla:
      "La regla de origen esta eligiendo el extremo equivocado. En un parque con las cajas DC " +
      "en la calle del medio, eso suele ser el lado del tracker deducido al reves: revisá el " +
      "lado del bloque antes de tocar la estrategia.",
    aplicar: conOrigen("end"),
  },
  {
    id: "sin-inversion",
    titulo: "El string lejano no se cuenta invertido",
    comoSeArregla:
      "La regla del piercing connector esta invirtiendo un string que en realidad no se invierte. " +
      "Se declara con inversionStrategy: \"none\".",
    aplicar: (p, r) => ({
      profile: { ...p, addressing: { ...p.addressing, inversionStrategy: "none" } },
      row: r,
    }),
  },
  {
    id: "invertir-todo",
    titulo: "Los dos strings se cuentan invertidos",
    comoSeArregla:
      "Los dos strings arrancan del lado opuesto al que supone la regla. Se declara por fila con " +
      "inversionStrategy: \"per-string-flag\".",
    aplicar: (p, r) => ({
      profile: { ...p, addressing: { ...p.addressing, inversionStrategy: "per-string-flag" } },
      row: { ...r, stringInverted: [true, true] },
    }),
  },
];

/** Cuantos de los conteos acierta esta variante. */
function probar(v: Variante, checks: FieldCheck[], profile: FarmProfile, rows: TrackerRow[]): number {
  let ok = 0;
  for (const c of checks) {
    const contado = c.outcome === "match" ? c.module : c.countedModule;
    if (contado == null) continue;
    const fila = rows.find((r) => r.id === c.rowId);
    if (!fila) continue;

    const { profile: p, row } = v.aplicar(profile, fila);
    let farm;
    try { farm = compileFarm(p, [row]); } catch { continue; }

    const res = locate(
      { lat: c.coord.lat, lon: c.coord.lon, ...(c.accuracyM != null ? { accuracyM: c.accuracyM } : {}) },
      farm,
    );
    // Con el GPS de un celular el modulo exacto es mucho pedir: lo que se
    // evalua es si el conteo cae dentro de los candidatos que la app ofrece,
    // que es la lista derivada de la precision de la coordenada.
    const encaja =
      res.best?.module === contado ||
      res.candidates.some((k) => k.module === contado && k.rowId === fila.id);
    if (encaja) ok++;
  }
  return ok;
}

export function diagnosticoDeReglas(
  checks: FieldCheck[],
  profile: FarmProfile,
  rows: TrackerRow[],
): DiagnosticoReglas {
  const utiles = checks.filter(
    (c) => (c.outcome === "match" ? c.module : c.countedModule) != null && rows.some((r) => r.id === c.rowId),
  );

  if (!utiles.length) {
    return {
      usados: 0, hipotesis: [], mejor: null, actual: 0, bloquesParaVoltear: [],
      notas: ["Hacen falta conteos con numero de modulo para poder diagnosticar."],
    };
  }

  const hipotesis: Hipotesis[] = VARIANTES.map((v) => ({
    id: v.id,
    titulo: v.titulo,
    comoSeArregla: v.comoSeArregla,
    aciertos: probar(v, utiles, profile, rows),
    total: utiles.length,
  }));

  const actual = hipotesis.find((h) => h.id === "actual")!.aciertos;
  const otras = hipotesis.filter((h) => h.id !== "actual").sort((a, b) => b.aciertos - a.aciertos);
  const candidata = otras[0];

  // Una hipotesis solo vale si explica MAS que como esta. Empatar no alcanza:
  // cambiar una regla porque explica lo mismo es mover un numero al azar.
  let mejor = candidata && candidata.aciertos > actual ? candidata : null;

  /**
   * Desempate, cuando dar vuelta el origen y dar vuelta los dos strings
   * explican lo mismo.
   *
   * Pasa siempre, y no es un defecto del metodo: las dos producen la misma
   * numeracion. Lo que las separa no es la aritmetica sino que una se puede ir
   * a mirar. Contando desde la caja de continua —que es como se cuenta— si la
   * app arranca del otro lado es porque tiene mal de que lado de la calle esta
   * el tracker. Eso se comprueba parandose ahi y viendo donde esta la caja.
   *
   * La otra hipotesis da el mismo numero por una razon que no se puede
   * verificar y que se romperia en el proximo tracker.
   */
  if (mejor && mejor.id === "invertir-todo") {
    const origen = otras.find((h) => h.id.startsWith("origen-") && h.aciertos === mejor!.aciertos);
    if (origen) mejor = origen;
  }

  const bloquesParaVoltear =
    mejor && mejor.id.startsWith("origen-")
      ? [...new Set(utiles.map((c) => c.block).filter(Boolean))]
      : [];

  return {
    usados: utiles.length,
    hipotesis: [...hipotesis].sort((a, b) => b.aciertos - a.aciertos),
    mejor,
    actual,
    bloquesParaVoltear,
    notas: notasDe(actual, utiles.length, mejor, bloquesParaVoltear),
  };
}

/**
 * Da vuelta desde que punta se cuenta, en todas las filas de un bloque.
 *
 * Es una propiedad del BLOQUE, no de una fila: las filas de un lado cuentan
 * desde la calle del medio y las del otro tambien, cada una hacia su propia
 * caja. Darlo vuelta en una sola fila la dejaria peleada con sus vecinas.
 *
 * Lo que se da vuelta es `originEnd`, que es lo que de verdad decide el conteo.
 * Antes se daba vuelta `side`, y `side` no lo lee nadie con la estrategia que
 * esta activa: el boton borraba los desacuerdos registrados, escribia en la
 * calibracion que el bloque habia quedado verificado, y el conteo salia
 * exactamente igual de espejado que antes. Un boton que no hace nada es malo;
 * uno que ademas borra la evidencia de que algo esta mal y sube el estado del
 * parque es peor que no tenerlo.
 */
export function voltearLadoDelBloque(rows: TrackerRow[], bloque: string): TrackerRow[] {
  const opuesto: Record<string, TrackerRow["side"]> = {
    north: "south", south: "north", east: "west", west: "east",
  };
  return rows.map((r) => {
    if (r.block !== bloque) return r;
    const next: TrackerRow = { ...r };
    // Lo que decide el conteo.
    if (r.originEnd) next.originEnd = r.originEnd === "start" ? "end" : "start";
    // Y el lado, que va al informe y a los chequeos de cobertura.
    if (r.side && opuesto[r.side]) next.side = opuesto[r.side]!;
    return next;
  });
}

function notasDe(
  actual: number,
  total: number,
  mejor: Hipotesis | null,
  bloques: string[] = [],
): string[] {
  const notas: string[] = [];

  if (actual === total) {
    notas.push(`La configuracion actual explica los ${total} conteos. No hay nada que cambiar.`);
    return notas;
  }

  notas.push(`Como esta configurado ahora, explica ${actual} de ${total} conteos.`);

  if (!mejor) {
    notas.push(
      "Ninguna de las reglas conocidas explica mejor los desacuerdos. Eso apunta a otra cosa: " +
      "el paso, la cantidad de modulos por string, o que alguno se conto mal. Antes de tocar " +
      "una regla conviene repetir uno de los conteos.",
    );
    return notas;
  }

  notas.push(`«${mejor.titulo}» explica ${mejor.aciertos} de ${total}.`);
  notas.push(mejor.comoSeArregla);
  if (mejor.id.startsWith("origen-")) {
    notas.push(
      "Dar vuelta los dos strings da exactamente la misma numeracion y por eso empata en la " +
      "tabla. Se elige esta porque es la unica que se puede ir a comprobar: la otra acierta por " +
      "una razon que no se ve en el campo y que se romperia en el proximo tracker.",
    );
  }

  if (bloques.length) {
    notas.push(
      `Se arregla dando vuelta el lado de la calle del bloque ${bloques.join(", ")}. ` +
      "Antes de aplicarlo, comprobalo mirando: parate en la punta desde la que contaste y fijate " +
      "si la caja de continua esta ahi. Si esta, el lado que tiene cargado la app es el opuesto.",
    );
    notas.push(
      "Ojo que el lado es del BLOQUE entero, asi que cambia el conteo de todas sus filas. " +
      "Despues de aplicarlo conviene contar un modulo en otro tracker del mismo bloque.",
    );
  }

  if (mejor.aciertos < total) {
    notas.push(
      `Quedan ${total - mejor.aciertos} sin explicar. Puede ser ruido del GPS —a ±8 m son siete ` +
      "modulos— o puede haber una segunda regla. Con mas conteos se despeja.",
    );
  }
  return notas;
}

/**
 * La pista rapida, para leer parado en la fila.
 *
 * En un string de N modulos, contar desde la otra punta convierte el modulo k
 * en el N+1−k. Si las sumas dan N+1, esta espejado — y no hace falta recompilar
 * nada para verlo. Vale como titular; el diagnostico de arriba es el que decide.
 */
export function pareceEspejado(
  checks: FieldCheck[],
  modulosPorString: number,
): { espejado: boolean; sumas: number[]; esperada: number } {
  const sumas = checks.flatMap((c) => {
    const dijo = c.module;
    const conto = c.outcome === "match" ? c.module : c.countedModule;
    return dijo != null && conto != null ? [dijo + conto] : [];
  });
  const esperada = modulosPorString + 1;
  // Con dos modulos de tolerancia: el GPS de un celular mueve mas que eso.
  const espejado =
    sumas.length >= 2 && sumas.every((s) => Math.abs(s - esperada) <= 2);
  return { espejado, sumas, esperada };
}
