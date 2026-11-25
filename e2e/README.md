# Browser walk-through (e2e)

Drives both apps the way people use them, in headless Chromium, with a screenshot of each key screen. It covers
the whole credit path on a fresh database:

| Script | What it does |
|---|---|
| `t1.mjs` | Applicant (phone size): login with OTP, national code, create the company, purpose, KYB with an introduction letter, submit with OTP |
| `t2.mjs` | Compliance officer (staff app): KYB review and approval |
| `t3.mjs` | Applicant: bank account (OTP), all 9 form sections, three years of figures, every document slot, letter signed with OTP, case submitted with OTP |
| `t4.mjs` | Analyst: document and form review, a figure corrected and locked, visit proposed; applicant confirms; technical expert reports and records originals; analyst scores (live preview) and sends; fund manager approves with OTP; applicant sees the limit |
| `t6.mjs` | Credit manager assigns the case; fund manager grants a fee exemption and adjusts the limit (live preview, OTP); applicant sees the revised limit |
| `t5.mjs` | Applicant: financing application (5 steps, evidence of start) submitted with OTP; analyst screens it and runs the limit check |

## Run

```bash
# 1. API in development mode on an in-memory database, logging OTPs to a file the scripts read
cd apps/api
APP_ENV=development DATABASE_URL=pglite: \
DEV_STAFF="09350000001:analyst,compliance_officer,finance_officer;09350000002:fund_manager,technical_expert;09350000004:credit_manager" \
npm run dev > /tmp/tp-api.log 2>&1 &

# 2. Both apps (build once, then start)
npm run build -w @tp/web && npm run start -w @tp/web &      # :3001
npm run build -w @tp/admin && npm run start -w @tp/admin &  # :3002

# 3. The walk-through
cd e2e && npm install && npx playwright install chromium
npm test                       # screenshots in /tmp/tp-e2e/shots
```

Each run uses a new company and new mobile numbers. Settings: `API_LOG` (default `/tmp/tp-api.log`), `E2E_DIR`
(default `/tmp/tp-e2e`), `WEB_URL`, `ADMIN_URL`. Run the six scripts in order: each continues from the previous one.
The API throttles login codes, so the scripts log in once per user and reuse the saved session.
