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
import type { TrackerRow } from "@locator";

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

  /**
   * Las columnas que pueden venir COMBINADAS en estas planillas.
   *
   * Se rellenaba hacia abajo solo la caja DC. Pero en la lista de strings de
   * Wellington la celda del TRACKER tambien esta combinada —sobre dos filas,
   * porque cada fila de modulos lleva dos strings— y `readEntries` descarta las
   * filas sin tracker. Resultado: de 26792 strings se leian 13606, exactamente
   * la mitad, y la pantalla decia "13606 strings leidos" como si eso fuera el
   * archivo entero. Media lista tirada sin un solo aviso.
   *
   * Las coordenadas nunca entran acá: copiar la de arriba pondria dos trackers
   * en el mismo lugar. En esta pantalla no hay coordenadas, pero la regla vale
   * igual — se rellenan las columnas de identidad, no las de medida.
   */
  const columnasCombinables = [mapping.tracker, mapping.row, mapping.dcBox]
    .filter((c): c is string => !!c);

  const entries = useMemo(() => {
    if (!sheet || !mapping.label || !mapping.tracker) return null;
    const usable = rellenar && columnasCombinables.length
      ? forwardFill(sheet, columnasCombinables)
      : sheet;
    return readEntries(usable, mapping);
  }, [sheet, mapping, rellenar]);

  /**
   * Cuantos strings se recuperan al rellenar. Es el numero que delata una
   * columna combinada, y el que hacia falta ver.
   */
  const sinRellenar = useMemo(
    () => (sheet && mapping.label && mapping.tracker ? readEntries(sheet, mapping).length : 0),
    [sheet, mapping],
  );

  const match = useMemo(
    () =>
      entries?.length
        ? matchEntries(entries, farm.rows, {
            naming: { ...farm.profile.topology.rowNaming, orderWithinTracker: orden },
          })
        : null,
    [entries, farm.rows, farm.profile.topology.rowNaming, orden],
  );

  /**
   * Lo mismo, con la otra opcion de orden. Sirve para MOSTRAR la diferencia.
   *
   * La pregunta "cual fila del tracker es la motorizada" no se puede deducir de
   * las coordenadas, asi que hay que hacerla. Pero preguntar "¿la de numero mas
   * bajo o la mas alto?" y nada mas obliga a razonar en abstracto sobre un
   * archivo de 13000 lineas. Lo que se puede hacer —y no se hacia— es mostrar
   * QUE CAMBIA: los strings concretos que le tocan a cada fila con una opcion y
   * con la otra. Elegir pasa a ser reconocer, no adivinar.
   */
  const otroOrden = orden === "lowest-first" ? "highest-first" : "lowest-first";
  const matchOtro = useMemo(
    () =>
      entries?.length
        ? matchEntries(entries, farm.rows, {
            naming: { ...farm.profile.topology.rowNaming, orderWithinTracker: otroOrden },
          })
        : null,
    [entries, farm.rows, farm.profile.topology.rowNaming, otroOrden],
  );

  /**
   * Un tracker de ejemplo con sus dos filas, y que strings le tocan a cada una
   * con cada opcion. Se elige uno que tenga las dos filas cruzadas, para que la
   * comparacion se vea.
   */
  const comparacion = useMemo(() => {
    if (!match || !matchOtro) return null;
    const porTracker = new Map<string, TrackerRow[]>();
    for (const r of farm.rows) {
      const k = `${r.block}|${r.tracker}`;
      porTracker.set(k, [...(porTracker.get(k) ?? []), r]);
    }
    for (const [, filas] of porTracker) {
      if (filas.length < 2) continue;
      const a = filas.map((f) => match.byRow.get(f.id)?.labels ?? []);
      const b = filas.map((f) => matchOtro.byRow.get(f.id)?.labels ?? []);
      if (!a.every((x) => x.length) || !b.every((x) => x.length)) continue;
      // Solo sirve si las dos opciones dan resultados distintos.
      if (JSON.stringify(a) === JSON.stringify(b)) continue;
      return {
        tracker: `${filas[0]!.block}-${filas[0]!.tracker}`,
        filas: filas.map((f, i) => ({
          nombre: f.row ?? f.id,
          conEsta: a[i]!.slice(0, 2),
          conLaOtra: b[i]!.slice(0, 2),
        })),
      };
    }
    return null;
  }, [match, matchOtro, farm.rows]);

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

          {columnasCombinables.length > 0 && (
            <label className="check">
              <input type="checkbox" checked={rellenar} onChange={(e) => setRellenar(e.target.checked)} />
              <span>
                Rellenar hacia abajo las celdas combinadas
                <em>
                  En estas planillas el tracker y la caja DC suelen estar combinados sobre varias
                  filas y solo aparecen en la primera. Sin esto, las filas de abajo quedan sin ese
                  dato — y las que quedan sin tracker se descartan enteras.
                </em>
              </span>
            </label>
          )}

          {/*
            El numero que delata la columna combinada. Sin esto, "13606 strings
            leidos" sobre un archivo de 26792 se lee como si fuera el archivo
            entero.
          */}
          {entries && rellenar && entries.length > sinRellenar && (
            <p className="note ok">
              La columna de tracker viene combinada: sin rellenar hacia abajo se leerian{" "}
              <strong>{sinRellenar}</strong> strings y rellenando se leen{" "}
              <strong>{entries.length}</strong>. Los {entries.length - sinRellenar} de diferencia
              son los que la planilla escribe debajo de la celda combinada.
            </p>
          )}
        </section>
      )}

      {/*
        Sin estas columnas la pantalla se quedaba muda: no aparecia la tarjeta
        de resultados, no aparecia el boton de aplicar, y no habia una sola
        linea que dijera que faltaba. Se probaba de nuevo con otro archivo
        creyendo que el archivo estaba mal.
      */}
      {sheet && !entries && (
        <p className="note bad">
          Faltan asignar{" "}
          <strong>
            {[!mapping.label && "Etiqueta del string", !mapping.tracker && "Tracker"]
              .filter(Boolean)
              .join(" y ")}
          </strong>
          . Sin eso no se puede cruzar nada con el parque.
        </p>
      )}

      {sheet && entries && !mapping.dcBox && (
        <p className="note">
          No asignaste la columna de <strong>caja DC</strong>. Los strings se van a cruzar igual,
          pero sin la caja no se puede saber que trackers cuelgan de la misma linea — y eso es lo
          que decide si el string lejano cuenta al reves. Los numeros de modulo del string lejano
          van a quedar como si no invirtiera.
        </p>
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
                Esto NO se puede deducir de las coordenadas: las dos opciones dan una geometria
                igual de consistente, con todas las motorizadas del mismo lado de su par, solo que
                del otro lado. Hay que declararlo, una sola vez por parque.
              </span>

              {/*
                Que CAMBIA, con strings de verdad.
                =================================================================
                Preguntar "¿la de numero mas bajo o la mas alto?" y nada mas
                obliga a razonar en abstracto sobre un archivo de miles de
                lineas. Con la tabla, elegir pasa a ser reconocer: se mira un
                tracker, se ve que string le toca a la fila motorizada con cada
                opcion, y se compara contra el plano o contra el tracker.
              */}
              {comparacion ? (
                <>
                  <p className="help">
                    <strong>Que cambia.</strong> En el tracker{" "}
                    <code>{comparacion.tracker}</code>, los strings quedan asi:
                  </p>
                  <div className="tablewrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Fila</th>
                          <th>Con lo elegido ahora</th>
                          <th>Con la otra opcion</th>
                        </tr>
                      </thead>
                      <tbody>
                        {comparacion.filas.map((f) => (
                          <tr key={f.nombre}>
                            <td>{f.nombre}</td>
                            <td>{f.conEsta.map((x) => (<code key={x}>{x}</code>))}</td>
                            <td className="muted">{f.conLaOtra.map((x) => (<code key={x}>{x}</code>))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="help">
                    <strong>Como saber cual es.</strong> Si tenés el plano de interconexion a mano,
                    buscá el tracker <code>{comparacion.tracker}</code> y fijate que string le toca
                    a la fila con motor. Si no, se resuelve en el campo en un minuto: parate en ese
                    tracker, mirá cuál de las dos filas tiene el motor, y en la pantalla de
                    Localizar comprobá que el string que te da sea el de esa fila. Si sale el otro,
                    volvé acá y cambiá esta opcion.
                  </p>
                  <p className="help muted">
                    Si te equivocás, no se rompe nada: la app te manda a la fila de al lado del
                    mismo tracker —unos metros— con el numero de string del par. Se corrige cambiando
                    esta opcion y volviendo a aplicar la lista.
                  </p>
                </>
              ) : (
                <p className="help">
                  Con este archivo las dos opciones dan el mismo resultado, asi que da igual cual
                  elijas.
                </p>
              )}

              {match.report.pairing && match.report.pairing.length > 0 && (
                <>
                  <p className="help">Asi quedaron asignadas las filas con lo que esta elegido:</p>
                  <ul className="pairs">
                    {match.report.pairing.map((p) => (
                      <li key={p.tracker}>
                        <span className="muted">{p.tracker}</span>{" "}
                        {p.pares.map((x) => (<code key={x}>{x}</code>))}
                      </li>
                    ))}
                  </ul>
                </>
              )}
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
