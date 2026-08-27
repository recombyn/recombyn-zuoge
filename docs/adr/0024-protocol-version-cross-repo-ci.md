# ADR 0024: Protocol package version pin + cross-repo compatibility CI

- **Status:** Accepted
- **Date:** 2026-08-14

## Context

Public Recombyn and the operator's Design Intelligence deployment must not
drag each other — except for one shared contract: Intelligence method names,
request field keys, and `remote_result_usable` rules.

Hand-copied method lists in Private drifted. We need a versioned package and
CI that fails when either side breaks the contract.

## Decision

1. **Single contract package:** `packages/protocol` (`recombyn-protocol`),
   Apache-2.0. Floor for Private: `>=0.1.1`.
2. **Canonical helpers in protocol:** `INTELLIGENCE_METHODS`,
   `INTELLIGENCE_REQUEST_FIELDS`, `intelligence_wire_methods`,
   `remote_result_usable`. Import usability from protocol; runtime does not
   re-export it.
3. **Private depends on the package** (sibling path / git subdirectory / PyPI),
   never hand-maintains a second method list.
4. **CI:**
   - Public: `protocol-contract-smoke.yml` on protocol/runtime changes.
   - Public → Private: optional `repository_dispatch` (`protocol-changed`) when
     secret `INTELLIGENCE_REPO_DISPATCH_TOKEN` is set (PAT with repo scope on
     Private). Target override: `vars.INTELLIGENCE_REPO`.
   - Private: `protocol-compat.yml` on PR/push/`workflow_dispatch`/
     `repository_dispatch`; checks out Public `packages/protocol` at the
     dispatched ref and runs `tests/test_protocol_contract.py`.
5. **Publish path:** `publish-protocol.yml` builds wheels; PyPI upload when
   `PYPI_TOKEN` is set (tag `protocol-v*` or manual `publish=true`).

## Consequences

### Positive

- One versioned contract; Private/Public evolve independently behind the pin.
- Empty `{}` remotes still fall through to BasicLocal (usable rules shared).
- Cross-repo ping is optional — community forks without the secret stay green.

### Negative / trade-offs

- Until PyPI publish is routine, Docker/Private bootstrap uses git subdirectory
  or sibling `pip install -e`.
- Dispatch requires a carefully scoped PAT stored as a Public secret.

## Alternatives considered

1. **Vendoring protocol into Private** — rejected; duplicates the source of truth.
2. **Git submodule** — rejected (ADR 0017); contaminates public clone story.
3. **Only document the contract** — rejected; lists already drifted once.

## References

- [ADR 0017](./0017-intelligence-provider-boundary.md)
- [ADR 0022](./0022-open-runtime-helpers.md)
- `packages/protocol`
- `apps/intelligence/scripts/bootstrap_protocol.py` (operator checkout)
- `.github/workflows/protocol-contract-smoke.yml`
- `.github/workflows/publish-protocol.yml`
