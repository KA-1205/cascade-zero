import type { Metadata } from 'next';
import { OverviewPage } from './OverviewPage';

export const metadata: Metadata = {
  title: 'Infrastructure Overview',
  description: 'Global infrastructure health, service topology, active incidents and agent activity.',
};

export default function Page() {
  return <OverviewPage />;
}
