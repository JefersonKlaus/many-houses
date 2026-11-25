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

/** Sends one photo of a house: reduced to a JPEG of up to 1600 px (a phone photo becomes ~300 KB), then
 *  posted straight to the photo storage with the form the API signs. Returns the photo's id. */
interface PhotoUpload { id: string; upload: { url: string; fields: Record<string, string> } }

export async function uploadPhoto(houseId: string, file: File): Promise<string> {
  const jpeg = await toJpeg(file);
  const { id, upload } = await api<PhotoUpload>("POST", `/houses/${houseId}/photos`, {});
  const form = new FormData();
  for (const [name, value] of Object.entries(upload.fields)) form.append(name, value);
  form.append("file", jpeg, "foto.jpg");                    // the file goes last (S3 requires it)
  let response: Response;
  try { response = await fetch(upload.url, { method: "POST", body: form }); }
  catch { throw new Error("Não foi possível enviar a foto. Verifique a conexão."); }
  if (!response.ok) throw new Error("Não foi possível enviar a foto. Tente de novo.");
  return id;
}

const MAX_SIDE = 1600;

/** Any image the browser opens -> a JPEG of up to MAX_SIDE px on its longest side, upright (EXIF). */
async function toJpeg(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/")) throw new Error("Escolha uma imagem (foto).");
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file, { imageOrientation: "from-image" }); }
  catch { throw new Error("Não foi possível abrir essa imagem."); }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) => canvas.toBlob(
    (blob) => (blob ? resolve(blob) : reject(new Error("Não foi possível preparar a foto."))), "image/jpeg", 0.82));
}
