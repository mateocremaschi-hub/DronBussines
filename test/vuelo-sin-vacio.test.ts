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
 * filas que de verdad sobrevuela baja al 3 %, y lo que quedaba eran los huecos
 * que caen por el MEDIO de una pasada — un camino, o el campo entre dos bloques
 * sueltos que se eligieron juntos. Esos se sacan partiendo la pasada en tramos,
 * que es lo que se prueba en el segundo grupo de abajo.
 */

import { describe, expect, it } from "vitest";
import edenvale from "../farms/edenvale.json" with { type: "json" };
import type { FarmProfile, TrackerRow } from "../src/types.js";
import { CAMARAS, OPCIONES_POR_DEFECTO, planMission } from "../app/mission";
import { makeFrame, toLocal } from "../src/geo/frame.js";
import { makeRow, nominalLengthM } from "./helpers/synthetic.js";

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
  /*
    Este test comparaba la linea mas corta contra la mas larga: sobre las tres
    columnas que tienen los dos brazos, la pasada iba de punta a punta y 335 de
    sus 400 m eran campo, asi que era mucho mas larga que las demas. Ahora esa
    pasada se parte en dos tramos y NINGUNA linea cruza el hueco, con lo cual
    todas miden lo mismo y la comparacion vieja se quedo sin nada que comparar
    —fallaba, y no porque el vuelo estuviera peor—. Lo que hay que verificar
    pasa a ser mas fuerte: que ninguna linea sea larga como para ir de un brazo
    al otro, y que igual se vuelen los dos.
  */
  it("ninguna linea cruza el campo que separa los dos brazos", () => {
    const rows = enEle();
    const m = plan(rows);
    const frame = makeFrame(rows[0]!.start.lat, rows[0]!.start.lon);

    // Las filas van al norte, y se vuela a lo largo de ellas: el eje de vuelo
    // es la latitud, asi que alcanza con mirar la componente norte.
    const tramos = m.lines.map((l) => {
      const a = toLocal(frame, l.a.lat, l.a.lon);
      const b = toLocal(frame, l.b.lat, l.b.lon);
      return { largo: Math.hypot(b.x - a.x, b.y - a.y), medio: (a.y + b.y) / 2 };
    });

    // Un brazo mide una fila mas el margen de cada punta. Ni una linea mas.
    const brazo = nominalLengthM(profile) + 2 * OPCIONES_POR_DEFECTO.marginM;
    expect(Math.max(...tramos.map((t) => t.largo))).toBeLessThan(brazo + 1);

    // Y los dos brazos se vuelan: el corto arranca 400 m al norte del largo.
    expect(tramos.some((t) => t.medio > 200)).toBe(true);
    expect(tramos.some((t) => t.medio < 200)).toBe(true);
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

// ---------------------------------------------------------------------------
// Pasadas partidas en tramos
//
// Desde que la pantalla deja marcar varios bloques a gusto, la seleccion normal
// ya no es un bloque macizo: son dos o tres bloques, a veces con medio kilometro
// de campo en el medio. Ese hueco cae por DENTRO de la pasada, no por afuera,
// asi que el recorte de las puntas no lo toca — hay que partir la pasada.
//
// La cuenta contra la que se compara es la del rectangulo unico: lo que costaba
// la misma seleccion cuando cada pasada iba de la primera fila a la ultima de
// una sola tirada. Se calcula a mano con los mismos numeros que devuelve el
// plan (cada cuantos metros dispara, cuanto separa las pasadas) para que la
// comparacion no dependa de haber guardado el codigo viejo.
// ---------------------------------------------------------------------------

const M_POR_GRADO_LAT = 110946;

/**
 * Dos bloques de `columnas` filas cada uno, uno al norte del otro, con
 * `huecoM` metros de campo entre la punta de arriba de uno y la de abajo del
 * otro. Las columnas son las mismas, asi que TODA pasada cruza los dos.
 */
function dosBloquesEnLinea(columnas: number, huecoM: number): TrackerRow[] {
  const norte = (nominalLengthM(profile) + huecoM) / M_POR_GRADO_LAT;
  const bloque = (nombre: string, lat: number) =>
    Array.from({ length: columnas }, (_, i) => makeRow({
      id: `${nombre}${i}`, block: nombre, tracker: `${nombre}-${i}`,
      anchor: { lat, lon: 150.58 + i * 0.0002 }, azimuthDeg: 0,
    }, profile));
  return [...bloque("11", -26.9), ...bloque("13", -26.9 + norte)];
}

/** Lo que costaba la misma seleccion barriendo el rectangulo que la envuelve. */
function comoRectanguloUnico(m: ReturnType<typeof plan>, pasadas: number, largoM: number) {
  const fotos = pasadas * (Math.floor(largoM / m.stats.disparoCadaM) + 1);
  const distancia = pasadas * largoM + (pasadas - 1) * m.stats.separacionM;
  return {
    fotos,
    minutos: distancia / OPCIONES_POR_DEFECTO.speedMps / 60 + ((pasadas - 1) * 30) / 60,
  };
}

const largosDe = (m: ReturnType<typeof plan>) => {
  const frame = makeFrame(m.lines[0]!.a.lat, m.lines[0]!.a.lon);
  return m.lines.map((l) => {
    const a = toLocal(frame, l.a.lat, l.a.lon);
    const b = toLocal(frame, l.b.lat, l.b.lon);
    return Math.hypot(b.x - a.x, b.y - a.y);
  });
};

describe("dos bloques sueltos elegidos juntos", () => {
  const HUECO = 600;
  const largoFila = nominalLengthM(profile);
  const margen = OPCIONES_POR_DEFECTO.marginM;

  it("cada pasada se parte en dos: ninguna cruza los 600 m de campo", () => {
    const m = plan(dosBloquesEnLinea(8, HUECO));
    const largos = largosDe(m);

    // Dos tramos por pasada, todos del largo de un bloque.
    expect(m.lines.length % 2).toBe(0);
    expect(Math.max(...largos)).toBeLessThan(largoFila + 2 * margen + 1);
    expect(Math.min(...largos)).toBeGreaterThan(largoFila + 2 * margen - 1);
    expect(m.stats.lineas).toBe(m.lines.length);
  });

  // Lo que el usuario ve en la pantalla y lo que le va a pasar en el campo.
  it("da menos fotos y menos minutos que barrer el rectangulo entero", () => {
    const m = plan(dosBloquesEnLinea(8, HUECO));
    const pasadas = m.lines.length / 2;
    const rectangulo = comoRectanguloUnico(
      m, pasadas, 2 * largoFila + HUECO + 2 * margen,
    );

    // El hueco es casi cinco veces un bloque: casi todos los disparos del
    // barrido de punta a punta caian sobre pasto.
    expect(m.stats.fotos).toBeLessThan(rectangulo.fotos * 0.3);
    expect(m.stats.minutos).toBeLessThan(rectangulo.minutos);
  });

  /*
    Partir las pasadas, solo, no ahorraria un metro: el dron cruzaria el hueco
    igual, una vez por pasada, y encima con un giro de mas en cada punta. Lo que
    lo ahorra es el orden — terminar un bloque entero antes de arrancar el otro.
    Aca se mide lo que el dron vuela SIN sacar fotos: tienen que ser los saltos
    entre pasadas vecinas de los dos bloques mas UN cruce del hueco.
  */
  it("cruza el hueco una sola vez, no una por pasada", () => {
    const m = plan(dosBloquesEnLinea(8, HUECO));
    const pasadas = m.lines.length / 2;
    const volado = m.lines.reduce((s, l) => s + l.largoM, 0);
    const traslados = m.stats.distanciaM - volado;

    // El cruce entra por la punta mas cercana, que en el peor caso es la de
    // enfrente: un hueco mas un bloque.
    const unCruce = HUECO + largoFila;
    const entrePasadas = 2 * (pasadas - 1) * m.stats.separacionM;
    expect(traslados).toBeLessThan(unCruce + entrePasadas + 1);
    // Y cruzarlo una vez por pasada seria varias veces eso.
    expect(traslados).toBeLessThan(pasadas * HUECO * 0.3);
  });
});

describe("dos bloques pegados no se parten de mas", () => {
  /** `n` columnas seguidas a la misma latitud, con la separacion de siempre. */
  const columnas = (nombre: string, desde: number, n: number): TrackerRow[] =>
    Array.from({ length: n }, (_, i) => makeRow({
      id: `${nombre}${i}`, block: nombre, tracker: `${nombre}-${i}`,
      anchor: { lat: -26.9, lon: 150.58 + (desde + i) * 0.0002 }, azimuthDeg: 0,
    }, profile));

  it("dos bloques lado a lado dan el mismo vuelo que uno solo del doble", () => {
    const juntos = plan([...columnas("11", 0, 8), ...columnas("12", 8, 8)]);
    const macizo = plan(columnas("11", 0, 16));

    expect(juntos.lines.length).toBe(macizo.lines.length);
    expect(juntos.stats.fotos).toBe(macizo.stats.fotos);
    const largos = largosDe(juntos);
    expect(Math.max(...largos) - Math.min(...largos)).toBeLessThan(1);
  });

  /*
    El caso que decide el corte. Un camino de servicio entre dos bloques es un
    hueco real, pero partir ahi cuesta un giro por pasada — y un giro cuesta los
    mismos segundos que se ahorrarian de no cruzarlo. Partir cada camino saldria
    mas caro que cruzarlo sacando unas fotos de mas, asi que no se parte.
  */
  it("un camino de 20 m entre dos bloques no parte la pasada", () => {
    const norte = (nominalLengthM(profile) + 20) / M_POR_GRADO_LAT;
    const rows = [
      ...columnas("11", 0, 8),
      ...columnas("12", 0, 8).map((r) => ({
        ...r,
        start: { ...r.start, lat: r.start.lat + norte },
        end: { ...r.end, lat: r.end.lat + norte },
      })),
    ];
    const m = plan(rows);
    const largos = largosDe(m);

    // Una sola tirada por pasada, de punta a punta de los dos bloques.
    expect(Math.min(...largos)).toBeGreaterThan(2 * nominalLengthM(profile) + 20);
    expect(Math.max(...largos) - Math.min(...largos)).toBeLessThan(1);
  });
});
