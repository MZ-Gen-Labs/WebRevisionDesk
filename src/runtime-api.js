function bytesToBase64(bytes) {
  let binary = "";
  const view = new Uint8Array(bytes);
  for (let index = 0; index < view.length; index += 0x8000) {
    binary += String.fromCharCode(...view.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value || "");
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/**
 * Uses Electron IPC for local application APIs and ordinary fetch in browser mode.
 * Returning a real Response keeps the editor independent from its host runtime.
 */
export async function appFetch(input, init = {}) {
  const url = typeof input === "string" ? input : input.url;
  const desktop = globalThis.webRevisionDesktop;
  if (!desktop?.request || !url.startsWith("/api/")) return fetch(input, init);

  const headers = Object.fromEntries(new Headers(init.headers || {}).entries());
  let bodyBase64 = "";
  if (typeof init.body === "string") bodyBase64 = bytesToBase64(new TextEncoder().encode(init.body));
  else if (init.body) bodyBase64 = bytesToBase64(await new Response(init.body).arrayBuffer());
  const result = await desktop.request({
    url,
    method: init.method || "GET",
    headers,
    bodyBase64,
  });
  return new Response(base64ToBytes(result.bodyBase64), {
    status: result.status,
    headers: result.headers,
  });
}

