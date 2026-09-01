/**
 * El mapa que sirve para llegar a un modulo, en dos escalas.
 *
 * Reemplaza al lienzo unico que dibujaba todos los modulos medidos del parque
 * a un pixel y medio cada uno. Ese dibujo era correcto y no servia para nada:
 * sin el nombre de los bloques escrito encima no se sabia que se estaba
 * mirando, y sin poder entrar a uno no se podia llegar a ningun lado.
 *
 * Un parque de mil hectareas se mira en dos escalas y no en una:
 *
 *   PARQUE  cada bloque es un rectangulo con su nombre y pintado por lo que
 *           falta revisar. Contesta "¿donde hay trabajo?".
 *   BLOQUE  las filas del bloque y los hallazgos como puntos. Contesta "¿donde
 *           esta este panel?" — y tocarlo lo abre en la revision.
 *
 * Se dibuja en un canvas y no en SVG por una razon de tamaño: un bloque de
 * Wellington son 131 filas, y el parque entero 6.803. Como SVG eso son miles de
 * nodos que el navegador tiene que mantener vivos; como canvas es un dibujo que
 * se rehace cuando cambia algo.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { BloqueDelMapa, CajaDelMapa, PuntoDeHallazgo } from "../mapa";
import { unirCajas } from "../mapa";
import type { Severidad } from "../detect";
import type { Finding } from "../inspection";

const COLORES: Record<Severidad, string> = {
  normal: "#3b6ea5",
  leve: "#d9a441",
  moderada: "#d9702b",
  critica: "#c0392b",
};

interface Props {
  bloques: BloqueDelMapa[];
  puntos: Map<string, PuntoDeHallazgo>;
  findings: Finding[];
  /** El bloque abierto, o `null` para la escala del parque. */
  abierto: string | null;
  onAbrir: (block: string | null) => void;
  seleccion?: string | null;
  onElegir?: (id: string) => void;
  height?: number;
}

/** Como se pasa de metros del parque a pixeles del lienzo, con el norte arriba. */
function vista(caja: CajaDelMapa, cssW: number, cssH: number, pad = 24) {
  const spanX = Math.max(caja.maxX - caja.minX, 1);
  const spanY = Math.max(caja.maxY - caja.minY, 1);
  const escala = Math.min((cssW - pad * 2) / spanX, (cssH - pad * 2) / spanY);
  const offX = (cssW - spanX * escala) / 2;
  const offY = (cssH - spanY * escala) / 2;
  return {
    escala,
    px: (x: number) => offX + (x - caja.minX) * escala,
    // El eje Y del lienzo crece hacia abajo y el norte va arriba.
    py: (y: number) => cssH - (offY + (y - caja.minY) * escala),
  };
}

