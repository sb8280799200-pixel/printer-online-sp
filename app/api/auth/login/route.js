import { NextResponse } from 'next/server';
import { authenticate, encodeUser } from '@/lib/store';

export async function POST(request) {
  const { username, password } = await request.json();
  const user = await authenticate(username, password);

  if (!user) {
    return NextResponse.json({ error: 'Invalid username or password' }, { status: 401 });
  }

  return NextResponse.json({ user, token: encodeUser(user) });
}
