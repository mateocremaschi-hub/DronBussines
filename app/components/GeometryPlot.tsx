/**
 * Dibujo de la geometria importada.
 *
 * No usa imagen satelital a proposito. El trabajo de esta pantalla es cazar
 * errores de importacion — filas faltantes, picas cruzadas, largos que no
 * cierran — y para eso un trazado vectorial limpio con colores por estado
 * funciona mejor que una foto. Para verificar que el parque cae donde tiene que
 * caer esta el link a Google Maps, que es el error que la foto si detectaria.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { makeFrame, toLocal } from "@locator";
import type { CompiledFarm, TrackerRow, Warning } from "@locator";

interface Props {
  farm: CompiledFarm;
  height?: number;
}

export function GeometryPlot({ farm, height = 420 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [hover, setHover] = useState<TrackerRow | null>(null);
  const [selected, setSelected] = useState<TrackerRow | null>(null);

  const flagged = useMemo(() => {
    const map = new Map<string, Warning[]>();
    for (const w of farm.buildWarnings) {
      if (!w.rowId) continue;
      map.set(w.rowId, [...(map.get(w.rowId) ?? []), w]);
    }
    for (const r of farm.rows) {
      if (r.strategyWarnings.length) {
        map.set(r.source.id, [...(map.get(r.source.id) ?? []), ...r.strategyWarnings]);
      }
    }
    return map;
  }, [farm]);

  const layout = useMemo(() => {
    const frame = makeFrame(farm.origin.lat, farm.origin.lon);
    const pts = farm.rows.flatMap((r) => [r.a, r.b]);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of pts) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    return { frame, minX, maxX, minY, maxY };
  }, [farm]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth;
    const cssH = height;
    canvas.width = cssW * dpr;
    canvas.height = cssH * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const style = getComputedStyle(document.documentElement);
    const ink = style.getPropertyValue("--ink-3").trim() || "#7B8794";
    const accent = style.getPropertyValue("--accent").trim() || "#0E6F72";
    const warn = style.getPropertyValue("--warn").trim() || "#9A5209";
    const surface = style.getPropertyValue("--surface").trim() || "#fff";

    ctx.fillStyle = surface;
    ctx.fillRect(0, 0, cssW, cssH);

    const pad = 24;
    const { minX, maxX, minY, maxY } = layout;
    const spanX = Math.max(maxX - minX, 1);
    const spanY = Math.max(maxY - minY, 1);
    const scale = Math.min((cssW - pad * 2) / spanX, (cssH - pad * 2) / spanY);
    const offX = (cssW - spanX * scale) / 2;
    const offY = (cssH - spanY * scale) / 2;

    // El eje Y del canvas crece hacia abajo; el norte tiene que quedar arriba.
    const px = (x: number) => offX + (x - minX) * scale;
    const py = (y: number) => cssH - (offY + (y - minY) * scale);

    for (const row of farm.rows) {
      const isFlagged = flagged.has(row.source.id);
      const isActive = selected?.id === row.source.id || hover?.id === row.source.id;
      ctx.strokeStyle = isActive ? accent : isFlagged ? warn : ink;
      ctx.lineWidth = isActive ? 4 : isFlagged ? 2.5 : 1.4;
      ctx.globalAlpha = isActive || isFlagged ? 1 : 0.55;
      ctx.beginPath();
      ctx.moveTo(px(row.a.x), py(row.a.y));
      ctx.lineTo(px(row.b.x), py(row.b.y));
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Barra de escala: 100 m reales.
    const barM = 100;
    const barPx = barM * scale;
    if (barPx > 20 && barPx < cssW - 60) {
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(pad, cssH - 16);
      ctx.lineTo(pad + barPx, cssH - 16);
      ctx.moveTo(pad, cssH - 20); ctx.lineTo(pad, cssH - 12);
      ctx.moveTo(pad + barPx, cssH - 20); ctx.lineTo(pad + barPx, cssH - 12);
      ctx.stroke();
      ctx.fillStyle = ink;
      ctx.font = "11px 'IBM Plex Mono', monospace";
      ctx.fillText(`${barM} m`, pad + barPx + 8, cssH - 12);
    }
  }, [farm, layout, flagged, hover, selected, height]);

  const pick = (evt: React.MouseEvent<HTMLCanvasElement>): TrackerRow | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const mx = evt.clientX - rect.left;
    const my = evt.clientY - rect.top;

    const pad = 24;
    const { minX, maxX, minY, maxY } = layout;
    const spanX = Math.max(maxX - minX, 1);
    const spanY = Math.max(maxY - minY, 1);
    const scale = Math.min((rect.width - pad * 2) / spanX, (height - pad * 2) / spanY);
    const offX = (rect.width - spanX * scale) / 2;
    const offY = (height - spanY * scale) / 2;

    // De pixeles de vuelta a metros locales.
    const x = (mx - offX) / scale + minX;
    const y = (height - my - offY) / scale + minY;

    let best: TrackerRow | null = null;
    let bestD = Infinity;
    for (const row of farm.rows) {
      const dx = row.b.x - row.a.x;
      const dy = row.b.y - row.a.y;
      const len2 = dx * dx + dy * dy;
      let t = ((x - row.a.x) * dx + (y - row.a.y) * dy) / len2;
      t = Math.min(Math.max(t, 0), 1);
      const d = Math.hypot(x - (row.a.x + dx * t), y - (row.a.y + dy * t));
      if (d < bestD) { bestD = d; best = row.source; }
    }
    // Tolerancia de 10 pixeles, en metros.
    return bestD * scale < 10 ? best : null;
  };

  const active = selected ?? hover;
  const activeWarnings = active ? (flagged.get(active.id) ?? []) : [];
  const mapsUrl = active
    ? `https://www.google.com/maps?q=${(active.start.lat + active.end.lat) / 2},${(active.start.lon + active.end.lon) / 2}`
    : `https://www.google.com/maps?q=${farm.origin.lat},${farm.origin.lon}`;

  return (
    <div className="plot">
      <canvas
        ref={canvasRef}
        style={{ height, width: "100%" }}
        onMouseMove={(e) => setHover(pick(e))}
        onMouseLeave={() => setHover(null)}
        onClick={(e) => setSelected(pick(e))}
      />
      <div className="plot-info">
        {active ? (
          <>
            <strong>
              {active.block} · {active.tracker}
              {active.row ? ` · ${active.row}` : ""}
            </strong>
            <span className="mono">
              {active.side ? `lado ${active.side}` : "sin lado"} ·{" "}
              {active.pos != null && active.posTotal != null
                ? `${active.pos} de ${active.posTotal} en la linea`
                : "sin posicion en la linea"}
              {active.stringNumbers?.length ? ` · strings ${active.stringNumbers.join(", ")}` : ""}
            </span>
            {activeWarnings.map((w, i) => (
              <span key={i} className="plot-warn">{w.message}</span>
            ))}
          </>
        ) : (
          <span className="muted">
            Pasa el mouse por una fila para ver sus datos. Las filas en naranja tienen algo que revisar.
          </span>
        )}
        <a href={mapsUrl} target="_blank" rel="noreferrer">
          {active ? "Ver este tracker en Google Maps" : "Ver el centro del parque en Google Maps"} →
        </a>
      </div>
    </div>
  );
}

/** Chequeo barato de georreferenciacion: donde cae el parque en el mundo. */
export function boundsSummary(rows: TrackerRow[]): string {
  if (!rows.length) return "";
  const frame = makeFrame(rows[0]!.start.lat, rows[0]!.start.lon);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const r of rows) {
    for (const p of [r.start, r.end]) {
      const l = toLocal(frame, p.lat, p.lon);
      minX = Math.min(minX, l.x); maxX = Math.max(maxX, l.x);
      minY = Math.min(minY, l.y); maxY = Math.max(maxY, l.y);
    }
  }
  const w = (maxX - minX) / 1000;
  const h = (maxY - minY) / 1000;
  return `${w.toFixed(2)} × ${h.toFixed(2)} km`;
}
