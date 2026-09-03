// Renders assistant chat replies as real markdown (bold, headers, lists,
// tables) instead of dumping literal **/##/| syntax as plain text —
// Gemini's replies routinely use all of these. User messages are never
// passed through this; what someone typed themselves renders as plain
// text, unparsed.

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function Markdown({ children }: { children: string }) {
  // overflow-wrap: anywhere is inherited by every descendant — one
  // application here covers paragraphs, table cells, code spans, etc.
  // without needing it repeated on each element. Needed because plain
  // `break-words` doesn't affect intrinsic-width calculations the way
  // `anywhere` does, so a long unbroken string (a Move error's `::`-
  // joined type path, a hex address) could still force its flex/table
  // ancestor wider than the viewport instead of wrapping.
  return (
    <div className="prose-chat min-w-0 [overflow-wrap:anywhere]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="my-2 leading-relaxed first:mt-0 last:mb-0">{children}</p>,
          h1: ({ children }) => <h1 className="mb-2 mt-4 text-lg font-semibold text-vellum first:mt-0">{children}</h1>,
          h2: ({ children }) => <h2 className="mb-2 mt-4 text-base font-semibold text-vellum first:mt-0">{children}</h2>,
          h3: ({ children }) => <h3 className="mb-1.5 mt-3 text-sm font-semibold text-vellum first:mt-0">{children}</h3>,
          ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>,
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          strong: ({ children }) => <strong className="font-semibold text-vellum">{children}</strong>,
          code: ({ children }) => (
            <code className="rounded bg-ink px-1.5 py-0.5 font-data text-[0.85em] text-vellum">{children}</code>
          ),
          pre: ({ children }) => (
            <pre className="my-2 overflow-x-auto rounded-lg bg-ink p-3 font-data text-xs text-vellum">
              {children}
            </pre>
          ),
          hr: () => <hr className="my-4 border-border" />,
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noreferrer" className="text-accent underline underline-offset-2">
              {children}
            </a>
          ),
          table: ({ children }) => (
            <div className="my-3 overflow-x-auto rounded-lg border border-border">
              <table className="w-full border-collapse text-left text-sm">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-ink">{children}</thead>,
          th: ({ children }) => (
            <th className="border-b border-border px-3 py-2 font-medium text-manifest">{children}</th>
          ),
          td: ({ children }) => <td className="border-b border-border px-3 py-2 text-vellum">{children}</td>,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
