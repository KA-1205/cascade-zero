/**
 * API transport: the live sandbox backend, reached same-origin through the
 * Next rewrite proxy (see live-transport.ts). There is no mock mode; the
 * pages show an honest empty state when the backend is not running.
 */
import { liveTransport } from './live-transport';

/** The demo uses the sandbox backend; fixture screens are not a runtime mode. */
export const api = liveTransport;

export type ApiTransport = typeof liveTransport;
