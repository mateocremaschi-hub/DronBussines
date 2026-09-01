/**
 * Un solo camino: fotos -> deteccion -> revision -> entrega.
 *
 * Habia dos y hacian casi lo mismo. Una pantalla media todos los modulos del
 * parque contra sus hermanos de string y guardaba esa lista; otra hacia un
 * hallazgo por foto y ofrecia la revision humana. La deteccion buena vivia en
 * un lado y la revision buena en el otro, y cargando el mismo vuelo en los dos
 * salian dos listas que no se conocian.
 *
 * Lo que se prueba aca es justamente la costura: que lo que mide el motor y lo
 * que escribe una persona viajen juntos, que ninguno de los dos pise al otro, y
 * que las dos mitades sigan ahi cuando el vuelo se guarda y se vuelve a abrir.
 */

import { describe, expect, it } from "vitest";
import edenvaleJson from "../farms/edenvale.json" with { type: "json" };
import { Acumulador, comparar, UMBRALES, type Muestra, type Umbrales } from "../app/detect";
import { camaraDesdeEquivalente35 } from "../app/mission";
import { compileFarm, makeFrame, modulesOfRow, toGeo } from "../src/index.js";
import type { FarmProfile } from "../src/types.js";
import { applyStrings } from "../app/strings";
import { makeRow } from "./helpers/synthetic.js";
import {
  coberturaDe,
  fusionarRevision,
  hallazgosAFindings,
  idDeModulo,
  reclasificarFindings,
  vueloDesdeAnalisis,
  type ResultadoDeVuelo,
} from "../app/vuelo";
import { esModeloViejo, summarize, type Finding, type Inspection } from "../app/inspection";
import { aInformeHtml, toCsv } from "../app/informe";
import type { StoredAnalysis, StoredFarm } from "../app/storage";
import type { PhotoFix } from "../app/photos";

const profile = edenvaleJson as unknown as FarmProfile;

const row = makeRow(
  {
    id: "05-042-R1", block: "05", tracker: "05-042", row: "R1",
    anchor: { lat: -26.92, lon: 150.58 }, azimuthDeg: 180, side: "north",
  },
  profile,
);
const conStrings = applyStrings([row], {
  fieldIndex: 3,
  byRow: new Map([["05-042-R1", { labels: ["S-1.2.15.1", "S-1.2.15.2"], dcBox: "DCB-1.2.15" }]]),
  chains: new Map([["05-042-R1", { pos: 1, posTotal: 1 }]]),
});
const farm = compileFarm(profile, conStrings);
const frame = makeFrame(farm.origin.lat, farm.origin.lon);
const stored: StoredFarm = { profile, rows: conStrings, savedAt: "2026-08-30T00:00:00.000Z" };

const camara = camaraDesdeEquivalente35("prueba", 40, 640, 512);
const ANCHO_M = profile.module.widthMm / 1000;
const LARGO_M = 2.28;
const BASE_C = 45;

/** El centro geometrico de la fila, que es donde se para el dron. */
const centroDeLaFila = (() => {
  const ms = modulesOfRow(farm.rows[0]!, farm);
  const x = ms.reduce((a, m) => a + m.x, 0) / ms.length;
  const y = ms.reduce((a, m) => a + m.y, 0) / ms.length;
  return toGeo(frame, x, y);
})();

const termica = (celsius: Float32Array) => ({
  width: 640, height: 512, celsius,
  escala: "de prueba", escalaAuto: "de prueba",
  topeC: 999, fraccionEnElTope: 0,
});

/** Una pasada del vuelo sintetico sobre la fila, a 60 m de altura. */
function volar(celsius: Float32Array): Acumulador {
  const acc = new Acumulador(farm, frame, {
    camera: camara, moduloAnchoM: ANCHO_M, moduloLargoM: LARGO_M,
  });
  acc.agregar({
    fileName: "DJI_0001_T.JPG",
    radio: termica(celsius),
    pose: {
      lat: centroDeLaFila.lat, lon: centroDeLaFila.lon,
      altitudeAglM: 60, gimbalYawDeg: 0, gimbalPitchDeg: -90,
    },
  });
  return acc;
}

