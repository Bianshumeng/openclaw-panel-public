export async function requestJson(fetchImpl, url, options = {}) {
  const { allowBusinessError = false, ...fetchOptions } = options;
  const response = await fetchImpl(url, {
    headers: {
      "content-type": "application/json"
    },
    ...fetchOptions
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
