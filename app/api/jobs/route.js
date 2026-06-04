import { NextResponse } from 'next/server';
import { readDb, requireUser, saveUpload, visibleJobs, writeDb } from '@/lib/store';

const ALLOWED_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/gif', 'image/webp']);

export async function GET(request) {
  const user = requireUser(request);
  if (!user) return NextResponse.json({ error: 'Login required' }, { status: 401 });

  const db = await readDb();
  return NextResponse.json({ jobs: visibleJobs(db, user).sort((a, b) => b.createdAt - a.createdAt) });
}

export async function POST(request) {
  const user = requireUser(request);
  if (!user) return NextResponse.json({ error: 'Login required' }, { status: 401 });

  const form = await request.formData();
  const file = form.get('document');

  if (!file || typeof file === 'string') {
    return NextResponse.json({ error: 'Upload a PDF or image file' }, { status: 400 });
  }

  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json({ error: 'Only PDF and image files are allowed' }, { status: 400 });
  }

  const upload = await saveUpload(file);
  const db = await readDb();
  const job = {
    id: Date.now(),
    userId: user.id,
    username: user.username,
    originalFilename: file.name,
    contentType: file.type,
    upload,
    printType: null,
    copies: null,
    unitPriceRupees: null,
    amountRupees: null,
    paymentStatus: 'pending',
    printStatus: 'not_ready',
    paymentReference: null,
    printerMessage: null,
    createdAt: Date.now(),
    paidAt: null,
    printedAt: null
  };

  db.jobs.push(job);
  await writeDb(db);
  return NextResponse.json({ job }, { status: 201 });
}
