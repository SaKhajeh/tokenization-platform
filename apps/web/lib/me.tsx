"use client";
/**
 * The signed-in user, their organisations and the active one (X-Org-Id).
 * Pages read `useMe()`; after a change that affects them (KYB submitted, org created) they call `reload()`.
 */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useApi, useSessionState } from "@tp/client/react";

export interface OrgSummary { id: string; legal_name: string; national_id: string; kyb_status: string; is_investor: boolean; is_issuer: boolean; is_applicant: boolean; org_kind: string; role: string }
export interface Me { id: string; mobile: string | null; email: string | null; full_name: string | null; shahkar_status: "pending" | "verified" | "failed"; national_code_masked: string | null; staff_roles: string[]; organisations: OrgSummary[] }
export interface Org { id: string; legal_name: string; national_id: string; kyb_status: string; kyb_expires_at: string | null; is_applicant: boolean; org_kind: string; single_user_mode: boolean; status: string; my_role: string; active_members: number; requires_second_approver: boolean }

interface Ctx { me: Me | null; org: Org | null; loading: boolean; failed: string | null; reload: () => Promise<void>; switchOrg: (id: string) => void }
const MeCtx = createContext<Ctx>({ me: null, org: null, loading: true, failed: null, reload: async () => {}, switchOrg: () => {} });
export const useMe = () => useContext(MeCtx);

export function MeProvider({ children }: { children: ReactNode }) {
  const api = useApi();
  const session = useSessionState(api);
  const [me, setMe] = useState<Me | null>(null);
  const [org, setOrg] = useState<Org | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState<string | null>(null); // the server could not be reached or failed: say so, never spin forever

  const reload = useCallback(async () => {
    if (!api.signedIn) { setMe(null); setOrg(null); setLoading(false); return; }
    setFailed(null);
    try {
      const m = await api.get<Me>("/me");
      setMe(m);
      // keep the active org if still a member, else the first one
      const active = m.organisations.find((o) => o.id === api.orgId) ?? m.organisations[0] ?? null;
      if ((active?.id ?? null) !== api.orgId) api.setOrg(active?.id ?? null);
      setOrg(active ? await api.get<Org>("/orgs/current") : null);
    } catch (e: any) {
      // a 401 has already signed us out; anything else is shown with a retry
      if (e?.status !== 401) setFailed(e?.messageFa ?? "ارتباط با سرور برقرار نشد.");
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => { void reload(); }, [reload, session]);

  const switchOrg = (id: string) => { api.setOrg(id); };
  return <MeCtx.Provider value={{ me, org, loading, failed, reload, switchOrg }}>{children}</MeCtx.Provider>;
}
