import { createHash, timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';

/** A single operator account for this private simulator. Never forward its password. */
export function requireOperator(request: NextRequest): NextResponse | null {
  const password = process.env.CASCADE_OPERATOR_PASSWORD;
  if (!password) return NextResponse.json({ error: 'Operator access is not configured. Set CASCADE_OPERATOR_PASSWORD on the frontend server.' },
    { status: 503, headers: { 'Cache-Control': 'no-store' } });
  const expected = `${process.env.CASCADE_OPERATOR_USERNAME || 'operator'}:${password}`;
  const header = request.headers.get('authorization') || '';
  const supplied = header.startsWith('Basic ') ? Buffer.from(header.slice(6), 'base64').toString('utf8') : '';
  const digest = (value: string) => createHash('sha256').update(value).digest();
  if (!timingSafeEqual(digest(expected), digest(supplied))) return NextResponse.json({ error: 'Operator sign-in required' }, { status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Cascade Zero", charset="UTF-8"', 'Cache-Control': 'no-store' } });
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
    const origin = request.headers.get('origin');
    let sameOrigin = true;
    if (origin) {
      try { const url = new URL(origin); sameOrigin = url.protocol === request.nextUrl.protocol && url.host === request.headers.get('host'); }
      catch { sameOrigin = false; }
    }
    if (!sameOrigin || request.headers.get('sec-fetch-site') === 'cross-site') {
      return NextResponse.json({ error: 'Cross-origin writes are not allowed' }, { status: 403 });
    }
    if (!(request.headers.get('content-type') || '').startsWith('application/json')) {
      return NextResponse.json({ error: 'Expected application/json' }, { status: 415 });
    }
  }
  return null;
}
