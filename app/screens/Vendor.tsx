/**
 * Auditoria del informe de una empresa de termografia.
 *
 * Una inspeccion tercerizada llega ya calculada: string, modulo, clase. Nadie
 * la verifica nunca, porque para verificarla hace falta tener la geometria del
 * parque — que es justo lo que esta app tiene.
 *
 * La pantalla contesta tres preguntas que el archivo no contesta: si su
 * numeracion sirve para caminar el parque, cuantos de sus hallazgos son en
 * realidad el mismo problema, y cuantos se capturaron fuera de la norma.
 */

import { useMemo, useState } from "react";
import { compileFarm } from "@locator";
import type { CompiledFarm } from "@locator";
import { readWorkbook, type Sheet } from "../ingest";
import { download } from "../inspection";
import {
  checkConditions,
  readVendorFindings,
  reconcile,
  suggestVendorMapping,
  summarizeReconcile,
  toEventsCsv,
  toWalkCsv,
  trackerEvents,
  type VendorMapping,
} from "../vendor";
import type { StoredFarm } from "../storage";

const CAMPOS: Array<{ key: keyof VendorMapping; label: string; req?: boolean }> = [
  { key: "lat", label: "Latitud", req: true },
  { key: "lon", label: "Longitud", req: true },
  { key: "stringId", label: "String del proveedor" },
  { key: "moduleIndex", label: "Modulo del proveedor" },
  { key: "anomaly", label: "Tipo de anomalia" },
  { key: "iec", label: "Clase IEC" },
  { key: "severity", label: "Severidad" },
  { key: "deltaT", label: "Delta de temperatura" },
  { key: "irradiance", label: "Irradiancia" },
  { key: "thermalUrl", label: "Foto termica" },
  { key: "rgbUrl", label: "Foto RGB" },
];

