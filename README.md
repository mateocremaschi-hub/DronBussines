# @pica/locator

Motor puro de localizacion para inspeccion de plantas fotovoltaicas.

```
locate(coordenada, farm) → direccion fisica + candidatos + confianza
```

Es la Etapa 1 del plan: extraer el calculo que ya funciona en Edenvale y dejarlo
independiente de Edenvale, para que dar de alta un parque nuevo sea llenar un
JSON y no escribir codigo.

---

## Por que no hay tabla de paneles

La app de Edenvale es de inventario: su centro es una tabla de 377.884 paneles,
cada uno con serial e historia. Un servicio de inspeccion no necesita eso. La
posicion de cualquier modulo es **calculable** desde la geometria del tracker
mas un punado de parametros.

Una farm de 400.000 modulos son unos 6.000 segmentos de fila: unos pocos MB, que
entran enteros en un celular. Sin tabla de paneles no hay sync masivo, no hay
paginacion de 1.000 filas, no hay avalancha de eventos de Realtime, no hay
reconciliaciones por Excel.

Los seriales son una capa opcional que se cruza **despues** de localizar.

---

## Uso

```ts
import { compileFarm, locate, formatAddress, parseCoordinate } from "@pica/locator";
import edenvale from "@pica/locator/farms/edenvale.json";

// 1. Compilar una vez, al cargar el parque.
const farm = compileFarm(edenvale, rows); // `rows` sale de la capa de ingesta

// Los problemas de datos aparecen aca, no con el tecnico parado en el campo.
for (const w of farm.buildWarnings) console.warn(w.message);

// 2. Consultar tantas veces como haga falta.
const fix = parseCoordinate(`27°30'15.6"S 152°45'10.2"E`); // pegado de Google Maps
const res = locate({ ...fix, accuracyM: 4 }, farm);

console.log(formatAddress(res.best!));
// Bloque 05, tracker 05-042 R1, string 2, modulo 1 (desde la punta lejana)

for (const c of res.candidates.slice(0, 5)) {
  console.log(`  ${(c.confidence * 100).toFixed(0)}%  modulo ${c.module}  a ${c.distanceM.toFixed(1)} m`);
}
```

### Nunca una sola respuesta

Sin RTK el GPS tiene entre 2 y 5 m de error: entre 2 y 4 modulos. Devolver un
unico resultado es mentirle al tecnico que lo va a caminar. `candidates` viene
ordenada por distancia real y con la confianza repartida — es parte del
resultado, no un extra.

### Diagnostico siempre presente

`res.diagnostics.winner` trae `t`, el largo del segmento, el paso usado, que
extremo resulto ser el origen de conteo, que estrategias se aplicaron y si el
string se invirtio. No es un modo debug: lo consumen la UI, el reporte y los
tests.

---

## Anatomia

```
src/
  types.ts              contratos publicos; no importa nada
  geo/
    frame.ts            marco local plano con los radios reales del elipsoide
    segment.ts          proyeccion punto -> segmento
    utm.ts              UTM <-> WGS84 (los Excel de picas vienen en UTM)
    dms.ts              coordenadas pegadas a mano, sin convertir
  strategies/
    origin.ts           de que extremo se cuenta el modulo 1
    inversion.ts        si un string cuenta al reves
  profile/
    validate.ts         el perfil rompe al cargarlo, no en el campo
    compile.ts          resuelve todo lo estatico una sola vez
  locate.ts             el motor
farms/                  un JSON por parque
fixtures/               puntos verificados en el campo
```

**Regla estructural:** las dependencias apuntan solo hacia abajo. `locate.ts` no
sabe de disco, de red ni de UI, y el `tsconfig.build.json` le saca los tipos de
Node para que romper esa regla falle en el typecheck.

---

## Las dos estrategias

Son el unico lugar donde puede hacer falta codigo nuevo al dar de alta un parque.
Por eso son estrategias con nombre y no condicionales sueltos: un segundo parque
con el mismo racking hereda la estrategia gratis.

**`originStrategy`** — de que extremo se cuenta el modulo 1:

- `fixed-end` — siempre desde el mismo extremo geografico.
- `dc-box-end` — desde la caja DC de la fila. Con las cajas en la calle del medio,
  el extremo de conteo es el opuesto al lado del tracker, e inverso entre los dos
  lados de la calle.
- `per-row-flag` — un bit explicito por fila.

**`inversionStrategy`** — si un string cuenta al reves:

- `none` — todos los strings cuentan igual.
- `piercing-chain` — verificado en campo en Edenvale. Entre trackers consecutivos
  de una linea hay un piercing connector que lleva la energia por un cable
  central, y cada string cuenta desde su punto de conexion mas cercano. Si el
  tracker **no** es el ultimo de su linea, el string lejano se invierte: modulo 28
  contra el medio, modulo 1 en la punta. Si esta solo o es el ultimo, los dos
  strings cuentan igual.
- `per-string-flag` — un bit explicito por string.

### Los `*-flag` son la garantia de que un alta nunca se traba

Si aparece un parque con una regla que todavia no entendes, la expresas como
**dato** en vez de esperar codigo nuevo. Cobras, entregas, y si mas adelante
descubris el patron, lo promoves a estrategia con nombre.

El motor tampoco extrapola: `piercing-chain` con mas de dos strings por fila se
rechaza al validar el perfil, con un mensaje que apunta a `per-string-flag`.
Adivinar donde caen los piercings seria repetir exactamente el error que ya
costo dos viajes al campo.

---

## El chequeo que evita volver al campo

Al compilar, cada fila compara el largo real del segmento contra el que predice
el paso declarado, y avisa si no cierran:

```
La fila "05-042-R1" mide 63.20 m. Con 56 modulos y offsets de 1.40/1.40 m, el
paso deberia ser 1079 mm, pero el perfil declara 1150 mm (diferencia de -71 mm
por modulo). Revisa la geometria de esa fila o el paso del perfil.
```

Es la senal mas barata de que la geometria importada esta mal. Los bloques de
trazado disperso de Edenvale, que se descubrieron mirando el mapa a ojo, saltan
aca solos.

---

## Fixtures

`fixtures/` congela puntos verificados fisicamente en el campo. Ver
[fixtures/README.md](fixtures/README.md).

Los tests sinteticos ya prueban la mecanica de todos los casos conocidos. Lo que
falta, y es lo unico que no se puede simular, son las coordenadas reales: hay
tres fixtures cargados con sus expectativas, esperando la coordenada.

---

## Comandos

```bash
npm test          # 84 tests
npm run typecheck
npm run build
```
