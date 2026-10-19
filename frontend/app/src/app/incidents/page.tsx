import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { MOCK_INCIDENT_ID } from '@/lib/fixtures';

export const metadata: Metadata = { title: 'Incidents' };

export default function IncidentsIndex() {
  // Redirect to the active demo incident
  redirect(`/incidents/${MOCK_INCIDENT_ID}`);
}
