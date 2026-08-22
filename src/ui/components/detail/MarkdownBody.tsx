import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { cn } from '../../kit';
import { CodeBlock } from './CodeBlock';

// The shared markdown body styling (inline code/h1/h2/li/p + GFM tables). Factored out of MarkdownDoc so the
// plan-ready card + step reports embed the same rendering without a double border (MarkdownDoc wraps this in
// its own bordered <section>, which the plan card must not nest). remark-gfm adds tables/strikethrough/
// autolink — verifier reports use markdown tables. WO-0037: fenced code renders through CodeBlock (the
// `pre` override — the single recessed volume + copy + rehype-highlight, detect: false so only fence-tagged
// blocks paint; unknown languages pass through, never throw); the wrapper's pre rules moved there with it —
// `[&_pre_code]` stays, it neutralizes the inline-chip look inside the block.
// WO-0037 Ray: `stream` is the transcript's skin — 13px/1.5 prose and dimmer inline chips (the 14px doc
// size stays for plan cards, verdicts and step reports; the transcript is an instrument, not a document
// host — hierarchy: the instrument must not outweigh what it shows).
export function MarkdownBody({ content, stream }: { content: string; stream?: boolean }) {
  return (
    <div className={cn(
      'min-w-0 text-ink [&_code]:rounded [&_code]:px-1 [&_code]:font-mono [&_code]:text-[12px] [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_h1]:mt-2 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:mt-2 [&_h2]:text-sm [&_h2]:font-medium [&_li]:ml-4 [&_li]:list-disc [&_table]:my-2 [&_th]:border [&_th]:border-hairline [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_td]:border [&_td]:border-hairline [&_td]:px-2 [&_td]:py-1 [&_p]:my-1',
      stream
        ? 'text-[13px] leading-[1.5] [&_code]:bg-raised/40'
        : 'text-sm [&_code]:bg-raised',
    )}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: false, ignoreMissing: true }]]}
        components={{ pre: CodeBlock }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
