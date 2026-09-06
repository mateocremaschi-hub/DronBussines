/**
 * La marca: niXin, y el software, niXin Software.
 *
 * Vive en un solo archivo porque la usan tres cosas que no se hablan entre
 * ellas —la barra de la app, el informe que se le manda al cliente y el
 * Excel— y una marca que se dibuja tres veces termina siendo tres marcas.
 *
 * El isotipo es la X del wordmark encerrada entre los corchetes de un visor:
 * lo que el dron ve, ya convertido en pantalla. Los cuatro puntos de las
 * puntas son los rotores. Sale del set de logos, y los numeros son los de
 * ahi: no se retocan a ojo al pegarlo en otro lado.
 */

/** La paleta elegida: neon apagado sobre negro. */
export const MARCA = {
  nombre: "niXin",
  producto: "niXin Software",
  /** El cian de la marca. Sobre negro se lee; sobre blanco NO —1,8:1—. */
  cian: "#5AD1DB",
  /** El mismo cian bajado para texto sobre blanco: 6,3:1. */
  cianOscuro: "#146A75",
  negro: "#05070A",
  panel: "#0C1418",
  linea: "#1C3A40",
  hielo: "#DCEEF0",
  gris: "#6B8189",
} as const;

/**
 * El isotipo: el visor con la X adentro.
 *
 * Lleva su propio fondo oscuro, asi que el mismo dibujo sirve sobre blanco y
 * sobre negro sin una segunda version.
 *
 * El `xmlns` no es decorativo: adentro del HTML sobra, pero para meterlo en el
 * Excel hay que cargarlo como imagen suelta —un data: URI en un `Image`— y ahi
 * un SVG sin namespace no carga. Sin el, el Excel salia sin logo y sin decir
 * por que. El width/height le dan tamaño intrinseco, que es lo otro que pide
 * el navegador para poder dibujarlo en un canvas.
 */
export const ISOTIPO = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100" fill="none" role="img" aria-label="niXin">
  <rect x="1.5" y="1.5" width="97" height="97" rx="24" fill="${MARCA.panel}" stroke="${MARCA.linea}" stroke-width="3"/>
  <g stroke="${MARCA.cian}" stroke-width="4" stroke-linecap="square">
    <path d="M18 34V18h16M82 34V18H66M18 66v16h16M82 66v16H66"/>
  </g>
  <path d="M34 34L66 66M66 34L34 66" stroke="${MARCA.hielo}" stroke-width="11" stroke-linecap="round"/>
  <circle cx="34" cy="34" r="7.5" fill="${MARCA.cian}"/><circle cx="66" cy="34" r="7.5" fill="${MARCA.cian}"/>
  <circle cx="34" cy="66" r="7.5" fill="${MARCA.cian}"/><circle cx="66" cy="66" r="7.5" fill="${MARCA.cian}"/>
</svg>`;

/**
 * La X del wordmark, para meter entre las letras de "ni" e "in".
 *
 * `tinta` es el color del aspa: la del texto que la rodea, porque la X ES una
 * letra. Mide lo mismo que una minuscula y no sobresale.
 *
 * El viewBox arranca en 11,5 y no en 15 porque ahi termina la tinta de verdad:
 * el aspa va de 22 a 78 pero con 14 de trazo y punta redonda llega a 15, y los
 * rotores son circulos de 10,5 centrados en 22 y 78, o sea 11,5. Con el
 * viewBox mas chico el dibujo se salia de su caja y la X quedaba mas grande
 * que las letras de al lado.
 */
export const equis = (tinta: string): string => `<svg viewBox="11.5 11.5 77 77" fill="none" aria-hidden="true">
  <path d="M22 22L78 78M78 22L22 78" stroke="${tinta}" stroke-width="14" stroke-linecap="round"/>
  <circle cx="22" cy="22" r="10.5" fill="${MARCA.cian}"/><circle cx="78" cy="22" r="10.5" fill="${MARCA.cian}"/>
  <circle cx="22" cy="78" r="10.5" fill="${MARCA.cian}"/><circle cx="78" cy="78" r="10.5" fill="${MARCA.cian}"/>
</svg>`;

/**
 * El lockup entero como HTML suelto, para el informe.
 *
 * `sobre` dice contra que fondo va: cambia la tinta de las letras y del
 * subtitulo, no el isotipo, que trae el suyo.
 */
export function lockup(sobre: "claro" | "oscuro", alto = 40): string {
  const tinta = sobre === "claro" ? MARCA.negro : MARCA.hielo;
  const acento = sobre === "claro" ? MARCA.cianOscuro : MARCA.cian;
  const px = Math.round(alto * 0.62);
  return `<span style="display:inline-flex;align-items:center;gap:${Math.round(alto * 0.3)}px">
  <span style="width:${alto}px;height:${alto}px;display:block;flex:none">${ISOTIPO}</span>
  <span style="display:flex;flex-direction:column;gap:${Math.round(alto * 0.1)}px">
    <span style="display:flex;align-items:center;gap:1px;font-size:${px}px;font-weight:700;letter-spacing:-.035em;color:${tinta};line-height:1">
      <span>ni</span><span style="width:${Math.round(px * 0.52)}px;height:${Math.round(px * 0.52)}px;display:block">${equis(tinta)}</span><span>in</span>
    </span>
    <span style="font-size:${Math.max(8, Math.round(alto * 0.24))}px;font-weight:500;letter-spacing:.34em;color:${acento};text-transform:uppercase">Software</span>
  </span>
</span>`;
}

/**
 * El isotipo rasterizado, para el Excel.
 *
 * ExcelJS mete imagenes, no SVG, asi que hay que pasarlo por un canvas. Se
 * dibuja al doble del tamaño con el que se muestra para que no salga borroso
 * en una pantalla retina ni al imprimir.
 *
 * Devuelve `null` si el navegador no puede —un SVG en un `Image` necesita que
 * el blob cargue, y eso falla en entornos sin DOM—: ahi el Excel sale con el
 * nombre en texto y sin el dibujo, que es exactamente lo que salia antes.
 */
export async function isotipoPng(lado = 128): Promise<string | null> {
  if (typeof document === "undefined" || typeof Image === "undefined") return null;
  try {
    const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(ISOTIPO)}`;
    const img = await new Promise<HTMLImageElement>((ok, mal) => {
      const im = new Image();
      im.onload = () => ok(im);
      im.onerror = () => mal(new Error("no cargo el isotipo"));
      im.src = url;
    });
    const c = document.createElement("canvas");
    c.width = lado;
    c.height = lado;
    const g = c.getContext("2d");
    if (!g) return null;
    g.drawImage(img, 0, 0, lado, lado);
    return c.toDataURL("image/png").split(",")[1] ?? null;
  } catch {
    return null;
  }
}
