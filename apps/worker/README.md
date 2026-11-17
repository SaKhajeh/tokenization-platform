# apps/worker — background jobs

Same codebase as `apps/api`, different entrypoint. Jobs are listed in the data-model doc §2 and the Jibit doc §4
(cobank.deposits.poll, cobank.settlements.poll, chain.outbox, chain.indexer, recon.*, series.*, payout.execute …).
All jobs are idempotent.