export function Vendor({ farm: stored, onBack }: { farm: StoredFarm; onBack: () => void }) {
  const [fileName, setFileName] = useState("");
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [mapping, setMapping] = useState<VendorMapping>({});
  const [error, setError] = useState<string | null>(null);

  const farm = useMemo<CompiledFarm | null>(() => {
    try { return compileFarm(stored.profile, stored.rows); } catch { return null; }
  }, [stored]);

  const sheet = sheets[sheetIndex];

  const findings = useMemo(
    () => (sheet && mapping.lat && mapping.lon ? readVendorFindings(sheet, mapping) : []),
    [sheet, mapping],
  );

  const rows = useMemo(
    () => (farm && findings.length ? reconcile(findings, farm) : []),
    [farm, findings],
  );

  const report = useMemo(() => (rows.length ? summarizeReconcile(rows) : null), [rows]);
  const eventos = useMemo(
    () => (farm && rows.length ? trackerEvents(rows, stored.rows, farm) : []),
    [farm, rows, stored.rows],
  );
  const cond = useMemo(() => (findings.length ? checkConditions(findings) : null), [findings]);

  const enEventos = eventos.reduce((s, e) => s + e.modulos, 0);

  async function onFile(file: File) {
    setError(null);
    try {
      const parsed = (await readWorkbook(await file.arrayBuffer(), 1)).filter((s) => s.rows.length);
      if (!parsed.length) { setError("El archivo no tiene ninguna hoja con datos."); return; }
      const mayor = parsed.reduce((a, b) => (b.rows.length > a.rows.length ? b : a));
      setSheets(parsed);
      setSheetIndex(parsed.indexOf(mayor));
      setMapping(suggestVendorMapping(mayor.headers));
      setFileName(file.name);
    } catch (e) {
      setError(`No pude leer el archivo: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (!farm) {
    return (
      <div className="screen">
        <p className="alert">El perfil de este parque no compila. Recargalo desde el asistente.</p>
        <button className="ghost" onClick={onBack}>Volver</button>
      </div>
    );
  }

  return (
    <div className="screen">
      <header className="screen-head">
        <div>
          <p className="eyebrow">{stored.profile.name}</p>
          <h1>Auditar un informe</h1>
        </div>
        <button className="ghost" onClick={onBack}>Parques</button>
      </header>

      <section className="card">
        <h2>El informe del proveedor</h2>
        <p>
          El CSV que entrega la empresa de termografia. La app recalcula cada hallazgo desde su
          coordenada con la geometria de este parque y compara contra lo que dice el archivo.
        </p>
        <label className="drop">
          <input
            type="file" accept=".csv,.xlsx,.xls"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); }}
          />
          <strong>Elegir archivo</strong>
          <span className="muted">{fileName || ".csv · .xlsx"}</span>
        </label>
        {error && <p className="alert">{error}</p>}
      </section>

      {sheet && (
        <section className="card">
          <h2>Que es cada columna</h2>
          <div className="grid-2">
            {CAMPOS.map((c) => (
              <div className="field" key={c.key}>
                <label htmlFor={`v-${c.key}`}>
                  {c.label}{c.req && <em className="req"> obligatorio</em>}
                </label>
                <select
                  id={`v-${c.key}`}
                  value={mapping[c.key] ?? ""}
                  onChange={(e) => setMapping((m) => ({ ...m, [c.key]: e.target.value || undefined }))}
                >
                  <option value="">— sin asignar —</option>
                  {sheet.headers.map((h) => (<option key={h} value={h}>{h}</option>))}
                </select>
              </div>
            ))}
          </div>
        </section>
      )}

      {report && (
        <section className="card">
          <h2>¿Sirve su numeracion para caminar el parque?</h2>
          <div className="stats">
            <div><b>{report.total}</b><span>hallazgos</span></div>
            <div><b>{report.coinciden}</b><span>coinciden</span></div>
            <div className={report.espejados ? "alerta" : ""}>
              <b>{report.espejados}</b><span>espejados</span>
            </div>
            <div className={report.sinUbicar ? "alerta" : ""}>
              <b>{report.sinUbicar}</b><span>sin ubicar</span>
            </div>
          </div>
          <p className={report.espejados > report.coinciden ? "note bad" : "note good"}>
            {report.veredicto}
          </p>
          <p className="help">
            "Espejado" significa mismo string pero el modulo contado desde la punta opuesta. En una
            fila de {stored.profile.topology.modulesPerString} modulos, el 1 y el ultimo estan a mas
            de 30 metros: el tecnico llega al panel equivocado.
          </p>
          <div className="actions">
            <button onClick={() => download(`${stored.profile.id}-caminable.csv`, toWalkCsv(rows), "text/csv")}>
              Exportar numerado desde la caja DC
            </button>
          </div>
        </section>
      )}

      {eventos.length > 0 && (
        <section className="card">
          <h2>Hallazgos que son un solo problema</h2>
          <p>
            Cuando un tracker queda parado en el angulo equivocado, el detector marca todos sus
            modulos uno por uno. Eso no son defectos de modulo: es un tracker, lo arregla otra
            persona y muchas veces entra en otra garantia.
          </p>
          <div className="stats">
            <div><b>{eventos.length}</b><span>eventos de tracker</span></div>
            <div><b>{enEventos}</b><span>hallazgos que los componen</span></div>
            <div><b>{Math.round((enEventos / Math.max(1, report?.total ?? 1)) * 100)} %</b><span>del informe</span></div>
          </div>
          <div className="tablewrap">
            <table>
              <thead>
                <tr><th>Bloque</th><th>Tracker</th><th>Fila</th><th>Anomalia</th><th>Modulos</th><th>De la fila</th></tr>
              </thead>
              <tbody>
                {eventos.slice(0, 20).map((e) => (
                  <tr key={`${e.rowId}-${e.anomaly}`}>
                    <td>{e.block}</td><td><code>{e.tracker}</code></td><td>{e.row ?? "—"}</td>
                    <td>{e.anomaly}</td><td>{e.modulos}</td><td>{Math.round(e.fraccion * 100)} %</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {eventos.length > 20 && <p className="muted small">…y {eventos.length - 20} mas.</p>}
          <div className="actions">
            <button onClick={() => download(`${stored.profile.id}-eventos.csv`, toEventsCsv(eventos), "text/csv")}>
              Exportar los eventos
            </button>
          </div>
        </section>
      )}

      {cond && (
        <section className="card">
          <h2>Condiciones de captura</h2>
          <div className="stats">
            <div className={cond.sinDato ? "alerta" : ""}><b>{cond.sinDato}</b><span>sin irradiancia</span></div>
            <div className={cond.bajoMinimo ? "alerta" : ""}><b>{cond.bajoMinimo}</b><span>bajo 600 W/m²</span></div>
            <div><b>{cond.minima ?? "—"}</b><span>la mas baja</span></div>
          </div>
          <p className={cond.sinDato || cond.bajoMinimo ? "note bad" : "note good"}>{cond.nota}</p>
        </section>
      )}
    </div>
  );
}
