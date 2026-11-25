/**
 * Local development only: stands in for MinIO when STORAGE_PROVIDER=memory, so the apps can upload and open files.
 * Registered only when APP_ENV=development and the storage is in memory (see app.module.ts); never in staging/prod.
 */
import { Controller, Get, Inject, Param, Put, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { Public } from "./common/guards.js";
import { MemoryStorage, STORAGE } from "./integrations/providers.js";

@Controller("dev/storage")
export class DevStorageController {
  constructor(@Inject(STORAGE) private readonly storage: MemoryStorage) {}

  @Public()
  @Put(":key")
  async upload(@Param("key") key: string, @Req() req: Request, @Res() res: Response) {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(Buffer.from(c));
    this.storage.putBytes(Buffer.from(key, "base64url").toString(), Buffer.concat(chunks), String(req.headers["content-type"] ?? "application/octet-stream"));
    res.status(200).end();
  }

  @Public()
  @Get(":key")
  download(@Param("key") key: string, @Res() res: Response) {
    const o = this.storage.bytes.get(Buffer.from(key, "base64url").toString());
    if (!o) return res.status(404).end();
    res.setHeader("content-type", o.mime);
    res.send(o.data);
  }
}
