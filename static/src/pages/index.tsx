import cn from "classnames";
import { ComponentType, Suspense, lazy, memo, useState } from "react";
import { useTranslation } from "react-i18next";

function lazyTab(loader: () => Promise<{ default: ComponentType<any> }>) {
  const Component = lazy(loader);
  return function LazyTab() {
    return <Component />;
  };
}

// CodeMirror 只在这两个 Tab 里用到，按需加载
const TextShare = lazyTab(() => import("../components/text-share"));
const FileShare = lazyTab(() => import("../components/file-share"));

export default memo(function CreatePaste() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<"text" | "file">("text");

  const handleToggleTab = (tab: "text" | "file") => {
    setActiveTab(tab);
  };

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-3 p-4 md:p-10">
      <div role="tablist" className="tabs-boxed tabs">
        <a
          role="tab"
          className={cn("tab", {
            "tab-active": activeTab === "text",
          })}
          onClick={() => handleToggleTab("text")}
        >
          {t("textShare")}
        </a>
        <a
          role="tab"
          className={cn("tab", {
            "tab-active": activeTab === "file",
          })}
          onClick={() => handleToggleTab("file")}
        >
          {t("fileShare")}
        </a>
      </div>
      <Suspense fallback={null}>
        {activeTab === "text" && <TextShare />}
        {activeTab === "file" && <FileShare />}
      </Suspense>
    </div>
  );
});
