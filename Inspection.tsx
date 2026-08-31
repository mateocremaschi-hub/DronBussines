/**
 * El lote de vuelo: carpeta de fotos -> hallazgos ubicados -> revision -> CSV.
 *
 * Es la pantalla que convierte un vuelo en algo que se entrega. El motor ya
 * sabia resolver una coordenada; lo que faltaba era hacerlo cuatrocientas veces
 * sin que nadie transcriba nada a mano.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { compileFarm, formatAddress, locate } from "@locator";
import type { CompiledFarm } from "@locator";
import { offNadirDeg, readPhoto } from "../photos";
import {
  ANOMALIAS,
  CLASES,
  deleteInspection,
  download,
  listInspections,
  saveInspection,
  summarize,
  toCsv,
  descargarBytes,
  type Finding,
  type Inspection as Insp,
} from "../inspection";
import type { StoredFarm } from "../storage";
import { aExcel, aInformeHtml, entregables, nombreDeFoto } from "../informe";
import { zip } from "../zip";

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
 * Un identificador de hallazgo que no se repite entre sesiones.
 *
 * El anterior era una funcion del contador, y el contador arrancaba en 0 cada
 * vez que se abria la pantalla. Volver a una inspeccion de ayer y agregarle
 * fotos generaba de nuevo los ids 1, 2, 3… que ya existian: a partir de ahi
 * editar un hallazgo editaba dos, y descartar uno descartaba los dos. En un
 * informe de garantia eso es un modulo que se reporta y no existe, o uno que
 * existe y no se reporta.
 *
 * Con el instante de carga adelante, dos lotes distintos no pueden chocar.
 */
