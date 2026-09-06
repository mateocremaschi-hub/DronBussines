/**
 * La foto que se entrega: la termica con el modulo marcado y la escala.
 *
 * Hasta ahora se entregaba el JPG crudo del dron. Se abre y se ve una termica
 * en falso color, sin saber cual de los paneles es el del hallazgo ni que
 * temperatura es cada color: para usarla hay que tener el Excel al lado, y una
 * foto reenviada suelta —que es como viajan— no dice nada.
 *
 * Lo que se entrega ahora se defiende solo: el modulo remarcado, la barra de
 * escala con el minimo y el maximo en grados, y abajo el numero de referencia
 * con la direccion y el ΔT. Es la misma imagen que se ve en la app, dibujada
 * una vez y usada por el informe y por la carpeta de fotos.
 */
import type { Finding } from "./inspection";
import { readRadiometric } from "./thermal";
import { ANOMALIA_EN, nombreEntregado, refDe } from "./entregable";

/**
 * La paleta, en diecisiete escalones que se interpolan.
 *
 * Es "inferno": arranca en negro, pasa por violeta y naranja y termina en
 * amarillo claro. Se eligio por una razon practica y no estetica — es
 * monotona en brillo, asi que impresa en blanco y negro, fotocopiada o vista
 * por alguien que no distingue el rojo del verde, el orden de las
 * temperaturas se sigue leyendo. Las paletas tipo arcoiris no cumplen eso: en
 * gris, el amarillo y el celeste dan lo mismo.
 */
const PALETA = [
  [0, 0, 4], [11, 7, 36], [33, 12, 74], [61, 9, 101], [87, 16, 110], [113, 25, 110],
  [138, 34, 106], [163, 44, 97], [188, 55, 84], [210, 70, 68], [228, 90, 49],
  [241, 115, 29], [249, 142, 9], [252, 172, 17], [249, 203, 53], [242, 234, 105],
  [252, 255, 164],
] as const;

