'use client';

import { useEffect } from 'react';

/** A page left for the provider and brought back with the browser's Back
 *  button is restored as it was, its button still busy. */
export function useReturnReset(reset: () => void): void {
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) reset();
    };
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, [reset]);
}
