import { SetPageTitle } from '@/components/layout/page-title';
import { DriftLab } from '@/components/appearance/drift-lab';

/**
 * The Drift lab — the Neat replacement's options, live in the current theme.
 * Reached from the background generator on the Appearance screen.
 */
export default function DriftLabPage() {
  return (
    <>
      <SetPageTitle title="Drift lab" />
      <div className="space-y-2 pb-2">
        <p className="text-xs text-muted-foreground">
          Drift is the animated background engine replacing Neat. Every colour still comes from the
          current theme; switch themes or light/dark and the preview follows without rebuilding.
        </p>
      </div>
      <DriftLab />
    </>
  );
}
