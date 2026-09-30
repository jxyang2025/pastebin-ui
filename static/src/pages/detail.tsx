import { useCallback, useEffect, useState } from "react";
import { toast } from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { useParams } from "wouter";

import Editor from "../components/editor";
import MdRenderer from "../components/md-renderer";
import { ApiError, getPaste } from "../service";
import { copyText } from "../utils/copy";

export default function Detail() {
  const { t } = useTranslation();
  const { id } = useParams();

  const [pasteData, setPasteData] = useState<any>();
  const [content, setContent] = useState("");
  const [language, setLanguage] = useState("text");
  const [loading, setLoading] = useState(true);
  const [needPassword, setNeedPassword] = useState(false);
  const [notFound, setNotFound] = useState(false);
  // 密码从 URL 或用户输入获得并保存在本地；服务端只存哈希、不回传明文
  const [password, setPassword] = useState(
    () => new URLSearchParams(window.location.search).get("share_password") ?? "",
  );
  const [passwordInput, setPasswordInput] = useState("");

  const load = useCallback(
    async (pwd: string) => {
      if (!id) return;
      setLoading(true);
      try {
        const data = await getPaste(id, pwd || undefined);
        setNotFound(false);
        setNeedPassword(false);
        setPasteData(data);
        setContent(data.content ?? "");
        setLanguage(data.language || "text");
      } catch (error) {
        const code = error instanceof ApiError ? error.code : 0;
        if (code === 403) {
          setNeedPassword(true);
        } else if (code === 404) {
          setNotFound(true);
        } else {
          toast.error(error instanceof Error ? error.message : String(error));
        }
      } finally {
        setLoading(false);
      }
    },
    [id],
  );

  useEffect(() => {
    void load(password);
    // 只在 id 变化时重新拉取；提交密码时会显式再调用 load
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const handleSubmitPassword = () => {
    if (!passwordInput) return;
    setPassword(passwordInput);
    // 用 replaceState 更新地址栏，避免整页刷新
    const url = new URL(window.location.href);
    url.searchParams.set("share_password", passwordInput);
    window.history.replaceState(null, "", url.toString());
    void load(passwordInput);
  };

  const handleCopy = async (text: string) => {
    const ok = await copyText(text);
    if (ok) {
      toast.success(t("copied"));
    } else {
      toast.error(t("copyFailed"));
    }
  };

  const hasPassword = Boolean(pasteData?.has_password);
  const detailUrl = `${window.location.origin}/detail/${id}`;
  const rawUrl = `${window.location.origin}/raw/${id}${
    hasPassword && password ? `?share_password=${encodeURIComponent(password)}` : ""
  }`;

  if (loading) {
    return (
      <div className="mx-auto max-w-7xl p-4 md:pt-20">
        <p className="text-center text-gray-500 dark:text-gray-400">
          {t("loading")}
        </p>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="mx-auto max-w-7xl p-4 md:pt-20">
        <div className="text-center">
          <h1 className="text-4xl font-bold">404</h1>
          <p className="mt-2 text-gray-500 dark:text-gray-400">{t("notFound")}</p>
        </div>
      </div>
    );
  }

  if (needPassword) {
    return (
      <div className="mx-auto max-w-7xl p-4 md:pt-20">
        <div className="text-center">
          <h1 className="text-4xl font-bold">403</h1>
          <p className="text-gray-500 dark:text-gray-400">{t("passwordRequired")}</p>
          <div className="inline-flex gap-2 items-center mt-4">
            <input
              type="password"
              className="input input-sm input-bordered w-full md:max-w-xs"
              value={passwordInput}
              placeholder={t("passwordPlaceholder")}
              onChange={(e) => setPasswordInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSubmitPassword();
              }}
            />
            <button className="btn btn-sm" onClick={handleSubmitPassword}>
              {t("submit")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl p-4 md:pt-10">
      <div className="mb-4 flex gap-4 flex-col md:flex-row">
        <button className="btn" onClick={() => handleCopy(detailUrl)}>
          {hasPassword && <LockIcon />}
          {t("copyUrl")} {hasPassword && t("withoutPassword")}
        </button>
        <button className="btn" onClick={() => window.open(rawUrl)}>
          {hasPassword && <LockIcon />}
          {t("viewRaw")}
        </button>
        <button className="btn" onClick={() => handleCopy(content)}>
          {t("copyRaw")}
        </button>
      </div>
      {language === "markdown" ? (
        <MdRenderer content={content} className="px-0 md:pt-0" />
      ) : (
        <Editor
          height="calc(100vh - 200px)"
          language={language}
          value={content}
          readonly={true}
        />
      )}
    </div>
  );
}

function LockIcon() {
  return (
    <svg
      className="h-4 w-4 text-green-600 dark:text-white"
      xmlns="http://www.w3.org/2000/svg"
      fill="currentColor"
      viewBox="0 0 16 20"
    >
      <path d="M14 7h-1.5V4.5a4.5 4.5 0 1 0-9 0V7H2a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2Zm-5 8a1 1 0 1 1-2 0v-3a1 1 0 1 1 2 0v3Zm1.5-8h-5V4.5a2.5 2.5 0 1 1 5 0V7Z" />
    </svg>
  );
}
