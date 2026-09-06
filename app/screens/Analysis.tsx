/**
 * El paso que convierte una carpeta de fotos en los hallazgos del vuelo.
 *
 * Era una PANTALLA aparte —"Analizar un vuelo"— y al lado habia otra
 * —"Inspecciones"— que cargaba las mismas fotos, hacia un hallazgo por foto y
 * ofrecia la revision humana. El operador lo dijo mejor que nadie: "que
 * diferencia hay entre analizar un vuelo y las inspecciones, no entiendo". No
 * habia ninguna que se pudiera explicar: eran dos mitades del mismo trabajo
 * que no se hablaban.
 *
 * Ahora esto es un PASO adentro del vuelo, no un camino paralelo. Se cargan
 * las fotos una vez, el motor mide cada modulo del parque contra sus hermanos
 * del mismo string, y los hallazgos que produce son los que se revisan abajo.
 * Lo que queda aca es lo que solo tiene sentido con las fotos a mano: el mapa
 * del parque modulo por modulo, la foto con el recuadro de lo que se midio, y
 * el corrimiento de la grilla cuando el GPS del dron mintio parejo.
 *
 * Puede hacer todo esto por una sola razon: el parque ya esta cargado, medido
 * y verificado. Sin eso habria que adivinar que hay en cada foto; con eso, es
 * una resta.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { makeFrame } from "@locator";
import type { CompiledFarm } from "@locator";
import { ThermalMap } from "../components/ThermalMap";
import { FotoDelHallazgo } from "../components/FotoDelHallazgo";
import { eventosDeString, type Hallazgo, type Umbrales } from "../detect";
import type { Cobertura, Finding } from "../inspection";
import type { Ajuste } from "../projection";
import type { StoredFarm } from "../storage";
import {
  analizarFotos,
  celdaDelParque,
  coberturaDe,
  compararConUmbrales,
  hallazgosAFindings,
  largoDelModulo,
  tablaDeAceptacion,
  unirVuelos,
  type ResultadoDeVuelo,
} from "../vuelo";

interface Props {
  stored: StoredFarm;
  /** Compilado una sola vez arriba: la pantalla del vuelo ya lo necesita. */
  farm: CompiledFarm;
  umbrales: Umbrales;
  /**
   * Se llama con la lista completa cada vez que la deteccion produce una
   * nueva. Quien la recibe es el duenio del vuelo: aca no se guarda nada.
   */
  onDeteccion: (d: { findings: Finding[]; cobertura: Cobertura }) => void;
  /**
   * Los archivos elegidos, para que la revision pueda mostrar la foto grande.
   *
   * Las fotos no se guardan con el vuelo —son miles de JPEG— asi que las de la
   * carpeta que se acaba de elegir son las unicas que hay a mano. Se avisan
   * hacia arriba en vez de quedarse aca adentro: la revision esta al lado y sin
   * esto tendria que pedir la misma carpeta una segunda vez.
   */
  onFotos?: (archivos: File[]) => void;
}

