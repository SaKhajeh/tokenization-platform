/**
 * Company registry and bank-account inquiries (Jibit "ide" product), normalised into our own shapes.
 * Endpoints and field names come from Jibit's OpenAPI spec (plan/04-integrations-jibit.md §2.1–2.2).
 * The raw Jibit response is kept alongside, so reviewers see everything and nothing is lost in mapping.
 */
import { JibitHttp, JibitProduct } from "./jibit.js";

export interface RegistryPerson {
  nationalCode: string | null;
  name: string;
  position: string | null;
  /** ceo = managing director; board = listed member (board / signatory data from the registry). */
  roles: ("ceo" | "board")[];
}

export interface LegalIdentity {
  nationalId: string;
  name: string;
  registerNumber: string | null;
  registerDate: string | null;
  establishmentDate: string | null;
  lastChangeDate: string | null;
  companyType: string | null;
  /** Registry state text, e.g. "فعال". */
  state: string | null;
  activity: string | null;
  address: string | null;
  postalCode: string | null;
  province: string | null;
  city: string | null;
  /** Who may sign for the company, as free text from the gazette. Shown to the reviewer. */
  signatureAuthority: string | null;
  bankrupt: boolean;
  suspended: boolean;
  people: RegistryPerson[];
  raw: unknown;
}

export interface IbanInfo {
  iban: string;
  bank: string | null;
  depositNumber: string | null;
  status: "ACTIVE" | "BLOCK_WITH_DEPOSIT" | "BLOCK_WITHOUT_DEPOSIT" | "IDLE" | "UNKNOWN";
  owners: string[];
  raw: unknown;
}

export interface RegistryProvider {
  legalIdentity(nationalId: string): Promise<LegalIdentity | null>;
  ibanInfo(iban: string): Promise<IbanInfo | null>;
  /** Does this IBAN belong to the legal entity with this شناسه ملی? */
  matchIbanLegal(iban: string, legalNationalId: string): Promise<boolean>;
  /** Number of bounced cheques for a person (10 digits) or company (11 digits). */
  bouncedChequeCount(nationalCode: string): Promise<number>;
  postal(code: string): Promise<{ postalCode: string; address: string; province: string | null; city: string | null } | null>;
}
export const REGISTRY = Symbol("REGISTRY");

const notFound = (e: any) => e?.status === 404;

export class JibitRegistry implements RegistryProvider {
  constructor(private readonly http: JibitHttp, private readonly product: JibitProduct) {}

  async legalIdentity(nationalId: string): Promise<LegalIdentity | null> {
    // Billed per flag: base + signHolders + members + ceo (news on demand only).
    const q = new URLSearchParams({ nationalCode: nationalId, signHolders: "true", members: "true", ceo: "true" });
    try {
      const r = await this.http.call<any>(this.product, "GET", `/ide/v1/services/identity/legal?${q}`);
      return mapLegal(nationalId, r);
    } catch (e) {
      if (notFound(e)) return null;
      throw e;
    }
  }

  async ibanInfo(iban: string): Promise<IbanInfo | null> {
    try {
      const r = await this.http.call<any>(this.product, "GET", `/ide/v1/ibans?${new URLSearchParams({ value: iban })}`);
      const i = r?.ibanInfo ?? {};
      return {
        iban: i.iban ?? iban,
        bank: i.bank ?? null,
        depositNumber: i.depositNumber ?? null,
        status: i.status ?? "UNKNOWN",
        owners: (i.owners ?? []).map((o: any) => [o.firstName, o.lastName].filter(Boolean).join(" ").trim()).filter(Boolean),
        raw: r,
      };
    } catch (e) {
      if (notFound(e)) return null;
      throw e;
    }
  }

  async matchIbanLegal(iban: string, legalNationalId: string) {
    const q = new URLSearchParams({ iban, legalNationalCode: legalNationalId });
    const r = await this.http.call<{ matched: boolean }>(this.product, "GET", `/ide/v1/services/matching?${q}`);
    return r.matched === true;
  }

  async bouncedChequeCount(nationalCode: string) {
    const q = new URLSearchParams({ nationalCode });
    const r = await this.http.call<{ count: number }>(this.product, "GET", `/ide/v1/services/cheque/bounced-cheque/count?${q}`);
    return Number(r.count ?? 0);
  }

  async postal(code: string) {
    try {
      const r = await this.http.call<any>(this.product, "GET", `/ide/v1/services/postal?${new URLSearchParams({ code })}`);
      const a = r?.addressInfo ?? {};
      return { postalCode: a.postalCode ?? code, address: a.address ?? "", province: a.province ?? null, city: a.city ?? null };
    } catch (e) {
      if (notFound(e)) return null;
      throw e;
    }
  }
}

