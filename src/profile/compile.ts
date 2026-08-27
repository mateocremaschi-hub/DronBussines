/**
 * Compilacion del perfil: perfil declarativo + geometria cruda -> estructura
 * lista para consultar.
 *
 * Todo lo que puede resolverse una sola vez se resuelve aca: el marco local,
 * los extremos en metros, el paso de cada fila, el extremo de conteo y la
 * inversion de cada string. `locate()` queda como geometria pura mas una
 * busqueda en tabla.
 *
 * El efecto practico buscado es que los problemas de datos aparezcan al cargar
 * el parque, no cuando alguien esta parado al lado de un panel.
 */

import { makeFrame, toLocal, type LocalFrame } from "../geo/frame.js";
import { huecosDeStrings, makeRowLayout, moduleExtentM, type Hueco } from "../geo/rowLayout.js";
import { resolveInversion } from "../strategies/inversion.js";
import { resolveOriginEnd } from "../strategies/origin.js";
import type { CompiledFarm, CompiledRow, FarmProfile, TrackerRow, Warning } from "../types.js";
import { ProfileError, validateProfile } from "./validate.js";

const DEFAULTS = {
  maxDistanceM: 30,
  neighborhood: 2,
  maxRowCandidates: 3,
  defaultAccuracyM: 3,
  lengthToleranceMmPerModule: 15,
};

export interface CompileOptions {
  /** Punto de referencia del marco local. Por defecto, el centroide del parque. */
  origin?: { lat: number; lon: number };
}

/**
 * Lo que ocupan los modulos de una fila con un paso dado.
 *
 * Una sola definicion, usada por el centrado y por el aviso de largo. Estaban
 * escritas dos veces con la misma formula larga, y ese es justo el lugar donde
 * un cambio se aplica a una y no a la otra: el centrado absorbe la diferencia
 * y el aviso deja de saltar, que era la red de seguridad.
 */
function extentConPaso(
  ctx: {
    modulesPerRow: number; moduleWidthM: number;
    huecos: number; totalHuecosM: number;
  },
  pitchM: number,
): number {
  // Los pasos normales, mas el ancho de los modulos que bordean un hueco
  // grande, mas los huecos. Es la misma cuenta que hace `makeRowLayout` al
  // armar la tabla de bordes, y tiene que dar identico: si las dos se separan,
  // el aviso de largo compara contra una fila que no es la que se dibuja.
  const pasosNormales = Math.max(0, ctx.modulesPerRow - 1 - ctx.huecos);
  return (
    pasosNormales * pitchM +
    (ctx.huecos + 1) * ctx.moduleWidthM +
    ctx.totalHuecosM
  );
}

/**
 * Una geometria completa del parque: la principal o una de sus variantes.
 *
 * Todo resuelto a numeros, sin herencias pendientes, para que elegir cual le
 * toca a una fila sea comparar largos y nada mas.
 */
interface Geometria {
  variantId?: string;
  variantName?: string;
  modulesPerString: number;
  stringsPerRow: number;
  modulesPerRow: number;
  moduleWidthM: number;
  huecosM: Hueco[];
  totalHuecosM: number;
  huecos: number;
  nominalPitchM: number;
  declaredPitch: number | null | "derive" | undefined;
  offsetM: number;
  /** Largo pica a pica que esta geometria predice, en metros. */
  predichoM: number;
}

