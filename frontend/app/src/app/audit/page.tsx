import type { Metadata } from 'next';
import { BackendDemo } from '@/components/demo/BackendDemo';

export const metadata: Metadata = { title: 'Audit Trail' };

export default function Page() {
  return <BackendDemo view="audit" />;
}
