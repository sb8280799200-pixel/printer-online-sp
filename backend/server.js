// Express backend entry point for production deployments that prefer a separate API process.
// The Next.js app in /app uses the same domain logic from lib/store.js for Vercel/self-contained demos.
import express from 'express';
import multer from 'multer';
import helmet from 'helmet';
import { authenticate, encodeUser, readDb, requireUser, saveUpload, runVirusScan, visibleJobs, writeDb } from '../lib/store.js';

const app = express();
const upload = multer({ storage: multer.memoryStorage() });
app.use(helmet());
app.use(express.json());

function asRequest(req) { return { headers: { get: (name) => req.get(name) } }; }
function auth(req, res, next) { const user = requireUser(asRequest(req)); if (!user) return res.status(401).json({ error: 'Login required' }); req.user = user; next(); }
function admin(req, res, next) { if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin login required' }); next(); }

app.post('/api/auth/login', async (req, res) => {
  const user = await authenticate(req.body.username, req.body.password);
  if (!user) return res.status(401).json({ error: 'Invalid username or password' });
  res.json({ user, token: encodeUser(user) });
});

app.get('/api/jobs', auth, async (req, res) => {
  const db = await readDb();
  res.json({ jobs: visibleJobs(db, req.user) });
});

app.post('/api/jobs', auth, upload.single('document'), async (req, res) => {
  const db = await readDb();
  const file = new File([req.file.buffer], req.file.originalname, { type: req.file.mimetype });
  const stored = await saveUpload(file, db.settings);
  const scan = await runVirusScan(stored, db.settings);
  if (!scan.ok) return res.status(400).json({ error: scan.message });
  const job = { id: Date.now(), userId: req.user.id, username: req.user.username, originalFilename: req.file.originalname, contentType: req.file.mimetype, upload: stored, fileSize: stored.size, pageCount: stored.pageCount, copies: 1, orientation: 'portrait', paperSize: 'A4', pageRangeMode: 'all', paymentStatus: 'pending', printStatus: 'not_ready', createdAt: Date.now() };
  db.jobs.push(job); await writeDb(db); res.status(201).json({ job });
});

app.get('/api/admin/settings', auth, admin, async (_req, res) => {
  const db = await readDb();
  res.json({ settings: db.settings, jobs: visibleJobs(db, { role: 'admin' }), transactions: db.transactions, auditLogs: db.auditLogs });
});

app.listen(process.env.PORT || 4000, () => console.log(`Express API listening on ${process.env.PORT || 4000}`));
