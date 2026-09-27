// components/discovery-badges.tsx — a discovered provider's two facts (U-6/U-7): whether its CLI
// binary was found on this machine, and whether it is logged in. A null proves nothing, so it gets
// its own honest badge instead of borrowing a known state.
import { t, type Locale } from '../labels/t';
import { StateBadge } from './state-badge';

export interface DiscoveryBadgesProps {
  readonly binPath: string | null;
  readonly loggedIn: boolean | null;
  readonly locale: Locale;
}

export function DiscoveryBadges({ binPath, loggedIn, locale }: DiscoveryBadgesProps) {
  return (
    <span className="flex items-center gap-1.5">
      <StateBadge tone={binPath === null ? 'dim' : 'proceed'}>
        {t(locale, binPath === null ? 'discovery.missing' : 'discovery.found')}
      </StateBadge>
      <StateBadge tone={loggedIn === true ? 'proceed' : loggedIn === false ? 'signal' : 'dim'}>
        {t(locale, loggedIn === true ? 'discovery.loggedIn' : loggedIn === false ? 'discovery.loginRequired' : 'discovery.loginUnknown')}
      </StateBadge>
    </span>
  );
}
