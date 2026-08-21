// The app's error boundary (WO-0026 / B2) — and the codebase's first class component: only a class can
// implement componentDidCatch. A render-time throw anywhere below <App> lands here instead of blanking the
// whole window. The fallback offers the one recovery that always works: reload. Copy lives in the locale
// bundles (ADR-0007; WO-0035 — read via context, the class cannot hook); the styling mirrors the modal
// card pattern.
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { tr } from '../data/labels';
import { LocaleContext, type LocaleContextValue } from '../data/locale';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  // WO-0035: the class cannot hook — the words arrive through the context the provider sits above us
  // in (renderer/index.tsx). A provider-less render (or a throw during the provider's own render)
  // falls back to the tr bundle, matching the default context's ruling.
  static contextType = LocaleContext;
  declare context: LocaleContextValue; // React 19 types leave legacy context `{}` without this

  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Diagnostics go to the console; the operator sees the calm fallback.
    console.error('renderer crashed:', error, info.componentStack);
  }

  render(): ReactNode {
    const L = this.context ? this.context.labels : tr;
    if (this.state.error) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-bg p-6">
          <div className="w-full max-w-md rounded-md border border-hairline bg-surface p-4 shadow-sm">
            <div className="mb-2 flex items-stretch">
              <div className="w-1 self-stretch bg-error" />
              <div className="flex-1 px-3.5 py-2">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-error">{L.UI.errorBoundaryTitle}</p>
                <p className="mt-1 text-[12px] text-inkdim">{L.UI.errorBoundaryHint}</p>
                <div className="mt-3 flex justify-end">
                  <button type="button" onClick={() => window.location.reload()} className="rounded bg-error px-3 py-1 text-xs text-bg">
                    {L.UI.reload}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
