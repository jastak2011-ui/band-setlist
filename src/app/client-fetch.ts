"use client";

type RouterLike = {
  replace: (href: string) => void;
  refresh?: () => void;
};

async function readError(response: Response) {
  const text = await response.text();
  if (!text) return `Request failed (${response.status})`;
  try {
    const data = JSON.parse(text);
    return typeof data?.error === "string" ? data.error : JSON.stringify(data);
  } catch {
    return text;
  }
}

export async function readArrayResponse<T>(response: Response, router: RouterLike, label: string) {
  if (response.status === 401) {
    router.replace("/login");
    router.refresh?.();
    return [];
  }
  if (!response.ok) throw new Error(await readError(response));
  const data = await response.json().catch(() => null);
  if (!Array.isArray(data)) throw new Error(`${label} response was not a list.`);
  return data as T[];
}

export async function readObjectResponse<T>(response: Response, router: RouterLike, label: string) {
  if (response.status === 401) {
    router.replace("/login");
    router.refresh?.();
    return null;
  }
  if (!response.ok) throw new Error(await readError(response));
  const data = await response.json().catch(() => null);
  if (!data || Array.isArray(data) || typeof data !== "object") throw new Error(`${label} response was not valid.`);
  return data as T;
}

