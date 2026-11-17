import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeApp, TestApp, idem, staff, approvedOrg, addMember, Session, uploadDoc } from "./helpers.js";

let t: TestApp;
let co: Session;
let an: Session;
let tech: Session;
let fm: Session;
let fin: Session;
let ops: Session;
beforeAll(async () => {
  t = await makeApp();
  co = await staff(t, "09357770001", "compliance_officer");
  an = await staff(t, "09357770002", "analyst");
  tech = await staff(t, "09357770003", "technical_expert");
  fm = await staff(t, "09357770004", "fund_manager");
  fin = await staff(t, "09357770005", "finance_officer");
  ops = await staff(t, "09357770006", "super_admin");
});
afterAll(async () => t.close());

const V = "/api/v1";
const notes = async (s: Session) => (await t.db.query(`select event_key, body from notifications where user_id = $1 order by created_at`, [s.userId])).rows;

describe("comment threads and internal notes (§6b)", () => {
  it("separates messages to the applicant from internal notes, and routes notes to their recipients", async () => {
    const a = await approvedOrg(t, 91, { compliance: co, financing: true });
    const c = (await t.http.get(`${V}/case`).set(a.admin.auth).set(a.org).expect(200)).body;
    const item = c.items.find((i: any) => i.code === "3-2");
    const path = `${V}/admin/cases/${c.id}/comments`;

    // validation
    expect((await t.http.post(path).set(an.auth).send({ target_type: "item", target_id: item.id, type: "internal", body: "x" })).body.error.code).toBe("RECIPIENTS_REQUIRED");
    expect((await t.http.post(path).set(an.auth).send({ target_type: "item", target_id: item.id, type: "to_applicant", body: "x", recipients: [{ role: "fund_manager" }] })).body.error.code).toBe("RECIPIENTS_NOT_ALLOWED");
    expect((await t.http.post(path).set(an.auth).send({ target_type: "item", target_id: item.id, type: "internal", body: "x", recipients: [{ userId: a.admin.userId }] })).body.error.code).toBe("RECIPIENT_NOT_STAFF");
    expect((await t.http.post(path).set(an.auth).send({ target_type: "fin_cell", target_id: "1300:sales", type: "to_applicant", body: "x" })).body.error.code).toBe("COMMENT_TARGET_NOT_FOUND");

    // internal note to the fund manager role and to the technical expert by name
    const n = await t.http.post(path).set(an.auth).send({
      target_type: "item", target_id: item.id, type: "internal", body: "تراز با گردش حساب نمی‌خواند؛ در بازدید بررسی شود.",
      recipients: [{ role: "fund_manager" }, { userId: tech.userId }],
    }).expect(201);
    expect(n.body.recipients).toEqual(["role:fund_manager", `user:${tech.userId}`]);
    const tasks = (await t.db.query(`select assignee_role, assignee_user_id from tasks where linked_type = 'case_comment' and linked_id = $1`, [n.body.id])).rows;
    expect(tasks).toEqual(expect.arrayContaining([{ assignee_role: "fund_manager", assignee_user_id: null }, { assignee_role: null, assignee_user_id: tech.userId }]));
    expect((await notes(fm)).map((x: any) => x.event_key)).toContain("case.internal_note");
    expect((await notes(tech)).map((x: any) => x.event_key)).toContain("case.internal_note");
    expect((await notes(an)).map((x: any) => x.event_key)).not.toContain("case.internal_note"); // not to the writer
    // «notes for you»
    expect((await t.http.get(`${V}/admin/notes`).set(fm.auth).expect(200)).body.map((x: any) => x.id)).toContain(n.body.id);
    expect((await t.http.get(`${V}/admin/notes`).set(tech.auth).expect(200)).body.map((x: any) => x.id)).toContain(n.body.id);
    expect((await t.http.get(`${V}/admin/notes`).set(co.auth).expect(200)).body.map((x: any) => x.id)).not.toContain(n.body.id);

    // a message to the applicant on a figure, and one on the item
    await t.http.post(path).set(an.auth).send({ target_type: "fin_cell", target_id: `${c.latest_fiscal_year}:sales`, type: "to_applicant", body: "فروش سال آخر با اظهارنامه یکی نیست." }).expect(201);
    await t.http.post(path).set(an.auth).send({ target_type: "item", target_id: item.id, type: "to_applicant", body: "نسخه‌ی شش‌ستونی لازم است." }).expect(201);
    expect((await notes(a.admin)).map((x: any) => x.event_key)).toContain("case.message");

    // the applicant sees only messages to them, and replies in the same thread
    const prep = await addMember(t, a.admin, a.orgId, "09124440091", "preparer");
    await t.http.post(`${V}/case/comments`).set(prep.auth).set(a.org).send({ target_type: "item", target_id: item.id, body: "نسخه‌ی شش‌ستونی را بارگذاری کردیم." }).expect(201);
    const mine = (await t.http.get(`${V}/case`).set(prep.auth).set(a.org).expect(200)).body;
    const thread = mine.items.find((i: any) => i.id === item.id).comments;
    expect(thread.map((x: any) => x.type)).toEqual(["to_applicant", "applicant_reply"]);
    expect(JSON.stringify(mine)).not.toContain("تراز با گردش حساب"); // internal note never reaches the app
    expect(thread[0].recipients).toBeUndefined();
    expect(mine.figure_comments).toHaveLength(1);
    const staffView = (await t.http.get(`${V}/admin/cases/${c.id}`).set(an.auth).expect(200)).body;
    expect(staffView.items.find((i: any) => i.id === item.id).comments.map((x: any) => x.type)).toEqual(["internal", "to_applicant", "applicant_reply"]);

    // another organisation cannot write into this case's threads
    const b = await approvedOrg(t, 92, { compliance: co, financing: true });
    expect((await t.http.post(`${V}/case/comments`).set(b.admin.auth).set(b.org).send({ target_type: "item", target_id: item.id, body: "x" })).body.error.code).toBe("COMMENT_TARGET_NOT_FOUND");
    // applicants have no access to staff endpoints
    expect((await t.http.post(path).set(a.admin.auth).send({ target_type: "case", target_id: c.id, type: "to_applicant", body: "x" })).status).toBe(403);
  });

  it("logs every view and download of a case file (§6a)", async () => {
    const a = await approvedOrg(t, 93, { compliance: co, financing: true });
    const c = (await t.http.get(`${V}/case`).set(a.admin.auth).set(a.org).expect(200)).body;
    const item = c.items.find((i: any) => i.code === "3-4");
    await t.http.post(`${V}/case/items/${item.id}/files`).set(a.admin.auth).set(a.org).set(idem()).send({ document_id: await uploadDoc(t, a.admin, a.orgId) }).expect(201);
    const f = (await t.http.get(`${V}/admin/cases/${c.id}`).set(an.auth).expect(200)).body.items.find((i: any) => i.id === item.id).files[0];
    const v = await t.http.get(`${V}/admin/cases/${c.id}/files/${f.id}/view`).set(an.auth).expect(200);
    expect(v.body).toMatchObject({ action: "view", version: 1 });
    expect(v.body.url).toBeTruthy();
    await t.http.get(`${V}/admin/cases/${c.id}/files/${f.id}/download`).set(fm.auth).expect(200);
    const h = (await t.http.get(`${V}/admin/cases/${c.id}`).set(an.auth).expect(200)).body.access_history;
    expect(h.map((x: any) => [x.action, x.user_id, x.code])).toEqual([["download", fm.userId, "3-4"], ["view", an.userId, "3-4"]]);
    // a file id from another case is not reachable through this case
    const b = await approvedOrg(t, 94, { compliance: co, financing: true });
    const cb = (await t.http.get(`${V}/case`).set(b.admin.auth).set(b.org).expect(200)).body;
    expect((await t.http.get(`${V}/admin/cases/${cb.id}/files/${f.id}/view`).set(an.auth)).status).toBe(404);
    expect((await t.http.get(`${V}/admin/cases/${c.id}/files/${f.id}/view`).set(a.admin.auth)).status).toBe(403);
  });
});

