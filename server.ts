import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import dotenv from 'dotenv';
import express from 'express';
import type {NextFunction, Request, Response} from 'express';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT) || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';
const DATA_DIR = path.resolve(__dirname, 'data');
const SESSION_SECRET =
  process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

const SUCURSALES: Record<number, string> = {
  1: 'Mazamitla',
  2: 'Tapalpa',
  3: 'Mazatlán',
  4: 'Chacala',
};

const RZR_DISPONIBLES = ['RZR-01', 'RZR-02', 'RZR-05'] as const;
const TARIFA_POR_HORA = 500.0;
const COSTO_EXTRAS = 300.0;
const SYSTEM_FILES = [
  'reservas.txt',
  'clientes.txt',
  'sucursales.txt',
  'rzr_disponibles.txt',
];

interface FechaTuple {
  dia: number;
  mes: number;
  anio: number;
}

interface SessionPayload {
  usuario: string;
  nickname: string;
  exp: number;
}

interface AuthedRequest extends Request {
  session?: SessionPayload;
}

function getTodayFecha(): FechaTuple {
  const now = new Date();
  return {
    dia: now.getDate(),
    mes: now.getMonth() + 1,
    anio: now.getFullYear(),
  };
}

function formatFechaTuple(f: FechaTuple): string {
  return `(${f.dia}, ${f.mes}, ${f.anio})`;
}

function formatFechaInput(f: FechaTuple): string {
  const d = String(f.dia).padStart(2, '0');
  const m = String(f.mes).padStart(2, '0');
  return `${d}/${m}/${f.anio}`;
}

function parseFechaTexto(
  texto?: string,
): {fecha: FechaTuple; valid: boolean} {
  if (!texto || typeof texto !== 'string') {
    return {fecha: {dia: 1, mes: 1, anio: 2023}, valid: false};
  }
  const parts = texto.trim().split('/');
  if (parts.length !== 3) {
    return {fecha: {dia: 1, mes: 1, anio: 2023}, valid: false};
  }
  const dia = Number.parseInt(parts[0], 10);
  const mes = Number.parseInt(parts[1], 10);
  const anio = Number.parseInt(parts[2], 10);
  if (
    !Number.isInteger(dia) ||
    !Number.isInteger(mes) ||
    !Number.isInteger(anio) ||
    !/^\d{1,2}$/.test(parts[0].trim()) ||
    !/^\d{1,2}$/.test(parts[1].trim()) ||
    !/^\d{4}$/.test(parts[2].trim()) ||
    dia < 1 ||
    dia > 31 ||
    mes < 1 ||
    mes > 12 ||
    anio < 2000 ||
    anio > 2100
  ) {
    return {fecha: {dia: 1, mes: 1, anio: 2023}, valid: false};
  }
  return {fecha: {dia, mes, anio}, valid: true};
}

let currentFecha: FechaTuple = getTodayFecha();

function ensureDataDirectory(resetDailyFiles = false): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, {recursive: true});
  }
  const usuariosPath = path.join(DATA_DIR, 'usuarios.txt');
  if (!fs.existsSync(usuariosPath)) {
    fs.writeFileSync(usuariosPath, '', 'utf8');
  }

  const fechaStr = formatFechaTuple(currentFecha);
  const defaults: Record<string, string> = {
    'reservas.txt': `Reservas - Fecha: ${fechaStr}\n`,
    'clientes.txt': `Clientes - Fecha: ${fechaStr}\n`,
    'sucursales.txt': `Sucursales: Mazamitla, Tapalpa, Mazatlan, Chacala - Fecha: ${fechaStr}\n`,
    'rzr_disponibles.txt': `RZR disponibles: RZR-01, RZR-02, RZR-05 - Fecha: ${fechaStr}\n`,
  };

  for (const [filename, header] of Object.entries(defaults)) {
    const filePath = path.join(DATA_DIR, filename);
    if (resetDailyFiles || !fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, header, 'utf8');
    }
  }
}

function resolveSafeDataFile(rawName: string): string | null {
  if (typeof rawName !== 'string') return null;
  const trimmed = rawName.trim();
  if (!trimmed || trimmed.length > 64) return null;
  if (!/^[a-zA-Z0-9_.-]+\.txt$/.test(trimmed)) return null;
  if (trimmed.toLowerCase() === 'usuarios.txt') return null;
  const resolved = path.resolve(DATA_DIR, trimmed);
  if (!resolved.startsWith(DATA_DIR + path.sep)) return null;
  return resolved;
}

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, storedSecret: string): boolean {
  const parts = storedSecret.split(':');
  if (parts.length !== 2) return false;
  const [salt, expectedHex] = parts;
  if (!salt || !expectedHex) return false;
  const derived = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, 'hex');
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

