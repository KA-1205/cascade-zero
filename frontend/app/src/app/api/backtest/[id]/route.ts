import { NextRequest, NextResponse } from 'next/server';

/** Same-origin proxy for plan backtests; the sandbox token never reaches the browser. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const token = process.env.CASCADE_APPROVAL_TOKEN;
  if (!token) return NextResponse.json({ error: 'Approval token is not configured' }, { status: 503 });
  const { id } = await params;
  if (!/^[a-zA-Z0-9-]+:plan:[0-9]+$/.test(id)) {
    return NextResponse.json({ error: 'Invalid plan id' }, { status: 400 });
  }
  const origin = process.env.CASCADE_API_ORIGIN ?? 'http://127.0.0.1:8000';
  try {
    const response = await fetch(`${origin}/v1/plans/${id}/backtest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: '{}',
      cache: 'no-store',
    });
    return new NextResponse(response.status === 200 ? await response.text() : null,
                            { status: response.status });
  } catch {
    return NextResponse.json({ error: 'Sandbox API unavailable' }, { status: 502 });
  }
}
