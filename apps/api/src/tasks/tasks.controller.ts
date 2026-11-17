import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { TasksService } from "./tasks.service.js";
import { OrgRoute, Req } from "../common/guards.js";
import { Idempotent } from "../common/idempotency.js";
import type { AppRequest } from "../common/context.js";
import { parse, zIsoDate, zUuid } from "../common/zod.js";

const zStatus = z.enum(["open", "in_progress", "done", "cancelled"]);
const zRole = z.enum(["org_admin", "preparer", "approver", "viewer"]);

@Controller("tasks")
@OrgRoute()
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get()
  list(@Req() req: AppRequest, @Query() query: unknown) {
    const f = parse(z.object({ scope: z.enum(["mine", "role", "created", "all"]).default("all"), status: zStatus.optional() }), query);
    return this.tasks.list(req, f);
  }

  @Post()
  @Idempotent()
  create(@Req() req: AppRequest, @Body() body: unknown) {
    const b = parse(
      z.object({
        title: z.string().trim().min(3).max(200),
        description: z.string().max(5000).optional(),
        linked_type: z.string().max(40).optional(),
        linked_id: z.string().max(80).optional(),
        assignee_user_id: zUuid.optional(),
        assignee_role: zRole.optional(),
        due_date: zIsoDate.optional(),
        priority: z.enum(["p0", "p1", "p2"]).optional(),
      }),
      body,
    );
    return this.tasks.create(req, b);
  }

  @Get(":id")
  get(@Req() req: AppRequest, @Param("id") id: string) {
    return this.tasks.get(req, parse(zUuid, id));
  }

  @Patch(":id")
  update(@Req() req: AppRequest, @Param("id") id: string, @Body() body: unknown) {
    const b = parse(
      z.object({ status: zStatus.optional(), assignee_user_id: zUuid.nullable().optional(), assignee_role: zRole.nullable().optional(), due_date: zIsoDate.nullable().optional() }),
      body,
    );
    return this.tasks.update(req, parse(zUuid, id), b);
  }

  @Get(":id/comments")
  comments(@Req() req: AppRequest, @Param("id") id: string) {
    return this.tasks.comments(req, parse(zUuid, id));
  }

  @Post(":id/comments")
  @Idempotent()
  comment(@Req() req: AppRequest, @Param("id") id: string, @Body() body: unknown) {
    const b = parse(z.object({ body: z.string().trim().min(1).max(5000), attachment_doc_ids: z.array(zUuid).max(10).optional() }), body);
    return this.tasks.addComment(req, parse(zUuid, id), b);
  }
}