function color(t: number): [number, number, number] {
  const x = Math.max(0, Math.min(1, t)) * (PALETA.length - 1);
  const i = Math.min(PALETA.length - 2, Math.floor(x));
  const k = x - i;
  const a = PALETA[i]!, b = PALETA[i + 1]!;
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

/** Percentil sobre una copia ordenada. */
function percentil(v: Float32Array, p: number): number {
  const o = Float32Array.from(v).sort();
  return o[Math.min(o.length - 1, Math.max(0, Math.round((o.length - 1) * p)))]!;
}

/*
  Cuanto se agranda la termica.

  A 3x un cuadro de 640x512 sale de 1920x1536, que impreso en una hoja A4 son
  unos 160 puntos por pulgada: se ve la celda y no se ve el pixel. Mateo lo
  pidio mirando el informe entregado —"que se vean lo mas nitido posible"—, y
  lo que lo dejaba lechoso no era el tamanio sino el suavizado: la termica se
  agranda ahora SIN interpolar, asi que el borde de la mancha caliente queda
  donde esta y no repartido entre cuatro pixeles.
*/
const ESCALA = 3;
/** Ancho de la barra de escala, en pixeles de la imagen final. */
const BARRA = 43 * ESCALA;
/** Alto de la banda de texto de abajo. */
const PIE = 23 * ESCALA;
/*
  Cuanta calidad guarda el JPEG.

  La de la carpeta va alta: es la copia de archivo, la que se abre sola y la
  que se mira con lupa. La del informe va mas comprimida —a simple vista no se
  distinguen, pero pesa la mitad— porque ahi las fotos viajan adentro del HTML
  en base64: a calidad de archivo, un vuelo con sesenta hallazgos daria un
  informe de setenta megas que no se abre ni se manda por mail.
*/
export const CALIDAD_ARCHIVO = 0.95;
export const CALIDAD_INFORME = 0.86;

/**
 * Dibuja la termica de un hallazgo, lista para entregar.
 *
 * Devuelve `null` cuando el archivo no trae temperatura adentro —la foto
 * visible del par, o una termica que la camara guardo sin datos crudos—: ahi
 * el que llama entrega el original, que es mejor que nada.
 */
export async function fotoDelHallazgo(
  file: File,
  f: Finding,
  n: number,
  calidad: number = CALIDAD_ARCHIVO,
  tipo: "image/jpeg" | "image/png" = "image/jpeg",
): Promise<Blob | null> {
  const radio = readRadiometric(await file.arrayBuffer());
  if (!radio) return null;

  const { width: w, height: h, celsius } = radio;
  const lo = percentil(celsius, 0.01);
  const hi = Math.max(lo + 1, percentil(celsius, 0.99));

  const W = w * ESCALA + BARRA;
  const H = h * ESCALA + PIE;
  const lienzo = document.createElement("canvas");
  lienzo.width = W;
  lienzo.height = H;
  const g = lienzo.getContext("2d");
  if (!g) return null;

  g.fillStyle = "#0f141a";
  g.fillRect(0, 0, W, H);

  // La termica, pixel por pixel, y despues escalada de una sola vez: dibujar
  // 327.680 rectangulitos tarda segundos por foto.
  const cruda = g.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const [r, gr, b] = color((celsius[i]! - lo) / (hi - lo));
    cruda.data[i * 4] = r;
    cruda.data[i * 4 + 1] = gr;
    cruda.data[i * 4 + 2] = b;
    cruda.data[i * 4 + 3] = 255;
  }
  const chico = document.createElement("canvas");
  chico.width = w;
  chico.height = h;
  chico.getContext("2d")?.putImageData(cruda, 0, 0);
  // Sin interpolar: es lo que separa una termica nitida de una lechosa.
  g.imageSmoothingEnabled = false;
  g.drawImage(chico, 0, 0, w * ESCALA, h * ESCALA);

  /*
    El modulo, con un cuarto de modulo de aire alrededor.

    Pegado al borde del panel el trazo tapa justo la fila de celdas donde suele
    estar el defecto — Mateo lo pidio mirando un hallazgo real: "el recuadro me
    tapa parte del panel y no puedo ver si tengo un error".
  */
  const caja = f.medicion?.caja;
  if (caja) {
    const largo = (caja.largoModulo ?? caja.largo) * 1.5;
    const cruzado = (caja.cruzadoModulo ?? caja.cruzado) * 1.5;
    g.save();
    g.translate(caja.cx * ESCALA, caja.cy * ESCALA);
    g.rotate(caja.rotRad);
    g.strokeStyle = "#00e5ff";
    g.lineWidth = 1.4 * ESCALA;
    g.strokeRect((-largo / 2) * ESCALA, (-cruzado / 2) * ESCALA, largo * ESCALA, cruzado * ESCALA);
    g.restore();
  }

  // La barra de escala: sin ella el color no significa nada.
  const margen = 11 * ESCALA;
  const ancho = 11 * ESCALA;
  const x0 = w * ESCALA + margen;
  const alto = h * ESCALA - margen * 2;
  for (let y = 0; y < alto; y++) {
    const [r, gr, b] = color(1 - y / alto);
    g.fillStyle = `rgb(${r},${gr},${b})`;
    g.fillRect(x0, margen + y, ancho, 1);
  }
  g.strokeStyle = "rgba(255,255,255,.35)";
  g.lineWidth = 1;
  g.strokeRect(x0 + 0.5, margen + 0.5, ancho, alto);
  g.fillStyle = "#e8eef4";
  g.font = `600 ${6.5 * ESCALA}px -apple-system, system-ui, sans-serif`;
  g.textAlign = "left";
  g.fillText(`${hi.toFixed(1)} °C`, x0 - 2, margen - 3 * ESCALA);
  g.fillText(`${lo.toFixed(1)} °C`, x0 - 2, margen + alto + 7 * ESCALA);

  // Y el pie, para que la foto suelta siga diciendo de que panel es.
  const a = f.address;
  const dt = f.medicion ? `${f.medicion.deltaT >= 0 ? "+" : ""}${f.medicion.deltaT.toFixed(1)} °C` : "";
  const modulo = f.moduloSinConfirmar
    ? "module not confirmed"
    : `module ${f.moduleCorregido ?? a?.module ?? "?"}`;
  g.fillStyle = "#e8eef4";
  g.font = `600 ${7.5 * ESCALA}px -apple-system, system-ui, sans-serif`;
  g.fillText(
    `${refDe(n)} · Block ${a?.block ?? "?"} · Tracker ${a?.tracker ?? "?"}${a?.row ? " " + a.row : ""} · String ${a?.stringNumber ?? "?"} · ${modulo}`,
    7 * ESCALA, h * ESCALA + 10 * ESCALA,
  );
  g.fillStyle = "#93a3b1";
  g.font = `${6.5 * ESCALA}px -apple-system, system-ui, sans-serif`;
  const interno = f.medicion?.deltaInterno != null
    ? ` · hotspot +${f.medicion.deltaInterno.toFixed(1)} °C over the module`
    : "";
  // La foto se entrega en ingles como todo el resto: el nombre interno del
  // patron no puede salir en el pie de una imagen que ve el cliente.
  const patron = f.anomaly ? ANOMALIA_EN[f.anomaly] ?? f.anomaly : "Unclassified";
  g.fillText(`${patron} · ΔT ${dt} vs its string${interno}`, 7 * ESCALA, h * ESCALA + 19 * ESCALA);

  return new Promise((resolve) => lienzo.toBlob((b) => resolve(b), tipo, calidad));
}

/** El nombre con el que viaja esa foto. Es el mismo que apunta el Excel. */
export const nombreDeLaFotoEntregada = (f: Finding, n: number) => nombreEntregado(f, n);
