import type { Metadata } from 'next';
import { BackendDemo } from '@/components/demo/BackendDemo';

export const metadata: Metadata = { title: 'Recovery Planning' };

// Next.js 16: dynamic route params are a Promise on the server. Reading
// params.id synchronously yielded `undefined` at runtime (dev log: "used
// `params.id`. `params` is a Promise and must be unwrapped").
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <BackendDemo key={id} view="plans" runId={id} />;
}
