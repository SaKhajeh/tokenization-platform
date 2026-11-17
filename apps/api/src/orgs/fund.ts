/**
 * D14: the fund is the only issuer. Marks one organisation as the fund (org_kind = 'fund', is_issuer = true), creating it
 * if needed with the given user as its org_admin. The database allows exactly one fund org.
 * The fund org still completes KYB like any org; its digital ID then carries the investor + issuer + fund flags.
 */
import type { Db } from "../db/db.js";
import type { ChainService } from "../chain/chain.service.js";
import type { AuditService } from "../audit/audit.service.js";
import { uuidv7 } from "../common/ids.js";
import { isValidLegalNationalId, normalizeDigits, normalizeMobile } from "../common/validators.js";

export async function seedFund(
  db: Db,
  deps: { audit: AuditService; chain: ChainService; validateChecksum: boolean },
  input: { nationalId: string; legalName: string; adminMobile: string },
) {
  const nationalId = normalizeDigits(input.nationalId);
  if (!/^\d{11}$/.test(nationalId) || (deps.validateChecksum && !isValidLegalNationalId(nationalId))) throw new Error("invalid شناسه ملی");
  const mobile = normalizeMobile(input.adminMobile);
  const user = mobile ? (await db.query(`select id from users where mobile = $1`, [mobile])).rows[0] : null;
  if (!user) throw new Error("admin user not found — they must log in once first");

  return db.tx(async (q) => {
    const other = (await q.query(`select id, national_id from orgs where org_kind = 'fund'`)).rows[0];
    if (other && other.national_id !== nationalId) throw new Error(`another org is already the fund (${other.national_id})`);
    let org = (await q.query(`select * from orgs where national_id = $1 for update`, [nationalId])).rows[0];
    let created = false;
    if (!org) {
      org = (
        await q.query(
          `insert into orgs (id, legal_name, national_id, org_kind, is_issuer, is_applicant, created_by) values ($1,$2,$3,'fund',true,false,$4) returning *`,
          [uuidv7(), input.legalName, nationalId, user.id],
        )
      ).rows[0];
      created = true;
    } else {
      org = (await q.query(`update orgs set org_kind='fund', is_issuer=true, is_applicant=false, updated_at=now() where id=$1 returning *`, [org.id])).rows[0];
    }
    await q.query(
      `insert into org_members (id, org_id, user_id, role, status) values ($1,$2,$3,'org_admin','active')
       on conflict (org_id, user_id) do update set role='org_admin', status='active', updated_at=now()`,
      [uuidv7(), org.id, user.id],
    );
    // If the org already has a registered digital ID, add the issuer + fund flags on-chain.
    await deps.chain.syncIdentity(q, org.id, "fund_seeded");
    await deps.audit.append(q, { actorType: "system", orgId: org.id, action: created ? "fund.created" : "fund.designated", entityType: "org", entityId: org.id, after: { national_id: nationalId } });
    return { org_id: org.id, created };
  });
}
