import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import type { Components } from 'react-markdown';
import type { Schema } from 'hast-util-sanitize';

// Tight sanitize schema: strip anything that could execute or
// phone home. Scripts, event handlers, and javascript:/data:
// URLs are already removed by the defaults; we additionally
// drop embedded media (img/iframe/video/audio) because AI
// responses have no legitimate reason to embed them. See cr-8cl
// and the cr-5hb.2 design for rationale.
const schema: Schema = {
  ...defaultSchema,
  tagNames: (defaultSchema.tagNames ?? []).filter(
    (t) => !['img', 'iframe', 'video', 'audio', 'svg'].includes(t),
  ),
};

const components: Components = {
  h1: (props) => <h2 className="text-lg font-bold text-foreground mt-4 mb-2" {...props} />,
  h2: (props) => <h2 className="text-lg font-bold text-foreground mt-4 mb-2" {...props} />,
  h3: (props) => <h3 className="text-base font-bold text-foreground mt-4 mb-1" {...props} />,
  h4: (props) => <h4 className="text-sm font-bold text-foreground mt-3 mb-1" {...props} />,
  strong: (props) => <strong className="font-bold text-foreground" {...props} />,
  em: (props) => <em className="italic text-foreground/90" {...props} />,
  ul: (props) => <ul className="list-disc ml-4 space-y-1 my-2 text-sm" {...props} />,
  ol: (props) => <ol className="list-decimal ml-4 space-y-1 my-2 text-sm" {...props} />,
  li: (props) => <li className="text-sm" {...props} />,
  p: (props) => <p className="text-sm leading-relaxed my-2" {...props} />,
  code: (props) => (
    <code className="rounded bg-secondary/60 px-1 py-0.5 text-xs font-mono" {...props} />
  ),
  pre: (props) => (
    <pre
      className="rounded bg-secondary/60 p-2 text-xs font-mono overflow-x-auto my-2"
      {...props}
    />
  ),
  a: ({ href, ...props }) => (
    <a
      href={href}
      className="text-primary underline underline-offset-2"
      target="_blank"
      rel="noopener noreferrer nofollow"
      {...props}
    />
  ),
  blockquote: (props) => (
    <blockquote
      className="border-l-2 border-primary/40 pl-3 my-2 text-foreground/80 italic"
      {...props}
    />
  ),
  table: (props) => (
    <div className="overflow-x-auto my-2">
      <table className="text-xs border-collapse" {...props} />
    </div>
  ),
  th: (props) => (
    <th className="border border-border/50 px-2 py-1 text-left font-semibold" {...props} />
  ),
  td: (props) => <td className="border border-border/50 px-2 py-1" {...props} />,
  hr: () => <hr className="border-border/50 my-3" />,
};

interface MarkdownSafeProps {
  children: string;
  className?: string;
}

/**
 * Render AI-generated markdown with a strict sanitize pipeline.
 *
 * Input is parsed to an AST by remark, then any dangerous
 * tags/attrs are stripped by rehype-sanitize *before* React
 * renders it — so no string ever reaches dangerouslySetInnerHTML.
 * Replaces the previous regex-based renderMarkdown at
 * AnalysisPanel.tsx:53-62 which had an XSS hole (cr-8cl).
 */
export function MarkdownSafe({ children, className }: MarkdownSafeProps) {
  return (
    <div className={className ?? 'text-sm text-foreground/90 leading-relaxed'}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeSanitize, schema]]}
        components={components}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
