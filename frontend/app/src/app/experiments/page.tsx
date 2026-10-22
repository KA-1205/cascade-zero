import type { Metadata } from 'next';
import { BackendDemo } from '@/components/demo/BackendDemo';

export const metadata: Metadata = { title: 'Experiment Lab' };

export default async function Page({ searchParams }: { searchParams: Promise<{ run?: string; plan?: string }> }) {
  const params = await searchParams;
  return <BackendDemo view="experiments" runId={params.run} planId={params.plan} />;
}
