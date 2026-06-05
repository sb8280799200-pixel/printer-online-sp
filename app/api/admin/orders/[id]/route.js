import { NextResponse } from 'next/server';
import { audit, dispatchPrint, readDb, requireUser, writeDb } from '@/lib/store';

export async function POST(request, { params }) {
  const user = requireUser(request);
  if (!user || user.role !== 'admin') return NextResponse.json({ error: 'Admin login required' }, { status: 403 });
  const { action } = await request.json();
  const db = await readDb();
  const { id } = await params;
  const job = db.jobs.find((item) => String(item.id) === String(id));
  if (!job) return NextResponse.json({ error: 'Order not found' }, { status: 404 });
  if (action === 'cancel') {
    job.printStatus = 'blocked'; job.paymentStatus = job.paymentStatus === 'success' ? 'success' : 'failed'; job.printerMessage = 'Order cancelled by admin.';
  } else if (action === 'reprint') {
    if (job.paymentStatus !== 'success') return NextResponse.json({ error: 'Only paid jobs can be reprinted.' }, { status: 400 });
    const result = await dispatchPrint(job, db.settings); job.printStatus = result.printStatus; job.printerMessage = result.printerMessage;
  } else return NextResponse.json({ error: 'Unsupported action.' }, { status: 400 });
  db.auditLogs.push(audit(`admin_${action}`, user.id, { jobId: job.id }));
  await writeDb(db);
  return NextResponse.json({ job });
}