function signToken(payload: SessionPayload): string {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString(
    'base64url',
  );
  const sig = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(encoded)
    .digest('base64url');
  return `${encoded}.${sig}`;
}

function verifyToken(token: string): SessionPayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, providedSig] = parts;
  const expectedSig = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(encoded)
    .digest('base64url');
  const providedBuf = Buffer.from(providedSig, 'utf8');
  const expectedBuf = Buffer.from(expectedSig, 'utf8');
  if (providedBuf.length !== expectedBuf.length) return null;
  if (!crypto.timingSafeEqual(providedBuf, expectedBuf)) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(encoded, 'base64url').toString('utf8'),
    ) as SessionPayload;
    if (!parsed.usuario || typeof parsed.exp !== 'number') return null;
    if (Date.now() > parsed.exp) return null;
    return parsed;
  } catch {
    return null;
  }
}

function requireAuth(
  req: AuthedRequest,
  res: Response,
  next: NextFunction,
): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({error: 'Sesión requerida. Inicia sesión para continuar.'});
    return;
  }
  const token = authHeader.slice(7).trim();
  const session = verifyToken(token);
  if (!session) {
    res.status(401).json({error: 'Sesión expirada o inválida. Vuelve a iniciar sesión.'});
    return;
  }
  req.session = session;
  next();
}

function readUsersMap(): Map<string, string> {
  const usuariosPath = path.join(DATA_DIR, 'usuarios.txt');
  const users = new Map<string, string>();
  if (!fs.existsSync(usuariosPath)) return users;
  const content = fs.readFileSync(usuariosPath, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const commaIdx = line.indexOf(',');
    if (commaIdx <= 0) continue;
    const user = line.slice(0, commaIdx);
    const secret = line.slice(commaIdx + 1);
    users.set(user, secret);
  }
  return users;
}

function parseReservasAndClients() {
  const reservasPath = path.join(DATA_DIR, 'reservas.txt');
  const clientesPath = path.join(DATA_DIR, 'clientes.txt');

  const reservas: Array<{
    fecha: string;
    cliente: string;
    sucursal: string;
    rzr: string;
    total: number;
    raw: string;
  }> = [];

  if (fs.existsSync(reservasPath)) {
    const lines = fs.readFileSync(reservasPath, 'utf8').split(/\r?\n/);
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith('Reservas - Fecha:')) continue;
      const match = line.match(
        /^(\(\d+,\s*\d+,\s*\d+\))\s*-\s*(.+?)\s*-\s*(.+?)\s*-\s*(RZR-\d+)\s*-\s*Total:\s*([\d.]+)$/i,
      );
      if (match) {
        reservas.push({
          fecha: match[1],
          cliente: match[2],
          sucursal: match[3],
          rzr: match[4].toUpperCase(),
          total: Number.parseFloat(match[5]),
          raw: line,
        });
      }
    }
  }

  const clientes: Array<{nombre: string; telefono: string}> = [];
  if (fs.existsSync(clientesPath)) {
    const lines = fs.readFileSync(clientesPath, 'utf8').split(/\r?\n/);
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith('Clientes - Fecha:')) continue;
      const sepIdx = line.lastIndexOf(' - ');
      if (sepIdx > 0) {
        clientes.push({
          nombre: line.slice(0, sepIdx).trim(),
          telefono: line.slice(sepIdx + 3).trim(),
        });
      }
    }
  }

  return {reservas: reservas.reverse(), clientes: clientes.reverse()};
}

