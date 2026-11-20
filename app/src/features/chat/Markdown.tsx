// The model's answers are Markdown. Shown formatted, in the chat's own type: headings,
// emphasis, lists, quotes, code and tables (GitHub style). Raw HTML in an answer is not
// rendered, and links are not followed (inside the app a link would replace the app):
// the address is shown instead.
import { memo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

const components: Components = {
  h1: ({ children }) => <h3 className="mb-2 mt-6 font-serif text-[1.6rem] font-medium leading-tight first:mt-0">{children}</h3>,
  h2: ({ children }) => <h3 className="mb-2 mt-6 font-serif text-[1.45rem] font-medium leading-tight first:mt-0">{children}</h3>,
  h3: ({ children }) => <h4 className="mb-1.5 mt-5 font-serif text-[1.3rem] font-medium leading-snug first:mt-0">{children}</h4>,
  h4: ({ children }) => <h5 className="mb-1 mt-4 font-sans text-base font-semibold first:mt-0">{children}</h5>,
  h5: ({ children }) => <h6 className="mb-1 mt-4 font-sans text-base font-semibold first:mt-0">{children}</h6>,
  h6: ({ children }) => <h6 className="mb-1 mt-4 font-sans text-sm font-semibold uppercase first:mt-0">{children}</h6>,
  p: ({ children }) => <p className="my-3 first:mt-0 last:mb-0">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  ul: ({ children }) => <ul className="my-3 list-disc space-y-1.5 pl-6 marker:text-muted-foreground first:mt-0 last:mb-0">{children}</ul>,
  ol: ({ children }) => <ol className="my-3 list-decimal space-y-1.5 pl-6 marker:text-muted-foreground first:mt-0 last:mb-0">{children}</ol>,
  li: ({ children }) => <li className="pl-1 [&>p]:my-1">{children}</li>,
  blockquote: ({ children }) => <blockquote className="my-3 border-l-2 border-signal/60 pl-4 text-muted-foreground">{children}</blockquote>,
  hr: () => <hr className="my-6 border-border" />,
  a: ({ children, href }) => (
    <span className="underline decoration-signal/60 underline-offset-2" title={href}>
      {children}{href && typeof children === "string" && children !== href && <span className="text-muted-foreground"> ({href})</span>}
    </span>
  ),
  code: ({ children, className }) => {
    // Fenced blocks arrive with a language class or a newline; the rest is inline code.
    const block = /language-/.test(className ?? "") || String(children).includes("\n");
    return block
      ? <code className="font-mono">{children}</code>
      : <code className="rounded-md bg-foreground/10 px-1.5 py-0.5 font-mono text-[0.84em]">{children}</code>;
  },
  pre: ({ children }) => (
    <pre className="my-3 max-w-full overflow-x-auto rounded-xl border bg-surface px-4 py-3 font-mono text-[0.8125rem] leading-relaxed">{children}</pre>
  ),
  table: ({ children }) => (
    <div className="my-3 max-w-full overflow-x-auto rounded-xl border">
      <table className="w-full border-collapse font-sans text-sm">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border-b bg-surface px-3 py-2 text-left font-semibold">{children}</th>,
  td: ({ children }) => <td className="border-b px-3 py-2 align-top [tr:last-child_&]:border-b-0">{children}</td>,
  img: ({ alt }) => <span className="text-muted-foreground">[{alt || "image"}]</span>,
};

function Markdown({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn("min-w-0 break-words", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{text}</ReactMarkdown>
    </div>
  );
}

export default memo(Markdown);
