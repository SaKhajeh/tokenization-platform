"use client";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useApi, useSessionState } from "@tp/client/react";

export interface Staff { id: string; mobile: string | null; full_name: string | null; staff_roles: string[] }
const Ctx = createContext<{ me: Staff | null; loading: boolean; has: (...roles: string[]) => boolean }>({ me: null, loading: true, has: () => false });
export const useStaff = () => useContext(Ctx);

export function StaffProvider({ children }: { children: ReactNode }) {
  const api = useApi();
  const session = useSessionState(api);
  const [me, setMe] = useState<Staff | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    if (!api.signedIn) { setMe(null); setLoading(false); return; }
    try { setMe(await api.get<Staff>("/me")); } catch { /* signed out on 401 */ } finally { setLoading(false); }
  }, [api]);
  useEffect(() => { void load(); }, [load, session]);
  const has = (...roles: string[]) => !!me && roles.some((r) => me.staff_roles.includes(r));
  return <Ctx.Provider value={{ me, loading, has }}>{children}</Ctx.Provider>;
}
