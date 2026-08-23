# Optional Kubernetes deploy (GHCR images)

You can deploy with these starter manifests (ADR 0012). Docker Compose is still the default self-host path.

Images (from `release-docker.yml` tags):

- `ghcr.io/<owner>/<repo>/api:<tag>`
- `ghcr.io/<owner>/<repo>/web:<tag>`
- `ghcr.io/<owner>/<repo>/collab:<tag>`

## Apply (example)

```bash
export IMAGE_REGISTRY=ghcr.io/recombyn/recombyn
export IMAGE_TAG=v0.1.0
# Fill secrets in secret.example.yaml → secret.yaml (do not commit)
kubectl apply -f deploy/k8s/namespace.yaml
kubectl apply -f deploy/k8s/configmap.yaml
kubectl apply -f deploy/k8s/secret.yaml
kubectl apply -f deploy/k8s/redis.yaml
kubectl apply -f deploy/k8s/api.yaml
kubectl apply -f deploy/k8s/worker.yaml
kubectl apply -f deploy/k8s/collab.yaml
kubectl apply -f deploy/k8s/web.yaml
kubectl apply -f deploy/k8s/hpa.yaml
kubectl apply -f deploy/k8s/pdb.yaml
kubectl apply -f deploy/k8s/networkpolicy.yaml
# Optional edge:
# kubectl apply -f deploy/k8s/ingress.yaml
```

MySQL is **not** included — point `DATABASE_URL` at a managed instance or an in-cluster operator of your choice.

HPA targets require metrics-server. Ingress example assumes ingress-nginx; edit host / TLS before apply.
PDB keeps `minAvailable: 1` for api/web/collab/worker/redis. NetworkPolicy defaults to deny-ingress in-namespace with allowlists for web→api and */redis.

See [docs/self-hosting.md](../../docs/self-hosting.md) for Compose.
