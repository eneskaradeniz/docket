// CodeBlock — the fenced-code face of every markdown body (WO-0037, Ray ruling 2026-08-22): the ONE
// volumetric element in any markdown surface — a single BORDERLESS recessed volume (raised over the
// host ground), never border+background+header+border stacks. Header = the fence's language readout
// + a copy button, no strip. Installed as react-markdown's `pre` override in MarkdownBody, so the
// plan card, step reports, the chat transcript and the ledger expansion share one grammar.
// rehype-highlight (detect: false) paints only fence-tagged blocks — an untagged fence stays plain,
// honest; the .hljs-* palette lives in index.css, mapped onto the app's own tokens. No line
// numbers: blocks are short, numbers are chrome (order.md Notes records the call).
import { isValidElement, useRef, useState, type ComponentPropsWithoutRef } from 'react';
import { Check, Copy } from 'lucide-react';
import { useLabels } from '../../data/locale';

type PreProps = ComponentPropsWithoutRef<'pre'> & { node?: unknown };

export function CodeBlock({ children, node: _node, ...rest }: PreProps) {
  const { UI } = useLabels();
  const preRef = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);

  // The language token rides the child <code className="language-ts hljs"> — absent when the fence
  // carried no tag (the header then holds the copy button alone, no label).
  const codeClass = isValidElement(children)
    ? String((children.props as { className?: string }).className ?? '')
    : '';
  const lang = /language-([\w-]+)/.exec(codeClass)?.[1]?.toUpperCase() ?? '';

  const copy = async (): Promise<void> => {
    const text = preRef.current?.textContent ?? '';
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable — the code stays selectable on screen
    }
  };

  return (
    <div className="my-1.5 rounded-md bg-raised/40 px-2.5 py-2">
      <div className="mb-1 flex items-center justify-between gap-2 px-0.5">
        {lang ? (
          <span
            data-code-lang={lang}
            className="font-mono text-[10px] font-medium uppercase tracking-[0.1em] text-inkdim"
          >
            {lang}
          </span>
        ) : (
          <span />
        )}
        <button
          type="button"
          className="ibtn h-5 w-5 rounded-[4px]"
          aria-label={copied ? UI.copyDone : UI.codeCopyAria}
          onClick={() => void copy()}
        >
          {copied ? (
            <Check className="h-3 w-3" aria-hidden="true" />
          ) : (
            <Copy className="h-3 w-3" aria-hidden="true" />
          )}
        </button>
      </div>
      <pre
        ref={preRef}
        {...rest}
        className="overflow-x-auto px-0.5 font-mono text-[11.5px] leading-relaxed text-ink"
      >
        {children}
      </pre>
    </div>
  );
}
