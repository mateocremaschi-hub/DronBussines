import { useCallback, useEffect, useState } from "react";
import { Farms } from "./screens/Farms";
import { Inspection } from "./screens/Inspection";
import { Locate } from "./screens/Locate";
import { Setup } from "./screens/Setup";
import { StringList } from "./screens/StringList";
import { Vendor } from "./screens/Vendor";
import { Flight } from "./screens/Flight";
import { Analysis } from "./screens/Analysis";
import { listFarms, type StoredFarm } from "./storage";

type View =
  | { name: "farms" }
  | { name: "setup"; existing?: StoredFarm }
  | { name: "locate"; farm: StoredFarm }
  | { name: "inspection"; farm: StoredFarm }
  | { name: "strings"; farm: StoredFarm }
  | { name: "vendor"; farm: StoredFarm }
  | { name: "flight"; farm: StoredFarm }
  | { name: "analysis"; farm: StoredFarm };

export function App() {
  const [farms, setFarms] = useState<StoredFarm[]>([]);
  const [view, setView] = useState<View>({ name: "farms" });
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    setFarms(await listFarms());
    setReady(true);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  if (!ready) return <div className="screen"><p className="muted">Cargando…</p></div>;

  return (
    <div className="app">
      {view.name === "farms" && (
        <Farms
          farms={farms}
          onNew={() => setView({ name: "setup" })}
          onAddGeometry={(farm) => setView({ name: "setup", existing: farm })}
          onStrings={(farm) => setView({ name: "strings", farm })}
          onVendor={(farm) => setView({ name: "vendor", farm })}
          onFlight={(farm) => setView({ name: "flight", farm })}
          onAnalysis={(farm) => setView({ name: "analysis", farm })}
          onOpen={(farm) => setView({ name: "locate", farm })}
          onInspect={(farm) => setView({ name: "inspection", farm })}
          onChanged={() => void refresh()}
        />
      )}
      {view.name === "setup" && (
        <Setup
          {...(view.existing ? { existing: view.existing } : {})}
          onCancel={() => setView({ name: "farms" })}
          onDone={() => { void refresh(); setView({ name: "farms" }); }}
        />
      )}
      {view.name === "locate" && (
        <Locate farm={view.farm} onBack={() => setView({ name: "farms" })} />
      )}
      {view.name === "inspection" && (
        <Inspection farm={view.farm} onBack={() => setView({ name: "farms" })} />
      )}
      {view.name === "analysis" && (
        <Analysis farm={view.farm} onBack={() => setView({ name: "farms" })} />
      )}
      {view.name === "flight" && (
        <Flight farm={view.farm} onBack={() => setView({ name: "farms" })} />
      )}
      {view.name === "vendor" && (
        <Vendor farm={view.farm} onBack={() => setView({ name: "farms" })} />
      )}
      {view.name === "strings" && (
        <StringList
          farm={view.farm}
          onCancel={() => setView({ name: "farms" })}
          onDone={() => { void refresh(); setView({ name: "farms" }); }}
        />
      )}
      <footer className="app-foot">
        Pica · los datos viven solo en este dispositivo · nada se sube a ningun lado
      </footer>
    </div>
  );
}
