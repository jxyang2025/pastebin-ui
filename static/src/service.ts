const API_URL = String(import.meta.env.VITE_API_URL ?? "")
  .trim()
  .replace(/\/+$/, "");

export class ApiError extends Error {
  code: number;

  constructor(message: string, code: number) {
    super(message);
    this.name = "ApiError";
    this.code = code;
  }
}

export interface PasteData {
  content: string;
  url: string;
  language: string;
  create_time?: number;
  has_password?: boolean;
}

export interface CreateResult {
  id: string;
  url: string;
  language: string;
  expire: number;
  create_time: number;
  has_password: boolean;
  /** 仅创建时返回一次，之后服务端只保留哈希 */
  share_password?: string;
}

export interface UploadResult {
  id: string;
  url: string;
}

/**
 * 统一请求封装：把「网络异常 / 非 JSON 响应 / 业务错误」都收敛成 ApiError，
 * 避免调用方拿到 undefined 之后再各自崩一次。
 */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, init);
  } catch {
    throw new ApiError("Network error, please retry", 0);
  }

  const raw = await res.text();
  let data: any = null;
  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      data = null;
    }
  }

  if (data && typeof data === "object") {
    if (data.error) {
      throw new ApiError(String(data.error), Number(data.code) || res.status);
    }
    return data as T;
  }

  if (!res.ok) {
    throw new ApiError(`HTTP ${res.status}`, res.status);
  }
  return (data ?? {}) as T;
}

export function createPaste(body: Record<string, unknown>) {
  return request<CreateResult>("/api/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function getPaste(id: string, sharePassword?: string | null) {
  const query = new URLSearchParams({ id });
  if (sharePassword) query.set("share_password", sharePassword);
  return request<PasteData>(`/api/get?${query.toString()}`);
}

export function uploadFile(file: File) {
  const formData = new FormData();
  formData.append("file", file);
  return request<UploadResult>("/api/upload", { method: "POST", body: formData });
}

// ---------------------------------------------------------------------------
// 管理后台
// ---------------------------------------------------------------------------

export interface AdminItem {
  id: string;
  type: "text" | "file";
  /** 上传时间；老数据没有该字段时为 null，界面上排在最后 */
  create_time: number | null;
  url: string;
  expiration?: number;
  language?: string;
  has_password?: boolean;
  name?: string;
  mimeType?: string;
  size?: number | null;
  preview?: string;
  ip?: string;
  ua?: string;
}

export interface AdminListResult {
  items: AdminItem[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  textCount: number;
  fileCount: number;
  unknownTime: number;
  truncated: boolean;
}

export interface AdminTextDetail {
  type: "text";
  id: string;
  content: string;
  language: string;
  has_password: boolean;
  create_time: number | null;
  ip?: string;
  ua?: string;
  url: string;
}

export interface AdminFileDetail {
  type: "file";
  id: string;
  name: string;
  mimeType: string;
  size: number;
  create_time: number | null;
  ip?: string;
  ua?: string;
  url: string;
}

export type AdminDetail = AdminTextDetail | AdminFileDetail;

export interface AdminDeleteResult {
  deleted: number;
  failed: number;
  results: Array<{ id: string; type: string; ok: boolean; error?: string }>;
}

export interface AdminSearchHit extends AdminItem {
  snippet: string;
}

export interface AdminSearchResult {
  items: AdminSearchHit[];
  scanned: number;
  truncated: boolean;
  scanLimit: number;
}

/** 管理接口一律用 x-admin-token 传口令；它是自定义头，会连带挡住 CSRF */
function adminInit(token: string, init?: RequestInit): RequestInit {
  return {
    ...init,
    headers: {
      ...((init?.headers as Record<string, string> | undefined) ?? {}),
      "x-admin-token": token,
    },
  };
}

export function adminList(
  token: string,
  params: {
    type?: string;
    keyword?: string;
    order?: string;
    page?: number;
    pageSize?: number;
  },
) {
  const query = new URLSearchParams();
  if (params.type) query.set("type", params.type);
  if (params.keyword) query.set("keyword", params.keyword);
  if (params.order) query.set("order", params.order);
  query.set("page", String(params.page ?? 1));
  query.set("pageSize", String(params.pageSize ?? 20));
  return request<AdminListResult>(`/api/admin/list?${query.toString()}`, adminInit(token));
}

export function adminContent(token: string, id: string, type: "text" | "file") {
  const query = new URLSearchParams({ id, type });
  return request<AdminDetail>(`/api/admin/content?${query.toString()}`, adminInit(token));
}

export function adminDelete(
  token: string,
  items: Array<{ id: string; type: "text" | "file" }>,
) {
  return request<AdminDeleteResult>("/api/admin/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-admin-token": token },
    body: JSON.stringify({ items }),
  });
}

export function adminSearch(token: string, keyword: string, limit = 30) {
  const query = new URLSearchParams({ keyword, limit: String(limit) });
  return request<AdminSearchResult>(
    `/api/admin/search?${query.toString()}`,
    adminInit(token),
  );
}