describe("tickets (§6c)", () => {
  it("hands the ticket between applicant and fund, with notifications, a response target and escalation", async () => {
    const a = await approvedOrg(t, 95, { compliance: co, financing: true });
    const viewer = await addMember(t, a.admin, a.orgId, "09124440095", "viewer");
    const c = (await t.http.get(`${V}/case`).set(a.admin.auth).set(a.org).expect(200)).body;
    const item = c.items.find((i: any) => i.code === "1-6");

    // any member can open one, linked to their own case item, with their own attachment
    const doc = await uploadDoc(t, a.admin, a.orgId);
    const opened = await t.http.post(`${V}/tickets`).set(viewer.auth).set(a.org).send({
      category: "credit_case", subject: "گواهی امضا از کدام دفترخانه؟", body: "آیا گواهی دفترخانه‌ی شهرستان هم پذیرفته است؟",
      link_type: "case_item", link_id: item.id, attachment_doc_ids: [doc],
    }).expect(201);
    const id = opened.body.id;
    expect(opened.body).toMatchObject({ status: "waiting_fund", category: "credit_case" });
    expect(opened.body.ticket_no).toMatch(/^T-14\d\d-\d{5}$/);
    const row = (await t.db.query(`select due_at, assignee_role from tickets where id = $1`, [id])).rows[0];
    expect(row.assignee_role).toBe("analyst");
    expect(new Date(row.due_at).getTime()).toBeGreaterThan(Date.now() + 20 * 3600_000);
    expect((await t.db.query(`select assignee_role from tasks where linked_type = 'ticket' and linked_id = $1 and status = 'open'`, [id])).rows).toEqual([{ assignee_role: "analyst" }]);

    // links and attachments must be the organisation's own
    const b = await approvedOrg(t, 96, { compliance: co, financing: true });
    const cb = (await t.http.get(`${V}/case`).set(b.admin.auth).set(b.org).expect(200)).body;
    expect((await t.http.post(`${V}/tickets`).set(a.admin.auth).set(a.org).send({ category: "credit_case", subject: "تست پیوند", body: "x", link_type: "case", link_id: cb.id })).body.error.code).toBe("TICKET_LINK_NOT_FOUND");
    expect((await t.http.post(`${V}/tickets`).set(b.admin.auth).set(b.org).send({ category: "other", subject: "تست پیوست", body: "x", attachment_doc_ids: [doc] })).body.error.code).toBe("BAD_ATTACHMENT");
    expect((await t.http.get(`${V}/tickets/${id}`).set(b.admin.auth).set(b.org)).status).toBe(404);

    // the analyst queue shows it; the fund replies → waiting for the applicant, SMS to the org
    expect((await t.http.get(`${V}/admin/tickets?mine=true`).set(an.auth).expect(200)).body.map((x: any) => x.id)).toContain(id);
    expect((await t.http.get(`${V}/admin/tickets?mine=true`).set(fin.auth).expect(200)).body.map((x: any) => x.id)).not.toContain(id);
    await t.http.post(`${V}/admin/tickets/${id}/messages`).set(an.auth).send({ body: "بله، هر دفترخانه‌ی رسمی؛ خطاب به صندوق باشد." }).expect(200);
    const sms = await t.db.query(`select o.to_mobile from sms_outbox o join notifications n on n.id = o.notification_id where n.event_key = 'ticket.message' and n.org_id = $1`, [a.orgId]);
    expect(sms.rows.length).toBeGreaterThanOrEqual(2); // admin + viewer
    let mine = (await t.http.get(`${V}/tickets`).set(a.admin.auth).set(a.org).expect(200)).body;
    expect(mine.waiting_you).toBe(1);
    expect((await t.db.query(`select count(*)::int n from tasks where linked_type = 'ticket' and linked_id = $1 and status = 'open'`, [id])).rows[0].n).toBe(0);

    // applicant replies → back to the fund (now assigned to the analyst who answered), then closes; a new message reopens
    await t.http.post(`${V}/tickets/${id}/messages`).set(a.admin.auth).set(a.org).send({ body: "ممنون، روشن شد." }).expect(200);
    expect((await notes(an)).map((x: any) => x.event_key)).toContain("ticket.staff_message");
    await t.http.post(`${V}/tickets/${id}/close`).set(a.admin.auth).set(a.org).expect(200);
    expect((await t.http.post(`${V}/tickets/${id}/close`).set(a.admin.auth).set(a.org)).body.error.code).toBe("TICKET_CLOSED");
    await t.http.post(`${V}/tickets/${id}/messages`).set(a.admin.auth).set(a.org).send({ body: "یک سؤال دیگر: اصل گواهی را کی تحویل دهیم؟" }).expect(200);
    const full = (await t.http.get(`${V}/tickets/${id}`).set(viewer.auth).set(a.org).expect(200)).body;
    expect(full.status).toBe("waiting_fund");
    expect(full.messages.map((m: any) => m.side)).toEqual(["applicant", "fund", "applicant", "applicant"]);
    expect(full.messages[0].attachment_doc_ids).toEqual([doc]);

    // overdue → escalates once to the fund manager
    await t.db.query(`update tickets set due_at = now() - interval '1 hour' where id = $1`, [id]);
    expect((await t.http.post(`${V}/admin/jobs/ticket-escalation/run`).set(ops.auth).expect(200)).body).toEqual({ escalated: 1 });
    expect((await t.http.post(`${V}/admin/jobs/ticket-escalation/run`).set(ops.auth).expect(200)).body).toEqual({ escalated: 0 });
    expect((await t.db.query(`select assignee_role, priority from tasks where linked_id = $1 and workflow_key = 'ticket.escalated'`, [id])).rows).toEqual([{ assignee_role: "fund_manager", priority: "p0" }]);
    expect((await notes(fm)).map((x: any) => x.event_key)).toContain("ticket.escalated");

    // the fund can open a ticket to an applicant
    const f = await t.http.post(`${V}/admin/tickets`).set(fin.auth).send({ org_id: a.orgId, category: "payments_wallet", subject: "واریز نامشخص", body: "واریز امروز شما شناسه‌ی پرداخت نداشت؛ لطفاً رسید را بفرستید." }).expect(201);
    expect(f.body).toMatchObject({ status: "waiting_applicant", opened_side: "fund", assignee_id: fin.userId });
    mine = (await t.http.get(`${V}/tickets`).set(a.admin.auth).set(a.org).expect(200)).body;
    expect(mine.waiting_you).toBe(1);
    expect((await t.http.post(`${V}/admin/tickets`).set(a.admin.auth).send({ org_id: a.orgId, category: "other", subject: "xxx", body: "x" })).status).toBe(403);
  });
});