export function Analysis({ stored, farm, umbrales, onDeteccion, onFotos }: Props) {
  const [archivos, setArchivos] = useState<File[]>([]);
  const [resultado, setResultado] = useState<ResultadoDeVuelo | null>(null);
  const [progreso, setProgreso] = useState<{ hecho: number; total: number; etapa?: string } | null>(null);
  /** Cuantas fotos de la ultima carga ya estaban: se avisa en vez de no hacer nada. */
  const [repetidas, setRepetidas] = useState(0);
  /**
   * Las fotos que YA ESTAN adentro del resultado que se ve en pantalla.
   *
   * No es lo mismo que `archivos`, y esa confusion le costo a Mateo un vuelo
   * entero: habia elegido las dos carpetas —el contador decia 1021— pero el
   * resultado era el de una sola, y al volver a elegir la que faltaba la app
   * le contestaba "esas fotos ya estaban cargadas" y no hacia nada. Estaban
   * elegidas, si; medidas, no. Se descarta por lo que el resultado tiene
   * adentro, asi que volver a elegir la carpeta que se perdio la arregla.
   */
  const [medidas, setMedidas] = useState<Set<string>>(new Set());
  const [ajuste, setAjuste] = useState<Ajuste>({ dxM: 0, dyM: 0 });
  const [elegido, setElegido] = useState<Hallazgo | null>(null);

  /*
    Las cargas se hacen de a una, en fila.

    Cada tanda se fusiona contra el resultado que hay cuando le toca, no contra
    el que habia cuando se apreto el boton: si se elegia la segunda carpeta
    mientras la primera todavia estaba midiendo, las dos partian del mismo
    "todavia no hay nada" y la que terminaba ultima pisaba a la otra. Lo que se
    veia era una sola carpeta medida y el resto de las fotos elegidas pero
    invisibles — sin ningun error a la vista.
  */
  const cola = useRef<Promise<void>>(Promise.resolve());
  const ultimo = useRef<ResultadoDeVuelo | null>(null);
  const medidasRef = useRef<Set<string>>(new Set());
  const enCola = useRef<Set<string>>(new Set());
  const [esperando, setEsperando] = useState(0);

  const anchoM = stored.profile.module.widthMm / 1000;
  const largoM = largoDelModulo(stored);
  /**
   * El lado de la celda de ESTE parque.
   *
   * Se usa para dos cosas —medir el punto caliente y decir si el vuelo daba
   * para verlo— y tienen que ser el mismo numero. Estaban separados: la
   * medicion usaba el del perfil y el informe la constante de 160 mm.
   */
  const celdaM = celdaDelParque(stored);
  const frame = useMemo(() => makeFrame(farm.origin.lat, farm.origin.lon), [farm]);

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
    preguntarselo.
  */
  const largoDelString = useMemo(() => {
    const porFila = new Map(farm.rows.map((r) => [r.source.id, r.modulesPerString]));
    return (rowId: string) => porFila.get(rowId) ?? stored.profile.topology.modulesPerString;
  }, [farm, stored.profile.topology.modulesPerString]);

  const totalModulos = farm.rows.reduce((s, r) => s + r.modulesPerRow, 0);

  /** Cuantos modulos tiene cada bloque: la cobertura se cuenta contra esto. */
  const modulosPorBloque = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of farm.rows) m.set(r.source.block, (m.get(r.source.block) ?? 0) + r.modulesPerRow);
    return m;
  }, [farm]);

  /** Todos los modulos medidos, comparados contra sus vecinos. */
  const hallazgos = useMemo(
    () => (resultado ? compararConUmbrales(resultado.muestras, umbrales) : []),
    [resultado, umbrales],
  );

  /*
    La lista corta: solo lo que no es normal.

    Un parque entero son cientos de miles de modulos sanos y no se clasifican
    de a uno. Lo que baja a la revision —y lo que se guarda— es lo que se mira.
  */
  const cortos = useMemo(() => hallazgos.filter((h) => h.peor !== "normal"), [hallazgos]);

  const deteccion = useMemo(() => {
    if (!resultado || !hallazgos.length) return null;
    return {
      findings: hallazgosAFindings(cortos, farm, frame, resultado.fixes, {
        // Sobre TODOS los hallazgos, no sobre la lista corta: un string
        // desconectado existe porque ninguno de sus modulos se despega.
        eventos: eventosDeString(hallazgos, largoDelString),
        todos: hallazgos,
        umbrales,
      }, resultado.corregidoPorFila),
      cobertura: coberturaDe({
        resultado,
        hallazgos,
        totalModulos,
        modulosPorString: largoDelString,
        celdaM,
        umbrales,
        fotos: archivos.length,
        modulosPorBloque,
      }),
    };
  }, [resultado, hallazgos, cortos, farm, frame, totalModulos, largoDelString, celdaM, umbrales, archivos.length, modulosPorBloque]);

  /*
    La deteccion se entrega hacia arriba, no se guarda aca.

    Este paso no es duenio de nada: el vuelo es el que sabe que hallazgos ya
    reviso una persona y cuales no se pueden pisar. Mandarle la lista y que el
    la fusione es lo que evita volver a tener dos listas.
  */
  useEffect(() => {
    if (deteccion) onDeteccion(deteccion);
  }, [deteccion, onDeteccion]);

  /**
   * Lee una tanda de fotos y la SUMA a lo que el vuelo ya tenia.
   *
   * Un parque de cuatro bloques son dos mil fotos: no entran de una en el
   * dialogo ni en la memoria, y se cargan por partes. Antes cada carga pisaba
   * la anterior y el Excel que salia de ahi era el de la ultima tanda.
   *
   * Se vuelven a leer SOLO las fotos nuevas. Las viejas ya estan medidas, y
   * volver a leerlas costaria los mismos minutos otra vez.
   */
  async function analizar(files: File[], conAjuste: Ajuste, desdeCero: boolean) {
    setProgreso({ hecho: 0, total: files.length });
    setElegido(null);
    try {
      const r = await analizarFotos(
        farm,
        frame,
        files,
        {
          moduloAnchoM: anchoM,
          moduloLargoM: largoM,
          celdaM,
          ajuste: conAjuste,
          largoDeclarado: stored.profile.module.lengthMm != null,
        },
        (hecho, total, etapa) => setProgreso({ hecho, total, ...(etapa ? { etapa } : {}) }),
      );
      /*
        La base es la de AHORA (`ultimo.current`), no la que habia cuando se
        eligio la carpeta. Ahi estaba el problema: dos tandas lanzadas juntas
        partian las dos de null y la ultima en terminar borraba a la otra.
      */
      const unido = unirVuelos(desdeCero ? null : ultimo.current, r);
      ultimo.current = unido;
      setResultado(unido);
      const nombres = files.map((f) => f.name);
      medidasRef.current = desdeCero
        ? new Set(nombres)
        : new Set([...medidasRef.current, ...nombres]);
      setMedidas(new Set(medidasRef.current));
    } finally {
      // Salgan bien o mal, estas fotos ya no estan esperando su turno.
      for (const f of files) enCola.current.delete(f.name);
      setEsperando(enCola.current.size);
      setProgreso(null);
    }
  }

  /**
   * Pone una tanda en la fila y la mide cuando le toca.
   *
   * De a una y no en paralelo a proposito: son cientos de JPEG de 1,5 MB y dos
   * lecturas simultaneas es como Safari se quedo sin memoria y devolvio "The
   * I/O read operation failed" en medio de un vuelo.
   */
  function encolar(files: File[], conAjuste: Ajuste, desdeCero: boolean) {
    for (const f of files) enCola.current.add(f.name);
    setEsperando(enCola.current.size);
    cola.current = cola.current
      .catch(() => {})
      .then(() => analizar(files, conAjuste, desdeCero));
    void cola.current;
  }

  /*
    Mover la grilla SI vuelve a leer todo: la temperatura se mide en otros
    pixeles de cada imagen, asi que ninguna medicion vieja sirve.
  */
  const mover = (dx: number, dy: number) => {
    const nuevo = { dxM: ajuste.dxM + dx, dyM: ajuste.dyM + dy };
    setAjuste(nuevo);
    setResultado(null);
    ultimo.current = null;
    encolar(archivos, nuevo, true);
  };

  const resumen = deteccion?.cobertura ?? null;
  const camera = resultado?.camera ?? null;

  return (
    <>
      <section className="card">
        <h2>Las fotos del vuelo</h2>
        <p>
          Elegí las fotos tal como salieron de la tarjeta. La app lee la temperatura de cada
          termica, mide cada modulo del parque y lo compara contra los otros de su mismo string.
          Las visibles se descartan solas. Una foto puede dar varios hallazgos o ninguno: lo que
          se busca son modulos, no fotos.
        </p>
        <label className="drop">
          <input
            type="file" accept="image/jpeg" multiple
            onChange={(e) => {
              const nuevas = [...(e.target.files ?? [])];
              e.target.value = "";
              if (!nuevas.length) return;
              /*
                Lo que decide si una foto se vuelve a leer es si esta MEDIDA
                —adentro del resultado— o esperando su turno, no si figura en
                la lista de elegidas. Volver a elegir una carpeta que se perdio
                por el camino la mide; elegir dos veces la misma no duplica
                nada.
              */
              const frescas = nuevas.filter(
                (x) => !medidasRef.current.has(x.name) && !enCola.current.has(x.name),
              );
              const yaEstan = new Set(archivos.map((x) => x.name));
              const todas = [...archivos, ...nuevas.filter((x) => !yaEstan.has(x.name))];
              setArchivos(todas);
              onFotos?.(todas);
              if (frescas.length) { setRepetidas(0); encolar(frescas, ajuste, false); }
              else setRepetidas(nuevas.length);
            }}
          />
          <strong>{archivos.length ? "Agregar más fotos" : "Elegir fotos"}</strong>
          <span className="muted">
            {archivos.length
              ? `${medidas.size} fotos medidas${
                  esperando ? ` · ${esperando} esperando su turno` : ""
                } — las nuevas se suman`
              : "JPEG del dron"}
          </span>
        </label>
        {repetidas > 0 && !progreso && (
          <p className="note">
            Esas {repetidas} fotos ya estan medidas en este vuelo, así que no se volvieron a leer.{" "}
            <button className="link" onClick={() => setRepetidas(0)}>entendido</button>
          </p>
        )}
        {/*
          Elegidas pero no medidas.

          Es el estado en el que quedo Mateo sin poder verlo: el contador decia
          1021 fotos y el resultado era el de una sola carpeta. Ahora se dice, y
          se arregla con un boton en vez de tener que vaciar y volver a cargar
          las mil.
        */}
        {!progreso && !esperando && archivos.length > medidas.size && (
          <p className="note">
            Hay {archivos.length - medidas.size} fotos elegidas que no estan medidas: lo que ves y
            lo que se entrega sale de las {medidas.size} que si.{" "}
            <button
              className="link"
              onClick={() => encolar(archivos.filter((f) => !medidasRef.current.has(f.name)), ajuste, false)}
            >
              medir las que faltan
            </button>
          </p>
        )}
        {archivos.length > 0 && !progreso && (
          <p className="help">
            Podés cargar el vuelo por partes —un bloque por vez— y el Excel y el informe salen con
            todo junto. Para empezar de cero,{" "}
            <button
              className="link"
              onClick={() => {
                setArchivos([]); setResultado(null); setElegido(null); setRepetidas(0);
                ultimo.current = null; medidasRef.current = new Set(); setMedidas(new Set());
                onFotos?.([]);
              }}
            >
              vaciar y volver a cargar
            </button>.
          </p>
        )}
        {progreso && (
          <p className="note ok">
            {progreso.etapa ? `${progreso.etapa}: foto ${progreso.hecho} de ${progreso.total}…` : `Leyendo ${progreso.hecho} de ${progreso.total}…`}
          </p>
        )}
        {resultado && resultado.problemas.length > 0 && (
          <div className="warnbox">
            <h3>{resultado.problemas.length} fotos que no pude usar</h3>
            <ul>{resultado.problemas.slice(0, 6).map((p, i) => (<li key={i}><code>{p}</code></li>))}</ul>
          </div>
        )}
      </section>

      {/*
        El caso que dejaba la pantalla vacia.
        =====================================================================
        Si las fotos son radiometricas y traen focal, `problemas` queda vacio,
        asi que no se muestra nada de la caja de arriba. Y si ninguna cae sobre
        el parque —vuelo de otro bloque, parque equivocado, ajuste mal— no hay
        hallazgos y despues de "Leyendo 400 de 400…" la pantalla vuelve
        exactamente a como estaba. Sin una linea de texto.
      */}
      {!progreso && archivos.length > 0 && !resumen && (
        <section className="card">
          <h2>No hay nada que mostrar de este vuelo</h2>
          {resultado && resultado.fotosTermicas > 0 ? (
            <>
              <p>
                Se leyeron <strong>{resultado.fotosTermicas}</strong> fotos térmicas, pero ninguna
                cayó sobre la geometría de este parque. No es un problema de las fotos: es que la
                app las ubicó en otro lado.
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

      {resumen && camera && resultado && (
        <>
          <section className="card">
            <h2>Que encontro el motor</h2>
            <div className="stats">
              <div><b>{resumen.modulosMedidos}</b><span>modulos medidos</span></div>
              <div className={cuenta(cortos, "leve") ? "alerta" : ""}><b>{cuenta(cortos, "leve")}</b><span>leves</span></div>
              <div className={cuenta(cortos, "moderada") ? "alerta" : ""}><b>{cuenta(cortos, "moderada")}</b><span>moderadas</span></div>
              <div className={cuenta(cortos, "critica") ? "alerta" : ""}><b>{cuenta(cortos, "critica")}</b><span>criticas</span></div>
            </div>
            <p className="muted small">
              Camara deducida de las propias fotos: {camera.hfovDeg.toFixed(1)}° de campo horizontal
              sobre {camera.imageW}×{camera.imageH} px · {resumen.gsdCm.toFixed(1)} cm por pixel en
              este vuelo ·{" "}
              {hallazgos.filter((h) => h.deltaInterno != null).length
                ? `${hallazgos.filter((h) => h.deltaInterno != null).length} modulos chequeados tambien por adentro`
                : "sin resolucion para buscar celdas calientes"}.
            </p>

            {/*
              El angulo de los trackers durante el vuelo, sacado de la hora de
              cada foto. La caja con la que se mide cada modulo ya se achico por
              esto; decirlo sirve para lo otro: elegir mejor la hora del proximo.
            */}
            {resultado.anguloMedio != null && (
              <p className={resultado.anguloMedio > 35 ? "note bad" : resultado.anguloMedio > 20 ? "note" : "note ok"}>
                Los trackers estuvieron a <strong>{resultado.anguloMedio.toFixed(0)}°</strong> de la
                horizontal en promedio durante este vuelo, asi que cada modulo se vio al{" "}
                <strong>{(Math.cos((resultado.anguloMedio * Math.PI) / 180) * 100).toFixed(0)} %</strong> de su
                ancho. La caja con la que se mide cada modulo ya se achico por eso.
                {resultado.anguloMedio > 20 && (
                  <>
                    {" "}Volando mas cerca del mediodia solar los trackers quedan casi planos y el
                    mismo dron resuelve bastante mas: mirá la tabla de horas en "Planificar el vuelo".
                  </>
                )}
              </p>
            )}

            {/*
              La tabla con la que se juzga el vuelo, bloque por bloque: la
              compuerta de panel y cuanto panel hay adentro de lo que se midio.
              Un bloque por debajo del 90 % no esta terminado, y se dice.
            */}
            {deteccion && resultado.auditoria.length > 0 && (() => {
              const tabla = tablaDeAceptacion(resultado.auditoria, deteccion.findings);
              return (
                <div className="tabla-aceptacion">
                  <h3>Compuerta de panel, por bloque</h3>
                  <table>
                    <thead>
                      <tr>
                        <th>Bloque</th><th>Fotos</th><th>Recuadros medidos</th><th>Panel adentro</th>
                        <th>Bajo el 90 %</th><th>Frenados</th><th>Hallazgos</th><th>Sin numero</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tabla.map((r) => (
                        <tr key={r.block} className={r.pasa ? "" : "alerta"}>
                          <td>{r.block}</td><td>{r.fotos}</td><td>{r.medidas}</td>
                          <td>{(r.panel * 100).toFixed(1)} %{r.pasa ? "" : " — NO PASA"}</td>
                          <td>{r.bajo90}</td><td>{r.descartadas}</td><td>{r.hallazgos}</td><td>{r.sinNumero}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="muted small">
                    "Panel adentro" es que fraccion de los pixeles de los recuadros que se midieron
                    cae sobre panel, medida por textura. "Frenados" son los recuadros que la compuerta
                    no dejo medir por caer sobre suelo o sombra. "Sin numero" son hallazgos con la fila
                    segura pero sin numero de modulo confirmado: en ninguna foto entro la punta.
                  </p>
                </div>
              );
            })()}

            {resumen.eventosDeString.length > 0 && (
              <div className="warnbox">
                <h3>{resumen.eventosDeString.length} string(s) calientes enteros</h3>
                <p>
                  No son defectos de modulo: un string entero por encima de sus vecinos es una
                  conexion, un fusible o un tramo desconectado. Se arregla en otro lado.
                </p>
                <div className="tablewrap">
                  <table>
                    <thead><tr><th>Bloque</th><th>Tracker</th><th>String</th><th>Modulos</th><th>ΔT medio</th></tr></thead>
                    <tbody>
                      {resumen.eventosDeString.slice(0, 10).map((e) => (
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
                <p className="muted small">
                  Esto se guarda con el vuelo y sale en el informe. Un entregable que no dice que
                  NO miro no sirve para un reclamo.
                </p>
              </div>
            )}
          </section>

          <section className="card">
            <h2>El parque, modulo por modulo</h2>
            <ThermalMap
              hallazgos={hallazgos} anchoM={anchoM} largoM={largoM}
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
                  modulo desconectado— y eso es lo que se escribe abajo, en la
                  revision, que es lo que se entrega.
                */}
                <FotoDelHallazgo fileName={elegido.fileName} caja={elegido.caja} archivos={archivos} />
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
              Conviene mirar el dibujo, calcular el corrimiento entero y darlo de una. Lo que ya
              clasificaste a mano no se pierde: se vuelve a pegar sobre cada modulo.
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
        </>
      )}
    </>
  );
}

const cuenta = (hs: Hallazgo[], s: Hallazgo["peor"]) => hs.filter((h) => h.peor === s).length;