export function compileFarm(
  profileInput: unknown,
  rows: TrackerRow[],
  options: CompileOptions = {},
): CompiledFarm {
  const profile = validateProfile(profileInput);
  const buildWarnings: Warning[] = [];

  if (rows.length === 0) {
    throw new Error(
      `El parque "${profile.id}" no tiene ninguna fila de trackers. Sin geometria no hay nada que localizar.`,
    );
  }

  const modulesPerString = profile.topology.modulesPerString;
  const stringsPerRow = profile.topology.stringsPerRow;
  const modulesPerRow = modulesPerString * stringsPerRow;

  const moduleWidthM = profile.module.widthMm / 1000;
  const moduleGapM = profile.module.gapMm / 1000;
  const stringGapM = (profile.topology.stringGapMm ?? 0) / 1000;

  /**
   * Los huecos grandes de la fila, ya resueltos a una sola lista.
   *
   * Si el perfil los enumera, mandan. Si no, se expanden del par
   * (stringsPerRow, stringGapMm), que es como se declara un parque normal. De
   * aca para abajo el resto del compilador no vuelve a mirar `stringGapMm`:
   * hay una sola forma de la verdad y las cuentas se escriben una vez.
   */
  const huecosM: Hueco[] = profile.topology.gaps?.length
    ? profile.topology.gaps.map((g) => ({ afterModule: g.afterModule, m: g.mm / 1000 }))
    : huecosDeStrings(modulesPerString, stringsPerRow, stringGapM);
  const totalHuecosM = huecosM.reduce((s2, h) => s2 + h.m, 0);
  const nominalPitchM = (profile.module.widthMm + profile.module.gapMm) / 1000;
  const declaredPitch = profile.module.pitchMm;

  const offsetM = profile.geometry.endpointOffsetMm / 1000;
  const offsetMode = profile.geometry.endpointOffsetMode ?? "both";

  // Centrar necesita saber cuanto miden los modulos, asi que no se puede
  // combinar con despejar el paso del largo: seria circular.
  if (offsetMode === "centered" && declaredPitch === "derive") {
    throw new ProfileError([
      '`endpointOffsetMode: "centered"` no se puede usar con `module.pitchMm: "derive"`: centrar ' +
      "necesita el paso para saber cuanto ocupan los modulos, y derivar el paso necesita saber " +
      "donde arrancan. Declara el paso.",
    ]);
  }
  /**
   * Las geometrias del parque: la principal y sus variantes.
   *
   * Un parque real puede mezclar dos tipos de tracker en los mismos bloques, en
   * la misma lista de strings y en los mismos planos. Antes eso obligaba a dar
   * de alta el parque dos veces —los mismos planos subidos dos veces, la lista
   * de strings cortada a mano, los vuelos y los informes partidos al medio— y
   * eso no es una limitacion tecnica sino un dia de trabajo perdido cada vez.
   */
  const armar = (v?: import("../types.js").TopologyVariant): Geometria => {
    const mps = v?.modulesPerString ?? modulesPerString;
    const spr = v?.stringsPerRow ?? stringsPerRow;
    const anchoM = (v?.moduleWidthMm ?? profile.module.widthMm) / 1000;
    const bahiaM = (v?.stringGapMm ?? profile.topology.stringGapMm ?? 0) / 1000;
    const gaps = v?.gaps ?? (v ? undefined : profile.topology.gaps);
    const hs: Hueco[] = gaps?.length
      ? gaps.map((g) => ({ afterModule: g.afterModule, m: g.mm / 1000 }))
      : huecosDeStrings(mps, spr, bahiaM);
    const total = hs.reduce((acc, h) => acc + h.m, 0);
    const pasoNominalM = (anchoM * 1000 + profile.module.gapMm) / 1000;
    const geo = {
      ...(v?.id ? { variantId: v.id } : {}),
      ...(v?.name ? { variantName: v.name } : {}),
      modulesPerString: mps,
      stringsPerRow: spr,
      modulesPerRow: mps * spr,
      moduleWidthM: anchoM,
      huecosM: hs,
      totalHuecosM: total,
      huecos: hs.length,
      nominalPitchM: pasoNominalM,
      declaredPitch: v && v.pitchMm !== undefined ? v.pitchMm : profile.module.pitchMm,
      offsetM: (v?.endpointOffsetMm ?? profile.geometry.endpointOffsetMm) / 1000,
      predichoM: 0,
    };
    // Con `centered` los voladizos absorben lo que sobra, asi que la mejor
    // prediccion del largo pica a pica es lo que ocupan los modulos.
    const voladizos =
      offsetMode === "both" ? 2 * geo.offsetM : offsetMode === "origin" ? geo.offsetM : 0;
    geo.predichoM = extentConPaso(geo, geo.nominalPitchM) + voladizos;
    return geo;
  };

  const geometrias: Geometria[] = [
    armar(),
    ...(profile.topology.variants ?? []).map((v) => armar(v)),
  ];

  /**
   * Que geometria le toca a esta fila.
   *
   * Si la fila lo declara, manda. Si no, gana la que predice un largo mas
   * parecido al MEDIDO — que es un dato que ya viene en el archivo de picas y
   * no hay que pedirle a nadie. Un tracker de 28 modulos mide 32 m y uno de 56
   * mide 65: no hay forma de confundirlos.
   */
  const geometriaDe = (row: TrackerRow, lengthM: number): Geometria => {
    if (geometrias.length === 1) return geometrias[0]!;
    if (row.variantId) {
      const pedida = geometrias.find((g) => g.variantId === row.variantId);
      if (pedida) return pedida;
      buildWarnings.push({
        code: "missing-flag",
        rowId: row.id,
        message:
          `La fila "${row.id}" pide el tipo de tracker "${row.variantId}", que el perfil no declara. ` +
          `Elijo el que mejor cierra con su largo medido.`,
      });
    }
    return geometrias.reduce((mejor, g) =>
      Math.abs(lengthM - g.predichoM) < Math.abs(lengthM - mejor.predichoM) ? g : mejor);
  };

  const tolerance =
    profile.geometry.lengthToleranceMmPerModule ?? DEFAULTS.lengthToleranceMmPerModule;

  const maxDistanceM = profile.matching?.maxDistanceM ?? DEFAULTS.maxDistanceM;

  const origin = options.origin ?? centroid(rows);
  const frame = makeFrame(origin.lat, origin.lon);

  const compiled: CompiledRow[] = rows.map((row) => {
    const a0 = toLocal(frame, row.start.lat, row.start.lon);
    const b0 = toLocal(frame, row.end.lat, row.end.lon);
    const g = geometriaDe(row, Math.hypot(b0.x - a0.x, b0.y - a0.y));
    return compileRow(row, {
      frame,
      profile,
      modulesPerRow: g.modulesPerRow,
      modulesPerString: g.modulesPerString,
      moduleWidthM: g.moduleWidthM,
      moduleGapM,
      stringGapM,
      huecosM: g.huecosM,
      totalHuecosM: g.totalHuecosM,
      huecos: g.huecos,
      nominalPitchM: g.nominalPitchM,
      declaredPitch: g.declaredPitch,
      offsetM: g.offsetM,
      offsetMode,
      maxDistanceM,
      tolerance,
      stringsPerRow: g.stringsPerRow,
      buildWarnings,
      ...(g.variantId ? { variantId: g.variantId } : {}),
      ...(g.variantName ? { variantName: g.variantName } : {}),
    });
  });

  /*
    Cuantas filas quedaron de cada tipo. No es estadistica: si un parque de dos
    tipos sale con CERO filas del tipo corto, el reparto se equivoco y todas
    esas direcciones estan mal. Aparece al cargar el parque, no en el campo.
  */
  if (geometrias.length > 1) {
    for (const g of geometrias) {
      const n = compiled.filter((r) => r.variantId === g.variantId).length;
      buildWarnings.push({
        code: "missing-flag",
        rowId: compiled.find((r) => r.variantId === g.variantId)?.source.id ?? rows[0]!.id,
        message:
          `${n} de ${rows.length} filas quedaron como ` +
          `"${g.variantName ?? g.variantId ?? "el tipo principal"}" ` +
          `(${g.modulesPerRow} modulos, ${g.predichoM.toFixed(1)} m de pica a pica). ` +
          (n === 0
            ? "Ninguna fila del parque se parece a ese tipo: sobra en el perfil, o sus medidas estan mal."
            : "Se eligio comparando el largo medido de cada fila contra el que predice cada tipo."),
      });
    }
  }

  /**
   * Lo que dijo la capa de estrategias tambien es un aviso de carga.
   *
   * El tipo de `CompiledRow` promete textualmente: "si a una fila le falta un
   * dato, te enteras al cargar el parque y no con el tecnico parado en el
   * campo". No se cumplia: los avisos de estrategia se guardaban en la fila y
   * nunca llegaban a `buildWarnings`. Un parque nuevo donde la ingesta no
   * lograra deducir el lado se cargaba limpio, mostraba "0 cosas para revisar",
   * y contaba al reves en la mitad de las filas.
   *
   * Se agrupan por mensaje: "1847 filas sin el lado de la calle" es un
   * problema; 1847 lineas iguales es una lista que nadie lee.
   */
  const porMensaje = new Map<string, { code: Warning["code"]; ids: string[] }>();
  for (const r of compiled) {
    for (const w of r.strategyWarnings) {
      const e = porMensaje.get(w.message);
      if (e) e.ids.push(r.source.id);
      else porMensaje.set(w.message, { code: w.code, ids: [r.source.id] });
    }
  }
  for (const [message, { code, ids: filas }] of porMensaje) {
    buildWarnings.push({
      code,
      rowId: filas[0]!,
      message:
        filas.length === 1
          ? `Fila "${filas[0]}": ${message}`
          : `${filas.length} filas, por ejemplo "${filas[0]}": ${message}`,
    });
  }

  const ids = new Set<string>();
  for (const r of compiled) {
    if (ids.has(r.source.id)) {
      buildWarnings.push({
        code: "missing-flag",
        rowId: r.source.id,
        message: `Hay mas de una fila con el id "${r.source.id}". Los ids tienen que ser unicos.`,
      });
    }
    ids.add(r.source.id);
  }

  return {
    profile: profile as CompiledFarm["profile"],
    rows: compiled,
    origin,
    scale: { east: frame.east, north: frame.north },
    modulesPerRow,
    moduleWidthM,
    maxDistanceM,
    lengthToleranceMmPerModule: tolerance,
    neighborhood: profile.matching?.neighborhood ?? DEFAULTS.neighborhood,
    maxRowCandidates: profile.matching?.maxRowCandidates ?? DEFAULTS.maxRowCandidates,
    defaultAccuracyM: profile.matching?.defaultAccuracyM ?? DEFAULTS.defaultAccuracyM,
    buildWarnings,
  };
}

