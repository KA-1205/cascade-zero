import type { Metadata } from 'next';
import { BackendDemo } from '@/components/demo/BackendDemo';

export const metadata: Metadata = { title: 'Recovery Plans' };

export default function PlansIndex() {
  return <BackendDemo view="plans" />;
}
