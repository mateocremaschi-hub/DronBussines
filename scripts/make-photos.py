"""
Genera fotos de ejemplo con coordenada GPS en los metadatos EXIF, sobre los
trackers del ejemplo-picas.xlsx.

Sirve para probar el lote de vuelo sin dron y sin salir a la calle.

    python3 scripts/make-photos.py
"""
import os
from fractions import Fraction

import piexif
from PIL import Image, ImageDraw

# Mismo bloque que genera scripts/make-sample.mjs
LAT0, LON0 = -27.4, 152.7
M_PER_DEG_LAT = 110946.0
M_PER_DEG_LON = 111320.0 * 0.887  # cos(-27.4 grados)

STRING = 28 * 1.15 - 0.02
MOTOR = 3.713
VOLADIZO = 1.464
LEN = 2 * STRING + MOTOR - 2 * VOLADIZO
SPACING = 6.0

OUT = "public/fotos-ejemplo"
os.makedirs(OUT, exist_ok=True)


def to_dms(value):
    value = abs(value)
    d = int(value)
    m = int((value - d) * 60)
    s = round((value - d - m / 60) * 3600, 4)
    f = Fraction(s).limit_denominator(10000)
    return ((d, 1), (m, 1), (f.numerator, f.denominator))


def write(name, lat, lon, titulo):
    img = Image.new("RGB", (640, 480), (26, 30, 36))
    d = ImageDraw.Draw(img)
    # Una "termica" de mentira: la fila de modulos y un punto caliente.
    for i in range(9):
        x = 40 + i * 64
        color = (200, 90, 40) if i == 4 else (60, 80, 110)
        d.rectangle([x, 150, x + 56, 330], fill=color, outline=(120, 140, 160))
    d.text((40, 40), titulo, fill=(230, 236, 241))
    d.text((40, 400), f"{lat:.6f}, {lon:.6f}", fill=(150, 160, 175))

    exif = {
        "0th": {piexif.ImageIFD.Make: b"Pica", piexif.ImageIFD.Model: b"Ejemplo"},
        "Exif": {piexif.ExifIFD.DateTimeOriginal: b"2026:08:21 10:15:00"},
        "GPS": {
            piexif.GPSIFD.GPSLatitudeRef: b"S" if lat < 0 else b"N",
            piexif.GPSIFD.GPSLatitude: to_dms(lat),
            piexif.GPSIFD.GPSLongitudeRef: b"W" if lon < 0 else b"E",
            piexif.GPSIFD.GPSLongitude: to_dms(lon),
            piexif.GPSIFD.GPSAltitude: (60, 1),
            piexif.GPSIFD.GPSAltitudeRef: 0,
            piexif.GPSIFD.GPSHPositioningError: (3, 1),
        },
        "1st": {}, "thumbnail": None,
    }
    img.save(os.path.join(OUT, name), "jpeg", quality=80, exif=piexif.dump(exif))


# Seis puntos repartidos sobre los trackers del lado norte del bloque.
puntos = [
    ("PICA_0001.JPG", 0, 4.0, "tracker 05-001 · cerca de la punta norte"),
    ("PICA_0002.JPG", 1, 20.0, "tracker 05-002 · primer string"),
    ("PICA_0003.JPG", 2, 33.0, "tracker 05-003 · sobre la bahia del motor"),
    ("PICA_0004.JPG", 3, 48.0, "tracker 05-004 · segundo string"),
    ("PICA_0005.JPG", 7, 62.0, "tracker 05-008 · cerca de la punta sur"),
    ("PICA_0006.JPG", 11, 30.0, "tracker 05-012 · medio"),
]

for name, tracker, metros_desde_norte, titulo in puntos:
    lat = LAT0 - metros_desde_norte / M_PER_DEG_LAT
    lon = LON0 + (tracker * SPACING) / M_PER_DEG_LON
    write(name, lat, lon, titulo)

# Una sin GPS a proposito: el lote no se tiene que caer por esto.
img = Image.new("RGB", (640, 480), (40, 30, 30))
ImageDraw.Draw(img).text((40, 40), "foto sin coordenada", fill=(230, 236, 241))
img.save(os.path.join(OUT, "SIN_GPS.JPG"), "jpeg", quality=80)

print(f"Escritas {len(puntos) + 1} fotos en {OUT} (una sin GPS a proposito).")
print(f"Largo de fila usado: {LEN:.3f} m")
