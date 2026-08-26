/**
 * El parque modulo por modulo, pintado por cuanto se despega de sus vecinos.
 *
 * No dibuja las fotos: dibuja los MODULOS. Es la decision de fondo de esta
 * pantalla y conviene que se entienda.
 *
 * Un mosaico de fotos hereda entero el error del GPS del dron — si el vuelo
 * quedo corrido tres metros, todo lo que se marque encima queda corrido tres
 * metros, y no se nota. La grilla de modulos sale de la geometria relevada y
 * verificada en campo, asi que tocar un modulo devuelve su direccion exacta.
 *
 * Lo que se toca es el modelo, no un pixel.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { Hallazgo, Severidad } from "../detect";

interface Props {
  hallazgos: Hallazgo[];
  /** Ancho y largo del modulo en metros, para dibujarlo a escala. */
  anchoM: number;
  largoM: number;
  height?: number;
  onPick?: (h: Hallazgo | null) => void;
  seleccion?: Hallazgo | null;
}

const COLORES: Record<Severidad, string> = {
  normal: "#3b6ea5",
  leve: "#d9a441",
  moderada: "#d9702b",
  critica: "#c0392b",
};

export function ThermalMap({
  hallazgos, anchoM, largoM, height = 520, onPick, seleccion = null,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [hover, setHover] = useState<Hallazgo | null>(null);

  const caja = useMemo(() => {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const h of hallazgos) {
      minX = Math.min(minX, h.modulo.x); maxX = Math.max(maxX, h.modulo.x);
      minY = Math.min(minY, h.modulo.y); maxY = Math.max(maxY, h.modulo.y);
    }
    return { minX, maxX, minY, maxY };
  }, [hallazgos]);

  const vista = (cssW: number, cssH: number) => {
    const pad = 20;
    const spanX = Math.max(caja.maxX - caja.minX, 1);
    const spanY = Math.max(caja.maxY - caja.minY, 1);
    const scale = Math.min((cssW - pad * 2) / spanX, (cssH - pad * 2) / spanY);
    return {
      scale,
      px: (x: number) => (cssW - spanX * scale) / 2 + (x - caja.minX) * scale,
      // El eje Y del canvas crece hacia abajo; el norte va arriba.
      py: (y: number) => cssH - ((cssH - spanY * scale) / 2 + (y - caja.minY) * scale),
    };
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !hallazgos.length) return;

    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth;
    canvas.width = cssW * dpr;
    canvas.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const estilo = getComputedStyle(document.documentElement);
    ctx.fillStyle = estilo.getPropertyValue("--surface").trim() || "#fff";
    ctx.fillRect(0, 0, cssW, height);

    const v = vista(cssW, height);
    const w = Math.max(1.5, anchoM * v.scale);
    const l = Math.max(1.5, largoM * v.scale);

    // Los normales primero y los calientes despues: un modulo critico no puede
    // quedar tapado por el vecino sano que se dibujo despues.
    const orden = [...hallazgos].sort((a, b) => a.deltaT - b.deltaT);
    for (const h of orden) {
      ctx.fillStyle = COLORES[h.severidad];
      ctx.globalAlpha = h.severidad === "normal" ? 0.5 : 1;
      ctx.fillRect(v.px(h.modulo.x) - w / 2, v.py(h.modulo.y) - l / 2, w, l);
    }
    ctx.globalAlpha = 1;

    const marcar = (h: Hallazgo, color: string, grosor: number) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = grosor;
      ctx.strokeRect(v.px(h.modulo.x) - w / 2 - 2, v.py(h.modulo.y) - l / 2 - 2, w + 4, l + 4);
    };
    const acento = estilo.getPropertyValue("--accent").trim() || "#0E6F72";
    if (hover) marcar(hover, acento, 1.5);
    if (seleccion) marcar(seleccion, acento, 3);

    // Barra de escala: 50 m reales.
    const barra = 50 * v.scale;
    if (barra > 20 && barra < cssW - 60) {
      const ink = estilo.getPropertyValue("--ink-3").trim() || "#7B8794";
      ctx.strokeStyle = ink; ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(20, height - 16); ctx.lineTo(20 + barra, height - 16);
      ctx.stroke();
      ctx.fillStyle = ink;
      ctx.font = "11px 'IBM Plex Mono', monospace";
      ctx.fillText("50 m", 20 + barra + 8, height - 12);
    }
  }, [hallazgos, anchoM, largoM, height, hover, seleccion]);

  const buscar = (evt: React.MouseEvent<HTMLCanvasElement>): Hallazgo | null => {
    const canvas = canvasRef.current;
    if (!canvas || !hallazgos.length) return null;
    const r = canvas.getBoundingClientRect();
    const v = vista(canvas.clientWidth, height);
    const mx = evt.clientX - r.left;
    const my = evt.clientY - r.top;

    let mejor: Hallazgo | null = null;
    let mejorD = Infinity;
    for (const h of hallazgos) {
      const d = Math.hypot(v.px(h.modulo.x) - mx, v.py(h.modulo.y) - my);
      if (d < mejorD) { mejorD = d; mejor = h; }
    }
    // El radio tiene que cubrir el hueco entre filas, no el ancho de un modulo:
    // entre dos filas vecinas hay seis metros de pasto, y un toque que caiga
    // ahi tiene que resolverse al modulo mas cercano igual. Con un radio del
    // ancho del modulo no se puede tocar nada ni con el mouse.
    const radio = Math.max(24, (largoM * v.scale) / 2 + 10);
    return mejorD <= radio ? mejor : null;
  };

  if (!hallazgos.length) return null;

  return (
    <div className="plot">
      <canvas
        ref={canvasRef}
        style={{ width: "100%", height, cursor: "pointer" }}
        onMouseMove={(e) => setHover(buscar(e))}
        onMouseLeave={() => setHover(null)}
        onClick={(e) => onPick?.(buscar(e))}
      />
      <p className="muted small">
        Cada rectangulo es un modulo, pintado por cuanto se despega de sus vecinos del mismo
        string. Tocá uno para ver su direccion y su temperatura.
      </p>
      <ul className="leyenda">
        {(["normal", "leve", "moderada", "critica"] as Severidad[]).map((s) => (
          <li key={s}><span style={{ background: COLORES[s] }} />{s}</li>
        ))}
      </ul>
    </div>
  );
}
