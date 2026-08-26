"""
Fotos termicas sinteticas con la forma de las que escribe un DJI.

Sirven para probar el analisis entero en el navegador sin ir a volar: llevan
crudo termico en segmentos APP3, GPS y focal equivalente en el EXIF, y angulo
de gimbal y altura sobre el terreno en el XMP — igual que las reales.

La escena es un parque a 40 grados con UN PARCHE CALIENTE sobre una fila
conocida. Si el analisis funciona, tiene que marcar esa fila y ninguna otra.

    python3 scripts/make-thermal.py
"""
import io, math, os, struct
import numpy as np
from PIL import Image
import piexif

W, H = 640, 512
EQ35 = 40                      # focal equivalente: la misma que declara un M3T
AGL = 30.0                     # altura sobre el terreno
DIAG35 = math.hypot(36, 24)
TAN = DIAG35 / (2 * EQ35)
D = math.hypot(W, H)
HFOV = 2 * math.degrees(math.atan(TAN * W / D))
VFOV = 2 * math.degrees(math.atan(TAN * H / D))
ANCHO = 2 * AGL * math.tan(math.radians(HFOV) / 2)
ALTO = 2 * AGL * math.tan(math.radians(VFOV) / 2)

# Geometria del parque de ejemplo (ver scripts/make-sample.mjs).
LAT0, LON0 = -27.4, 152.7
M_LAT = 110946.0
M_LON = 111320.0 * math.cos(math.radians(LAT0))
LEN, ROAD, SPACING = 65.145, 8.0, 6.0

# La fila caliente: el tracker 05-004 (i = 3) del lado norte, a mitad de largo.
I_CALIENTE = 3
LAT_CAL = LAT0 - (LEN / 2) / M_LAT
LON_CAL = LON0 + (I_CALIENTE * SPACING) / M_LON

BASE_C, SUELO_C, CALIENTE_C = 40.0, 30.0, 62.0
k = lambda c: int(round((c + 273.15) * 64))   # 1/64 de kelvin

# Un segmento APP1 con XMP tiene que arrancar con este identificador
# terminado en cero. Sin el, ningun lector lo reconoce como XMP.
XMP_ID = b"http://ns.adobe.com/xap/1.0/\x00"

def xmp(yaw):
    return XMP_ID + (
        '<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>'
        '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF '
        'xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">'
        '<rdf:Description rdf:about="" xmlns:drone-dji="http://www.dji.com/drone-dji/1.0/" '
        'drone-dji:ImageSource="InfraredCamera" '
        f'drone-dji:RelativeAltitude="+{AGL:.3f}" '
        f'drone-dji:GimbalPitchDegree="-90.00" drone-dji:GimbalYawDegree="{yaw:+.2f}" '
        'drone-dji:GimbalRollDegree="+0.00" drone-dji:DroneModel="SINTETICO"/>'
        '</rdf:RDF></x:xmpmeta><?xpacket end="w"?>'
    ).encode()

def gradosMin(v, ref):
    v = abs(v); g = int(v); m = int((v - g) * 60); s = round((v - g - m / 60) * 3600 * 100)
    return [(g, 1), (m, 1), (s, 100)]

def foto(lat, lon, path, yaw=0.0):
    # Escena: suelo con textura, y el parche caliente si cae en el cuadro.
    esc = np.random.default_rng(7).normal(BASE_C, 0.35, (H, W))
    esc[: H // 12, :] = SUELO_C

    dx = (LON_CAL - lon) * M_LON
    dy = (LAT_CAL - lat) * M_LAT
    px = (dx / ANCHO + 0.5) * W
    py = (0.5 - dy / ALTO) * H
    r = 1.8 / (ANCHO / W)          # un parche de 1.8 m
    x0, x1 = int(px - r), int(px + r)
    y0, y1 = int(py - 4 * r), int(py + 4 * r)
    xs, ys = slice(max(0, x0), min(W, x1)), slice(max(0, y0), min(H, y1))
    if x1 > 0 and x0 < W and y1 > 0 and y0 < H:
        esc[ys, xs] = CALIENTE_C

    crudo = np.vectorize(k)(esc).astype("<u2")

    # JPEG base con el EXIF, y despues se le inyectan APP3 y XMP a mano.
    vis = ((esc - esc.min()) / max(1e-6, float(esc.max() - esc.min())) * 255).astype("u1")
    buf = io.BytesIO()
    Image.fromarray(vis).convert("RGB").save(buf, "JPEG", quality=80)
    ex = {"0th": {piexif.ImageIFD.Make: b"SINTETICO", piexif.ImageIFD.Model: b"TERMICA"},
          "Exif": {piexif.ExifIFD.FocalLengthIn35mmFilm: EQ35,
                   piexif.ExifIFD.DateTimeOriginal: b"2026:03:25 12:00:00"},
          "GPS": {piexif.GPSIFD.GPSLatitudeRef: b"S" if lat < 0 else b"N",
                  piexif.GPSIFD.GPSLatitude: gradosMin(lat, "S"),
                  piexif.GPSIFD.GPSLongitudeRef: b"E" if lon >= 0 else b"W",
                  piexif.GPSIFD.GPSLongitude: gradosMin(lon, "E"),
                  piexif.GPSIFD.GPSAltitudeRef: 0,
                  piexif.GPSIFD.GPSAltitude: (int(AGL * 100), 100)},
          "1st": {}, "thumbnail": None}
    out = io.BytesIO()
    piexif.insert(piexif.dump(ex), buf.getvalue(), out)
    d = out.getvalue()

    # Los segmentos van DESPUES del APP1 con el EXIF, como en un archivo real:
    # si el crudo se mete antes, el lector de metadatos no llega al GPS.
    # El XMP va ANTES del crudo, como en un archivo real: si queda detras de
    # los 650 kB de temperaturas, los lectores que solo miran el arranque del
    # archivo no llegan nunca.
    x = xmp(yaw)
    segs = b"\xff\xe1" + struct.pack(">H", len(x) + 2) + x
    bs = crudo.tobytes()
    for i in range(0, len(bs), 65000):
        t = bs[i : i + 65000]
        segs += b"\xff\xe3" + struct.pack(">H", len(t) + 2) + t

    corte = 2
    if d[2:4] == b"\xff\xe1":                      # el APP1 del EXIF
        corte = 4 + struct.unpack(">H", d[4:6])[0]
    open(path, "wb").write(d[:corte] + segs + d[corte:])

os.makedirs("public/termicas", exist_ok=True)
n = 0
# Grilla que cubre el bloque norte del parque de ejemplo.
for j in range(7):
    for i in range(4):
        lat = LAT0 - (8 + j * (ALTO * 0.55)) / M_LAT
        lon = LON0 + (i * (ANCHO * 0.55)) / M_LON
        foto(lat, lon, f"public/termicas/T_{n:03d}.jpg")
        n += 1
print(f"Escritas {n} fotos termicas en public/termicas/")
print(f"  {W}x{H} · {AGL:.0f} m · HFOV {HFOV:.1f} · huella {ANCHO:.1f} x {ALTO:.1f} m")
print(f"  parche caliente a {CALIENTE_C:.0f} C sobre el tracker 05-{I_CALIENTE+1:03d}")
