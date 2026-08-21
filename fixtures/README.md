# Fixtures de campo

Cada archivo de esta carpeta congela **un punto verificado fisicamente**: alguien
se paro al lado de un panel, conto los modulos desde la caja DC, leyo el serial,
y anoto la coordenada.

Esta carpeta es el activo real del negocio. Cualquiera compra un dron con camara
termica; nadie mas tiene reglas de conteo verificadas en el campo para los
rackings que se usan aca. Despues de tres parques, dar de alta el cuarto deja de
ser una investigacion y pasa a ser una configuracion.

## Como agregar uno

1. Copia `edenvale/_TEMPLATE.json`.
2. Llena `row` con la geometria de esa fila: las dos picas, el lado de la calle,
   la posicion del tracker en su linea (`pos` de `posTotal`) y los numeros de
   string. Sale del Excel de picas y de los planos.
3. Llena `fix` con la coordenada medida. Se puede escribir de dos formas:
   - `"fix": { "lat": -27.5043333, "lon": 152.7528333 }`
   - `"fixText": "27°30'15.6\"S 152°45'10.2\"E"` — pegado tal cual de Google Maps,
     sin convertir a mano. La conversion manual ya costo una sesion entera.
4. Llena `expect` con lo que contaste **fisicamente**, no con lo que dice la app.
5. Cambia `"status"` de `"pending"` a `"verified"`.
6. `npm test`.

## `mode`: cuando exigir el modulo exacto

- `"exact"` — el motor tiene que devolver ese modulo como mejor resultado.
  Usalo cuando la coordenada es buena (RTK, o medida parado justo ahi).
- `"within-candidates"` — alcanza con que el modulo esperado aparezca en la lista
  de candidatos. Usalo cuando la coordenada viene de un GPS sin RTK: con 3 a 5 m
  de error, exigir el modulo exacto testea la suerte, no el codigo.

Un fixture `within-candidates` igual verifica lo que mas importa: el bloque, el
tracker, la fila, el string y el sentido de conteo.

## Que cubre cada fixture

El campo `covers` dice que regla queda verificada por ese punto. El objetivo es
que cada estrategia del perfil tenga al menos un fixture por caso:

| Caso | Estado |
|---|---|
| `piercing-chain`: tracker aislado o ultimo de linea | pendiente de coordenada |
| `piercing-chain`: tracker no-ultimo, string lejano invertido | pendiente de coordenada |
| `dc-box-end`: tracker del lado norte | pendiente de coordenada |
| `dc-box-end`: tracker del lado sur | pendiente de coordenada |
| Numeros de string no correlativos | pendiente de coordenada |
| Bloques de trazado disperso | sin verificar |

Los tests sinteticos ya prueban la mecanica de todos estos casos. Lo que falta,
y es lo unico que no se puede simular, es la coordenada real.
