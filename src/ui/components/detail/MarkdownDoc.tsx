import { MarkdownBody } from './MarkdownBody';

// Owned documents (order.md / plan.md) rendered inline, read-only (ccd463e).
export function MarkdownDoc({ title, content }: { title: string; content: string }) {
  return (
    <section className="rounded-sm border border-rule bg-surface p-3">
      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-inkdim">{title}</h2>
      <MarkdownBody content={content} />
    </section>
  );
}
