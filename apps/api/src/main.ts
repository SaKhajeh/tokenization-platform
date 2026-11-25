import "reflect-metadata";
import { loadConfig } from "./config.js";
import { buildDeps, createApp } from "./app.module.js";
import { migrate } from "./db/migrate.js";
import { devSeedStaff } from "./dev-seed.js";

async function main() {
  const config = loadConfig();
  const deps = buildDeps(config);
  const applied = await migrate(deps.db);
  if (applied.length) console.log(`migrations applied: ${applied.join(", ")}`);
  if (config.env === "development") {
    const staff = await devSeedStaff(deps.db, process.env.DEV_STAFF);
    if (staff.length) console.log(`dev staff: ${staff.join("; ")}`);
  }
  const app = await createApp(deps);
  app.enableShutdownHooks();
  await app.listen(config.port);
  console.log(`api listening on :${config.port} (env=${config.env}, sms=${config.providers.sms}, identity=${config.providers.identity}, storage=${config.providers.storage})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
