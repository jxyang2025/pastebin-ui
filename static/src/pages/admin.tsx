import cn from "classnames";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "react-hot-toast";
import { useTranslation } from "react-i18next";

import {
  AdminDetail,
  AdminItem,
  AdminListResult,
  AdminSearchHit,
  ApiError,
  adminContent,
  adminDelete,
  adminList,
  adminSearch,
} from "../service";
import { copyText } from "../utils/copy";

const TOKEN_KEY = "pastebin_admin_token";
/** 详情弹窗里最多渲染这么多字符，免得超大内容把页面拖死 */
const DETAIL_RENDER_LIMIT = 20000;
/** 与后端 SEARCH_SCAN_MAX 保持一致，仅用于提示文案 */
const DEEP_SCAN_LIMIT = 300;
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

type ItemType = "text" | "file";
type TypeFilter = "all" | ItemType;
type SortOrder = "desc" | "asc";

function hasTime(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function formatTime(value: number): string {
  const date = new Date(value);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

function formatSize(bytes: number | null | undefined): string {
  if (typeof bytes !== "number" || !Number.isFinite(bytes)) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function itemKey(item: { type: ItemType; id: string }): string {
  return `${item.type}:${item.id}`;
}

function keyToTarget(key: string): { id: string; type: ItemType } {
  const index = key.indexOf(":");
  const type = key.slice(0, index) === "file" ? "file" : "text";
  return { id: key.slice(index + 1), type };
}

export default function Admin() {
  const { t } = useTranslation();

  const [token, setToken] = useState(() => sessionStorage.getItem(TOKEN_KEY) ?? "");
  const [tokenInput, setTokenInput] = useState("");
  const [authed, setAuthed] = useState(false);
  /** 服务端没配 ADMIN_TOKEN 时后台整体不可用，要给出明确提示 */
  const [disabled, setDisabled] = useState(false);
  const [loginError, setLoginError] = useState(false);

  const [data, setData] = useState<AdminListResult | null>(null);
  const [loading, setLoading] = useState(() => Boolean(sessionStorage.getItem(TOKEN_KEY)));

  const [type, setType] = useState<TypeFilter>("all");
  const [keyword, setKeyword] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [order, setOrder] = useState<SortOrder>("desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const [selected, setSelected] = useState<string[]>([]);
  const [detail, setDetail] = useState<AdminDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [deepHits, setDeepHits] = useState<AdminSearchHit[] | null>(null);
  const [deepLoading, setDeepLoading] = useState(false);

  const load = useCallback(
    async (tk: string) => {
      if (!tk) return;
      setLoading(true);
      try {
        const res = await adminList(tk, { type, keyword, order, page, pageSize });
        setData(res);
        setAuthed(true);
        setDisabled(false);
        setLoginError(false);
      } catch (error) {
        const code = error instanceof ApiError ? error.code : 0;
        if (code === 401) {
          sessionStorage.removeItem(TOKEN_KEY);
          setToken("");
          setAuthed(false);
          setLoginError(true);
        } else if (code === 503) {
          setAuthed(false);
          setDisabled(true);
        } else {
          toast.error(error instanceof Error ? error.message : String(error));
        }
      } finally {
        setLoading(false);
      }
    },
    [type, keyword, order, page, pageSize],
  );

  useEffect(() => {
    if (token) void load(token);
  }, [token, load]);

  const items = data?.items ?? [];
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const allSelected =
    items.length > 0 && items.every((item) => selectedSet.has(itemKey(item)));
  const totalPages = data?.pageCount ?? 1;

  const handleLogin = () => {
    const value = tokenInput.trim();
    if (!value) return;
    setLoginError(false);
    sessionStorage.setItem(TOKEN_KEY, value);
    setToken(value);
  };

  const handleLogout = () => {
    sessionStorage.removeItem(TOKEN_KEY);
    setToken("");
    setTokenInput("");
    setAuthed(false);
    setData(null);
    setSelected([]);
    setDeepHits(null);
    setDetail(null);
  };

  const changeType = (value: TypeFilter) => {
    setType(value);
    setSelected([]);
    setPage(1);
  };

  const changeOrder = (value: SortOrder) => {
    setOrder(value);
    setPage(1);
  };

  const changePageSize = (value: number) => {
    setPageSize(value);
    setPage(1);
  };

  const handleSearch = () => {
    setKeyword(searchInput.trim().toLowerCase());
    setSelected([]);
    setPage(1);
  };

  const clearSearch = () => {
    setSearchInput("");
    setKeyword("");
    setPage(1);
  };

  const toggleOne = (item: AdminItem) => {
    const key = itemKey(item);
    setSelected((prev) =>
      prev.includes(key) ? prev.filter((value) => value !== key) : [...prev, key],
    );
  };

  const toggleAll = () => {
    if (allSelected) {
      const pageKeys = new Set(items.map(itemKey));
      setSelected((prev) => prev.filter((key) => !pageKeys.has(key)));
      return;
    }
    setSelected((prev) => [...new Set([...prev, ...items.map(itemKey)])]);
  };

  const handleCopy = async (text: string) => {
    const ok = await copyText(text);
    if (ok) toast.success(t("copied"));
    else toast.error(t("copyFailed"));
  };

  const openDetail = async (item: AdminItem) => {
    setDetail(null);
    setDetailLoading(true);
    try {
      const res = await adminContent(token, item.id, item.type);
      setDetail(res);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setDetailLoading(false);
    }
  };

  const removeItems = async (
    targets: Array<{ id: string; type: ItemType }>,
    confirmText: string,
  ) => {
    if (!targets.length) return;
    if (!window.confirm(confirmText)) return;

    try {
      const res = await adminDelete(token, targets);
      if (res.failed) toast.error(t("adminDeleteFailed", { n: res.failed }));
      if (res.deleted) toast.success(t("adminDeleted", { n: res.deleted }));

      setSelected([]);
      setDetail(null);
      setDeepHits(null);

      // 当前页可能被删空，这时回退到最后一页，避免停在空白页
      const remaining = Math.max(0, (data?.total ?? 0) - res.deleted);
      const lastPage = Math.max(1, Math.ceil(remaining / pageSize));
      if (page > lastPage) setPage(lastPage);
      else void load(token);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const handleBatchDelete = () => {
    const targets = selected.map(keyToTarget);
    void removeItems(targets, t("adminConfirmDelete", { n: targets.length }));
  };

  const handleDeepSearch = async () => {
    const value = searchInput.trim().toLowerCase();
    if (value.length < 2) return;

    setDeepLoading(true);
    try {
      const res = await adminSearch(token, value);
      setDeepHits(res.items);
      toast.success(
        t("adminDeepSearchDone", { scanned: res.scanned, hits: res.items.length }),
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setDeepLoading(false);
    }
  };

  if (!authed) {
    if (token && loading) {
      return (
        <div className="mx-auto max-w-md p-4 md:pt-20">
          <p className="text-center text-gray-500 dark:text-gray-400">{t("adminLoading")}</p>
        </div>
      );
    }

    return (
      <div className="mx-auto max-w-md p-4 md:pt-20">
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <h1 className="text-xl font-semibold">{t("admin")}</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{t("adminSubtitle")}</p>

          {disabled ? (
            <div className="mt-4 rounded-lg border border-yellow-400 bg-yellow-50 p-3 text-sm text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-200">
              {t("adminDisabled")}
            </div>
          ) : (
            <div className="mt-4 flex flex-col gap-3">
              <input
                type="password"
                autoComplete="off"
                className="input input-bordered w-full"
                placeholder={t("adminTokenPlaceholder")}
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleLogin();
                }}
              />
              {loginError && (
                <p className="text-sm text-red-600 dark:text-red-400">
                  {t("adminTokenInvalid")}
                </p>
              )}
              <button className="btn btn-neutral" onClick={handleLogin}>
                {t("adminLogin")}
              </button>
              <p className="text-xs text-gray-500 dark:text-gray-400">{t("adminLoginTip")}</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl p-4 md:pt-10">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t("admin")}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">{t("adminSubtitle")}</p>
        </div>
        <div className="flex gap-2">
          <button
            className="btn btn-sm"
            disabled={loading}
            onClick={() => void load(token)}
          >
            {t("adminRefresh")}
          </button>
          <button className="btn btn-sm btn-ghost" onClick={handleLogout}>
            {t("adminLogout")}
          </button>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <span className="badge badge-lg">{t("adminTotal", { n: data?.total ?? 0 })}</span>
        <span className="badge badge-lg badge-ghost">
          {t("adminTextCount", { n: data?.textCount ?? 0 })}
        </span>
        <span className="badge badge-lg badge-ghost">
          {t("adminFileCount", { n: data?.fileCount ?? 0 })}
        </span>
        {(data?.unknownTime ?? 0) > 0 && (
          <span className="badge badge-lg badge-warning" title={t("adminUnknownTimeTip")}>
            {t("adminUnknownTime")} {data?.unknownTime}
          </span>
        )}
      </div>

      {data?.truncated && (
        <div className="mb-4 rounded-lg border border-yellow-400 bg-yellow-50 p-3 text-sm text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-200">
          {t("adminTruncated")}
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="join">
          {(["all", "text", "file"] as TypeFilter[]).map((value) => (
            <button
              key={value}
              className={cn("btn btn-sm join-item", { "btn-active": type === value })}
              onClick={() => changeType(value)}
            >
              {value === "all"
                ? t("adminTypeAll")
                : value === "text"
                  ? t("adminTypeText")
                  : t("adminTypeFile")}
            </button>
          ))}
        </div>

        <select
          className="select select-sm select-bordered"
          value={order}
          onChange={(e) => changeOrder(e.target.value as SortOrder)}
          aria-label={t("adminColTime")}
        >
          <option value="desc">{t("adminSortDesc")}</option>
          <option value="asc">{t("adminSortAsc")}</option>
        </select>

        <input
          className="input input-sm input-bordered w-full max-w-xs"
          placeholder={t("adminSearchPlaceholder")}
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSearch();
          }}
        />
        <button className="btn btn-sm" onClick={handleSearch}>
          {t("adminSearch")}
        </button>
        <button
          className="btn btn-sm btn-outline"
          disabled={deepLoading || searchInput.trim().length < 2}
          title={t("adminDeepSearchTip", { n: DEEP_SCAN_LIMIT })}
          onClick={handleDeepSearch}
        >
          {deepLoading ? t("adminDeepSearchRunning") : t("adminDeepSearch")}
        </button>
        {keyword && (
          <button className="btn btn-sm btn-ghost" onClick={clearSearch}>
            ✕
          </button>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
        <table className="table table-sm table-zebra">
          <thead>
            <tr>
              <th className="w-10">
                <input
                  type="checkbox"
                  className="checkbox checkbox-sm"
                  checked={allSelected}
                  onChange={toggleAll}
                  aria-label={t("adminSelectAll")}
                />
              </th>
              <th>{t("adminColType")}</th>
              <th>{t("adminColId")}</th>
              <th>{t("adminColSummary")}</th>
              <th>{t("adminColSize")}</th>
              <th>{t("adminColTime")}</th>
              <th>{t("adminColSource")}</th>
              <th className="text-right">{t("adminColActions")}</th>
            </tr>
          </thead>
          <tbody>
            {loading && !items.length && (
              <tr>
                <td colSpan={8} className="py-8 text-center text-gray-500">
                  {t("adminLoading")}
                </td>
              </tr>
            )}
            {!loading && !items.length && (
              <tr>
                <td colSpan={8} className="py-8 text-center text-gray-500">
                  {t("adminNoData")}
                </td>
              </tr>
            )}
            {items.map((item) => {
              const key = itemKey(item);
              const checked = selectedSet.has(key);
              return (
                <tr key={key} className={checked ? "bg-base-200" : undefined}>
                  <td>
                    <input
                      type="checkbox"
                      className="checkbox checkbox-sm"
                      checked={checked}
                      onChange={() => toggleOne(item)}
                    />
                  </td>
                  <td>
                    <span
                      className={cn(
                        "badge badge-sm",
                        item.type === "file" ? "badge-info" : "badge-ghost",
                      )}
                    >
                      {item.type === "file" ? t("adminTypeFile") : t("adminTypeText")}
                    </span>
                  </td>
                  <td>
                    <a
                      className="link-hover link font-mono text-xs"
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {item.id}
                    </a>
                    {item.has_password && (
                      <span className="badge badge-warning badge-xs ms-1">
                        {t("adminHasPassword")}
                      </span>
                    )}
                  </td>
                  <td
                    className="max-w-xs truncate"
                    title={item.type === "file" ? (item.name ?? "") : (item.preview ?? "")}
                  >
                    {item.type === "file" ? (
                      item.name ?? "-"
                    ) : item.preview ? (
                      item.preview
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap text-xs">{formatSize(item.size)}</td>
                  <td className="whitespace-nowrap text-xs">
                    {hasTime(item.create_time) ? (
                      formatTime(item.create_time)
                    ) : (
                      <span className="text-warning" title={t("adminUnknownTimeTip")}>
                        {t("adminUnknownTime")}
                      </span>
                    )}
                  </td>
                  <td className="max-w-[14rem] truncate text-xs">
                    <div className="font-mono">{item.ip ?? "-"}</div>
                    <div className="text-gray-400">{item.ua ?? ""}</div>
                  </td>
                  <td className="whitespace-nowrap text-right">
                    <button className="btn btn-xs" onClick={() => void openDetail(item)}>
                      {t("adminView")}
                    </button>
                    <button
                      className="btn btn-xs ms-1"
                      onClick={() => void handleCopy(item.url)}
                    >
                      {t("adminCopyLink")}
                    </button>
                    <button
                      className="btn btn-xs btn-error ms-1"
                      onClick={() =>
                        void removeItems(
                          [{ id: item.id, type: item.type }],
                          t("adminConfirmDeleteOne", { id: item.id }),
                        )
                      }
                    >
                      {t("adminDelete")}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {selected.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-red-400 p-3">
          <span className="text-sm">{t("adminSelectedCount", { n: selected.length })}</span>
          <button className="btn btn-sm btn-error" onClick={handleBatchDelete}>
            {t("adminDeleteSelected")}
          </button>
          <button className="btn btn-sm btn-ghost" onClick={() => setSelected([])}>
            {t("adminClearSelection")}
          </button>
        </div>
      )}

      {deepHits && (
        <div className="mt-4 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-semibold">
              {t("adminDeepSearch")}（{deepHits.length}）
            </h2>
            <button className="btn btn-xs btn-ghost" onClick={() => setDeepHits(null)}>
              {t("adminClose")}
            </button>
          </div>
          {deepHits.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">{t("adminNoData")}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {deepHits.map((hit) => (
                <li
                  key={itemKey(hit)}
                  className="rounded border border-gray-100 p-2 text-xs dark:border-gray-700"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <a
                      className="link-hover link font-mono"
                      href={hit.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {hit.id}
                    </a>
                    <span className="text-gray-400">
                      {hasTime(hit.create_time)
                        ? formatTime(hit.create_time)
                        : t("adminUnknownTime")}
                    </span>
                  </div>
                  <p className="mt-1 break-all text-gray-600 dark:text-gray-300">
                    {hit.snippet}
                  </p>
                  <div className="mt-1 flex gap-1">
                    <button className="btn btn-xs" onClick={() => void openDetail(hit)}>
                      {t("adminView")}
                    </button>
                    <button
                      className="btn btn-xs btn-error"
                      onClick={() =>
                        void removeItems(
                          [{ id: hit.id, type: hit.type }],
                          t("adminConfirmDeleteOne", { id: hit.id }),
                        )
                      }
                    >
                      {t("adminDelete")}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-gray-500 dark:text-gray-400">
          {t("adminPageInfo", { page: data?.page ?? 1, pageCount: totalPages })}
        </div>
        <div className="flex items-center gap-2">
          <select
            className="select select-sm select-bordered"
            value={pageSize}
            onChange={(e) => changePageSize(Number(e.target.value))}
            aria-label={t("adminPerPage")}
          >
            {PAGE_SIZE_OPTIONS.map((size) => (
              <option key={size} value={size}>
                {`${t("adminPerPage")} ${size}`}
              </option>
            ))}
          </select>
          <div className="join">
            <button
              className="btn btn-sm join-item"
              disabled={page <= 1}
              onClick={() => setPage((prev) => Math.max(1, prev - 1))}
            >
              {t("adminPrev")}
            </button>
            <button
              className="btn btn-sm join-item"
              disabled={page >= totalPages}
              onClick={() => setPage((prev) => prev + 1)}
            >
              {t("adminNext")}
            </button>
          </div>
        </div>
      </div>

      {(detailLoading || detail) && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
          onClick={() => {
            setDetail(null);
            setDetailLoading(false);
          }}
        >
          <div
            className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg bg-white shadow-xl dark:bg-gray-800"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
              <h2 className="font-semibold">{t("adminDetail")}</h2>
              <button className="btn btn-sm btn-ghost" onClick={() => setDetail(null)}>
                {t("adminClose")}
              </button>
            </div>
            <div className="flex-1 overflow-auto p-4">
              {detailLoading || !detail ? (
                <p className="text-gray-500 dark:text-gray-400">{t("adminLoading")}</p>
              ) : (
                <DetailBody detail={detail} onCopy={handleCopy} />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DetailBody({
  detail,
  onCopy,
}: {
  detail: AdminDetail;
  onCopy: (text: string) => void;
}) {
  const { t } = useTranslation();

  const rows: Array<[string, string]> = [
    [t("adminColType"), detail.type === "file" ? t("adminTypeFile") : t("adminTypeText")],
    ["ID", detail.id],
    [
      t("adminColTime"),
      hasTime(detail.create_time) ? formatTime(detail.create_time) : t("adminUnknownTime"),
    ],
    [t("adminColSource"), [detail.ip, detail.ua].filter(Boolean).join("  ") || "-"],
  ];

  if (detail.type === "file") {
    rows.push(
      [t("adminFileName"), detail.name],
      [t("adminColSize"), formatSize(detail.size)],
      ["MIME", detail.mimeType],
    );
  } else {
    rows.push([t("adminLanguage"), detail.language]);
    if (detail.has_password) rows.push([t("adminHasPassword"), "✓"]);
  }

  const raw = detail.type === "text" ? detail.content : "";
  const truncated = raw.length > DETAIL_RENDER_LIMIT;

  return (
    <div className="flex flex-col gap-3">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        {rows.map(([label, value]) => (
          <Fragment key={label}>
            <dt className="text-gray-500 dark:text-gray-400">{label}</dt>
            <dd className="break-all">{value}</dd>
          </Fragment>
        ))}
      </dl>

      <div className="flex flex-wrap gap-2">
        <button className="btn btn-sm" onClick={() => onCopy(detail.url)}>
          {t("adminCopyLink")}
        </button>
        {detail.type === "text" && (
          <button className="btn btn-sm" onClick={() => onCopy(detail.content)}>
            {t("adminCopyContent")}
          </button>
        )}
        <a
          className="btn btn-sm"
          href={detail.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          {t("adminOpen")}
        </a>
      </div>

      {detail.type === "text" && (
        /*
         * 用 <pre> 纯文本渲染。
         * 这里展示的是别人上传的内容，一旦当成 HTML 渲染就等于自己给自己种 XSS，
         * 所以无论内容长什么样都只能当纯文本看。
         */
        <pre className="max-h-[40vh] overflow-auto whitespace-pre-wrap break-all rounded-lg bg-gray-50 p-3 text-xs dark:bg-gray-900">
          {truncated ? raw.slice(0, DETAIL_RENDER_LIMIT) : raw}
        </pre>
      )}

      {truncated && (
        <p className="text-xs text-yellow-700 dark:text-yellow-300">
          {t("adminDetailTruncated", { n: DETAIL_RENDER_LIMIT })}
        </p>
      )}
    </div>
  );
}
