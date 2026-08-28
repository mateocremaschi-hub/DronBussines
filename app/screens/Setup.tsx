/**
 * Alta de un parque nuevo.
 *
 * Cuatro pasos: archivo, columnas, parametros, revision. En cada uno la app
 * muestra lo que entendio y te deja corregirlo. Nada se aplica en silencio.
 */

import { useMemo, useState, useEffect } from "react";
import { compileFarm, ProfileError } from "@locator";
import { cuadreDeFila } from "../rowbalance";
import type { CompiledFarm, FarmProfile, TrackerRow } from "@locator";
import {
  buildRows,
  capabilityReport,
  aplicarOrigenes,
  deriveOriginEnds,
  deriveSides,
  FIELDS,
  detectarCrs,
  mergeRows,
  readWorkbook,
  suggestEndpointOffsetMm,
  suggestMapping,
  toNumber,
  type Crs,
  type Mapping,
  type Sheet,
} from "../ingest";
import { forwardFill } from "../strings";
import { saveFarm, type StoredFarm } from "../storage";
import { boundsSummary, GeometryPlot } from "../components/GeometryPlot";

// ---------------------------------------------------------------------------

interface Preset {
  id: string;
  label: string;
  note: string;
  profile: Omit<FarmProfile, "id" | "name" | "profileVersion">;
}

const PRESETS: Preset[] = [
  {
    id: "pvh-28x2",
    label: "Racking tipo PVH — 28 × 2, modulos verticales",
    note: "Las medidas de cinta de Edenvale: panel de 1135 mm, hueco de 20 entre paneles y un solo hueco de 555 entre los dos strings. El offset es contra el PUNTO DEL EXCEL, que marca la punta del recorrido de modulos — no contra la pila de fundacion, que esta mas adentro.",
    profile: {
      module: { widthMm: 1135, gapMm: 20, orientation: "portrait", pitchMm: null },
      topology: { modulesPerString: 28, stringsPerRow: 2, stringGapMm: 555 },
      geometry: { source: "survey-stakes", endpointOffsetMm: -25, endpointOffsetMode: "centered" },
      addressing: {
        originStrategy: "dc-box-end",
        dcBoxPlacement: "center-road",
        inversionStrategy: "piercing-chain",
      },
      matching: { maxDistanceM: 30, neighborhood: 2, maxRowCandidates: 3, defaultAccuracyM: 3 },
    },
  },
  {
    id: "generico",
    label: "Generico — todavia no se las medidas de este parque",
    // El texto viejo decia "no inventa nada", y los cuatro numeros de abajo son
    // inventados: son los de Edenvale redondeados. Alguien que lea eso y toque
    // Siguiente se lleva un parque con 28 modulos por string porque la app se lo
    // dijo con cara de segura. Ahora dice de donde salen y que hay que cambiarlos.
    note: "Numeros de arranque, NO medidas de este parque: modulo de 1130 mm, 28 por string, uno solo por fila. Cambialos con la ficha del modulo o la cinta antes de guardar — mas abajo, el cuadre te dice si cierran con el largo real de tus filas.",
    profile: {
      module: { widthMm: 1130, gapMm: 20, orientation: "portrait", pitchMm: "derive" },
      topology: { modulesPerString: 28, stringsPerRow: 1, stringGapMm: 0 },
      geometry: { source: "survey-stakes", endpointOffsetMm: 0, endpointOffsetMode: "none" },
      addressing: { originStrategy: "fixed-end", fixedEnd: "north", inversionStrategy: "none" },
      matching: { maxDistanceM: 30, neighborhood: 2, maxRowCandidates: 3, defaultAccuracyM: 3 },
    },
  },
];

/**
 * El error de validacion, dicho como se llama la cosa en la pantalla.
 *
 * `validateProfile` habla en nombres de campo del JSON porque tambien lo usan
 * los tests y los perfiles escritos a mano. Al tecnico eso no le sirve:
 * "`module.pitchMm` tiene que ser un numero positivo" no le dice que control
 * tocar. Cada regla que puede disparar desde el asistente tiene aca su traduccion.
 */
const TRADUCCIONES: Array<[RegExp, string]> = [
  [/module\.widthMm/, 'El "Ancho del modulo" tiene que ser un numero mayor que cero, en milimetros.'],
  [/module\.lengthMm/, 'El "Largo del modulo" tiene que ser un numero mayor que cero, en milimetros.'],
  [/module\.gapMm/, 'El "Hueco entre modulos" no puede ser negativo. Si se tocan, poné 0.'],
  [/module\.pitchMm/, 'El "Paso entre modulos" quedo en un valor imposible. Elegí "Ancho + hueco".'],
  [/topology\.modulesPerString/, 'Los "Modulos por string" tienen que ser un numero entero mayor que cero.'],
  [/topology\.stringsPerRow/, 'Los "Strings por fila" tienen que ser un numero entero mayor que cero.'],
  [/topology\.stringGapMm/, 'La "Bahia entre strings" no puede ser negativa.'],
  [/topology\.gaps\[\d+\]\.afterModule/, "Uno de los huecos declarados apunta a un modulo que no existe en la fila, o esta repetido."],
  [/topology\.gaps\[\d+\]\.mm/, "Uno de los huecos declarados tiene una medida invalida."],
  [/geometry\.endpointOffsetMm/, 'La "Distancia del primer modulo a la pica" tiene que ser un numero (puede ser negativo).'],
  [/geometry\.endpointOffsetMode/, "El modo de reparto de las puntas quedo en un valor invalido."],
  [/centered.*no se puede usar/, 'No se puede centrar los modulos Y deducir el paso del largo al mismo tiempo: son la misma incognita dos veces. En "Paso entre modulos" elegí "Ancho + hueco".'],
  [/crs\.zone/, "La zona UTM tiene que estar entre 1 y 60. Volvé al paso de columnas y elegila."],
  [/crs\.hemisphere/, "Falta decir si el parque esta en el hemisferio norte o sur."],
];

export function traducirError(err: string): string {
  const partes = err.split(" · ");
  const dichas = new Set<string>();
  for (const p of partes) {
    const t = TRADUCCIONES.find(([re]) => re.test(p));
    dichas.add(t ? t[1] : p);
  }
  return [...dichas].join(" ");
}

/**
 * El CRS que le queda al parque despues de moverlo.
 *
 * Si el parque tenia zona UTM y se lo corre 6 grados, la zona pasa a ser la de
 * al lado: dejar la vieja escrita mentiria sobre donde esta el parque, que es
 * exactamente el error del que se viene.
 *
 * Si no tenia zona —o esta en grados decimales— no hay nada que ajustar: se
 * devuelve tal cual. Mover el parque no inventa un sistema de coordenadas.
 */
export function crsDespuesDelMovimiento(crs: Crs, desplazoLon: number): Crs {
  if (crs.type !== "utm" || !desplazoLon) return crs;
  const zona = crs.zone + Math.round(desplazoLon / 6);
  if (zona < 1 || zona > 60) return crs;
  return { ...crs, zone: zona };
}

const slug = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "parque";

// ---------------------------------------------------------------------------

interface SetupProps {
  onDone: () => void;
  onCancel: () => void;
  /** Si viene, en vez de crear un parque se le agrega geometria a este. */
  existing?: StoredFarm;
  /**
   * Entrar derecho a los parametros, sin pedir el archivo.
   *
   * Cada medicion de campo corrige un numero, y obligar a re-cargar el Excel
   * para tocarlo es fricción al pedo — y encima riesgosa: volver a pasar por la
   * ingesta es la unica forma de que se pierda algo.
   */
  soloParametros?: boolean;
}

