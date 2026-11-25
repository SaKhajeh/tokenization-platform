import { CanActivate, ExecutionContext, Inject, Injectable, SetMetadata, createParamDecorator } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { jwtVerify } from "jose";
import { DB, type Db } from "../db/db.js";
import { CONFIG } from "./tokens.js";
import type { AppConfig } from "../config.js";
import { ApiError, Errors } from "./errors.js";
import { UUID_RE } from "./ids.js";
import type { AppRequest, OrgRole, StaffRole } from "./context.js";

export const PUBLIC = "tp:public";
export const ORG_ROLES = "tp:orgRoles";
export const STAFF_ROLES = "tp:staffRoles";
export const NEEDS_ORG = "tp:needsOrg";

/** Route needs no login. */
export const Public = () => SetMetadata(PUBLIC, true);
/** Route runs in the active org (X-Org-Id) and requires one of these member roles (empty = any active member). */
export const OrgRoute = (...roles: OrgRole[]) => SetMetadata(ORG_ROLES, roles);
/** Route requires one of these staff roles. */
export const StaffOnly = (...roles: StaffRole[]) => SetMetadata(STAFF_ROLES, roles);

export const Req = createParamDecorator((_: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest<AppRequest>());

/**
 * One global guard, in order: authentication → staff roles → org membership/roles.
 * Org scoping lives here so no controller can forget it.
 */
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(DB) private readonly db: Db,
    @Inject(CONFIG) private readonly cfg: AppConfig,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC, targets)) return true;
    const req = ctx.switchToHttp().getRequest<AppRequest>();

    // ---- authentication: bearer JWT + live session + active user + device not revoked
    const auth = req.headers.authorization;
    if (!auth?.startsWith("Bearer ")) throw Errors.unauthenticated();
    let claims: { sub?: string; sid?: string; did?: string };
    try {
      claims = (await jwtVerify(auth.slice(7), this.cfg.jwtSecret, { algorithms: ["HS256"], issuer: "tp-api" })).payload as any;
    } catch {
      throw Errors.unauthenticated();
    }
    const { rows } = await this.db.query(
      `select u.id, u.mobile, u.email, u.shahkar_status, u.status, s.revoked_at, s.expires_at, d.revoked_at as device_revoked_at,
              coalesce((select array_agg(role) from staff_roles r where r.user_id = u.id and r.revoked_at is null), '{}') as staff_roles
       from sessions s join users u on u.id = s.user_id join user_devices d on d.id = s.device_id
       where s.id = $1 and u.id = $2`,
      [claims.sid, claims.sub],
    );
    const r = rows[0];
    if (!r || r.revoked_at || r.device_revoked_at || new Date(r.expires_at) < new Date() || r.status !== "active") throw Errors.unauthenticated();
    req.user = {
      id: r.id,
      sessionId: claims.sid!,
      deviceId: claims.did!,
      mobile: r.mobile,
      email: r.email,
      shahkarStatus: r.shahkar_status,
      staffRoles: r.staff_roles ?? [],
    };

    // ---- staff routes
    const staff = this.reflector.getAllAndOverride<StaffRole[] | undefined>(STAFF_ROLES, targets);
    if (staff) {
      if (!req.user.staffRoles.some((x) => staff.includes(x))) throw Errors.forbidden("Staff role required");
    }

    // ---- org routes
    const orgRoles = this.reflector.getAllAndOverride<OrgRole[] | undefined>(ORG_ROLES, targets);
    if (orgRoles) {
      const orgId = req.headers["x-org-id"];
      if (typeof orgId !== "string" || !UUID_RE.test(orgId))
        throw new ApiError(400, "ORG_HEADER_REQUIRED", "X-Org-Id header required", "سازمان فعال مشخص نشده است.");
      const m = await this.db.query(
        `select m.id as member_id, m.role, o.status, o.single_user_mode
         from org_members m join orgs o on o.id = m.org_id
         where m.org_id = $1 and m.user_id = $2 and m.status = 'active'`,
        [orgId, req.user.id],
      );
      const row = m.rows[0];
      // Not a member → 404, so org IDs cannot be probed.
      if (!row || row.status === "closed") throw Errors.notFound("Organisation");
      req.org = { id: orgId, status: row.status, singleUserMode: row.single_user_mode, memberId: row.member_id, role: row.role };
      if (orgRoles.length && !orgRoles.includes(row.role))
        throw new ApiError(403, "ORG_ROLE_REQUIRED", `Requires role: ${orgRoles.join(" | ")}`, "نقش شما در سازمان اجازه این کار را نمی‌دهد.");
    }
    return true;
  }
}