// ---------------------------------------------------------------------------

interface RowContext {
  frame: LocalFrame;
  profile: FarmProfile;
  modulesPerRow: number;
  modulesPerString: number;
  moduleWidthM: number;
  moduleGapM: number;
  stringGapM: number;
  /** Los huecos grandes, ya resueltos: enumerados o expandidos de stringGapM. */
  huecosM: Hueco[];
  totalHuecosM: number;
  /** Cuantos huecos grandes tiene la fila. */
  huecos: number;
  nominalPitchM: number;
  declaredPitch: number | null | "derive" | undefined;
  offsetM: number;
  offsetMode: "both" | "origin" | "none" | "centered";
  maxDistanceM: number;
  tolerance: number;
  stringsPerRow: number;
  buildWarnings: Warning[];
  variantId?: string;
  variantName?: string;
}

function compileRow(row: TrackerRow, ctx: RowContext): CompiledRow {
  const a = toLocal(ctx.frame, row.start.lat, row.start.lon);
  const b = toLocal(ctx.frame, row.end.lat, row.end.lon);

  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthM = Math.hypot(dx, dy);

  if (lengthM === 0) {
    throw new Error(
      `La fila "${row.id}" tiene las dos picas en el mismo punto. Revisa la importacion de geometria.`,
    );
  }

  const ux = dx / lengthM;
  const uy = dy / lengthM;

  // --- estrategia de origen (se resuelve una sola vez) ----------------------
  const originRes = resolveOriginEnd(
    { row, startIsNorth: a.y > b.y, startIsEast: a.x > b.x },
    ctx.profile.addressing,
  );
  const strategyWarnings = [...originRes.warnings];

  // --- estrategia de inversion, chunk por chunk ----------------------------
  const inverted: boolean[] = [];
  for (let chunk = 0; chunk < ctx.stringsPerRow; chunk++) {
    const res = resolveInversion(row, chunk, ctx.profile.addressing);
    inverted.push(res.inverted);
    strategyWarnings.push(...res.warnings);
  }

  // --- offsets de pica ------------------------------------------------------
  // Pueden ser negativos: en Edenvale los modulos sobresalen 1464 mm mas alla
  // de la pica, que queda debajo del segundo modulo.
  // Centrado: los modulos ocupan lo que dice el paso declarado, y lo que sobra
  // (o falta) se reparte entre las dos puntas. El offset deja de ser un dato.
  const centrarM =
    ctx.offsetMode === "centered"
      ? (lengthM - extentConPaso(ctx, ctx.nominalPitchM)) / 2
      : 0;

  const originOffsetM =
    ctx.offsetMode === "centered" ? centrarM : ctx.offsetMode === "none" ? 0 : ctx.offsetM;
  const farOffsetM =
    ctx.offsetMode === "centered" ? centrarM : ctx.offsetMode === "both" ? ctx.offsetM : 0;

  // Lo que ocupan los modulos, ya descontando (o sumando) los voladizos.
  const extentM = lengthM - originOffsetM - farOffsetM;
  if (extentM <= 0) {
    throw new Error(
      `La fila "${row.id}" mide ${lengthM.toFixed(2)} m y los offsets de pica configurados no dejan lugar para ningun modulo. Revisa geometry.endpointOffsetMm o la geometria importada.`,
    );
  }

  // --- paso -----------------------------------------------------------------
  // Despejar el paso del largo real es invertir `extentConPaso`: se descuenta
  // lo que no es un paso normal —los huecos grandes y los modulos que los
  // bordean— y lo que queda se reparte entre los pasos que si lo son.
  const moduleGapM = ctx.moduleGapM;
  const pasosNormales = Math.max(1, ctx.modulesPerRow - 1 - ctx.huecos);
  const derivedPitchM =
    (extentM - (ctx.huecos + 1) * ctx.moduleWidthM - ctx.totalHuecosM) / pasosNormales;

  let pitchM: number;
  if (row.pitchMmOverride != null) {
    pitchM = row.pitchMmOverride / 1000;
  } else if (ctx.declaredPitch === "derive") {
    pitchM = derivedPitchM;
  } else if (typeof ctx.declaredPitch === "number") {
    pitchM = ctx.declaredPitch / 1000;
  } else {
    pitchM = ctx.nominalPitchM;
  }

  const layout = makeRowLayout({
    modulesPerString: ctx.modulesPerString,
    stringsPerRow: ctx.stringsPerRow,
    pitchM,
    moduleGapM,
    moduleWidthM: ctx.moduleWidthM,
    huecosM: ctx.huecosM,
    originOffsetM,
  });

  // Cuanto se aparta el paso declarado del que exige el largo real del
  // segmento. Es la senal mas barata de que la geometria importada esta mal:
  // un bloque con filas partidas o picas cruzadas salta aca, sin ir al campo.
  //
  // Centrado necesita su propia cuenta, y es importante. `extentM` ya viene con
  // el centrado aplicado, asi que el residuo daria SIEMPRE cero y el aviso no
  // saltaria nunca — justo el aviso que hubiera cazado el hueco fantasma de
  // 3713 mm que tuvo mal a Edenvale durante meses. Centrar tiene que sacar el
  // parametro de encima, no la red de seguridad: aca se compara el largo real
  // contra lo que ocupan los modulos, sin dejar que el centrado lo absorba.
  const lengthResidualMmPerModule =
    ctx.offsetMode === "centered"
      ? ((lengthM - extentConPaso(ctx, pitchM)) / ctx.modulesPerRow) * 1000
      : (derivedPitchM - pitchM) * 1000;
  const predictedLengthM = originOffsetM + moduleExtentM(layout) + farOffsetM;
  if (Math.abs(lengthResidualMmPerModule) > ctx.tolerance) {
    ctx.buildWarnings.push({
      code: "length-mismatch",
      rowId: row.id,
      message:
        `La fila "${row.id}" mide ${lengthM.toFixed(2)} m, pero el perfil predice ` +
        `${predictedLengthM.toFixed(2)} m (${ctx.modulesPerRow} modulos de ${(pitchM * 1000).toFixed(0)} mm` +
        (ctx.stringGapM ? `, ${(ctx.stringGapM * 1000).toFixed(0)} mm de bahia de motor` : "") +
        `, offsets de ${(originOffsetM * 1000).toFixed(0)}/${(farOffsetM * 1000).toFixed(0)} mm). ` +
        `Sobran ${lengthResidualMmPerModule.toFixed(0)} mm por modulo. ` +
        `Revisa la geometria de esa fila, el paso, o el hueco entre strings.`,
    });
  }

  // --- numeros de string ----------------------------------------------------
  // El menor de los numeros presentes es el mas cercano al origen. Comparar
  // relativamente, y nunca contra un numero fijo: hay filas cuyos dos strings
  // se numeran 5 y 6 en vez de 1 y 2.
  let stringNumbers: number[];
  let stringLabels: string[] | undefined;
  if (row.stringNumbers && row.stringNumbers.length > 0) {
    // Las etiquetas viajan junto con su numero, no por separado: separarlas es
    // como se termina mostrando la etiqueta de un string sobre otro.
    const pares = row.stringNumbers
      .map((n, i) => ({ n, label: row.stringLabels?.[i] }))
      .sort((x, y) => x.n - y.n);
    stringNumbers = pares.map((q) => q.n);
    if (row.stringLabels?.length) stringLabels = pares.map((q) => q.label ?? "");
    if (stringNumbers.length !== ctx.stringsPerRow) {
      /*
        Esto no es un detalle de bookkeeping: es LA pregunta que decide como se
        numeran los modulos, y la geometria no la puede contestar.

        Una fila de 28 modulos con una bahia en el medio se ve EXACTAMENTE
        igual si son dos strings de 14 o uno solo de 28 partido por el motor.
        Los modulos caen en los mismos milimetros. Lo que cambia es la
        direccion que se entrega: con dos strings, el modulo 17 se reporta como
        "string 2, modulo 3"; con uno, como "modulo 17". El tecnico sale a
        buscar un string que no existe.

        La lista de strings SI lo sabe, porque la trae el proyecto. Cuando la
        lista y el perfil no coinciden, el que tiene razon es casi siempre la
        lista — y antes esto se resolvia inventando un string correlativo y
        diciendo "completo con correlativos", que no le dice a nadie que hacer.
      */
      const menos = stringNumbers.length < ctx.stringsPerRow;
      ctx.buildWarnings.push({
        code: "missing-flag",
        rowId: row.id,
        message:
          `La fila "${row.id}" trae ${stringNumbers.length} numero(s) de string y el perfil declara ` +
          `${ctx.stringsPerRow} por fila. ` +
          (menos
            ? `Casi seguro el perfil esta mal: si el tracker es UN string partido por la bahia del ` +
              `motor, va "strings por fila = 1" y "modulos por string = ${ctx.modulesPerRow}", y la ` +
              `bahia se declara como hueco despues del modulo ` +
              `${Math.round(ctx.modulesPerRow / 2)} en "los huecos uno por uno". Cargado como ` +
              `${ctx.stringsPerRow} strings, la app va a reportar "string 2, modulo 3" donde el ` +
              `plano dice "modulo ${Math.round(ctx.modulesPerRow / 2) + 3}".`
            : `Sobran numeros de string para lo que declara el perfil: reviso cual de los dos esta mal ` +
              `antes de usar las direcciones.`),
      });
      while (stringNumbers.length < ctx.stringsPerRow) {
        stringNumbers.push((stringNumbers[stringNumbers.length - 1] ?? 0) + 1);
      }
      stringNumbers = stringNumbers.slice(0, ctx.stringsPerRow);
    }
  } else {
    stringNumbers = Array.from({ length: ctx.stringsPerRow }, (_, i) => i + 1);
  }

  const pad = ctx.maxDistanceM;
  return {
    source: row,
    a,
    b,
    lengthM,
    ux,
    uy,
    bbox: {
      minX: Math.min(a.x, b.x) - pad,
      maxX: Math.max(a.x, b.x) + pad,
      minY: Math.min(a.y, b.y) - pad,
      maxY: Math.max(a.y, b.y) + pad,
    },
    pitchM,
    // La geometria de ESTA fila, congelada. `locate` la lee de aca y no del
    // perfil del parque: con dos tipos de tracker mezclados, leer del perfil
    // numera los cortos como si fueran largos.
    modulesPerString: ctx.modulesPerString,
    stringsPerRow: ctx.stringsPerRow,
    modulesPerRow: ctx.modulesPerRow,
    huecosM: ctx.huecosM,
    moduleWidthM: ctx.moduleWidthM,
    ...(ctx.variantId ? { variantId: ctx.variantId } : {}),
    ...(ctx.variantName ? { variantName: ctx.variantName } : {}),
    originOffsetM,
    farOffsetM,
    stringNumbers,
    ...(stringLabels ? { stringLabels } : {}),
    lengthResidualMmPerModule,
    originEnd: originRes.end,
    inverted,
    strategyWarnings,
  };
}

function centroid(rows: TrackerRow[]): { lat: number; lon: number } {
  let lat = 0;
  let lon = 0;
  for (const r of rows) {
    lat += r.start.lat + r.end.lat;
    lon += r.start.lon + r.end.lon;
  }
  const n = rows.length * 2;
  return { lat: lat / n, lon: lon / n };
}
