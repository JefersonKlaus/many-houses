// How values are shown (Brazilian format). Ported from frontend/js/util.js as the screens move over.

export const formatMoney = (cents: number) =>
  (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** "+5511987654321" -> "(11) 98765-4321" (and a 10-digit landline: "(11) 3456-7890"). */
export function formatPhone(phone?: string): string {
  const d = String(phone || "").replace(/^\+55/, "");
  if (!/^\d{10,11}$/.test(d)) return phone || "";
  return `(${d.slice(0, 2)}) ${d.slice(2, d.length - 4)}-${d.slice(-4)}`;
}

/** "2026-11-20" -> "20/11/2026". */
export function formatDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso || "";
}
