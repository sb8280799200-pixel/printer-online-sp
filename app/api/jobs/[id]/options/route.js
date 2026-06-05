import { NextResponse } from 'next/server';
import { audit, readDb, requireUser, sanitizeJob, writeDb } from '@/lib/store';

function selectedPages(job, mode, customPages) {
  if (mode !== 'custom') return job.pageCount || 1;
  const pages = new Set();
  for (const part of String(customPages || '').split(',')) {
    const [startRaw, endRaw] = part.split('-');
    const start = Math.max(1, Number.parseInt(startRaw, 10) || 0);
    const end = Math.min(job.pageCount || 1, Number.parseInt(endRaw || startRaw, 10) || start);
    for (let page = start; page <= end; page += 1) pages.add(page);
  }
  return Math.max(1, pages.size);
}

export async function POST(request, { params }) {
  const user = requireUser(request);
  if (!user) return NextResponse.json({ error: 'Login required' }, { status: 401 });
  const { printType, copies, orientation, paperSize, pageRangeMode, customPages } = await request.json();
  const db = await readDb();
  const { id } = await params;
  const job = db.jobs.find((item) => String(item.id) === String(id));
  if (!job || (user.role !== 'admin' && job.userId !== user.id)) return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  if (job.paymentStatus === 'success') return NextResponse.json({ error: 'Paid orders cannot be changed. Create a new order.' }, { status: 409 });

  const normalizedType = printType === 'color' ? 'color' : 'mono';
  const normalizedCopies = Math.max(1, Math.min(500, Number.parseInt(copies, 10) || 1));
  const normalizedOrientation = orientation === 'landscape' ? 'landscape' : 'portrait';
  const normalizedPaper = paperSize === 'A3' ? 'A3' : 'A4';
  const normalizedRangeMode = pageRangeMode === 'custom' ? 'custom' : 'all';
  const pages = selectedPages(job, normalizedRangeMode, customPages);
  const unitPrice = normalizedType === 'color' ? Number(db.settings.colorPrice) : Number(db.settings.monoPrice);
  Object.assign(job, { printType: normalizedType, copies: normalizedCopies, orientation: normalizedOrientation, paperSize: normalizedPaper, pageRangeMode: normalizedRangeMode, customPages: normalizedRangeMode === 'custom' ? String(customPages || '') : '', billablePages: pages, unitPriceRupees: unitPrice, amountRupees: Number((unitPrice * pages * normalizedCopies).toFixed(2)), paymentStatus: 'pending', printStatus: 'not_ready' });
  db.auditLogs.push(audit('print_options_saved', user.id, { jobId: job.id, amountRupees: job.amountRupees }));
  await writeDb(db);
  return NextResponse.json({ job: sanitizeJob(job, user), settings: db.settings });
}
