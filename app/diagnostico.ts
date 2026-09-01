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
import type { CompiledFarm, FarmProfile, TrackerRow } from "@locator";
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
   *
   * Solo entran los bloques que la hipotesis ARREGLA. Antes entraban todos los
   * bloques que aparecieran en algun conteo, incluidos los que ya estaban bien:
   * con desacuerdos en el 05 y coincidencias en el 04, la pantalla ofrecia un
   * boton para cada uno. Tocar el del 04 lo dejaba contando al reves y encima
   * borraba los desacuerdos de ese bloque y anotaba en la calibracion que
   * habia quedado verificado. O sea que rompia lo unico verificado del parque
   * y despues tapaba la prueba de que lo habia roto.
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

/** La hipotesis de que el parque entero cuenta desde la punta contraria. */
const ID_OTRA_PUNTA = "origen-invertido";

/**
 * Desde que punta esta contando HOY esta fila.
 *
 * Se pregunta compilando en vez de leer `row.originEnd`, porque con la
 * estrategia que usa el parque —`fixed-end` desde el norte— la fila no lo trae
 * escrito: lo resuelve el compilador mirando cual de las dos picas queda mas
 * al norte. Leer el campo daria `undefined` en todas y no habria nada que
 * invertir.
 */
function origenDeHoy(profile: FarmProfile, row: TrackerRow): TrackerRow["originEnd"] {
  try {
    return compileFarm(profile, [row]).rows[0]?.originEnd;
  } catch {
    return undefined;
  }
}

