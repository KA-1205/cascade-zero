/**
 * API transport selector.
 * Set NEXT_PUBLIC_API_MODE=live to switch to the real backend.
 * Default is 'mock' so the frontend works without any backend.
 */
import { liveTransport } from './live-transport';

/** The demo uses the sandbox backend; fixture screens are not a runtime mode. */
export const api = liveTransport;

export type ApiTransport = typeof liveTransport;
