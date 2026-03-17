function shouldJsonStringifyBody(body) {
  if (body === null || body === undefined) {
    return false;
  }
  if (typeof body === "string") {
    return false;
  }
  if (typeof FormData !== "undefined" && body instanceof FormData) {
    return false;
  }
  if (typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams) {
    return false;
  }
  if (typeof Blob !== "undefined" && body instanceof Blob) {
    return false;
  }
  if (typeof ArrayBuffer !== "undefined" && (body instanceof ArrayBuffer || ArrayBuffer.isView(body))) {
    return false;
  }
  return typeof body === "object";
}

export async function requestJson(fetchImpl, url, options = {}) {
  const { allowBusinessError = false, ...fetchOptions } = options;
  const headers = new Headers(fetchOptions.headers || {});
  const normalizedBody = shouldJsonStringifyBody(fetchOptions.body) ? JSON.stringify(fetchOptions.body) : fetchOptions.body;
  const hasBody = normalizedBody !== undefined && normalizedBody !== null;
  if (hasBody && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const response = await fetchImpl(url, {
    ...fetchOptions,
    body: normalizedBody,
    headers
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`响应解析失败 (HTTP ${response.status})`);
  }

  if (!response.ok) {
    throw new Error(payload?.message || `请求失败 (HTTP ${response.status})`);
  }

  if (!allowBusinessError && payload?.ok === false) {
    throw new Error(payload.message || "请求失败");
  }

  return payload;
}
