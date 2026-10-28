import type { Metadata } from 'next';
import { BackendDemo } from '@/components/demo/BackendDemo';

export const metadata: Metadata = {
  title: 'Incident Investigation',
};

// Next.js 16: dynamic route params are a Promise on the server.
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <BackendDemo key={id} view="incident" runId={id} />;
}
