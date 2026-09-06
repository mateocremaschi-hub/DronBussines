/**
 * La marca, en un solo lugar.
 *
 * La usan tres cosas que no se hablan entre ellas —la barra de la app, el
 * informe que se le manda al cliente y el Excel— y una marca que se dibuja
 * tres veces termina siendo tres marcas.
 */
import { describe, expect, it } from "vitest";
import { equis, ISOTIPO, lockup, MARCA } from "../app/marca";

describe("la marca", () => {
  it("es niXin, y el software niXin Software", () => {
    expect(MARCA.nombre).toBe("niXin");
    expect(MARCA.producto).toBe("niXin Software");
  });

  /*
    El cian de la marca sobre blanco da 1,8:1 — ilegible. Para texto sobre
    fondo claro va el bajado, que da 6,3:1. Que sean dos y no uno es la unica
    forma de que el informe se pueda leer y siga siendo la misma marca.
  */
  it("tiene un cian para fondo oscuro y otro para texto sobre blanco", () => {
    const luz = (h: string) => {
      const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
        .map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
      return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
    };
    const contra = (a: string, b: string) => {
      const [x, y] = [luz(a), luz(b)].sort((p, q) => q - p) as [number, number];
      return (x + 0.05) / (y + 0.05);
    };
    expect(contra(MARCA.cian, MARCA.negro)).toBeGreaterThan(4.5);
    expect(contra(MARCA.cianOscuro, "#ffffff")).toBeGreaterThan(4.5);
    expect(contra(MARCA.cian, "#ffffff")).toBeLessThan(3);
  });

  it("el isotipo trae su propio fondo, asi que sirve sobre claro y sobre oscuro", () => {
    expect(ISOTIPO).toContain(MARCA.panel);
    expect(ISOTIPO).toContain(MARCA.cian);
    expect(ISOTIPO.startsWith("<svg")).toBe(true);
  });

  /*
    La X del wordmark es una LETRA: se pinta con la tinta del texto que la
    rodea, no con el cian. Lo que va en cian son los cuatro rotores.
  */
  it("la X toma la tinta del texto y deja los rotores en cian", () => {
    const x = equis("#123456");
    expect(x).toContain('stroke="#123456"');
    expect(x.match(new RegExp(MARCA.cian, "g"))).toHaveLength(4);
  });

  it("el lockup cambia de tinta segun el fondo, y el isotipo no", () => {
    const claro = lockup("claro");
    const oscuro = lockup("oscuro");
    expect(claro).toContain(MARCA.negro);
    expect(claro).toContain(MARCA.cianOscuro);
    expect(oscuro).toContain(MARCA.hielo);
    expect(claro).toContain(MARCA.panel);
    expect(oscuro).toContain(MARCA.panel);
  });

  it("el lockup dice Software y escribe niXin con la X dibujada", () => {
    const l = lockup("claro");
    expect(l).toContain("Software");
    expect(l).toContain(">ni<");
    expect(l).toContain(">in<");
    // La X no va como letra: si estuviera escrita, "niXin" saldria de corrido.
    expect(l).not.toContain("niXin<");
  });
});

/*
  La X es una letra y tiene que medir lo que una minuscula.

  El aspa va de 22 a 78, pero con 14 de trazo y punta redonda llega a 15, y
  los rotores son circulos de 10,5 centrados en 22 y 78: la tinta empieza en
  11,5. Con el viewBox arrancando en 15 el dibujo se salia de su caja y la X
  quedaba mas grande que las letras de al lado.
*/
describe("la caja de la X", () => {
  it("el viewBox contiene toda la tinta del dibujo", () => {
    const vb = equis("#000").match(/viewBox="([\d.\s-]+)"/)![1]!.trim().split(/\s+/).map(Number);
    const [x, y, w, h] = vb as [number, number, number, number];
    expect(x).toBeLessThanOrEqual(11.5);
    expect(y).toBeLessThanOrEqual(11.5);
    expect(x + w).toBeGreaterThanOrEqual(88.5);
    expect(y + h).toBeGreaterThanOrEqual(88.5);
  });

  it("y es cuadrado, si no la X sale estirada", () => {
    const vb = equis("#000").match(/viewBox="([\d.\s-]+)"/)![1]!.trim().split(/\s+/).map(Number);
    expect(vb[2]).toBe(vb[3]);
  });
});

/*
  El isotipo tambien viaja fuera del HTML: para meterlo en el Excel hay que
  cargarlo como imagen suelta, y ahi un SVG sin namespace no carga. Salia un
  Excel sin logo y sin decir por que.
*/
describe("el isotipo como archivo suelto", () => {
  it("declara el namespace de SVG", () => {
    expect(ISOTIPO).toContain('xmlns="http://www.w3.org/2000/svg"');
  });

  it("y trae tamaño propio, que es lo otro que pide el navegador", () => {
    expect(ISOTIPO).toMatch(/width="\d+"/);
    expect(ISOTIPO).toMatch(/height="\d+"/);
  });

  it("sobrevive a encodeURIComponent sin comillas rotas", () => {
    const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(ISOTIPO)}`;
    expect(decodeURIComponent(url.split(",")[1]!)).toBe(ISOTIPO);
  });
});

/*
  El logo tiene que llenar su caja y nada mas.

  `ISOTIPO` lleva width/height propios porque los necesita para cargarse como
  imagen suelta en el Excel. Adentro de un HTML esos atributos son un tamaño
  intrinseco de 100 px: Chrome lo escalaba igual, Safari no, y en el informe
  el logo salio gigante tapando el wordmark.
*/
describe("el tamaño del logo en el informe", () => {
  it("los dos SVG del lockup se ajustan a su caja", () => {
    const l = lockup("claro", 46);
    const svgs = l.match(/<svg[^>]*>/g)!;
    expect(svgs.length).toBe(2);
    for (const s of svgs) expect(s).toContain("width:100%;height:100%");
  });

  it("y cada uno va adentro de un span que le fija el tamaño", () => {
    expect(lockup("claro", 46)).toContain("width:46px;height:46px");
  });

  /*
    Sin tocar el original: el que va al Excel se carga como archivo suelto y
    ahi un width en porcentaje no tiene contra que resolver.
  */
  it("el isotipo original conserva su tamaño en pixeles", () => {
    expect(ISOTIPO).toContain('width="100"');
    expect(ISOTIPO).not.toContain("width:100%");
  });
});
