/**
 * API transport selector.
 * Set NEXT_PUBLIC_API_MODE=live to switch to the real backend.
 * Default is 'mock' so the frontend works without any backend.
 */
import { mockTransport } from './mock-transport';
import { liveTransport } from './live-transport';

export const isMockMode =
  !process.env.NEXT_PUBLIC_API_MODE ||
  process.env.NEXT_PUBLIC_API_MODE === 'mock';

/** Single transport used throughout the app */
export const api = isMockMode ? mockTransport : liveTransport;

export type ApiTransport = typeof mockTransport;