async function startServer(): Promise<void> {
  ensureDataDirectory(false);

  const app = express();
  app.use(express.json({limit: '256kb'}));

  app.get('/api/state', (_req: Request, res: Response) => {
    const users = readUsersMap();
    res.json({
      fecha: currentFecha,
      fechaTuple: formatFechaTuple(currentFecha),
      fechaTexto: formatFechaInput(currentFecha),
      hasRegisteredUsers: users.size > 0,
      sucursales: Object.entries(SUCURSALES).map(([id, nombre]) => ({
        id: Number(id),
        nombre,
      })),
      rzrDisponibles: [...RZR_DISPONIBLES],
      tarifaPorHora: TARIFA_POR_HORA,
      costoExtras: COSTO_EXTRAS,
    });
  });

  app.post('/api/auth/register', (req: Request, res: Response) => {
    const {usuario, password, fechaTexto} = req.body as {
      usuario?: string;
      password?: string;
      fechaTexto?: string;
    };

    const cleanUser = typeof usuario === 'string' ? usuario.trim() : '';
    const cleanPass = typeof password === 'string' ? password : '';

    if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(cleanUser)) {
      res.status(400).json({
        error:
          'El usuario debe tener entre 3 y 32 caracteres (solo letras, números, punto, guion o guion bajo).',
      });
      return;
    }
    if (cleanPass.length < 4 || cleanPass.length > 72) {
      res.status(400).json({
        error: 'La contraseña debe tener entre 4 y 72 caracteres.',
      });
      return;
    }

    if (fechaTexto) {
      const parsed = parseFechaTexto(fechaTexto);
      if (parsed.valid) {
        currentFecha = parsed.fecha;
      }
    }

    ensureDataDirectory(false);
    const users = readUsersMap();
    if (users.has(cleanUser)) {
      res.status(409).json({error: 'Ese nombre de usuario ya está registrado.'});
      return;
    }

    const usuariosPath = path.join(DATA_DIR, 'usuarios.txt');
    const encodedSecret = hashPassword(cleanPass);
    fs.appendFileSync(usuariosPath, `${cleanUser},${encodedSecret}\n`, 'utf8');

    res.status(201).json({
      ok: true,
      mensaje: 'Usuario registrado con éxito.',
      usuario: cleanUser,
    });
  });

  app.post('/api/auth/login', (req: Request, res: Response) => {
    const {usuario, password, nickname, fechaTexto} = req.body as {
      usuario?: string;
      password?: string;
      nickname?: string;
      fechaTexto?: string;
    };

    const cleanUser = typeof usuario === 'string' ? usuario.trim() : '';
    const cleanPass = typeof password === 'string' ? password : '';
    const cleanNick =
      typeof nickname === 'string' && nickname.trim()
        ? nickname.trim().slice(0, 40)
        : cleanUser;

    if (!cleanUser || !cleanPass) {
      res.status(400).json({error: 'Ingresa tu usuario y contraseña.'});
      return;
    }

    if (fechaTexto) {
      const parsed = parseFechaTexto(fechaTexto);
      if (!parsed.valid) {
        res.status(400).json({
          error: 'La fecha debe ser numérica y con formato DD/MM/AAAA.',
        });
        return;
      }
      currentFecha = parsed.fecha;
    }

    ensureDataDirectory(false);
    const users = readUsersMap();
    if (users.size === 0) {
      res.status(404).json({error: 'Aún no hay usuarios registrados.'});
      return;
    }

    const stored = users.get(cleanUser);
    if (!stored || !verifyPassword(cleanPass, stored)) {
      res.status(401).json({error: 'Usuario o contraseña incorrectos.'});
      return;
    }

    const token = signToken({
      usuario: cleanUser,
      nickname: cleanNick,
      exp: Date.now() + 1000 * 60 * 60 * 8,
    });

    res.json({
      ok: true,
      mensaje: `Bienvenido, ${cleanNick} a RZR-Track`,
      token,
      usuario: cleanUser,
      nickname: cleanNick,
      fecha: currentFecha,
      fechaTuple: formatFechaTuple(currentFecha),
      fechaTexto: formatFechaInput(currentFecha),
    });
  });

  app.post(
    '/api/session/date',
    requireAuth,
    (req: AuthedRequest, res: Response) => {
      const {fechaTexto, resetFiles} = req.body as {
        fechaTexto?: string;
        resetFiles?: boolean;
      };
      const parsed = parseFechaTexto(fechaTexto);
      if (!parsed.valid) {
        res.status(400).json({
          error: 'Error: la fecha debe ser numérica y con formato DD/MM/AAAA.',
        });
        return;
      }
      currentFecha = parsed.fecha;
      ensureDataDirectory(Boolean(resetFiles));

      res.json({
        ok: true,
        fecha: currentFecha,
        fechaTuple: formatFechaTuple(currentFecha),
        fechaTexto: formatFechaInput(currentFecha),
        mensaje: resetFiles
          ? `Fecha actualizada a ${formatFechaInput(currentFecha)} y archivos del día reiniciados.`
          : `Fecha de operación actualizada a ${formatFechaInput(currentFecha)}.`,
      });
    },
  );

  app.get('/api/files', requireAuth, (_req: AuthedRequest, res: Response) => {
    ensureDataDirectory(false);
    const entries = fs
      .readdirSync(DATA_DIR)
      .filter(
        (name) =>
          name.endsWith('.txt') && name.toLowerCase() !== 'usuarios.txt',
      )
      .sort((a, b) => {
        const aSys = SYSTEM_FILES.indexOf(a);
        const bSys = SYSTEM_FILES.indexOf(b);
        if (aSys !== -1 && bSys !== -1) return aSys - bSys;
        if (aSys !== -1) return -1;
        if (bSys !== -1) return 1;
        return a.localeCompare(b);
      })
      .map((nombre) => {
        const fullPath = path.join(DATA_DIR, nombre);
        const stat = fs.statSync(fullPath);
        const lines = fs
          .readFileSync(fullPath, 'utf8')
          .split(/\r?\n/)
          .filter((l) => l.length > 0).length;
        return {
          nombre,
          esBase: SYSTEM_FILES.includes(nombre),
          tamanoBytes: stat.size,
          lineas: lines,
        };
      });

    res.json({files: entries});
  });

  app.get(
    '/api/files/:name',
    requireAuth,
    (req: AuthedRequest, res: Response) => {
      const rawName = String(req.params.name ?? '');
      const safePath = resolveSafeDataFile(rawName);
      if (!safePath) {
        res.status(400).json({
          error:
            'Nombre de archivo inválido. Debe terminar en .txt y no estar restringido.',
        });
        return;
      }
      if (!fs.existsSync(safePath)) {
        res.status(404).json({
          error: 'Error: El archivo no existe o el nombre está mal escrito.',
        });
        return;
      }
      const contenido = fs.readFileSync(safePath, 'utf8');
      res.json({
        nombre: path.basename(safePath),
        contenido,
      });
    },
  );

  app.post(
    '/api/files/append',
    requireAuth,
    (req: AuthedRequest, res: Response) => {
      const {nombreArchivo, texto} = req.body as {
        nombreArchivo?: string;
        texto?: string;
      };
      const cleanName =
        typeof nombreArchivo === 'string' ? nombreArchivo.trim() : '';
      const normalized = cleanName.endsWith('.txt')
        ? cleanName
        : `${cleanName}.txt`;
      const safePath = resolveSafeDataFile(normalized);
      if (!safePath) {
        res.status(400).json({error: 'Nombre de archivo no permitido.'});
        return;
      }
      if (!fs.existsSync(safePath)) {
        res.status(404).json({
          error: 'El archivo no existe. Créalo primero antes de escribir.',
        });
        return;
      }
      const cleanText =
        typeof texto === 'string' ? texto.replace(/[\r\n]+/g, ' ').trim() : '';
      if (!cleanText || cleanText.length > 500) {
        res.status(400).json({
          error: 'Escribe un texto válido (máximo 500 caracteres).',
        });
        return;
      }

      const fechaStr = formatFechaTuple(currentFecha);
      fs.appendFileSync(safePath, `${fechaStr} - ${cleanText}\n`, 'utf8');

      res.json({
        ok: true,
        nombre: path.basename(safePath),
        mensaje: `Guardado con fecha: ${fechaStr}`,
        contenido: fs.readFileSync(safePath, 'utf8'),
      });
    },
  );

  app.post(
    '/api/files/create',
    requireAuth,
    (req: AuthedRequest, res: Response) => {
      const {nombreNuevo} = req.body as {nombreNuevo?: string};
      const raw = typeof nombreNuevo === 'string' ? nombreNuevo.trim() : '';
      if (!raw || !/^[a-zA-Z0-9_-]{1,40}(\.txt)?$/.test(raw)) {
        res.status(400).json({
          error:
            'Usa entre 1 y 40 caracteres válidos (letras, números, guion o guion bajo).',
        });
        return;
      }
      const normalized = raw.toLowerCase().endsWith('.txt') ? raw : `${raw}.txt`;
      const safePath = resolveSafeDataFile(normalized);
      if (!safePath) {
        res.status(400).json({error: 'Nombre de archivo no permitido.'});
        return;
      }
      if (fs.existsSync(safePath)) {
        res.status(409).json({error: 'Ya existe un archivo con ese nombre.'});
        return;
      }

      const fechaStr = formatFechaTuple(currentFecha);
      fs.writeFileSync(
        safePath,
        `Archivo creado en fecha: ${fechaStr}\n`,
        'utf8',
      );

      res.status(201).json({
        ok: true,
        nombre: path.basename(safePath),
        mensaje: 'Archivo creado con éxito.',
        contenido: fs.readFileSync(safePath, 'utf8'),
      });
    },
  );

  app.post(
    '/api/reservas',
    requireAuth,
    (req: AuthedRequest, res: Response) => {
      const {idLocal, nombre, telefono, rzr, horas} = req.body as {
        idLocal?: number | string;
        nombre?: string;
        telefono?: string;
        rzr?: string;
        horas?: number | string;
      };

      const parsedLocal = Number(idLocal);
      const sucursal = SUCURSALES[parsedLocal];
      if (!sucursal) {
        res.status(400).json({
          error:
            'Selecciona una sucursal válida (1: Mazamitla, 2: Tapalpa, 3: Mazatlán, 4: Chacala).',
        });
        return;
      }

      const cleanNombre =
        typeof nombre === 'string' ? nombre.replace(/[\r\n-]+/g, ' ').trim() : '';
      const cleanTel =
        typeof telefono === 'string'
          ? telefono.replace(/[\r\n]+/g, ' ').trim()
          : '';
      if (cleanNombre.length < 2 || cleanNombre.length > 80) {
        res.status(400).json({error: 'Ingresa el nombre completo del cliente.'});
        return;
      }
      if (!/^[0-9+\-\s()]{7,20}$/.test(cleanTel)) {
        res.status(400).json({
          error: 'Ingresa un número de teléfono válido (7 a 20 dígitos).',
        });
        return;
      }

      const cleanRzr = typeof rzr === 'string' ? rzr.trim().toUpperCase() : '';
      if (
        !RZR_DISPONIBLES.includes(
          cleanRzr as (typeof RZR_DISPONIBLES)[number],
        )
      ) {
        res.status(400).json({
          error: 'Error: El RZR seleccionado no está disponible.',
        });
        return;
      }

      const parsedHoras = Number(horas);
      if (!Number.isFinite(parsedHoras) || parsedHoras <= 0 || parsedHoras > 72) {
        res.status(400).json({
          error: 'Ingresa una duración válida entre 0.5 y 72 horas.',
        });
        return;
      }

      const subtotal = Number((parsedHoras * TARIFA_POR_HORA).toFixed(2));
      const total = Number((subtotal + COSTO_EXTRAS).toFixed(2));
      const fechaStr = formatFechaTuple(currentFecha);

      ensureDataDirectory(false);
      const reservasPath = path.join(DATA_DIR, 'reservas.txt');
      const clientesPath = path.join(DATA_DIR, 'clientes.txt');

      fs.appendFileSync(
        reservasPath,
        `${fechaStr} - ${cleanNombre} - ${sucursal} - ${cleanRzr} - Total: ${total.toFixed(2)}\n`,
        'utf8',
      );
      fs.appendFileSync(
        clientesPath,
        `${cleanNombre} - ${cleanTel}\n`,
        'utf8',
      );

      res.status(201).json({
        ok: true,
        mensaje: 'Reserva guardada en reservas.txt y clientes.txt.',
        ticket: {
          folio: `RZR-${Date.now().toString().slice(-6)}`,
          fecha: fechaStr,
          fechaTexto: formatFechaInput(currentFecha),
          nombre: cleanNombre,
          telefono: cleanTel,
          sucursal,
          idLocal: parsedLocal,
          rzr: cleanRzr,
          horas: parsedHoras,
          tarifaPorHora: TARIFA_POR_HORA,
          costoExtras: COSTO_EXTRAS,
          subtotal,
          total,
          operador: req.session?.nickname || req.session?.usuario || 'Operador',
        },
      });
    },
  );

  app.get('/api/records', requireAuth, (_req: AuthedRequest, res: Response) => {
    ensureDataDirectory(false);
    const data = parseReservasAndClients();
    res.json(data);
  });

  if (!IS_PROD) {
    const {createServer: createViteServer} = await import('vite');
    const vite = await createViteServer({
      server: {middlewareMode: true},
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`RZR-Track servidor listo en http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Error al iniciar RZR-Track:', err);
  process.exit(1);
});
