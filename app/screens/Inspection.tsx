/**
 * El vuelo, de punta a punta: fotos -> deteccion -> revision -> entrega.
 *
 * Habia dos caminos paralelos para esto y no se hablaban.
 * ---------------------------------------------------------------------------
 * Esta pantalla cargaba la carpeta y hacia UN hallazgo POR FOTO, con la
 * coordenada del dron y el ΔT escrito a mano. La otra —"Analizar un vuelo"—
 * cargaba las mismas fotos, media todos los modulos del parque contra sus
 * hermanos de string, y guardaba esa lista en otra clave de la misma base. La
 * deteccion buena estaba en una pantalla y la revision buena en la otra, y
 * cargando el mismo vuelo en las dos salian dos listas que no se conocian.
 *
 * Ahora es uno solo. Las fotos se cargan una vez, la deteccion produce los
 * hallazgos —un modulo, no una foto— y abajo se los revisa: anomalia, clase
 * IEC, nota, confirmar o descartar, y corregir el modulo mirando la imagen. De
 * ahi salen los cuatro formatos de entrega.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { compileFarm } from "@locator";
import type { CompiledFarm } from "@locator";
import { offNadirDeg } from "../photos";
import {
  deleteInspection,
  deltaTDe,
  download,
  esModeloViejo,
  listInspections,
  saveInspection,
  summarize,
  descargarBytes,
  type Cobertura,
  type Finding,
  type Inspection as Insp,
} from "../inspection";
import { UMBRALES, type Severidad, type Umbrales } from "../detect";
import { deleteAnalysis, loadAnalysis, type StoredFarm } from "../storage";
import { aExcel, aInformeHtml, entregables, nombreDeFoto, toCsv } from "../informe";
import { fusionarRevision, reclasificarFindings, vueloDesdeAnalisis } from "../vuelo";
import { bloquesDelParque, puntosDeHallazgos } from "../mapa";
import { acuerdoDeLaMuestra, muestraARevisar } from "../muestreo";
import { MapaDelParque } from "../components/MapaDelParque";
import { Revisor } from "../components/Revisor";
import { zip } from "../zip";
import { Analysis } from "./Analysis";

/** El JPEG como data URL, para meterlo adentro del HTML del informe. */
function comoDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error(`No pude leer ${file.name}`));
    r.readAsDataURL(file);
  });
}

/**
 * Un numero de un campo de texto, distinguiendo "cero" de "vacio".
 *
 * `Number(x) || undefined` los confunde: el cero es falsy, asi que un viento de
 * 0 m/s o un ΔT de 0,0 °C se guardaban como si nunca se hubieran anotado.
 */
function numeroOVacio(texto: string): number | undefined {
  if (texto.trim() === "") return undefined;
  const v = Number(texto);
  return Number.isFinite(v) ? v : undefined;
}

/** De la peor a la mejor: es el orden en que se camina el parque. */
const ORDEN: Severidad[] = ["critica", "moderada", "leve", "normal"];

