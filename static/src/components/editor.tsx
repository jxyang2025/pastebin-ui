import { javascript } from "@codemirror/lang-javascript";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { StreamLanguage } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { css } from "@codemirror/legacy-modes/mode/css";
import { go } from "@codemirror/legacy-modes/mode/go";
import { python } from "@codemirror/legacy-modes/mode/python";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { html } from "@codemirror/legacy-modes/mode/xml";
import { yaml } from "@codemirror/legacy-modes/mode/yaml";
import CodeMirror from "@uiw/react-codemirror";
import cn from "classnames";
import { useMemo } from "react";

interface EditorProps {
  language?: string;
  value: string;
  onChange?: (content: string) => void;
  readonly?: boolean;
  className?: string;
  height?: string;
}

/**
 * 语言名 -> 语法扩展。
 * 用 useMemo 直接算出来，不再放进 state + useEffect（少一次无谓渲染）。
 * 注意每个分支都要 break/return，之前 yaml 少写 break 穿透到 css，
 * 导致 YAML 一直用 CSS 的高亮规则。
 */
function getExtensions(language: string) {
  switch (language) {
    case "markdown":
      return [markdown({ base: markdownLanguage, codeLanguages: languages })];
    case "go":
    case "golang":
      return [StreamLanguage.define(go)];
    case "javascript":
    case "typescript":
    case "json":
      return [javascript({ jsx: true })];
    case "python":
      return [StreamLanguage.define(python)];
    case "shell":
      return [StreamLanguage.define(shell)];
    case "html":
      return [StreamLanguage.define(html)];
    case "yaml":
      return [StreamLanguage.define(yaml)];
    case "css":
    case "less":
    case "scss":
      return [StreamLanguage.define(css)];
    default:
      return [];
  }
}

export default function Editor({
  value,
  onChange,
  language = "text",
  readonly = false,
  className,
  height = "300px",
}: EditorProps) {
  const extensions = useMemo(() => getExtensions(language), [language]);

  return (
    <CodeMirror
      className={cn("rounded-sm border border-gray-200", className)}
      height={height}
      width="100%"
      onChange={onChange}
      value={value}
      extensions={extensions}
      readOnly={readonly}
      placeholder={readonly ? "" : "Write your text here..."}
      theme="light"
    />
  );
}
