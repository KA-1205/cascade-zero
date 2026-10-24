import type { Metadata } from 'next';
import { BackendDemo } from '@/components/demo/BackendDemo';

export const metadata: Metadata = { title: 'Audit Trail' };

export default async function Page({ searchParams }: { searchParams: Promise<{ run?: string }> }) {
  const params = await searchParams;
  return <BackendDemo view="audit" runId={params.run} />;
}
