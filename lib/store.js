import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import crypto from 'node:crypto';

const DATA_DIR = process.env.PRINTER_DATA_DIR || (process.env.VERCEL ? '/tmp/printer-online-sp-next' : path.join(process.cwd(), 'data-next'));
const DB_FILE = path.join(DATA_DIR, 'db.json');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const execFileAsync = promisify(execFile);

const DEFAULT_DB = {
  users: [
    { id: 1, username: 'admin', password: 'admin123', role: 'admin' },
    { id: 2, username: 'user', password: 'user123', role: 'user' }
  ],
  settings: {
    monoPrice: 2,
    colorPrice: 10,
    paymentAccount: 'printershop@upi',
    shopName: 'Printer Online SP',
    printerEndpoint: '',
    printerCommand: ''
  },
  jobs: [],
  transactions: []
};

async function ensureDb() {
  await mkdir(UPLOAD_DIR, { recursive: true });
  if (!existsSync(DB_FILE)) {
    await writeFile(DB_FILE, JSON.stringify(DEFAULT_DB, null, 2));
  }
}

export async function readDb() {
  await ensureDb();
  const text = await readFile(DB_FILE, 'utf8');
  return JSON.parse(text);
}

export async function writeDb(db) {
  await mkdir(UPLOAD_DIR, { recursive: true });
  await writeFile(DB_FILE, JSON.stringify(db, null, 2));
}

export function publicUser(user) {
  if (!user) return null;
  return { id: user.id, username: user.username, role: user.role };
}

export async function authenticate(username, password) {
  const db = await readDb();
  const user = db.users.find((item) => item.username === username && item.password === password);
  return publicUser(user);
}

export function requireUser(request) {
  const raw = request.headers.get('x-user');
  if (!raw) return null;
  try {
    const user = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (user?.id && user?.role) return user;
  } catch {
    return null;
  }
  return null;
}

export function encodeUser(user) {
  return Buffer.from(JSON.stringify(user)).toString('base64url');
}

export function rupees(value) {
  return `₹${Number(value || 0).toFixed(2)}`;
}

export function paymentPayload(settings, job) {
  const params = new URLSearchParams({
    pa: settings.paymentAccount,
    pn: settings.shopName,
    am: Number(job.amountRupees || 0).toFixed(2),
    cu: 'INR',
    tn: `PRINT-${job.id}`
  });
  return `upi://pay?${params.toString()}`;
}

export async function makePaymentQr(payload) {
  try {
    const QRCode = (await import('qrcode')).default;
    return await QRCode.toDataURL(payload, { margin: 1, width: 280 });
  } catch {
    const digest = crypto.createHash('sha256').update(payload).digest();
    const size = 21;
    const cells = [];
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const finder = (x < 7 && y < 7) || (x > 13 && y < 7) || (x < 7 && y > 13);
        const bit = (digest[(x + y * size) % digest.length] >> ((x + y) % 8)) & 1;
        if (finder || bit) cells.push(`<rect x="${x}" y="${y}" width="1" height="1"/>`);
      }
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}"><rect width="100%" height="100%" fill="white"/><g fill="black">${cells.join('')}</g></svg>`;
    return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  }
}

export async function saveUpload(file) {
  const bytes = Buffer.from(await file.arrayBuffer());
  const safeName = file.name.replace(/[^a-z0-9._-]/gi, '_');
  const key = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}-${safeName}`;

  const localPath = path.join(UPLOAD_DIR, key);
  await mkdir(UPLOAD_DIR, { recursive: true });
  await writeFile(localPath, bytes);
  return { storage: 'tmp', url: localPath, key, size: bytes.length };
}

function buildPrintArgs(job, commandTemplate) {
  const file = job.upload?.url || '';
  const replacements = {
    '{file}': file,
    '{copies}': String(job.copies || 1),
    '{type}': job.printType || 'mono'
  };
  const parts = String(commandTemplate || '').match(/(?:[^\s"]+|"[^"]*")+/g) || [];
  return parts.map((part) => {
    const unquoted = part.replace(/^"|"$/g, '');
    return Object.entries(replacements).reduce((value, [token, replacement]) => value.replaceAll(token, replacement), unquoted);
  });
}

async function dispatchWithCommand(job, commandTemplate) {
  const [command, ...args] = buildPrintArgs(job, commandTemplate);
  if (!command) return null;

  try {
    await execFileAsync(command, args, { timeout: 30000, maxBuffer: 1024 * 1024 });
    return { printStatus: 'sent', printerMessage: `Sent to printer with admin command: ${command}.` };
  } catch (error) {
    return { printStatus: 'failed', printerMessage: `Printer command failed: ${error.message}` };
  }
}

async function dispatchWithDefaultPrinter(job) {
  const file = job.upload?.url;
  if (!file) return null;

  const copies = String(job.copies || 1);
  const candidates = [
    ['lp', ['-n', copies, file]],
    ['lpr', ['-#', copies, file]]
  ];

  for (const [command, args] of candidates) {
    try {
      await execFileAsync(command, args, { timeout: 30000, maxBuffer: 1024 * 1024 });
      return { printStatus: 'sent', printerMessage: `Sent to the system default printer with ${command}.` };
    } catch (error) {
      if (error.code !== 'ENOENT') {
        return { printStatus: 'failed', printerMessage: `Default printer command failed: ${error.message}` };
      }
    }
  }

  return null;
}

export async function dispatchPrint(job, settings) {
  if (job.paymentStatus !== 'success') {
    return { printStatus: 'blocked', printerMessage: 'Payment was not successful; print request blocked.' };
  }

  const localCommandResult = await dispatchWithCommand(job, settings.printerCommand);
  if (localCommandResult) return localCommandResult;

  if (settings.printerEndpoint) {
    const response = await fetch(settings.printerEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ job })
    });

    if (!response.ok) {
      return { printStatus: 'failed', printerMessage: `Printer endpoint returned HTTP ${response.status}.` };
    }

    return { printStatus: 'sent', printerMessage: 'Sent to configured printer endpoint.' };
  }

  const defaultPrinterResult = await dispatchWithDefaultPrinter(job);
  if (defaultPrinterResult) return defaultPrinterResult;

  return {
    printStatus: 'queued',
    printerMessage: 'Payment succeeded. Configure an admin printer command, printer endpoint, or operating system default printer to release this job automatically.'
  };
}

export function visibleJobs(db, user) {
  if (user.role === 'admin') return db.jobs;
  return db.jobs.filter((job) => job.userId === user.id);
}
