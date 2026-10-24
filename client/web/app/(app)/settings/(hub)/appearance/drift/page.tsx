import { SetPageTitle } from '@/components/layout/page-title';
import { DriftLab } from '@/components/appearance/drift-lab';

/**
 * The Drift lab: every option of the brain's background, live in the current
 * theme, saved through the generator's path.
 * Reached from the background generator on the Appearance screen.
 */
export default function DriftLabPage() {
  return (
    <>
      <SetPageTitle title="Drift lab" />
      <div className="space-y-2 pb-2">
        <p className="text-xs text-muted-foreground">
          Every option of the animated background. Every colour comes from the current theme; switch
          themes or light/dark and the preview follows without rebuilding. Save it and it becomes
          the brain&apos;s background on every surface.
        </p>
      </div>
      <DriftLab />
    </>
  );
}
