"""
RZR-Track - API REST ligera en Flask para conectar el script de consola
con el frontend web (index.html, styles.css, app.js).

Ejecucion local (sin uvicorn):
  pip install -r requirements.txt
  python main.py
"""

import base64
from datetime import datetime
from functools import wraps
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import secrets
import time

from flask import Flask, g, jsonify, request, send_from_directory
from flask_cors import CORS

ROOT_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = Path(__file__).resolve().parent / "data"
SECRET_KEY = os.environ.get("SESSION_SECRET", secrets.token_hex(32)).encode("utf-8")

app = Flask(__name__)

# CORS configurado para desarrollo local del frontend HTML/CSS/JS
CORS(
    app,
    resources={
        r"/api/*": {
            "origins": [
                "http://localhost:3000",
                "http://127.0.0.1:3000",
                "http://localhost:5000",
                "http://127.0.0.1:5000",
                "http://localhost:5500",
                "http://127.0.0.1:5500",
            ],
            "methods": ["GET", "POST", "OPTIONS"],
            "allow_headers": ["Authorization", "Content-Type"],
            "supports_credentials": True,
        }
    },
)

SUCURSALES = {
    1: "Mazamitla",
    2: "Tapalpa",
    3: "Mazatlán",
    4: "Chacala",
}
RZR_DISPONIBLES = ["RZR-01", "RZR-02", "RZR-05"]
TARIFA_POR_HORA = 500.00
COSTO_EXTRAS = 300.00
ARCHIVOS_PREVIOS = [
    "reservas.txt",
    "clientes.txt",
    "sucursales.txt",
    "rzr_disponibles.txt",
]

hoy = datetime.now()
FECHA_ACTUAL = (hoy.day, hoy.month, hoy.year)


def formato_fecha_texto(fecha: tuple[int, int, int]) -> str:
    return f"{fecha[0]:02d}/{fecha[1]:02d}/{fecha[2]}"


def parse_fecha(fecha_texto: str) -> tuple[bool, tuple[int, int, int]]:
    try:
        dia_t, mes_t, anio_t = str(fecha_texto).strip().split("/")
        dia, mes, anio = int(dia_t), int(mes_t), int(anio_t)
        if not (1 <= dia <= 31 and 1 <= mes <= 12 and 2000 <= anio <= 2100):
            return False, (1, 1, 2023)
        return True, (dia, mes, anio)
    except ValueError:
        return False, (1, 1, 2023)


def asegurar_archivos(reiniciar: bool = False) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    usuarios_path = DATA_DIR / "usuarios.txt"
    if not usuarios_path.exists():
        usuarios_path.touch()

    fecha_str = str(FECHA_ACTUAL)
    plantillas = {
        "reservas.txt": f"Reservas - Fecha: {fecha_str}\n",
        "clientes.txt": f"Clientes - Fecha: {fecha_str}\n",
        "sucursales.txt": f"Sucursales: Mazamitla, Tapalpa, Mazatlan, Chacala - Fecha: {fecha_str}\n",
        "rzr_disponibles.txt": f"RZR disponibles: RZR-01, RZR-02, RZR-05 - Fecha: {fecha_str}\n",
    }
    for nombre, contenido in plantillas.items():
        ruta = DATA_DIR / nombre
        if reiniciar or not ruta.exists():
            ruta.write_text(contenido, encoding="utf-8")


def resolver_archivo_seguro(nombre: str) -> Path | None:
    limpio = str(nombre).strip()
    if not re.match(r"^[a-zA-Z0-9_.-]+\.txt$", limpio) or limpio.lower() == "usuarios.txt":
        return None
    ruta = (DATA_DIR / limpio).resolve()
    if ruta.parent != DATA_DIR.resolve():
        return None
    return ruta


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.scrypt(
        password.encode("utf-8"), salt=salt.encode("utf-8"), n=16384, r=8, p=1
    ).hex()
    return f"{salt}:{digest}"


def verify_password(password: str, stored: str) -> bool:
    if ":" not in stored:
        return False
    salt, expected = stored.split(":", 1)
    digest = hashlib.scrypt(
        password.encode("utf-8"), salt=salt.encode("utf-8"), n=16384, r=8, p=1
    ).hex()
    return hmac.compare_digest(digest, expected)


def firmar_token(usuario: str, nickname: str) -> str:
    payload = json.dumps(
        {"usuario": usuario, "nickname": nickname, "exp": int(time.time()) + 28800}
    ).encode("utf-8")
    b64 = base64.urlsafe_b64encode(payload).decode("utf-8")
    sig = hmac.new(SECRET_KEY, b64.encode("utf-8"), hashlib.sha256).hexdigest()
    return f"{b64}.{sig}"


