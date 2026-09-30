import { useTranslation } from "react-i18next";
import { toast } from "react-hot-toast";
import Upload from "rc-upload";
import { useEffect, useRef, useState } from "react";

import { uploadFile } from "../service";
import { copyText } from "../utils/copy";

const MAX_SIZE = 25 * 1024 * 1024;

const EDITABLE_TAGS = ["INPUT", "TEXTAREA", "SELECT"];

export default function FileShare() {
  const { t } = useTranslation();
  const [uploadedUrl, setUploadedUrl] = useState("");
  const toastIdRef = useRef<string | undefined>(undefined);

  const doUpload = async (file: File) => {
    if (file.size > MAX_SIZE) {
      toast.error(t("fileSizeError"));
      return;
    }
    toastIdRef.current = toast.loading(t("uploading"));
    try {
      // 统一走 service，链接以服务端返回的为准，避免前后端域名不一致
      const data = await uploadFile(file);
      setUploadedUrl(data.url);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(`${t("uploadError")} ${message}`);
    } finally {
      if (toastIdRef.current) {
        toast.dismiss(toastIdRef.current);
        toastIdRef.current = undefined;
      }
    }
  };

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target as HTMLElement | null;
      // 在输入框里粘贴时不应该触发上传
      if (
        target &&
        (target.isContentEditable || EDITABLE_TAGS.includes(target.tagName))
      ) {
        return;
      }
      const file = event.clipboardData?.files?.[0];
      if (!file) return;
      event.preventDefault();
      void doUpload(file);
    };

    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  });

  const handleCopy = async () => {
    const ok = await copyText(uploadedUrl);
    if (ok) {
      toast.success(t("copySuccess"));
    } else {
      toast.error(t("copyFailed"));
    }
  };

  const props = {
    action: "",
    multiple: false,
    showUploadList: false,
    beforeUpload(file: File) {
      if (file.size > MAX_SIZE) {
        toast.error(t("fileSizeError"));
        return false;
      }
      return true;
    },
    customRequest(options: { file: unknown }) {
      void doUpload(options.file as File);
    },
  };

  return (
    <div className="flex flex-col gap-3">
      <Upload {...props}>
        <div className="w-full">
          <label className="flex h-48 w-full cursor-pointer appearance-none justify-center rounded-md border-2 border-dashed border-gray-300 bg-white px-4 transition hover:border-gray-400 focus:outline-none">
            <span className="flex items-center space-x-2">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-6 w-6 text-gray-600"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                />
              </svg>
              <span className="font-medium text-gray-600">
                {t("fileShareTip")}
                <span className="ml-2 text-blue-600 underline">
                  {t("viewFiles")}
                </span>
              </span>
            </span>
          </label>
        </div>
      </Upload>

      {uploadedUrl && (
        <div className="card w-full bg-base-100 shadow-xl">
          <div className="card-body">
            <h2 className="card-title">{t("uploadSuccess")}</h2>
            <p>{t("uploadSuccessTip")}</p>
            <p className="break-all text-sm text-gray-500">{uploadedUrl}</p>
            <div className="card-actions justify-end">
              <button className="btn btn-primary" onClick={handleCopy}>
                {t("copyLink")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
