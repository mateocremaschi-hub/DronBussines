/**
 * Lo que el vuelo va a ver, dibujado.
 *
 * La pantalla contestaba con numeros: "5.0 cm por pixel", "70 % de solape",
 * "42 m de ancho de pasada". Todos correctos y todos inutiles para el que no
 * hizo fotogrametria — y el que va a volar esto no tiene por que haberla
 * hecho. "5 cm por pixel" no le dice a nadie si el punto caliente se va a ver.
 *
 * Son dos preguntas y dos figuras:
 *
 *   1. ¿SE VA A VER LA CELDA? El modulo con sus celdas, y al lado UNA celda
 *      ampliada con la grilla de pixeles de la termica encima. La comparacion
 *      que importa es celda contra pixel, asi que hay que poder ver las dos.
 *      El primer intento dibujaba la grilla de pixeles sobre el modulo entero
 *      y no se entendia nada: a esa escala los pixeles tapan las celdas y las
 *      dos grillas se ven igual.
 *
 *   2. ¿VA A QUEDAR TODO CUBIERTO? Las tres pasadas ESCALONADAS, una debajo de
 *      la otra. Superpuestas —que es lo que pasa fisicamente— con 70 % de
 *      solape se ven como un solo bloque y no se distingue ni cuantas son.
 *      Escalonadas se lee de un vistazo hasta donde llega cada una, y si entre
 *      dos quedara terreno sin tocar aparece marcado en rojo.
 */

interface Props {
  /** Centimetros de terreno por pixel de la termica. */
  gsdCm: number;
  /** Lado de una celda del modulo, en metros. */
  celdaM: number;
  /** Medidas del modulo, en metros. */
  moduloAnchoM: number;
  moduloLargoM: number;
  /** Ancho de la franja que cubre cada pasada, en metros. */
  huellaAnchoM: number;
  /** Separacion entre pasadas vecinas, en metros. */
  separacionM: number;
  /** Separacion entre filas de trackers, en metros. */
  pasoDeFilaM: number;
}

const TINTA = "#7B8794";
const ACENTO = "#0E6F72";
const CALIENTE = "#c0392b";

