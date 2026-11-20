import { CONFIG } from "./config.js";
import { signOut, token } from "./auth.js";

/** Calls the API with the login token. Throws an Error with the server's message (in Portuguese). */
export async function api(method, path, body) {
  const jwt = await token();
  if (!jwt) { location.reload(); throw new Error("Sessão expirada."); }
  let response;
  try {
    response = await fetch(CONFIG.apiUrl.replace(/\/$/, "") + path, {
      method,
      headers: { Authorization: `Bearer ${jwt}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error("Sem conexão com o servidor.");
  }
  if (response.status === 401 && !CONFIG.skipLogin) { signOut(); location.reload(); throw new Error("Sessão expirada."); }
  if (response.status === 204) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Algo deu errado. Tente de novo.");
  return data;
}
