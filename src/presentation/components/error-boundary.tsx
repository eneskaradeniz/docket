// components/error-boundary.tsx — the root's crash surface: a render throw anywhere under the app
// lands here instead of unmounting the tree into a black void. React wires boundaries only through
// a class component (getDerivedStateFromError / componentDidCatch), so this is the presentation's
// one class; the domain's class rule does not reach this layer. The fallback keeps the console
// loud (never silent), stays in the book's dark grammar, and offers the one recovery that always
// works: a reload that re-mounts the tree from scratch.
import { Component, type ErrorInfo, type ReactNode } from 'react';

import { t, type Locale } from '../labels/t';
import { ActionButton } from './action-button';

export interface ErrorBoundaryProps {
  readonly children: ReactNode;
  /** The locale store's current() read, injected because the class cannot hook. The fallback
   *  replaces the whole tree — the language switcher is gone with it — so a non-reactive read of
   *  the selection at fallback time is already the live one. */
  readonly locale: () => Locale;
}

interface ErrorBoundaryState {
  readonly error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // The boundary is never silent: the crash and its component stack stay on the console for the
    // operator even while the screen itself stays calm.
    console.error('renderer crashed:', error, info.componentStack);
  }

  render(): ReactNode {
    const { error } = this.state;
    if (error === null) return this.props.children;

    const locale = this.props.locale();
    // A thrown value without a message still leaves something selectable to copy.
    const detail = error.message !== '' ? error.message : String(error);
    return (
      <div role="alert" className="flex min-h-dvh items-center justify-center bg-bg p-6 text-ink">
        <div className="w-full max-w-md rounded-md border border-error/40 bg-surface p-4">
          <div className="flex items-center gap-2.5">
            <span className="font-mono text-[11px] font-medium text-error">×</span>
            <p className="text-[13px] font-semibold text-ink">{t(locale, 'errorBoundary.title')}</p>
          </div>
          <pre className="mt-3 max-h-40 select-all overflow-auto whitespace-pre-wrap break-words rounded-md border border-hairline bg-band px-3 py-2 font-mono text-[11px] text-inkdim">
            {detail}
          </pre>
          <div className="mt-3 flex justify-end">
            <ActionButton variant="primary" onClick={() => window.location.reload()}>
              {t(locale, 'errorBoundary.reload')}
            </ActionButton>
          </div>
        </div>
      </div>
    );
  }
}
