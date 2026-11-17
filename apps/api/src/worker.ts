/**
 * Background worker: same codebase as the API, different entrypoint (plan/03 §6).
 *   chain.outbox            every 10 s  — send queued on-chain actions, track confirmations
 *   cobank.deposits.poll    every 120 s — Jibit "waiting for verify" deposits → accept / hold / refund
 *   cobank.settlements.poll every 120 s — track sent withdrawals at Jibit → completed / failed / reverted
 *   notifications.sms       every 30 s  — deliver queued SMS
 *   tickets.escalate        every 600 s — overdue tickets (waiting for the fund) → fund manager
 *   kyb.expiry              hourly      — reminders 30/7 days ahead, expiry + on-chain revoke
 *   applications.expiry     hourly      — drafts/returned applications inactive for 60 days
 * Each job holds a DB lease, so running two workers is safe (the second one skips).
 *
 *   npm run worker -w @tp/api
 */
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { Logger } from "@nestjs/common";
import { loadConfig } from "./config.js";
import { AppModule, buildDeps } from "./app.module.js";
import { ChainService } from "./chain/chain.service.js";
import { DepositsService } from "./deposits/deposits.service.js";
import { DB, Db } from "./db/db.js";
import { withLease } from "./common/lease.js";
import { NotificationsService } from "./notifications/notifications.service.js";
import { KybService } from "./kyb/kyb.service.js";
import { ApplicationsService } from "./applications/applications.service.js";
import { WithdrawalsService } from "./withdrawals/withdrawals.service.js";
import { TicketsService } from "./tickets/tickets.service.js";

const log = new Logger("worker");

async function main() {
  const config = loadConfig();
  const deps = buildDeps(config);
  const ctx = await NestFactory.createApplicationContext(AppModule.register(deps), { logger: ["error", "warn", "log"] });
  const chain = ctx.get(ChainService);
  const deposits = ctx.get(DepositsService);
  const db = ctx.get<Db>(DB);
  const notifications = ctx.get(NotificationsService);
  const kyb = ctx.get(KybService);
  const apps = ctx.get(ApplicationsService);
  const withdrawals = ctx.get(WithdrawalsService);
  const tickets = ctx.get(TicketsService);

  let stopping = false;
  const every = (name: string, ms: number, fn: () => Promise<unknown>) => {
    const run = async () => {
      if (stopping) return;
      try {
        const r = await fn();
        if (r && JSON.stringify(r) !== "{}") log.log(`${name}: ${JSON.stringify(r)}`);
      } catch (e: any) {
        log.error(`${name} failed: ${e?.message ?? e}`);
      } finally {
        if (!stopping) setTimeout(run, ms);
      }
    };
    void run();
  };

  every("chain.outbox", 10_000, () => withLease(db, "chain.outbox", 120, () => chain.processOutbox()));
  every("cobank.deposits.poll", 120_000, () => deposits.poll());
  every("cobank.settlements.poll", 120_000, () => withdrawals.poll());
  every("notifications.sms", 30_000, () => withLease(db, "notifications.sms", 120, () => notifications.sendQueuedSms()));
  every("kyb.expiry", 3_600_000, () => kyb.runExpiry());
  every("applications.expiry", 3_600_000, () => withLease(db, "applications.expiry", 600, () => apps.expireInactive()));
  every("tickets.escalate", 600_000, () => tickets.escalateOverdue());

  const stop = async () => {
    stopping = true;
    log.log("stopping…");
    await ctx.close();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  log.log(`worker started (chain=${config.providers.chain}, cobank=${config.providers.cobank})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
