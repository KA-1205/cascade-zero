import type { Metadata } from 'next';
import { BackendDemo } from '@/components/demo/BackendDemo';

export const metadata: Metadata = {
  title: 'Infrastructure Overview',
  description: 'Global infrastructure health, service topology, active incidents and agent activity.',
};

export default function Page() {
  return <BackendDemo view="overview" />;
}
