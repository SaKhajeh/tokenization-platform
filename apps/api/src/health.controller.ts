import { Controller, Get, Inject } from "@nestjs/common";
import { Public } from "./common/guards.js";
import { DB, Db } from "./db/db.js";

@Controller("health")
export class HealthController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Public()
  @Get()
  async health() {
    await this.db.query("select 1");
    return { status: "ok" };
  }
}
