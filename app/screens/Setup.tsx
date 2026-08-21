/**
 * Alta de un parque nuevo.
 *
 * Cuatro pasos: archivo, columnas, parametros, revision. En cada uno la app
 * muestra lo que entendio y te deja corregirlo. Nada se aplica en silencio.
 */

import { useMemo, useState } from "react";
import { compileFarm, ProfileError } from "@locator";
import type { CompiledFarm, FarmProfile, TrackerRow } from "@locator";
import {
  buildRows,
  capabilityReport,
  FIELDS,
  guessCrs,
  readWorkbook,
  suggestEndpointOffsetMm,
  suggestMapping,
  toNumber,
  type Crs,
  type Mapping,
  type Sheet,
} from "../ingest";
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
    note: "Las reglas verificadas en campo en Edenvale. Conteo desde la caja DC y regla del piercing connector.",
    profile: {
      module: { widthMm: 1130, gapMm: 20, orientation: "portrait", pitchMm: null },
      topology: { modulesPerString: 28, stringsPerRow: 2 },
      geometry: { source: "survey-stakes", endpointOffsetMm: 1400, endpointOffsetMode: "both" },
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
    label: "Generico — un string por fila, conteo desde el norte",
    note: "El punto de partida mas seguro cuando todavia no conoces las reglas del parque. No inventa nada.",
    profile: {
      module: { widthMm: 1130, gapMm: 20, orientation: "portrait", pitchMm: "derive" },
      topology: { modulesPerString: 28, stringsPerRow: 1 },
      geometry: { source: "survey-stakes", endpointOffsetMm: 0, endpointOffsetMode: "none" },
      addressing: { originStrategy: "fixed-end", fixedEnd: "north", inversionStrategy: "none" },
      matching: { maxDistanceM: 30, neighborhood: 2, maxRowCandidates: 3, defaultAccuracyM: 3 },
    },
  },
];

const slug = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "parque";

// ---------------------------------------------------------------------------

