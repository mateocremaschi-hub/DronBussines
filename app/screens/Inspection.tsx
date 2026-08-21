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
import { readPhoto } from "../photos";
import {
  ANOMALIAS,
  CLASES,
  deleteInspection,
  download,
  listInspections,
  saveInspection,
  summarize,
  toCsv,
  type Finding,
  type Inspection as Insp,
} from "../inspection";
import type { StoredFarm } from "../storage";

const nuevoId = (n: number) => `${n.toString(36)}-${(n * 2654435761) % 0xffff}`;

export function Inspection({ farm: stored, onBack }: { farm: StoredFarm; onBack: () => void }) {
  const [list, setList] = useState<Insp[]>([]);
  const [current, setCurrent] = useState<Insp | null>(null);
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
    const nuevos: Finding[] = [];
    const fallos: Array<{ fileName: string; error: string }> = [];

    for (let i = 0; i < arr.length; i++) {
      const read = await readPhoto(arr[i]!);
      if (!read.fix) {
        fallos.push({ fileName: read.fileName, error: read.error ?? "sin coordenada" });
      } else {
        const res = locate(
          read.fix.accuracyM
            ? { lat: read.fix.lat, lon: read.fix.lon, accuracyM: read.fix.accuracyM }
            : { lat: read.fix.lat, lon: read.fix.lon },
          farm,
        );
        contador.current += 1;
        nuevos.push({
          id: nuevoId(contador.current + i),
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
                      [key]: type === "number" ? Number(e.target.value) || undefined : e.target.value,
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
            <button className="ghost" onClick={() => download(`${current.name}.csv`, toCsv(current), "text/csv")}>
              Exportar CSV
            </button>
          </div>
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
                onChange={(e) => patch(f.id, { deltaT: Number(e.target.value) || undefined })}
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
