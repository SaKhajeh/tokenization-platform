import "reflect-metadata";
import { DynamicModule, INestApplication, Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, NestFactory } from "@nestjs/core";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import type { AppConfig } from "./config.js";
import { DB, Db, PgDb, PgliteDb } from "./db/db.js";
import { CONFIG } from "./common/tokens.js";
import { ApiExceptionFilter } from "./common/errors.js";
import { AccessGuard } from "./common/guards.js";
import { StepUpGuard } from "./common/stepup.js";
import { IdempotencyInterceptor } from "./common/idempotency.js";
import { AuditService } from "./audit/audit.service.js";
import { AuditController } from "./audit/audit.controller.js";
import { AuthService } from "./auth/auth.service.js";
import { AuthController } from "./auth/auth.controller.js";
import { OrgsService } from "./orgs/orgs.service.js";
import { OrgsController } from "./orgs/orgs.controller.js";
import { TasksService } from "./tasks/tasks.service.js";
import { TasksController } from "./tasks/tasks.controller.js";
import { DocumentsService } from "./documents/documents.service.js";
import { DocumentsController } from "./documents/documents.controller.js";
import { HealthController } from "./health.controller.js";
import {
  EMAIL, IDENTITY, IdentityProvider, JibitIdentity, JibitSms, MemorySender, MemoryStorage, MessageSender, MockIdentity,
  ObjectStorage, S3Storage, SMS, STORAGE,
} from "./integrations/providers.js";
import { JibitHttp, jibitProducts } from "./integrations/jibit.js";
import { JibitRegistry, MockRegistry, REGISTRY, RegistryProvider } from "./integrations/registry.js";
import { COBANK, CobankProvider, JibitCobank, MockCobank } from "./integrations/cobank.js";
import { CHAIN, ChainGateway, EvmChain, MockChain } from "./chain/gateway.js";
import { ChainService } from "./chain/chain.service.js";
import { LedgerService } from "./ledger/ledger.service.js";
import { KybService } from "./kyb/kyb.service.js";
import { BankAccountsService } from "./bank-accounts/bank-accounts.service.js";
import { DepositsService } from "./deposits/deposits.service.js";
import { BankAccountsController, ChainController, KybController, MoneyController, StaffTasksController } from "./mb.controllers.js";
import { ApplicationsController, ApplicantsController, JobsController, NotificationsController } from "./mc.controllers.js";
import { NotificationsService } from "./notifications/notifications.service.js";
import { ApplicantsService } from "./applicants/applicants.service.js";
import { WithdrawalsService } from "./withdrawals/withdrawals.service.js";
import { WithdrawalsController } from "./withdrawals/withdrawals.controller.js";
import { ApplicationsService } from "./applications/applications.service.js";
import { PricingService } from "./pricing/pricing.service.js";
import { InvoicesService } from "./invoices/invoices.service.js";
import { PricingController, InvoicesController } from "./pricing.controllers.js";
import { CasesController } from "./cases.controllers.js";
import { CasesService } from "./cases/cases.service.js";
import { CommentsService } from "./cases/comments.service.js";
import { LimitsService } from "./cases/limits.service.js";
import { TicketsService } from "./tickets/tickets.service.js";
import { TicketsController } from "./tickets.controllers.js";

export interface AppDeps {
  config: AppConfig;
  db: Db;
  sms: MessageSender;
  email: MessageSender;
  identity: IdentityProvider;
  storage: ObjectStorage;
  registry: RegistryProvider;
  cobank: CobankProvider;
  chain: ChainGateway;
}

@Module({})
export class AppModule {
  static register(deps: AppDeps): DynamicModule {
    return {
      module: AppModule,
      controllers: [
        HealthController, AuthController, OrgsController, TasksController, DocumentsController, AuditController,
        KybController, BankAccountsController, MoneyController, ChainController, StaffTasksController,
        ApplicantsController, ApplicationsController, NotificationsController, JobsController, WithdrawalsController,
        PricingController, InvoicesController, CasesController, TicketsController,
      ],
      // useFactory, not useValue: Nest serialises useValue providers into the module token,
      // which explodes on large objects such as a PGlite instance.
      providers: [
        { provide: CONFIG, useFactory: () => deps.config },
        { provide: DB, useFactory: () => deps.db },
        { provide: SMS, useFactory: () => deps.sms },
        { provide: EMAIL, useFactory: () => deps.email },
        { provide: IDENTITY, useFactory: () => deps.identity },
        { provide: STORAGE, useFactory: () => deps.storage },
        { provide: REGISTRY, useFactory: () => deps.registry },
        { provide: COBANK, useFactory: () => deps.cobank },
        { provide: CHAIN, useFactory: () => deps.chain },
        // Guard order matters: authentication/org scoping first, then step-up.
        { provide: APP_GUARD, useClass: AccessGuard },
        { provide: APP_GUARD, useClass: StepUpGuard },
        { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
        { provide: APP_FILTER, useClass: ApiExceptionFilter },
        AuditService,
        AuthService,
        OrgsService,
        TasksService,
        DocumentsService,
        LedgerService,
        ChainService,
        DepositsService,
        KybService,
        BankAccountsService,
        NotificationsService,
        ApplicantsService,
        WithdrawalsService,
        ApplicationsService,
        PricingService,
        CasesService,
        CommentsService,
        LimitsService,
        TicketsService,
        InvoicesService,
      ],
    };
  }
}

/** Builds real providers from config (Jibit/S3 in staging+prod; in-memory in dev). */
export function buildDeps(config: AppConfig): AppDeps {
  const http = new JibitHttp(config.jibit.baseUrl);
  const products = jibitProducts(config.jibit);
  const memorySender = new MemorySender();
  return {
    config,
    db: config.databaseUrl.startsWith("pglite:") ? new PgliteDb(new PGlite(config.databaseUrl.slice(7) || undefined)) : new PgDb(config.databaseUrl),
    sms: config.providers.sms === "jibit" ? new JibitSms(http, products.pulse, config.jibit.smsSender, config.jibit.smsOtpTemplate) : memorySender,
    // TODO(M-B): SMTP/transactional email provider. Until then email OTP is dev-only.
    email: memorySender,
    identity: config.providers.identity === "jibit" ? new JibitIdentity(http, products.ide) : new MockIdentity(),
    storage: config.providers.storage === "s3" ? new S3Storage(config.s3) : new MemoryStorage(),
    registry: config.providers.identity === "jibit" ? new JibitRegistry(http, products.ide) : new MockRegistry(),
    cobank: config.providers.cobank === "jibit" ? new JibitCobank(http, products.cobank) : new MockCobank(),
    chain: config.providers.chain === "evm" ? new EvmChain({ ...config.chain }) : new MockChain(),
  };
}

export async function createApp(deps: AppDeps): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule.register(deps), { abortOnError: false, logger: deps.config.env === "test" ? false : ["error", "warn", "log"] });
  app.setGlobalPrefix("api/v1");
  const http = app.getHttpAdapter().getInstance();
  http.set("trust proxy", 1);
  http.disable("x-powered-by");
  app.use((req: any, res: any, next: () => void) => {
    req.id = randomUUID();
    res.setHeader("X-Request-Id", req.id);
    next();
  });
  return app;
}
