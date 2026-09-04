/**
 * La caja de la punta de un string, cuando ahi no hay panel.
 *
 * Es lo que ordenaba la lista de hallazgos de los vuelos reales. El parque
 * dice que un string tiene 28 modulos y en el campo el ultimo lugar lo ocupa
 * el motor del tracker y el hueco hasta la fila siguiente. La caja cae ahi, el
 * suelo al sol lee mas caliente que los paneles, y la comparacion contra los
 * hermanos del string la reporta como anomalia. Sobre los dos vuelos reales
 * eran 9 de 10 hallazgos en uno y 8 de 9 en el otro, todos el modulo 28 o el
 * 1 — los dos que estan pegados a un hueco.
 */

import { describe, expect, it } from "vitest";
import edenvaleJson from "../farms/edenvale.json" with { type: "json" };
import { Acumulador, comparar } from "../app/detect";
import { camaraDesdeEquivalente35 } from "../app/mission";
import { compileFarm, makeFrame, modulesOfRow, toGeo } from "../src/index.js";
import type { FarmProfile } from "../src/types.js";
import { applyStrings } from "../app/strings";
import { makeRow } from "./helpers/synthetic.js";

const profile = edenvaleJson as unknown as FarmProfile;
const camara = camaraDesdeEquivalente35("prueba", 40, 640, 512);

const fila = makeRow(
  { id: "05-042-R1", block: "05", tracker: "05-042", row: "R1",
    anchor: { lat: -26.92, lon: 150.58 }, azimuthDeg: 180, side: "north" },
  profile,
);
const farm = compileFarm(profile, applyStrings([fila], {
  fieldIndex: 3,
  byRow: new Map([["05-042-R1", { labels: ["S-1.2.15.1", "S-1.2.15.2"], dcBox: "DCB-1.2.15" }]]),
  chains: new Map([["05-042-R1", { pos: 1, posTotal: 1 }]]),
}));
const marco = makeFrame(farm.origin.lat, farm.origin.lon);
const modulos = modulesOfRow(farm.rows[0]!, farm);
const centro = (() => {
  const x = modulos.reduce((a, m) => a + m.x, 0) / modulos.length;
  const y = modulos.reduce((a, m) => a + m.y, 0) / modulos.length;
  return toGeo(marco, x, y);
})();

const PASTO_C = 52, PANEL_C = 45;

const termica = (celsius: Float32Array) => ({
  width: 640, height: 512, celsius,
  escala: "de prueba", escalaAuto: "de prueba", topeC: 999, fraccionEnElTope: 0,
});

function volar(celsius: Float32Array): Acumulador {
  const acc = new Acumulador(farm, marco, {
    camera: camara, moduloAnchoM: profile.module.widthMm / 1000, moduloLargoM: 2.28,
  });
  acc.agregar({
    fileName: "T.JPG",
    radio: termica(celsius),
    pose: {
      lat: centro.lat, lon: centro.lon,
      altitudeAglM: 60, gimbalYawDeg: 0, gimbalPitchDeg: -90,
    },
  });
  return acc;
}

/** Pasto: caliente y con textura, que es lo que lo delata. */
function pasto(): Float32Array {
  const c = new Float32Array(640 * 512);
  let s = 99;
  for (let i = 0; i < c.length; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    c[i] = PASTO_C + (s / 0x7fffffff) * 7;
  }
  return c;
}

/** Pinta una caja, lisa, con la temperatura que se pida. */
function pintar(c: Float32Array, caja: any, grados: number, escala = 1) {
  const cos = Math.cos(caja.rotRad), sin = Math.sin(caja.rotRad);
  const hw = (caja.largo / 2) * escala, hh = (caja.cruzado / 2) * escala;
  const ext = Math.ceil(Math.hypot(caja.largo, caja.cruzado) / 2) + 2;
  for (let y = Math.max(0, Math.floor(caja.cy - ext)); y <= Math.min(511, Math.ceil(caja.cy + ext)); y++) {
    for (let x = Math.max(0, Math.floor(caja.cx - ext)); x <= Math.min(639, Math.ceil(caja.cx + ext)); x++) {
      const dx = x - caja.cx, dy = y - caja.cy;
      if (Math.abs(dx * cos + dy * sin) > hw) continue;
      if (Math.abs(-dx * sin + dy * cos) > hh) continue;
      c[y * 640 + x] = grados;
    }
  }
}

/** Donde cayo cada modulo, para poder pintar el panel exactamente ahi. */
const previas = volar(new Float32Array(640 * 512).fill(PANEL_C)).muestras();
/*
  Las puntas salen del parque entero, no de lo que se midio: el motor sabe
  cual es el primer y el ultimo modulo de cada string aunque uno de los dos
  haya quedado afuera del cuadro.
*/
const puntas = new Set<number>();
for (const m of modulos) {
  const nums = modulos.filter((o) => o.stringNumber === m.stringNumber).map((o) => o.module);
  if (m.module === Math.min(...nums) || m.module === Math.max(...nums)) {
    puntas.add(m.positionInRow);
  }
}

