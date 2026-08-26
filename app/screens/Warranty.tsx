/**
 * El paquete de garantias: la pantalla donde el informe se convierte en plata.
 *
 * Un informe termografico dice que esta roto. Eso el cliente ya lo sabe: se le
 * nota en la produccion. Lo que no tiene es el reclamo armado, con la evidencia
 * que el fabricante exige, dirigido al bolsillo que corresponde y presentado
 * antes de que venza el plazo.
 *
 * Por eso esta pantalla no muestra temperaturas. Muestra tres cosas:
 *
 *   1. A quien se le reclama cada hallazgo — modulos, trackers, u operacion.
 *   2. Que le falta a cada reclamo para no rebotar.
 *   3. Que conviene arreglar primero, ordenado por cuantos reclamos destraba.
 *
 * La clasificacion final la pone una persona mirando la foto, no un umbral. La
 * app ordena el trabajo y no deja pasar lo que invalida un reclamo.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { download } from "../inspection";
import { eventosDeString, type Hallazgo } from "../detect";
import {
  armarPaquete,
  CANALES,
  claveDe,
  IRRADIANCIA_MINIMA,
  resumirGarantias,
  toCsv,
  type Canal,
  type Cobertura,
  type Condiciones,
  type ItemDeGarantia,
} from "../warranty";
import {
  loadAnalysis,
  loadWarranty,
  saveWarranty,
  type StoredAnalysis,
  type StoredFarm,
} from "../storage";

/**
 * El vocabulario de anomalias.
 *
 * Es una lista cerrada a proposito: si cada informe inventa su propio nombre
 * para lo mismo, no se puede agrupar nada entre parques ni entre años, y el
 * fabricante recibe cinco escritos distintos por el mismo defecto.
 */
const ANOMALIAS: Array<{ grupo: string; opciones: string[] }> = [
  {
    grupo: "Del modulo",
    opciones: [
      "Diodo de bypass activado",
      "Celda en cortocircuito",
      "Varias celdas calientes",
      "Vidrio fisurado",
      "PID",
      "Caja de conexion caliente",
    ],
  },
  {
    grupo: "Del tracker",
    opciones: ["Modulos mal inclinados", "Motor del tracker", "Inclinometro o transmision"],
  },
  {
    grupo: "De la operacion",
    opciones: ["Suciedad", "Sombra de vegetacion", "Objeto sobre el modulo"],
  },
];

const ORDEN_CANAL: Canal[] = ["modulos", "trackers", "operacion", "sin-clasificar"];