export function MapaDelParque({
  bloques, puntos, findings, abierto, onAbrir, seleccion = null, onElegir, height = 300,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [encima, setEncima] = useState<string | null>(null);
  /*
    El mapa se puede plegar.

    Sirve para llegar a un bloque, y despues estorba: revisando cuatrocientos
    modulos uno atras del otro, los 300 px del mapa empujan la foto —que es lo
    que hay que mirar— fuera de la pantalla en cada hallazgo.
  */
  const [plegado, setPlegado] = useState(false);

  const bloque = useMemo(
    () => (abierto ? bloques.find((b) => b.block === abierto) ?? null : null),
    [bloques, abierto],
  );

  const severidad = useMemo(() => {
    const m = new Map<string, { sev: Severidad; revisado: boolean }>();
    for (const f of findings) {
      m.set(f.id, { sev: f.medicion?.peor ?? "leve", revisado: f.status !== "pendiente" });
    }
    return m;
  }, [findings]);

  /** Los puntos que se dibujan en la escala de bloque. */
  const puntosDelBloque = useMemo(
    () => (bloque ? [...puntos.values()].filter((p) => p.block === bloque.block) : []),
    [puntos, bloque],
  );

  const caja = useMemo<CajaDelMapa | null>(
    () => (bloque ? bloque.caja : unirCajas(bloques.map((b) => b.caja))),
    [bloque, bloques],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !caja || plegado) return;

    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth;
    canvas.width = cssW * dpr;
    canvas.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const estilo = getComputedStyle(document.documentElement);
    const tinta = estilo.getPropertyValue("--ink-3").trim() || "#7B8794";
    const acento = estilo.getPropertyValue("--accent").trim() || "#0E6F72";
    ctx.fillStyle = estilo.getPropertyValue("--surface").trim() || "#fff";
    ctx.fillRect(0, 0, cssW, height);

    const v = vista(caja, cssW, height);

    if (!bloque) {
      /*
        Escala del parque. El color dice lo unico que importa a esta distancia:
        si en ese bloque queda algo por mirar. Verde no es "sano" — es "ya lo
        revisaste", que es una afirmacion sobre el trabajo y no sobre el parque.
      */
      for (const b of bloques) {
        const x = v.px(b.caja.minX);
        const y = v.py(b.caja.maxY);
        const w = Math.max(2, (b.caja.maxX - b.caja.minX) * v.escala);
        const h = Math.max(2, (b.caja.maxY - b.caja.minY) * v.escala);

        ctx.fillStyle = b.criticas
          ? COLORES.critica
          : b.pendientes
            ? COLORES.moderada
            : b.total
              ? "#3f8f5f"
              : estilo.getPropertyValue("--line").trim() || "#d8dee4";
        ctx.globalAlpha = b.total ? 0.85 : 0.45;
        ctx.fillRect(x, y, w, h);
        ctx.globalAlpha = 1;

        if (b.block === encima || b.block === seleccion) {
          ctx.strokeStyle = acento;
          ctx.lineWidth = 2;
          ctx.strokeRect(x - 1, y - 1, w + 2, h + 2);
        }

        // El nombre solo si entra: media etiqueta encima de otra es peor que
        // ninguna, y a esta escala el nombre es lo unico que ubica.
        ctx.font = "600 11px 'IBM Plex Mono', monospace";
        const t = ctx.measureText(b.block).width;
        if (w > t + 6 && h > 14) {
          ctx.fillStyle = "#fff";
          ctx.fillText(b.block, x + w / 2 - t / 2, y + h / 2 + 4);
        }
      }
    } else {
      // Escala del bloque: primero las filas, en gris, como plano de fondo.
      ctx.strokeStyle = tinta;
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = Math.max(1, Math.min(4, 2 * v.escala));
      ctx.beginPath();
      for (const t of bloque.tramos) {
        ctx.moveTo(v.px(t.ax), v.py(t.ay));
        ctx.lineTo(v.px(t.bx), v.py(t.by));
      }
      ctx.stroke();
      ctx.globalAlpha = 1;

      // Y encima los hallazgos. El seleccionado se dibuja al final para que no
      // quede tapado por un vecino.
      const radio = Math.max(3.5, Math.min(9, 1.2 * v.escala));
      const orden = [...puntosDelBloque].sort((a, b) =>
        (a.id === seleccion ? 1 : 0) - (b.id === seleccion ? 1 : 0),
      );
      for (const p of orden) {
        const s = severidad.get(p.id);
        ctx.beginPath();
        ctx.arc(v.px(p.x), v.py(p.y), p.id === seleccion ? radio + 2 : radio, 0, Math.PI * 2);
        // Revisado = anillo hueco. Se ve de un vistazo cuanto falta sin contar.
        if (s?.revisado) {
          ctx.strokeStyle = COLORES[s.sev];
          ctx.lineWidth = 2;
          ctx.stroke();
        } else {
          ctx.fillStyle = COLORES[s?.sev ?? "leve"];
          ctx.fill();
        }
        if (p.id === seleccion || p.id === encima) {
          ctx.strokeStyle = acento;
          ctx.lineWidth = p.id === seleccion ? 3 : 1.5;
          ctx.stroke();
        }
      }
    }

    // Barra de escala: la distancia real es lo que convierte el dibujo en un
    // mapa. Se elige el paso redondo que ocupe entre un quinto y un tercio.
    const pasos = [10, 25, 50, 100, 200, 500, 1000, 2000];
    const metros = pasos.find((m) => m * v.escala > cssW / 5) ?? pasos[pasos.length - 1]!;
    const barra = metros * v.escala;
    if (barra > 20 && barra < cssW - 60) {
      ctx.strokeStyle = tinta;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(20, height - 16);
      ctx.lineTo(20 + barra, height - 16);
      ctx.stroke();
      ctx.fillStyle = tinta;
      ctx.font = "11px 'IBM Plex Mono', monospace";
      ctx.fillText(metros >= 1000 ? `${metros / 1000} km` : `${metros} m`, 20 + barra + 8, height - 12);
    }
  }, [bloques, bloque, puntosDelBloque, severidad, caja, height, encima, seleccion, plegado]);

  /** Que hay debajo del puntero: un bloque, un hallazgo, o nada. */
  function buscar(evt: React.MouseEvent<HTMLCanvasElement>): string | null {
    const canvas = canvasRef.current;
    if (!canvas || !caja) return null;
    const r = canvas.getBoundingClientRect();
    const v = vista(caja, canvas.clientWidth, height);
    const mx = evt.clientX - r.left;
    const my = evt.clientY - r.top;

    if (!bloque) {
      for (const b of bloques) {
        const x = v.px(b.caja.minX);
        const y = v.py(b.caja.maxY);
        const w = Math.max(2, (b.caja.maxX - b.caja.minX) * v.escala);
        const h = Math.max(2, (b.caja.maxY - b.caja.minY) * v.escala);
        if (mx >= x - 2 && mx <= x + w + 2 && my >= y - 2 && my <= y + h + 2) return b.block;
      }
      return null;
    }

    let mejor: string | null = null;
    let mejorD = Infinity;
    for (const p of puntosDelBloque) {
      const d = Math.hypot(v.px(p.x) - mx, v.py(p.y) - my);
      if (d < mejorD) { mejorD = d; mejor = p.id; }
    }
    // El radio cubre el hueco entre filas y no el ancho de un modulo: entre dos
    // filas hay metros de pasto, y un click que caiga ahi tiene que resolverse
    // al hallazgo mas cercano igual.
    return mejorD <= Math.max(18, 3 * v.escala) ? mejor : null;
  }

  if (!caja) return null;

  return (
    <div className="mapa">
      <div className="mapa-barra">
        <button className="link" disabled={!bloque} onClick={() => onAbrir(null)}>
          {bloque ? "← Todo el parque" : "Todo el parque"}
        </button>
        {bloque && (
          <>
            <span className="sep">/</span>
            <strong>Bloque {bloque.block}</strong>
            <span className="muted small">
              {bloque.tramos.length} filas · {bloque.total} hallazgos · {bloque.pendientes} sin revisar
            </span>
          </>
        )}
        {!bloque && (
          <span className="muted small">
            {bloques.length} bloques · tocá uno para entrar
          </span>
        )}
        <button className="link plegar" onClick={() => setPlegado((v) => !v)}>
          {plegado ? "mostrar el mapa" : "ocultar el mapa"}
        </button>
      </div>
      {!plegado && (
        <>
          <canvas
            ref={canvasRef}
            style={{ width: "100%", height, cursor: "pointer" }}
            onMouseMove={(e) => setEncima(buscar(e))}
            onMouseLeave={() => setEncima(null)}
            onClick={(e) => {
              const hit = buscar(e);
              if (!hit) return;
              if (!bloque) onAbrir(hit);
              else onElegir?.(hit);
            }}
          />
          <p className="muted small">
            {bloque
              ? "Cada punto es un modulo con anomalia; el anillo hueco es uno que ya revisaste. Tocá uno para abrirlo."
              : "Rojo: hay criticas sin revisar. Naranja: queda algo pendiente. Verde: todo revisado. Gris: sin anomalias."}
          </p>
        </>
      )}
    </div>
  );
}
