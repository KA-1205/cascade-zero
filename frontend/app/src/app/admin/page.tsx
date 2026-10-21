import type { Metadata } from 'next';
import { AdminDashboard } from '@/components/demo/AdminDashboard';

export const metadata: Metadata = {
  title: 'Project Admin',
};

export default function Page() {
  return <AdminDashboard />;
}
