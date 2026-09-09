import { requireUser } from '@/lib/auth/page';
import { TaskList } from '@/components/task-list';
import { IntegrationBanner } from '@/components/integration-banner';

export const dynamic = 'force-dynamic';

export default async function ObservePage() {
  await requireUser();
  return <TaskList banner={<IntegrationBanner />} />;
}
