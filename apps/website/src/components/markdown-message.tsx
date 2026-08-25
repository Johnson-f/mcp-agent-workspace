import type { ComponentPropsWithoutRef } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

const components: Components = {
  h1: ({ children }) => (
    <h1 className="mb-3 mt-7 text-xl font-semibold tracking-[-0.025em] first:mt-0">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="mb-2.5 mt-6 text-lg font-semibold tracking-[-0.02em] first:mt-0">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="mb-2 mt-5 text-[15px] font-semibold first:mt-0">
      {children}
    </h3>
  ),
  p: ({ children }) => <p className="mb-4 last:mb-0">{children}</p>,
  strong: ({ children }) => (
    <strong className="font-semibold text-[#242320]">{children}</strong>
  ),
  ul: ({ children }) => (
    <ul className="mb-4 ml-5 list-disc space-y-1.5 marker:text-[#8b8983] last:mb-0">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="mb-4 ml-5 list-decimal space-y-1.5 marker:text-[#6f6d67] last:mb-0">
      {children}
    </ol>
  ),
  li: ({ children }) => <li className="pl-1">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="my-4 border-l-2 border-[#c9c7c0] pl-4 text-[#65635e]">
      {children}
    </blockquote>
  ),
  a: ({ children, href }) => (
    <a
      className="font-medium text-[#4d6592] underline decoration-[#9ba9c3] underline-offset-2 hover:text-[#354a72]"
      href={href}
      rel="noopener noreferrer"
      target="_blank"
    >
      {children}
    </a>
  ),
  pre: ({ children }) => (
    <pre className="my-4 overflow-x-auto rounded-xl border border-black/[0.07] bg-[#f6f6f4] p-4 text-[13px] leading-6 text-[#34332f] [&>code]:bg-transparent [&>code]:p-0">
      {children}
    </pre>
  ),
  code: ({ children, className, node: _node, ...props }) => {
    const fenced = className?.startsWith("language-");
    return (
      <code
        className={cn(
          className,
          fenced
            ? "font-mono"
            : "rounded-md bg-black/[0.055] px-1.5 py-0.5 font-mono text-[0.88em] text-[#4c4943]",
        )}
        {...props}
      >
        {children}
      </code>
    );
  },
  table: ({ children }) => (
    <div className="my-4 overflow-x-auto rounded-xl border border-black/[0.08]">
      <table className="w-full border-collapse text-left text-sm">
        {children}
      </table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-[#f6f6f4]">{children}</thead>,
  th: ({ children }) => (
    <th className="border-b border-black/[0.08] px-3 py-2 font-semibold">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border-b border-black/[0.055] px-3 py-2 align-top last:border-b-0">
      {children}
    </td>
  ),
  hr: () => <hr className="my-6 border-black/[0.08]" />,
};

export function MarkdownMessage({
  className,
  content,
}: {
  className?: string;
  content: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <Markdown components={components} remarkPlugins={[remarkGfm]}>
        {content}
      </Markdown>
    </div>
  );
}

export type MarkdownMessageProps = ComponentPropsWithoutRef<
  typeof MarkdownMessage
>;
