/** D-C13 / §6d: the assessment fee for a case, from the fund's tariff and where the company works. */
import { feeRegion } from "@tp/domain";
import type { Queryable } from "../db/db.js";

export async function currentTariff(q: Queryable) {
  return (await q.query(`select * from fee_tariffs where effective_from <= current_date order by version desc limit 1`)).rows[0] ?? null;
}

export async function assessmentFee(q: Queryable, caseId: string) {
  const sec = (await q.query(`select data from case_sections where case_id = $1 and section = 'locations'`, [caseId])).rows[0];
  const region = feeRegion(sec?.data?.rows);
  const c = (await q.query(`select fee_invoice_id from cases where id = $1`, [caseId])).rows[0];
  const invoice = c?.fee_invoice_id ? (await q.query(`select id, status, total, invoice_no from invoices where id = $1`, [c.fee_invoice_id])).rows[0] : null;
  const t = await currentTariff(q);
  const amount = BigInt(t ? (region === "tehran" ? t.assessment_fee_tehran : t.assessment_fee_outside) : 0);
  return { region, amount, tariff: t, invoice: invoice && invoice.status !== "cancelled" ? invoice : null };
}
