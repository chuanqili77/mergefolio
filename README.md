# Mergefolio

Mergefolio is a public record of third-party merges for open-source contributors. A visitor can inspect a folio by numeric GitHub account ID. Any wallet may nominate a public pull request and pay the testnet execution deposit. The credential belongs to the source-reported account, independently of the nominator.

[Open Mergefolio](https://chuanqili77.github.io/mergefolio/)

Independent GenLayer validators each fetch the public GitHub Pull Requests API and compare the normalized attribution and merge outcome using strict equality. A merger account with a different GitHub ID from the author permits issuance. Self-merges, open pull requests and closed unmerged requests remain explanatory ledger entries and do not add credit. A later status can be evaluated, but the same outcome cannot be recorded twice. Immutable GitHub pull IDs prevent aliases from duplicating an issued credential. Folios count distinct repository-owner accounts without rewarding repeated merges under the same owner as independent breadth.

A credential records an observed GitHub event. It provides no claim about real-world identity, human independence, seniority, code quality, or control of a wallet. GitHub accounts may be automated or affiliated with one another. Private repositories are outside scope. API outages and validator disagreement fail closed.

## Run

Use Node 24 and Python 3.

```sh
npm ci
npm test
npm run build
pip install genvm-linter==0.11.0
genvm-lint check contracts/mergefolio.py
```

The frontend targets Stable Studionet, chain 61999. Standard EIP-1193 wallets connect through MetaMask or OKX. Demo wallets exist only in tab memory and can request test GEN from the Studio faucet. The public ledger and folios always read the latest-final chain state.

## Verified example

The [contributor folio](https://chuanqili77.github.io/mergefolio/?author=26024537) shows the credential for GitHub account ID 26024537. The same account's PR #259 was closed without a merge and did not receive credit. PR #262 was merged by a different account and added one credential. A duplicate submission was rejected. The [transaction receipts and latest-final state](evidence/studionet.json) are rechecked by running `node scripts/verify.mjs`. Deployment metadata and the official lint result are tracked alongside these records.

[Desktop browser review](evidence/mergefolio-desktop.jpg) · [390 px browser review](evidence/mergefolio-narrow.jpg). Both simulated layouts had no horizontal overflow. A browser Demo wallet signed the test transactions. Native extensions and physical phones were outside this run.
