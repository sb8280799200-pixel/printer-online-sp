import { NextResponse } from 'next/server';
import { audit, readDb, writeDb } from '@/lib/store';

export async function POST(request) {
  const { email } = await request.json();
  const db = await readDb();
  const user = db.users.find((item) => item.email === String(email || '').trim().toLowerCase());
  if (user) db.auditLogs.push(audit('forgot_password_requested', user.id, { email: user.email }));
  await writeDb(db);
  return NextResponse.json({ message: 'If the email exists, reset instructions will be sent by the configured mail service.' });
}
