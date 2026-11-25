/**
 * Local development only (APP_ENV=development): DEV_STAFF="09350000001:analyst,fund_manager;09350000002:compliance_officer"
 * creates these users if needed and grants the staff roles at startup, so the staff app can be used on an in-memory
 * database (PGlite) without running the seed CLI in a second process.
 */
import type { Db } from "./db/db.js";
import { uuidv7 } from "./common/ids.js";

export async function devSeedStaff(db: Db, spec: string | undefined): Promise<string[]> {
  if (!spec?.trim()) return [];
  const done: string[] = [];
  for (const part of spec.split(";").map((x) => x.trim()).filter(Boolean)) {
    const [mobile, roles = ""] = part.split(":");
    if (!/^09\d{9}$/.test(mobile)) throw new Error(`DEV_STAFF: bad mobile ${mobile}`);
    const u =
      (await db.query(`select id from users where mobile = $1`, [mobile])).rows[0] ??
      (await db.query(`insert into users (id, mobile) values ($1, $2) returning id`, [uuidv7(), mobile])).rows[0];
    for (const r of roles.split(",").map((x) => x.trim()).filter(Boolean)) {
      await db.query(
        `insert into staff_roles (user_id, role) values ($1,$2) on conflict (user_id, role) do update set revoked_at = null`,
        [u.id, r],
      );
    }
    done.push(`${mobile} (${roles})`);
  }
  return done;
}
