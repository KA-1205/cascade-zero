import type { Metadata } from 'next';
import { ExperimentsPage } from './ExperimentsPage';

export const metadata: Metadata = { title: 'Experiment Lab' };

export default function Page() {
  return <ExperimentsPage />;
}
