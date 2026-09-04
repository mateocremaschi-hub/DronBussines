/**
 * De la carpeta de fotos al vuelo revisable: un solo camino.
 *
 * Habia dos y hacian casi lo mismo. Una pantalla cargaba las fotos, corria el
 * motor y guardaba los `Hallazgo` medidos; la otra cargaba las mismas fotos,
 * hacia un hallazgo por foto y ofrecia la revision humana buena —anomalia,
 * clase IEC, nota, confirmar o descartar, corregir el modulo mirando la
 * imagen—. Cargando el mismo vuelo en las dos salian dos listas que no se
 * conocian.
 *
 * Este archivo es la costura que faltaba. No dibuja nada: convierte lo que
 * mide el motor en los hallazgos que una persona revisa, y se ocupa de las
 * tres cosas que hay que hacer bien para que las dos mitades no se pisen:
 *
 *   - la revision humana sobrevive a que se vuelva a correr la deteccion,
 *   - mover un umbral reclasifica sin volver a leer una sola foto,
 *   - lo que el vuelo NO permite afirmar viaja con el vuelo y se guarda.
 */

import { anguloDeTracker, locate, makeFrame, toGeo } from "@locator";
import type { CompiledFarm, LocalFrame } from "@locator";
import {
  Acumulador,
  CELDA_M,
  clasificar,
  comparar,
  eventosDeString,
  type EventoDeString,
  resumir,
  stringsEnVariasTandas,
  UMBRALES,
  UMBRALES_INTERNOS,
  type Hallazgo,
  type Muestra,
  type Umbrales,
} from "./detect";
import type { Cobertura, Finding, Inspection, Medicion } from "./inspection";
import { camaraDesdeEquivalente35, type Camera } from "./mission";
import { readPhoto, type PhotoFix } from "./photos";
import type { Ajuste } from "./projection";
import { readRadiometric } from "./thermal";
import type { StoredAnalysis, StoredFarm } from "./storage";

/**
 * Largo del modulo sobre el eje corto de la fila, cuando el perfil no lo trae.
 *
 * Era una constante fija de 2.28 m, y con ella la caja de medicion salia
 * cuadrada en un parque de paneles apaisados. Ahora sale del perfil; esto es
 * solo el respaldo para parques dados de alta antes de que el campo existiera.
 */
export const LARGO_MODULO_M = 2.28;

// ---------------------------------------------------------------------------
// Leer el vuelo
// ---------------------------------------------------------------------------

export interface ResultadoDeVuelo {
  /** Una muestra por modulo medido. NO se guardan: son cientos de miles. */
  muestras: Muestra[];
  /** La camara deducida de las propias fotos. `null` si ninguna la declaraba. */
  camera: Camera | null;
  /** Centimetros por pixel, promediados sobre el vuelo. */
  gsdCm: number;
  /** Cuantos archivos traian la temperatura adentro. */
  fotosTermicas: number;
  /** Modulos que aparecieron solo cortados por el borde y no se midieron. */
  soloEnElBorde: number;
  /**
   * La prueba que el vuelo se hace a si mismo.
   *
   * El mismo panel, visto en dos fotos distintas —otra posicion del dron, otra
   * parte del cuadro, otro angulo— tiene que dar la misma temperatura. Si no
   * coinciden, no hay ningun defecto que reportar: hay un pipeline roto.
   *
   * Es lo unico que dice si el motor esta funcionando SIN saber de antemano
   * que panel esta roto. `null` cuando el vuelo no tiene solape y no hay nada
   * que comparar — que tambien hay que decirlo.
   */
  repetibilidad: { modulos: number; mediana: number; p90: number; peor: number } | null;
  /** Fotos que se ubicaron con un supuesto porque les faltaba un dato. */
  posesSupuestas: Array<{ motivo: string; fotos: number }>;
  /** Angulo medio de los trackers durante el vuelo, si se pudo saber. */
  anguloMedio: number | null;
  /** Lo que no se pudo usar, dicho para una persona. */
  problemas: string[];
  /**
   * El dato de cada foto que se pudo leer, por nombre de archivo.
   *
   * Hace falta despues: un hallazgo es un MODULO, pero se midio en una foto
   * concreta, y la hora y el error de GPS de esa foto son lo que permite
   * discutirlo despues.
   */
  fixes: Map<string, PhotoFix>;
}

/**
 * Cuanto pueden diferir dos mediciones del mismo panel y seguir sirviendo.
 *
 * Un grado. El umbral de anomalia leve anda por los tres, asi que con un grado
 * de dispersion entre dos mediciones del mismo panel un defecto leve sigue
 * siendo distinguible del ruido. Con dos grados ya no.
 */
export const REPETIBLE_C = 1;

export interface OpcionesDeVuelo {
  moduloAnchoM: number;
  moduloLargoM: number;
  celdaM: number;
  ajuste: Ajuste;
  /**
   * Si el largo del modulo lo declara el perfil o es el valor por defecto.
   *
   * Importa mas de lo que parece: de ese numero sale el tamano del recuadro
   * con el que se mide cada modulo. Si esta mal, la caja sobresale del panel
   * —y entonces mide el riel y el hueco— o se queda corta y deja el defecto
   * afuera. En Edenvale el supuesto (2278 mm) y el real (2255) casi coinciden,
   * pero eso fue suerte: nadie lo habia medido.
   */
  largoDeclarado?: boolean;
}

/**
 * Procesa el vuelo foto por foto.
 *
 * Se lee, se mide y se descarta la matriz de temperaturas antes de pasar a la
 * siguiente: todas juntas no entran en memoria — 500 termicas de 640x512 en
 * punto flotante son 650 MB.
 *
 * Estaba adentro de la pantalla y escribia trece pedazos de estado de React a
 * medida que avanzaba. Aca devuelve un solo resultado: la pantalla lo guarda
 * de una, y lo que decide que sale en el informe se puede probar sin un
 * navegador.
 */