const pareja = () => new Float32Array(640 * 512).fill(BASE_C);

/**
 * Calienta el modulo que se le pida, sobre la caja que el motor midio.
 *
 * Se pinta con la MISMA transformacion con la que `medirCaja` decide que
 * pixeles son de este modulo, achicada al 90 %: asi lo que se calienta cae
 * entero adentro del modulo elegido y no toca al vecino. Pintar un cuadrado
 * alineado a los ejes de la imagen no serviria — la fila corre inclinada
 * dentro del cuadro y se estaria calentando media placa de al lado.
 */
function calentar(base: Float32Array, m: Muestra, grados: number): Float32Array {
  const c = m.caja!;
  const salida = Float32Array.from(base);
  const cos = Math.cos(c.rotRad), sin = Math.sin(c.rotRad);
  const hw = (c.largo / 2) * 0.9, hh = (c.cruzado / 2) * 0.9;
  const ext = Math.ceil(Math.hypot(c.largo, c.cruzado) / 2) + 2;
  for (let y = Math.max(0, Math.floor(c.cy - ext)); y <= Math.min(511, Math.ceil(c.cy + ext)); y++) {
    for (let x = Math.max(0, Math.floor(c.cx - ext)); x <= Math.min(639, Math.ceil(c.cx + ext)); x++) {
      const dx = x - c.cx, dy = y - c.cy;
      const u = dx * cos + dy * sin;
      const v = -dx * sin + dy * cos;
      if (Math.abs(u) > hw || Math.abs(v) > hh) continue;
      salida[y * 640 + x] = base[y * 640 + x]! + grados;
    }
  }
  return salida;
}

/** El vuelo de prueba: todo parejo menos un modulo, 25 grados por encima. */
const vueloConUnModuloCaliente = (() => {
  // Primera pasada solo para saber en que pixeles cae cada modulo. Es la misma
  // caja que despues se mide, asi que lo que se calienta es exactamente lo que
  // el motor va a leer.
  const previas = volar(pareja()).muestras();
  // El modulo mas cerca del centro del cuadro: es el que la camara ve mejor, y
  // el unico que se puede elegir sin fijar un numero que depende de la altura
  // del vuelo sintetico.
  const elegido = previas.reduce((a, b) =>
    a.distanciaAlCentroM <= b.distanciaAlCentroM ? a : b,
  );
  const acc = volar(calentar(pareja(), elegido, 25));
  return { muestras: acc.muestras(), acc, caliente: elegido.modulo };
})();

const fixDeLaFoto: PhotoFix = {
  fileName: "DJI_0001_T.JPG",
  lat: centroDeLaFila.lat,
  lon: centroDeLaFila.lon,
  accuracyM: 2,
  takenAt: "2026-08-30T02:15:00.000Z",
};

/** Los hallazgos del vuelo de prueba, ya convertidos en lo que se revisa. */
function detectar(umbrales: Umbrales = UMBRALES): Finding[] {
  const hallazgos = comparar(vueloConUnModuloCaliente.muestras, umbrales);
  return hallazgosAFindings(
    hallazgos.filter((h) => h.peor !== "normal"),
    farm,
    frame,
    new Map([["DJI_0001_T.JPG", fixDeLaFoto]]),
  );
}

// ---------------------------------------------------------------------------

