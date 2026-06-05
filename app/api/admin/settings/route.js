import { NextResponse } from 'next/server';
import { readDb, requireUser, writeDb } from '@/lib/store';

export async function GET(request) {
  const user = requireUser(request);
  if (!user || user.role !== 'admin') return NextResponse.json({ error: 'Admin login required' }, { status: 403 });

  const db = await readDb();
  return NextResponse.json({ settings: db.settings, jobs: db.jobs.sort((a, b) => b.createdAt - a.createdAt), transactions: db.transactions.sort((a, b) => b.createdAt - a.createdAt) });
}

export async function POST(request) {
  const user = requireUser(request);
  if (!user || user.role !== 'admin') return NextResponse.json({ error: 'Admin login required' }, { status: 403 });

  const body = await request.json();
  const db = await readDb();
  db.settings = {
    ...db.settings,
    monoPrice: Math.max(0, Number(body.monoPrice) || 0),
    colorPrice: Math.max(0, Number(body.colorPrice) || 0),
    paymentAccount: String(body.paymentAccount || 'printershop@upi').trim(),
    shopName: String(body.shopName || 'Printer Online SP').trim(),
    printerEndpoint: String(body.printerEndpoint || '').trim(),
    printerCommand: String(body.printerCommand || '').trim()
  };

  await writeDb(db);
  return NextResponse.json({ settings: db.settings });
}
