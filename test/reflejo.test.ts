/**
 * Que ve la camara reflejado en el vidrio.
 *
 * Mateo pregunto si el reflejo iba a aparecer volando de costado, porque la
 * vez anterior lo habia visto con unos 15 o 20 grados entre panel y gimbal.
 * Tenia razon en preocuparse, y al medirlo aparecio que la regla vieja estaba
 * apuntada al peligro equivocado: en un tracker de UN EJE norte-sur el panel
 * nunca apunta al sol —el angulo entre los dos va de 23 a 34 grados todo el
 * dia en su parque— asi que el reflejo del sol no cae cerca del perpendicular.
 * Lo que ensucia las fotos es el HORIZONTE, y de eso se escapa mirando de
 * frente al panel, no de costado.
 */
import { describe, expect, it } from "vitest";
import { CIELO_LIMPIO_DEG, reflejoDelVidrio } from "../app/reflejo";
import { vistaParaLaHora, DESVIO_MAXIMO_DEG, TRACKER_CASI_PLANO_DEG } from "../app/mission";

// El parque de Mateo, en Queensland.
const LAT = -26.932, LON = 150.583;
/*
  El campo real del M4T termico, derivado del DFOV 45° de la ficha — que
  coincide con lo que declara el EXIF de las fotos de Mateo (52 mm
  equivalentes) y con lo que se mide sobre la imagen: el paso entre filas, que
  son 5,29 m relevados, ocupa 110 pixeles de 640 a 52 m de altura.
*/
const HFOV = 35.8, VFOV = 29.0;
/** Hora local de Queensland (UTC+10, sin horario de verano). */
const local = (h: number, m = 0) => new Date(Date.UTC(2026, 8, 4, h - 10, m));

const mirar = (h: number, m: number, trackerDeg: number, desvioDeg: number) =>
  reflejoDelVidrio(LAT, LON, local(h, m), trackerDeg, desvioDeg, HFOV, VFOV);

describe("la camara apunta perpendicular al panel", () => {
  it("copia el angulo del tracker, para el mismo lado", () => {
    expect(vistaParaLaHora(30)).toEqual({ desvioDeg: 30, hacia: 1 });
    expect(vistaParaLaHora(-30)).toEqual({ desvioDeg: 30, hacia: -1 });
  });

  it("con el tracker casi plano no mueve el gimbal", () => {
    expect(vistaParaLaHora(TRACKER_CASI_PLANO_DEG - 0.5)).toBeNull();
    expect(vistaParaLaHora(0)).toBeNull();
  });

  /*
    Una camara muy oblicua estira tanto la huella que el borde lejano deja de
    resolver la celda, y eso es peor que un reflejo.
  */
  it("no pasa del tope aunque el tracker este contra el suyo", () => {
    expect(vistaParaLaHora(55)!.desvioDeg).toBe(DESVIO_MAXIMO_DEG);
  });
});

describe("el reflejo del horizonte, que es el que ensucia", () => {
  /*
    El vuelo del 4/9 a las 14:20: tracker a -41 grados, camara a plomo. Es el
    que Mateo miro y donde vio "el reflejo del modulo mas caliente".
  */
  it("reproduce el vuelo de las 14:20 a plomo: el vidrio devolvia suelo", () => {
    const r = mirar(14, 20, -41, 0);
    expect(r.centroDeg).toBeLessThan(15);
    expect(r.bordeDeg).toBeLessThan(0);
    expect(r.veredicto).toBe("sucio");
    expect(r.porQue).toContain("suelo");
  });

  it("y perpendicular, a esa misma hora, sube el reflejo al cielo", () => {
    const plomo = mirar(14, 20, -41, 0);
    const perp = mirar(14, 20, -41, -41);
    expect(perp.centroDeg).toBeGreaterThan(plomo.centroDeg + 25);
    expect(perp.bordeDeg).toBeGreaterThan(CIELO_LIMPIO_DEG);
    expect(perp.veredicto).toBe("limpio");
  });

  /*
    Las 9:30 es la hora que Mateo quiere volar. A plomo no sirve; perpendicular
    si — y esa es toda la diferencia entre poder volar temprano o no.
  */
  /*
    Las 9:30 es la hora que Mateo quiere volar, y la respuesta honesta es "casi".

    El tope de 35 grados no es un capricho: a 40 el borde lejano del cuadro cae
    a 65 grados de la vertical y la huella se estira x2,4 — 13 cm por pixel
    contra una celda de 16, o sea que la celda deja de resolverse. Asi que a
    las 9:30, con el tracker a 42, la camara queda 7 grados corta del
    perpendicular y el borde del cuadro refleja a 16 grados: al filo. Diez
    minutos mas tarde ya esta limpio, y eso se le dice en pantalla en vez de
    darlo por bueno.
  */
  it("a las 9:30 a plomo no sirve y perpendicular si", () => {
    expect(mirar(9, 30, 42, 0).veredicto).toBe("sucio");
    // Con el angulo que da el planificador de verdad: a 42 grados el tope de
    // 35 lo deja corto, y aun asi el borde del cuadro refleja cielo.
    const v = vistaParaLaHora(42)!;
    expect(v.desvioDeg).toBe(DESVIO_MAXIMO_DEG);
    const r = mirar(9, 30, 42, v.desvioDeg * v.hacia);
    expect(r.veredicto).toBe("limpio");
    expect(r.bordeDeg).toBeGreaterThan(CIELO_LIMPIO_DEG);
  });

  it("al mediodia, con los trackers planos, a plomo ya esta limpio", () => {
    const r = mirar(12, 0, -1, 0);
    expect(r.veredicto).toBe("limpio");
    expect(r.bordeDeg).toBeGreaterThan(50);
  });
});

/*
  El reflejo del sol es otra cosa: una mancha que satura. En un tracker de un
  eje norte-sur cae A LO LARGO de la fila, que es donde el cuadro es mas
  angosto, y por eso queda afuera casi todo el dia.
*/
/*
  El reflejo del sol es otra cosa: una mancha que satura. En un tracker de un
  eje norte-sur cae A LO LARGO de la fila, que es donde el cuadro es mas
  angosto, y por eso en el parque de Mateo con el M4T no entra nunca.
*/
describe("el reflejo del sol", () => {
  it("con el M4T en este parque no entra en el cuadro en todo el dia", () => {
    for (let h = 8; h <= 16; h++) {
      const v = vistaParaLaHora(h < 12 ? 45 : -45)!;
      const r = mirar(h, 0, h < 12 ? 45 : -45, v.desvioDeg * v.hacia);
      expect(r.solEnElCuadro, `${h}h`).toBe(false);
    }
  });

  /*
    Pero la comprobacion tiene que existir igual: con una camara de campo
    ancho, o en otra latitud, el reflejo del sol si entra — y cuando entra
    manda sobre todo lo demas, porque no sirve de nada que el resto del cuadro
    refleje cielo si hay una mancha saturada.
  */
  it("con una camara de campo ancho entra, y el veredicto pasa a sucio", () => {
    const ancha = reflejoDelVidrio(LAT, LON, local(10, 0), 34, 34, 90, 80);
    expect(ancha.solEnElCuadro).toBe(true);
    expect(ancha.veredicto).toBe("sucio");
    expect(ancha.porQue).toContain("sol");
  });

  it("y cuando no entra, dice a cuanto quedo del borde", () => {
    const r = mirar(12, 0, -1, 0);
    expect(r.solEnElCuadro).toBe(false);
    expect(r.margenDelSolDeg).toBeGreaterThan(0);
  });
});
