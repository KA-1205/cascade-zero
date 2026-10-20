import type { Metadata } from 'next';
import { LiveIncidentsEntry } from './LiveIncidentsEntry';

export const metadata: Metadata = { title: 'Incidents' };

export default function IncidentsIndex() {
  return <LiveIncidentsEntry />;
}
