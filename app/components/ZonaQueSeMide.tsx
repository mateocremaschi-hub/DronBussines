/**
 * Que parte de cada foto se usa para medir, dibujado.
 *
 * El control decia "no medir ningun modulo mas alla del 65 % del cuadro" y la
 * respuesta fue la correcta: "esto no entiendo que es". Y no se puede
 * entender leyendolo — es una idea espacial escrita en palabras, y encima en
 * mi idioma: "el cuadro" es la foto, y "65 %" es una fraccion del camino del
 * centro al borde. Nadie se imagina eso.
 *
 * Dibujado es obvio en un segundo: esta la foto, esta la franja del medio que
 * se usa, y estan los costados que se descartan.
 *
 * Por que se descartan los costados, que es lo que el dibujo tiene que dejar
 * claro: en el borde del cuadro la termica MIENTE. El barril de la lente
 * irradia sobre las esquinas y el vidrio del panel visto de costado refleja el
 * cielo. Un modulo medido ahi puede dar varios grados de diferencia contra sus
 * vecinos medidos en el centro, y esa diferencia no es un defecto — es el borde
 * de la foto. Con umbrales de dos o tres grados, eso es ruido que se convierte
 * en hallazgos falsos.
 *
 * Y lo otro que tiene que quedar claro, porque si no el dibujo asusta: los
 * modulos que caen en los costados NO se pierden. Los levanta la pasada de al
 * lado, donde caen en el medio. Para eso es el solape.
 */

interface Props {
  /** Hasta que fraccion del camino al borde se acepta medir, de 0 a 1. */
  fraccionDelCuadro: number;
}

const TINTA = "#7B8794";
const ACENTO = "#0E6F72";
const MALO = "#c0392b";

export function ZonaQueSeMide({ fraccionDelCuadro }: Props) {
  const W = 460, H = 200;
  const marco = { x: 30, y: 22, w: W - 60, h: H - 62 };
  const centro = marco.x + marco.w / 2;
  const medio = (marco.w / 2) * fraccionDelCuadro;

  // Unos modulos de muestra, para que se vea a quien le toca cada zona.
  const modulos = [-0.92, -0.72, -0.5, -0.28, -0.08, 0.12, 0.34, 0.56, 0.78, 0.94];

  return (
    <div className="zona">
      <svg viewBox={`0 0 ${W} ${H}`} className="figura" role="img"
           aria-label={`La foto de la camara: se mide la franja central, hasta el ${Math.round(fraccionDelCuadro * 100)} % del camino al borde`}>
        {/* la foto */}
        <rect x={marco.x} y={marco.y} width={marco.w} height={marco.h}
              fill="var(--surface-2)" stroke={TINTA} strokeWidth={1.5} />

        {/* los costados que se descartan */}
        {[[marco.x, centro - medio], [centro + medio, marco.x + marco.w]].map(([a, b], i) => (
          <rect key={i} x={a} y={marco.y} width={b! - a!} height={marco.h}
                fill={MALO} opacity={0.14} />
        ))}
        {/* la franja del medio, que es la que se usa */}
        <rect x={centro - medio} y={marco.y} width={medio * 2} height={marco.h}
              fill={ACENTO} opacity={0.16} stroke={ACENTO} strokeWidth={1.2} />

        {/* modulos de muestra: verdes los que se miden, tachados los que no */}
        {modulos.map((f, i) => {
          const x = centro + f * (marco.w / 2);
          const dentro = Math.abs(f) <= fraccionDelCuadro;
          return (
            <g key={i}>
              <rect x={x - 5} y={marco.y + marco.h / 2 - 22} width={10} height={44}
                    fill={dentro ? ACENTO : MALO} opacity={dentro ? 0.85 : 0.4} rx={1} />
              {!dentro && (
                <>
                  <line x1={x - 7} y1={marco.y + marco.h / 2 - 24} x2={x + 7} y2={marco.y + marco.h / 2 + 24}
                        stroke={MALO} strokeWidth={1.5} />
                  <line x1={x + 7} y1={marco.y + marco.h / 2 - 24} x2={x - 7} y2={marco.y + marco.h / 2 + 24}
                        stroke={MALO} strokeWidth={1.5} />
                </>
              )}
            </g>
          );
        })}

        {/* el centro de la foto, que es de donde se mide la fraccion */}
        <line x1={centro} y1={marco.y - 6} x2={centro} y2={marco.y + marco.h + 6}
              stroke={TINTA} strokeWidth={1} strokeDasharray="3 3" />

        <text x={centro} y={marco.y - 10} textAnchor="middle" fontSize={11} fill={ACENTO}>
          se mide acá
        </text>
        <text x={marco.x + (centro - medio - marco.x) / 2} y={marco.y + marco.h + 16}
              textAnchor="middle" fontSize={10} fill={MALO}>
          {fraccionDelCuadro < 0.93 ? "se descarta" : ""}
        </text>
        <text x={centro + medio + (marco.x + marco.w - centro - medio) / 2} y={marco.y + marco.h + 16}
              textAnchor="middle" fontSize={10} fill={MALO}>
          {fraccionDelCuadro < 0.93 ? "se descarta" : ""}
        </text>
        <text x={W / 2} y={H - 6} textAnchor="middle" fontSize={11} fill={TINTA}>
          una foto de la térmica, vista de frente
        </text>
      </svg>
    </div>
  );
}
