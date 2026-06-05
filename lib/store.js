import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const DATA_DIR = process.env.PRINTER_DATA_DIR || (process.env.VERCEL ? '/tmp/printer-online-sp-next' : path.join(process.cwd(), 'data-next'));
const DB_FILE = path.join(DATA_DIR, 'db.json');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');

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
    printerEndpoint: ''
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

export async function dispatchPrint(job, settings) {
  if (!settings.printerEndpoint) {
    return {
      printStatus: 'queued',
      printerMessage: 'Payment succeeded. Configure an admin printer endpoint or local print agent to release this job automatically.'
    };
  }

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

export function visibleJobs(db, user) {
  if (user.role === 'admin') return db.jobs;
  return db.jobs.filter((job) => job.userId === user.id);
}
