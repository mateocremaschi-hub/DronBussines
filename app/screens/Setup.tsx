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
  deriveSides,
  FIELDS,
  guessCrs,
  mergeRows,
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
    note: "Las reglas verificadas en campo en Edenvale: bahia de motor entre strings, la pica adentro del recorrido, conteo desde la caja DC y regla del piercing connector.",
    profile: {
      module: { widthMm: 1130, gapMm: 20, orientation: "portrait", pitchMm: null },
      topology: { modulesPerString: 28, stringsPerRow: 2, stringGapMm: 3713 },
      geometry: { source: "survey-stakes", endpointOffsetMm: -1464, endpointOffsetMode: "both" },
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
      topology: { modulesPerString: 28, stringsPerRow: 1, stringGapMm: 0 },
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

interface SetupProps {
  onDone: () => void;
  onCancel: () => void;
  /** Si viene, en vez de crear un parque se le agrega geometria a este. */
  existing?: StoredFarm;
}

export function Setup({ onDone, onCancel, existing }: SetupProps) {
  const [step, setStep] = useState(1);
  const [error, setError] = useState<string | null>(null);

  const [fileName, setFileName] = useState("");
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [mapping, setMapping] = useState<Mapping>({});
  const [crs, setCrs] = useState<Crs>({ type: "wgs84" });

  const [deriveSide, setDeriveSide] = useState(false);
  const [name, setName] = useState(existing?.profile.name ?? "");
  const [presetId, setPresetId] = useState(PRESETS[0]!.id);
  // Al agregarle geometria a un parque que ya existe se arranca de SU perfil,
  // no de un preset: ese perfil ya esta calibrado y pisarlo con los valores por
  // defecto seria tirar a la basura las medidas de campo.
  const [profileDraft, setProfileDraft] = useState(
    existing
      ? {
          module: existing.profile.module,
          topology: existing.profile.topology,
          geometry: existing.profile.geometry,
          addressing: existing.profile.addressing,
          matching: existing.profile.matching,
        }
      : PRESETS[0]!.profile,
  );

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
      if (!name && !existing) setName(file.name.replace(/\.[^.]+$/, ""));
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

  const rawBuilt = useMemo(() => {
    if (!sheet) return null;
    const required = FIELDS.filter((f) => f.required);
    if (required.some((f) => !mapping[f.key])) return null;
    return buildRows(sheet, mapping, crs);
  }, [sheet, mapping, crs]);

  // Primero se fusiona con lo que el parque ya tiene, y RECIEN AHI se deduce el
  // lado de la calle. Al reves, un bloque partido entre dos archivos se deduce
  // con la mitad de sus filas — y la mitad de un bloque parece un solo lado.
  const rawMerge = useMemo(
    () => (rawBuilt ? mergeRows(existing?.rows ?? [], rawBuilt.rows) : null),
    [rawBuilt, existing],
  );

  // Si el archivo no trae el lado de la calle, se puede sacar de la geometria:
  // las cajas DC estan en la calle del medio, asi que las filas caen en dos
  // grupos separados por ella. Es opcional y se muestra lo que dedujo.
  const derivation = useMemo(
    () => (deriveSide && rawMerge?.rows.length ? deriveSides(rawMerge.rows) : null),
    [deriveSide, rawMerge],
  );

  const merge = useMemo(() => {
    if (!rawMerge) return null;
    if (!derivation) return rawMerge;
    return {
      ...rawMerge,
      rows: rawMerge.rows.map((r) => {
        const side = derivation.sides.get(r.id);
        return side ? { ...r, side } : r;
      }),
    };
  }, [rawMerge, derivation]);

  // Lo que se muestra en el paso de columnas es siempre lo que entro del archivo.
  const built = rawBuilt;

  // El largo real de las filas despeja el offset de pica: las tres cantidades
  // (modulos, paso, offset) estan atadas, asi que conociendo dos sale la tercera.
  const modulesPerRowDraft =
    profileDraft.topology.modulesPerString * profileDraft.topology.stringsPerRow;
  const nominalPitchMm = profileDraft.module.widthMm + profileDraft.module.gapMm;
  const offsetHint = useMemo(
    () =>
      built?.rows.length
        ? suggestEndpointOffsetMm(built.rows, modulesPerRowDraft, nominalPitchMm, {
            moduleGapMm: profileDraft.module.gapMm,
            stringsPerRow: profileDraft.topology.stringsPerRow,
            stringGapMm: profileDraft.topology.stringGapMm ?? 0,
          })
        : null,
    [built, modulesPerRowDraft, nominalPitchMm, profileDraft],
  );

  const profile: FarmProfile = useMemo(
    () => ({
      id: existing?.profile.id ?? slug(name),
      name: name || "Parque sin nombre",
      profileVersion: (existing?.profile.profileVersion ?? 0) + 1,
      crs: crs.type === "utm" ? { type: "utm", zone: crs.zone, hemisphere: crs.hemisphere } : { type: "wgs84" },
      ...profileDraft,
      calibration: existing?.profile.calibration ?? {
        status: "unverified",
        notes: "Perfil creado desde el asistente. Ninguna regla verificada en campo todavia.",
      },
    }),
    [name, crs, profileDraft, existing],
  );

  const compiled: { farm: CompiledFarm } | { err: string } | null = useMemo(() => {
    if (!built || !built.rows.length || !merge) return null;
    try {
      return { farm: compileFarm(profile, merge.rows) };
    } catch (e) {
      if (e instanceof ProfileError) return { err: e.issues.join(" · ") };
      return { err: e instanceof Error ? e.message : String(e) };
    }
  }, [merge, built, profile]);

  const farm = compiled && "farm" in compiled ? compiled.farm : null;

  async function save() {
    if (!farm || !built || !merge) return;
    const stored: StoredFarm = {
      profile,
      rows: merge.rows,
      savedAt: new Date().toISOString(),
      source: { fileName, sheetName: sheet?.name ?? "", rowCount: merge.rows.length },
    };
    await saveFarm(stored);
    onDone();
  }

  // -------------------------------------------------------------------------

  return (
    <div className="screen">
      <header className="screen-head">
        <div>
          <p className="eyebrow">{existing ? existing.profile.name : "Nuevo parque"}</p>
          <h1>{existing ? "Agregar mas geometria" : "Cargar los datos que tengas"}</h1>
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
          {existing && (
            <p className="note ok">
              Este parque ya tiene <strong>{existing.rows.length} filas</strong>. Lo que cargues se
              suma a eso: las filas nuevas se agregan y las que ya existan se actualizan. Los
              parametros de geometria que ya calibraste no se tocan.
            </p>
          )}
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

          {!mapping.side && (
            <>
              <h3>El lado de la calle</h3>
              <label className="check">
                <input
                  type="checkbox"
                  checked={deriveSide}
                  onChange={(e) => setDeriveSide(e.target.checked)}
                />
                <span>
                  Deducirlo de la geometria
                  <em>
                    El archivo no trae columna de lado. Sin ese dato, el conteo desde la caja DC
                    elige una punta al azar en cada fila: le pega en la mitad de los trackers y sale
                    espejado en la otra mitad. Como las cajas estan en la calle del medio, las filas
                    caen en dos grupos separados por ella — y eso si se puede leer de las
                    coordenadas.
                  </em>
                </span>
              </label>

              {derivation && (
                <div className={derivation.blocks.some((b) => b.status !== "dos-lados") ? "warnbox" : "note ok"}>
                  <ul className="derive">
                    {derivation.blocks.map((b) => (
                      <li key={b.block} className={b.status === "dos-lados" ? "yes" : "no"}>
                        <strong>Bloque {b.block}</strong> — {b.detail}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}

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
                              Van seguidas, de la {s.firstRow} a la {s.lastRow}.
                            </>
                          ) : (
                            <>
                              Desparramadas entre la fila {s.firstRow} y la {s.lastRow} — eso si son
                              datos incompletos y conviene mirarlas en el Excel.
                            </>
                          )}
                          <ul className="muestra">
                            {s.sample.map((m) => (
                              <li key={m.row}>
                                <span className="mono">fila {m.row}</span> {m.cells}
                              </li>
                            ))}
                          </ul>
                          <span className="muted small">
                            Si ahi no hay ningun tracker de verdad, no te falta nada.
                          </span>
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

          {!existing && (
            <div className="field">
              <label htmlFor="farm-name">Nombre del parque</label>
              <input
                id="farm-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ej: Edenvale Solar Farm"
              />
              <span className="help">El identificador interno va a ser <code>{slug(name)}</code>.</span>
            </div>
          )}

          <div className="field" hidden={!!existing}>
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
              <label>Bahia entre strings (mm)</label>
              <input
                type="number" min={0} value={profileDraft.topology.stringGapMm ?? 0}
                onChange={(e) => setProfileDraft((d) => ({
                  ...d, topology: { ...d.topology, stringGapMm: Number(e.target.value) },
                }))}
              />
              <span className="help">
                El espacio libre donde va el motor, entre un string y el siguiente. No es el
                huequito entre modulos. En Edenvale son 3713 mm — mas de tres posiciones de modulo
                vacias, y olvidarlo corre el string lejano esa distancia entera.
              </span>
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
                type="number" value={profileDraft.geometry.endpointOffsetMm}
                onChange={(e) => setProfileDraft((d) => ({
                  ...d, geometry: { ...d.geometry, endpointOffsetMm: Number(e.target.value) },
                }))}
              />
              {offsetHint && (
                <span className="help">
                  Tus filas miden <strong>{offsetHint.medianLengthM.toFixed(2)} m</strong> de pica a
                  pica. Con {modulesPerRowDraft} modulos de {nominalPitchMm} mm, eso deja{" "}
                  <strong>{offsetHint.offsetMm.toFixed(0)} mm</strong> por punta
                  {offsetHint.offsetMm < 0 ? " (negativo: los modulos sobresalen mas alla de la pica)" : ""}.
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

          {farm && merge && (
            <>
              {existing && merge.colisiones.length > 0 && (
                <div className="warnbox">
                  <h3>{merge.colisiones.length} filas se pisan entre archivos</h3>
                  <p>
                    Tienen el mismo identificador que una que ya estaba, pero estan a cientos de
                    metros de distancia. Casi siempre significa que los dos archivos numeran
                    bloques distintos con el mismo numero.
                  </p>
                  <ul>
                    {merge.colisiones.slice(0, 5).map((c) => (
                      <li key={c.id}>
                        <code>{c.id}</code> — la version nueva esta a{" "}
                        <strong>{c.distanciaM.toFixed(0)} m</strong> de la vieja
                      </li>
                    ))}
                  </ul>
                  <p>
                    Si segues, la geometria vieja de esas filas se pierde. Conviene renombrar los
                    bloques de uno de los dos archivos antes de cargarlo.
                  </p>
                </div>
              )}
              {existing && (
                <p className="note ok">
                  {merge.nuevas} filas nuevas
                  {merge.repetidas > 0 && `, ${merge.repetidas} que ya estaban y se actualizan`}
                  {" "}· el parque queda con <strong>{merge.rows.length}</strong> filas en total.
                </p>
              )}
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
                {capabilityReport(merge.rows, profile).map((c) => (
                  <li key={c.label} className={c.available ? "yes" : "no"}>
                    <strong>{c.label}</strong>
                    <span>{c.detail}</span>
                  </li>
                ))}
              </ul>

              <div className="actions">
                <button className="ghost" onClick={() => setStep(3)}>Atras</button>
                <button onClick={() => void save()}>
                  {existing ? "Agregar al parque" : "Guardar el parque"}
                </button>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}
