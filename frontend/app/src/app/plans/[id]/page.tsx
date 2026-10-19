import type { Metadata } from 'next';
import { PlansPage } from './PlansPage';

export const metadata: Metadata = { title: 'Recovery Planning' };

export default function Page({ params }: { params: { id: string } }) {
  return <PlansPage runId={params.id} />;
}
