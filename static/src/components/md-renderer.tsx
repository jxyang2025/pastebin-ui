import cn from "classnames";
import DOMPurify from "dompurify";
import markdownIt from "markdown-it";
import { useMemo } from "react";

const md = markdownIt({
  html: true,
  linkify: true,
  typographer: true,
});

// 外链统一新窗口打开，并带上 rel，避免被反向控制
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node instanceof Element && node.tagName === "A") {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer nofollow");
  }
});

/**
 * 渲染 Markdown。
 *
 * 注意：内容来自任意用户，markdown-it 开了 html:true 就等同于允许注入原始 HTML，
 * 因此结果必须经过 DOMPurify 消毒后再 dangerouslySetInnerHTML，
 * 否则任何一个粘贴链接都能变成存储型 XSS。
 */
export default function MdRenderer({
  content,
  className,
}: {
  content: string;
  className?: string;
}) {
  const html = useMemo(
    () =>
      DOMPurify.sanitize(md.render(content), {
        USE_PROFILES: { html: true },
      }),
    [content],
  );

  return (
    <div className={cn("mx-auto px-10 md:max-w-6xl md:px-0 md:pt-10", className)}>
      <div className="prose !max-w-full" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
