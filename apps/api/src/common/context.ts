import type { Request } from "express";

export type OrgRole = "org_admin" | "preparer" | "approver" | "viewer";
export type StaffRole =
  | "super_admin"
  | "credit_manager"
  | "compliance_officer"
  | "finance_officer"
  | "tokenisation_officer"
  | "analyst"
  | "external_expert"
  | "technical_expert"
  | "committee_member"
  | "fund_manager"
  | "auditor";

export interface AuthUser {
  id: string;
  sessionId: string;
  deviceId: string;
  mobile: string | null;
  email: string | null;
  shahkarStatus: "pending" | "verified" | "failed";
  staffRoles: StaffRole[];
}

export interface OrgContext {
  id: string;
  status: "active" | "frozen" | "closed";
  singleUserMode: boolean;
  memberId: string;
  role: OrgRole;
}

export interface AppRequest extends Request {
  id: string;
  user?: AuthUser;
  org?: OrgContext;
}

/** Common audit fields from a request. */
export const actor = (req: AppRequest) => ({
  actorUserId: req.user?.id ?? null,
  actorType: (req.user?.staffRoles.length ? "staff" : "user") as "user" | "staff",
  ip: req.ip ?? null,
  deviceId: req.user?.deviceId ?? null,
});
