import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * 极简 Markdown 渲染器。
 * 不引入 KaTeX / 语法高亮以保持 bundle 小,后续需要再加。
 *
 * 链接统一在新标签页打开(target=_blank + rel=noopener),并加下划线蓝色样式 ——
 * 让引用的数据源 / 文献链接可点击跳转,便于溯源核验。
 */
const COMPONENTS: Components = {
  a: ({ href, children, ...rest }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      style={{ color: '#2b57d6', textDecoration: 'underline' }}
      {...rest}
    >
      {children}
    </a>
  ),
};

export function MarkdownView({ text, className }: { text?: string; className?: string }) {
  if (!text) return <div style={{ color: '#6b7a90' }}>(无内容)</div>;
  return (
    <div className={className} style={{ fontSize: 13, lineHeight: 1.75 }}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
