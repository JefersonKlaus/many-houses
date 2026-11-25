// What the API answers (backend/core/houses_core): money is always integer cents, dates "YYYY-MM-DD".

export type Status = "renovating" | "ready" | "sold";
export type Category = "material" | "labor" | "services" | "project" | "other" | "recurring";

export interface DueItem {
  house_id: string;
  house_name: string;
  type: "installment" | "recurring";
  name: string;
  due_date: string;
  days: number;               // until the due date; negative: late
  amount_cents: number;
}

export interface Area { id: string; name: string }
export interface Invite { id: string; phone: string; date: string }
export interface RecurringBill { id?: string; name: string; day: number; since?: string; until?: string }

export interface House {
  id: string;
  name: string;
  address: string;
  purchase_date: string;
  purchase_price_cents: number;
  purchase_costs_cents: number;
  status: Status;
  notes: string;
  down_payment_cents: number;
  payment_type: "cash" | "installments";
  target_profit_percent: number;
  areas: Area[];
  partners: { id: string; name: string; phone: string }[];
  invites: Invite[];
  bundle_id: string;
  recurring_bills: RecurringBill[];
}

export interface Payment {
  down_payment_cents: number;
  installments_count: number;
  paid_count: number;
  paid_cents: number;
  open_cents: number;
  next_due_date: string | null;
  total_paid_cents: number;
}

export interface MemberTotals {
  member_id: string;
  purchase_cents: number;
  installments_cents: number;
  renovation_cents: number;
  recurring_cents: number;
  total_cents: number;
}

export interface Totals {
  purchase_cents: number;
  renovation_cents: number;
  recurring_cents: number;
  recurring_count: number;
  total_cents: number;
  expense_count: number;
  by_category: Record<string, number>;
  by_area: { id: string; name: string; cents: number; count: number }[];
  no_area_cents: number;
  payment: Payment;
  sale: { target_profit_percent: number; target_profit_cents: number; suggested_price_cents: number };
  by_member: MemberTotals[];
}

export interface HouseSummary extends House {
  role: "owner" | "partner";
  totals: Totals;
  due_soon: DueItem[];
}

export interface Expense {
  id: string;
  date: string;
  category: Category;
  description: string;
  amount_cents: number;
  supplier: string;
  area_id: string;
  paid_by: string;
  nf_photo: string;
  material_photo: string;
  nf_photo_url: string;
  material_photo_url: string;
  reference: string;
}

export interface Installment {
  id: string;
  due_date: string;
  amount_cents: number;
  paid_date: string;
  paid_by: string;
  group_id: string;
  total_cents: number;
}

export interface TimelineEntry { id: string; date: string; caption: string; photos: string[]; photo_urls: string[] }
export interface Member { id: string; name: string; phone: string; role: "owner" | "partner" | "invited" }
export interface BundleHouse { id: string; name: string; price_cents: number; percent: number }

/** One house's page: GET /houses/{id}, and the answer of every change to it. */
export interface HouseView {
  house: House;
  members: Member[];
  bundle: BundleHouse[];
  me: string;
  role: "owner" | "partner";
  expenses: Expense[];
  installments: Installment[];
  due_soon: DueItem[];
  timeline: TimelineEntry[];
  totals: Totals;
}

export interface PendingInvite {
  id: string;
  house_id: string;
  house_name: string;
  from_phone: string;
  from_name: string;
  date: string;
}

export interface Settings { name: string; phone: string; email: string; default_profit_percent: number }
