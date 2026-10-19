import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { MOCK_INCIDENT_ID } from '@/lib/fixtures';
import { isMockMode } from '@/lib/api';
import { LiveIncidentsEntry } from './LiveIncidentsEntry';

export const metadata: Metadata = { title: 'Incidents' };

export default function IncidentsIndex() {
  if (isMockMode) {
    // Mock mode: redirect to the seeded demo incident.
    redirect(`/incidents/${MOCK_INCIDENT_ID}`);
  }
  // Live mode: the API contract has no list-incidents endpoint (documented
  // decision D-0032), so there is nothing to enumerate here. Redirecting to
  // the mock fixture id would make the detail page ask the backend for a run
  // that only exists in fixtures (404) — hand the operator a real entry point
  // instead.
  return <LiveIncidentsEntry />;
}
