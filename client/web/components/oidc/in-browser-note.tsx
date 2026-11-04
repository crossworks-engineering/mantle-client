'use client';

import { Button } from '@mantle/web-ui/ui/button';
import { abandonFlow } from '@/lib/oidc/actions';

/** A sign-in out in the system browser, and the way to stop waiting for it: what
 *  comes back afterwards moves no window and spends nothing. */
export function InBrowserNote({ onStop }: { onStop: () => void }) {
  return (
    <p className="text-xs text-muted-foreground">
      Finish signing in in your browser. This window comes back when you are done.{' '}
      <Button
        type="button"
        variant="link"
        className="h-auto p-0 text-xs"
        onClick={() => {
          abandonFlow();
          onStop();
        }}
      >
        Stop
      </Button>
    </p>
  );
}
