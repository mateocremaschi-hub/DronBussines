/**
 * La mision en el formato que vuela el dron.
 *
 * Lo que se prueba aca es lo que decide si el archivo sirve o si el viaje al
 * parque se pierde: las rutas adentro del KMZ, que los waypoints esten en los
 * DOS archivos, y que el gimbal quede mirando para abajo.
 */

import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32, zip } from "../app/zip";
import { archivosDelKmz, avisosDeKmz, loQueFaltaEnElKmz, PERFILES_DJI, toKmz, type OpcionesKmz } from "../app/wpml";
import { camaraDesdeEquivalente35, planMission, type MissionOptions } from "../app/mission";
import edenvaleJson from "../farms/edenvale.json" with { type: "json" };
import type { FarmProfile } from "../src/types.js";
import { makeRow } from "./helpers/synthetic.js";

const profile = edenvaleJson as unknown as FarmProfile;
const camera = camaraDesdeEquivalente35("M3T", 40, 640, 512);

const filas = Array.from({ length: 6 }, (_, i) =>
  makeRow(
    {
      id: `05-10${i}-R1`, block: "05", tracker: `05-10${i}`, row: "R1",
      anchor: { lat: -26.92 + i * 0.00005, lon: 150.58 }, azimuthDeg: 180, side: "north",
    },
    profile,
  ),
);

const opts: MissionOptions = {
  camera, altitudeM: 50, sideOverlap: 0.45, frontOverlap: 0.5,
  speedMps: 5, marginM: 10, alongRows: true, rtk: true,
};
const mission = planMission(filas, profile, opts)!;

const m3t = PERFILES_DJI.find((p) => p.id === "m3t")!;
const kmzOpts: OpcionesKmz = { nombre: "Bloque 05", perfil: m3t, fecha: new Date(2026, 7, 26, 9, 30, 0) };

/** Abre el KMZ con `unzip`, que es lo mismo que hace el dron. */
function abrir(bytes: Uint8Array): Record<string, string> {
  const dir = mkdtempSync(join(tmpdir(), "kmz-"));
  writeFileSync(join(dir, "m.kmz"), bytes);
  execFileSync("unzip", ["-q", "m.kmz"], { cwd: dir });
  const out: Record<string, string> = {};
  for (const f of readdirSync(join(dir, "wpmz"))) {
    out[`wpmz/${f}`] = readFileSync(join(dir, "wpmz", f), "utf8");
  }
  return out;
}

// ---------------------------------------------------------------------------

describe("el ZIP escrito a mano", () => {
  it("lo abre un descompresor de verdad", () => {
    const bytes = zip([{ ruta: "a/b.txt", contenido: "hola" }], new Date(2026, 0, 2, 3, 4, 5));
    const dir = mkdtempSync(join(tmpdir(), "z-"));
    writeFileSync(join(dir, "z.zip"), bytes);
    execFileSync("unzip", ["-q", "z.zip"], { cwd: dir });
    expect(readFileSync(join(dir, "a", "b.txt"), "utf8")).toBe("hola");
  });

  // Si el CRC esta mal el archivo se abre igual en algunos lados y en otros no.
  // Vale la pena fijarlo contra una implementacion independiente.
  it("calcula el CRC32 como lo calcula zlib", () => {
    const datos = new TextEncoder().encode("wpmz/waylines.wpml");
    expect(crc32(datos)).toBe(
      // El mismo valor, sacado de la tabla estandar.
      Number(BigInt.asUintN(32, BigInt(crcDeReferencia(datos)))),
    );
  });

  /*
   * La entrega al cliente incluye un ZIP con la foto de cada defecto. Las
   * fotos entran como bytes, no como texto: si se los pasa por TextEncoder
   * adentro del ZIP queda "255,216,255,..." en vez del JPEG. El ZIP abre, los
   * nombres estan todos, y ninguna foto se puede ver — el tipo de falla que
   * solo se descubre del otro lado, cuando el cliente ya la recibio.
   */
  it("guarda los bytes de una foto tal cual, sin pasarlos por texto", () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x10, 0x41, 0x42, 0xff, 0xd9]);
    const bytes = zip([{ ruta: "fotos/p.jpg", contenido: jpeg }], new Date(2026, 0, 2, 3, 4, 5));
    const dir = mkdtempSync(join(tmpdir(), "z-"));
    writeFileSync(join(dir, "z.zip"), bytes);
    execFileSync("unzip", ["-q", "z.zip"], { cwd: dir });
    const salida = readFileSync(join(dir, "fotos", "p.jpg"));
    expect(Buffer.from(salida).equals(Buffer.from(jpeg))).toBe(true);
  });

  it("el mismo contenido y la misma fecha dan el mismo archivo", () => {
    const f = new Date(2026, 3, 1, 12, 0, 0);
    const a = zip([{ ruta: "x.txt", contenido: "y" }], f);
    const b = zip([{ ruta: "x.txt", contenido: "y" }], f);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });
});

