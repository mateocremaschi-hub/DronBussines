/**
 * El vuelo entero, analizado en el navegador.
 *
 * Aca se junta todo lo anterior: se cargan las fotos del vuelo, se lee la
 * temperatura de cada una, se mide cada modulo del parque y se lo compara
 * contra sus vecinos del mismo string.
 *
 * Es la pantalla que reemplaza a la plataforma que se paga por megavatio. Y
 * puede hacerlo por una sola razon: el parque ya esta cargado, medido y
 * verificado. Sin eso habria que adivinar que hay en cada foto; con eso, es
 * una resta.
 */

import { useEffect, useMemo, useState } from "react";
import { compileFarm, makeFrame } from "@locator";
import type { CompiledFarm } from "@locator";
import { ThermalMap } from "../components/ThermalMap";
import { FotoDelHallazgo } from "../components/FotoDelHallazgo";
import { download } from "../inspection";
import { camaraDesdeEquivalente35, type Camera } from "../mission";
import { readPhoto, type PhotoFix } from "../photos";
import { readRadiometric } from "../thermal";
import { anguloDeTracker } from "@locator";
import {
  Acumulador,
  CELDA_M,
  comparar,
  eventosDeString,
  resumir,
  UMBRALES,
  type Hallazgo,
  type Muestra,
  type Umbrales,
} from "../detect";
import type { Ajuste } from "../projection";
import { saveAnalysis, type StoredFarm } from "../storage";

/**
 * Largo del modulo sobre el eje corto de la fila, cuando el perfil no lo trae.
 *
 * Era una constante fija de 2.28 m, y con ella la caja de medicion salia
 * cuadrada en un parque de paneles apaisados. Ahora sale del perfil; esto es
 * solo el respaldo para parques dados de alta antes de que el campo existiera.
 */
const LARGO_MODULO_M = 2.28;

interface Props {
  farm: StoredFarm;
  onBack: () => void;
}