export function Setup({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [step, setStep] = useState(1);
  const [error, setError] = useState<string | null>(null);

  const [fileName, setFileName] = useState("");
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [mapping, setMapping] = useState<Mapping>({});
  const [crs, setCrs] = useState<Crs>({ type: "wgs84" });

  const [name, setName] = useState("");
  const [presetId, setPresetId] = useState(PRESETS[0]!.id);
  const [profileDraft, setProfileDraft] = useState(PRESETS[0]!.profile);

  const sheet = sheets[sheetIndex];

  // -------------------------------------------------------------------------

  async function onFile(file: File) {
    setError(null);
    try {
      const parsed = await readWorkbook(await file.arrayBuffer());
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
      if (!name) setName(file.name.replace(/\.[^.]+$/, ""));
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
    setCrs(guessCrs(samples));
  }

  // -------------------------------------------------------------------------

  const built = useMemo(() => {
    if (!sheet) return null;
    const required = FIELDS.filter((f) => f.required);
    if (required.some((f) => !mapping[f.key])) return null;
    return buildRows(sheet, mapping, crs);
  }, [sheet, mapping, crs]);

  // El largo real de las filas despeja el offset de pica: las tres cantidades
  // (modulos, paso, offset) estan atadas, asi que conociendo dos sale la tercera.
  const modulesPerRowDraft =
    profileDraft.topology.modulesPerString * profileDraft.topology.stringsPerRow;
  const nominalPitchMm = profileDraft.module.widthMm + profileDraft.module.gapMm;
  const offsetHint = useMemo(
    () =>
      built?.rows.length
        ? suggestEndpointOffsetMm(built.rows, modulesPerRowDraft, nominalPitchMm)
        : null,
    [built, modulesPerRowDraft, nominalPitchMm],
  );

  const profile: FarmProfile = useMemo(
    () => ({
      id: slug(name),
      name: name || "Parque sin nombre",
      profileVersion: 1,
      crs: crs.type === "utm" ? { type: "utm", zone: crs.zone, hemisphere: crs.hemisphere } : { type: "wgs84" },
      ...profileDraft,
      calibration: {
        status: "unverified",
        notes: "Perfil creado desde el asistente. Ninguna regla verificada en campo todavia.",
      },
    }),
    [name, crs, profileDraft],
  );

  const compiled: { farm: CompiledFarm } | { err: string } | null = useMemo(() => {
    if (!built || !built.rows.length) return null;
    try {
      return { farm: compileFarm(profile, built.rows) };
    } catch (e) {
      if (e instanceof ProfileError) return { err: e.issues.join(" · ") };
      return { err: e instanceof Error ? e.message : String(e) };
    }
  }, [built, profile]);

  const farm = compiled && "farm" in compiled ? compiled.farm : null;

  async function save() {
    if (!farm || !built) return;
    const stored: StoredFarm = {
      profile,
      rows: built.rows,
      savedAt: new Date().toISOString(),
      source: { fileName, sheetName: sheet?.name ?? "", rowCount: built.rows.length },
    };
    await saveFarm(stored);
    onDone();
  }

  // -------------------------------------------------------------------------

  return (
    <div className="screen">
      <header className="screen-head">
        <div>
          <p className="eyebrow">Nuevo parque</p>
          <h1>Cargar los datos que tengas</h1>
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
          <p>
            Un Excel o CSV donde cada fila sea un tracker con las coordenadas de sus dos picas.
            Sirven grados decimales o UTM: la app se da cuenta sola y despues te lo muestra para
            que lo confirmes.
          </p>
          <label className="drop">
            <input
              type="file"
              accept=".xlsx,.xls,.xlsm,.csv,.tsv"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); }}
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
                setCrs(e.target.value === "utm" ? { type: "utm", zone: 56, hemisphere: "S" } : { type: "wgs84" })
              }
            >
              <option value="wgs84">Grados decimales (lat / lon)</option>
              <option value="utm">UTM (metros)</option>
            </select>
            {crs.type === "utm" && (
              <>
                <label className="inline">Zona
                  <input
                    type="number" min={1} max={60} value={crs.zone}
                    onChange={(e) => setCrs({ ...crs, zone: Number(e.target.value) })}
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
                              Van seguidas, de la {s.firstRow} a la {s.lastRow} — si estan al final
                              del archivo suele ser una tabla de totales y no te falta nada.
                            </>
                          ) : (
                            <>
                              Desparramadas entre la fila {s.firstRow} y la {s.lastRow} — eso si son
                              datos incompletos y conviene mirarlas en el Excel.
                            </>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </>
          )}
          {!built && <p className="note bad">Falta asignar alguna columna obligatoria.</p>}

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

          <div className="field">
            <label>Nombre del parque</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Edenvale Solar Farm" />
            <span className="help">El identificador interno va a ser <code>{slug(name)}</code>.</span>
          </div>

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
            <div className="field">
              <label>Strings por fila</label>
              <input
                type="number" min={1} value={profileDraft.topology.stringsPerRow}
                onChange={(e) => setProfileDraft((d) => ({
                  ...d, topology: { ...d.topology, stringsPerRow: Number(e.target.value) },
                }))}
              />
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
            </div>
            <div className="field">
              <label>Hueco entre modulos (mm)</label>
              <input
                type="number" min={0} value={profileDraft.module.gapMm}
                onChange={(e) => setProfileDraft((d) => ({
                  ...d, module: { ...d.module, gapMm: Number(e.target.value) },
                }))}
              />
            </div>
            <div className="field">
              <label>Distancia de la pica al primer modulo (mm)</label>
              <input
                type="number" min={0} value={profileDraft.geometry.endpointOffsetMm}
                onChange={(e) => setProfileDraft((d) => ({
                  ...d, geometry: { ...d.geometry, endpointOffsetMm: Number(e.target.value) },
                }))}
              />
              {offsetHint && (
                <span className="help">
                  Tus filas miden <strong>{offsetHint.medianLengthM.toFixed(2)} m</strong> de pica a
                  pica. Con {modulesPerRowDraft} modulos de {nominalPitchMm} mm, eso deja{" "}
                  <strong>{offsetHint.offsetMm.toFixed(0)} mm</strong> por punta.
                  {Math.abs(offsetHint.offsetMm - profileDraft.geometry.endpointOffsetMm) > 50 && (
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
            </div>
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
          <div className="grid-2">
            <div className="field">
              <label>Desde que punta se cuenta el modulo 1</label>
              <select
                value={profileDraft.addressing.originStrategy}
                onChange={(e) => setProfileDraft((d) => ({
                  ...d,
                  addressing: { ...d.addressing, originStrategy: e.target.value as never },
                }))}
              >
                <option value="fixed-end">Siempre desde el mismo extremo geografico</option>
                <option value="dc-box-end">Desde la caja DC de la fila</option>
                <option value="per-row-flag">Un dato explicito por fila</option>
              </select>
            </div>
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
            <button className="ghost" onClick={() => setStep(2)}>Atras</button>
            <button disabled={!name.trim()} onClick={() => setStep(4)}>Siguiente</button>
          </div>
        </section>
      )}

      {/* ---------------------------------------------------------------- */}
      {step === 4 && (
        <section className="card">
          <h2>4 · Revision</h2>

          {compiled && "err" in compiled && <p className="alert">{compiled.err}</p>}

          {farm && (
            <>
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
                {capabilityReport(built!.rows, profile).map((c) => (
                  <li key={c.label} className={c.available ? "yes" : "no"}>
                    <strong>{c.label}</strong>
                    <span>{c.detail}</span>
                  </li>
                ))}
              </ul>

              <div className="actions">
                <button className="ghost" onClick={() => setStep(3)}>Atras</button>
                <button onClick={() => void save()}>Guardar el parque</button>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}
