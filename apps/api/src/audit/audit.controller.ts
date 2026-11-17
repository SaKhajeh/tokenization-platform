import { Controller, Get, Query } from "@nestjs/common";
import { z } from "zod";
import { AuditService } from "./audit.service.js";
import { StaffOnly } from "../common/guards.js";
import { parse, zUuid } from "../common/zod.js";

@Controller("admin/audit")
@StaffOnly("auditor", "super_admin")
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  list(@Query() query: unknown) {
    const f = parse(
      z.object({ entity_type: z.string().max(40).optional(), entity_id: z.string().max(80).optional(), org_id: zUuid.optional(), limit: z.coerce.number().int().min(1).max(200).optional() }),
      query,
    );
    return this.audit.list({ entityType: f.entity_type, entityId: f.entity_id, orgId: f.org_id, limit: f.limit });
  }

  @Get("verify")
  verify() {
    return this.audit.verify();
  }
}
