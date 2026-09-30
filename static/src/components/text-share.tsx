import { ChangeEvent, useState } from "react";
import { toast } from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";

import { createPaste } from "../service";
import nanoid from "../utils/nanoid";
import Editor from "./editor";

const LANGUAGES = [
  { value: "html", label: "HTML" },
  { value: "json", label: "JSON" },
  { value: "yaml", label: "YAML" },
  { value: "javascript", label: "JavaScript" },
  { value: "typescript", label: "TypeScript" },
  { value: "markdown", label: "Markdown" },
  { value: "python", label: "Python" },
  { value: "go", label: "Golang" },
  { value: "css", label: "CSS" },
  { value: "shell", label: "Shell" },
];

const EXPIRATION_PRESETS = [
  { value: 60, label: "1 min" },
  { value: 300, label: "5 mins" },
  { value: 3600, label: "1 hour" },
  { value: 86400, label: "1 day" },
  { value: 604800, label: "1 week" },
  { value: 2592000, label: "1 month" },
];

export default function TextShare() {
  const { t } = useTranslation();
  const [, navigate] = useLocation();
  const [language, setLanguage] = useState("");
  const [sharePassword, setSharePassword] = useState("");
  const [content, setContent] = useState("");
  const [expiration, setExpiration] = useState<number | undefined>(undefined);
  const [isPrivate, setIsPrivate] = useState(false);
  const [publishing, setPublishing] = useState(false);

  const createPB = async () => {
    if (!content) {
      toast.error(t("contentRequired"));
      return;
    }
    setPublishing(true);
    try {
      const data = await createPaste({
        content,
        // 后端要求 TTL 是 >= 60 的整数，空值传 undefined 表示永久
        expire: expiration,
        isPrivate,
        language,
        share_password: sharePassword,
      });

      const query = new URLSearchParams();
      // 明文密码只在这里拿到一次，通过 URL 带给详情页，服务端不再回传
      if (data.share_password) query.set("share_password", data.share_password);
      const suffix = query.toString() ? `?${query.toString()}` : "";
      navigate(`/detail/${data.id}${suffix}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(`${t("createError")} ${message}`);
    } finally {
      setPublishing(false);
    }
  };

  const handleSetAsPrivate = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      setIsPrivate(true);
      setSharePassword(nanoid(10));
    } else {
      setIsPrivate(false);
      setSharePassword("");
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <Editor
        height="300px"
        language={language}
        onChange={(value) => setContent(value || "")}
        value={content}
      />

      <div className="flex-col md:gap-2 md:items-center md:flex-row gap-4 flex">
        <div className="form-control">
          <div className="inline-flex gap-2">
            <label className="label cursor-pointer inline-flex gap-2">
              <span className="label-text whitespace-nowrap">{t("privateTip")}</span>
              <input
                type="checkbox"
                className="checkbox"
                checked={isPrivate}
                onChange={handleSetAsPrivate}
              />
            </label>
            <input
              value={sharePassword}
              className="input input-bordered w-full md:max-w-xs"
              placeholder={t("sharePasswordPlaceholder")}
              onChange={(e) => setSharePassword(e.target.value)}
              disabled={!isPrivate}
            />
          </div>
        </div>
        <div>
          <input
            list="expiration-times"
            type="number"
            step={1}
            min={60}
            value={expiration ?? ""}
            onChange={(e) =>
              setExpiration(e.target.value ? Number(e.target.value) : undefined)
            }
            className="input input-bordered w-full md:max-w-xs"
            placeholder={t("expiration")}
          />

          <datalist id="expiration-times">
            {EXPIRATION_PRESETS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </datalist>
        </div>

        <select
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          className="input w-full md:max-w-xs border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 p-2.5 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white"
        >
          <option value="">{t("chooseLanguage")}</option>
          {LANGUAGES.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      </div>
      <button
        className="btn btn-neutral"
        onClick={createPB}
        disabled={publishing || !content}
      >
        {t("createPaste")}
      </button>
    </div>
  );
}
