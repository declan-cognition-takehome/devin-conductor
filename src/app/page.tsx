import { requireUser } from '@/lib/auth/page';
import { TaskList } from '@/components/task-list';

export const dynamic = 'force-dynamic';

export default async function ObservePage() {
  await requireUser();
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Observe</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Every GitHub issue Conductor has seen, and what Devin did with it. Humans review and merge
          pull requests.
        </p>
      </div>
      <TaskList />
    </div>
  );
}
