// What the API answers (backend/core/houses_core): money is always integer cents, dates "YYYY-MM-DD".

export interface DueItem {
  house_id: string;
  house_name: string;
  type: "installment" | "recurring";
  name: string;
  due_date: string;
  days: number;               // until the due date; negative: late
  amount_cents: number;
}

export interface HouseSummary {
  id: string;
  name: string;
  address: string;
  status: "renovating" | "ready" | "sold";
  role: "owner" | "partner";
  due_soon: DueItem[];
}

export interface PendingInvite {
  id: string;
  house_id: string;
  house_name: string;
  from_phone: string;
  from_name: string;
  date: string;
}
