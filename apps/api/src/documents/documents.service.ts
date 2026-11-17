import { Inject, Injectable } from "@nestjs/common";
import { DB, Db } from "../db/db.js";
import { CONFIG } from "../common/tokens.js";
import type { AppConfig } from "../config.js";
import { ApiError, Errors } from "../common/errors.js";
import { uuidv7 } from "../common/ids.js";
import { AuditService } from "../audit/audit.service.js";
import { ObjectStorage, STORAGE } from "../integrations/providers.js";
import { actor, AppRequest } from "../common/context.js";

/** plan/07 §6a: PDF, JPEG, PNG, HEIC (phone camera), Word and Excel (shown in the viewer as PDF; the original is kept). */
export const ALLOWED_MIME = [
  "application/pdf", "image/jpeg", "image/png", "image/heic", "image/heif",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
] as const;

const E = {
  mime: () => new ApiError(400, "FILE_TYPE_NOT_ALLOWED", "Accepted: PDF, JPEG, PNG, HEIC, DOCX, XLSX", "فقط فایل PDF، تصویر (JPEG، PNG، HEIC)، Word یا Excel پذیرفته می‌شود."),
  size: (max: number) => new ApiError(400, "FILE_TOO_LARGE", `Max ${max} bytes`, "حجم فایل بیش از حد مجاز است.", { max_bytes: max }),
  notUploaded: () => new ApiError(409, "UPLOAD_NOT_FOUND", "The file has not been uploaded yet", "فایل هنوز بارگذاری نشده است."),
  sizeMismatch: () => new ApiError(409, "UPLOAD_SIZE_MISMATCH", "Uploaded size differs from the declared size", "حجم فایل بارگذاری‌شده با مقدار اعلام‌شده یکسان نیست."),
  notReady: () => new ApiError(409, "DOCUMENT_NOT_READY", "Document upload is not complete", "بارگذاری سند کامل نشده است."),
};

/**
 * Documents (FR-DOC-1..4). M-A covers organisation-owned files:
 *   owner_org — members of the owning org + any staff
 *   internal  — staff only
 *   public    — any logged-in user
 * Series-level levels (verified_investors, series_holders, …) arrive with the offering module.
 */
@Injectable()
export class DocumentsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CONFIG) private readonly cfg: AppConfig,
    @Inject(STORAGE) private readonly storage: ObjectStorage,
    private readonly audit: AuditService,
  ) {}

  async createUpload(req: AppRequest, input: { category: string; filename: string; mime: string; size: number }) {
    if (!(ALLOWED_MIME as readonly string[]).includes(input.mime)) throw E.mime();
    if (input.size > this.cfg.documentMaxBytes) throw E.size(this.cfg.documentMaxBytes);
    if (req.org!.role === "viewer") throw Errors.forbidden("Viewers cannot upload documents");
    const id = uuidv7();
    const key = `orgs/${req.org!.id}/${id}`;
    await this.db.tx(async (q) => {
      await q.query(
        `insert into documents (id, owner_type, owner_id, org_id, category, access_level, filename, mime, size_bytes, storage_key, uploaded_by)
         values ($1,'org',$2,$2,$3,'owner_org',$4,$5,$6,$7,$8)`,
        [id, req.org!.id, input.category, input.filename, input.mime, input.size, key, req.user!.id],
      );
      await this.audit.append(q, { ...actor(req), orgId: req.org!.id, action: "document.upload_started", entityType: "document", entityId: id, after: { category: input.category, filename: input.filename, size: input.size } });
    });
    const url = await this.storage.presignPut(key, input.mime, input.size, this.cfg.documentUrlTtlSec);
    return { document_id: id, upload_url: url, method: "PUT", headers: { "content-type": input.mime }, expires_in: this.cfg.documentUrlTtlSec };
  }

  /** The client reports the SHA-256 it computed; we confirm the object exists with the declared size. */
  async complete(req: AppRequest, id: string, sha256: string) {
    return this.db.tx(async (q) => {
      const d = (await q.query(`select * from documents where id = $1 and org_id = $2 for update`, [id, req.org!.id])).rows[0];
      if (!d) throw Errors.notFound("Document");
      if (d.status === "uploaded") return this.publicDoc(d); // idempotent
      const head = await this.storage.head(d.storage_key);
      if (!head) throw E.notUploaded();
      if (head.size !== Number(d.size_bytes)) throw E.sizeMismatch();
      const row = (await q.query(`update documents set status = 'uploaded', sha256 = $2, uploaded_at = now() where id = $1 returning *`, [id, sha256])).rows[0];
      await this.audit.append(q, { ...actor(req), orgId: req.org!.id, action: "document.uploaded", entityType: "document", entityId: id, after: { sha256 } });
      return this.publicDoc(row);
    });
  }

  private canAccess(req: AppRequest, d: any, memberOrgIds: string[]): boolean {
    const staff = req.user!.staffRoles.length > 0;
    switch (d.access_level) {
      case "public":
        return true;
      case "owner_org":
        return staff || memberOrgIds.includes(d.org_id);
      case "internal":
        return staff;
      default:
        return staff; // series-level rules come with the offering module; until then staff only
    }
  }

  private async load(req: AppRequest, id: string) {
    const d = (await this.db.query(`select * from documents where id = $1`, [id])).rows[0];
    const orgs = (await this.db.query(`select org_id from org_members where user_id = $1 and status = 'active'`, [req.user!.id])).rows.map((r) => r.org_id);
    // 404 (not 403) for documents you cannot see, so IDs cannot be probed.
    if (!d || !this.canAccess(req, d, orgs)) throw Errors.notFound("Document");
    return d;
  }

  publicDoc(d: any) {
    return {
      id: d.id, category: d.category, access_level: d.access_level, filename: d.filename, mime: d.mime,
      size_bytes: Number(d.size_bytes), sha256: d.sha256, status: d.status, org_id: d.org_id, uploaded_at: d.uploaded_at, created_at: d.created_at,
    };
  }

  async get(req: AppRequest, id: string) {
    return this.publicDoc(await this.load(req, id));
  }

  /** Short-lived signed URL; every download of a non-public document is logged (FR-DOC-3). */
  async download(req: AppRequest, id: string) {
    const d = await this.load(req, id);
    if (d.status !== "uploaded") throw E.notReady();
    if (d.access_level !== "public") {
      await this.db.query(`insert into document_access_log (id, document_id, user_id, org_id, action, ip) values ($1,$2,$3,$4,'download',$5)`, [
        uuidv7(), id, req.user!.id, (req.headers["x-org-id"] as string) ?? null, req.ip ?? null,
      ]);
    }
    return { url: await this.storage.presignGet(d.storage_key, d.filename, this.cfg.documentUrlTtlSec), expires_in: this.cfg.documentUrlTtlSec };
  }

  async listForOrg(req: AppRequest) {
    const { rows } = await this.db.query(`select * from documents where org_id = $1 and status = 'uploaded' order by created_at desc limit 200`, [req.org!.id]);
    return rows.map((d) => this.publicDoc(d));
  }
}
