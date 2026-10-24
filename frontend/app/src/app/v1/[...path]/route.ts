import { NextRequest, NextResponse } from 'next/server';
import { requireOperator } from '@/lib/operator-auth';

/** Private, runtime-configured backend bridge; aborts follow browser navigation. */
async function forward(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const denied = requireOperator(request);
  if (denied) return denied;
  const token = process.env.CASCADE_APPROVAL_TOKEN;
  if (!token) return NextResponse.json({ error: 'Backend access is not configured' }, { status: 503 });
  const { path } = await params;
  if (!path.length || path.some(segment => !/^[a-zA-Z0-9_:-]+$/.test(segment))) {
    return NextResponse.json({ error: 'Invalid API path' }, { status: 400 });
  }
  const headers = new Headers({ Authorization: `Bearer ${token}` });
  for (const name of ['content-type', 'last-event-id', 'idempotency-key']) {
    const value = request.headers.get(name); if (value) headers.set(name, value);
  }
  try {
    const origin = process.env.CASCADE_API_ORIGIN || 'http://127.0.0.1:8000';
    const response = await fetch(`${origin}/v1/${path.join('/')}${request.nextUrl.search}`, {
      method: request.method, headers, cache: 'no-store', redirect: 'error',
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(request.nextUrl.searchParams.get('stream') === '1' ? 310000 : 30000)]),
      body: request.method === 'POST' ? await request.text() : undefined,
    });
    const body = request.nextUrl.searchParams.get('stream') === '1' ? response.body : await response.text();
    return new NextResponse(body, { status: response.status, headers: {
      'Content-Type': response.headers.get('content-type') || 'application/json',
      'Cache-Control': 'private, no-store', 'X-Accel-Buffering': 'no',
    } });
  } catch {
    return NextResponse.json({ error: request.signal.aborted ? 'Request cancelled' : 'Simulator API unavailable. Check the backend connection and retry.' },
      { status: request.signal.aborted ? 499 : 502 });
  }
}

export const GET = forward;
export const POST = forward;
