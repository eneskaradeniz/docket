import ReactMarkdown from 'react-markdown';

// The shared markdown body styling (code/h1/h2/li/p). Factored out of MarkdownDoc so the plan-ready card
// can embed the same rendering inside its evidence-ticket shell without a double border (MarkdownDoc wraps
// this in its own bordered <section>, which the plan card must not nest).
export function MarkdownBody({ content }: { content: string }) {
  return (
    <div className="text-sm text-ink [&_code]:rounded [&_code]:bg-surface2 [&_code]:px-1 [&_code]:font-mono [&_code]:text-[12px] [&_h1]:mt-2 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:mt-2 [&_h2]:text-sm [&_h2]:font-medium [&_li]:ml-4 [&_li]:list-disc [&_p]:my-1">
      <ReactMarkdown>{content}</ReactMarkdown>
    </div>
  );
}
