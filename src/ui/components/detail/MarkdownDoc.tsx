import ReactMarkdown from 'react-markdown';

// Owned documents (order.md / plan.md) rendered inline, read-only (ccd463e).
// Content is a fixture string now; a view-time git read in M3 — never cached, never edited in-app.
export function MarkdownDoc({ title, content }: { title: string; content: string }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-3">
      <h2 className="mb-2 text-sm font-semibold text-slate-800">{title}</h2>
      <div className="text-sm text-slate-700 [&_code]:rounded [&_code]:bg-slate-100 [&_code]:px-1 [&_code]:text-[12px] [&_h1]:mt-2 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:mt-2 [&_h2]:text-sm [&_h2]:font-medium [&_li]:ml-4 [&_li]:list-disc [&_p]:my-1">
        <ReactMarkdown>{content}</ReactMarkdown>
      </div>
    </section>
  );
}
