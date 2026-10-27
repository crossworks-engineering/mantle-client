import { SetPageTitle } from '@/components/layout/page-title';
import { ServicesClient } from './services-client';

/**
 * /settings/services — start and stop the box's optional services
 * (sandboxes, the local embedder, the PDF-export helper). Data-free:
 * ServicesClient reads GET /api/services and
 * follows a switch on GET /api/services/status; POST /api/services/:name
 * asks the box's updater to switch one (mantle docs/services.md).
 */
export default async function ServicesPage() {
  return (
    <div className="space-y-6 px-6 py-8">
      <SetPageTitle title="Services" />
      <ServicesClient />
    </div>
  );
}