const nuevoId = (n: number, cuando: number) =>
  `${cuando.toString(36)}-${n.toString(36)}`;

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
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [problemas, setProblemas] = useState<Array<{ fileName: string; error: string }>>([]);
  const [filtro, setFiltro] = useState<"todos" | "pendiente" | "confirmado" | "sin-ubicar">("todos");
  const contador = useRef(0);

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

  // Guardar en cuanto cambia algo: en el campo nadie toca "guardar".
  useEffect(() => {
    if (current) void saveInspection(current).then(refresh);
  }, [current, refresh]);

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
    setProblemas([]);
  }

  async function cargarFotos(files: FileList) {
    if (!farm || !current) return;
    const arr = [...files];
    setProgress({ done: 0, total: arr.length });
    // El instante en que empezo ESTE lote: es lo que separa los ids de hoy de
    // los de la sesion anterior sobre la misma inspeccion.
    const loteStamp = Date.now();
    const nuevos: Finding[] = [];
    const fallos: Array<{ fileName: string; error: string }> = [];

    for (let i = 0; i < arr.length; i++) {
      const read = await readPhoto(arr[i]!);
      if (!read.fix) {
        fallos.push({ fileName: read.fileName, error: read.error ?? "sin coordenada" });
      } else {
        // La coordenada de la foto es la del DRON. Si el gimbal no miraba
        // derecho para abajo, lo que se ve en el cuadro esta corrido, asi que
        // ese corrimiento entra al margen en vez de quedar escondido.
        const margen = Math.hypot(read.fix.accuracyM ?? 0, read.fix.tiltOffsetM ?? 0);
        const res = locate(
          margen > 0
            ? { lat: read.fix.lat, lon: read.fix.lon, accuracyM: margen }
            : { lat: read.fix.lat, lon: read.fix.lon },
          farm,
        );
        contador.current += 1;
        nuevos.push({
          id: nuevoId(contador.current, loteStamp),
          fileName: read.fileName,
          fix: read.fix,
          address: res.best,
          candidates: res.candidates.slice(0, 8),
          warnings: res.warnings,
          status: "pendiente",
        });
      }
      setProgress({ done: i + 1, total: arr.length });
    }

    setProblemas((p) => [...p, ...fallos]);
    setCurrent((c) => (c ? { ...c, findings: [...c.findings, ...nuevos] } : c));
    setProgress(null);
  }

  /** Pide la carpeta de fotos y resuelve cuando el usuario elige. */
  function pedirFotos(): Promise<File[]> {
    return new Promise((resolve) => {
      pedido.current = resolve;
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
      const bytes = await aExcel(current);
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
      const entradas = [];
      for (const f of entregables(current)) {
        const file = encontradas.get(f.fileName);
        if (!file) continue;
        entradas.push({
          ruta: `fotos/${nombreDeFoto(f)}`,
          contenido: new Uint8Array(await file.arrayBuffer()),
        });
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
      const html = aInformeHtml(current, fotos);
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
            <p className="eyebrow">{stored.profile.name}</p>
            <h1>Inspecciones</h1>
          </div>
          <button onClick={nueva}>Nuevo vuelo</button>
        </header>

        {list.length === 0 ? (
          <section className="card empty">
            <h2>Todavia no hay ningun vuelo cargado</h2>
            <p>
              Un vuelo es una carpeta de fotos. La app les lee la coordenada de los metadatos,
              ubica cada una, y te deja una tabla para revisar y exportar.
            </p>
            <p className="muted small">
              Para probarlo no hace falta el dron: sacale 20 fotos con el celular caminando el
              parque. Traen GPS adentro igual.
            </p>
            <button onClick={nueva}>Crear el primero</button>
          </section>
        ) : (
          <ul className="farms">
            {list.map((i) => {
              const s = summarize(i.findings);
              return (
                <li key={i.id}>
                  <button className="farm-open" onClick={() => setCurrent(i)}>
                    <strong>{i.name}</strong>
                    <span className="mono">
                      {s.total} hallazgos · {s.confirmados} confirmados · {s.pendientes} pendientes
                      {s.sinUbicar ? ` · ${s.sinUbicar} sin ubicar` : ""}
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
  const visibles = current.findings.filter((f) =>
    filtro === "todos" ? true
      : filtro === "sin-ubicar" ? !f.address
      : f.status === filtro,
  );

  return (
    <div className="screen">
      <header className="screen-head">
        <div>
          <p className="eyebrow">{current.farmName}</p>
          <h1>{current.name}</h1>
        </div>
        <button className="ghost" onClick={() => setCurrent(null)}>Inspecciones</button>
      </header>

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

      {/* --- carga --- */}
      <section className="card">
        <h2>Las fotos</h2>
        <label className="drop">
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => { if (e.target.files?.length) void cargarFotos(e.target.files); }}
          />
          <strong>Elegir fotos</strong>
          <span className="muted">Se pueden seleccionar todas juntas</span>
        </label>

        {progress && (
          <p className="note ok">
            Procesando {progress.done} de {progress.total}…
          </p>
        )}

        {problemas.length > 0 && (
          <div className="warnbox">
            <h3>{problemas.length} foto(s) sin coordenada</h3>
            <ul>
              {problemas.slice(0, 5).map((p, i) => (<li key={i}><strong>{p.fileName}</strong> — {p.error}</li>))}
            </ul>
            {problemas.length > 5 && <p className="muted small">…y {problemas.length - 5} mas.</p>}
          </div>
        )}
      </section>

      {/* --- resumen --- */}
      {s.total > 0 && (
        <section className="card">
          <h2>Resumen</h2>
          <div className="stats">
            <div><b>{s.total}</b><span>hallazgos</span></div>
            <div><b>{s.bloques}</b><span>bloques</span></div>
            <div><b>{s.confirmados}</b><span>confirmados</span></div>
            <div><b>{s.pendientes}</b><span>pendientes</span></div>
            <div className={s.porClase[3] ? "alerta" : ""}><b>{s.porClase[3]}</b><span>clase 3</span></div>
            <div className={s.sinUbicar ? "alerta" : ""}><b>{s.sinUbicar}</b><span>sin ubicar</span></div>
          </div>

          <div className="row">
            {(["todos", "pendiente", "confirmado", "sin-ubicar"] as const).map((f) => (
              <button
                key={f}
                className={filtro === f ? "" : "ghost"}
                onClick={() => setFiltro(f)}
              >
                {f === "sin-ubicar" ? "Sin ubicar" : f[0]!.toUpperCase() + f.slice(1)}
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
            el PDF, sin carpeta al lado.
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

      {/* --- hallazgos --- */}
      {visibles.map((f) => (
        <section className={`card hallazgo ${f.status}`} key={f.id}>
          <div className="hallazgo-top">
            {f.fix.thumb && <img src={f.fix.thumb} alt={f.fileName} />}
            <div className="hallazgo-id">
              <p className="eyebrow">{f.fileName}</p>
              <p className="answer">
                {f.address ? formatAddress(f.address) : "Sin ubicar"}
              </p>
              <p className="muted small">
                {f.address
                  ? `${(f.address.confidence * 100).toFixed(0)} % · ${f.address.offAxisM.toFixed(1)} m del eje`
                  : "No hay filas de trackers cerca de esa coordenada"}
                {f.fix.accuracyM ? ` · precision ±${f.fix.accuracyM} m` : ""}
                {f.fix.takenAt ? ` · ${new Date(f.fix.takenAt).toLocaleString("es-AR")}` : ""}
              </p>
              {f.fix.tiltOffsetM != null && f.fix.tiltOffsetM > 0.5 && (
                <p className="note bad small">
                  La camara no estaba a plomo: {offNadirDeg(f.fix.gimbalPitchDeg)!.toFixed(0)}° de
                  desvio a {f.fix.relativeAltitudeM!.toFixed(0)} m de altura. Lo que quedo en el
                  centro del cuadro esta a <strong>{f.fix.tiltOffsetM.toFixed(1)} m</strong> de donde
                  estaba el dron — {(f.fix.tiltOffsetM / 1.15).toFixed(0)} modulos. Ya lo sume al
                  margen, pero para que la coordenada sea la del panel hay que disparar con el gimbal
                  en -90°.
                </p>
              )}
            </div>
          </div>

          {f.warnings.length > 0 && (
            <div className="warnbox">
              {f.warnings.map((w, i) => (<p key={i}>{w.message}</p>))}
            </div>
          )}

          {f.candidates.length > 1 && f.address && (
            <>
              <h4>Corregir el modulo mirando la foto</h4>
              <div className="row chips">
                {[
                  ...new Set(
                    f.candidates
                      // Solo el string del mejor candidato: mezclar dos strings
                      // hace que el mismo numero signifique dos modulos distintos.
                      .filter((c) => c.rowId === f.address!.rowId && c.stringNumber === f.address!.stringNumber)
                      .map((c) => c.module),
                  ),
                ]
                  // En orden numerico, que es como los va a mirar el tecnico.
                  .sort((a, b) => a - b)
                  .map((m) => (
                  <button
                    key={m}
                    className={f.moduleCorregido === m ? "" : "ghost"}
                    onClick={() => patch(f.id, { moduleCorregido: f.moduleCorregido === m ? undefined : m })}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </>
          )}

          <div className="grid-2">
            <div className="field">
              <label htmlFor={`${f.id}-anomalia`}>Anomalia</label>
              <select id={`${f.id}-anomalia`} value={f.anomaly ?? ""} onChange={(e) => patch(f.id, { anomaly: e.target.value || undefined })}>
                <option value="">— sin clasificar —</option>
                {ANOMALIAS.map((a) => (<option key={a} value={a}>{a}</option>))}
              </select>
            </div>
            <div className="field">
              <label htmlFor={`${f.id}-clase`}>Clase</label>
              <select
                id={`${f.id}-clase`}
                value={f.klass ?? ""}
                onChange={(e) => patch(f.id, { klass: (Number(e.target.value) || undefined) as 1 | 2 | 3 | undefined })}
              >
                <option value="">— sin clasificar —</option>
                {CLASES.map((c) => (<option key={c.id} value={c.id}>{c.label}</option>))}
              </select>
              {f.klass && <span className="help">{CLASES.find((c) => c.id === f.klass)?.hint}</span>}
            </div>
            <div className="field">
              <label htmlFor={`${f.id}-dt`}>ΔT (°C)</label>
              <input
                id={`${f.id}-dt`}
                type="number" step="0.1" value={f.deltaT ?? ""}
                // Un ΔT de 0,0 °C es un dato: el modulo esta igual que sus
                // vecinos. Con `|| undefined` se guardaba como "no medido".
                onChange={(e) => patch(f.id, { deltaT: numeroOVacio(e.target.value) })}
              />
            </div>
            <div className="field">
              <label htmlFor={`${f.id}-nota`}>Nota</label>
              <input id={`${f.id}-nota`} value={f.note ?? ""} onChange={(e) => patch(f.id, { note: e.target.value || undefined })} />
            </div>
          </div>

          <div className="actions">
            <button
              className={f.status === "confirmado" ? "" : "ghost"}
              onClick={() => patch(f.id, { status: f.status === "confirmado" ? "pendiente" : "confirmado" })}
            >
              {f.status === "confirmado" ? "Confirmado" : "Confirmar"}
            </button>
            <button
              className="ghost"
              onClick={() => patch(f.id, { status: f.status === "descartado" ? "pendiente" : "descartado" })}
            >
              {f.status === "descartado" ? "Descartado" : "Descartar"}
            </button>
          </div>
        </section>
      ))}
    </div>
  );
}
