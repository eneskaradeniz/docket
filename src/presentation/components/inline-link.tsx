// components/inline-link.tsx — the tertiary tier: plain text only as a link inside running
// text. It is an anchor, never a button, and it draws nothing when it is not inside Prose,
// so a standalone control cannot hide as a link.
import { createContext, useContext, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';

const ProseContext = createContext(false);

export interface ProseProps {
  readonly children: ReactNode;
  readonly className?: string;
  readonly role?: 'alert' | 'status';
  /** A data attribute the host already names, kept on the paragraph. */
  readonly marker?: readonly [string, string];
}

/** The running-text wrapper a tertiary link is allowed to sit in. */
export function Prose({ children, className, role, marker }: ProseProps) {
  const marked = marker === undefined ? {} : { [marker[0]]: marker[1] };
  return (
    <p data-prose="" className={className} role={role} {...marked}>
      <ProseContext.Provider value={true}>{children}</ProseContext.Provider>
    </p>
  );
}

const LINK_CLASS =
  'rounded-control text-ink underline decoration-bord underline-offset-4 hover:decoration-ink focus-visible:outline-solid focus-visible:outline-[0.125rem] focus-visible:outline-offset-[0.125rem] focus-visible:outline-signal-soft';

export interface InlineLinkProps {
  readonly children: ReactNode;
  readonly onClick: () => void;
  readonly title?: string;
  readonly className?: string;
}

/** A keyboard-focusable underlined link. Outside Prose it is inert text. */
export function InlineLink({ children, onClick, title, className }: InlineLinkProps) {
  const inProse = useContext(ProseContext);
  if (!inProse) return <span data-inline-link-blocked="">{children}</span>;
  const activate = (): void => onClick();
  const onKeyDown = (event: KeyboardEvent<HTMLAnchorElement>): void => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    activate();
  };
  return (
    <a
      role="link"
      tabIndex={0}
      data-inline-link=""
      title={title}
      className={className === undefined ? LINK_CLASS : `${LINK_CLASS} ${className}`}
      onClick={(event: MouseEvent<HTMLAnchorElement>) => {
        event.preventDefault();
        activate();
      }}
      onKeyDown={onKeyDown}
    >
      {children}
    </a>
  );
}