describe("cargar las fotos produce los hallazgos, con la medicion adentro", () => {
  it("el modulo caliente sale como hallazgo y trae lo que midio el motor", () => {
    const caliente = vueloConUnModuloCaliente.caliente;
    const f = detectar().find(
      (x) => x.id === idDeModulo(caliente.rowId, caliente.positionInRow),
    );
    expect(f, "el modulo que se calento no salio en la lista").toBeDefined();
    const m = f!.medicion!;
    expect(m.deltaT).toBeGreaterThan(20);
    expect(m.celsius).toBeGreaterThan(BASE_C + 20);
    // Contra sus hermanos del mismo string, que es la comparacion que aisla el
    // defecto de la suciedad, la edad y la irradiancia.
    expect(m.ambito).toBe("string");
    expect(m.vecinos).toBeGreaterThan(5);
    expect(m.referenciaC).toBeCloseTo(BASE_C, 0);
    expect(m.peor).toBe("critica");
  });

  /*
    La caja es la que permite volver a marcar el modulo sobre la foto meses
    despues. Recalcularla exigiria la pose, la camara, el ajuste y el angulo del
    tracker de ese instante — y equivocarle a uno de esos cuatro senala el panel
    de al lado con la misma seguridad.
  */
  it("se guarda el recuadro de donde salio el numero", () => {
    const f = detectar()[0]!;
    expect(f.medicion!.caja).toBeDefined();
    expect(f.medicion!.caja!.largo).toBeGreaterThan(0);
    expect(f.medicion!.pixeles).toBeGreaterThan(10);
  });

  /*
    La direccion no se arma a mano: se le pasa al motor el centro del modulo
    medido y se usa lo que contesta. Es la misma funcion que resuelve una
    coordenada tomada en el campo, asi que la direccion del informe y la del
    telefono parado al lado del panel no pueden discrepar.
  */
  it("la direccion la resuelve el mismo motor, y cae en el modulo que se midio", () => {
    const caliente = vueloConUnModuloCaliente.caliente;
    const f = detectar().find(
      (x) => x.id === idDeModulo(caliente.rowId, caliente.positionInRow),
    )!;
    expect(f.address).not.toBeNull();
    expect(f.address!.rowId).toBe(caliente.rowId);
    expect(f.address!.positionInRow).toBe(caliente.positionInRow);
    expect(f.address!.module).toBe(caliente.module);
    expect(f.address!.stringNumber).toBe(caliente.stringNumber);
  });

  /*
    `locate` esta hecho para una coordenada de GPS y con los 3 m que asume por
    defecto reparte la confianza entre trece modulos vecinos, avisando que "con
    esa precision no se puede senalar un modulo solo". Pero el centro del
    modulo medido no viene de ningun GPS: lo da la geometria del parque. Ese
    aviso en cada hallazgo diria lo contrario de lo que pasa, y viaja al
    entregable en la columna de avisos.
  */
  it("la ubicacion no sale con la incertidumbre de un GPS que no se uso", () => {
    const f = detectar()[0]!;
    expect(f.address!.confidence).toBeGreaterThan(0.99);
    expect(f.warnings.map((w) => w.code)).not.toContain("low-confidence");
    // Y quedan los vecinos para poder corregir el modulo mirando la foto.
    expect(f.candidates.length).toBeGreaterThan(1);
  });

  it("arrastra la foto en la que se midio, para poder discutirlo despues", () => {
    const f = detectar()[0]!;
    expect(f.fileName).toBe("DJI_0001_T.JPG");
    expect(f.fix?.takenAt).toBe("2026-08-30T02:15:00.000Z");
  });

  /*
    Se acabo el "una foto, un hallazgo". Una foto de un parque sano no produce
    ninguno, y una de un tramo roto produce varios: lo que se busca son
    modulos.
  */
  it("una foto sin nada caliente no produce ningun hallazgo", () => {
    const hallazgos = comparar(volar(pareja()).muestras(), UMBRALES);
    expect(hallazgos.length).toBeGreaterThan(20); // se midieron modulos…
    expect(hallazgos.filter((h) => h.peor !== "normal")).toEqual([]); // …y ninguno se despega
  });
});

// ---------------------------------------------------------------------------

