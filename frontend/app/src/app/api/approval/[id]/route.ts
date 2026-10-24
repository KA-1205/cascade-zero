import { NextRequest, NextResponse } from 'next/server';
import { requireOperator } from '@/lib/operator-auth';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = requireOperator(request);
  if (denied) return denied;
  const token = process.env.CASCADE_APPROVAL_TOKEN;
  const key = request.headers.get('Idempotency-Key');
  if (!token) return NextResponse.json({ error: 'Sandbox approval token is not configured' }, { status: 503 });
  if (!key) return NextResponse.json({ error: 'Idempotency-Key required' }, { status: 400 });
  const { id } = await params;
  if (!/^[a-zA-Z0-9-]+:plan:[0-9]+$/.test(id)) {
    return NextResponse.json({ error: 'Invalid sandbox plan id' }, { status: 400 });
  }
  const origin = process.env.CASCADE_API_ORIGIN ?? 'http://127.0.0.1:8000';
  try {
    const response = await fetch(`${origin}/v1/plans/${id}/approval`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`, 'Idempotency-Key': key },
      body: await request.text(),
      cache: 'no-store',
      signal: AbortSignal.timeout(30000),
    });
    return new NextResponse(response.status === 202 ? null : await response.text(), { status: response.status });
  } catch {
    return NextResponse.json({ error: 'Sandbox API unavailable' }, { status: 502 });
  }
}