/** CRC32 escrito de la forma mas directa posible, para contrastar. */
function crcDeReferencia(d: Uint8Array): number {
  let c = ~0;
  for (const b of d) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

// ---------------------------------------------------------------------------

describe("el KMZ que lee DJI Pilot 2", () => {
  const archivos = abrir(toKmz(mission, opts, kmzOpts));

  // Las rutas son lo primero que mira Pilot 2. Con cualquier otra, no abre.
  it("lleva los dos archivos en wpmz/ y con esos nombres exactos", () => {
    expect(Object.keys(archivos).sort()).toEqual(["wpmz/template.kml", "wpmz/waylines.wpml"]);
  });

  it("declara el namespace de wpml en los dos", () => {
    for (const x of Object.values(archivos)) {
      expect(x).toContain('xmlns:wpml="http://www.dji.com/wpmz/1.0.2"');
      expect(x).toContain('xmlns="http://www.opengis.net/kml/2.2"');
    }
  });

  /**
   * La que evita el error mas comun de todos: escribir solo waylines y que
   * Pilot 2 muestre —y despues guarde— el recorrido del template.
   */
  it("los waypoints estan en los DOS archivos y son los mismos", () => {
    const coords = (x: string) => [...x.matchAll(/<coordinates>([^<]+)<\/coordinates>/g)].map((m) => m[1]);
    const t = coords(archivos["wpmz/template.kml"]!);
    const w = coords(archivos["wpmz/waylines.wpml"]!);
    expect(t.length).toBe(mission.waypoints.length);
    expect(w).toEqual(t);
  });

  it("escribe longitud antes que latitud, como manda el KML", () => {
    const [lon, lat] = archivos["wpmz/waylines.wpml"]!
      .match(/<coordinates>([^<]+)<\/coordinates>/)![1]!.split(",").map(Number);
    expect(lon).toBeCloseTo(mission.waypoints[0]!.lon, 6);
    expect(lat).toBeCloseTo(mission.waypoints[0]!.lat, 6);
  });

  it("lleva el numero de dron y de camara del perfil elegido", () => {
    const w = archivos["wpmz/waylines.wpml"]!;
    expect(w).toContain("<wpml:droneEnumValue>77</wpml:droneEnumValue>");
    expect(w).toContain("<wpml:droneSubEnumValue>1</wpml:droneSubEnumValue>");
    expect(w).toContain("<wpml:payloadEnumValue>66</wpml:payloadEnumValue>");
  });

  /** Con el gimbal inclinado, el modulo fotografiado no es el que esta debajo. */
  it("deja el gimbal mirando derecho para abajo", () => {
    expect(archivos["wpmz/waylines.wpml"]).toContain(
      "<wpml:gimbalPitchRotateAngle>-90</wpml:gimbalPitchRotateAngle>",
    );
  });

  /**
   * Un bloque son miles de disparos: no puede haber un waypoint por foto.
   * Se dispara por distancia recorrida sobre cada pasada.
   */
  it("dispara por distancia y no con un waypoint por foto", () => {
    const w = archivos["wpmz/waylines.wpml"]!;
    expect(w).toContain("<wpml:actionTriggerType>multipleDistance</wpml:actionTriggerType>");
    expect(w).toContain("takePhoto");
    const cada = Number(w.match(/<wpml:actionTriggerParam>([\d.]+)</)![1]);
    expect(cada).toBeCloseTo(mission.stats.disparoCadaM, 0);
    // Los waypoints son las puntas de las pasadas, no los disparos.
    expect(mission.waypoints.length).toBeLessThan(mission.stats.fotos);
  });

  it("la altura es sobre el despegue y no sobre el nivel del mar", () => {
    expect(archivos["wpmz/waylines.wpml"]).toContain(
      "<wpml:executeHeightMode>relativeToStartPoint</wpml:executeHeightMode>",
    );
    expect(archivos["wpmz/template.kml"]).toContain(
      "<wpml:heightMode>relativeToStartPoint</wpml:heightMode>",
    );
  });

  it("si se pierde el control remoto sigue la linea en vez de quedarse flotando", () => {
    expect(archivos["wpmz/waylines.wpml"]).toContain("<wpml:exitOnRCLost>goContinue</wpml:exitOnRCLost>");
    expect(archivos["wpmz/waylines.wpml"]).toContain("<wpml:finishAction>goHome</wpml:finishAction>");
  });
});

// ---------------------------------------------------------------------------

describe("los avisos antes de copiar el archivo", () => {
  it("no se calla que los numeros del 4T estan sin confirmar", () => {
    const m4t = PERFILES_DJI.find((p) => p.id === "m4t")!;
    expect(m4t.confirmado).toBe(false);
    const a = avisosDeKmz(mission, opts, { ...kmzOpts, perfil: m4t });
    expect(a.join(" ")).toMatch(/provisorios/);
    expect(a.join(" ")).toMatch(/export[ae] cualquier mision desde Pilot 2/);
  });

  it("avisa cuando el plan pasa el limite legal de altura", () => {
    const alto = { ...opts, altitudeM: 130 };
    const a = avisosDeKmz(planMission(filas, profile, alto)!, alto, kmzOpts);
    expect(a.join(" ")).toMatch(/120 m/);
    expect(a.join(" ")).toMatch(/no es legal/);
  });

  it("siempre recuerda que la altura es sobre el punto de despegue", () => {
    expect(avisosDeKmz(mission, opts, kmzOpts).join(" ")).toMatch(/sobre el punto de despegue/);
  });

  it("con el M3T no inventa una advertencia que no corresponde", () => {
    expect(avisosDeKmz(mission, opts, kmzOpts).join(" ")).not.toMatch(/provisorios/);
  });
});

// ---------------------------------------------------------------------------

/**
 * La altura de los waypoints en el archivo que Pilot 2 LEE.
 *
 * El 4 de septiembre, en el bloque 1 de Wellington, el dron despego solo con
 * la mision, subio a la altura de seguridad, se fue al primer waypoint —que
 * cae contra el alambrado y los arboles— y ahi bajo a unos cinco metros. Hubo
 * que sacarlo a mano.
 *
 * El archivo decia 52 m, pero lo decia en waylines.wpml. En template.kml, que
 * es lo que Pilot 2 lee y con lo que rearma la linea de vuelo, los catorce
 * waypoints no llevaban ninguna altura: llevaban `wpml:executeHeight`, que es
 * un elemento del OTRO archivo y aca se ignora, y no llevaban
 * `wpml:useGlobalHeight`, sin el cual el `globalHeight` de la carpeta tampoco
 * se aplica.
 *
 * Un waypoint sin altura no da error en ningun lado. Se abre, se dibuja, y el
 * dron baja.
 */
describe("la altura tiene que estar escrita en los dos archivos", () => {
  const archivos = abrir(toKmz(mission, opts, kmzOpts));
  const template = archivos["wpmz/template.kml"]!;
  const waylines = archivos["wpmz/waylines.wpml"]!;
  const placemarksDe = (texto: string) => texto.split("<Placemark>").slice(1);

  it("cada waypoint del template lleva su altura y los cuatro useGlobal", () => {
    const puntos = placemarksDe(template);
    expect(puntos.length).toBe(mission.waypoints.length);
    for (const p of puntos) {
      expect(p).toContain(`<wpml:height>${opts.altitudeM}</wpml:height>`);
      expect(p).toContain(`<wpml:ellipsoidHeight>${opts.altitudeM}</wpml:ellipsoidHeight>`);
      expect(p).toContain("<wpml:useGlobalHeight>1</wpml:useGlobalHeight>");
      expect(p).toContain("<wpml:useGlobalSpeed>1</wpml:useGlobalSpeed>");
      expect(p).toContain("<wpml:useGlobalHeadingParam>1</wpml:useGlobalHeadingParam>");
      expect(p).toContain("<wpml:useGlobalTurnParam>1</wpml:useGlobalTurnParam>");
    }
  });

  /*
    `executeHeight` es de waylines.wpml. Escribirlo en el template fue
    exactamente el error: parece que la altura esta puesta, y no esta.
  */
  it("el template no usa el elemento de altura del otro archivo", () => {
    expect(template).not.toContain("wpml:executeHeight");
  });

  it("cada waypoint de la linea de vuelo lleva su altura", () => {
    const puntos = placemarksDe(waylines);
    expect(puntos.length).toBe(mission.waypoints.length);
    for (const p of puntos) {
      expect(p).toContain(`<wpml:executeHeight>${opts.altitudeM}</wpml:executeHeight>`);
    }
  });

  it("la carpeta del template dice como girar y hacia donde mirar", () => {
    expect(template).toContain(`<wpml:globalHeight>${opts.altitudeM}</wpml:globalHeight>`);
    expect(template).toContain("<wpml:globalWaypointTurnMode>");
    expect(template).toContain("<wpml:globalWaypointHeadingParam>");
    expect(template).toContain("<wpml:heightMode>relativeToStartPoint</wpml:heightMode>");
  });

  /*
    El traslado hasta el primer waypoint. Se hacia a 30 m fijos, y el primer
    waypoint de un bloque cae contra el borde del parque, que es donde estan
    los arboles. No hay ninguna razon para cruzar por debajo de la altura a la
    que se va a volar igual.
  */
  it("sube a la altura de la mision antes de irse al primer punto", () => {
    expect(template).toContain(`<wpml:takeOffSecurityHeight>${opts.altitudeM}</wpml:takeOffSecurityHeight>`);
    expect(waylines).toContain(`<wpml:takeOffSecurityHeight>${opts.altitudeM}</wpml:takeOffSecurityHeight>`);
  });
});

/**
 * La revision del propio archivo, para que esto no dependa de que alguien se
 * acuerde de mirar.
 */
describe("el archivo se revisa a si mismo antes de salir", () => {
  it("el que genera la app esta completo", () => {
    const { template, waylines } = archivosDelKmz(mission, opts, kmzOpts);
    expect(loQueFaltaEnElKmz(template, waylines)).toEqual([]);
    expect(avisosDeKmz(mission, opts, kmzOpts).find((a) => a.includes("NO SE VUELA"))).toBeUndefined();
  });

  it("un template sin la altura se marca, y con nombre y numero", () => {
    const { template, waylines } = archivosDelKmz(mission, opts, kmzOpts);
    const roto = template.replaceAll("<wpml:useGlobalHeight>1</wpml:useGlobalHeight>", "");
    const faltan = loQueFaltaEnElKmz(roto, waylines);
    expect(faltan.length).toBe(1);
    expect(faltan[0]).toContain("wpml:useGlobalHeight");
    expect(faltan[0]).toContain("template.kml");
  });

  it("el aviso de que no se vuela sale primero en la lista", () => {
    // La lista de avisos la lee una persona apurada, en el campo.
    expect(avisosDeKmz(mission, opts, { ...kmzOpts, perfil: m3t })[0]).not.toContain("NO SE VUELA");
  });

  it("y avisa que hay que mirar la altura en Pilot 2 antes de despegar", () => {
    const avisos = avisosDeKmz(mission, opts, kmzOpts);
    expect(avisos.some((a) => a.includes("Pilot 2") && a.includes(`${opts.altitudeM} m`))).toBe(true);
  });
});
