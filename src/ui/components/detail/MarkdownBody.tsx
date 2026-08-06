import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// The shared markdown body styling (code/h1/h2/li/p + GFM tables). Factored out of MarkdownDoc so the
// plan-ready card + step reports embed the same rendering without a double border (MarkdownDoc wraps this in
// its own bordered <section>, which the plan card must not nest). remark-gfm adds tables/strikethrough/
// autolink — verifier reports use markdown tables.
export function MarkdownBody({ content }: { content: string }) {
  return (
    <div className="min-w-0 text-sm text-ink [&_code]:rounded [&_code]:bg-surface2 [&_code]:px-1 [&_code]:font-mono [&_code]:text-[12px] [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-surface2 [&_pre]:p-2 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_h1]:mt-2 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:mt-2 [&_h2]:text-sm [&_h2]:font-medium [&_li]:ml-4 [&_li]:list-disc [&_table]:my-2 [&_th]:border [&_th]:border-rule [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_td]:border [&_td]:border-rule [&_td]:px-2 [&_td]:py-1 [&_p]:my-1">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}