export async function analizarFotos(
  farm: CompiledFarm,
  frame: LocalFrame,
  files: File[],
  opts: OpcionesDeVuelo,
  onProgreso?: (hecho: number, total: number) => void,
): Promise<ResultadoDeVuelo> {
  let acc: Acumulador | null = null;
  let cam: Camera | null = null;
  let sumaGsd = 0;
  let nGsd = 0;
  const fallos: string[] = [];
  const fixes = new Map<string, PhotoFix>();
  let sinTermica = 0;
  let termicas = 0;
  /**
   * La escala del vuelo, fijada por la primera foto que se pudo leer.
   *
   * Se elegia foto por foto, por contraste. Una foto de una nube, del hangar
   * o del despegue puede caer en otra escala, y esa foto entra al analisis
   * con las temperaturas multiplicadas por seis. Nadie lo nota, porque 240 °C
   * se reporta como una anomalia critica — y anomalias es justo lo que
   * estabamos buscando.
   *
   * Todas las fotos de un vuelo salen de la misma camara con la misma
   * configuracion: la escala es una sola. Se fija con la primera y se cuenta
   * cuantas habrian elegido otra, para poder decirlo al final.
   */
  let escalaDelVuelo: string | null = null;
  const discrepan: string[] = [];
  /**
   * Fotos donde la camara llego a su tope.
   *
   * Arriba del rango elegido, la termica guarda todo con el mismo numero. Un
   * conector quemado, un punto caliente fuerte o un reflejo del sol se pasan,
   * y lo que se mide deja de ser la temperatura del modulo: es el techo del
   * sensor. El ΔT de esas fotos es un PISO, no una medida — y justo son las
   * fotos de los defectos mas graves, o sea las que mas importan.
   */
  const saturadas: string[] = [];
  let topeMasAlto = 0;
  /** Angulo medio de los trackers durante el vuelo, para poder decirlo. */
  let sumaAngulo = 0;
  let nAngulo = 0;
  /** Tamanios de imagen distintos al de la primera foto. */
  const otraCamara = new Set<string>();
  /**
   * Fotos guardadas al doble del tamano del sensor.
   *
   * El Matrice 4T tiene una opcion —"Super Resolution"— que guarda la termica
   * a 1280x1024 cuando el sensor es de 640x512. La mitad de cada pixel es
   * inventada por interpolacion: no agrega ni un dato de temperatura. Se mide
   * igual, porque el crudo viene al tamano real, pero el vuelo pesa cuatro
   * veces mas de lo necesario y tarda cuatro veces mas en subirse.
   */
  let superRes = 0;

  for (let i = 0; i < files.length; i++) {
    const file = files[i]!;
    try {
      const buf = await file.arrayBuffer();
      const radio = readRadiometric(buf, escalaDelVuelo ?? undefined);
      if (!radio) {
        // No es un error: casi siempre es la foto visible del par. Pero si
        // NINGUNA trae temperatura hay que decirlo, y para eso hace falta
        // contarlas en vez de saltearlas en silencio.
        sinTermica++;
        onProgreso?.(i + 1, files.length);
        continue;
      }

      if (radio.superResolucion) superRes++;

      if (!escalaDelVuelo) escalaDelVuelo = radio.escala;
      else if (radio.escalaAuto !== escalaDelVuelo) discrepan.push(file.name);

      // Medio por mil de la foto pegada al mismo maximo ya es una mancha, no
      // un pixel de ruido: son unos 160 pixeles en una termica de 640 x 512.
      if (radio.fraccionEnElTope > 0.0005) {
        saturadas.push(file.name);
        topeMasAlto = Math.max(topeMasAlto, radio.topeC);
      }

      // Sin miniatura: la revision marca el modulo sobre la foto entera, y
      // generar una miniatura por foto decodifica y recomprime la imagen
      // completa para tirarla.
      const leida = await readPhoto(file, false);
      const fix = leida.fix;
      if (!fix) { fallos.push(`${file.name}: ${leida.error ?? "sin coordenada"}`); continue; }
      fixes.set(file.name, fix);

      /*
        La camara se deduce de la PRIMERA foto y despues no se vuelve a
        mirar. Si en la carpeta hay dos vuelos, o la termica y la visible del
        par, o dos drones distintos, todas las demas fotos se proyectan con
        la huella de la camara equivocada — y una huella equivocada no da un
        error, da modulos de la fila de al lado.

        No se puede cambiar de camara a mitad de vuelo (el Acumulador ya esta
        armado con la primera), pero SI se puede detectar y decirlo.
      */
      if (cam && (radio.width !== cam.imageW || radio.height !== cam.imageH)) {
        otraCamara.add(`${radio.width}×${radio.height}`);
      }

      if (!cam) {
        cam = camaraFrom(fix, radio.width, radio.height);
        if (!cam) { fallos.push(`${file.name}: no declara distancia focal equivalente`); continue; }
        acc = new Acumulador(farm, frame, {
          camera: cam,
          moduloAnchoM: opts.moduloAnchoM,
          moduloLargoM: opts.moduloLargoM,
          ajuste: opts.ajuste,
          // El lado de la celda lo declara el perfil del parque: cambia
          // entre fabricantes y decide si este vuelo puede ver una celda.
          celdaM: opts.celdaM,
        });
      }

      const agl = fix.relativeAltitudeM;
      if (agl == null) { fallos.push(`${file.name}: no trae altura sobre el terreno`); continue; }

      sumaGsd += ((2 * agl * Math.tan((cam.hfovDeg * Math.PI) / 360)) / cam.imageW) * 100;
      nGsd++;

      /*
        El angulo del tracker en el momento de ESTA foto.

        Los trackers giran de -55 a +55 grados siguiendo al sol, asi que un
        modulo fotografiado a las ocho de la manana se ve casi la mitad de
        ancho de lo que es. Sin corregirlo, la caja de medicion se dibuja del
        ancho del modulo acostado y casi la mitad cae sobre el suelo — que al
        sol lee muy distinto y le baja la mediana al modulo entero.

        La hora sale de la propia foto. Si no la trae, se mide como si los
        trackers estuvieran planos, que es lo que se hacia siempre.
      */
      const cuando = fix.takenAt ? new Date(fix.takenAt) : null;
      const angulo =
        cuando && !Number.isNaN(cuando.getTime())
          ? anguloDeTracker(fix.lat, fix.lon, cuando)
          : null;
      if (angulo && !angulo.deNoche) {
        sumaAngulo += Math.abs(angulo.gradosDesdeLaHorizontal);
        nAngulo++;
      }

      termicas++;
      acc!.agregar({
        fileName: file.name,
        ...(cuando && !Number.isNaN(cuando.getTime()) ? { cuando: cuando.getTime() } : {}),
        radio,
        pose: {
          lat: fix.lat, lon: fix.lon, altitudeAglM: agl,
          ...(fix.gimbalYawDeg != null ? { gimbalYawDeg: fix.gimbalYawDeg } : {}),
          ...(fix.gimbalPitchDeg != null ? { gimbalPitchDeg: fix.gimbalPitchDeg } : {}),
        },
      }, angulo?.factorDeAcortamiento ?? 1);
    } catch (e) {
      fallos.push(`${file.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
    onProgreso?.(i + 1, files.length);
  }

  /*
    Las fotos que por su cuenta habrian elegido otra escala. No es un error
    —se las convirtio con la escala del vuelo, que es lo correcto— pero si
    son muchas, algo pasa con el lote: fotos de dos camaras distintas, o de
    dos vuelos mezclados en la misma carpeta.
  */
  if (discrepan.length) {
    fallos.push(
      `${discrepan.length} de ${termicas} fotos tienen un rango de temperaturas raro para el ` +
      `resto del vuelo (${discrepan.slice(0, 3).join(", ")}` +
      `${discrepan.length > 3 ? "…" : ""}). Se las midio con la escala del vuelo igual. Si son ` +
      "muchas, fijate que no se hayan mezclado dos vuelos o dos camaras en la misma carpeta.",
    );
  }

  if (otraCamara.size && cam) {
    fallos.push(
      `Hay fotos de otra camara en el lote: la primera es de ${cam.imageW}×${cam.imageH} px y ` +
      `tambien aparecen ${[...otraCamara].join(", ")}. Todo el vuelo se proyecto con la primera, ` +
      "asi que las demas pueden estar ubicadas en la fila de al lado. Separá los vuelos en " +
      "carpetas distintas y volvé a correr cada uno.",
    );
  }

  /*
    Lo que hubo que corregir de la posicion de las fotos, y lo que no se pudo.

    Esto se dice siempre, aunque salga bien, porque es la diferencia entre un
    informe y una lista de numeros: si el corrimiento tipico es de dos metros,
    el GPS del vuelo estuvo malo y conviene saberlo antes de la proxima salida.
  */
  if (acc) {
    /*
      El parque no es el de estas fotos.

      Va antes que todo lo demas porque invalida todo lo demas. Si la huella de
      una foto no toca ninguna fila del parque no hay ni una caja que medir, y
      el vuelo termina con cero modulos y cero hallazgos — que en el campo se
      lee como "esta todo sano". Es la conclusion mas cara que puede sacar este
      programa y hasta ahora la sacaba en silencio.

      Pasa con el parque equivocado elegido, con uno viejo guardado antes de
      corregirle las coordenadas, o con un vuelo sobre una zona que todavia no
      esta cargada. Se dice con la distancia adentro: noventa metros es otro
      parque, dos metros es la geometria corrida.
    */
    const sinParque = acc.fotosSinParque();
    if (sinParque.length) {
      const lejos = Math.min(...sinParque.map((f) => f.metros));
      const todas = sinParque.length === termicas;
      fallos.push(
        (todas
          ? "NINGUNA de las fotos cayo sobre el parque. "
          : `${sinParque.length} de ${termicas} fotos cayeron afuera del parque. `) +
        `La fila mas cercana quedo a ${lejos.toFixed(0)} m de la foto mas cercana` +
        (sinParque.length > 1 ? ` (${sinParque[0]!.fileName}…)` : ` (${sinParque[0]!.fileName})`) +
        ". Esas fotos no se midieron: no hay ningun modulo adentro de su huella, asi que " +
        (todas
          ? "este vuelo no tiene NADA medido y la lista vacia de abajo NO quiere decir que este " +
            "todo sano. "
          : "los modulos que salian ahi quedaron sin revisar. ") +
        (lejos > 30
          ? "A esa distancia no es el GPS: es otro parque, o el parque guardado es viejo. Fijate " +
            "que el parque elegido sea el de este vuelo y que sea la version con las coordenadas " +
            "corregidas."
          : "A esa distancia puede ser la geometria del parque corrida en esa zona: revisa las " +
            "coordenadas de esas filas contra el plano."),
      );
    }

    const corrimientos = acc.corrimientos();
    if (corrimientos.length) {
      const tipico = [...corrimientos].sort((a, b) => a.metros - b.metros)[
        Math.floor(corrimientos.length / 2)
      ]!.metros;
      const peor = Math.max(...corrimientos.map((c) => c.metros));
      fallos.push(
        `A ${corrimientos.length} de ${termicas} fotos hubo que correrles la posicion para que ` +
        `los recuadros cayeran sobre los paneles: ${tipico.toFixed(1)} m tipico, ${peor.toFixed(1)} m ` +
        "la peor. Es el error del GPS del dron, y esta corregido — se dice para que lo sepas, no " +
        "porque haya que hacer algo. Con RTK esto se va casi a cero.",
      );
    }

    /*
      El vinieteo que hubo que sacarle a las fotos.

      Se dice porque es del EQUIPO, no del parque: si la camara mete cuatro
      grados entre el centro y la esquina, eso vale para todos los vuelos y
      conviene saberlo. Y porque es grande — mas que el umbral de anomalia
      leve, o sea que sin corregirlo cada vuelo trae defectos inventados.
    */
    /*
      La escala del EXIF contra la que se cuenta en la imagen.

      Todavia no se corrige, se dice. Es el ultimo error grande que queda y el
      unico que un corrimiento o un giro no pueden arreglar, porque crece desde
      el centro del cuadro hacia afuera.
    */
    const escalas = acc.desviosDeEscala();
    if (escalas.length) {
      const peor = escalas.reduce((a, b) => (Math.abs(b.factor - 1) > Math.abs(a.factor - 1) ? b : a));
      const pct = Math.abs(peor.factor - 1) * 100;
      fallos.push(
        `En ${escalas.length} de ${termicas} fotos, el paso entre modulos contado sobre la imagen ` +
        `no coincide con el que predice la altura del EXIF: hasta ${pct.toFixed(0)} % de diferencia. ` +
        "Sobre un cuadro de 640 px eso es mas de un metro de error en el borde, y no lo arregla " +
        "ningun corrimiento porque crece del centro hacia afuera. La causa mas probable es que la " +
        "altura del EXIF se mide contra el punto de despegue —el suelo— y los paneles estan dos " +
        "metros mas arriba. Todavia NO se corrige: con fotos sueltas el paso se cuenta en muy " +
        "pocas filas y corregir a medias deja el vuelo con dos escalas. Con solape va a haber con " +
        "que decidir.",
      );
    }

    const vinieteo = acc.vinieteo();
    if (vinieteo.length) {
      const peor = Math.max(...vinieteo.map((v) => v.maximoC));
      fallos.push(
        `A ${vinieteo.length} de ${termicas} fotos se les saco el sesgo del borde del cuadro: ` +
        `hasta ${peor.toFixed(1)} °C entre el centro y la esquina. No es del parque, es de la ` +
        "camara — el cuerpo y la lente irradian sobre los detectores de afuera, y todas las " +
        "termicas sin refrigerar lo hacen. Sin corregirlo, un modulo fotografiado en una esquina " +
        "sale con esos grados de mas contra hermanos fotografiados en el centro.",
      );
    }

    const perdidas = acc.fotosQueNoEngancharon();
    if (perdidas.length) {
      fallos.push(
        `${perdidas.length} de ${termicas} fotos no se pudieron enganchar a los paneles y NO se ` +
        "midieron (" + perdidas.slice(0, 3).map((p) => p.fileName).join(", ") +
        (perdidas.length > 3 ? "…" : "") + "). En esas fotos los recuadros caian sobre el pasto o " +
        "sobre la sombra al costado de la fila, y lo que sale de ahi no son defectos: es la textura " +
        "del suelo. Suele ser GPS malo, o que la geometria del parque no coincide con lo que hay " +
        "en el campo en esa zona.",
      );
    }

    const fuera = acc.cajasFueraDelPanel();
    if (fuera) {
      fallos.push(
        `${fuera} modulos quedaron sin medir porque su recuadro caia sobre algo mas frio que los ` +
        "paneles de su propia foto — la sombra al borde de la fila, casi siempre. No se midieron " +
        "en vez de reportarlos: un recuadro sobre la sombra da un punto caliente de +15 °C que no " +
        "existe.",
      );
    }
  }

  /*
    La prueba que el vuelo se hace a si mismo, y va PRIMERA.

    Todo lo demas que dice este informe —cuantos hallazgos, de que tipo, con
    que delta— depende de que la medicion sea repetible. Si el mismo panel
    medido dos veces da dos numeros distintos, la lista de defectos es ruido
    ordenado, y eso hay que leerlo antes que la lista.
  */
  if (acc) {
    const rep = acc.repetibilidad();
    if (!rep) {
      fallos.push(
        "Este vuelo no tiene solape: ningun modulo salio en dos fotos, asi que no hay forma de " +
        "chequear la medicion contra si misma. Con solape, cada panel se mide dos veces desde " +
        "posiciones distintas y las dos tienen que coincidir — es la unica prueba de que el motor " +
        "funciona que no necesita saber de antemano que panel esta roto.",
      );
    } else {
      const veredicto =
        rep.p90 <= REPETIBLE_C
          ? "La medicion es repetible."
          : rep.p90 <= REPETIBLE_C * 2
            ? "La medicion es repetible a medias: sirve para encontrar defectos grandes, no para " +
              "afirmar un ΔT."
            : "LA MEDICION NO ES REPETIBLE. Los hallazgos de abajo no se pueden defender: antes " +
              "de mirarlos hay que averiguar por que el mismo panel da dos numeros distintos.";
      fallos.push(
        `${rep.modulos} modulos salieron en dos fotos y se midieron dos veces. Entre las dos ` +
        `mediciones hay ${rep.mediana.toFixed(1)} °C de diferencia tipica, ${rep.p90.toFixed(1)} °C ` +
        `en el 10 % peor y ${rep.peor.toFixed(1)} °C en el peor caso. ${veredicto} ` +
        `Como referencia, el umbral de anomalia leve de este vuelo es de varios grados: la ` +
        "diferencia entre dos mediciones del mismo panel tiene que ser bastante menor que eso.",
      );
    }
  }

  if (opts.largoDeclarado === false) {
    fallos.push(
      `El perfil del parque no dice cuanto mide un modulo del lado largo, asi que se uso ` +
      `${opts.moduloLargoM.toFixed(3)} m. De ese numero sale el tamano del recuadro con el que se ` +
      "mide cada panel: si esta mal, la caja sobresale y mide el riel y el hueco, o se queda " +
      "corta y deja el defecto afuera. Medilo con cinta una vez y cargalo en el parque.",
    );
  }

  if (superRes) {
    fallos.push(
      `${superRes} de ${termicas} fotos vienen con "Super Resolution" prendida en la camara. ` +
      "Se midieron bien —la temperatura se lee del dato crudo, que viene al tamano real del " +
      "sensor— pero la imagen esta agrandada al doble con pixeles inventados: no ves un detalle " +
      "mas y cada archivo pesa cuatro veces. Apagala en la camara y el mismo vuelo entra en un " +
      "cuarto del espacio y sube cuatro veces mas rapido.",
    );
  }

  if (saturadas.length) {
    fallos.push(
      `${saturadas.length} de ${termicas} fotos llegan al tope del sensor (${topeMasAlto.toFixed(0)} °C) ` +
      "con una mancha, no un pixel suelto. Arriba de ese tope la camara guarda todo con el mismo " +
      "numero, asi que el ΔT de esas fotos es un PISO y no una medida: el defecto puede ser bastante " +
      "peor. Si te importa la temperatura exacta, subile el rango a la camara y revolá esas zonas. " +
      "Para encontrar los modulos a reemplazar, igual sirven.",
    );
  }

  const problemas =
    sinTermica && !termicas
      ? [
          `Ninguno de los ${files.length} archivos trae la temperatura adentro. Si elegiste las ` +
          "fotos visibles del par, faltan las termicas — las que terminan en _T.",
          ...fallos,
        ]
      : fallos;

  return {
    muestras: acc ? acc.muestras() : [],
    camera: cam,
    gsdCm: nGsd ? sumaGsd / nGsd : 0,
    fotosTermicas: termicas,
    soloEnElBorde: acc ? acc.soloEnElBorde() : 0,
    repetibilidad: acc ? acc.repetibilidad() : null,
    posesSupuestas: acc ? acc.posesSupuestas() : [],
    anguloMedio: nAngulo ? sumaAngulo / nAngulo : null,
    problemas,
    fixes,
  };
}

/** Arma la camara con lo que declara la propia foto. */
function camaraFrom(fix: PhotoFix, w: number, h: number): Camera | null {
  if (!fix.equiv35mm) return null;
  return camaraDesdeEquivalente35(fix.sensor ?? "camara del vuelo", fix.equiv35mm, w, h);
}

// ---------------------------------------------------------------------------
// De lo que midio el motor a lo que revisa una persona
// ---------------------------------------------------------------------------

function medicionDe(h: Hallazgo): Medicion {
  return {
    celsius: h.celsius,
    deltaT: h.deltaT,
    referenciaC: h.referenciaC,
    vecinos: h.vecinos,
    ambito: h.ambito,
    severidad: h.severidad,
    peor: h.peor,
    origen: h.origen,
    pixeles: h.pixeles,
    ...(h.puntoCalienteC != null ? { puntoCalienteC: h.puntoCalienteC } : {}),
    ...(h.deltaInterno != null ? { deltaInterno: h.deltaInterno } : {}),
    ...(h.severidadInterna ? { severidadInterna: h.severidadInterna } : {}),
    ...(h.pixelesPorCelda != null ? { pixelesPorCelda: h.pixelesPorCelda } : {}),
    ...(h.caja ? { caja: h.caja } : {}),
  };
}

/**
 * El identificador de un hallazgo: el modulo, no el momento en que se cargo.
 *
 * El anterior mezclaba un contador con el instante de la carga, porque un
 * hallazgo era una foto y dos fotos del mismo panel eran dos hallazgos
 * distintos. Ahora un hallazgo ES un modulo del parque, y el modulo tiene
 * nombre propio: la fila y su posicion adentro.
 *
 * De eso depende todo lo demas de este archivo. Volver a correr la deteccion
 * —porque se movio la grilla, porque se cambio un umbral, porque se agregaron
 * fotos— tiene que devolver el MISMO id para el mismo panel; si no, lo que el
 * tecnico ya confirmo aparece de nuevo como pendiente y el trabajo de revision
 * se pierde entero.
 */
export const idDeModulo = (rowId: string, positionInRow: number) =>
  `${rowId}#${positionInRow}`;

/**
 * Con cuanto error se le pasa al motor el centro del modulo medido. En metros.
 *
 * Un centimetro, y el numero importa. `locate` esta hecho para una coordenada
 * de GPS: con los 3 m que asume por defecto reparte la confianza entre trece
 * modulos vecinos y avisa —con razon— que "con esa precision no se puede
 * senalar un modulo solo".
 *
 * Pero esta coordenada NO viene de un GPS. Es el centro del modulo que se
 * midio, calculado por la geometria relevada del parque: no hay incertidumbre
 * que repartir. Sin decirselo, cada hallazgo del vuelo saldria al informe con
 * 15 % de confianza y un aviso que dice lo contrario de lo que pasa — que es
 * peor que no decir nada, porque el que lo lee no tiene como saber que el
 * aviso habla del GPS de otra cosa.
 *
 * Lo que SI sigue saliendo son los avisos de la fila: si esta fila no cierra
 * con la geometria del parque, el numero de modulo puede estar corrido y eso
 * hay que decirlo igual.
 */
const PRECISION_DE_LA_GEOMETRIA = 0.01;

/**
 * Convierte lo que midio el motor en hallazgos revisables.
 *
 * La direccion no se arma a mano: se le pasa al motor el centro del modulo que
 * se midio y se usa lo que contesta. Es la misma funcion que resuelve una
 * coordenada tomada en el campo, asi que la direccion que sale del vuelo y la
 * que sale del telefono parado al lado del panel no pueden discrepar. Armarla
 * por separado seria tener dos numeraciones que se leen igual.
 *
 * De paso quedan los candidatos, que son los modulos vecinos: es lo que la
 * pantalla ofrece para corregir el modulo mirando la foto.
 */
export function hallazgosAFindings(
  hallazgos: Hallazgo[],
  farm: CompiledFarm,
  frame: LocalFrame,
  fixes: Map<string, PhotoFix> = new Map(),
  /**
   * Los strings enteros calientes, que se cuelan como hallazgos propios.
   *
   * Van aparte porque se calculan sobre TODOS los hallazgos y no sobre la
   * lista corta: un string desconectado existe justamente porque NINGUN modulo
   * suyo se despega de sus hermanos, asi que ninguno esta en la lista corta.
   */
  stringsEnteros?: { eventos: EventoDeString[]; todos: Hallazgo[] },
): Finding[] {
  const deModulo = hallazgos.map((h) => {
    const centro = toGeo(frame, h.modulo.x, h.modulo.y);
    const res = locate({ lat: centro.lat, lon: centro.lon, accuracyM: PRECISION_DE_LA_GEOMETRIA }, farm);
    const fix = fixes.get(h.fileName);
    return {
      id: idDeModulo(h.modulo.rowId, h.modulo.positionInRow),
      fileName: h.fileName,
      ...(fix ? { fix } : {}),
      address: res.best,
      candidates: res.candidates.slice(0, 8),
      warnings: res.warnings,
      medicion: medicionDe(h),
      /*
        La anomalia viene PRECARGADA con lo que dice la forma de la mancha.

        Es lo que convierte revisar tres mil paneles en revisar una muestra. No
        se marca como confirmado: sigue en pendiente y con el motivo escrito al
        lado, para que la persona lo pueda desmentir de un vistazo en vez de
        tener que clasificarlo de cero.
      */
      ...(h.patron?.anomalia ? { anomaly: h.patron.anomalia } : {}),
      ...(h.clase ? { klass: h.clase.klass } : {}),
      ...(h.patron ? { patron: h.patron } : {}),
      ...(h.clase ? { clase: h.clase } : {}),
      status: "pendiente" as const,
    };
  });

  return stringsEnteros
    ? [
        ...deStringsEnteros(stringsEnteros.eventos, stringsEnteros.todos, farm, frame, fixes),
        ...deModulo,
      ]
    : deModulo;
}

/**
 * Los strings enteros calientes, como hallazgos de la lista.
 *
 * Estaban. El motor los encontraba —los dos strings desconectados del vuelo
 * del 3 de septiembre salieron con +5,4 y +4,2 °C sobre sus vecinos, sobre 27
 * y 23 modulos medidos— pero terminaban en una tabla de la pantalla de
 * analisis, no en la lista que se revisa y que se exporta. O sea: el defecto
 * mas caro que puede tener un parque, calculado bien, y afuera del entregable.
 *
 * Va uno por string, no 28 por modulo. Un string desconectado no son 28
 * modulos malos: es UNA conexion. Reportarlo como 28 lineas es lo que hace la
 * empresa de termografia del parque y es justo lo que infla sus informes.
 *
 * Se ancla en el modulo mas caliente que se le midio, para que tenga una foto,
 * un recuadro y una direccion a la que caminar.
 */
function deStringsEnteros(
  eventos: EventoDeString[],
  todos: Hallazgo[],
  farm: CompiledFarm,
  frame: LocalFrame,
  fixes: Map<string, PhotoFix>,
): Finding[] {
  const out: Finding[] = [];
  for (const e of eventos) {
    const delString = todos.filter(
      (h) => h.modulo.rowId === e.rowId && h.modulo.stringNumber === e.stringNumber,
    );
    if (!delString.length) continue;
    const ancla = delString.reduce((a, b) => (a.celsius >= b.celsius ? a : b));
    const centro = toGeo(frame, ancla.modulo.x, ancla.modulo.y);
    const res = locate({ lat: centro.lat, lon: centro.lon, accuracyM: PRECISION_DE_LA_GEOMETRIA }, farm);
    const fix = fixes.get(ancla.fileName);
    const porQue =
      `El string entero corre ${e.deltaTMedio.toFixed(1)} °C por encima de los otros, sobre ` +
      `${e.modulos} modulos medidos. ` +
      (e.motivo === "string-entero"
        ? "Ningun modulo se despega de sus hermanos: estan todos calientes por igual, que es la " +
          "firma de un string que no entrega corriente — desconectado, un fusible o un conector " +
          "abierto. No son 28 modulos malos, es una conexion."
        : "Ademas la mayoria de sus modulos dio anomalia por su cuenta: el string esta caliente " +
          "y desparejo.");
    out.push({
      // Id propio del STRING: si no, pisa al hallazgo de su modulo ancla y se
      // pierde uno de los dos al volver a correr la deteccion.
      id: `string:${e.rowId}#${e.stringNumber}`,
      fileName: ancla.fileName,
      ...(fix ? { fix } : {}),
      address: res.best,
      candidates: res.candidates.slice(0, 8),
      warnings: res.warnings,
      medicion: medicionDe(ancla),
      /*
        La anomalia y la clase van PRECARGADAS y con su gemelo de maquina al
        lado (`patron`, `clase`). Sin el gemelo, `revisado()` las lee como el
        toque de una persona y da el vuelo entero por revisado desde el minuto
        cero — ya paso una vez con la clasificacion por forma.
      */
      anomaly: "String completo",
      patron: {
        patron: "modulo-completo" as const,
        anomalia: "String completo",
        porQue,
        // Alta: esto no sale de la forma de una mancha, sale de comparar el
        // string contra los otros sobre decenas de modulos medidos.
        confianza: "alta" as const,
        fraccionCaliente: 1,
        grumos: 1,
      },
      /*
        Clase 2 y no 3. Un string caliente entero no es un riesgo agudo: no
        entrega corriente y hay que ir a mirarlo, pero no se prende fuego. La
        clase la sube la persona si lo que encuentra es una caja quemada.
      */
      klass: 2 as const,
      /*
        El motivo de la CLASE es otro texto que el del patron: la pantalla los
        muestra uno detras del otro, y poniendo el mismo en los dos el hallazgo
        salia con el parrafo repetido palabra por palabra.
      */
      clase: {
        klass: 2 as const,
        porQue:
          "Hay que ir a mirar la conexion de ese string, pero no corre riesgo agudo: se " +
          "programa con el resto del mantenimiento.",
      },
      status: "pendiente" as const,
    });
  }
  return out;
}

/**
 * Si una PERSONA ya toco este hallazgo.
 *
 * Ojo con la anomalia: desde que el motor clasifica por la forma de la mancha,
 * `anomaly` viene precargada en todos los hallazgos. Contarla como toque humano
 * dejaria "revisado" a todo el vuelo desde el minuto cero — y como los
 * revisados no se tiran al recorrer de nuevo, una lista vieja no se limpiaria
 * nunca. Cuenta solo si difiere de lo que propuso la maquina.
 */
const revisado = (f: Finding): boolean =>
  f.status !== "pendiente" ||
  (f.anomaly != null && f.anomaly !== f.patron?.anomalia) ||
  (f.klass != null && f.klass !== f.clase?.klass) ||
  f.note != null ||
  f.deltaT != null ||
  f.moduleCorregido != null;

/**
 * Vuelve a correr la deteccion sin perder lo que una persona ya reviso.
 *
 * Es la razon por la que el id es el modulo. Correr la deteccion de nuevo
 * —mover la grilla un metro, bajar un umbral, sumar las fotos del segundo
 * vuelo del dia— produce una lista nueva entera. Sin esto, las cuarenta
 * anomalias que el tecnico ya clasifico y confirmo vuelven a aparecer como
 * pendientes y hay que hacer el trabajo dos veces.
 *
 * Lo que midio el motor viene siempre de la corrida nueva: es la mitad que la
 * maquina sabe mejor. Lo que escribio la persona se conserva tal cual.
 *
 * Y los hallazgos que la corrida nueva ya no encuentra pero que alguien
 * reviso, no se tiran: quedan en la lista. Un modulo que el tecnico confirmo
 * como quemado no deja de estarlo porque se movio un umbral — y borrarlo en
 * silencio seria perder la unica parte del informe que tiene una firma atras.
 */
export function fusionarRevision(nuevos: Finding[], viejos: Finding[]): Finding[] {
  const porId = new Map(viejos.map((f) => [f.id, f]));
  const salida = nuevos.map((n) => {
    const v = porId.get(n.id);
    if (!v) return n;
    /*
      Lo que escribio la persona gana; lo que propuso la maquina, no.

      Sin esta distincion, una anomalia precargada por la corrida ANTERIOR
      pisaria la de la corrida nueva —que puede ser mejor, porque cambio el
      ajuste de la grilla o el umbral— y ademas quedaria registrada como si
      alguien la hubiera confirmado.
    */
    const humano = v.anomaly != null && v.anomaly !== v.patron?.anomalia;
    const claseHumana = v.klass != null && v.klass !== v.clase?.klass;
    return {
      ...n,
      status: v.status,
      ...(humano ? { anomaly: v.anomaly! } : {}),
      ...(claseHumana ? { klass: v.klass! } : {}),
      ...(v.deltaT != null ? { deltaT: v.deltaT } : {}),
      ...(v.note != null ? { note: v.note } : {}),
      ...(v.moduleCorregido != null ? { moduleCorregido: v.moduleCorregido } : {}),
    };
  });
  const vistos = new Set(nuevos.map((n) => n.id));
  for (const v of viejos) if (!vistos.has(v.id) && revisado(v)) salida.push(v);
  return salida;
}

/**
 * Vuelve a clasificar la lista guardada contra otros umbrales.
 *
 * Sin leer una sola foto: la temperatura del modulo, la de su punto mas
 * caliente y su delta contra los vecinos ya estan medidos y no dependen de
 * ningun umbral. Lo unico que decide un umbral es como se llama ese numero.
 *
 * Con las fotos todavia cargadas la pantalla puede hacer algo mejor —volver a
 * comparar todas las muestras, y ahi bajar el umbral tambien SUMA modulos que
 * antes no llegaban—; esto es lo que queda cuando el vuelo se abre un mes
 * despues y las fotos estan en otro disco. Los dos caminos clasifican con la
 * misma funcion, asi que un hallazgo que aparece en los dos sale igual.
 */
export function reclasificarFindings(
  findings: Finding[],
  umbrales: Umbrales,
  internos: Umbrales = UMBRALES_INTERNOS,
): Finding[] {
  return findings.map((f) => {
    if (!f.medicion) return f;
    const m = f.medicion;
    const c = clasificar(m, umbrales, internos);
    return {
      ...f,
      medicion: {
        celsius: m.celsius,
        deltaT: m.deltaT,
        referenciaC: m.referenciaC,
        vecinos: m.vecinos,
        ambito: m.ambito,
        pixeles: m.pixeles,
        ...(m.puntoCalienteC != null ? { puntoCalienteC: m.puntoCalienteC } : {}),
        ...(m.pixelesPorCelda != null ? { pixelesPorCelda: m.pixelesPorCelda } : {}),
        ...(m.caja ? { caja: m.caja } : {}),
        ...c,
      },
    };
  });
}

// ---------------------------------------------------------------------------
// Lo que el vuelo no permite afirmar
// ---------------------------------------------------------------------------

export interface DatosDeCobertura {
  resultado: ResultadoDeVuelo;
  /** TODAS las muestras comparadas, no solo las que dieron anomalia. */
  hallazgos: Hallazgo[];
  totalModulos: number;
  /** Cuantos modulos tiene el string de cada fila. */
  modulosPorString: (rowId: string) => number | undefined;
  celdaM: number;
  umbrales: Umbrales;
  fotos: number;
}

/**
 * El resumen de cobertura del vuelo, listo para guardarse.
 *
 * Se calculaba en la pantalla, se mostraba, y se perdia al cerrarla. Es lo mas
 * valioso que produce la deteccion: un informe que no dice que NO miro no
 * sirve para un reclamo.
 */
export function coberturaDe(d: DatosDeCobertura): Cobertura {
  const eventos = eventosDeString(d.hallazgos, d.modulosPorString);
  const resumen = resumir(
    d.hallazgos,
    d.totalModulos,
    eventos,
    d.resultado.gsdCm,
    d.resultado.soloEnElBorde,
    d.resultado.posesSupuestas,
    d.celdaM,
    stringsEnVariasTandas(d.resultado.muestras),
  );
  return {
    analizadoEl: new Date().toISOString(),
    fotos: d.fotos,
    fotosTermicas: d.resultado.fotosTermicas,
    gsdCm: d.resultado.gsdCm,
    totalModulos: d.totalModulos,
    modulosMedidos: resumen.modulosMedidos,
    soloEnElBorde: d.resultado.soloEnElBorde,
    sinMedir: resumen.sinMedir,
    umbrales: d.umbrales,
    posesSupuestas: d.resultado.posesSupuestas,
    eventosDeString: eventos,
    limitaciones: resumen.limitaciones,
  };
}

// ---------------------------------------------------------------------------
// Los vuelos que quedaron guardados con el modelo viejo
// ---------------------------------------------------------------------------

/**
 * Rescata el analisis que la pantalla vieja guardaba por su cuenta.
 *
 * Cuando habia dos caminos, el automatico se guardaba aparte: un
 * `StoredAnalysis` por parque, con los hallazgos medidos y nada de revision
 * humana —esa vivia del otro lado, en otra lista—. Al unificar, esa clave deja
 * de tener quien la lea, y adentro esta el ultimo vuelo analizado de cada
 * parque.
 *
 * Se convierte en un vuelo normal en vez de dejarlo morir en la base. Lo que
 * no se puede recuperar es la cobertura: el analisis viejo guardaba los
 * hallazgos y el GSD, pero no cuantos modulos del parque no cayeron en ninguna
 * foto ni cuantos quedaron cortados por el borde. Eso se dice en el propio
 * vuelo en vez de dejar el hueco en blanco, que se leeria como "no hubo
 * ninguno".
 */
export function vueloDesdeAnalisis(
  analisis: StoredAnalysis,
  stored: StoredFarm,
  farm: CompiledFarm,
): Inspection {
  const frame = makeFrame(farm.origin.lat, farm.origin.lon);
  return {
    id: `${analisis.farmId}-analisis-viejo`,
    farmId: analisis.farmId,
    farmName: stored.profile.name,
    name: `Vuelo analizado el ${new Date(analisis.savedAt).toLocaleDateString("es-AR")}`,
    createdAt: analisis.savedAt,
    conditions: {},
    findings: hallazgosAFindings(analisis.hallazgos, farm, frame),
    cobertura: {
      analizadoEl: analisis.savedAt,
      fotos: analisis.fotos,
      fotosTermicas: analisis.fotos,
      gsdCm: analisis.gsdCm,
      totalModulos: 0,
      modulosMedidos: analisis.hallazgos.length,
      soloEnElBorde: 0,
      sinMedir: 0,
      umbrales: UMBRALES,
      posesSupuestas: [],
      eventosDeString: [],
      limitaciones: [
        "Este vuelo viene del analisis que la version anterior guardaba aparte. Trae los modulos " +
        "que dieron anomalia y su medicion, pero NO trae la cobertura: no quedo registrado " +
        "cuantos modulos del parque no cayeron en ninguna foto ni cuantos aparecieron solo " +
        "cortados por el borde del cuadro. Para tener eso hay que volver a cargar las fotos del " +
        "vuelo.",
      ],
    },
  };
}

// ---------------------------------------------------------------------------
// Atajos que usan las dos puntas
// ---------------------------------------------------------------------------

/** El lado de celda de este parque, o el tipico si el perfil no lo declara. */
export const celdaDelParque = (stored: StoredFarm): number =>
  (stored.profile.module.cellMm ?? CELDA_M * 1000) / 1000;

/** El largo del modulo sobre el eje corto, o el respaldo historico. */
export const largoDelModulo = (stored: StoredFarm): number =>
  (stored.profile.module.lengthMm ?? LARGO_MODULO_M * 1000) / 1000;

/**
 * Los hallazgos de un vuelo, comparados y clasificados.
 *
 * Es `comparar` con nombre, para que la pantalla no tenga que acordarse de
 * pasarle los dos juegos de umbrales en el orden correcto.
 */
export const compararConUmbrales = (muestras: Muestra[], umbrales: Umbrales): Hallazgo[] =>
  muestras.length ? comparar(muestras, umbrales, UMBRALES_INTERNOS) : [];