export function Inspection({ farm: stored, onBack }: { farm: StoredFarm; onBack: () => void }) {
  const [list, setList] = useState<Insp[]>([]);
  const [current, setCurrent] = useState<Insp | null>(null);
  /*
    La exportacion con fotos.

    Las fotos no viven en la base —un vuelo son miles de JPEG— asi que se piden
    al momento de exportar. `pedido` guarda que hacer con la carpeta cuando el
    usuario la elige: sin eso habria que duplicar el input de archivos por cada
    formato.
  */
  const inputFotos = useRef<HTMLInputElement>(null);
  const pedido = useRef<((fs: File[]) => void) | null>(null);
  const [exportando, setExportando] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<"todos" | "muestra" | "pendiente" | "confirmado" | "sin-ubicar">("muestra");
  /**
   * Que porcentaje de cada tipo se revisa a mano.
   *
   * Arranca en 20 % porque es lo que pidio: "yo hacer tipo una revision random
   * de un 20 %". Sobre eso se agregan enteros los de poca confianza y los que
   * no se pudieron clasificar, asi que la muestra es el piso de lo que se
   * revisa, no el techo.
   */
  const [porcentaje, setPorcentaje] = useState(0.2);
  /*
    Las fotos del vuelo, mientras esten a mano.

    No se guardan con el vuelo —son miles de archivos— asi que solo existen
    mientras dure la sesion en que se cargaron. La revision las usa para mostrar
    la foto grande; sin ellas sigue funcionando todo lo demas y lo dice.
  */
  const [fotosDelVuelo, setFotosDelVuelo] = useState<File[]>([]);
  /** El bloque abierto en el mapa. `null` es la escala del parque entero. */
  const [bloqueAbierto, setBloqueAbierto] = useState<string | null>(null);
  const [elegido, setElegido] = useState<string | null>(null);
  /**
   * Los umbrales con los que se lee la lista de ESTE vuelo.
   *
   * Viven aca y no en el paso de deteccion porque lo que reclasifican es la
   * LISTA, y la lista sobrevive a las fotos: un vuelo abierto un mes despues,
   * con las fotos en otro disco, se tiene que poder releer con otro criterio.
   */
  const [umbrales, setUmbrales] = useState<Umbrales>(UMBRALES);

  const farm = useMemo<CompiledFarm | null>(() => {
    try {
      return compileFarm(stored.profile, stored.rows);
    } catch {
      return null;
    }
  }, [stored]);

  const refresh = useCallback(async () => {
    setList(await listInspections(stored.profile.id));
  }, [stored.profile.id]);

  useEffect(() => { void refresh(); }, [refresh]);

  /*
    El analisis que la version anterior guardaba aparte.

    Mientras hubo dos caminos, el automatico escribia su lista en una clave
    propia por parque, sin nombre, sin condiciones y sin revision. Al unificar,
    esa clave se queda sin nadie que la lea — y adentro esta el ultimo vuelo
    analizado. Se convierte en un vuelo normal la primera vez que se entra, y
    despues se borra la clave para no importarlo de nuevo.
  */
  useEffect(() => {
    if (!farm) return;
    void (async () => {
      const viejo = await loadAnalysis(stored.profile.id);
      if (!viejo?.hallazgos?.length) return;
      await saveInspection(vueloDesdeAnalisis(viejo, stored, farm));
      await deleteAnalysis(stored.profile.id);
      void refresh();
    })();
  }, [farm, stored, refresh]);

  // Guardar en cuanto cambia algo: en el campo nadie toca "guardar".
  useEffect(() => {
    if (current) void saveInspection(current).then(refresh);
  }, [current, refresh]);

  function abrir(i: Insp) {
    setCurrent(i);
    // Con los umbrales con los que se lo clasifico, no con los de fabrica: si
    // no, abrir un vuelo guardado lo reclasifica solo y el informe cambia sin
    // que nadie haya tocado nada.
    setUmbrales(i.cobertura?.umbrales ?? UMBRALES);
  }

  function nueva() {
    const now = new Date();
    setCurrent({
      id: `${stored.profile.id}-${now.getTime().toString(36)}`,
      farmId: stored.profile.id,
      farmName: stored.profile.name,
      name: `Vuelo ${now.toLocaleDateString("es-AR")}`,
      createdAt: now.toISOString(),
      conditions: {},
      findings: [],
    });
    setUmbrales(UMBRALES);
  }

  /**
   * Lo que produce la deteccion entra al vuelo sin pisar la revision humana.
   *
   * `fusionarRevision` es la pieza que lo garantiza: la medicion viene siempre
   * de la corrida nueva, y lo que escribio una persona se conserva. Es lo que
   * permite mover la grilla un metro o cambiar un umbral sin volver a
   * clasificar cuarenta anomalias a mano.
   */
  const onDeteccion = useCallback((d: { findings: Finding[]; cobertura: Cobertura }) => {
    setCurrent((c) =>
      c ? { ...c, findings: fusionarRevision(d.findings, c.findings), cobertura: d.cobertura } : c,
    );
  }, []);

  /**
   * Mover un umbral no vuelve a leer ninguna foto.
   *
   * La temperatura de cada modulo, la de su punto mas caliente y su delta
   * contra los vecinos ya estan medidos: un umbral solo decide como se LLAMA
   * ese numero. Asi que la lista guardada se reclasifica en el acto.
   *
   * Con las fotos todavia cargadas, el paso de deteccion ademas vuelve a
   * comparar todas las muestras y manda una lista nueva —ahi bajar el umbral
   * tambien SUMA modulos que antes no llegaban—. Los dos caminos clasifican
   * con la misma funcion, asi que lo que aparece en los dos sale igual.
   */
  function aplicarUmbrales(nuevo: Umbrales) {
    setUmbrales(nuevo);
    setCurrent((c) =>
      c
        ? {
            ...c,
            findings: reclasificarFindings(c.findings, nuevo),
            ...(c.cobertura ? { cobertura: { ...c.cobertura, umbrales: nuevo } } : {}),
          }
        : c,
    );
  }

  function cambiarUmbral(k: keyof Umbrales, texto: string) {
    const v = Number(texto);
    // Borrar el campo daba `Number("") === 0`, y con el umbral leve en 0 TODO
    // modulo del parque queda clasificado como anomalia: mil hallazgos falsos
    // y el informe entero al tacho, sin ningun aviso.
    aplicarUmbrales({
      ...umbrales,
      [k]: texto.trim() === "" || !Number.isFinite(v) || v <= 0 ? UMBRALES[k] : v,
    });
  }

  /** Pide la carpeta de fotos y resuelve cuando el usuario elige. */
  function pedirFotos(): Promise<File[]> {
    return new Promise((resolve) => {
      /*
        La carpeta que se elige para exportar sirve tambien para la revision.

        Si no, abrir un vuelo guardado, exportar el informe y despues querer
        mirar una foto pide la MISMA carpeta dos veces. Es el mismo disco y los
        mismos archivos: quedarselos cuesta nada.
      */
      pedido.current = (fs) => { if (fs.length) setFotosDelVuelo(fs); resolve(fs); };
      inputFotos.current?.click();
    });
  }

  /**
   * Las fotos de los hallazgos, emparejadas por nombre.
   *
   * Solo las que hacen falta: un vuelo son miles de fotos y el entregable son
   * decenas. Meter el vuelo entero haria un ZIP de gigabytes que nadie abre.
   */
  function fotosDeLosHallazgos(archivos: File[]): Map<string, File> {
    const porNombre = new Map(archivos.map((f) => [f.name, f]));
    const salida = new Map<string, File>();
    for (const f of entregables(current!)) {
      const file = porNombre.get(f.fileName);
      if (file) salida.set(f.fileName, file);
    }
    return salida;
  }

  async function exportarExcel() {
    if (!current) return;
    setExportando("Armando el Excel…");
    try {
      /*
        El perfil del parque va al entregable, no solo la inspeccion.

        La inspeccion guarda el nombre del parque y nada mas, asi que el Excel
        no tenia con que decir desde que punta se numeran los modulos: salia un
        "modulo 19" que el cliente no podia verificar contra nada. Lo que falta
        esta a mano —esta pantalla ya recibe el parque entero— y de ahi sale la
        linea que declara la convencion.
      */
      const bytes = await aExcel(current, "fotos", stored.profile.addressing);
      descargarBytes(
        `${current.name}.xlsx`,
        bytes,
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
    } finally {
      setExportando(null);
    }
  }

  async function exportarFotos() {
    if (!current) return;
    const archivos = await pedirFotos();
    if (!archivos.length) return;
    setExportando("Renombrando las fotos…");
    try {
      const encontradas = fotosDeLosHallazgos(archivos);
      /*
        Un modulo, un archivo. Con la deteccion automatica, una misma foto
        puede tener varios hallazgos —son varios modulos del mismo cuadro— y
        cada uno se entrega con SU nombre. Escribirlos con la misma ruta
        dejaria un ZIP con entradas repetidas, que el que lo abre ve como un
        solo archivo: los otros hallazgos desaparecen sin aviso.
      */
      const usados = new Set<string>();
      const entradas = [];
      for (const f of entregables(current)) {
        const file = encontradas.get(f.fileName);
        if (!file) continue;
        let ruta = `fotos/${nombreDeFoto(f)}`;
        if (usados.has(ruta)) {
          const ext = /\.[a-z0-9]+$/i.exec(ruta)?.[0] ?? "";
          ruta = `${ruta.slice(0, ruta.length - ext.length)}__${f.id.replace(/[^\w.-]+/g, "-")}${ext}`;
        }
        usados.add(ruta);
        entradas.push({ ruta, contenido: new Uint8Array(await file.arrayBuffer()) });
      }
      if (!entradas.length) {
        setExportando(
          `Ninguna de las ${archivos.length} fotos que elegiste coincide con los hallazgos. ` +
          "Fijate que sea la carpeta de ESTE vuelo.",
        );
        return;
      }
      descargarBytes(`${current.name}-fotos.zip`, zip(entradas, new Date()), "application/zip");
      setExportando(null);
    } catch (e) {
      setExportando(e instanceof Error ? e.message : String(e));
    }
  }

  async function exportarInforme() {
    if (!current) return;
    const archivos = await pedirFotos();
    setExportando("Armando el informe…");
    try {
      const encontradas = fotosDeLosHallazgos(archivos);
      const fotos = [];
      for (const [nombre, file] of encontradas) {
        fotos.push({ fileName: nombre, dataUrl: await comoDataUrl(file) });
      }
      const html = aInformeHtml(current, fotos, stored.profile.addressing);
      descargarBytes(`${current.name}.html`, html, "text/html;charset=utf-8");
      setExportando(
        fotos.length
          ? null
          : "Salio sin fotos: ninguna de las que elegiste coincide con los hallazgos.",
      );
    } catch (e) {
      setExportando(e instanceof Error ? e.message : String(e));
    }
  }

  function patch(id: string, cambio: Partial<Finding>) {
    setCurrent((c) =>
      c ? { ...c, findings: c.findings.map((f) => (f.id === id ? { ...f, ...cambio } : f)) } : c,
    );
  }

  if (!farm) {
    return (
      <div className="screen">
        <p className="alert">El perfil de este parque no compila. Recargalo desde el asistente.</p>
        <button className="ghost" onClick={onBack}>Volver</button>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  if (!current) {
    return (
      <div className="screen">
        <header className="screen-head">
          <div>
              <h1>Vuelos</h1>
          </div>
          <button onClick={nueva}>Nuevo vuelo</button>
        </header>

        {list.length === 0 ? (
          <section className="card empty">
            <h2>Todavia no hay ningun vuelo cargado</h2>
            <p>
              Un vuelo es una carpeta de fotos térmicas. La app mide cada módulo del parque que
              aparece en ellas, lo compara contra los otros de su mismo string, y te deja la lista
              de los que se despegan para revisarla y entregarla.
            </p>
            <button onClick={nueva}>Crear el primero</button>
          </section>
        ) : (
          <ul className="farms">
            {list.map((i) => {
              const s = summarize(i.findings);
              return (
                <li key={i.id}>
                  <button className="farm-open" onClick={() => abrir(i)}>
                    <strong>{i.name}</strong>
                    <span className="mono">
                      {s.total} hallazgos · {s.confirmados} confirmados · {s.pendientes} pendientes
                      {s.sinUbicar ? ` · ${s.sinUbicar} sin ubicar` : ""}
                    </span>
                    <span className="mono muted">
                      {i.cobertura
                        ? `${i.cobertura.modulosMedidos} modulos medidos de ${i.cobertura.totalModulos || "?"}` +
                          (i.cobertura.sinMedir ? ` · ${i.cobertura.sinMedir} sin mirar` : "")
                        : "sin deteccion: cargá las fotos del vuelo"}
                    </span>
                  </button>
                  <div className="farm-actions">
                    <button className="link" onClick={() => download(`${i.name}.csv`, toCsv(i), "text/csv")}>
                      Exportar CSV
                    </button>
                    <button
                      className="link danger"
                      onClick={async () => {
                        if (confirm(`¿Borrar "${i.name}"?`)) { await deleteInspection(i.id); void refresh(); }
                      }}
                    >
                      Borrar
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <button className="ghost" onClick={onBack}>Volver a parques</button>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  const s = summarize(current.findings);
  /*
    Donde cae cada hallazgo, y los bloques del parque con lo que falta en cada
    uno. Es lo que dibuja el mapa de navegacion; se arma una vez por lista y no
    por cuadro.
  */
  /*
    La muestra a revisar y cuanto le acerto la maquina.

    Es lo que convierte "revisar tres mil paneles" en "revisar trescientos y
    poder decir en cuantos coincidio".
  */
  const muestra = muestraARevisar(current.findings, porcentaje, current.id);
  const acuerdo = acuerdoDeLaMuestra(current.findings, muestra.aRevisar);

  const puntos = puntosDeHallazgos(farm, current.findings);
  const bloques = bloquesDelParque(farm, current.findings, puntos);

  const visibles = current.findings
    .filter((f) =>
      filtro === "todos" ? true
        : filtro === "muestra" ? muestra.aRevisar.has(f.id)
        : filtro === "sin-ubicar" ? !f.address
        : f.status === filtro,
    )
    // Entrar a un bloque en el mapa acota la lista a ese bloque: es lo que
    // convierte al mapa en navegacion y no en un dibujo al costado.
    .filter((f) => !bloqueAbierto || (puntos.get(f.id)?.block ?? f.address?.block) === bloqueAbierto)
    /*
      Lo peor arriba. La lista dejo de ser el orden en que salieron las fotos
      —que no significa nada— y pasa a ser una lista de modulos: el que tiene
      que salir a caminar el parque empieza por los criticos. Dentro de la
      misma severidad manda el delta.
    */
    .sort((a, b) => {
      const sa = ORDEN.indexOf(a.medicion?.peor ?? "normal");
      const sb = ORDEN.indexOf(b.medicion?.peor ?? "normal");
      if (sa !== sb) return sa - sb;
      return (deltaTDe(b) ?? -99) - (deltaTDe(a) ?? -99);
    });

  return (
    <div className="screen">
      <header className="screen-head">
        <div>
          <p className="eyebrow">{current.farmName}</p>
          <h1>{current.name}</h1>
        </div>
        <button className="ghost" onClick={() => setCurrent(null)}>Vuelos</button>
      </header>

      {/*
        Los vuelos que quedaron guardados con el modelo anterior.
        =====================================================================
        Se abren y no se pierde nada: la revision humana esta toda ahi. Lo que
        no tienen es la medicion del motor, porque en ese modelo un hallazgo
        era una foto con un ΔT escrito a mano. Decirlo importa: si no, el
        informe sale con la mitad de las columnas vacias y parece un error de
        la app.
      */}
      {esModeloViejo(current) && (
        <section className="card">
          <p className="note bad">
            Este vuelo se cargó con el modelo anterior: <strong>un hallazgo por foto</strong>, con
            el ΔT escrito a mano y sin la medición del motor. Se abre y se entrega igual, pero las
            columnas de temperatura, ΔT medido y comparación contra el string van vacías. Para
            tenerlas, volvé a cargar las fotos del vuelo acá abajo: lo que ya clasificaste a mano
            no se pierde.
          </p>
        </section>
      )}

      {/* --- condiciones --- */}
      <section className="card">
        <h2>Condiciones del vuelo</h2>
        <p className="muted small">
          La norma de termografia exige documentarlas en el reporte. Cargalas ahora: despues nadie
          se acuerda de cuanto viento habia.
        </p>
        <div className="grid-2">
          {([
            ["irradianceWm2", "Irradiancia (W/m²)", "La norma pide 600 como minimo", "number"],
            ["ambientC", "Temperatura ambiente (°C)", "", "number"],
            ["windMs", "Viento (m/s)", "El viento enfria el vidrio y aplana las diferencias", "number"],
            ["sky", "Estado del cielo", "Despejado, nubes dispersas, cubierto", "text"],
            ["pilot", "Piloto", "", "text"],
            ["equipment", "Equipo", "Dron y camara usados", "text"],
          ] as const).map(([key, label, help, type]) => (
            <div className="field" key={key}>
              <label htmlFor={`cond-${key}`}>{label}</label>
              <input
                id={`cond-${key}`}
                type={type}
                value={(current.conditions[key] as string | number | undefined) ?? ""}
                onChange={(e) =>
                  setCurrent({
                    ...current,
                    conditions: {
                      ...current.conditions,
                      // `Number(x) || undefined` tiraba el cero: viento 0 m/s
                      // es aire quieto, que es LA mejor condicion para volar
                      // termica, y quedaba grabado como "no lo anote".
                      [key]: type === "number" ? numeroOVacio(e.target.value) : e.target.value,
                    },
                  })
                }
              />
              {help && <span className="help">{help}</span>}
            </div>
          ))}
        </div>
      </section>

      {/* --- carga y deteccion: el paso que produce los hallazgos --- */}
      <Analysis
        stored={stored}
        farm={farm}
        umbrales={umbrales}
        onDeteccion={onDeteccion}
        onFotos={setFotosDelVuelo}
      />

      {/* --- resumen --- */}
      {s.total > 0 && (
        <section className="card">
          <h2>Resumen</h2>
          <div className="stats">
            <div><b>{s.total}</b><span>hallazgos</span></div>
            <div><b>{s.bloques}</b><span>bloques</span></div>
            <div className={s.porSeveridad.critica ? "alerta" : ""}><b>{s.porSeveridad.critica}</b><span>criticas</span></div>
            <div className={s.porSeveridad.moderada ? "alerta" : ""}><b>{s.porSeveridad.moderada}</b><span>moderadas</span></div>
            <div><b>{s.confirmados}</b><span>confirmados</span></div>
            <div><b>{s.pendientes}</b><span>pendientes</span></div>
            <div className={s.porClase[3] ? "alerta" : ""}><b>{s.porClase[3]}</b><span>clase 3</span></div>
            <div className={s.sinUbicar ? "alerta" : ""}><b>{s.sinUbicar}</b><span>sin ubicar</span></div>
          </div>

          {/*
            Los umbrales, sobre la lista y no sobre las fotos.
            =================================================================
            Reclasifican en el acto porque el delta de cada modulo ya esta
            medido: un umbral solo decide como se llama ese numero. Por eso
            funciona tambien con un vuelo abierto un mes despues, con las fotos
            en otro disco.
          */}
          {/*
            La revision por muestreo.
            ===================================================================
            "Imaginate revisar mas de 3000 paneles a mano, me tardaria una
            eternidad." La salida no es revisar mas rapido: es revisar MENOS y
            poder defenderlo. El motor clasifica todos por la forma de la
            mancha, una persona revisa una muestra, y el informe declara cuantos
            miro y en cuantos coincidio.

            Ese ultimo numero es lo que hace la diferencia. La empresa que hace
            este trabajo en Edenvale entrega 3.156 hallazgos clasificados y
            SIN esa tasa; su propia verificacion de campo, cuando la hicieron,
            encontro un tipo entero con 30 de 71 mal. Con la tasa a la vista eso
            se ve el primer dia, no seis meses despues.
          */}
          <h3>Revisión por muestreo</h3>
          <div className="field pregunta">
            <label htmlFor="f-muestra">
              Revisar <strong>{Math.round(porcentaje * 100)} %</strong> de cada tipo, al azar
            </label>
            <input
              id="f-muestra" type="range" min={0.05} max={1} step={0.05} value={porcentaje}
              onChange={(e) => setPorcentaje(Number(e.target.value))}
            />
            <span className="help">
              De los <strong>{s.total}</strong> hallazgos hay{" "}
              <strong>{muestra.aRevisar.size}</strong> para mirar:{" "}
              {muestra.porSorteo} por sorteo
              {muestra.porConfianza > 0 && <>, {muestra.porConfianza} que la máquina marcó como poco confiables</>}
              {muestra.sinClasificar > 0 && <> y {muestra.sinClasificar} a los que no les pudo leer la forma</>}.
              {" "}Lo poco confiable no se sortea: va entero, porque muestrear justo lo que sabés que
              falla es elegir no enterarte.
              {acuerdo.tasa != null && (
                <>
                  {" "}Sobre los <strong>{acuerdo.revisados}</strong> que ya cerraste, la máquina
                  acertó el <strong>{Math.round(acuerdo.tasa * 100)} %</strong>
                  {acuerdo.porTipo.length > 1 && (
                    <> ({acuerdo.porTipo.map((t) => `${t.patron} ${t.coinciden}/${t.revisados}`).join(", ")})</>
                  )}. Ese número va al informe: es lo que lo hace auditable.
                </>
              )}
            </span>
          </div>

          <h3>Como se clasifica la lista</h3>
          <div className="row">
            {(["leve", "moderada", "critica"] as const).map((k) => (
              <label className="inline" key={k}>
                ΔT {k} (°C)
                <input
                  type="number" min={0.5} step={0.5} value={umbrales[k]}
                  onChange={(e) => cambiarUmbral(k, e.target.value)}
                />
              </label>
            ))}
          </div>
          {(umbrales.leve >= umbrales.moderada || umbrales.moderada >= umbrales.critica) && (
            <p className="note bad">
              Los tres umbrales tienen que ir de menor a mayor: leve &lt; moderada &lt; critica.
              Como estan ahora, la clasificacion no significa nada.
              <button className="link" onClick={() => aplicarUmbrales(UMBRALES)}>
                volver a {UMBRALES.leve} / {UMBRALES.moderada} / {UMBRALES.critica} →
              </button>
            </p>
          )}
          <p className="help">
            Los umbrales son una convencion de trabajo, no una cita de la norma: la IEC clasifica
            por patron y contexto, no por un numero suelto. Sirven para ordenar la lista, y quedan
            declarados en el informe. Con las fotos cargadas, bajarlos ademas suma modulos que
            antes no llegaban; con el vuelo ya guardado solo reclasifica los que estan.
          </p>

          <div className="row">
            {(["muestra", "todos", "pendiente", "confirmado", "sin-ubicar"] as const).map((f) => (
              <button
                key={f}
                className={filtro === f ? "" : "ghost"}
                onClick={() => setFiltro(f)}
              >
                {f === "sin-ubicar" ? "Sin ubicar"
                  : f === "muestra" ? `Lo que hay que revisar (${muestra.aRevisar.size})`
                  : f[0]!.toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>

          {/*
            Los formatos de entrega.
            ===================================================================
            Habia uno solo, un CSV, y el proveedor con el que compite este
            trabajo entrega un Excel con link a la foto de cada hallazgo. Un
            CSV con nombres de archivo al lado de una carpeta de 4000 fotos es
            menos que eso.

            Las fotos NO se guardan en la base: un vuelo son miles de JPEG y
            meterlos en IndexedDB llenaria el disco del telefono. Se piden al
            exportar y se usan las de los hallazgos nomas.
          */}
          <h3>Entregar</h3>
          <div className="acciones-entrega">
            <button onClick={() => void exportarExcel()}>Excel + link a las fotos</button>
            <button onClick={() => void exportarFotos()}>Carpeta de fotos renombradas</button>
            <button onClick={() => void exportarInforme()}>Informe visual (HTML / PDF)</button>
            <button className="ghost" onClick={() => download(`${current.name}.csv`, toCsv(current), "text/csv")}>
              CSV
            </button>
          </div>
          {exportando && <p className="note ok">{exportando}</p>}
          <p className="help">
            El Excel y la carpeta de fotos van juntos: dejalos en la misma carpeta y el link de
            cada fila abre su foto. El informe visual es un solo archivo con las imagenes adentro
            — se abre en cualquier navegador y con <strong>Cmd+P → Guardar como PDF</strong> sale
            el PDF, sin carpeta al lado. Los cuatro llevan lo que midio el motor y lo que
            clasificaste vos, y declaran lo que el vuelo no permite afirmar.
          </p>
          <input
            ref={inputFotos}
            type="file"
            multiple
            accept="image/jpeg"
            style={{ display: "none" }}
            onChange={(e) => {
              const fs = [...(e.target.files ?? [])];
              e.target.value = "";
              pedido.current?.(fs);
              pedido.current = null;
            }}
          />
        </section>
      )}

      {/* --- el mapa como navegacion y la revision al lado --- */}
      {current.findings.length > 0 && (
        <section className="card">
          <h2>Revisar</h2>
          <MapaDelParque
            bloques={bloques}
            puntos={puntos}
            findings={current.findings}
            abierto={bloqueAbierto}
            onAbrir={setBloqueAbierto}
            seleccion={elegido}
            onElegir={setElegido}
          />
          <Revisor
            findings={visibles}
            archivos={fotosDelVuelo}
            seleccion={elegido}
            onSeleccion={setElegido}
            onPatch={patch}
          />
        </section>
      )}
    </div>
  );
}
