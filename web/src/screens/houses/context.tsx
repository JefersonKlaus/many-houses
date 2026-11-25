// What every piece of a house's page needs: the page the API answered, `show(view)` to draw a new one (each
// change answers the whole page: one request per change, never two), who the members are, and the dialogs.
import { createContext, useContext, type ReactNode } from "react";
import { formatPhone } from "../../format";
import type { HouseView, Member } from "../../types";

export interface HouseContext {
  view: HouseView;
  show: (view: HouseView) => void;
  openDialog: (node: ReactNode) => void;
  closeDialog: () => void;
  viewPhoto: (url: string, title: string) => void;
  /** "Você", the partner's name, or their phone when their login has no name. */
  memberName: (id: string) => string;
  shared: boolean;
}

const Context = createContext<HouseContext | null>(null);
export const HouseProvider = Context.Provider;
export const useHouse = () => useContext(Context)!;

export function memberNamer(members: Member[], me: string, role: string) {
  return (id: string) => {
    if (id === me || (!id && role === "owner")) return "Você";
    const member = members.find((m) => m.id === (id || members[0]?.id));
    return member ? member.name || formatPhone(member.phone) || "Sócio" : "";
  };
}

// The API's codes, in the order the screen shows them (backend/core/houses_core/domain/models.py).
export const STATUS: Record<string, string> = { renovating: "Em reforma", ready: "Pronta", sold: "Vendida" };
export const CATEGORIES: Record<string, string> = { material: "Material", labor: "Mão de obra", services: "Serviços",
  project: "Projeto e documentação", other: "Outros" };

export const Badge = ({ status }: { status: string }) => <span className={`badge status-${status}`}>{STATUS[status] || status}</span>;
