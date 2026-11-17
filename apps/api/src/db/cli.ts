/**
 * npm run migrate -w @tp/api
 * npm run seed:staff -w @tp/api -- <mobile> <role> [role…]   (user must have logged in once)
 * npm run seed:fund -w @tp/api -- <شناسه ملی> "<legal name>" <admin mobile>   (D14: the single issuer)
 */
import { loadConfig } from "../config.js";
import { buildDeps } from "../app.module.js";
import { migrate } from "./migrate.js";
import { seedFund } from "../orgs/fund.js";
import { AuditService } from "../audit/audit.service.js";
import { NotificationsService } from "../notifications/notifications.service.js";
import { ChainService } from "../chain/chain.service.js";

const [cmd, ...args] = process.argv.slice(2);
const config = loadConfig();
const deps = buildDeps(config);

try {
  if (cmd === "migrate") {
    const applied = await migrate(deps.db);
    console.log(applied.length ? `applied: ${applied.join(", ")}` : "up to date");
  } else if (cmd === "grant-staff") {
    const [mobile, ...roles] = args;
    if (!mobile || !roles.length) throw new Error("usage: grant-staff <mobile> <role> [role…]");
    const u = (await deps.db.query(`select id from users where mobile = $1`, [mobile])).rows[0];
    if (!u) throw new Error("user not found — log in once first");
    for (const r of roles) {
      await deps.db.query(
        `insert into staff_roles (user_id, role) values ($1,$2) on conflict (user_id, role) do update set revoked_at = null, granted_at = now()`,
        [u.id, r],
      );
    }
    console.log(`granted ${roles.join(", ")} to ${mobile}`);
  } else if (cmd === "seed-fund") {
    const [nationalId, legalName, adminMobile] = args;
    if (!nationalId || !legalName || !adminMobile) throw new Error('usage: seed-fund <national_id> "<legal name>" <admin mobile>');
    const audit = new AuditService(deps.db);
    const chain = new ChainService(deps.db, config, deps.chain, audit, new NotificationsService(deps.db, deps.sms));
    const r = await seedFund(deps.db, { audit, chain, validateChecksum: config.validateLegalIdChecksum }, { nationalId, legalName, adminMobile });
    console.log(r.created ? `fund org created: ${r.org_id}` : `existing org ${r.org_id} is now the fund`);
  } else {
    throw new Error(`unknown command: ${cmd}`);
  }
} finally {
  await deps.db.close();
}
