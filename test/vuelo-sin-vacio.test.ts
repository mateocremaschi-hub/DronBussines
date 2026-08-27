/**
 * El dron no vuela sobre lo que no hay.
 *
 * Las lineas iban de punta a punta del rectangulo que envuelve al bloque. Pero
 * un bloque no es un rectangulo: se escalona, lo cruzan caminos, tiene una
 * subestacion en una esquina y una laguna en la otra. Barrer el rectangulo
 * entero manda al dron a fotografiar tierra.
 *
 * Medido sobre Edenvale con la configuracion real —Matrice 4T, 50 m, solape
 * 0.45—: el 14 % de los disparos no tenia un solo modulo debajo. Una hora de
 * vuelo por medio parque, o sea una bateria entera. Recortando cada linea a las
 * filas que de verdad sobrevuela baja al 3 %, y lo que queda son los caminos
 * que cruzan por el medio de una linea, que solo se sacarian partiendola en
 * tramos.
 */

import { describe, expect, it } from "vitest";
import edenvale from "../farms/edenvale.json" with { type: "json" };
import type { FarmProfile, TrackerRow } from "../src/types.js";
import { CAMARAS, OPCIONES_POR_DEFECTO, planMission } from "../app/mission";
import { makeFrame, toLocal } from "../src/geo/frame.js";
import { makeRow } from "./helpers/synthetic.js";

const profile = edenvale as unknown as FarmProfile;
const cam = CAMARAS[0]!;

/** Filas en L: un brazo largo y uno corto, como un bloque escalonado. */
function enEle(): TrackerRow[] {
  const out: TrackerRow[] = [];
  // Brazo largo: 12 filas, todas arrancando a la misma latitud.
  for (let i = 0; i < 12; i++) {
    out.push(makeRow({
      id: `L${i}`, block: "04", tracker: `04-L${i}`,
      anchor: { lat: -26.9, lon: 150.58 + i * 0.0002 }, azimuthDeg: 0,
    }, profile));
  }
  // Brazo corto: 3 filas mas, corridas 400 m al norte.
  for (let i = 0; i < 3; i++) {
    out.push(makeRow({
      id: `C${i}`, block: "04", tracker: `04-C${i}`,
      anchor: { lat: -26.8964, lon: 150.58 + i * 0.0002 }, azimuthDeg: 0,
    }, profile));
  }
  return out;
}

const plan = (rows: TrackerRow[]) =>
  planMission(rows, profile, { ...OPCIONES_POR_DEFECTO, altitudeM: 50, camera: cam })!;

describe("las lineas se recortan a las filas", () => {
  it("las lineas sobre el brazo corto no llegan hasta el otro extremo", () => {
    const rows = enEle();
    const m = plan(rows);
    const frame = makeFrame(rows[0]!.start.lat, rows[0]!.start.lon);

    const largos = m.lines.map((l) => {
      const a = toLocal(frame, l.a.lat, l.a.lon);
      const b = toLocal(frame, l.b.lat, l.b.lon);
      return Math.hypot(b.x - a.x, b.y - a.y);
    });
    const masLarga = Math.max(...largos);
    const masCorta = Math.min(...largos);

    // El brazo corto solo tiene filas arriba; su linea no puede medir lo mismo
    // que una que cruza los dos brazos.
    expect(masCorta).toBeLessThan(masLarga * 0.7);
  });

  it("no emite lineas donde no hay ninguna fila debajo", () => {
    // Dos grupos separados por 500 m de nada sobre el eje perpendicular.
    const rows = [
      ...Array.from({ length: 4 }, (_, i) => makeRow({
        id: `A${i}`, block: "04", tracker: `04-A${i}`,
        anchor: { lat: -26.9, lon: 150.58 + i * 0.0002 }, azimuthDeg: 0,
      }, profile)),
      ...Array.from({ length: 4 }, (_, i) => makeRow({
        id: `B${i}`, block: "04", tracker: `04-B${i}`,
        anchor: { lat: -26.9, lon: 150.586 + i * 0.0002 }, azimuthDeg: 0,
      }, profile)),
    ];
    const m = plan(rows);

    // Cuantas lineas haria falta para barrer el rectangulo entero.
    const ancho = 2 * 50 * Math.tan((cam.hfovDeg * Math.PI) / 360);
    const sep = ancho * (1 - OPCIONES_POR_DEFECTO.sideOverlap);
    const rectangulo = Math.ceil((600 + 2 * OPCIONES_POR_DEFECTO.marginM) / sep);

    expect(m.lines.length).toBeLessThan(rectangulo * 0.6);
    expect(m.stats.lineas).toBe(m.lines.length);
  });

  // Un bloque prolijo no tiene que perder nada por este recorte.
  it("sobre un bloque rectangular las lineas siguen llegando de punta a punta", () => {
    const rows = Array.from({ length: 10 }, (_, i) => makeRow({
      id: `R${i}`, block: "04", tracker: `04-R${i}`,
      anchor: { lat: -26.9, lon: 150.58 + i * 0.0002 }, azimuthDeg: 0,
    }, profile));
    const m = plan(rows);
    const frame = makeFrame(rows[0]!.start.lat, rows[0]!.start.lon);
    const largos = m.lines.map((l) => {
      const a = toLocal(frame, l.a.lat, l.a.lon);
      const b = toLocal(frame, l.b.lat, l.b.lon);
      return Math.hypot(b.x - a.x, b.y - a.y);
    });
    // Todas iguales: no hay nada que recortar.
    expect(Math.max(...largos) - Math.min(...largos)).toBeLessThan(1);
  });
});
