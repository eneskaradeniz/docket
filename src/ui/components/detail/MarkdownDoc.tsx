import ReactMarkdown from 'react-markdown';

// Owned documents (order.md / plan.md) rendered inline, read-only (ccd463e).
export function MarkdownDoc({ title, content }: { title: string; content: string }) {
  return (
    <section className="rounded-sm border border-rule bg-surface p-3">
      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-inkdim">{title}</h2>
      <div className="text-sm text-ink [&_code]:rounded [&_code]:bg-surface2 [&_code]:px-1 [&_code]:font-mono [&_code]:text-[12px] [&_h1]:mt-2 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:mt-2 [&_h2]:text-sm [&_h2]:font-medium [&_li]:ml-4 [&_li]:list-disc [&_p]:my-1">
        <ReactMarkdown>{content}</ReactMarkdown>
      </div>
    </section>
  );
}
