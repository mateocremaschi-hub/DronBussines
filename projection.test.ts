/**
 * Donde cae cada foto sobre el parque.
 *
 * La prueba que vale es la ida y vuelta: se toma un punto del terreno, se
 * calcula en que pixel de la foto cae, y desde ese pixel se vuelve al terreno.
 * Si las dos cuentas no cierran, el recorte del modulo va a mostrar el panel
 * de al lado — y nadie se va a dar cuenta, porque un panel se parece mucho al
 * de al lado.
 */

import { describe, expect, it } from "vitest";
import { CAMARAS } from "../app/mission";
import {
  aplicarAjuste,
  cubre,
  footprint,
  fotosQueCubren,
  pixelOf,
  type PhotoPose,
} from "../app/projection";
import { makeFrame, toGeo } from "../src/index.js";

const camera = CAMARAS[0]!; // Mavic 3T termica: 640x512, HFOV 45.8 x VFOV 37.3
const frame = makeFrame(-26.92, 150.58);

/** Una pose sobre el origen del marco local, a plomo salvo que se diga otra cosa. */
const pose = (o: Partial<PhotoPose> = {}): PhotoPose => ({
  lat: -26.92, lon: 150.58, altitudeAglM: 40, gimbalYawDeg: 0, gimbalPitchDeg: -90, ...o,
});

/** Punto del terreno a `dx` metros al este y `dy` al norte del origen. */
const punto = (dx: number, dy: number) => ({ x: dx, y: dy });

// ---------------------------------------------------------------------------

describe("la huella de una foto", () => {
  it("a plomo, el centro de la foto es el punto de abajo del dron", () => {
    const f = footprint(frame, pose(), camera);
    expect(f.centre.x).toBeCloseTo(0, 6);
    expect(f.centre.y).toBeCloseTo(0, 6);
    expect(f.tiltOffsetM).toBeCloseTo(0, 6);
    expect(f.confiable).toBe(true);
  });

  it("el tamaño sale del campo de vision y la altura", () => {
    const f = footprint(frame, pose({ altitudeAglM: 40 }), camera);
    // 2 x 40 x tan(22.9°) = 33.8 m de ancho
    expect(f.anchoM).toBeCloseTo(33.79, 2);
    expect(f.altoM).toBeCloseTo(27.03, 2);
  });

  it("al doble de altura, el doble de huella", () => {
    const a = footprint(frame, pose({ altitudeAglM: 20 }), camera);
    const b = footprint(frame, pose({ altitudeAglM: 40 }), camera);
    expect(b.anchoM / a.anchoM).toBeCloseTo(2, 6);
  });

  // El error del que veniamos hablando, ahora en la proyeccion.
  it("con el gimbal inclinado, el centro se corre hacia donde mira", () => {
    const f = footprint(frame, pose({ gimbalPitchDeg: -85, gimbalYawDeg: 90 }), camera);
    expect(f.tiltOffsetM).toBeCloseTo(40 * Math.tan(5 * Math.PI / 180), 3); // 3.5 m
    // Yaw 90 es al este: se corre en x, no en y.
    expect(f.centre.x).toBeCloseTo(f.tiltOffsetM, 3);
    expect(f.centre.y).toBeCloseTo(0, 6);
  });

  it("se declara poco confiable cuando la inclinacion deja de ser un rectangulo", () => {
    expect(footprint(frame, pose({ gimbalPitchDeg: -85 }), camera).confiable).toBe(true);
    expect(footprint(frame, pose({ gimbalPitchDeg: -70 }), camera).confiable).toBe(false);
    expect(footprint(frame, pose({ gimbalPitchDeg: -45 }), camera).confiable).toBe(false);
  });

  it("el rumbo del gimbal rota la huella", () => {
    const f = footprint(frame, pose({ gimbalYawDeg: 90 }), camera);
    // Rotada 90 grados, el lado largo de la imagen pasa a correr norte-sur.
    const [no, ne] = f.corners;
    expect(Math.abs(ne.y - no.y)).toBeGreaterThan(Math.abs(ne.x - no.x));
  });
});

// ---------------------------------------------------------------------------

