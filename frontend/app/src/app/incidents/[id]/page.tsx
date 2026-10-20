import type { Metadata } from 'next';
import { IncidentPage } from './IncidentPage';

export const metadata: Metadata = {
  title: 'Incident Investigation',
};

// Next.js 16: dynamic route params are a Promise on the server.
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <IncidentPage id={id} />;
}