const VARIANTES: Variante[] = [
  {
    id: "actual",
    titulo: "Como esta configurado ahora",
    comoSeArregla: "No hay nada que cambiar.",
    aplicar: (p, r) => ({ profile: p, row: r }),
  },
  /*
    Antes esto eran DOS hipotesis, `origen-start` y `origen-end`, con el mismo
    titulo y el mismo texto de arreglo palabra por palabra. La tabla mostraba
    dos filas identicas con numeros distintos y no habia manera de saber cual
    era cual ni que se elegia al tocar una.

    Peor que la duplicacion: las dos FIJABAN `originEnd` al mismo valor para
    todas las filas probadas. Eso supone que las picas del archivo de
    relevamiento estan todas en el mismo sentido, y no lo estan — el topografo
    tomo unas filas de sur a norte y otras al reves, ver `deriveOriginEnds` en
    app/ingest.ts. En un parque asi, "todas desde start" da vuelta las que
    estaban bien y arregla las que estaban mal, y "todas desde end" hace lo
    contrario: ninguna de las dos puede explicar el conjunto, por mas que el
    conjunto entero este espejado.

    Queda una sola hipotesis, que es ademas la pregunta real que se hace el
    que esta parado en la fila: ¿esta contando desde la punta equivocada? Se
    prueba invirtiendo el origen de CADA fila respecto del que tiene hoy, sea
    cual sea, asi que el sentido de las picas del Excel deja de importar.
  */
  {
    id: ID_OTRA_PUNTA,
    titulo: "Se cuenta desde la otra punta de la fila",
    comoSeArregla:
      "La regla de origen esta eligiendo el extremo equivocado: cada fila hay que contarla desde " +
      "la punta opuesta a la que esta usando hoy. Se arregla con «Resolver el sentido de todo el " +
      "parque», que mide que punta da a la calle de las cajas en vez de declararla.",
    aplicar: (p, r) => {
      const hoy = origenDeHoy(p, r) ?? "start";
      return {
        profile: { ...p, addressing: { ...p.addressing, originStrategy: "per-row-flag" } },
        row: { ...r, originEnd: hoy === "start" ? "end" : "start" },
      };
    },
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

/**
 * Cuales de los conteos acierta esta variante, uno por uno.
 *
 * Devuelve el detalle y no el total porque hace falta saber QUE conteo arregla
 * y cual rompe: el total solo alcanza para ordenar la tabla, y con el total no
 * se puede decidir que bloque ofrecer para dar vuelta.
 */
function probarUnoAUno(
  v: Variante,
  checks: FieldCheck[],
  profile: FarmProfile,
  rows: TrackerRow[],
): boolean[] {
  return checks.map((c) => {
    const contado = c.outcome === "match" ? c.module : c.countedModule;
    if (contado == null) return false;
    const fila = rows.find((r) => r.id === c.rowId);
    if (!fila) return false;

    const { profile: p, row } = v.aplicar(profile, fila);
    let farm;
    try { farm = compileFarm(p, [row]); } catch { return false; }

    const res = locate(
      { lat: c.coord.lat, lon: c.coord.lon, ...(c.accuracyM != null ? { accuracyM: c.accuracyM } : {}) },
      farm,
    );
    // Con el GPS de un celular el modulo exacto es mucho pedir: lo que se
    // evalua es si el conteo cae dentro de los candidatos que la app ofrece,
    // que es la lista derivada de la precision de la coordenada.
    return (
      res.best?.module === contado ||
      res.candidates.some((k) => k.module === contado && k.rowId === fila.id)
    );
  });
}

/**
 * Que bloques se arreglan dandolos vuelta solos.
 *
 * Un bloque entra si tiene algun desacuerdo registrado, si la hipotesis
 * arregla al menos uno de sus conteos, y si no rompe NINGUNO de los que hoy
 * coinciden. Las tres condiciones son la misma idea dicha de tres formas: el
 * boton es una accion destructiva —reescribe el origen de todas las filas del
 * bloque y su calibracion— asi que solo se ofrece donde se sabe que suma.
 */
function bloquesQueArregla(
  checks: FieldCheck[],
  antes: boolean[],
  despues: boolean[],
): string[] {
  const porBloque = new Map<string, { desacuerdos: number; arregla: number; rompe: number }>();
  checks.forEach((c, i) => {
    if (!c.block) return;
    const e = porBloque.get(c.block) ?? { desacuerdos: 0, arregla: 0, rompe: 0 };
    if (c.outcome === "mismatch") e.desacuerdos++;
    if (!antes[i] && despues[i]) e.arregla++;
    if (antes[i] && !despues[i]) e.rompe++;
    porBloque.set(c.block, e);
  });

  return [...porBloque]
    .filter(([, e]) => e.desacuerdos > 0 && e.arregla > 0 && e.rompe === 0)
    .map(([b]) => b);
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

  // El detalle conteo por conteo de cada variante, que despues se usa dos
  // veces: para el total de la tabla y para saber a que bloque le sirve.
  const detalle = new Map<string, boolean[]>(
    VARIANTES.map((v) => [v.id, probarUnoAUno(v, utiles, profile, rows)]),
  );

  const hipotesis: Hipotesis[] = VARIANTES.map((v) => ({
    id: v.id,
    titulo: v.titulo,
    comoSeArregla: v.comoSeArregla,
    aciertos: detalle.get(v.id)!.filter(Boolean).length,
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
   * a mirar: si la app arranca de la punta equivocada, el que esta parado en la
   * fila lo comprueba mirando cual de las dos puntas es —la del norte, o la que
   * da a la calle de las cajas— y contando un modulo desde ahi.
   *
   * La otra hipotesis da el mismo numero por una razon que no se puede
   * verificar y que se romperia en el proximo tracker.
   */
  if (mejor && mejor.id === "invertir-todo") {
    const origen = otras.find((h) => h.id === ID_OTRA_PUNTA && h.aciertos === mejor!.aciertos);
    if (origen) mejor = origen;
  }

  /*
    Antes esto era `utiles.map((c) => c.block)`: TODOS los bloques donde
    hubiera un conteo, estuvieran bien o mal. Con el 04 coincidiendo y el 05
    espejado, la pantalla ofrecia un boton para cada uno y el del 04 dejaba
    contando al reves un bloque que estaba bien.
  */
  const bloquesParaVoltear =
    mejor && mejor.id === ID_OTRA_PUNTA
      ? bloquesQueArregla(utiles, detalle.get("actual")!, detalle.get(ID_OTRA_PUNTA)!)
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
  if (mejor.id === ID_OTRA_PUNTA) {
    notas.push(
      "Dar vuelta los dos strings da exactamente la misma numeracion y por eso empata en la " +
      "tabla. Se elige esta porque es la unica que se puede ir a comprobar: la otra acierta por " +
      "una razon que no se ve en el campo y que se romperia en el proximo tracker.",
    );
  }

  /*
    Cuando la hipotesis gana pero ningun bloque suelto se arregla, hay que
    decirlo. Antes se listaban todos los bloques con conteos, asi que este caso
    no existia: siempre habia un boton, aunque diera vuelta un bloque sano.
  */
  if (mejor.id === ID_OTRA_PUNTA && !bloques.length) {
    notas.push(
      "Ningun bloque se arregla dandolo vuelta por su cuenta: o no tiene desacuerdos registrados, " +
      "o darlo vuelta romperia conteos que hoy coinciden. Resolvé el sentido del parque entero y " +
      "volvé a contar un modulo donde no cerraba.",
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

export interface PistaDeEspejo {
  espejado: boolean;
  /** Lo que dijo la app mas lo que se conto, uno por conteo. */
  sumas: number[];
  /** Contra que tenia que dar cada suma, segun el largo de SU fila. */
  esperadas: number[];
  /**
   * La suma esperada, cuando todos los conteos caen en filas del mismo largo.
   * `null` en un parque que mezcla dos tipos de tracker y se conto en los dos:
   * ahi no hay un solo numero que escribir en pantalla.
   */
  esperada: number | null;
}

/**
 * La pista rapida, para leer parado en la fila.
 *
 * En un string de N modulos, contar desde la otra punta convierte el modulo k
 * en el N+1−k. Si las sumas dan N+1, esta espejado — y no hace falta recompilar
 * nada para verlo. Vale como titular; el diagnostico de arriba es el que decide.
 *
 * El N sale de la FILA de cada conteo y no del perfil del parque. Salia del
 * perfil, y un parque puede mezclar trackers largos de 56 modulos con cortos de
 * 28: un conteo hecho en una fila corta se comparaba contra el N+1 de una
 * larga, asi que la pista decia "no esta espejado" justo donde lo estaba.
 */
export function pareceEspejado(checks: FieldCheck[], farm: CompiledFarm): PistaDeEspejo {
  const modulosDe = new Map(farm.rows.map((r) => [r.source.id, r.modulesPerString]));

  const sumas: number[] = [];
  const esperadas: number[] = [];
  for (const c of checks) {
    const dijo = c.module;
    const conto = c.outcome === "match" ? c.module : c.countedModule;
    const n = modulosDe.get(c.rowId);
    // Un conteo de una fila que este parque ya no tiene no dice nada. Meterlo
    // con el N del perfil es exactamente el error que se esta arreglando.
    if (dijo == null || conto == null || n == null) continue;
    sumas.push(dijo + conto);
    esperadas.push(n + 1);
  }

  // Con dos modulos de tolerancia: el GPS de un celular mueve mas que eso.
  const espejado = sumas.length >= 2 && sumas.every((s, i) => Math.abs(s - esperadas[i]!) <= 2);
  const distintas = new Set(esperadas);
  return { espejado, sumas, esperadas, esperada: distintas.size === 1 ? [...distintas][0]! : null };
}
