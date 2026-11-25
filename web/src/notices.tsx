// The number beside "Avisos" in the menu: the invites waiting plus what is due (each house's `due_soon`).
// Screens report what they already loaded, so the number stays right without extra requests.
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { HouseSummary, PendingInvite } from "./types";

export interface Report { houses?: HouseSummary[]; invites?: PendingInvite[]; house?: { id: string; due_soon: unknown[] } }
interface Notices { count: number; report: (r: Report) => void }

const NoticesContext = createContext<Notices>({ count: 0, report: () => {} });

export function NoticesProvider({ children }: { children: ReactNode }) {
  const [byHouse, setByHouse] = useState<Map<string, number>>(new Map());
  const [invites, setInvites] = useState(0);
  const report = useCallback(({ houses, invites, house }: Report) => {
    if (houses) setByHouse(new Map(houses.map((x) => [x.id, (x.due_soon || []).length])));
    if (invites) setInvites(invites.length);
    if (house) setByHouse((m) => new Map(m).set(house.id, house.due_soon.length));
  }, []);
  const count = invites + [...byHouse.values()].reduce((a, b) => a + b, 0);
  const value = useMemo(() => ({ count, report }), [count, report]);
  return <NoticesContext.Provider value={value}>{children}</NoticesContext.Provider>;
}

export const useNotices = () => useContext(NoticesContext);