export function Setup({ onDone, onCancel, existing, soloParametros }: SetupProps) {
  const [step, setStep] = useState(soloParametros ? 3 : 1);
  const [error, setError] = useState<string | null>(null);

  const [fileName, setFileName] = useState("");
  /** El archivo crudo, para poder releerlo con otra fila de encabezados. */
  const [archivo, setArchivo] = useState<File | null>(null);
  const [headerRow, setHeaderRow] = useState(1);
  /**
   * Columnas combinadas: en muchas planillas el bloque aparece una sola vez y
   * las filas de abajo quedan vacias. Sin rellenar hacia abajo, la mitad de las
   * filas quedan sin bloque y el parque sale partido en pedazos.
   */
  const [rellenar, setRellenar] = useState(true);
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [mapping, setMapping] = useState<Mapping>({});
  /*
    Ajustando parametros no entra ningun archivo, asi que la deteccion nunca
    corre: el estado tiene que arrancar del parque que ya esta. Sin esto el
    selector de zona del paso 3 aparecia vacio y guardar pisaba el CRS con
    "grados decimales", que es exactamente lo que no puede pasar.
  */
  const [crs, setCrs] = useState<Crs>(
    soloParametros && existing?.profile.crs ? existing.profile.crs : { type: "wgs84" },
  );
  /**
   * Cuantos grados de longitud mover el parque guardado, si cayo en el lugar
   * equivocado. Multiplo de 6: una zona UTM.
   *
   * Es un desplazamiento y NO "la zona nueva" a proposito. La zona guardada es
   * un dato que se puede perder —esta misma pantalla la borraba— y entonces no
   * hay de donde restar. Donde CAE el parque, en cambio, esta siempre, y es lo
   * que se puede verificar en un mapa.
   */
  const [desplazoLon, setDesplazoLon] = useState(0);
  /** Lo que la deteccion no pudo saber sola y hay que confirmar a mano. */
  const [crsAConfirmar, setCrsAConfirmar] = useState<string[]>([]);

  const [deriveSide, setDeriveSide] = useState(false);
  const [name, setName] = useState(existing?.profile.name ?? "");
  const [presetId, setPresetId] = useState(PRESETS[0]!.id);
  // Al agregarle geometria a un parque que ya existe se arranca de SU perfil,
  // no de un preset: ese perfil ya esta calibrado y pisarlo con los valores por
  // defecto seria tirar a la basura las medidas de campo.
  const [medidos, setMedidos] = useState<Record<string, boolean>>(existing?.medidos ?? {});
  const [profileDraft, setProfileDraft] = useState(
    existing
      ? {
          module: existing.profile.module,
          topology: existing.profile.topology,
          geometry: existing.profile.geometry,
          addressing: existing.profile.addressing,
          matching: existing.profile.matching,
        }
      : PRESETS[0]!.profile,
  );

  const sheet = sheets[sheetIndex];

  // -------------------------------------------------------------------------

  /**
   * Releer el mismo archivo con otra fila de encabezados.
   *
   * La pantalla de strings ya tenia este control; la de coordenadas, que es la
   * que se usa siempre, no. Una planilla con dos filas de titulo antes de los
   * encabezados —cosa normal en lo que manda un proyecto— entraba con los
   * nombres de columna en blanco o con "__EMPTY_3", el reconocimiento no
   * enganchaba nada, y no habia forma de arreglarlo desde la app.
   */
  async function releerCon(fila: number) {
    setHeaderRow(fila);
    if (archivo) await onFile(archivo, fila);
  }

  async function onFile(file: File, fila = headerRow) {
    setError(null);
    try {
      const parsed = await readWorkbook(await file.arrayBuffer(), fila);
      const usable = parsed.filter((s) => s.rows.length > 0);
      if (!usable.length) {
        setError("El archivo no tiene ninguna hoja con filas de datos.");
        return;
      }
      // Arranca por la hoja con mas filas, no por la primera: en Edenvale la
      // hoja con los datos no era la primera y eso costo una sesion entera.
      const best = usable.reduce((a, b) => (b.rows.length > a.rows.length ? b : a));
      const idx = usable.indexOf(best);
      setSheets(usable);
      setSheetIndex(idx);
      setFileName(file.name);
      applySheet(usable, idx);
      if (!name && !existing) setName(file.name.replace(/\.[^.]+$/, ""));
      setStep(2);
    } catch (e) {
      setError(`No pude leer el archivo: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  function applySheet(list: Sheet[], idx: number) {
    const s = list[idx];
    if (!s) return;
    const guess = suggestMapping(s.headers);
    setMapping(guess);
    const samples = s.rows.slice(0, 40).flatMap((r) => {
      const x = toNumber(guess.startX ? r[guess.startX] : null);
      const y = toNumber(guess.startY ? r[guess.startY] : null);
      return x != null && y != null ? [{ x, y }] : [];
    });
    const d = detectarCrs(samples);
    setCrs(d.crs);
    setCrsAConfirmar(d.aConfirmar);
  }

  // -------------------------------------------------------------------------

  /**
   * Volver a mirar el sistema de coordenadas cuando cambian las columnas.
   *
   * Antes se adivinaba UNA sola vez, al cargar el archivo, y con las columnas
   * que habia detectado el automatico. Si el automatico no reconocia los
   * encabezados —cosa normal en un parque nuevo— las muestras salian vacias, la
   * deteccion contestaba "grados", y despues la persona mapeaba a mano unas
   * columnas UTM que nadie volvia a mirar: 6.965.000 entraba como latitud.
   */
  useEffect(() => {
    if (!sheet || !mapping.startX || !mapping.startY) return;
    const samples = sheet.rows.slice(0, 40).flatMap((r) => {
      const x = toNumber(r[mapping.startX!]);
      const y = toNumber(r[mapping.startY!]);
      return x != null && y != null ? [{ x, y }] : [];
    });
    const d = detectarCrs(samples);
    setCrsAConfirmar(d.aConfirmar);
    // El tipo se corrige solo; la zona y el hemisferio los elige la persona.
    setCrs((actual) => (actual.type === d.crs.type ? actual : d.crs));
  }, [sheet, mapping.startX, mapping.startY]);

  /** Las columnas obligatorias que todavia no tienen a que columna del Excel apuntar. */
  const faltantes = useMemo(
    () => FIELDS.filter((f) => f.required && !mapping[f.key]).map((f) => f.label),
    [mapping],
  );

  /**
   * La hoja lista para leer: con las celdas combinadas rellenadas hacia abajo.
   *
   * Solo se rellenan las columnas donde eso tiene sentido — bloque, lado,
   * posicion en la linea, cuantos hay. Una coordenada NUNCA se rellena: copiar
   * la coordenada de la fila de arriba pondria dos trackers en el mismo lugar y
   * el motor contestaria con toda confianza sobre el equivocado.
   */
  const hoja = useMemo(() => {
    if (!sheet || !rellenar) return sheet;
    const cols = (["block", "side", "pos", "posTotal"] as const)
      .map((k) => mapping[k])
      .filter((c): c is string => !!c);
    return cols.length ? forwardFill(sheet, cols) : sheet;
  }, [sheet, rellenar, mapping.block, mapping.side, mapping.pos, mapping.posTotal]);

  const rawBuilt = useMemo(() => {
    if (!hoja) return null;
    const required = FIELDS.filter((f) => f.required);
    if (required.some((f) => !mapping[f.key])) return null;
    return buildRows(hoja, mapping, crs);
  }, [hoja, mapping, crs]);

  // Primero se fusiona con lo que el parque ya tiene, y RECIEN AHI se deduce el
  // lado de la calle. Al reves, un bloque partido entre dos archivos se deduce
  // con la mitad de sus filas — y la mitad de un bloque parece un solo lado.
  const rawMerge = useMemo(
    () => (rawBuilt ? mergeRows(existing?.rows ?? [], rawBuilt.rows) : null),
    [rawBuilt, existing],
  );

  // Sin archivo, el cuadre y el dibujo se calculan sobre las filas ya cargadas.
  const filasParaCuadre = soloParametros ? existing?.rows ?? [] : rawMerge?.rows ?? [];

  // Si el archivo no trae el lado de la calle, se puede sacar de la geometria:
  // las cajas DC estan en la calle del medio, asi que las filas caen en dos
  // grupos separados por ella. Es opcional y se muestra lo que dedujo.
  //
  // El `!mapping.side` no es decorativo: la casilla solo se muestra cuando el
  // archivo NO trae columna de lado, pero al asignarla despues la casilla
  // desaparecia y `deriveSide` seguia en true. Resultado: el dato del archivo,
  // que es el bueno, quedaba pisado por una deduccion — en silencio.
  const derivation = useMemo(
    () => (deriveSide && !mapping.side && rawMerge?.rows.length ? deriveSides(rawMerge.rows) : null),
    [deriveSide, mapping.side, rawMerge],
  );

  /**
   * El sentido del conteo, resuelto por geometria y sin preguntar nada.
   *
   * Va automatico a proposito. Antes salia de una etiqueta cardinal que despues
   * se invertia, y cuando quedaba al reves habia que ir a contar modulos bloque
   * por bloque para descubrirlo — en un parque de 36 bloques eso cuesta mas que
   * volar el dron. Que punta da a la calle de las cajas se MIDE.
   */
  const merge = useMemo(() => {
    if (soloParametros) return { rows: existing?.rows ?? [], nuevas: 0, repetidas: 0, colisiones: [], origenes: null };
    if (!rawMerge) return null;
    const conLado = !derivation
      ? rawMerge
      : {
          ...rawMerge,
          rows: rawMerge.rows.map((r) => {
            const side = derivation.sides.get(r.id);
            return side ? { ...r, side } : r;
          }),
        };
    const org = deriveOriginEnds(conLado.rows, profileDraft.addressing.dcBoxPlacement ?? "center-road");
    return { ...conLado, rows: aplicarOrigenes(conLado.rows, org), origenes: org };
  }, [rawMerge, derivation, soloParametros, existing, profileDraft.addressing.dcBoxPlacement]);

  // Lo que se muestra en el paso de columnas es siempre lo que entro del archivo.
  const built = rawBuilt;

  // El sentido de conteo, para mostrarlo en el paso 3 en vez del selector que
  // no hacia nada. Los bloques sin resolver son los que van a contestar mal en
  // el campo, asi que se nombran uno por uno.
  const origenes = merge?.origenes ?? null;
  const origenesSinResolver = useMemo(
    () => (origenes?.blocks ?? []).filter((b) => b.status !== "ok"),
    [origenes],
  );
  /*
    Que fraccion del parque quedo con el sentido resuelto.

    Importa porque el cartel era verde siempre. En Wellington decia "2348 de
    13606 filas con el sentido resuelto" en verde, al lado de un titulo que
    dice "no hay nada para elegir aca": se lee como que esta todo bien, y lo
    que informa es que el 83% del parque va a contar desde una punta que no se
    verifico. Un cartel verde sobre un numero malo es peor que no tenerlo.
  */
  const fraccionResuelta =
    origenes && merge?.rows.length ? origenes.origins.size / merge.rows.length : null;
  const sentidoOk = fraccionResuelta != null && fraccionResuelta >= 0.99;

  // El largo real de las filas despeja el offset de pica: las tres cantidades
  // (modulos, paso, offset) estan atadas, asi que conociendo dos sale la tercera.
  const modulesPerRowDraft =
    profileDraft.topology.modulesPerString * profileDraft.topology.stringsPerRow;
  const nominalPitchMm = profileDraft.module.widthMm + profileDraft.module.gapMm;
  const offsetHint = useMemo(
    () =>
      (soloParametros ? filasParaCuadre : built?.rows)?.length
        ? suggestEndpointOffsetMm(soloParametros ? filasParaCuadre : built!.rows, modulesPerRowDraft, nominalPitchMm, {
            moduleGapMm: profileDraft.module.gapMm,
            stringsPerRow: profileDraft.topology.stringsPerRow,
            stringGapMm: profileDraft.topology.stringGapMm ?? 0,
            ...(profileDraft.topology.gaps?.length ? { gaps: profileDraft.topology.gaps } : {}),
          })
        : null,
    [built, filasParaCuadre, soloParametros, modulesPerRowDraft, nominalPitchMm, profileDraft],
  );

  // El cuadre de la fila: sumar el fierro y compararlo con lo que mide.
  // Es lo que habria evitado despejar una bahia de 3713 mm y creerle.
  const cuadre = useMemo(
    () =>
      offsetHint
        ? cuadreDeFila({
            modulosPorFila: modulesPerRowDraft,
            stringsPorFila: profileDraft.topology.stringsPerRow,
            anchoModuloMm: profileDraft.module.widthMm,
            huecoEntreModulosMm: profileDraft.module.gapMm,
            bahiaMm: profileDraft.topology.stringGapMm ?? 0,
            ...(profileDraft.topology.gaps?.length ? { huecos: profileDraft.topology.gaps } : {}),
            offsetMm: profileDraft.geometry.endpointOffsetMm,
            modo: profileDraft.geometry.endpointOffsetMode ?? "both",
            largoMedidoM: offsetHint.medianLengthM,
            medidos: {
              ancho: !!medidos.ancho, hueco: !!medidos.hueco,
              bahia: !!medidos.bahia, offset: !!medidos.offset,
            },
          })
        : null,
    [offsetHint, modulesPerRowDraft, profileDraft, medidos],
  );

  const profile: FarmProfile = useMemo(
    () => ({
      id: existing?.profile.id ?? slug(name),
      name: name || "Parque sin nombre",
      profileVersion: (existing?.profile.profileVersion ?? 0) + 1,
      crs: crs.type === "utm" ? { type: "utm", zone: crs.zone, hemisphere: crs.hemisphere } : { type: "wgs84" },
      ...profileDraft,
      addressing: { ...profileDraft.addressing, originStrategy: "per-row-flag" as const },
      calibration: existing?.profile.calibration ?? {
        status: "unverified",
        notes: "Perfil creado desde el asistente. Ninguna regla verificada en campo todavia.",
      },
    }),
    [name, crs, profileDraft, existing],
  );

  const compiled: { farm: CompiledFarm } | { err: string } | null = useMemo(() => {
    // Ajustando parametros no hay archivo, asi que no se exige `built`: las
    // filas son las que el parque ya tiene.
    if (!merge?.rows.length) return null;
    if (!soloParametros && !built?.rows.length) return null;
    try {
      return { farm: compileFarm(profile, merge.rows) };
    } catch (e) {
      if (e instanceof ProfileError) return { err: e.issues.join(" · ") };
      return { err: e instanceof Error ? e.message : String(e) };
    }
  }, [merge, built, profile, soloParametros]);

  const farm = compiled && "farm" in compiled ? compiled.farm : null;

  async function save() {
    if (!farm || !merge) return;
    if (!soloParametros && !built) return;

    /*
      Mover el parque mueve las FILAS, no un numero del perfil.

      Las coordenadas guardadas ya estan en grados. El traslado es exacto: para
      el mismo par este/norte, una zona de diferencia corre la longitud 6 grados
      justos y deja la latitud igual. Por eso no hace falta el archivo original
      ni reproyectar nada. Hay test en test/utm.test.ts, en los dos hemisferios:
      si eso dejara de valer, esto corrompe el parque en silencio.
    */
    let filas = merge.rows;
    if (soloParametros && desplazoLon) {
      filas = filas.map((r) => ({
        ...r,
        start: { ...r.start, lon: r.start.lon + desplazoLon },
        end: { ...r.end, lon: r.end.lon + desplazoLon },
      }));
    }

    /*
      EL BUG QUE COSTO EL PARQUE ENTERO.

      `profile.crs` se armaba siempre del estado `crs` de esta pantalla, y en
      modo "ajustar parametros" ese estado arrancaba en `{type:"wgs84"}` porque
      nunca corre la deteccion —no entra ningun archivo—. O sea que entrar a
      cambiar el ancho del modulo BORRABA la zona UTM del parque, en silencio,
      sin tocar las filas.

      Las filas seguian bien, el cuadre cerraba, los planos cruzaban: no habia
      un solo sintoma. Y despues, al ir a corregir la zona, la pantalla decia
      "este parque no tiene zona guardada" — la habia borrado ella misma.

      Ajustando parametros el CRS del parque no se toca nunca: no hay ninguna
      informacion nueva sobre el, y lo unico que puede hacer esta pantalla con
      ese dato es perderlo.
    */
    const perfilFinal: FarmProfile =
      soloParametros && existing?.profile.crs
        ? { ...profile, crs: crsDespuesDelMovimiento(existing.profile.crs, desplazoLon) }
        : profile;

    const stored: StoredFarm = {
      profile: perfilFinal,
      rows: filas,
      savedAt: new Date().toISOString(),
      // Ajustando parametros no entro ningun archivo: se conserva de donde
      // vinieron las filas en su momento, en vez de pisarlo con vacio.
      source: soloParametros
        ? existing?.source ?? { fileName: "", sheetName: "", rowCount: merge.rows.length }
        : { fileName, sheetName: sheet?.name ?? "", rowCount: merge.rows.length },
      ...(existing?.checks ? { checks: existing.checks } : {}),
      // Que se midio con cinta y que se supuso es parte de la evidencia del
      // parque, no un detalle de la pantalla: se guarda.
      medidos,
    };
    await saveFarm(stored);
    onDone();
  }

  // -------------------------------------------------------------------------

  return (
    <div className="screen">
      <header className="screen-head">
        <div>
          <p className="eyebrow">{existing ? existing.profile.name : "Nuevo parque"}</p>
          {/*
            Las dos pantallas decian lo mismo.

            "Ajustar parametros" y "Agregar geometria" son botones pegados en la
            lista de parques y las dos abrian una pantalla titulada "Agregar mas
            geometria". Sin manera de saber en cual estas: si el campo que
            buscas no aparece, no podes distinguir "me equivoque de boton" de
            "la app no lo tiene". Paso justo eso.
          */}
          <h1>
            {soloParametros
              ? "Ajustar los parametros"
              : existing ? "Agregar mas geometria" : "Cargar los datos que tengas"}
          </h1>
        </div>
        <button className="ghost" onClick={onCancel}>Cancelar</button>
      </header>

      <ol className="steps">
        {["Archivo", "Columnas", "Parametros", "Revision"].map((label, i) => (
          <li key={label} className={step === i + 1 ? "on" : step > i + 1 ? "done" : ""}>
            <span>{i + 1}</span>
            {label}
          </li>
        ))}
      </ol>

      {error && <p className="alert">{error}</p>}

      {/* ---------------------------------------------------------------- */}
      {step === 1 && (
        <section className="card">
          <h2>1 · El archivo de coordenadas</h2>
          {existing && (
            <p className="note ok">
              Este parque ya tiene <strong>{existing.rows.length} filas</strong>. Lo que cargues se
              suma a eso: las filas nuevas se agregan y las que ya existan se actualizan. Los
              parametros de geometria que ya calibraste no se tocan.
            </p>
          )}
          <p>
            Un Excel o CSV donde cada fila sea un tracker con las coordenadas de sus dos picas.
            Sirven grados decimales o UTM: la app se da cuenta sola y despues te lo muestra para
            que lo confirmes.
          </p>
          <label className="drop">
            <input
              type="file"
              accept=".xlsx,.xls,.xlsm,.csv,.tsv"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) { setArchivo(f); void onFile(f); } }}
            />
            <strong>Elegir archivo</strong>
            <span className="muted">.xlsx · .xls · .csv</span>
          </label>
          <p className="muted small">
            Si el cliente no tiene coordenadas, todavia se puede trabajar — pero eso es otro camino
            y lo vemos aparte. Esta pantalla espera coordenadas.
          </p>
        </section>
      )}

      {/* ---------------------------------------------------------------- */}
      {step === 2 && sheet && (
        <section className="card">
          <h2>2 · Que es cada columna</h2>
          <p>
            Esto es lo que la app cree que encontro en <strong>{fileName}</strong>. Corregi lo que
            este mal — nada se aplica sin que lo confirmes.
          </p>

          {sheets.length > 1 && (
            <div className="field">
              <label>Hoja del archivo</label>
              <select
                value={sheetIndex}
                onChange={(e) => { const i = Number(e.target.value); setSheetIndex(i); applySheet(sheets, i); }}
              >
                {sheets.map((s, i) => (
                  <option key={s.name} value={i}>{s.name} — {s.rows.length} filas</option>
                ))}
              </select>
            </div>
          )}

          {/*
            Dos controles que ya existian en la pantalla de strings y faltaban
            justo en la que se usa siempre. Sin ellos, una planilla con dos
            filas de titulo entra con los encabezados en blanco y no hay forma
            de arreglarlo desde la app; y una con el bloque combinado sobre
            veinte filas deja diecinueve sin bloque, que parte el parque en
            pedazos que despues no cruzan con nada.
          */}
          <div className="row">
            <label className="inline">
              Fila de encabezados
              <input
                type="number" min={1} max={20} value={headerRow}
                onChange={(e) => void releerCon(Math.max(1, Number(e.target.value) || 1))}
              />
            </label>
            <span className="help">
              Si los nombres de columna de abajo se ven raros o vacios, subile uno.
            </span>
          </div>

          <label className="check">
            <input type="checkbox" checked={rellenar} onChange={(e) => setRellenar(e.target.checked)} />
            <span>
              Rellenar hacia abajo las celdas combinadas
              <em>
                Bloque, lado y posicion suelen venir escritos una sola vez, arriba de un grupo de
                filas. Sin esto, todas las de abajo quedan sin ese dato.
              </em>
            </span>
          </label>

          <div className="grid-2">
            {FIELDS.map((f) => (
              <div className="field" key={f.key}>
                <label>
                  {f.label}
                  {f.required ? <em className="req"> obligatorio</em> : <em className="opt"> opcional</em>}
                </label>
                <select
                  value={mapping[f.key] ?? ""}
                  onChange={(e) =>
                    setMapping((m) => ({ ...m, [f.key]: e.target.value || undefined }))
                  }
                >
                  <option value="">— sin asignar —</option>
                  {sheet.headers.map((h) => (<option key={h} value={h}>{h}</option>))}
                </select>
                <span className="help">{f.help}</span>
              </div>
            ))}
          </div>

          <h3>Sistema de coordenadas</h3>
          <div className="row">
            <select
              value={crs.type}
              onChange={(e) =>
                setCrs(e.target.value === "utm" ? { type: "utm", zone: 0, hemisphere: "S" } : { type: "wgs84" })
              }
            >
              <option value="wgs84">Grados decimales (lat / lon)</option>
              <option value="utm">UTM (metros)</option>
            </select>
            {crs.type === "utm" && (
              <>
                {/*
                  Vacio, no "0".

                  Cero no es una zona: es el centinela de "todavia no la sabemos".
                  Mostrado como 0 en la casilla se lee como un valor cargado, y
                  el cartel rojo de abajo parece un error de la app en vez de un
                  campo que falta. Con la casilla vacia, falta se ve que falta.
                */}
                <label className="inline">Zona
                  <input
                    type="number" min={1} max={60} placeholder="1 a 60"
                    value={crs.zone || ""}
                    onChange={(e) => setCrs({ ...crs, zone: Number(e.target.value) || 0 })}
                  />
                </label>
                <label className="inline">Hemisferio
                  <select
                    value={crs.hemisphere}
                    onChange={(e) => setCrs({ ...crs, hemisphere: e.target.value as "N" | "S" })}
                  >
                    <option value="S">Sur</option>
                    <option value="N">Norte</option>
                  </select>
                </label>
              </>
            )}
          </div>

          {crs.type === "utm" && !crs.zone && (
            <div className="note bad">
              <p>
                <strong>Falta la zona UTM.</strong> No viene en el archivo: el mismo par de números
                existe en las 60 zonas del planeta, así que si la app la eligiera sola tendrías un
                parque en otro continente sin ninguna señal.
              </p>
              <label className="inline">
                ¿No la sabés? Pegá una coordenada del parque
                <input
                  type="text" placeholder="ej: -26.92, 150.58"
                  onChange={(e) => {
                    const m = /(-?\d+[.,]?\d*)\s*[,;\s]\s*(-?\d+[.,]?\d*)/.exec(e.target.value);
                    if (!m) return;
                    const lat = Number(m[1]!.replace(",", "."));
                    const lon = Number(m[2]!.replace(",", "."));
                    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
                    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return;
                    setCrs({
                      type: "utm",
                      zone: Math.min(60, Math.floor((lon + 180) / 6) + 1),
                      hemisphere: lat < 0 ? "S" : "N",
                    });
                  }}
                />
              </label>
              <p className="help">
                Cualquier punto del sitio sirve: abrí Google Maps, botón derecho sobre el parque,
                y pegá acá lo que copia. De ahí salen la zona y el hemisferio, que son lo único
                que el archivo no puede decir.
              </p>
            </div>
          )}

          {crsAConfirmar.length > 0 && crs.type === "utm" && !!crs.zone && (
            <details className="porque">
              <summary>Por qué hay que confirmar esto a mano</summary>
              {crsAConfirmar.map((t, i) => (<p key={i} className="help">{t}</p>))}
            </details>
          )}

          {/*
            La verificación que no se puede fingir.
            ===================================================================
            Con la zona equivocada las filas siguen midiendo lo que tienen que
            medir, el dibujo sale bien y el cuadre cierra: el marco local se
            arma sobre el propio parque, así que ponerlo en otro continente no
            cambia ninguna distancia interna. El único síntoma aparece parado
            en el campo. Por eso acá no se muestra un número más: se muestra
            DÓNDE CAE, con el mapa a un toque.
          */}
          {built?.bounds && (
            <div className={`note ${built.sospechas.length ? "bad" : "ok"}`}>
              <p>
                <strong>El parque cae acá:</strong>{" "}
                <span className="mono">
                  {((built.bounds.minLat + built.bounds.maxLat) / 2).toFixed(5)},{" "}
                  {((built.bounds.minLon + built.bounds.maxLon) / 2).toFixed(5)}
                </span>{" "}
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${
                    (built.bounds.minLat + built.bounds.maxLat) / 2
                  },${(built.bounds.minLon + built.bounds.maxLon) / 2}`}
                  target="_blank" rel="noreferrer"
                >
                  abrir en el mapa →
                </a>
              </p>
              <p className="help">
                Abrilo y mirá que se vean los paneles. Es el único chequeo que no se puede fingir:
                con la zona o el hemisferio equivocados todo lo demás sigue dando bien y el parque
                queda a miles de kilómetros.
              </p>
              {/*
                Y si cae en el mar, qué.

                El cartel de arriba ya avisaba —mostraba el punto y el mapa— pero
                dejaba a la persona sin la salida: ver océano no dice qué número
                cambiar, y la zona UTM no es algo que alguien sepa de memoria.
                Wellington North se cargó con la zona 56 y cayó 560 km adentro
                del mar de Tasmania; la correcta era la 55, la de al lado.

                Errarle por una zona es EL error de este campo, porque las zonas
                miden 6° y los parques no vienen con una etiqueta. Y se arregla
                mirando: cambiar de zona corre la longitud exactamente 6°, la
                latitud no se mueve, así que las vecinas se calculan sin volver a
                convertir nada. Con los tres puntos a la vista, elegir es
                reconocer el lugar en el mapa en vez de saber de cartografía.
              */}
              {crs.type === "utm" && !!crs.zone && (
                <p className="help">
                  ¿Cayó en el mar o en otro país? Casi siempre es la zona de al lado — cambiarla
                  corre el parque 6° de longitud y nada más. Con las vecinas caería en:{" "}
                  {[crs.zone - 1, crs.zone + 1]
                    .filter((z) => z >= 1 && z <= 60)
                    .map((z, i, arr) => {
                      const lat = (built.bounds!.minLat + built.bounds!.maxLat) / 2;
                      const lon =
                        (built.bounds!.minLon + built.bounds!.maxLon) / 2 + (z - crs.zone) * 6;
                      return (
                        <span key={z}>
                          <button
                            className="link"
                            onClick={() => setCrs({ ...crs, zone: z })}
                          >
                            zona {z}
                          </button>{" "}
                          <a
                            href={`https://www.google.com/maps/search/?api=1&query=${lat},${lon}`}
                            target="_blank" rel="noreferrer"
                          >
                            ({lat.toFixed(3)}, {lon.toFixed(3)})
                          </a>
                          {i < arr.length - 1 ? " · " : "."}
                        </span>
                      );
                    })}
                </p>
              )}
              {built.sospechas.map((t, i) => (<p key={i} className="alert">{t}</p>))}
            </div>
          )}

          {!mapping.side && (
            <>
              <h3>El lado de la calle</h3>
              <label className="check">
                <input
                  type="checkbox"
                  checked={deriveSide}
                  onChange={(e) => setDeriveSide(e.target.checked)}
                />
                <span>
                  Deducirlo de la geometria
                  <em>
                    El archivo no trae columna de lado. Sin ese dato, el conteo desde la caja DC
                    elige una punta al azar en cada fila: le pega en la mitad de los trackers y sale
                    espejado en la otra mitad. Como las cajas estan en la calle del medio, las filas
                    caen en dos grupos separados por ella — y eso si se puede leer de las
                    coordenadas.
                  </em>
                </span>
              </label>

              {derivation && (
                <div className={derivation.blocks.some((b) => b.status !== "dos-lados") ? "warnbox" : "note ok"}>
                  <ul className="derive">
                    {derivation.blocks.map((b) => (
                      <li key={b.block} className={b.status === "dos-lados" ? "yes" : "no"}>
                        <strong>Bloque {b.block}</strong> — {b.detail}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}

          <h3>Las primeras filas, como quedaron</h3>
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  {FIELDS.filter((f) => mapping[f.key]).map((f) => (<th key={f.key}>{f.label}</th>))}
                </tr>
              </thead>
              <tbody>
                {sheet.rows.slice(0, 6).map((r, i) => (
                  <tr key={i}>
                    {FIELDS.filter((f) => mapping[f.key]).map((f) => (
                      <td key={f.key} className="mono">{String(r[mapping[f.key]!] ?? "—")}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {built && (
            <>
              <p className={built.rows.length ? "note ok" : "note bad"}>
                {built.rows.length} filas de trackers construidas
                {built.skipped.length ? `, ${built.skipped.length} salteadas` : ""}
                {built.rows.length ? ` · el parque ocupa ${boundsSummary(built.rows)}` : ""}.
              </p>
              {built.skippedSummary.length > 0 && (
                <div className="warnbox">
                  <h3>Por que se saltearon</h3>
                  <ul>
                    {built.skippedSummary.map((s) => {
                      // Un bloque contiguo al final del archivo suele ser una
                      // tabla de totales, no datos que se estan perdiendo.
                      const contiguo = s.lastRow - s.firstRow + 1 === s.count;
                      return (
                        <li key={s.reason}>
                          <strong>{s.count}</strong> filas: {s.reason}.{" "}
                          {contiguo ? (
                            <>
                              Van seguidas, de la {s.firstRow} a la {s.lastRow}.
                            </>
                          ) : (
                            <>
                              Desparramadas entre la fila {s.firstRow} y la {s.lastRow} — eso si son
                              datos incompletos y conviene mirarlas en el Excel.
                            </>
                          )}
                          <ul className="muestra">
                            {s.sample.map((m) => (
                              <li key={m.row}>
                                <span className="mono">fila {m.row}</span> {m.cells}
                              </li>
                            ))}
                          </ul>
                          <span className="muted small">
                            Si ahi no hay ningun tracker de verdad, no te falta nada.
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </>
          )}
          {/*
            "Falta asignar alguna columna obligatoria" y nada mas: con 40
            columnas en el Excel eso es un buscar a ciegas. Ahora dice cuales.
          */}
          {!built && (
            <p className="note bad">
              {faltantes.length === 1
                ? <>Falta asignar la columna <strong>{faltantes[0]}</strong>.</>
                : <>Faltan asignar estas columnas: <strong>{faltantes.join(", ")}</strong>.</>}
              {" "}Elegilas en la lista de arriba. Si el archivo no las trae, no alcanza para armar
              el parque: cada tracker necesita las coordenadas de sus dos picas.
            </p>
          )}

          <div className="actions">
            <button className="ghost" onClick={() => setStep(1)}>Atras</button>
            <button disabled={!built?.rows.length} onClick={() => setStep(3)}>Siguiente</button>
          </div>
        </section>
      )}

      {/* ---------------------------------------------------------------- */}
      {step === 3 && (
        <section className="card">
          <h2>3 · Como esta armado el parque</h2>

          {/*
            Donde cae el parque, y como moverlo si cayo mal.
            ===================================================================
            Esto empezo como un selector de zona UTM y estaba mal planteado.

            Wellington North entro con la zona 56 en vez de la 55 y quedo 560 km
            adentro del mar de Tasmania. Pero cuando fui a corregirlo, el
            selector no aparecia: el parque YA NO TENIA zona guardada. La habia
            borrado esta misma pantalla —ver el guard en `save()`— asi que
            corregir "la zona" era imposible por construccion.

            La leccion es que la zona guardada es un dato que se puede perder, y
            no puede ser de lo que dependa poder arreglar el parque. Lo que
            nunca se pierde es DONDE CAE. Asi que la pregunta ya no es "¿que
            zona es?" sino "¿cae donde tiene que caer?", y la respuesta se
            verifica en un mapa, que es lo unico que no se puede fingir.

            Mover una zona son 6 grados de longitud exactos, sin tocar la
            latitud (test en test/utm.test.ts). Eso vale igual tenga el parque
            zona guardada o no.
          */}
          {soloParametros && !!existing?.rows.length && (() => {
            const r0 = existing.rows[0]!;
            const lat = (r0.start.lat + r0.end.lat) / 2;
            const lon = (r0.start.lon + r0.end.lon) / 2;
            const mapa = (la: number, lo: number) =>
              `https://www.google.com/maps/search/?api=1&query=${la},${lo}`;
            const zonaDe = (lo: number) => Math.floor((lo + 180) / 6) + 1;
            return (
              <div className={desplazoLon ? "note bad" : "note"}>
                <h3>Donde cae el parque</h3>
                <p>
                  Hoy cae en{" "}
                  <span className="mono">{lat.toFixed(5)}, {lon.toFixed(5)}</span>{" "}
                  <a href={mapa(lat, lon)} target="_blank" rel="noreferrer">ver en el mapa →</a>
                  {" "}(zona UTM {zonaDe(lon)}).
                </p>
                <p className="help">
                  Abrilo y fijate que se vean los paneles. Con la zona equivocada todo lo demas
                  sigue dando bien —el cuadre cierra, el dibujo sale, los planos cruzan— y el unico
                  sintoma aparece parado en el campo o al exportar el KML.
                </p>
                <p className="help">
                  Si cayo en el lugar equivocado, casi siempre es la zona UTM de al lado: eso corre
                  el parque 6 grados de longitud y no toca nada mas. Adentro del parque no cambia
                  nada — mismo tracker, mismo string, mismo modulo.
                </p>
                <div className="acciones-zona">
                  {[-6, 6].map((d) => (
                    <span key={d}>
                      <button
                        className="link"
                        onClick={() => setDesplazoLon(desplazoLon === d ? 0 : d)}
                      >
                        {desplazoLon === d ? "✓ " : ""}Moverlo 6° al {d < 0 ? "oeste" : "este"}
                      </button>{" "}
                      <a href={mapa(lat, lon + d)} target="_blank" rel="noreferrer">
                        ({(lon + d).toFixed(4)}, zona {zonaDe(lon + d)}) ver mapa →
                      </a>
                      {d < 0 ? " · " : ""}
                    </span>
                  ))}
                </div>
                {!!desplazoLon && (
                  <p>
                    <strong>
                      Al guardar, las {existing.rows.length} filas se mueven 6° al{" "}
                      {desplazoLon < 0 ? "oeste" : "este"}
                    </strong>{" "}
                    y el parque queda en{" "}
                    <span className="mono">{lat.toFixed(5)}, {(lon + desplazoLon).toFixed(5)}</span>.
                    Abri ese mapa antes de guardar.
                  </p>
                )}
              </div>
            );
          })()}
          {!existing && (
            <div className="field">
              <label htmlFor="farm-name">Nombre del parque</label>
              <input
                id="farm-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ej: Edenvale Solar Farm"
              />
              <span className="help">El identificador interno va a ser <code>{slug(name)}</code>.</span>
            </div>
          )}

          {/*
            Antes esto era `hidden={!!existing}`, y `.field { display: flex }`
            le gana al atributo `hidden`: el selector se veia igual editando un
            parque ya calibrado, y tocarlo pisaba el perfil entero con los
            valores del preset — o sea, tiraba las medidas de cinta. Ahora
            directamente no se monta.
          */}
          {!existing && (
          <div className="field">
            <label>Punto de partida</label>
            <select
              value={presetId}
              onChange={(e) => {
                const p = PRESETS.find((x) => x.id === e.target.value)!;
                setPresetId(p.id);
                setProfileDraft(p.profile);
              }}
            >
              {PRESETS.map((p) => (<option key={p.id} value={p.id}>{p.label}</option>))}
            </select>
            <span className="help">{PRESETS.find((p) => p.id === presetId)?.note}</span>
          </div>
          )}

          <div className="grid-2">
            <div className="field">
              <label>Modulos por string</label>
              <input
                type="number" min={1} value={profileDraft.topology.modulesPerString}
                onChange={(e) => setProfileDraft((d) => ({
                  ...d, topology: { ...d.topology, modulesPerString: Number(e.target.value) },
                }))}
              />
            </div>
            {/*
              LA pregunta que la geometria no puede contestar.
              ===================================================================
              Una fila de 28 modulos con una bahia en el medio se ve EXACTAMENTE
              igual si son dos strings de 14 o uno solo de 28 partido por el
              motor. Los modulos caen en los mismos milimetros y el cuadro cierra
              igual. Lo unico que cambia es la direccion que se entrega: con dos
              strings, el modulo 17 se reporta "string 2, modulo 3"; con uno,
              "modulo 17". El tecnico sale a buscar un string que no existe.

              No hay forma de deducirlo del archivo de picas. Lo unico honesto es
              preguntarlo bien, con el ejemplo adelante.
            */}
            <div className="field">
              <label>Strings por fila</label>
              <input
                type="number" min={1} value={profileDraft.topology.stringsPerRow}
                onChange={(e) => setProfileDraft((d) => ({
                  ...d, topology: { ...d.topology, stringsPerRow: Number(e.target.value) },
                }))}
              />
              <span className="help">
                Strings <strong>electricos</strong>, no mitades del tracker. Si el tracker tiene una
                bahia en el medio pero las dos mitades son <strong>un solo string</strong>, acá va{" "}
                <strong>1</strong> y arriba el total de modulos: la bahia se declara aparte, en "los
                huecos uno por uno". Se ve igual de las dos formas y numera distinto.
              </span>
              {profileDraft.topology.stringsPerRow > 1 && (
                <p className="note">
                  Con {profileDraft.topology.stringsPerRow} strings por fila, el modulo{" "}
                  {profileDraft.topology.modulesPerString + 1} se va a reportar como{" "}
                  <strong>"string 2, modulo 1"</strong>, no como "modulo{" "}
                  {profileDraft.topology.modulesPerString + 1}". Si el plano de tu parque lo numera
                  de corrido hasta {modulesPerRowDraft}, poné 1 string de {modulesPerRowDraft}{" "}
                  modulos y declará la bahia como hueco.
                </p>
              )}
            </div>
            <div className="field">
              <label>Ancho del modulo sobre el eje (mm)</label>
              <input
                type="number" min={1} value={profileDraft.module.widthMm}
                onChange={(e) => setProfileDraft((d) => ({
                  ...d, module: { ...d.module, widthMm: Number(e.target.value) },
                }))}
              />
              <span className="help">Vertical ronda 1130 mm; apaisado ronda 2280 mm.</span>
              <label className="cinta">
                <input type="checkbox" checked={!!medidos.ancho}
                  onChange={(e) => setMedidos((m) => ({ ...m, ancho: e.target.checked }))} />
                lo medí con cinta
              </label>
            </div>
            <div className="field">
              <label>Bahia entre strings (mm)</label>
              <input
                type="number" min={0} value={profileDraft.topology.stringGapMm ?? 0}
                onChange={(e) => setProfileDraft((d) => ({
                  ...d, topology: { ...d.topology, stringGapMm: Number(e.target.value) },
                }))}
              />
              <span className="help">
                El espacio libre donde va el motor, entre un string y el siguiente. No es el
                huequito entre modulos, y hay uno solo por fila. Olvidarlo corre el string lejano
                esa distancia entera. Medilo con cinta: en Edenvale se habia despejado en 3713 mm
                —el unico numero que hacia cerrar la cuenta— y la cinta dio 555.
              </span>
              <label className="cinta">
                <input type="checkbox" checked={!!medidos.bahia}
                  onChange={(e) => setMedidos((m) => ({ ...m, bahia: e.target.checked }))} />
                lo medí con cinta
              </label>

              {/*
                Los huecos uno por uno.
                =====================================================
                Va escondido detras de un boton a proposito. El 90 % de los
                parques son strings iguales con bahias iguales, y para esos
                esto no tiene que existir. Pero hay trackers donde el primer
                panel va solo, despues un hueco, despues todos los demas, y
                otro hueco antes del ultimo — y ese caso no se puede aproximar:
                el total cierra igual y cada modulo del medio queda corrido casi
                un metro.
              */}
              {!profileDraft.topology.gaps?.length ? (
                <button
                  type="button" className="link"
                  onClick={() => setProfileDraft((d) => ({
                    ...d,
                    topology: {
                      ...d.topology,
                      gaps: [{ afterModule: 1, mm: d.topology.stringGapMm ?? 0 }],
                    },
                  }))}
                >
                  Los huecos no están entre strings iguales
                </button>
              ) : (
                <div className="huecos">
                  <p className="help">
                    Cada hueco grande, uno por uno: después de qué módulo de la fila cae —contando
                    desde el extremo por donde se cuenta— y cuánto mide. Mientras haya huecos acá,
                    la bahía de arriba no se usa.
                  </p>
                  {profileDraft.topology.gaps.map((g, i) => (
                    <div className="hueco" key={i}>
                      <label>
                        después del módulo
                        <input
                          type="number" min={1} max={Math.max(1, modulesPerRowDraft - 1)}
                          value={g.afterModule}
                          onChange={(e) => setProfileDraft((d) => ({
                            ...d,
                            topology: {
                              ...d.topology,
                              gaps: (d.topology.gaps ?? []).map((x, j) =>
                                j === i ? { ...x, afterModule: Number(e.target.value) } : x),
                            },
                          }))}
                        />
                      </label>
                      <label>
                        mide (mm)
                        <input
                          type="number" min={0} value={g.mm}
                          onChange={(e) => setProfileDraft((d) => ({
                            ...d,
                            topology: {
                              ...d.topology,
                              gaps: (d.topology.gaps ?? []).map((x, j) =>
                                j === i ? { ...x, mm: Number(e.target.value) } : x),
                            },
                          }))}
                        />
                      </label>
                      <button
                        type="button" className="link danger"
                        onClick={() => setProfileDraft((d) => ({
                          ...d,
                          topology: { ...d.topology, gaps: (d.topology.gaps ?? []).filter((_, j) => j !== i) },
                        }))}
                      >
                        quitar
                      </button>
                    </div>
                  ))}
                  <button
                    type="button" className="link"
                    onClick={() => setProfileDraft((d) => {
                      const g = d.topology.gaps ?? [];
                      const ultimo = g.length ? g[g.length - 1]! : { afterModule: 0, mm: 0 };
                      return {
                        ...d,
                        topology: {
                          ...d.topology,
                          // Ordenados como estan en la fila: leerlos en orden es
                          // lo que deja compararlos contra el tracker de un vistazo.
                          gaps: [...g, {
                            afterModule: Math.min(ultimo.afterModule + 1, Math.max(1, modulesPerRowDraft - 1)),
                            mm: ultimo.mm,
                          }],
                        },
                      };
                    })}
                  >
                    Agregar otro hueco
                  </button>
                </div>
              )}
            </div>
            <div className="field">
              <label>Hueco entre modulos (mm)</label>
              <input
                type="number" min={0} value={profileDraft.module.gapMm}
                onChange={(e) => setProfileDraft((d) => ({
                  ...d, module: { ...d.module, gapMm: Number(e.target.value) },
                }))}
              />
              <label className="cinta">
                <input type="checkbox" checked={!!medidos.hueco}
                  onChange={(e) => setMedidos((m) => ({ ...m, hueco: e.target.checked }))} />
                lo medí con cinta
              </label>
            </div>
            <div className="field">
              <label>Que marca el punto que trae el archivo</label>
              <select
                value={profileDraft.geometry.endpointOffsetMode ?? "both"}
                onChange={(e) => setProfileDraft((d) => ({
                  ...d,
                  geometry: {
                    ...d.geometry,
                    endpointOffsetMode: e.target.value as "both" | "origin" | "none" | "centered",
                  },
                }))}
              >
                <option value="centered">La punta del recorrido de modulos (o casi)</option>
                <option value="both">Un punto a una distancia fija del primer modulo, en las dos puntas</option>
                <option value="origin">Lo mismo, pero solo en la punta desde donde se cuenta</option>
                <option value="none">Justo el borde del primer modulo, sin nada de sobra</option>
              </select>
              <span className="help">
                Esta es la pregunta de fondo, y conviene contestarla mirando el archivo y no de
                memoria. Si el topografo tomo el punto sobre el <strong>primer panel</strong> —no
                sobre la pila de fundacion— la primera opcion es la que corresponde: los modulos se
                acomodan adentro del largo real de cada fila y esa distancia deja de ser un dato que
                haya que acertar. La diferencia de pocos centimetros que igual queda se reparte sola
                entre las dos puntas. Elegi una de las otras solo si el punto esta a una distancia
                que <em>mediste</em>.
              </span>
            </div>
            <div
              className="field"
              style={
                (profileDraft.geometry.endpointOffsetMode ?? "both") === "centered"
                  ? { opacity: 0.5 }
                  : undefined
              }
            >
              <label>Distancia del punto del archivo al primer modulo (mm)</label>
              <input
                type="number" value={profileDraft.geometry.endpointOffsetMm}
                disabled={(profileDraft.geometry.endpointOffsetMode ?? "both") === "centered"}
                onChange={(e) => setProfileDraft((d) => ({
                  ...d, geometry: { ...d.geometry, endpointOffsetMm: Number(e.target.value) },
                }))}
              />
              {(profileDraft.geometry.endpointOffsetMode ?? "both") === "centered" && (
                <span className="help">
                  Con la opcion de arriba, este numero <strong>no se usa para nada</strong>: no hace
                  falta que lo pongas en cero ni que lo toques. Lo que aplica de verdad es el reparto
                  que ves en el cuadre, aca abajo.
                </span>
              )}
              {offsetHint && (
                <span className="help">
                  El fierro suma <strong>{(offsetHint.extentMm / 1000).toFixed(3)} m</strong>:{" "}
                  {modulesPerRowDraft} modulos de {profileDraft.module.widthMm} mm,{" "}
                  {modulesPerRowDraft - profileDraft.topology.stringsPerRow} huecos de{" "}
                  {profileDraft.module.gapMm} mm
                  {profileDraft.topology.stringsPerRow > 1
                    ? ` y ${profileDraft.topology.stringsPerRow - 1} bahia${profileDraft.topology.stringsPerRow > 2 ? "s" : ""} de ${profileDraft.topology.stringGapMm ?? 0} mm`
                    : ""}. Tus filas miden{" "}
                  <strong>{offsetHint.medianLengthM.toFixed(3)} m</strong> entre los dos puntos del
                  archivo, asi que sobran{" "}
                  <strong>{Math.abs(offsetHint.offsetMm * 2).toFixed(0)} mm</strong> repartidos en
                  las dos puntas: <strong>{offsetHint.offsetMm.toFixed(0)} mm</strong> cada una
                  {offsetHint.offsetMm < 0 ? " (negativo: los modulos sobresalen mas alla del punto del archivo)" : ""}.
                  {(profileDraft.geometry.endpointOffsetMode ?? "both") !== "centered" &&
                    Math.abs(offsetHint.offsetMm - profileDraft.geometry.endpointOffsetMm) > 50 && (
                    <>
                      {" "}
                      <button
                        className="link"
                        onClick={() => setProfileDraft((d) => ({
                          ...d,
                          geometry: {
                            ...d.geometry,
                            endpointOffsetMm: Math.round(offsetHint.offsetMm),
                          },
                        }))}
                      >
                        Usar {offsetHint.offsetMm.toFixed(0)} mm
                      </button>
                    </>
                  )}
                  {offsetHint.spreadMm > 500 && (
                    <>
                      {" "}Ojo: los largos varian {(offsetHint.spreadMm / 1000).toFixed(1)} m entre
                      filas, asi que no todas tienen la misma cantidad de modulos.
                    </>
                  )}
                </span>
              )}
              {(profileDraft.geometry.endpointOffsetMode ?? "both") !== "centered" && (
                <label className="cinta">
                  <input type="checkbox" checked={!!medidos.offset}
                    onChange={(e) => setMedidos((m) => ({ ...m, offset: e.target.checked }))} />
                  lo medí con cinta
                </label>
              )}
              <span className="help">
                Cuidado con la palabra <em>pica</em>: no siempre es lo mismo. Esta distancia es contra
                el punto que trae el archivo, que suele marcar la punta del recorrido de modulos. La
                pila de fundacion puede estar bastante mas adentro —en Edenvale cae debajo del segundo
                modulo— y medir contra ella da un numero que no es este. Confundirlas corrio el parque
                entero mas de un modulo durante meses.
              </span>
            </div>

            {cuadre && (
              <div
                className={
                  // Centrado cierra siempre, asi que pintarlo de verde por
                  // "cierra" seria dar por bueno un parque mal declarado. Lo
                  // que decide el color ahi es cuanto se esta repartiendo.
                  (cuadre.repartoPorPuntaMm != null
                    ? Math.abs(cuadre.repartoPorPuntaMm) < nominalPitchMm / 2
                    : cuadre.cierra)
                    ? "cuadre"
                    : "cuadre no"
                }
              >
                <h3>El cuadre de la fila</h3>
                <p className="help">
                  {cuadre.repartoPorPuntaMm != null
                    ? "Como los modulos se centran solos en el largo real, esta cuenta da cero por " +
                      "construccion. No la leas como un visto bueno: leela para ver cuanto sobra " +
                      "en las puntas y si el fierro declarado explica la fila."
                    : "Todo esto esta atado: si dejas uno sin medir, se despeja solo para que la " +
                      "cuenta cierre — y entonces cerrar no prueba nada. Marca con la casilla lo " +
                      "que mediste de verdad."}
                </p>
                <table>
                  <tbody>
                    {cuadre.partes.map((p) => (
                      <tr key={p.concepto}>
                        <td>{p.concepto}</td>
                        <td className="num">{p.cantidad} × {p.cadaUnoMm.toFixed(0)}</td>
                        <td className="num">{p.totalMm.toFixed(0)} mm</td>
                        <td>{p.medido
                          ? <span className="chip ver">medido</span>
                          : <span className="chip asm">supuesto</span>}</td>
                      </tr>
                    ))}
                    <tr className="top">
                      <td><strong>Suma</strong></td><td></td>
                      <td className="num"><strong>{cuadre.predichoMm.toFixed(0)} mm</strong></td><td></td>
                    </tr>
                    <tr>
                      <td>Lo que miden tus filas de pica a pica</td><td></td>
                      <td className="num">{cuadre.medidoMm.toFixed(0)} mm</td><td></td>
                    </tr>
                    <tr className="top">
                      <td><strong>{cuadre.residuoMm >= 0 ? "Sobra" : "Falta"}</strong></td>
                      <td className="num">{Math.abs(cuadre.residuoEnModulos).toFixed(1)} modulos</td>
                      <td className="num"><strong>{Math.abs(cuadre.residuoMm).toFixed(0)} mm</strong></td>
                      <td>{cuadre.medidos} de {cuadre.total} medidos</td>
                    </tr>
                  </tbody>
                </table>
                {cuadre.notas.map((n, i) => (<p key={i}>{n}</p>))}
              </div>
            )}
            <div className="field">
              <label>Paso entre modulos</label>
              <select
                value={profileDraft.module.pitchMm === "derive" ? "derive" : "nominal"}
                onChange={(e) => setProfileDraft((d) => ({
                  ...d, module: { ...d.module, pitchMm: e.target.value === "derive" ? "derive" : null },
                }))}
              >
                <option value="nominal">Ancho + hueco</option>
                <option value="derive">Deducirlo del largo real de cada fila</option>
              </select>
              <span className="help">
                Si no mediste el modulo a mano, deducirlo del largo es mas seguro.
              </span>
            </div>
          </div>

          <h3>Reglas de conteo</h3>

          {/*
            Aca habia un selector de "desde que punta se cuenta el modulo 1" con
            tres opciones. Ninguna hacia nada: al armar el perfil la app pisa
            siempre la estrategia con `per-row-flag`, porque el sentido de cada
            fila ya lo resuelve midiendo donde cae la calle de las cajas. Elegir
            "siempre desde el norte" y ver que el parque igual cuenta bien es
            peor que no tener el selector: la proxima vez que algo cuente al
            reves, se busca el problema en el lugar equivocado.

            Lo que va en su lugar es lo que realmente paso, con numeros.
          */}
          <div className="field">
            <label>Desde que punta se cuenta el modulo 1</label>
            <p className={sentidoOk || fraccionResuelta == null ? "note ok" : "note"}>
              Lo resuelve la app fila por fila, midiendo cual de las dos puntas da a la calle donde
              estan las cajas de continua. No hay nada para elegir aca: una regla escrita a mano
              ("siempre desde el norte") se equivoca en el primer bloque que este rotado.
              {origenes && (
                <>
                  {" "}En este parque quedaron{" "}
                  <strong>{origenes.origins.size} de {merge?.rows.length ?? 0} filas</strong>{" "}
                  con el sentido resuelto
                  {fraccionResuelta != null && (
                    <> — el <strong>{(fraccionResuelta * 100).toFixed(0)}%</strong></>
                  )}.
                </>
              )}
            </p>
            {origenesSinResolver.length > 0 && (
              <p className="note bad">
                {origenesSinResolver.length === 1
                  ? "Un bloque quedo sin resolver"
                  : `${origenesSinResolver.length} bloques quedaron sin resolver`}
                {" "}({origenesSinResolver.map((b) => b.block).slice(0, 6).join(", ")}
                {origenesSinResolver.length > 6 ? "…" : ""}), que son{" "}
                <strong>
                  {origenesSinResolver.reduce((s, b) => s + b.rows, 0)} filas
                </strong>.{" "}
                {/*
                  El motivo no es un detalle tecnico: cambia que hacer. Un bloque
                  de un solo banco no tiene calle que medir y lo unico que lo
                  cierra es el plano o un conteo. Uno de varios bancos si tiene
                  calles, pero no se sabe en cual estan las cajas.
                */}
                {(() => {
                  const porMotivo = new Map<string, number>();
                  for (const b of origenesSinResolver) {
                    porMotivo.set(b.status, (porMotivo.get(b.status) ?? 0) + 1);
                  }
                  const nombre: Record<string, string> = {
                    "un-solo-lado": "no tienen calle en el medio que medir",
                    "varias-calles": "tienen mas de una calle y no se sabe en cual van las cajas",
                    escalonado: "tienen los grupos corridos, no enfrentados",
                    ambiguo: "tienen muy pocas filas",
                  };
                  return [...porMotivo]
                    .sort((a, b) => b[1] - a[1])
                    .map(([st, n]) => `${n} ${nombre[st] ?? st}`)
                    .join("; ") + ". ";
                })()}
                Esas filas quedan igual todas apuntando a la misma punta fisica, asi que el conteo
                es consistente pero puede estar espejado: donde la app diga 5, puede ser el 52.
              </p>
            )}
            {/*
              Este aviso existe porque el de arriba, solo, daba una impresion
              falsa y desmoralizante.

              En este paso del asistente todavia no entro ningun plano: lo unico
              que hay es un archivo de coordenadas. O sea que la app esta
              deduciendo del terreno algo que los planos dicen dibujado, y
              despues muestra el resultado como si fuera un veredicto sobre el
              parque. No lo es: es un veredicto sobre lo poco que se cargo hasta
              aca. Leerlo como "el parque no se puede resolver" y salir a contar
              modulos al campo es exactamente el dia perdido que esto tiene que
              evitar.

              El orden correcto se dice aca, y el conteo de campo queda donde
              corresponde: ultimo, para cuando no hay plano.
            */}
            {origenesSinResolver.length > 0 && (
              <p className="note">
                <strong>Esto no se arregla en esta pantalla, y no hace falta que lo arregles
                ahora.</strong>{" "}
                Aca todavia no cargaste ningun plano: lo unico que entro son las coordenadas, asi
                que la app esta tratando de deducir del terreno algo que el plano trae dibujado.
                Termina de guardar el parque y cargalos desde <strong>Parques → Antes de volar →
                Cargar los planos</strong>; ahi estos {origenesSinResolver.length} bloques se
                cierran solos.
                {origenes && origenes.bancos.length > 0 && (
                  <>
                    {" "}Recien si no aparece el plano de algun bloque hace falta ir al campo, y ahi
                    es un conteo por banco:{" "}
                    <strong>
                      {origenes.bancos.filter((b) => !b.verificado).length} en total
                    </strong>{" "}
                    si no apareciera ninguno.
                  </>
                )}
              </p>
            )}
          </div>

          <div className="grid-2">
            <div className="field">
              <label>Inversion de strings</label>
              <select
                value={profileDraft.addressing.inversionStrategy}
                onChange={(e) => setProfileDraft((d) => ({
                  ...d,
                  addressing: { ...d.addressing, inversionStrategy: e.target.value as never },
                }))}
              >
                <option value="none">Todos los strings cuentan igual</option>
                <option value="piercing-chain">Regla del piercing connector</option>
                <option value="per-string-flag">Un dato explicito por string</option>
              </select>
            </div>
          </div>

          <p className="muted small">
            Si no sabes alguna de las dos, deja la opcion mas conservadora. Se corrigen despues con
            la calibracion en campo, y hasta entonces el parque queda marcado como sin verificar.
          </p>

          <div className="actions">
            <button className="ghost" onClick={() => (soloParametros ? onCancel() : setStep(2))}>
              {soloParametros ? "Cancelar" : "Atras"}
            </button>
            <button disabled={!name.trim()} onClick={() => setStep(4)}>Siguiente</button>
          </div>
        </section>
      )}

      {/* ---------------------------------------------------------------- */}
      {step === 4 && (
        <section className="card">
          <h2>4 · Revision</h2>
          {soloParametros && (
            <p className="note ok">
              No se cargo ningun archivo: las {existing?.rows.length ?? 0} filas del parque siguen
              igual y solo cambian los parametros de geometria.
            </p>
          )}

          {/*
            El callejon sin salida.

            Si compilar falla, `farm` es null y todo el bloque de abajo no se
            monta — incluido el unico boton "Atras" de la pantalla. Quedaba un
            cartel rojo con nombres de campos internos (`module.pitchMm`) y nada
            para tocar: en el campo eso es cerrar la app y empezar de cero.
          */}
          {compiled && "err" in compiled && (
            <div className="warnbox">
              <h3>Con estos parametros no se puede armar el parque</h3>
              <p>{traducirError(compiled.err)}</p>
              <details>
                <summary className="muted small">El texto exacto del error</summary>
                <p className="mono small">{compiled.err}</p>
              </details>
              <div className="actions">
                <button onClick={() => setStep(3)}>Volver a los parametros</button>
              </div>
            </div>
          )}

          {!compiled && (
            <p className="note bad">
              No hay filas para compilar. Volve al paso de columnas y fijate que esten asignadas
              las dos picas y que la zona UTM sea la correcta.
              {" "}
              <button className="link" onClick={() => setStep(soloParametros ? 3 : 2)}>
                volver →
              </button>
            </p>
          )}

          {farm && merge && (
            <>
              {existing && merge.colisiones.length > 0 && (
                <div className="warnbox">
                  <h3>{merge.colisiones.length} filas se pisan entre archivos</h3>
                  <p>
                    Tienen el mismo identificador que una que ya estaba, pero estan a cientos de
                    metros de distancia. Casi siempre significa que los dos archivos numeran
                    bloques distintos con el mismo numero.
                  </p>
                  <ul>
                    {merge.colisiones.slice(0, 5).map((c) => (
                      <li key={c.id}>
                        <code>{c.id}</code> — la version nueva esta a{" "}
                        <strong>{c.distanciaM.toFixed(0)} m</strong> de la vieja
                      </li>
                    ))}
                  </ul>
                  <p>
                    Si segues, la geometria vieja de esas filas se pierde. Conviene renombrar los
                    bloques de uno de los dos archivos antes de cargarlo.
                  </p>
                </div>
              )}
              {existing && (
                <p className="note ok">
                  {merge.nuevas} filas nuevas
                  {merge.repetidas > 0 && `, ${merge.repetidas} que ya estaban y se actualizan`}
                  {" "}· el parque queda con <strong>{merge.rows.length}</strong> filas en total.
                </p>
              )}
              <GeometryPlot farm={farm} />

              {farm.buildWarnings.length > 0 && (
                <div className="warnbox">
                  <h3>{farm.buildWarnings.length} cosa(s) para revisar</h3>
                  <ul>
                    {farm.buildWarnings.slice(0, 8).map((w, i) => (<li key={i}>{w.message}</li>))}
                  </ul>
                  {farm.buildWarnings.length > 8 && (
                    <p className="muted small">…y {farm.buildWarnings.length - 8} mas.</p>
                  )}
                </div>
              )}

              <h3>Que vas a poder decir con estos datos</h3>
              <ul className="caps">
                {capabilityReport(merge.rows, profile).map((c) => (
                  <li key={c.label} className={c.available ? "yes" : "no"}>
                    <strong>{c.label}</strong>
                    <span>{c.detail}</span>
                  </li>
                ))}
              </ul>

              <div className="actions">
                <button className="ghost" onClick={() => setStep(3)}>Atras</button>
                <button onClick={() => void save()}>
                  {soloParametros ? "Guardar los parametros" : existing ? "Agregar al parque" : "Guardar el parque"}
                </button>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}
