import { NextResponse } from 'next/server';
import { encodeUser, registerUser } from '@/lib/store';

export async function POST(request) {
  try {
    const user = await registerUser(await request.json());
    return NextResponse.json({ user, token: encodeUser(user) }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