/** Las puntas que ademas entraron enteras en el cuadro: las unicas medibles. */
const puntasEnCuadro = new Set(
  previas.map((m) => m.modulo.positionInRow).filter((p) => puntas.has(p)),
);

describe("la punta de un string donde no hay panel", () => {
  it("no se mide, en vez de salir como hallazgo", () => {
    /*
      Todo pasto, y encima se pinta el panel de cada modulo MENOS el ultimo y
      el primero de cada string: en esos dos lugares el campo tiene el motor
      del tracker y el hueco, que es exactamente lo que pasa en Wellington.
    */
    const c = pasto();
    for (const m of previas) {
      if (!puntas.has(m.modulo.positionInRow)) pintar(c, m.caja, PANEL_C, 1.3);
    }
    const acc = volar(c);
    const medidos = new Set(acc.muestras().map((m) => m.modulo.positionInRow));
    expect(puntasEnCuadro.size).toBeGreaterThan(0);
    for (const p of puntasEnCuadro) {
      expect(medidos.has(p), `la punta ${p} se midio sobre pasto`).toBe(false);
    }
    expect(medidos.size).toBeGreaterThan(previas.length - puntas.size - 4);

    // Y no hay ni un hallazgo: el pasto caliente ya no entra en la comparacion.
    expect(comparar(acc.muestras()).filter((h) => h.severidad !== "normal")).toEqual([]);

    // Ademas dice CUAL modulo fue, que es lo que permite arreglar el parque.
    const donde = acc.modulosFueraDelPanel();
    expect(donde.length).toBeGreaterThan(0);
    expect(donde[0]!.casos).toBeGreaterThan(0);
  });

  it("cuenta cada modulo una vez, no cada vez que cayo mal", () => {
    /*
      El aviso decia "293 modulos quedaron sin medir" y arriba "de esos, 663
      son el modulo 28". Mas que el total: se contaban las veces y no los
      modulos, y un numero que no cierra deja de servir justo cuando lo que
      dice es la pista para arreglar el parque.
    */
    const c = pasto();
    for (const m of previas) {
      if (!puntas.has(m.modulo.positionInRow)) pintar(c, m.caja, PANEL_C, 1.3);
    }
    const acc = volar(c);
    // La misma foto dos veces: los mismos modulos caen mal dos veces.
    acc.agregar({
      fileName: "T2.JPG",
      radio: termica(c),
      pose: {
        lat: centro.lat, lon: centro.lon,
        altitudeAglM: 60, gimbalYawDeg: 0, gimbalPitchDeg: -90,
      },
    });
    const total = acc.modulosFueraDelPanel().reduce((a, x) => a + x.casos, 0);
    expect(total).toBe(acc.cajasFueraDelPanel());
    expect(total).toBeLessThanOrEqual(puntasEnCuadro.size);
  });

  it("si en la punta SI hay panel, se mide como cualquier otro", () => {
    const c = pasto();
    for (const m of previas) pintar(c, m.caja, PANEL_C, 1.3);
    const acc = volar(c);
    const medidos = new Set(acc.muestras().map((m) => m.modulo.positionInRow));
    for (const p of puntasEnCuadro) {
      expect(medidos.has(p), `la punta ${p} tenia panel y no se midio`).toBe(true);
    }
    expect(acc.modulosFueraDelPanel()).toEqual([]);
  });

  it("en el medio del string el freno no se aplica: un defecto grande sigue saliendo", () => {
    /*
      Este es el limite del arreglo y por eso esta escrito. Un defecto de
      verdad tambien despega puntos de la mediana de su caja —un diodo de
      bypass parte el modulo al medio— asi que el mismo freno aplicado en el
      medio de la fila cambiaria hallazgos falsos por defectos perdidos. Solo
      corre en las puntas, que es donde el parque se equivoca.
    */
    const c = pasto();
    for (const m of previas) pintar(c, m.caja, PANEL_C, 1.3);
    const medio = previas.find((m) => !puntas.has(m.modulo.positionInRow))!;
    // Media caja 25 grados por encima: parte el modulo al medio, como un diodo.
    pintar(c, { ...medio.caja, largo: medio.caja!.largo / 2,
      cx: medio.caja!.cx - (medio.caja!.largo / 4) * Math.cos(medio.caja!.rotRad),
      cy: medio.caja!.cy - (medio.caja!.largo / 4) * Math.sin(medio.caja!.rotRad) },
      PANEL_C + 25, 1);
    const acc = volar(c);
    const suyo = acc.muestras().find((m) => m.modulo.positionInRow === medio.modulo.positionInRow);
    expect(suyo, "el modulo partido al medio no se midio").toBeDefined();
    const hallazgos = comparar(acc.muestras()).filter((h) => h.severidad !== "normal");
    expect(hallazgos.map((h) => h.modulo.positionInRow)).toContain(medio.modulo.positionInRow);
  });
});
