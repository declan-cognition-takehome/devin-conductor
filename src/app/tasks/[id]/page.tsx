import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/page';
import { getTask } from '@/lib/db/store';
import { TaskDetail } from '@/components/task-detail';

export const dynamic = 'force-dynamic';

export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  if (!getTask(id)) notFound();
  return <TaskDetail taskId={id} />;
}
