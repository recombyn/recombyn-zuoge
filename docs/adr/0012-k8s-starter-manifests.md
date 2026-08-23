# ADR 0012: Optional Kubernetes starter manifests

- **Status:** Accepted
- **Date:** 2026-08-12

## Context

Compose + GHCR cover OSS self-host. Operators still ask for a k8s starting point without committing the project to multi-AZ ops as a product requirement.

## Decision

1. Ship **thin** manifests under `deploy/k8s/` (namespace, config, secret example, redis, api, worker, collab, web, **HPA**, **Ingress**, **PDB**, **NetworkPolicy**).
2. **No in-cluster MySQL** — `DATABASE_URL` points at managed/external DB.
3. Images assume GHCR tags from `release-docker.yml`.
4. Compose remains the documented default (ADR 0004 / 0009).

## Consequences

### Positive

- Operators can `kubectl apply` without inventing topology from scratch.
- CPU HPA + nginx Ingress + PDB + starter NetworkPolicy cover the common next asks.

### Negative / trade-offs

- Not production-hardened (no multi-AZ topology / service mesh yet).

## References

- `deploy/k8s/README.md`
- [self-hosting.md](../self-hosting.md)
