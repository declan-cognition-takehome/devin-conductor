import { requireUser } from '@/lib/auth/page';
import { ReportView } from '@/components/report-view';
import { IntegrationBanner } from '@/components/integration-banner';

export const dynamic = 'force-dynamic';

export default async function ReportPage() {
  await requireUser();
  return (
    <div className="space-y-5">
      <IntegrationBanner />
      <ReportView />
    </div>
  );
}
