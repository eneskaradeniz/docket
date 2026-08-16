// useDetailLayout (WO-0031c) — the rack/tabs switch. v4: the DETAY rack needs ≥1080px of viewport;
// below it the sections become tabs. AppShell is a top bar only, so viewport ≈ content box, and the
// mockup's thresholds are viewport thresholds — a matchMedia hook keeps the two layouts genuinely
// different trees instead of forcing one DOM through CSS acrobatics (a container query cannot move
// the Terminal between the rack's main column and a tab peer without re-parenting).
import { useEffect, useState } from 'react';

export type DetailLayout = 'rack' | 'tabs';

const QUERY = '(min-width: 1080px)';

export function useDetailLayout(): DetailLayout {
  const [layout, setLayout] = useState<DetailLayout>(() =>
    typeof window !== 'undefined' && window.matchMedia(QUERY).matches ? 'rack' : 'tabs',
  );
  useEffect(() => {
    const mq = window.matchMedia(QUERY);
    const onChange = (e: MediaQueryListEvent): void => setLayout(e.matches ? 'rack' : 'tabs');
    mq.addEventListener('change', onChange);
    setLayout(mq.matches ? 'rack' : 'tabs');
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return layout;
}
