import { STATIC_PARAM } from '@/lib/static-param';

/** Static export: one page per route, served for every value (lib/route-params.ts). */
export function generateStaticParams() {
  return [{ slug: [STATIC_PARAM] }];
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