describe("la revision humana y la medicion no se pisan", () => {
  const revisado = (fs: Finding[]): Finding[] =>
    fs.map((f, n) =>
      n === 0
        ? { ...f, status: "confirmado" as const, anomaly: "Diodo de bypass", klass: 2, note: "vidrio ok", moduleCorregido: 9 }
        : f,
    );

  it("clasificar un hallazgo no le borra lo que midio el motor", () => {
    const antes = detectar();
    const despues = revisado(antes);
    expect(despues[0]!.anomaly).toBe("Diodo de bypass");
    expect(despues[0]!.medicion).toEqual(antes[0]!.medicion);
  });

  /*
    Volver a correr la deteccion —mover la grilla un metro, sumar las fotos del
    segundo vuelo del dia— produce una lista nueva entera. Sin fusionar, las
    anomalias ya clasificadas y confirmadas vuelven a aparecer como pendientes
    y hay que hacer el trabajo dos veces.
  */
  it("volver a detectar conserva la revision y actualiza la medicion", () => {
    const viejos = revisado(detectar());
    const nuevos = detectar();
    const fusionados = fusionarRevision(nuevos, viejos);

    const f = fusionados.find((x) => x.id === viejos[0]!.id)!;
    expect(f.status).toBe("confirmado");
    expect(f.klass).toBe(2);
    expect(f.moduleCorregido).toBe(9);
    // Y la medicion es la de la corrida nueva, no la copiada de la vieja.
    expect(f.medicion).toEqual(nuevos.find((x) => x.id === f.id)!.medicion);
  });

  /*
    Un modulo que el tecnico confirmo como quemado no deja de estarlo porque se
    movio un umbral. Borrarlo en silencio seria perder la unica parte del
    informe que tiene una firma atras.
  */
  it("un hallazgo revisado que la corrida nueva ya no encuentra no se tira", () => {
    const viejos = revisado(detectar());
    const fusionados = fusionarRevision([], viejos);
    expect(fusionados).toHaveLength(1);
    expect(fusionados[0]!.status).toBe("confirmado");
  });

  it("pero uno que nadie miro y ya no aparece, si", () => {
    const viejos = detectar(); // todos pendientes, sin tocar
    expect(fusionarRevision([], viejos)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe("los umbrales reclasifican sin volver a leer las fotos", () => {
  /*
    La prueba de fondo: reclasificar la lista guardada tiene que dar
    exactamente lo mismo que volver a comparar todas las muestras con esos
    umbrales. Si no, un vuelo abierto un mes despues —con las fotos en otro
    disco— se leeria distinto que el mismo vuelo con las fotos a mano, y las
    dos versiones del informe se veerian igual de convincentes.
  */
  it("da lo mismo que volver a comparar con las fotos a mano", () => {
    const otros: Umbrales = { leve: 5, moderada: 30, critica: 60 };
    const desdeLasFotos = new Map(
      detectar(otros).map((f) => [f.id, f.medicion!]),
    );
    const desdeLaLista = reclasificarFindings(detectar(), otros);

    for (const f of desdeLaLista) {
      const enFotos = desdeLasFotos.get(f.id);
      if (!enFotos) continue; // uno que con los umbrales nuevos ya no es hallazgo
      expect(f.medicion!.severidad).toBe(enFotos.severidad);
      expect(f.medicion!.peor).toBe(enFotos.peor);
      expect(f.medicion!.origen).toBe(enFotos.origen);
    }
  });

  it("subir el umbral baja la severidad, sin tocar el numero medido", () => {
    const antes = detectar();
    const critico = antes.find((f) => f.medicion!.peor === "critica")!;
    const despues = reclasificarFindings(antes, { leve: 5, moderada: 30, critica: 60 });
    const mismo = despues.find((f) => f.id === critico.id)!;

    expect(mismo.medicion!.peor).not.toBe("critica");
    // El delta es una medicion, no una opinion: no lo mueve ningun umbral.
    expect(mismo.medicion!.deltaT).toBe(critico.medicion!.deltaT);
    expect(mismo.medicion!.celsius).toBe(critico.medicion!.celsius);
  });

  it("y la revision humana sigue intacta despues de reclasificar", () => {
    const revisados = detectar().map((f) => ({ ...f, status: "confirmado" as const, klass: 3 as const }));
    const despues = reclasificarFindings(revisados, { leve: 5, moderada: 30, critica: 60 });
    expect(despues.every((f) => f.status === "confirmado" && f.klass === 3)).toBe(true);
  });

  /*
    Bajar el umbral no puede inventar un delta interno donde el vuelo no
    resolvia una celda: eso no es clasificar, es medir. Con menos de cuatro
    pixeles por celda el defecto llega al sensor ya promediado.
  */
  it("un vuelo que no resolvia celdas sigue sin poder hablar de celdas", () => {
    const sinResolucion = detectar().map((f) => ({
      ...f,
      medicion: { ...f.medicion!, pixelesPorCelda: 1, puntoCalienteC: f.medicion!.celsius + 40 },
    }));
    const despues = reclasificarFindings(sinResolucion, { leve: 1, moderada: 2, critica: 3 });
    expect(despues.every((f) => f.medicion!.deltaInterno === undefined)).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe("el vuelo guardado y vuelto a abrir conserva las dos mitades", () => {
  const resultado: ResultadoDeVuelo = {
    muestras: vueloConUnModuloCaliente.muestras,
    camera: camara,
    gsdCm: 3.2,
    fotosTermicas: 1,
    soloEnElBorde: 4,
    posesSupuestas: [],
    anguloMedio: 12,
    problemas: [],
    fixes: new Map(),
  };

  const vuelo = (): Inspection => ({
    id: "v1",
    farmId: profile.id,
    farmName: profile.name,
    name: "Vuelo de prueba",
    createdAt: "2026-08-30T02:00:00.000Z",
    conditions: { irradianceWm2: 780, windMs: 0 },
    findings: detectar().map((f, n) =>
      n === 0 ? { ...f, status: "confirmado" as const, anomaly: "Diodo de bypass", klass: 2 } : f,
    ),
    cobertura: coberturaDe({
      resultado,
      hallazgos: comparar(vueloConUnModuloCaliente.muestras, UMBRALES),
      totalModulos: farm.rows.reduce((s, r) => s + r.modulesPerRow, 0) + 500,
      modulosPorString: () => profile.topology.modulesPerString,
      celdaM: 0.16,
      umbrales: UMBRALES,
      fotos: 1,
    }),
  });

  /** Lo que hace la base al guardar: nada que no sobreviva a un JSON. */
  const guardarYAbrir = (i: Inspection): Inspection => JSON.parse(JSON.stringify(i)) as Inspection;

  it("la medicion y la revision siguen ahi despues de guardar", () => {
    const abierto = guardarYAbrir(vuelo());
    const f = abierto.findings[0]!;
    expect(f.status).toBe("confirmado");
    expect(f.anomaly).toBe("Diodo de bypass");
    expect(f.medicion!.deltaT).toBeCloseTo(vuelo().findings[0]!.medicion!.deltaT, 6);
    expect(f.medicion!.caja).toBeDefined();
    expect(f.address!.tracker).toBe("05-042");
  });

  /*
    Lo que el vuelo NO permite afirmar es parte del vuelo. Vivia suelto en el
    estado de la pantalla: se calculaba, se mostraba, y se perdia al cerrarla.
    Un informe que no dice que NO miro no sirve para un reclamo.
  */
  it("lo que el vuelo no permite afirmar sobrevive al guardado", () => {
    const c = guardarYAbrir(vuelo()).cobertura!;
    expect(c.limitaciones.join(" ")).toContain("no cayeron en ninguna foto");
    expect(c.limitaciones.join(" ")).toContain("cortados por el borde");
    expect(c.soloEnElBorde).toBe(4);
    expect(c.sinMedir).toBeGreaterThan(0);
    expect(c.umbrales).toEqual(UMBRALES);
  });

  it("el resumen cuenta las severidades medidas, no solo las clases a mano", () => {
    const s = summarize(guardarYAbrir(vuelo()).findings);
    expect(s.porSeveridad.critica).toBeGreaterThan(0);
    expect(s.confirmados).toBe(1);
  });

  it("el CSV lleva el delta del motor y la clasificacion humana, las dos", () => {
    const csv = toCsv(guardarYAbrir(vuelo()));
    expect(csv).toContain("delta_t_medido");
    expect(csv).toContain("temperatura_c");
    expect(csv).toContain("Diodo de bypass");
    // Y lo que no se miro, como filas del encabezado.
    expect(csv).toContain("no_se_puede_afirmar_1");
    expect(csv).toContain("modulos_sin_medir");
  });

  it("el informe HTML muestra la medicion y declara lo que no se miro", () => {
    const html = aInformeHtml(guardarYAbrir(vuelo()), [], profile.addressing);
    expect(html).toContain("Lo que este vuelo no permite afirmar");
    expect(html).toContain("no cayeron en ninguna foto");
    expect(html).toContain("Medicion");
    expect(html).toContain("vecinos de su mismo string");
  });
});

// ---------------------------------------------------------------------------

describe("los vuelos que quedaron guardados con el modelo viejo", () => {
  /** Un hallazgo del modelo anterior: una foto, un ΔT escrito a mano. */
  const vueloViejo: Inspection = {
    id: "viejo", farmId: profile.id, farmName: profile.name,
    name: "Vuelo de agosto", createdAt: "2026-08-01T00:00:00.000Z",
    conditions: {},
    findings: [{
      id: "abc-1",
      fileName: "DJI_0100.JPG",
      fix: { fileName: "DJI_0100.JPG", lat: -26.92, lon: 150.58 },
      address: null,
      candidates: [],
      warnings: [],
      status: "confirmado",
      anomaly: "Punto caliente",
      klass: 3,
      deltaT: 18,
    }],
  };

  it("se reconoce, se abre y no se pierde nada", () => {
    expect(esModeloViejo(vueloViejo)).toBe(true);
    const csv = toCsv(vueloViejo);
    expect(csv).toContain("DJI_0100.JPG");
    expect(csv).toContain("Punto caliente");
    // El ΔT escrito a mano sigue siendo el que se entrega.
    expect(csv).toContain("18");
  });

  it("un vuelo nuevo no se confunde con uno viejo", () => {
    expect(esModeloViejo({ ...vueloViejo, findings: detectar() })).toBe(false);
    // Y uno vacio no es viejo: es que todavia no se cargaron las fotos.
    expect(esModeloViejo({ ...vueloViejo, findings: [] })).toBe(false);
  });

  /*
    El analisis que la pantalla vieja guardaba por su cuenta, en otra clave de
    la misma base, se queda sin nadie que lo lea al unificar. Adentro esta el
    ultimo vuelo analizado de cada parque.
  */
  it("el analisis guardado aparte se convierte en un vuelo normal", () => {
    const analisis: StoredAnalysis = {
      farmId: profile.id,
      hallazgos: comparar(vueloConUnModuloCaliente.muestras, UMBRALES).filter(
        (h) => h.peor !== "normal",
      ),
      gsdCm: 3.2,
      fotos: 120,
      savedAt: "2026-08-15T00:00:00.000Z",
    };
    const v = vueloDesdeAnalisis(analisis, stored, farm);

    expect(v.findings.length).toBe(analisis.hallazgos.length);
    expect(v.findings[0]!.medicion!.deltaT).toBeCloseTo(analisis.hallazgos[0]!.deltaT, 6);
    expect(v.findings.every((f) => f.status === "pendiente")).toBe(true);
    expect(esModeloViejo(v)).toBe(false);
    // Y dice lo que ese formato no guardaba, en vez de dejar el hueco en
    // blanco — que se leeria como "no falto ningun modulo".
    expect(v.cobertura!.limitaciones.join(" ")).toContain("NO trae la cobertura");
  });
});