describe("del terreno al pixel", () => {
  it("el centro de la foto es el centro de la imagen", () => {
    const f = footprint(frame, pose(), camera);
    const p = pixelOf(f, punto(0, 0), camera)!;
    expect(p.px).toBeCloseTo(camera.imageW / 2, 6);
    expect(p.py).toBeCloseTo(camera.imageH / 2, 6);
  });

  // Un panel al norte tiene que aparecer ARRIBA en la imagen, no abajo.
  it("no invierte el eje vertical de la imagen", () => {
    const f = footprint(frame, pose(), camera);
    const norte = pixelOf(f, punto(0, 6), camera)!;
    const sur = pixelOf(f, punto(0, -6), camera)!;
    expect(norte.py).toBeLessThan(camera.imageH / 2);
    expect(sur.py).toBeGreaterThan(camera.imageH / 2);
  });

  it("un punto fuera del cuadro no devuelve un pixel inventado", () => {
    const f = footprint(frame, pose(), camera);
    expect(pixelOf(f, punto(100, 0), camera)).toBeNull();
    expect(cubre(f, punto(100, 0), camera)).toBe(false);
    expect(cubre(f, punto(6, 6), camera)).toBe(true);
  });

  // La prueba que importa: ida y vuelta sobre una grilla de puntos.
  it("va y vuelve sin correrse, con la camara rotada y todo", () => {
    for (const yaw of [0, 37, 90, 180, 271]) {
      const f = footprint(frame, pose({ gimbalYawDeg: yaw }), camera);
      for (let dx = -10; dx <= 10; dx += 5) {
        for (let dy = -8; dy <= 8; dy += 4) {
          const p = pixelOf(f, punto(dx, dy), camera);
          if (!p) continue;
          // Del pixel de vuelta al terreno, deshaciendo la misma cuenta.
          const u = (p.px / camera.imageW - 0.5) * f.anchoM;
          const v = (0.5 - p.py / camera.imageH) * f.altoM;
          const r = yaw * Math.PI / 180;
          const x = f.centre.x + u * Math.cos(r) + v * Math.sin(r);
          const y = f.centre.y - u * Math.sin(r) + v * Math.cos(r);
          expect(Math.hypot(x - dx, y - dy)).toBeLessThan(1e-9);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------

describe("elegir la mejor foto de un modulo", () => {
  const enPunto = (dx: number, dy: number, id: string) => ({
    foto: id,
    huella: footprint(
      frame,
      { ...toGeo(frame, dx, dy), altitudeAglM: 40, gimbalYawDeg: 0, gimbalPitchDeg: -90 },
      camera,
    ),
  });

  // Con 80 % de solape un modulo sale en varias fotos, y no dan lo mismo: en
  // el borde del cuadro la termica lo ve de costado.
  it("prefiere la foto que lo tiene mas cerca del centro", () => {
    const fotos = [enPunto(10, 0, "borde"), enPunto(1, 0, "centro"), enPunto(-9, 0, "otro-borde")];
    const r = fotosQueCubren(punto(0, 0), fotos, camera);
    expect(r[0]!.foto).toBe("centro");
    expect(r[0]!.distanciaAlCentroM).toBeLessThan(2);
    expect(r).toHaveLength(3);
  });

  it("no devuelve las que no lo cubren", () => {
    const r = fotosQueCubren(punto(0, 0), [enPunto(200, 0, "lejos")], camera);
    expect(r).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------

describe("ajuste comun del vuelo", () => {
  // El GPS del dron se equivoca parejo, asi que se corrige una vez para todo.
  it("mueve la huella entera, centro y esquinas", () => {
    const f = footprint(frame, pose(), camera);
    const m = aplicarAjuste(f, { dxM: 3, dyM: -2 });
    expect(m.centre.x).toBeCloseTo(3, 6);
    expect(m.centre.y).toBeCloseTo(-2, 6);
    m.corners.forEach((c, i) => {
      expect(c.x).toBeCloseTo(f.corners[i]!.x + 3, 6);
      expect(c.y).toBeCloseTo(f.corners[i]!.y - 2, 6);
    });
  });

  it("sin ajuste no toca nada", () => {
    const f = footprint(frame, pose(), camera);
    expect(aplicarAjuste(f, { dxM: 0, dyM: 0 })).toBe(f);
  });

  it("corregido, un modulo que caia afuera pasa a estar cubierto", () => {
    const f = footprint(frame, pose({ altitudeAglM: 10 }), camera); // huella de 8.4 m
    const modulo = punto(6, 0);
    expect(cubre(f, modulo, camera)).toBe(false);
    expect(cubre(aplicarAjuste(f, { dxM: 3, dyM: 0 }), modulo, camera)).toBe(true);
  });
});