export function mapLegal(nationalId: string, r: any): LegalIdentity {
  const i = r?.legalIdentityInfo ?? {};
  const people = new Map<string, RegistryPerson>();
  const add = (m: any, role: "ceo" | "board") => {
    if (!m) return;
    const name = m.name || [m.firstName, m.lastName].filter(Boolean).join(" ") || "—";
    const key = m.nationalCode || `name:${name}`;
    const p: RegistryPerson = people.get(key) ?? { nationalCode: m.nationalCode ?? null, name, position: m.position ?? null, roles: [] };
    if (!p.roles.includes(role)) p.roles.push(role);
    people.set(key, p);
  };
  add(i.ceo, "ceo");
  for (const m of i.members ?? []) add(m, "board");
  return {
    nationalId: i.nationalCode ?? nationalId,
    name: i.name ?? "",
    registerNumber: i.registerNumber ?? null,
    registerDate: i.registerDate ?? null,
    establishmentDate: i.establishmentDate ?? null,
    lastChangeDate: i.lastChangeDate ?? null,
    companyType: i.companyTypeDescription ?? i.type ?? null,
    state: i.state ?? null,
    activity: i.activity ?? null,
    address: i.address ?? null,
    postalCode: i.postalCode ?? null,
    province: i.addressInfo?.province ?? null,
    city: i.addressInfo?.city ?? null,
    signatureAuthority: i.signatureAuthority ?? i.signatureInfo ?? null,
    bankrupt: i.bankruptcyState === true,
    suspended: i.suspensionState === true,
    people: [...people.values()],
    raw: r,
  };
}

/**
 * Dev/test registry. Companies and IBANs are registered by tests; unknown companies return a plausible active
 * company with no known people (so the representative's authority needs a document), unknown IBANs return null.
 */
export class MockRegistry implements RegistryProvider {
  readonly companies = new Map<string, Partial<LegalIdentity>>();
  readonly ibans = new Map<string, { legalId: string; status?: IbanInfo["status"]; bank?: string; owners?: string[] }>();
  readonly bounced = new Map<string, number>();
  calls: string[] = [];

  async legalIdentity(nationalId: string): Promise<LegalIdentity | null> {
    this.calls.push(`legal:${nationalId}`);
    const c = this.companies.get(nationalId);
    if (c === undefined && nationalId.startsWith("99")) return null; // test hook: "not in the registry"
    return {
      nationalId,
      name: c?.name ?? `شرکت ثبت‌شده ${nationalId.slice(-4)}`,
      registerNumber: c?.registerNumber ?? "123456",
      registerDate: c?.registerDate ?? "1398/01/15",
      establishmentDate: c?.establishmentDate ?? "1398/01/15",
      lastChangeDate: c?.lastChangeDate ?? "1404/06/01",
      companyType: c?.companyType ?? "سهامی خاص",
      state: c?.state ?? "فعال",
      activity: c?.activity ?? "پژوهش و توسعه",
      address: c?.address ?? "تهران، خیابان آزمایش، پلاک ۱",
      postalCode: c?.postalCode ?? "1234567890",
      province: c?.province ?? "تهران",
      city: c?.city ?? "تهران",
      signatureAuthority: c?.signatureAuthority ?? "اسناد تعهدآور با امضای مدیرعامل و یکی از اعضای هیئت‌مدیره",
      bankrupt: c?.bankrupt ?? false,
      suspended: c?.suspended ?? false,
      people: c?.people ?? [],
      raw: { mock: true },
    };
  }
  async ibanInfo(iban: string): Promise<IbanInfo | null> {
    this.calls.push(`iban:${iban}`);
    const x = this.ibans.get(iban);
    if (!x) return null;
    return { iban, bank: x.bank ?? "بانک آزمون", depositNumber: iban.slice(-13), status: x.status ?? "ACTIVE", owners: x.owners ?? ["شرکت آزمون"], raw: { mock: true } };
  }
  async matchIbanLegal(iban: string, legalNationalId: string) {
    this.calls.push(`match:${iban}`);
    return this.ibans.get(iban)?.legalId === legalNationalId;
  }
  async bouncedChequeCount(nationalCode: string) {
    return this.bounced.get(nationalCode) ?? 0;
  }
  async postal(code: string) {
    return { postalCode: code, address: "تهران، خیابان آزمایش، پلاک ۱", province: "تهران", city: "تهران" };
  }
}
