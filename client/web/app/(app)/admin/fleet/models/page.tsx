import { SetPageTitle } from '@/components/layout/page-title';
import { ModelsClient } from './models-client';

/** Control Center > Agent models: the model of a shipped agent, set on the boxes picked. Data-free: the client reads the brain. */
export default function ModelsPage() {
  return (
    <>
      <SetPageTitle title="Agent models" />
      <ModelsClient />
    </>
  );
}