export function LoQueVeElDron({
  gsdCm, celdaM, moduloAnchoM, moduloLargoM, huellaAnchoM, separacionM, pasoDeFilaM,
}: Props) {
  const gsdM = gsdCm / 100;
  const pxPorCelda = celdaM / gsdM;
  const alcanza = pxPorCelda >= 3;
  const regular = pxPorCelda >= 2 && pxPorCelda < 3;

  // --- figura 1: el modulo, y una celda ampliada ---------------------------
  const celdasAncho = Math.max(1, Math.round(moduloLargoM / celdaM));
  const celdasAlto = Math.max(1, Math.round(moduloAnchoM / celdaM));
  // La celda caliente, elegida adentro del modulo para que se vea entera.
  const cx = Math.min(2, celdasAncho - 1);
  const cy = Math.min(1, celdasAlto - 1);

  const MW = 300;                                   // el modulo, en pantalla
  const MH = Math.round((MW * moduloAnchoM) / moduloLargoM);
  const cw = MW / celdasAncho;
  const ch = MH / celdasAlto;

  const LUPA = 190;                                 // la celda ampliada
  const pasoLupa = LUPA / pxPorCelda;               // un pixel de la termica
  const pixeles = Math.ceil(pxPorCelda) + 1;

  // --- figura 2: las pasadas, escalonadas ----------------------------------
  const anchoEscena = Math.max(huellaAnchoM + 2.4 * separacionM, pasoDeFilaM * 4);
  const W2 = 520, H2 = 170;
  const e2 = W2 / anchoEscena;
  const centro = anchoEscena / 2;
  const pasadas = [-1, 0, 1].map((k) => centro + k * separacionM);
  const hayHueco = separacionM > huellaAnchoM;
  const solapePct = Math.max(0, 1 - separacionM / huellaAnchoM) * 100;
  const filas: number[] = [];
  for (let x = centro % pasoDeFilaM; x < anchoEscena; x += pasoDeFilaM) filas.push(x);

  return (
    <div className="loqueve">
      <div className="loqueve-figura">
        <h4>
          ¿Se va a ver una celda caliente?{" "}
          <span className={alcanza ? "si" : regular ? "masomenos" : "no"}>
            {alcanza ? "Sí" : regular ? "Justo" : "No"}
          </span>
        </h4>

        <svg viewBox={`0 0 ${MW + LUPA + 76} ${Math.max(MH, LUPA) + 44}`} className="figura" role="img"
             aria-label={`Un modulo con sus celdas, y una celda ampliada donde entran ${pxPorCelda.toFixed(1)} pixeles de la camara`}>
          <g transform={`translate(0,${(Math.max(MH, LUPA) - MH) / 2 + 12})`}>
            <rect x={0} y={0} width={MW} height={MH} fill="var(--surface-2)" stroke={TINTA} strokeWidth={1.2} />
            {Array.from({ length: celdasAncho - 1 }, (_, i) => (
              <line key={`v${i}`} x1={(i + 1) * cw} y1={0} x2={(i + 1) * cw} y2={MH} stroke={TINTA} strokeWidth={0.8} />
            ))}
            {Array.from({ length: celdasAlto - 1 }, (_, i) => (
              <line key={`h${i}`} x1={0} y1={(i + 1) * ch} x2={MW} y2={(i + 1) * ch} stroke={TINTA} strokeWidth={0.8} />
            ))}
            <rect x={cx * cw} y={cy * ch} width={cw} height={ch} fill={CALIENTE} opacity={0.9} />
            <text x={MW / 2} y={MH + 15} textAnchor="middle" fontSize={11} fill={TINTA}>
              un módulo · {celdasAncho}×{celdasAlto} celdas
            </text>
          </g>

          {/* la linea que lleva de la celda a su ampliacion */}
          <g stroke={CALIENTE} strokeWidth={1} strokeDasharray="3 3" fill="none">
            <line x1={(cx + 1) * cw} y1={(Math.max(MH, LUPA) - MH) / 2 + 12 + cy * ch}
                  x2={MW + 60} y2={(Math.max(MH, LUPA) - LUPA) / 2 + 12} />
            <line x1={(cx + 1) * cw} y1={(Math.max(MH, LUPA) - MH) / 2 + 12 + (cy + 1) * ch}
                  x2={MW + 60} y2={(Math.max(MH, LUPA) - LUPA) / 2 + 12 + LUPA} />
          </g>

          <g transform={`translate(${MW + 60},${(Math.max(MH, LUPA) - LUPA) / 2 + 12})`}>
            {/* esa misma celda, ampliada */}
            <rect x={0} y={0} width={LUPA} height={LUPA} fill={CALIENTE} opacity={0.9} />
            {/* y los pixeles de la termica encima, a escala real */}
            <g stroke="#fff" strokeWidth={1.4} opacity={0.95}>
              {Array.from({ length: pixeles }, (_, i) => (
                <line key={`pv${i}`} x1={(i + 1) * pasoLupa} y1={0} x2={(i + 1) * pasoLupa} y2={LUPA} />
              ))}
              {Array.from({ length: pixeles }, (_, i) => (
                <line key={`ph${i}`} x1={0} y1={(i + 1) * pasoLupa} x2={LUPA} y2={(i + 1) * pasoLupa} />
              ))}
            </g>
            <rect x={0} y={0} width={LUPA} height={LUPA} fill="none" stroke={CALIENTE} strokeWidth={2} />
            <text x={LUPA / 2} y={LUPA + 15} textAnchor="middle" fontSize={11} fill={TINTA}>
              esa celda · {pxPorCelda.toFixed(1)} píxeles de lado
            </text>
          </g>
        </svg>

        <p className="help">
          Izquierda: un módulo con sus celdas. Derecha: <strong>una sola celda</strong>, ampliada,
          con la <strong>grilla de píxeles</strong> de tu térmica encima. Cada cuadradito blanco es
          un píxel — todo lo que hay adentro se promedia en un solo número.
          {alcanza
            ? " Con tres o más píxeles por celda, el punto caliente sobrevive al promedio."
            : regular
              ? " Con dos está al límite: un punto caliente chico se puede diluir."
              : " Con menos de dos, el promedio se lo come. El módulo entero se sigue midiendo bien; lo que no vas a ver es la celda."}
        </p>
      </div>

      <div className="loqueve-figura">
        <h4>
          ¿Va a quedar todo cubierto?{" "}
          <span className={hayHueco ? "no" : solapePct > 20 ? "si" : "masomenos"}>
            {hayHueco ? "No" : solapePct > 20 ? "Sí" : "Justo"}
          </span>
        </h4>

        <svg viewBox={`0 0 ${W2} ${H2}`} className="figura" role="img"
             aria-label={hayHueco
               ? "Tres pasadas del dron que dejan terreno sin cubrir entre ellas"
               : `Tres pasadas del dron con ${solapePct.toFixed(0)} por ciento de solape`}>
          {/* las filas de paneles, de fondo */}
          {filas.map((x, i) => (
            <rect key={i} x={x * e2 - 2} y={6} width={4} height={H2 - 28} fill={TINTA} opacity={0.3} />
          ))}

          {/*
            Las pasadas, escalonadas en vertical.

            Fisicamente las tres cubren la misma franja de terreno y se pisan;
            dibujarlas encima una de otra con 70 % de solape da un bloque solido
            del que no se puede leer nada. Escalonadas, cada una muestra hasta
            donde llega y el ojo ve solo si la de abajo alcanza a la de arriba.
          */}
          {pasadas.map((c, i) => {
            const y = 16 + i * 40;
            return (
              <g key={i}>
                <rect x={(c - huellaAnchoM / 2) * e2} y={y} width={huellaAnchoM * e2} height={26}
                      fill={ACENTO} opacity={0.3} stroke={ACENTO} strokeWidth={1.2} rx={2} />
                <line x1={c * e2} y1={y} x2={c * e2} y2={y + 26}
                      stroke={ACENTO} strokeWidth={1.5} strokeDasharray="4 3" />
                <text x={c * e2} y={y + 17} textAnchor="middle" fontSize={10} fill={ACENTO}>
                  pasada {i + 1}
                </text>
              </g>
            );
          })}

          {/* si las pasadas no se tocan, el terreno que nadie fotografia */}
          {hayHueco && pasadas.slice(0, -1).map((c, i) => (
            <rect key={`g${i}`}
                  x={(c + huellaAnchoM / 2) * e2} y={16}
                  width={(separacionM - huellaAnchoM) * e2} height={106}
                  fill={CALIENTE} opacity={0.35} />
          ))}

          <text x={W2 / 2} y={H2 - 4} textAnchor="middle" fontSize={11} fill={TINTA}>
            las barras grises son las filas de paneles · una pasada cubre {huellaAnchoM.toFixed(0)} m de ancho
          </text>
        </svg>

        <p className="help">
          Tres pasadas seguidas, dibujadas una debajo de la otra para poder compararlas (en el campo
          se pisan). La línea de puntos es por dónde va el dron y la franja verde es lo que ve.
          {hayHueco
            ? " En rojo, el terreno que no cae en ninguna pasada: esos paneles no van a tener foto."
            : ` Cada pasada le pisa ${solapePct.toFixed(0)} % a la anterior, así que no queda terreno sin foto — y ese margen es lo que absorbe que el dron se corra de la línea.`}
        </p>
      </div>
    </div>
  );
}
