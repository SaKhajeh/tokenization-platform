# Simulator of the platform as built

`simulation.html` is a single page that plays the whole flow implemented so far — registration, KYB, bank and deposit,
the credit case (four years of statements and the current-year trial balance, spring rule), review and returns, figures,
visit, calculation A and B, compliance officer → fund manager → release, the credit limit, a financing application with
screening, fee and limit check — role by role (company, compliance officer, analyst, technical expert, credit manager,
fund manager, finance officer). The fund tools (fee exemptions, case assignment, limit adjustment, withdrawals) are in
the side panel. Nothing is saved or sent.

The credit-limit numbers come from the platform's real engine (`packages/domain`), bundled into the page by `build.sh`,
so they match the server. When the rules change, update `app.js` and run `docs/simulation/build.sh`.
