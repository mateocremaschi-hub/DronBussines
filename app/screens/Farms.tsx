/** Lista de parques cargados en este dispositivo. */

import { deleteFarm, downloadFarm, saveFarm, type StoredFarm } from "../storage";

interface Props {
  farms: StoredFarm[];
  onNew: () => void;
  onOpen: (farm: StoredFarm) => void;
  onInspect: (farm: StoredFarm) => void;
  onAddGeometry: (farm: StoredFarm) => void;
  onStrings: (farm: StoredFarm) => void;
  onVendor: (farm: StoredFarm) => void;
  onFlight: (farm: StoredFarm) => void;
  onAnalysis: (farm: StoredFarm) => void;
  onWarranty: (farm: StoredFarm) => void;
  onChanged: () => void;
}

export function Farms({ farms, onNew, onOpen, onInspect, onAddGeometry, onStrings, onVendor, onFlight, onAnalysis, onWarranty, onChanged }: Props) {
  async function importFarm(file: File) {
    const text = await file.text();
    const farm = JSON.parse(text) as StoredFarm;
    await saveFarm(farm);
    onChanged();
  }

  return (
    <div className="screen">
      <header className="screen-head">
        <div>
          <p className="eyebrow">Pica</p>
          <h1>Parques</h1>
        </div>
        <button onClick={onNew}>Nuevo parque</button>
      </header>

      {farms.length === 0 ? (
        <section className="card empty">
          <h2>Todavia no hay ningun parque cargado</h2>
          <p>
            Un parque se da de alta una sola vez: cargas el archivo de coordenadas que te dio el
            cliente, confirmas que la app entendio bien las columnas, y queda listo para usar en el
            campo desde cualquier dispositivo.
          </p>
          <button onClick={onNew}>Cargar el primero</button>
        </section>
      ) : (
        <ul className="farms">
          {farms.map((f) => {
            const verified = f.profile.calibration?.status === "field-verified";
            const conStrings = f.rows.filter((r) => r.stringNumbers?.length).length;
            const conLinea = f.rows.filter((r) => r.pos != null && r.posTotal != null).length;
            const pct = (n: number) => Math.round((n / Math.max(1, f.rows.length)) * 100);
            return (
              <li key={f.profile.id}>
                <button className="farm-open" onClick={() => onOpen(f)}>
                  <strong>{f.profile.name}</strong>
                  <span className="mono">
                    {f.rows.length} filas en {new Set(f.rows.map((r) => r.block)).size} bloques ·{" "}
                    {f.profile.topology.modulesPerString} × {f.profile.topology.stringsPerRow} modulos por fila
                  </span>
                  <span className="mono muted">
                    paso {f.profile.module.widthMm + f.profile.module.gapMm} mm · bahia{" "}
                    {f.profile.topology.stringGapMm ?? 0} mm · offset{" "}
                    {f.profile.geometry.endpointOffsetMm} mm
                  </span>
                  <span className="mono muted">
                    {pct(conStrings)} % con numero de string · {pct(conLinea)} % con posicion en la linea
                  </span>
                  <span className={verified ? "chip ver" : "chip asm"}>
                    {verified ? "verificado en campo" : "sin verificar"}
                  </span>
                </button>
                <div className="farm-actions">
                  <button className="link" onClick={() => onFlight(f)}>Planificar vuelo</button>
                  <button className="link" onClick={() => onAnalysis(f)}>Analizar un vuelo</button>
                  <button className="link" onClick={() => onWarranty(f)}>Garantias</button>
                  <button className="link" onClick={() => onInspect(f)}>Inspecciones</button>
                  <button className="link" onClick={() => onAddGeometry(f)}>Agregar geometria</button>
                  <button className="link" onClick={() => onStrings(f)}>Lista de strings</button>
                  <button className="link" onClick={() => onVendor(f)}>Auditar un informe</button>
                  <button className="link" onClick={() => downloadFarm(f)}>Exportar</button>
                  <button
                    className="link danger"
                    onClick={async () => {
                      if (confirm(`¿Borrar "${f.profile.name}" de este dispositivo?`)) {
                        await deleteFarm(f.profile.id);
                        onChanged();
                      }
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

      <label className="import">
        Importar un parque exportado desde otro dispositivo
        <input
          type="file"
          accept=".json"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void importFarm(f); }}
        />
      </label>
    </div>
  );
}
