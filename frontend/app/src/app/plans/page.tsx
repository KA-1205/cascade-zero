import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { MOCK_RUN_ID } from '@/lib/fixtures';

export const metadata: Metadata = { title: 'Recovery Plans' };

export default function PlansIndex() {
  redirect(`/plans/${MOCK_RUN_ID}`);
}
