/** Lista de parques cargados en este dispositivo. */

import { deleteFarm, downloadFarm, saveFarm, type StoredFarm } from "../storage";

interface Props {
  farms: StoredFarm[];
  onNew: () => void;
  onOpen: (farm: StoredFarm) => void;
  onChanged: () => void;
}

export function Farms({ farms, onNew, onOpen, onChanged }: Props) {
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
            return (
              <li key={f.profile.id}>
                <button className="farm-open" onClick={() => onOpen(f)}>
                  <strong>{f.profile.name}</strong>
                  <span className="mono">
                    {f.rows.length} filas · {f.profile.topology.modulesPerString} ×{" "}
                    {f.profile.topology.stringsPerRow} modulos por fila
                  </span>
                  <span className={verified ? "chip ver" : "chip asm"}>
                    {verified ? "verificado en campo" : "sin verificar"}
                  </span>
                </button>
                <div className="farm-actions">
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