export function Analysis({ farm: stored, onBack }: Props) {
  const [archivos, setArchivos] = useState<File[]>([]);
  const [muestras, setMuestras] = useState<Muestra[]>([]);
  const [camera, setCamera] = useState<Camera | null>(null);
  const [gsdCm, setGsdCm] = useState(0);
  const [enElBorde, setEnElBorde] = useState(0);
  /** Fotos que se ubicaron con un supuesto porque les faltaba un dato. */
  const [posesSupuestas, setPosesSupuestas] = useState<Array<{ motivo: string; fotos: number }>>([]);
  const [progreso, setProgreso] = useState<{ hecho: number; total: number } | null>(null);
  const [problemas, setProblemas] = useState<string[]>([]);
  /** Fotos termicas que se pudieron medir. Cero con archivos elegidos es un caso, no un vacio. */
  const [leidas, setLeidas] = useState(0);
  const [ajuste, setAjuste] = useState<Ajuste>({ dxM: 0, dyM: 0 });
  const [umbrales, setUmbrales] = useState<Umbrales>(UMBRALES);
  const [elegido, setElegido] = useState<Hallazgo | null>(null);
  /** Angulo medio de los trackers durante el vuelo, sacado de la hora de cada foto. */
  const [anguloMedio, setAnguloMedio] = useState<number | null>(null);

  const farm = useMemo<CompiledFarm | null>(() => {
    try { return compileFarm(stored.profile, stored.rows); } catch { return null; }
  }, [stored]);

  const anchoM = stored.profile.module.widthMm / 1000;
  /**
   * El lado de la celda de ESTE parque.
   *
   * Se usa para dos cosas —medir el punto caliente y decir si el vuelo daba
   * para verlo— y tienen que ser el mismo numero. Estaban separados: la
   * medicion usaba el del perfil y el informe la constante de 160 mm.
   */
  const celdaM = (stored.profile.module.cellMm ?? CELDA_M * 1000) / 1000;

  const hallazgos = useMemo(
    () => (muestras.length ? comparar(muestras, umbrales) : []),
    [muestras, umbrales],
  );
  /*
    Cuantos modulos tiene cada fila, sacado de la fila y no del perfil.

    Los dos numeros de abajo —el largo del string y el total de modulos del
    parque— salian de `topology.modulesPerString * stringsPerRow`, o sea del
    tipo principal de tracker multiplicado por la cantidad de filas. En un
    parque que mezcla trackers largos de 56 con cortos de 28 eso miente en las
    dos direcciones: un string corto apagado entero da fraccion 0.5 y se cae
    del agrupamiento, y el total de modulos —que es el denominador de todos
    los porcentajes del informe— cuenta cada fila corta como si fuera larga.

    El compilador ya resuelve el largo fila por fila; lo unico que faltaba era
    preguntarselo. El perfil queda de respaldo para cuando la geometria no
    compila y la pantalla igual tiene que mostrar algo.
  */
  const largoDelString = useMemo(() => {
    const porFila = new Map((farm?.rows ?? []).map((r) => [r.source.id, r.modulesPerString]));
    return (rowId: string) => porFila.get(rowId) ?? stored.profile.topology.modulesPerString;
  }, [farm, stored.profile.topology.modulesPerString]);

  const eventos = useMemo(
    () => eventosDeString(hallazgos, largoDelString),
    [hallazgos, largoDelString],
  );
  const totalModulos = farm
    ? farm.rows.reduce((s, r) => s + r.modulesPerRow, 0)
    : stored.rows.length *
      stored.profile.topology.modulesPerString *
      stored.profile.topology.stringsPerRow;
  const resumen = useMemo(
    () =>
      hallazgos.length
        ? resumir(hallazgos, totalModulos, eventos, gsdCm, enElBorde, posesSupuestas, celdaM)
        : null,
    [hallazgos, totalModulos, eventos, gsdCm, enElBorde, posesSupuestas, celdaM],
  );

  /**
   * Guarda la lista corta apenas termina el analisis.
   *
   * Solo lo que no es normal: los sanos son cientos de miles y no se
   * clasifican. Lo que se guarda es lo que despues se mira de a uno.
   */
  useEffect(() => {
    const cortos = hallazgos.filter((h) => h.peor !== "normal");
    if (!cortos.length) return;
    void saveAnalysis({
      farmId: stored.profile.id,
      hallazgos: cortos,
      gsdCm,
      fotos: archivos.length,
      savedAt: new Date().toISOString(),
    });
  }, [hallazgos, gsdCm, archivos.length, stored.profile.id]);

  /**
   * Procesa el vuelo foto por foto.
   *
   * Se lee, se mide y se descarta la matriz de temperaturas antes de pasar a
   * la siguiente: todas juntas no entran en memoria.
   */
  async function analizar(files: File[], conAjuste: Ajuste) {
    if (!farm) return;
    setProgreso({ hecho: 0, total: files.length });
    setProblemas([]);
    setElegido(null);

    const frame = makeFrame(farm.origin.lat, farm.origin.lon);
    let acc: Acumulador | null = null;
    let cam: Camera | null = null;
    let sumaGsd = 0;
    let nGsd = 0;
    const fallos: string[] = [];
    let sinTermica = 0;
    let termicas = 0;
    /**
     * La escala del vuelo, fijada por la primera foto que se pudo leer.
     *
     * Se elegia foto por foto, por contraste. Una foto de una nube, del hangar
     * o del despegue puede caer en otra escala, y esa foto entra al analisis
     * con las temperaturas multiplicadas por seis. Nadie lo nota, porque 240 °C
     * se reporta como una anomalia critica — y anomalias es justo lo que
     * estabamos buscando.
     *
     * Todas las fotos de un vuelo salen de la misma camara con la misma
     * configuracion: la escala es una sola. Se fija con la primera y se cuenta
     * cuantas habrian elegido otra, para poder decirlo al final.
     */
    let escalaDelVuelo: string | null = null;
    const discrepan: string[] = [];
    /**
     * Fotos donde la camara llego a su tope.
     *
     * Arriba del rango elegido, la termica guarda todo con el mismo numero. Un
     * conector quemado, un punto caliente fuerte o un reflejo del sol se pasan,
     * y lo que se mide deja de ser la temperatura del modulo: es el techo del
     * sensor. El ΔT de esas fotos es un PISO, no una medida — y justo son las
     * fotos de los defectos mas graves, o sea las que mas importan.
     */
    const saturadas: string[] = [];
    let topeMasAlto = 0;
    /** Angulo medio de los trackers durante el vuelo, para poder decirlo. */
    let sumaAngulo = 0;
    let nAngulo = 0;
    /** Tamanios de imagen distintos al de la primera foto. */
    const otraCamara = new Set<string>();

    for (let i = 0; i < files.length; i++) {
      const file = files[i]!;
      try {
        const buf = await file.arrayBuffer();
        const radio = readRadiometric(buf, escalaDelVuelo ?? undefined);
        if (!radio) {
          // No es un error: casi siempre es la foto visible del par. Pero si
          // NINGUNA trae temperatura hay que decirlo, y para eso hace falta
          // contarlas en vez de saltearlas en silencio.
          sinTermica++;
          setProgreso({ hecho: i + 1, total: files.length });
          continue;
        }

        if (!escalaDelVuelo) escalaDelVuelo = radio.escala;
        else if (radio.escalaAuto !== escalaDelVuelo) discrepan.push(file.name);

        // Medio por mil de la foto pegada al mismo maximo ya es una mancha, no
        // un pixel de ruido: son unos 160 pixeles en una termica de 640 x 512.
        if (radio.fraccionEnElTope > 0.0005) {
          saturadas.push(file.name);
          topeMasAlto = Math.max(topeMasAlto, radio.topeC);
        }

        // Sin miniatura: esta pantalla no la muestra, y generarla por foto
        // decodifica y recomprime la imagen entera para tirarla.
        const leida = await readPhoto(file, false);
        const fix = leida.fix;
        if (!fix) { fallos.push(`${file.name}: ${leida.error ?? "sin coordenada"}`); continue; }

        /*
          La camara se deduce de la PRIMERA foto y despues no se vuelve a
          mirar. Si en la carpeta hay dos vuelos, o la termica y la visible del
          par, o dos drones distintos, todas las demas fotos se proyectan con
          la huella de la camara equivocada — y una huella equivocada no da un
          error, da modulos de la fila de al lado.

          No se puede cambiar de camara a mitad de vuelo (el Acumulador ya esta
          armado con la primera), pero SI se puede detectar y decirlo.
        */
        if (cam && (radio.width !== cam.imageW || radio.height !== cam.imageH)) {
          otraCamara.add(`${radio.width}×${radio.height}`);
        }

        if (!cam) {
          cam = camaraFrom(fix, radio.width, radio.height);
          if (!cam) { fallos.push(`${file.name}: no declara distancia focal equivalente`); continue; }
          setCamera(cam);
          acc = new Acumulador(farm, frame, {
            camera: cam,
            moduloAnchoM: anchoM,
            moduloLargoM: (farm.profile.module.lengthMm ?? LARGO_MODULO_M * 1000) / 1000,
            ajuste: conAjuste,
            // El lado de la celda lo declara el perfil del parque: cambia
            // entre fabricantes y decide si este vuelo puede ver una celda.
            celdaM,
          });
        }

        const agl = fix.relativeAltitudeM;
        if (agl == null) { fallos.push(`${file.name}: no trae altura sobre el terreno`); continue; }

        sumaGsd += ((2 * agl * Math.tan((cam.hfovDeg * Math.PI) / 360)) / cam.imageW) * 100;
        nGsd++;

        /*
          El angulo del tracker en el momento de ESTA foto.

          Los trackers giran de -55 a +55 grados siguiendo al sol, asi que un
          modulo fotografiado a las ocho de la manana se ve casi la mitad de
          ancho de lo que es. Sin corregirlo, la caja de medicion se dibuja del
          ancho del modulo acostado y casi la mitad cae sobre el suelo — que al
          sol lee muy distinto y le baja la mediana al modulo entero.

          La hora sale de la propia foto. Si no la trae, se mide como si los
          trackers estuvieran planos, que es lo que se hacia siempre.
        */
        const cuando = fix.takenAt ? new Date(fix.takenAt) : null;
        const angulo =
          cuando && !Number.isNaN(cuando.getTime())
            ? anguloDeTracker(fix.lat, fix.lon, cuando)
            : null;
        if (angulo && !angulo.deNoche) {
          sumaAngulo += Math.abs(angulo.gradosDesdeLaHorizontal);
          nAngulo++;
        }

        termicas++;
        acc!.agregar({
          fileName: file.name,
          radio,
          pose: {
            lat: fix.lat, lon: fix.lon, altitudeAglM: agl,
            ...(fix.gimbalYawDeg != null ? { gimbalYawDeg: fix.gimbalYawDeg } : {}),
            ...(fix.gimbalPitchDeg != null ? { gimbalPitchDeg: fix.gimbalPitchDeg } : {}),
          },
        }, angulo?.factorDeAcortamiento ?? 1);
      } catch (e) {
        fallos.push(`${file.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
      setProgreso({ hecho: i + 1, total: files.length });
    }

    setAnguloMedio(nAngulo ? sumaAngulo / nAngulo : null);
    setGsdCm(nGsd ? sumaGsd / nGsd : 0);
    setEnElBorde(acc ? acc.soloEnElBorde() : 0);
    setPosesSupuestas(acc ? acc.posesSupuestas() : []);
    setMuestras(acc ? acc.muestras() : []);
    setLeidas(termicas);
    /*
      Las fotos que por su cuenta habrian elegido otra escala. No es un error
      —se las convirtio con la escala del vuelo, que es lo correcto— pero si
      son muchas, algo pasa con el lote: fotos de dos camaras distintas, o de
      dos vuelos mezclados en la misma carpeta.
    */
    if (discrepan.length) {
      fallos.push(
        `${discrepan.length} de ${termicas} fotos tienen un rango de temperaturas raro para el ` +
        `resto del vuelo (${discrepan.slice(0, 3).join(", ")}` +
        `${discrepan.length > 3 ? "…" : ""}). Se las midio con la escala del vuelo igual. Si son ` +
        "muchas, fijate que no se hayan mezclado dos vuelos o dos camaras en la misma carpeta.",
      );
    }

    if (otraCamara.size && cam) {
      fallos.push(
        `Hay fotos de otra camara en el lote: la primera es de ${cam.imageW}×${cam.imageH} px y ` +
        `tambien aparecen ${[...otraCamara].join(", ")}. Todo el vuelo se proyecto con la primera, ` +
        "asi que las demas pueden estar ubicadas en la fila de al lado. Separá los vuelos en " +
        "carpetas distintas y volvé a correr cada uno.",
      );
    }

    if (saturadas.length) {
      fallos.push(
        `${saturadas.length} de ${termicas} fotos llegan al tope del sensor (${topeMasAlto.toFixed(0)} °C) ` +
        "con una mancha, no un pixel suelto. Arriba de ese tope la camara guarda todo con el mismo " +
        "numero, asi que el ΔT de esas fotos es un PISO y no una medida: el defecto puede ser bastante " +
        "peor. Si te importa la temperatura exacta, subile el rango a la camara y revolá esas zonas. " +
        "Para encontrar los modulos a reemplazar, igual sirven.",
      );
    }

    setProblemas(
      sinTermica && !termicas
        ? [
            `Ninguno de los ${files.length} archivos trae la temperatura adentro. Si elegiste las ` +
            "fotos visibles del par, faltan las termicas — las que terminan en _T.",
            ...fallos,
          ]
        : fallos,
    );
    setProgreso(null);
  }

  if (!farm) {
    return (
      <div className="screen">
        <p className="alert">El perfil de este parque no compila. Recargalo desde el asistente.</p>
        <button className="ghost" onClick={onBack}>Volver</button>
      </div>
    );
  }

  const mover = (dx: number, dy: number) => {
    const nuevo = { dxM: ajuste.dxM + dx, dyM: ajuste.dyM + dy };
    setAjuste(nuevo);
    void analizar(archivos, nuevo);
  };

  return (
    <div className="screen">
      <header className="screen-head">
        <div>
          <p className="eyebrow">{stored.profile.name}</p>
          <h1>Analizar un vuelo</h1>
        </div>
        <button className="ghost" onClick={onBack}>Parques</button>
      </header>

      <section className="card">
        <h2>Las fotos del vuelo</h2>
        <p>
          Elegí las fotos tal como salieron de la tarjeta. La app lee la temperatura de cada
          termica, mide cada modulo del parque y lo compara contra los otros de su mismo string.
          Las visibles se descartan solas.
        </p>
        <label className="drop">
          <input
            type="file" accept="image/jpeg" multiple
            onChange={(e) => {
              const f = [...(e.target.files ?? [])];
              setArchivos(f);
              if (f.length) void analizar(f, ajuste);
            }}
          />
          <strong>Elegir fotos</strong>
          <span className="muted">{archivos.length ? `${archivos.length} archivos` : "JPEG del dron"}</span>
        </label>
        {progreso && (
          <p className="muted">Leyendo {progreso.hecho} de {progreso.total}…</p>
        )}
        {problemas.length > 0 && (
          <div className="warnbox">
            <h3>{problemas.length} fotos que no pude usar</h3>
            <ul>{problemas.slice(0, 6).map((p, i) => (<li key={i}><code>{p}</code></li>))}</ul>
          </div>
        )}
      </section>

      {/*
        El caso que dejaba la pantalla vacia.
        =====================================================================
        Si las fotos son radiometricas y traen focal, `problemas` queda vacio,
        asi que no se muestra nada de la caja de arriba. Y si ninguna cae sobre
        el parque —vuelo de otro bloque, parque equivocado, ajuste mal— no hay
        hallazgos, `resumen` es null, y despues de "Leyendo 400 de 400…" la
        pantalla vuelve exactamente a como estaba. Sin una linea de texto.
      */}
      {!progreso && archivos.length > 0 && !resumen && (
        <section className="card">
          <h2>No hay nada que mostrar de este vuelo</h2>
          {leidas > 0 ? (
            <>
              <p>
                Se leyeron <strong>{leidas}</strong> fotos térmicas, pero ninguna cayó sobre la
                geometría de este parque. No es un problema de las fotos: es que la app las ubicó
                en otro lado.
              </p>
              <ul className="pasos">
                <li>¿Es el parque correcto? Las fotos se comparan contra <strong>{stored.profile.name}</strong>.</li>
                <li>¿El vuelo cubre bloques que estén cargados? Un bloque sin geometría no tiene módulos que medir.</li>
                <li>¿Las fotos traen altura sobre el terreno? Sin eso la huella sale del tamaño equivocado.</li>
              </ul>
            </>
          ) : (
            <p>
              De {archivos.length} archivos no se pudo usar ninguno. Mirá la lista de arriba: si
              dice que no traen temperatura, son las fotos visibles y falta elegir las térmicas.
            </p>
          )}
        </section>
      )}

      {resumen && camera && (
        <>
          <section className="card">
            <h2>Que encontro</h2>
            <div className="stats">
              <div><b>{resumen.modulosMedidos}</b><span>modulos medidos</span></div>
              <div className={resumen.leves ? "alerta" : ""}><b>{resumen.leves}</b><span>leves</span></div>
              <div className={resumen.moderadas ? "alerta" : ""}><b>{resumen.moderadas}</b><span>moderadas</span></div>
              <div className={resumen.criticas ? "alerta" : ""}><b>{resumen.criticas}</b><span>criticas</span></div>
            </div>
            <p className="muted small">
              Camara deducida de las propias fotos: {camera.hfovDeg.toFixed(1)}° de campo horizontal
              sobre {camera.imageW}×{camera.imageH} px · {gsdCm.toFixed(1)} cm por pixel en este vuelo ·{" "}
              {resumen.conChequeoDeCelda
                ? `${resumen.conChequeoDeCelda} modulos chequeados tambien por adentro`
                : "sin resolucion para buscar celdas calientes"}.
            </p>

            {/*
              El angulo de los trackers durante el vuelo, sacado de la hora de
              cada foto. La caja con la que se mide cada modulo ya se achico por
              esto; decirlo sirve para lo otro: elegir mejor la hora del proximo.
            */}
            {anguloMedio != null && (
              <p className={anguloMedio > 35 ? "note bad" : anguloMedio > 20 ? "note" : "note ok"}>
                Los trackers estuvieron a <strong>{anguloMedio.toFixed(0)}°</strong> de la
                horizontal en promedio durante este vuelo, asi que cada modulo se vio al{" "}
                <strong>{(Math.cos((anguloMedio * Math.PI) / 180) * 100).toFixed(0)} %</strong> de su
                ancho. La caja con la que se mide cada modulo ya se achico por eso.
                {anguloMedio > 20 && (
                  <>
                    {" "}Volando mas cerca del mediodia solar los trackers quedan casi planos y el
                    mismo dron resuelve bastante mas: mirá la tabla de horas en "Planificar el vuelo".
                  </>
                )}
              </p>
            )}

            {resumen.eventosDeString > 0 && (
              <div className="warnbox">
                <h3>{resumen.eventosDeString} string(s) calientes enteros</h3>
                <p>
                  No son defectos de modulo: un string entero por encima de sus vecinos es una
                  conexion, un fusible o un tramo desconectado. Se arregla en otro lado.
                </p>
                <div className="tablewrap">
                  <table>
                    <thead><tr><th>Bloque</th><th>Tracker</th><th>String</th><th>Modulos</th><th>ΔT medio</th></tr></thead>
                    <tbody>
                      {eventos.slice(0, 10).map((e) => (
                        <tr key={`${e.rowId}-${e.stringNumber}`}>
                          <td>{e.block}</td><td><code>{e.tracker}</code></td>
                          <td><code>{e.stringLabel ?? e.stringNumber}</code></td>
                          <td>{e.modulos}</td><td>{e.deltaTMedio.toFixed(1)} °C</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {resumen.limitaciones.length > 0 && (
              <div className="warnbox">
                <h3>Lo que este vuelo NO permite afirmar</h3>
                {resumen.limitaciones.map((l, i) => (<p key={i}>{l}</p>))}
              </div>
            )}
          </section>

          <section className="card">
            <h2>El parque, modulo por modulo</h2>
            <ThermalMap
              hallazgos={hallazgos} anchoM={anchoM} largoM={(farm.profile.module.lengthMm ?? LARGO_MODULO_M * 1000) / 1000}
              onPick={setElegido} seleccion={elegido}
            />

            {elegido && (
              <div className="note">
                <strong>
                  Bloque {elegido.modulo.block}, tracker {elegido.modulo.tracker}
                  {elegido.modulo.row ? ` ${elegido.modulo.row}` : ""}, string{" "}
                  {elegido.modulo.stringLabel ?? elegido.modulo.stringNumber}, modulo{" "}
                  {elegido.modulo.module}
                </strong>
                <br />
                {elegido.celsius.toFixed(1)} °C · <strong>{elegido.deltaT >= 0 ? "+" : ""}
                {elegido.deltaT.toFixed(1)} °C</strong> contra sus {elegido.vecinos} vecinos
                {elegido.ambito === "string" ? " del mismo string" : ` (comparado por ${elegido.ambito})`}
                {" "}· medido sobre {elegido.pixeles} pixeles de <code>{elegido.fileName}</code>
                {elegido.deltaInterno != null && (
                  <>
                    <br />
                    Su zona mas caliente esta <strong>+{elegido.deltaInterno.toFixed(1)} °C</strong>{" "}
                    por encima del propio modulo
                    {elegido.origen === "celda" && " — eso es una celda, no el modulo entero"}.
                  </>
                )}
                {/*
                  La foto, con el modulo marcado. El numero dice cuanto; el
                  patron de la imagen dice QUE es —celda, diodo de bypass,
                  modulo desconectado— y eso es lo que se escribe en el informe,
                  que es lo que se entrega.
                */}
                <FotoDelHallazgo hallazgo={elegido} archivos={archivos} />
              </div>
            )}

            <h3>Si la grilla no coincide con el parque</h3>
            <p className="help">
              El GPS del dron se equivoca parejo: todo el vuelo corrido para el mismo lado. Movelo
              una vez y se corrige entero. Corrimiento actual:{" "}
              <strong>{ajuste.dxM.toFixed(1)} m este · {ajuste.dyM.toFixed(1)} m norte</strong>.
            </p>
            {/*
              Cada toque vuelve a leer las fotos de cero: la temperatura se mide
              en pixeles distintos, asi que no hay forma de reaprovechar la
              medicion anterior. Decirlo antes evita el "se colgo" — la barra de
              progreso estaba arriba de todo, fuera de la pantalla desde aca.
            */}
            <p className="help muted">
              Ojo: mover la grilla vuelve a leer las {archivos.length} fotos, porque la temperatura
              se mide en otro lugar de cada imagen. Con un vuelo grande son varios minutos por toque.
              Conviene mirar el dibujo, calcular el corrimiento entero y darlo de una.
            </p>
            {progreso && (
              <p className="note ok">
                Releyendo con la grilla corrida: {progreso.hecho} de {progreso.total}…
              </p>
            )}
            <div className="row">
              <button className="ghost" onClick={() => mover(0, 1)} disabled={!!progreso}>↑ 1 m norte</button>
              <button className="ghost" onClick={() => mover(0, -1)} disabled={!!progreso}>↓ 1 m sur</button>
              <button className="ghost" onClick={() => mover(-1, 0)} disabled={!!progreso}>← 1 m oeste</button>
              <button className="ghost" onClick={() => mover(1, 0)} disabled={!!progreso}>→ 1 m este</button>
              <button className="link" onClick={() => mover(-ajuste.dxM, -ajuste.dyM)} disabled={!!progreso}>
                Volver a cero
              </button>
            </div>
          </section>

          <section className="card">
            <h2>Los hallazgos</h2>
            <div className="row">
              {/*
                Borrar el campo daba `Number("") === 0`, y con el umbral leve en
                0 TODO modulo del parque queda clasificado como anomalia: mil
                hallazgos falsos y el informe entero al tacho, sin ningun aviso.
                Vacio ahora vuelve al valor por defecto en vez de a cero.
              */}
              {(["leve", "moderada", "critica"] as const).map((k) => (
                <label className="inline" key={k}>
                  ΔT {k} (°C)
                  <input
                    type="number" min={0.5} step={0.5} value={umbrales[k]}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setUmbrales((u) => ({
                        ...u,
                        [k]: e.target.value.trim() === "" || !Number.isFinite(v) || v <= 0
                          ? UMBRALES[k]
                          : v,
                      }));
                    }}
                  />
                </label>
              ))}
            </div>
            {(umbrales.leve >= umbrales.moderada || umbrales.moderada >= umbrales.critica) && (
              <p className="note bad">
                Los tres umbrales tienen que ir de menor a mayor: leve &lt; moderada &lt; critica.
                Como estan ahora, la clasificacion no significa nada.
                <button
                  className="link"
                  onClick={() => setUmbrales(UMBRALES)}
                >
                  volver a {UMBRALES.leve} / {UMBRALES.moderada} / {UMBRALES.critica} →
                </button>
              </p>
            )}
            <p className="help">
              Los umbrales son una convencion de trabajo, no una cita de la norma: la IEC clasifica
              por patron y contexto, no por un numero suelto. Sirven para ordenar la lista.
            </p>

            <div className="tablewrap">
              <table>
                <thead>
                  <tr>
                    <th>Bloque</th><th>Tracker</th><th>String</th><th>Modulo</th>
                    <th>°C</th><th>ΔT modulo</th><th>ΔT celda</th>
                    <th>Comparado contra</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {hallazgos
                    .filter((h) => h.peor !== "normal")
                    .sort((a, b) => Math.max(b.deltaT, b.deltaInterno ?? -99) - Math.max(a.deltaT, a.deltaInterno ?? -99))
                    .slice(0, 30)
                    .map((h) => (
                      <tr
                        key={`${h.modulo.rowId}#${h.modulo.positionInRow}`}
                        className={elegido === h ? "top" : ""}
                        onClick={() => setElegido(h)}
                      >
                        <td>{h.modulo.block}</td>
                        <td><code>{h.modulo.tracker}</code></td>
                        <td><code>{h.modulo.stringLabel ?? h.modulo.stringNumber}</code></td>
                        <td>{h.modulo.module}</td>
                        <td>{h.celsius.toFixed(1)}</td>
                        <td className={h.origen === "modulo" ? "top" : ""}>
                          <strong>{h.deltaT >= 0 ? "+" : ""}{h.deltaT.toFixed(1)}</strong>
                        </td>
                        <td className={h.origen === "celda" ? "top" : "flojo"}>
                          {h.deltaInterno != null
                            ? <strong>+{h.deltaInterno.toFixed(1)}</strong>
                            : "no resuelve"}
                        </td>
                        <td className={h.ambito === "string" ? "" : "flojo"}>
                          {h.ambito === "string"
                            ? `su string (${h.vecinos})`
                            : `${h.ambito} (${h.vecinos}) — flojo`}
                        </td>
                        <td>{h.peor}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>

            <div className="actions">
              <button onClick={() => download(`${stored.profile.id}-hallazgos.csv`, toCsv(hallazgos), "text/csv")}>
                Exportar CSV
              </button>
            </div>
            <p className="help">
              La lista de arriba es la entrega: qué módulos están calientes y cuánto. Queda
              guardada, así que podés cerrar y seguir después.
            </p>
          </section>
        </>
      )}
    </div>
  );
}

/** Arma la camara con lo que declara la propia foto. */
function camaraFrom(fix: PhotoFix, w: number, h: number): Camera | null {
  if (!fix.equiv35mm) return null;
  return camaraDesdeEquivalente35(fix.sensor ?? "camara del vuelo", fix.equiv35mm, w, h);
}

const esc = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function toCsv(hallazgos: Hallazgo[]): string {
  const head = [
    "bloque", "tracker", "fila", "string", "modulo_desde_caja_dc",
    "celsius", "delta_t", "referencia_c", "vecinos", "comparado_por", "severidad",
    "punto_caliente_c", "delta_interno", "severidad_celda", "que_lo_disparo",
    "pixeles", "foto",
  ];
  const lines = [head.join(",")];
  for (const h of [...hallazgos].sort(
    (a, b) => Math.max(b.deltaT, b.deltaInterno ?? -99) - Math.max(a.deltaT, a.deltaInterno ?? -99),
  )) {
    lines.push([
      h.modulo.block, h.modulo.tracker, h.modulo.row ?? "",
      h.modulo.stringLabel ?? h.modulo.stringNumber, h.modulo.module,
      h.celsius.toFixed(1), h.deltaT.toFixed(1), h.referenciaC.toFixed(1),
      h.vecinos, h.ambito, h.severidad,
      h.puntoCalienteC?.toFixed(1) ?? "", h.deltaInterno?.toFixed(1) ?? "",
      h.severidadInterna ?? "no resuelve", h.origen,
      h.pixeles, h.fileName,
    ].map(esc).join(","));
  }
  return lines.join("\n");
}
