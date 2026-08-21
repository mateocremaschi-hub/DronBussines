/**
 * Carga de la lista de strings sobre un parque que ya tiene geometria.
 *
 * Es el archivo que cierra la numeracion: trae el numero real de cada string y
 * la caja DC que lo alimenta. Cruzado con la geometria, de ahi sale tambien la
 * posicion de cada tracker en su linea electrica — que es el ultimo dato que
 * hoy la app tiene que asumir.
 *
 * Cada paso muestra sobre cuanto trabajo y con que falla. Nada se aplica sin
 * que se vea antes.
 */

import { useMemo, useState } from "react";
import { readWorkbook, type Sheet } from "../ingest";
import {
  applyStrings,
  deriveChains,
  describeFields,
  forwardFill,
  matchEntries,
  readEntries,
  suggestStringMapping,
  type StringMapping,
} from "../strings";
import { saveFarm, type StoredFarm } from "../storage";

const CAMPOS: Array<{ key: keyof StringMapping; label: string; help: string; req: boolean }> = [
  { key: "label", label: "Etiqueta del string", help: "Ej: S-1.2.15.2", req: true },
  { key: "tracker", label: "Tracker", help: "Para cruzarlo con la geometria", req: true },
  { key: "row", label: "Fila", help: "R1, R2… si el archivo la distingue", req: false },
  { key: "dcBox", label: "Caja DC", help: "De aca salen las lineas electricas", req: false },
];

