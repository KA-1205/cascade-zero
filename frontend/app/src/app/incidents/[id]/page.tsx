import type { Metadata } from 'next';
import { IncidentPage } from './IncidentPage';

export const metadata: Metadata = {
  title: 'Incident Investigation',
};

export default function Page({ params }: { params: { id: string } }) {
  return <IncidentPage id={params.id} />;
}
