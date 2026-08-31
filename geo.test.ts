import { describe, expect, it } from "vitest";
import { distanceM, makeFrame, toGeo, toLocal } from "../src/geo/frame.js";
import { projectOnSegment } from "../src/geo/segment.js";
import { utmToWgs84, wgs84ToUtm } from "../src/geo/utm.js";

const EDENVALE_ISH = { lat: -27.4, lon: 152.7 };

describe("marco local", () => {
  it("va y vuelve sin perder precision a escala de parque", () => {
    const frame = makeFrame(EDENVALE_ISH.lat, EDENVALE_ISH.lon);
    for (const [dx, dy] of [
      [0, 0],
      [1200, -800],
      [-3000, 2500],
      [0.5, 0.5],
    ] as const) {
      const geo = toGeo(frame, dx, dy);
      const back = toLocal(frame, geo.lat, geo.lon);
      expect(back.x).toBeCloseTo(dx, 6);
      expect(back.y).toBeCloseTo(dy, 6);
    }
  });

  it("mide un grado de latitud dentro del rango real del elipsoide", () => {
    const frame = makeFrame(EDENVALE_ISH.lat, EDENVALE_ISH.lon);
    const d = distanceM(frame, EDENVALE_ISH, { lat: EDENVALE_ISH.lat + 1, lon: EDENVALE_ISH.lon });
    // Un grado de meridiano ronda 110.6 km a esta latitud.
    expect(d).toBeGreaterThan(110000);
    expect(d).toBeLessThan(111500);
  });

  it("mide un grado de longitud mas corto que uno de latitud fuera del ecuador", () => {
    const frame = makeFrame(EDENVALE_ISH.lat, EDENVALE_ISH.lon);
    const lat = distanceM(frame, EDENVALE_ISH, { lat: EDENVALE_ISH.lat + 1, lon: EDENVALE_ISH.lon });
    const lon = distanceM(frame, EDENVALE_ISH, { lat: EDENVALE_ISH.lat, lon: EDENVALE_ISH.lon + 1 });
    expect(lon).toBeLessThan(lat);
    expect(lon / lat).toBeCloseTo(Math.cos(EDENVALE_ISH.lat * (Math.PI / 180)), 2);
  });
});

describe("proyeccion sobre el segmento", () => {
  const a = { x: 0, y: 0 };
  const b = { x: 100, y: 0 };

  it("da t y distancia perpendicular correctas", () => {
    const p = projectOnSegment({ x: 25, y: 4 }, a, b);
    expect(p.t).toBeCloseTo(0.25, 12);
    expect(p.alongM).toBeCloseTo(25, 12);
    expect(p.offAxisM).toBeCloseTo(4, 12);
  });

  it("da la distancia perpendicular sin signo, de los dos lados", () => {
    expect(projectOnSegment({ x: 50, y: 7 }, a, b).offAxisM).toBeCloseTo(7, 12);
    expect(projectOnSegment({ x: 50, y: -7 }, a, b).offAxisM).toBeCloseTo(7, 12);
  });

  it("no recorta t: un punto pasado la punta lo dice", () => {
    expect(projectOnSegment({ x: 130, y: 0 }, a, b).t).toBeCloseTo(1.3, 12);
    expect(projectOnSegment({ x: -10, y: 0 }, a, b).t).toBeCloseTo(-0.1, 12);
  });

  it("funciona con el segmento en diagonal", () => {
    const p = projectOnSegment({ x: 10, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 10 });
    expect(p.alongM).toBeCloseTo(Math.sqrt(50), 12);
    expect(p.offAxisM).toBeCloseTo(Math.sqrt(50), 12);
  });
});

describe("UTM", () => {
  it("va y vuelve sobre puntos del sudeste de Queensland", () => {
    for (const pt of [
      { lat: -27.4, lon: 152.7 },
      { lat: -27.9123, lon: 153.4011 },
      { lat: -26.1, lon: 152.05 },
    ]) {
      const utm = wgs84ToUtm(pt.lat, pt.lon, 56);
      const back = utmToWgs84(utm);
      expect(back.lat).toBeCloseTo(pt.lat, 8);
      expect(back.lon).toBeCloseTo(pt.lon, 8);
    }
  });

  it("pone el meridiano central de la zona 56 en 153 grados este", () => {
    const p = utmToWgs84({ easting: 500000, northing: 6_965_000, zone: 56, hemisphere: "S" });
    expect(p.lon).toBeCloseTo(153, 9);
    expect(p.lat).toBeLessThan(-27);
    expect(p.lat).toBeGreaterThan(-28);
  });

  it("elige sola la zona correcta si no se la pasan", () => {
    expect(wgs84ToUtm(-27.4, 152.7).zone).toBe(56);
    expect(wgs84ToUtm(-27.4, 152.7).hemisphere).toBe("S");
  });
});