export function StringList({ farm, onDone, onCancel }: {
  farm: StoredFarm;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [fileName, setFileName] = useState("");
  const [buffer, setBuffer] = useState<ArrayBuffer | null>(null);
  const [headerRow, setHeaderRow] = useState(1);
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [mapping, setMapping] = useState<StringMapping>({});
  const [rellenar, setRellenar] = useState(true);
  const [fieldIndex, setFieldIndex] = useState(-1);
  const [orden, setOrden] = useState<"lowest-first" | "highest-first">(
    farm.profile.topology.rowNaming?.orderWithinTracker ?? "lowest-first",
  );
  const [error, setError] = useState<string | null>(null);
  const [guardado, setGuardado] = useState(false);

  const sheet = sheets[sheetIndex];

  async function abrir(buf: ArrayBuffer, fila: number) {
    const parsed = (await readWorkbook(buf, fila)).filter((s) => s.rows.length > 0);
    if (!parsed.length) { setError("El archivo no tiene ninguna hoja con datos."); return; }
    const mayor = parsed.reduce((a, b) => (b.rows.length > a.rows.length ? b : a));
    setSheets(parsed);
    setSheetIndex(parsed.indexOf(mayor));
    setMapping(suggestStringMapping(mayor.headers));
  }

  async function onFile(file: File) {
    setError(null);
    setGuardado(false);
    try {
      const buf = await file.arrayBuffer();
      setBuffer(buf);
      setFileName(file.name);
      await abrir(buf, headerRow);
    } catch (e) {
      setError(`No pude leer el archivo: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // --- pipeline ------------------------------------------------------------

  const entries = useMemo(() => {
    if (!sheet || !mapping.label || !mapping.tracker) return null;
    const usable = rellenar && mapping.dcBox ? forwardFill(sheet, [mapping.dcBox]) : sheet;
    return readEntries(usable, mapping);
  }, [sheet, mapping, rellenar]);

  const match = useMemo(
    () =>
      entries?.length
        ? matchEntries(entries, farm.rows, {
            naming: { ...farm.profile.topology.rowNaming, orderWithinTracker: orden },
          })
        : null,
    [entries, farm.rows, farm.profile.topology.rowNaming, orden],
  );

  const campos = useMemo(
    () => (entries?.length ? describeFields(entries.map((e) => e.label)) : []),
    [entries],
  );

  // Por defecto, el ultimo campo numerico de la etiqueta.
  const campoElegido = fieldIndex >= 0 ? fieldIndex : Math.max(0, campos.length - 1);

  const chains = useMemo(
    () => (match ? deriveChains(farm.rows, match.byRow) : null),
    [match, farm.rows],
  );

  async function aplicar() {
    if (!match || !chains) return;
    const rows = applyStrings(farm.rows, {
      fieldIndex: campoElegido,
      byRow: match.byRow,
      chains: chains.chains,
    });
    await saveFarm({
      ...farm,
      rows,
      savedAt: new Date().toISOString(),
      profile: {
        ...farm.profile,
        profileVersion: farm.profile.profileVersion + 1,
        // Queda declarado en el parque: la proxima carga arranca igual.
        topology: {
          ...farm.profile.topology,
          rowNaming: { ...farm.profile.topology.rowNaming, orderWithinTracker: orden },
        },
      },
    });
    setGuardado(true);
    onDone();
  }

  const cobertura = match ? Math.round((match.report.rowsWithStrings / farm.rows.length) * 100) : 0;
  const enCadena = chains?.reports.filter((r) => r.forma === "cadena").length ?? 0;
  const paralelas = chains?.reports.filter((r) => r.forma === "paralelas").length ?? 0;
  const mixtas = chains?.reports.filter((r) => r.forma === "mixta").length ?? 0;

  return (
    <div className="screen">
      <header className="screen-head">
        <div>
          <p className="eyebrow">{farm.profile.name}</p>
          <h1>Lista de strings</h1>
        </div>
        <button className="ghost" onClick={onCancel}>Cancelar</button>
      </header>

      <section className="card">
        <h2>El archivo</h2>
        <p>
          La planilla que mapea cada string a su tracker y a su caja DC. Trae el numero real del
          string, y cruzada con la geometria da la posicion de cada tracker en su linea electrica —
          el ultimo dato que la app hoy tiene que asumir.
        </p>
        <label className="drop">
          <input
            type="file"
            accept=".xlsx,.xls,.xlsm,.csv"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); }}
          />
          <strong>Elegir archivo</strong>
          <span className="muted">{fileName || ".xlsx · .csv"}</span>
        </label>
        {error && <p className="alert">{error}</p>}
      </section>

      {sheet && (
        <section className="card">
          <h2>Que es cada columna</h2>

          <div className="row">
            {sheets.length > 1 && (
              <label className="inline">Hoja
                <select value={sheetIndex} onChange={(e) => {
                  const i = Number(e.target.value);
                  setSheetIndex(i);
                  setMapping(suggestStringMapping(sheets[i]!.headers));
                }}>
                  {sheets.map((s, i) => (<option key={s.name} value={i}>{s.name} — {s.rows.length}</option>))}
                </select>
              </label>
            )}
            <label className="inline">Fila de encabezados
              <input
                type="number" min={1} max={10} value={headerRow}
                onChange={async (e) => {
                  const v = Math.max(1, Number(e.target.value) || 1);
                  setHeaderRow(v);
                  if (buffer) await abrir(buffer, v);
                }}
              />
            </label>
          </div>
          <p className="help">
            Algunas planillas traen dos filas de titulo antes de los encabezados. Si los nombres de
            abajo se ven raros, subile uno a este numero.
          </p>

          <div className="grid-2">
            {CAMPOS.map((c) => (
              <div className="field" key={c.key}>
                <label htmlFor={`sl-${c.key}`}>
                  {c.label}
                  {c.req ? <em className="req"> obligatorio</em> : <em className="opt"> opcional</em>}
                </label>
                <select
                  id={`sl-${c.key}`}
                  value={mapping[c.key] ?? ""}
                  onChange={(e) => setMapping((m) => ({ ...m, [c.key]: e.target.value || undefined }))}
                >
                  <option value="">— sin asignar —</option>
                  {sheet.headers.map((h) => (<option key={h} value={h}>{h}</option>))}
                </select>
                <span className="help">{c.help}</span>
              </div>
            ))}
          </div>

          {mapping.dcBox && (
            <label className="check">
              <input type="checkbox" checked={rellenar} onChange={(e) => setRellenar(e.target.checked)} />
              <span>
                Rellenar hacia abajo la caja DC
                <em>
                  En estas planillas la caja suele estar combinada sobre muchas filas y solo aparece
                  en la primera de cada bloque. Sin esto, casi todos los strings quedan sin caja.
                </em>
              </span>
            </label>
          )}
        </section>
      )}

      {match && entries && (
        <section className="card">
          <h2>Cuanto cruzo</h2>
          <div className="stats">
            <div><b>{entries.length}</b><span>strings leidos</span></div>
            <div><b>{match.report.matched}</b><span>cruzados</span></div>
            <div className={cobertura < 90 ? "alerta" : ""}>
              <b>{cobertura} %</b><span>de las filas</span>
            </div>
          </div>
          <p className="muted small">
            Cruzados por <strong>{match.report.strategy}</strong>, que fue la forma que mas matcheo
            de las que probe.
          </p>

          {match.report.strategy.includes("orden de fila") && (
            <div className="field">
              <h3>Cual fila del tracker es la motorizada</h3>
              <p className="help">
                Este archivo numera las filas de corrido por bloque — el tracker 33 tiene la R1, el
                34 la R2 y la R3, el 35 la R4 y la R5 — asi que no hay lista de R que valga para
                todo el parque. Lo que si se mantiene es el orden adentro de cada tracker, y con eso
                alcanza. Solo hace falta saber para que lado va.
              </p>
              <select
                id="sl-orden"
                value={orden}
                onChange={(e) => setOrden(e.target.value as typeof orden)}
              >
                <option value="lowest-first">La de numero mas bajo (R2 de R2/R3)</option>
                <option value="highest-first">La de numero mas alto (R3 de R2/R3)</option>
              </select>
              <span className="help">
                Si no estas seguro, dejalo como esta, aplicalo, y verificalo en el campo: parate en
                un tracker, mira cual de las dos filas tiene el motor, y localiza un modulo de esa
                fila. Si te devuelve la otra, volve aca y dalo vuelta.
              </span>
            </div>
          )}

          {match.report.preview.length > 0 && (
            <div className="tablewrap">
              <h3>Asi entendi cada lado</h3>
              <p className="help">
                Arriba, como viene escrito el tracker en la lista de strings. Al lado, como lo
                interprete. Abajo, como esta en la geometria. Si las dos ultimas columnas no hablan
                el mismo idioma, ahi esta el problema.
              </p>
              <table>
                <thead>
                  <tr><th>En el archivo</th><th>Lo entendi como</th><th>En la geometria</th></tr>
                </thead>
                <tbody>
                  {match.report.preview.map((p, i) => (
                    <tr key={i}>
                      <td><code>{p.desde}</code></td>
                      <td>{p.entendido}</td>
                      <td>{p.geometria}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {match.report.unmatchedExamples.length > 0 && (
            <div className="warnbox">
              <h3>{entries.length - match.report.matched} sin cruzar</h3>
              <ul>
                {match.report.unmatchedExamples.map((e, i) => (<li key={i}><code>{e}</code></li>))}
              </ul>
              <p>
                Si son muchos, suele ser que el archivo escribe el tracker distinto que la planilla
                de coordenadas. Fijate si falta asignar la columna de fila.
              </p>
            </div>
          )}
        </section>
      )}

      {campos.length > 0 && (
        <section className="card">
          <h2>Cual numero es el string</h2>
          <p>
            Una etiqueta como <code>S-1.2.15.2</code> tiene varios numeros y solo uno identifica al
            string dentro de su fila. Eligelo mirando los valores de cada uno: el del string toma
            pocos valores distintos y bajos.
          </p>
          <div className="tablewrap">
            <table>
              <thead><tr><th></th><th>Campo</th><th>Valores distintos</th><th>Ejemplos</th></tr></thead>
              <tbody>
                {campos.map((c) => (
                  <tr key={c.index}>
                    <td>
                      <input
                        type="radio" name="campo" checked={campoElegido === c.index}
                        onChange={() => setFieldIndex(c.index)}
                        aria-label={`Campo ${c.index + 1}`}
                      />
                    </td>
                    <td>Campo {c.index + 1}</td>
                    <td>{c.distintos}</td>
                    <td><code>{c.ejemplos.join(", ")}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {chains && chains.reports.length > 0 && (
        <section className="card">
          <h2>Las lineas electricas</h2>
          <p>
            Los trackers que cuelgan de una misma caja DC pueden estar <strong>en cadena</strong>,
            uno atras del otro con conectores entre ellos, o <strong>en paralelo</strong>, uno al
            lado del otro. Significan cosas opuestas para el conteo, asi que en vez de suponerlo lo
            mido en las coordenadas.
          </p>

          <div className="stats">
            <div><b>{enCadena}</b><span>cajas en cadena</span></div>
            <div><b>{paralelas}</b><span>en paralelo</span></div>
            <div className={mixtas ? "alerta" : ""}><b>{mixtas}</b><span>sin decidir</span></div>
          </div>

          <div className="tablewrap">
            <table>
              <thead><tr><th>Caja DC</th><th>Forma</th><th>Que significa</th></tr></thead>
              <tbody>
                {chains.reports.slice(0, 12).map((r) => (
                  <tr key={r.dcBox}>
                    <td><code>{r.dcBox}</code></td>
                    <td>{r.forma}</td>
                    <td>{r.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {chains.reports.length > 12 && (
            <p className="muted small">…y {chains.reports.length - 12} cajas mas.</p>
          )}

          {mixtas > 0 && (
            <div className="warnbox">
              <p>
                Hay {mixtas} caja(s) que no caen ni claramente en cadena ni claramente en paralelo.
                A esos trackers no les asigno posicion, asi que su string lejano va a seguir
                asumiendo que no invierte. Mandame la tabla si querés que las miremos.
              </p>
            </div>
          )}

          <div className="actions">
            <button className="ghost" onClick={onCancel}>Cancelar</button>
            <button onClick={() => void aplicar()} disabled={guardado}>
              {guardado ? "Aplicado" : "Aplicar al parque"}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
