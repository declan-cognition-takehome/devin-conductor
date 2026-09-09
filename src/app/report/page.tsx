import { requireUser } from '@/lib/auth/page';
import { ReportView } from '@/components/report-view';

export const dynamic = 'force-dynamic';

export default async function ReportPage() {
  await requireUser();
  return <ReportView />;
}
