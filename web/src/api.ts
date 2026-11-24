import { CONFIG } from "./config";
import { signOut, token } from "./auth";

/** Calls the API with the login token. Throws an Error with the server's message (in Portuguese). */
export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const jwt = await token();
  if (!jwt) { location.reload(); throw new Error("Sessão expirada."); }
  let response: Response;
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
  if (response.status === 204) return null as T;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Algo deu errado. Tente de novo.");
  return data as T;
}