export function Warranty({ farm: stored, onBack }: { farm: StoredFarm; onBack: () => void }) {
  const [analisis, setAnalisis] = useState<StoredAnalysis | null | undefined>(undefined);
  const [cobertura, setCobertura] = useState<Cobertura>({});
  const [condiciones, setCondiciones] = useState<Condiciones>({});
  const [anomalias, setAnomalias] = useState<Map<string, string>>(new Map());
  const [conRgb, setConRgb] = useState<Set<string>>(new Set());
  const [filtro, setFiltro] = useState<Canal | "todos" | "incompletos">("todos");
  const [listo, setListo] = useState(false);

  useEffect(() => {
    void (async () => {
      const a = await loadAnalysis(stored.profile.id);
      setAnalisis(a ?? null);
      const g = await loadWarranty(stored.profile.id);
      if (g) {
        setCobertura(g.cobertura);
        setCondiciones(g.condiciones);
        setAnomalias(new Map(g.anomalias));
        setConRgb(new Set(g.conRgb));
      }
      setListo(true);
    })();
  }, [stored.profile.id]);

  // Guardar cada cambio. Clasificar doscientos modulos son horas de trabajo y
  // no se pueden perder por cerrar una pestaña.
  useEffect(() => {
    if (!listo) return;
    void saveWarranty({
      farmId: stored.profile.id,
      cobertura,
      condiciones,
      anomalias: [...anomalias.entries()],
      conRgb: [...conRgb],
      savedAt: new Date().toISOString(),
    });
  }, [listo, cobertura, condiciones, anomalias, conRgb, stored.profile.id]);

  const hallazgos: Hallazgo[] = analisis?.hallazgos ?? [];

  /**
   * Los modulos que pertenecen a un string caliente entero.
   *
   * Lo calcula la app y no lo pregunta: es justo el error que hace rebotar los
   * reclamos, y depender de que alguien se acuerde de marcarlo seria dejarlo
   * librado a la memoria.
   */
  const deStringEntero = useMemo(() => {
    const eventos = eventosDeString(hallazgos, stored.profile.topology.modulesPerString);
    const rowsChunk = new Set(eventos.map((e) => `${e.rowId}#${e.stringNumber}`));
    const out = new Set<string>();
    for (const h of hallazgos) {
      if (rowsChunk.has(`${h.modulo.rowId}#${h.modulo.stringNumber}`)) out.add(claveDe(h));
    }
    return out;
  }, [hallazgos, stored.profile.topology.modulesPerString]);

  const items = useMemo(
    () => armarPaquete(hallazgos, { anomalias, deStringEntero, cobertura, condiciones, conRgb }),
    [hallazgos, anomalias, deStringEntero, cobertura, condiciones, conRgb],
  );
  const resumen = useMemo(() => resumirGarantias(items), [items]);

  const visibles = useMemo(() => {
    const base =
      filtro === "todos" ? items
      : filtro === "incompletos" ? items.filter((i) => !i.completo)
      : items.filter((i) => i.canal === filtro);
    return [...base].sort(
      (a, b) =>
        Number(b.completo) - Number(a.completo) ||
        ORDEN_CANAL.indexOf(a.canal) - ORDEN_CANAL.indexOf(b.canal) ||
        b.hallazgo.deltaT - a.hallazgo.deltaT,
    );
  }, [items, filtro]);

  const clasificar = useCallback((k: string, v: string) => {
    setAnomalias((prev) => {
      const next = new Map(prev);
      if (v) next.set(k, v); else next.delete(k);
      return next;
    });
  }, []);

  const marcarRgb = useCallback((k: string, on: boolean) => {
    setConRgb((prev) => {
      const next = new Set(prev);
      if (on) next.add(k); else next.delete(k);
      return next;
    });
  }, []);

  if (analisis === undefined) {
    return <div className="screen"><p className="muted">Cargando…</p></div>;
  }

  if (analisis === null || !hallazgos.length) {
    return (
      <div className="screen">
        <header className="screen-head">
          <div>
            <p className="eyebrow">{stored.profile.name}</p>
            <h1>Paquete de garantias</h1>
          </div>
          <button className="ghost" onClick={onBack}>Parques</button>
        </header>
        <section className="card empty">
          <h2>Todavia no hay un vuelo analizado</h2>
          <p>
            Los reclamos se arman con los hallazgos de un vuelo. Analizá uno primero y volvé:
            la clasificacion que hagas acá queda guardada aunque cierres la app.
          </p>
        </section>
      </div>
    );
  }

  const sinClasificar = resumen.porCanal["sin-clasificar"];

  return (
    <div className="screen">
      <header className="screen-head">
        <div>
          <p className="eyebrow">{stored.profile.name}</p>
          <h1>Paquete de garantias</h1>
        </div>
        <button className="ghost" onClick={onBack}>Parques</button>
      </header>

      <section className="card">
        <h2>Quien paga cada cosa</h2>
        <div className="stats">
          <div><b>{resumen.porCanal.modulos}</b><span>fabricante de modulos</span></div>
          <div><b>{resumen.porCanal.trackers}</b><span>fabricante de trackers</span></div>
          <div><b>{resumen.porCanal.operacion}</b><span>a cargo de la operacion</span></div>
          <div className={sinClasificar ? "alerta" : ""}>
            <b>{sinClasificar}</b><span>sin clasificar</span>
          </div>
        </div>
        <p className="muted small">
          {analisis.fotos} fotos · {analisis.gsdCm.toFixed(1)} cm por pixel ·{" "}
          {resumen.listos} de {resumen.total} listos para presentar.
        </p>
        <p className="help">
          Un tracker parado en el angulo equivocado marca sus 56 paneles como calientes y no es un
          problema de modulos. Separar los dos bolsillos es lo que hace que el reclamo prospere —
          y es lo que casi ningun informe hace.
        </p>
      </section>

      <section className="card">
        <h2>Los datos del parque y del vuelo</h2>
        <p>
          Sin estos tres datos ningun reclamo se sostiene: cuando arrancó el parque, cuantos años
          cubre cada garantia, y con cuanto sol se voló.
        </p>
        <div className="row">
          <label className="inline">
            Puesta en marcha
            <input
              type="date"
              value={cobertura.puestaEnMarcha ?? ""}
              onChange={(e) => setCobertura((c) => ({ ...c, puestaEnMarcha: e.target.value || undefined }))}
            />
          </label>
          <label className="inline">
            Años de garantia · modulos
            <input
              type="number" min={0} max={40} step={1}
              value={cobertura.aniosModulos ?? ""}
              onChange={(e) =>
                setCobertura((c) => ({ ...c, aniosModulos: e.target.value ? Number(e.target.value) : undefined }))
              }
            />
          </label>
          <label className="inline">
            Años de garantia · trackers
            <input
              type="number" min={0} max={40} step={1}
              value={cobertura.aniosTrackers ?? ""}
              onChange={(e) =>
                setCobertura((c) => ({ ...c, aniosTrackers: e.target.value ? Number(e.target.value) : undefined }))
              }
            />
          </label>
        </div>
        <div className="row">
          <label className="inline">
            Fecha del vuelo
            <input
              type="date"
              value={condiciones.fecha ?? ""}
              onChange={(e) => setCondiciones((c) => ({ ...c, fecha: e.target.value || undefined }))}
            />
          </label>
          <label className="inline">
            Irradiancia (W/m²)
            <input
              type="number" min={0} max={1400} step={10}
              value={condiciones.irradianciaWm2 ?? ""}
              onChange={(e) =>
                setCondiciones((c) => ({ ...c, irradianciaWm2: e.target.value ? Number(e.target.value) : undefined }))
              }
            />
          </label>
          <label className="inline">
            Viento (km/h)
            <input
              type="number" min={0} max={100} step={1}
              value={condiciones.vientoKmh ?? ""}
              onChange={(e) =>
                setCondiciones((c) => ({ ...c, vientoKmh: e.target.value ? Number(e.target.value) : undefined }))
              }
            />
          </label>
          <label className="inline">
            Cielo
            <input
              type="text" placeholder="despejado"
              value={condiciones.cielo ?? ""}
              onChange={(e) => setCondiciones((c) => ({ ...c, cielo: e.target.value || undefined }))}
            />
          </label>
        </div>
        {condiciones.irradianciaWm2 != null && condiciones.irradianciaWm2 < IRRADIANCIA_MINIMA && (
          <p className="alert">
            El vuelo se hizo con {condiciones.irradianciaWm2} W/m², por debajo de los{" "}
            {IRRADIANCIA_MINIMA} que pide la norma. El fabricante puede rechazar todo el paquete por
            eso solo — conviene revolarlo antes de presentar nada.
          </p>
        )}
      </section>

      {resumen.faltantesFrecuentes.length > 0 && (
        <section className="card">
          <h2>Que arreglar primero</h2>
          <p>
            Ordenado por cuantos reclamos destraba cada cosa. Un reclamo rechazado cuesta mas que
            uno no presentado: quema la relacion con el fabricante y el segundo intento arranca en
            contra.
          </p>
          <div className="tablewrap">
            <table>
              <thead><tr><th>Reclamos</th><th>Que les falta</th></tr></thead>
              <tbody>
                {resumen.faltantesFrecuentes.map((f) => (
                  <tr key={f.motivo}>
                    <td><strong>{f.reclamos}</strong></td>
                    <td>{f.motivo}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="card">
        <h2>Los reclamos, uno por uno</h2>
        <p>
          Miralos con la foto al lado y decidí que es cada uno. El tipo de anomalia decide a que
          bolsillo va, y la app avisa cuando el tipo elegido no cierra con lo que muestran los
          datos.
        </p>

        <div className="row">
          <label className="inline">
            Ver
            <select value={filtro} onChange={(e) => setFiltro(e.target.value as typeof filtro)}>
              <option value="todos">Todos ({resumen.total})</option>
              <option value="incompletos">Los que rebotarian ({resumen.incompletos})</option>
              {ORDEN_CANAL.map((c) => (
                <option key={c} value={c}>{CANALES[c]} ({resumen.porCanal[c]})</option>
              ))}
            </select>
          </label>
        </div>

        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>Bloque</th><th>Tracker</th><th>String</th><th>Modulo</th><th>ΔT</th>
                <th>Que es</th><th>RGB</th><th>Va a</th><th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {visibles.slice(0, 200).map((it) => {
                const k = claveDe(it.hallazgo);
                const h = it.hallazgo;
                return (
                  <tr key={k} className={it.completo ? "" : "pendiente"}>
                    <td>{h.modulo.block}</td>
                    <td><code>{h.modulo.tracker}</code></td>
                    <td><code>{h.modulo.stringLabel ?? h.modulo.stringNumber}</code></td>
                    <td>{h.modulo.module}</td>
                    <td><strong>+{h.deltaT.toFixed(1)}</strong></td>
                    <td>
                      <select
                        value={anomalias.get(k) ?? ""}
                        onChange={(e) => clasificar(k, e.target.value)}
                      >
                        <option value="">— sin clasificar —</option>
                        {ANOMALIAS.map((g) => (
                          <optgroup key={g.grupo} label={g.grupo}>
                            {g.opciones.map((o) => (<option key={o} value={o}>{o}</option>))}
                          </optgroup>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        checked={conRgb.has(k)}
                        onChange={(e) => marcarRgb(k, e.target.checked)}
                        title="Tengo la foto visible de este modulo"
                      />
                    </td>
                    <td className={it.canal === "sin-clasificar" ? "muted" : ""}>
                      {CANALES[it.canal]}
                    </td>
                    <td>
                      {it.completo
                        ? <span className="chip ver">listo</span>
                        : <span className="chip asm" title={it.faltante.join(" · ")}>
                            faltan {it.faltante.length}
                          </span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {visibles.length > 200 && (
          <p className="muted small">Mostrando 200 de {visibles.length}. El CSV los lleva todos.</p>
        )}

        <Detalle items={visibles} />

        <div className="actions">
          <button
            onClick={() =>
              download(`${stored.profile.id}-garantias.csv`, toCsv(items, condiciones), "text/csv")
            }
          >
            Exportar el paquete
          </button>
        </div>
      </section>
    </div>
  );
}

/**
 * El detalle de los que no estan listos.
 *
 * Se muestra abierto y no escondido detras de un click: si hay que buscarlo,
 * no se lee, y el reclamo se presenta igual.
 */
function Detalle({ items }: { items: ItemDeGarantia[] }) {
  const pendientes = items.filter((i) => !i.completo).slice(0, 8);
  if (!pendientes.length) return null;

  return (
    <div className="warnbox">
      <h3>Por que rebotarian</h3>
      {pendientes.map((it) => {
        const h = it.hallazgo;
        return (
          <div className="note" key={claveDe(it.hallazgo)}>
            <strong>
              Bloque {h.modulo.block}, tracker {h.modulo.tracker}
              {h.modulo.row ? ` ${h.modulo.row}` : ""}, modulo {h.modulo.module}
            </strong>
            <br />
            <span className="muted small">{it.motivo}</span>
            <ul>{it.faltante.map((f, i) => (<li key={i}>{f}</li>))}</ul>
          </div>
        );
      })}
      {items.filter((i) => !i.completo).length > 8 && (
        <p className="muted small">
          … y {items.filter((i) => !i.completo).length - 8} mas. El CSV los lleva a todos con la
          columna <code>que_le_falta</code>.
        </p>
      )}
    </div>
  );
}
