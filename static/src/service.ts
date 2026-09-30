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
