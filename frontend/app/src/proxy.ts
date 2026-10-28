import { NextRequest, NextResponse } from 'next/server';
import { requireOperator } from './lib/operator-auth';

export function proxy(request: NextRequest) {
  // The public landing page is static marketing content; everything else stays behind operator sign-in.
  const isLanding = request.nextUrl.pathname === '/' && ['GET', 'HEAD'].includes(request.method);
  if (isLanding) {
    const open = NextResponse.next();
    open.headers.set('Cache-Control', 'public, max-age=0, must-revalidate');
    return open;
  }
  const denied = requireOperator(request);
  if (denied) return denied;
  const response = NextResponse.next();
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] };
