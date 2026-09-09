import { requireUser } from '@/lib/auth/page';
import { ConfigureView } from '@/components/configure-view';

export const dynamic = 'force-dynamic';

export default async function ConfigurePage() {
  await requireUser();
  return <ConfigureView />;
}