def require_auth(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        auth_header = request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            return jsonify({"error": "Sesión requerida. Inicia sesión para continuar."}), 401
        token = auth_header[7:].strip()
        if "." not in token:
            return jsonify({"error": "Token inválido."}), 401
        b64, sig = token.split(".", 1)
        expected_sig = hmac.new(SECRET_KEY, b64.encode("utf-8"), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sig, expected_sig):
            return jsonify({"error": "Token inválido."}), 401
        try:
            data = json.loads(base64.urlsafe_b64decode(b64.encode("utf-8")).decode("utf-8"))
        except Exception:
            return jsonify({"error": "Token inválido."}), 401
        if time.time() > data.get("exp", 0):
            return jsonify({"error": "Sesión expirada. Vuelve a iniciar sesión."}), 401
        g.session = data
        return fn(*args, **kwargs)

    return wrapper


def leer_usuarios() -> dict[str, str]:
    usuarios_path = DATA_DIR / "usuarios.txt"
    if not usuarios_path.exists():
        return {}
    resultado: dict[str, str] = {}
    for linea in usuarios_path.read_text(encoding="utf-8").splitlines():
        linea = linea.strip()
        if "," in linea:
            user, secret = linea.split(",", 1)
            resultado[user] = secret
    return resultado


# =========================================================
# SERVICIO DE ARCHIVOS ESTÁTICOS DEL FRONTEND (OPCIONAL)
# =========================================================
@app.get("/")
def serve_index():
    return send_from_directory(ROOT_DIR, "index.html")


@app.get("/styles.css")
def serve_styles():
    return send_from_directory(ROOT_DIR, "styles.css")


@app.get("/app.js")
def serve_app_js():
    return send_from_directory(ROOT_DIR, "app.js")


@app.get("/src/assets/images/<path:filename>")
def serve_images(filename: str):
    images_dir = ROOT_DIR / "src" / "assets" / "images"
    return send_from_directory(images_dir, filename)


# =========================================================
# ENDPOINTS REST DE RZR-TRACK
# =========================================================
@app.get("/api/state")
def get_state():
    asegurar_archivos(False)
    usuarios = leer_usuarios()
    return jsonify(
        {
            "fecha": {"dia": FECHA_ACTUAL[0], "mes": FECHA_ACTUAL[1], "anio": FECHA_ACTUAL[2]},
            "fechaTuple": str(FECHA_ACTUAL),
            "fechaTexto": formato_fecha_texto(FECHA_ACTUAL),
            "hasRegisteredUsers": len(usuarios) > 0,
            "sucursales": [{"id": k, "nombre": v} for k, v in SUCURSALES.items()],
            "rzrDisponibles": RZR_DISPONIBLES,
            "tarifaPorHora": TARIFA_POR_HORA,
            "costoExtras": COSTO_EXTRAS,
        }
    )


@app.post("/api/auth/register")
def register():
    global FECHA_ACTUAL
    body = request.get_json(silent=True) or {}
    usuario = str(body.get("usuario", "")).strip()
    password = str(body.get("password", ""))
    fecha_texto = body.get("fechaTexto")

    if not re.match(r"^[a-zA-Z0-9_.-]{3,32}$", usuario):
        return jsonify({"error": "El usuario debe tener entre 3 y 32 caracteres válidos."}), 400
    if len(password) < 4 or len(password) > 72:
        return jsonify({"error": "La contraseña debe tener entre 4 y 72 caracteres."}), 400
    if fecha_texto:
        ok, parsed = parse_fecha(fecha_texto)
        if ok:
            FECHA_ACTUAL = parsed

    asegurar_archivos(False)
    usuarios = leer_usuarios()
    if usuario in usuarios:
        return jsonify({"error": "Ese nombre de usuario ya está registrado."}), 409

    with open(DATA_DIR / "usuarios.txt", "a", encoding="utf-8") as f:
        f.write(f"{usuario},{hash_password(password)}\n")

    return jsonify({"ok": True, "mensaje": "Usuario registrado con éxito.", "usuario": usuario}), 201


@app.post("/api/auth/login")
def login():
    global FECHA_ACTUAL
    body = request.get_json(silent=True) or {}
    usuario = str(body.get("usuario", "")).strip()
    password = str(body.get("password", ""))
    nickname = str(body.get("nickname") or usuario).strip() or usuario
    fecha_texto = body.get("fechaTexto")

    if not usuario or not password:
        return jsonify({"error": "Ingresa tu usuario y contraseña."}), 400

    if fecha_texto:
        ok, parsed = parse_fecha(fecha_texto)
        if not ok:
            return jsonify({"error": "La fecha debe ser numérica y con formato DD/MM/AAAA."}), 400
        FECHA_ACTUAL = parsed

    asegurar_archivos(False)
    usuarios = leer_usuarios()
    if not usuarios:
        return jsonify({"error": "Aún no hay usuarios registrados."}), 404

    stored = usuarios.get(usuario)
    if not stored or not verify_password(password, stored):
        return jsonify({"error": "Usuario o contraseña incorrectos."}), 401

    token = firmar_token(usuario, nickname)
    return jsonify(
        {
            "ok": True,
            "mensaje": f"Bienvenido, {nickname} a RZR-Track",
            "token": token,
            "usuario": usuario,
            "nickname": nickname,
            "fecha": {"dia": FECHA_ACTUAL[0], "mes": FECHA_ACTUAL[1], "anio": FECHA_ACTUAL[2]},
            "fechaTuple": str(FECHA_ACTUAL),
            "fechaTexto": formato_fecha_texto(FECHA_ACTUAL),
        }
    )


@app.post("/api/session/date")
@require_auth
def update_date():
    global FECHA_ACTUAL
    body = request.get_json(silent=True) or {}
    ok, parsed = parse_fecha(body.get("fechaTexto", ""))
    if not ok:
        return jsonify({"error": "Error: la fecha debe tener formato DD/MM/AAAA."}), 400
    FECHA_ACTUAL = parsed
    reset_files = bool(body.get("resetFiles", False))
    asegurar_archivos(reset_files)
    return jsonify(
        {
            "ok": True,
            "fecha": {"dia": FECHA_ACTUAL[0], "mes": FECHA_ACTUAL[1], "anio": FECHA_ACTUAL[2]},
            "fechaTuple": str(FECHA_ACTUAL),
            "fechaTexto": formato_fecha_texto(FECHA_ACTUAL),
            "mensaje": f"Fecha actualizada a {formato_fecha_texto(FECHA_ACTUAL)}.",
        }
    )


@app.get("/api/files")
@require_auth
def list_files():
    asegurar_archivos(False)
    files = []
    for path in sorted(DATA_DIR.glob("*.txt")):
        if path.name.lower() == "usuarios.txt":
            continue
        lines = [l for l in path.read_text(encoding="utf-8").splitlines() if l]
        files.append(
            {
                "nombre": path.name,
                "esBase": path.name in ARCHIVOS_PREVIOS,
                "tamanoBytes": path.stat().st_size,
                "lineas": len(lines),
            }
        )
    return jsonify({"files": files})


@app.get("/api/files/<nombre>")
@require_auth
def read_file(nombre: str):
    ruta = resolver_archivo_seguro(nombre)
    if ruta is None:
        return jsonify({"error": "Nombre de archivo no permitido."}), 400
    if not ruta.exists():
        return jsonify({"error": "Error: El archivo no existe o el nombre está mal escrito."}), 404
    return jsonify({"nombre": ruta.name, "contenido": ruta.read_text(encoding="utf-8")})


@app.post("/api/files/append")
@require_auth
def append_file():
    body = request.get_json(silent=True) or {}
    nombre = str(body.get("nombreArchivo", "")).strip()
    if not nombre.endswith(".txt"):
        nombre += ".txt"
    ruta = resolver_archivo_seguro(nombre)
    if ruta is None:
        return jsonify({"error": "Nombre de archivo no permitido."}), 400
    if not ruta.exists():
        return jsonify({"error": "El archivo no existe."}), 404

    texto = str(body.get("texto", "")).replace("\r", " ").replace("\n", " ").strip()
    if not texto or len(texto) > 500:
        return jsonify({"error": "Escribe un texto válido (máximo 500 caracteres)."}), 400

    with open(ruta, "a", encoding="utf-8") as f:
        f.write(f"{FECHA_ACTUAL} - {texto}\n")

    return jsonify(
        {
            "ok": True,
            "nombre": ruta.name,
            "mensaje": f"Guardado con fecha: {FECHA_ACTUAL}",
            "contenido": ruta.read_text(encoding="utf-8"),
        }
    )


@app.post("/api/files/create")
@require_auth
def create_file():
    body = request.get_json(silent=True) or {}
    raw = str(body.get("nombreNuevo", "")).strip()
    if not re.match(r"^[a-zA-Z0-9_-]{1,40}(\.txt)?$", raw):
        return jsonify({"error": "Nombre de archivo inválido."}), 400
    nombre = raw if raw.lower().endswith(".txt") else f"{raw}.txt"
    ruta = resolver_archivo_seguro(nombre)
    if ruta is None:
        return jsonify({"error": "Nombre de archivo no permitido."}), 400
    if ruta.exists():
        return jsonify({"error": "Ya existe un archivo con ese nombre."}), 409

    ruta.write_text(f"Archivo creado en fecha: {FECHA_ACTUAL}\n", encoding="utf-8")
    return (
        jsonify(
            {
                "ok": True,
                "nombre": ruta.name,
                "mensaje": "Archivo creado con éxito.",
                "contenido": ruta.read_text(encoding="utf-8"),
            }
        ),
        201,
    )


@app.post("/api/reservas")
@require_auth
def crear_reserva():
    body = request.get_json(silent=True) or {}
    try:
        id_local = int(body.get("idLocal", 0))
    except (TypeError, ValueError):
        id_local = 0
    sucursal = SUCURSALES.get(id_local)
    if not sucursal:
        return jsonify({"error": "Sucursal desconocida (elige 1 a 4)."}), 400

    nombre = str(body.get("nombre", "")).replace("-", " ").replace("\n", " ").strip()
    telefono = str(body.get("telefono", "")).replace("\n", " ").strip()
    if len(nombre) < 2 or len(nombre) > 80:
        return jsonify({"error": "Ingresa el nombre completo del cliente."}), 400
    if not re.match(r"^[0-9+\-\s()]{7,20}$", telefono):
        return jsonify({"error": "Ingresa un teléfono válido (7 a 20 dígitos)."}), 400

    rzr = str(body.get("rzr", "")).strip().upper()
    if rzr not in RZR_DISPONIBLES:
        return jsonify({"error": "Error: El RZR no está disponible."}), 400

    try:
        horas = float(body.get("horas", 0))
    except (TypeError, ValueError):
        horas = 0.0
    if horas <= 0 or horas > 72:
        return jsonify({"error": "Ingresa una duración válida entre 0.5 y 72 horas."}), 400

    subtotal = round(horas * TARIFA_POR_HORA, 2)
    total = round(subtotal + COSTO_EXTRAS, 2)

    asegurar_archivos(False)
    with open(DATA_DIR / "reservas.txt", "a", encoding="utf-8") as f:
        f.write(f"{FECHA_ACTUAL} - {nombre} - {sucursal} - {rzr} - Total: {total:.2f}\n")
    with open(DATA_DIR / "clientes.txt", "a", encoding="utf-8") as f:
        f.write(f"{nombre} - {telefono}\n")

    return (
        jsonify(
            {
                "ok": True,
                "mensaje": "Reserva guardada en reservas.txt y clientes.txt.",
                "ticket": {
                    "folio": f"RZR-{int(time.time()) % 1000000:06d}",
                    "fecha": str(FECHA_ACTUAL),
                    "fechaTexto": formato_fecha_texto(FECHA_ACTUAL),
                    "nombre": nombre,
                    "telefono": telefono,
                    "sucursal": sucursal,
                    "idLocal": id_local,
                    "rzr": rzr,
                    "horas": horas,
                    "tarifaPorHora": TARIFA_POR_HORA,
                    "costoExtras": COSTO_EXTRAS,
                    "subtotal": subtotal,
                    "total": total,
                    "operador": g.session.get("nickname", "Operador"),
                },
            }
        ),
        201,
    )


@app.get("/api/records")
@require_auth
def get_records():
    asegurar_archivos(False)
    reservas = []
    for linea in (DATA_DIR / "reservas.txt").read_text(encoding="utf-8").splitlines():
        m = re.match(
            r"^(\(\d+,\s*\d+,\s*\d+\))\s*-\s*(.+?)\s*-\s*(.+?)\s*-\s*(RZR-\d+)\s*-\s*Total:\s*([\d.]+)$",
            linea.strip(),
            re.IGNORECASE,
        )
        if m:
            reservas.append(
                {
                    "fecha": m.group(1),
                    "cliente": m.group(2),
                    "sucursal": m.group(3),
                    "rzr": m.group(4).upper(),
                    "total": float(m.group(5)),
                    "raw": linea,
                }
            )
    clientes = []
    for linea in (DATA_DIR / "clientes.txt").read_text(encoding="utf-8").splitlines():
        if linea.startswith("Clientes - Fecha:") or " - " not in linea:
            continue
        nombre, tel = linea.rsplit(" - ", 1)
        clientes.append({"nombre": nombre.strip(), "telefono": tel.strip()})

    return jsonify({"reservas": list(reversed(reservas)), "clientes": list(reversed(clientes))})


if __name__ == "__main__":
    asegurar_archivos(False)
    print("RZR-Track (Flask) corriendo en http://127.0.0.1:5000")
    app.run(host="127.0.0.1", port=5000, debug=True)
