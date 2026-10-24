import { NextRequest, NextResponse } from 'next/server';
import { requireOperator } from './lib/operator-auth';

export function proxy(request: NextRequest) {
  const denied = requireOperator(request);
  if (denied) return denied;
  const response = NextResponse.next();
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] };
