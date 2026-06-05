import { NextResponse } from 'next/server';
import { audit, readDb, requireUser, runVirusScan, saveUpload, visibleJobs, writeDb } from '@/lib/store';

const ALLOWED_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png']);

export async function GET(request) {
  const user = requireUser(request);
  if (!user) return NextResponse.json({ error: 'Login required' }, { status: 401 });
  const db = await readDb();
  return NextResponse.json({ jobs: visibleJobs(db, user).sort((a, b) => b.createdAt - a.createdAt), settings: { maxFileSizeMb: db.settings.maxFileSizeMb } });
}

export async function POST(request) {
  const user = requireUser(request);
  if (!user) return NextResponse.json({ error: 'Login required' }, { status: 401 });
  const form = await request.formData();
  const file = form.get('document');
  if (!file || typeof file === 'string') return NextResponse.json({ error: 'Upload a PDF, JPG, JPEG, or PNG file' }, { status: 400 });
  if (!ALLOWED_TYPES.has(file.type)) return NextResponse.json({ error: 'Only PDF, JPG, JPEG, and PNG files are allowed' }, { status: 400 });

  const db = await readDb();
  let upload;
  try { upload = await saveUpload(file, db.settings); }
  catch (error) { return NextResponse.json({ error: error.message }, { status: 400 }); }
  const scan = await runVirusScan(upload, db.settings);
  if (!scan.ok) return NextResponse.json({ error: scan.message }, { status: 400 });

  const job = {
    id: Date.now(), userId: user.id, username: user.username,
    originalFilename: file.name, contentType: file.type, upload,
    fileSize: upload.size, pageCount: upload.pageCount,
    printType: null, copies: 1, orientation: 'portrait', paperSize: 'A4', pageRangeMode: 'all', customPages: '',
    unitPriceRupees: null, amountRupees: null,
    paymentStatus: 'pending', printStatus: 'not_ready', paymentReference: null, printerMessage: scan.message,
    createdAt: Date.now(), paidAt: null, printedAt: null, deletedAt: null
  };
  db.jobs.push(job);
  db.auditLogs.push(audit('upload_created', user.id, { jobId: job.id, filename: file.name, size: upload.size, pageCount: upload.pageCount }));
  await writeDb(db);
  return NextResponse.json({ job: visibleJobs({ jobs: [job] }, user)[0] }, { status: 201 });
}
