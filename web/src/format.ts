// Values on screen (Brazilian format) and the small date math the screens need. Money is always integer cents.

export const formatMoney = (cents: number) =>
  (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** 123456 -> "1.234,56": how an amount is shown in a field, ready to be read back by toCents. */
export const centsToText = (cents: number) =>
  (cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "80,50", "1.200" or "R$ 1.200,00" -> integer cents; null if it is not an amount. */
export function toCents(text: string): number | null {
  const cleaned = String(text).trim().replace(/\s/g, "").replace("R$", "");
  if (!/^\d{1,3}(\.\d{3})*(,\d{1,2})?$|^\d+(,\d{1,2})?$/.test(cleaned)) return null;
  const [whole, cents = ""] = cleaned.replace(/\./g, "").split(",");
  return Number(whole) * 100 + Number(cents.padEnd(2, "0"));
}

/** A money field's cents, or throws with the field's name. */
export function money(text: string, label: string, required = true): number {
  if (!required && !text.trim()) return 0;
  const value = toCents(text);
  if (value === null) throw new Error(`${label}: informe um valor como 1.234,56`);
  return value;
}

/** "30", "12,5" or "12.5" -> 12.5; empty -> 0; null if it is not a percentage. */
export function toPercent(text: string): number | null {
  const cleaned = String(text).trim().replace("%", "").trim().replace(",", ".");
  if (cleaned === "") return 0;
  return /^\d{1,4}(\.\d{1,2})?$/.test(cleaned) ? Number(cleaned) : null;
}

/** 12.5 -> "12,5" */
export const percentText = (value: number) => value.toLocaleString("pt-BR", { maximumFractionDigits: 2 });

/** "37,5 %" */
export const percent = (part: number, whole: number) =>
  `${(whole ? (100 * part) / whole : 0).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} %`;

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

/** "20/11/2026" -> "2026-11-20"; "" if it is not a date that exists. */
export function parseDate(text: string): string {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(text).trim());
  if (!m) return "";
  const iso = `${m[3]}-${m[2]}-${m[1]}`;
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso ? iso : "";
}

/** What a date field holds ("dd/mm/aaaa") as the API wants it; throws with the field's name if it is not a
 *  date ("" when it is empty and not required). */
export function dateValue(text: string, label: string, required = true): string {
  if (!required && !text.trim()) return "";
  const iso = parseDate(text);
  if (!iso) throw new Error(`${label}: informe a data como dd/mm/aaaa`);
  return iso;
}

/** Today in Brasília (UTC-3 all year), "YYYY-MM-DD", whatever the device's time zone. */
export const today = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);

/** "2026-01-31" -> "2026-02-28": a month later, the same day or the month's last day (like the backend). */
export function addMonth(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "";
  const [y, m, d] = iso.split("-").map(Number);
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(d, last))).toISOString().slice(0, 10);
}

/** "2026-11" + 2 -> "2027-01" */
export function shiftMonth(ym: string, n: number): string {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
}

/** "2026-11" -> "novembro de 2026" */
export function monthName(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });
}

/** "11/2026"-like mask while typing a date: the digits typed become "dd/mm/aaaa". */
export function maskDate(text: string): string {
  const d = text.replace(/\D/g, "").slice(0, 8);
  return d.length > 4 ? `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}` : d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
}

export const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
