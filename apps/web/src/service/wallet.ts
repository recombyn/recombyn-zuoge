/**
 * Wallet Query SoT — balance / plan / billing flag live in TanStack Query, not Redux.
 */

import { useQuery } from '@tanstack/react-query';
import { apiQuery, queryClient } from '@/service/client';
import type { WalletDto } from '@/models/wallet';
import { normalizePlanId, PLAN_CATALOG, type PlanDef, type PlanId } from '@/utils/wallet';
import { getApiBaseUrl } from '@/utils/apiBase';
import { getToken } from '@/utils/token';

export type WalletSnapshot = {
  credits: number;
  planId: PlanId;
  planExpiresAt: number | null;
  planLocked: boolean;
  billingEnabled: boolean;
  creditsIncluded: number;
};

function emptyWalletSnapshot(billingEnabled = false): WalletSnapshot {
  return {
    credits: 0,
    planId: 'free',
    planExpiresAt: null,
    planLocked: false,
    billingEnabled,
    creditsIncluded: PLAN_CATALOG.free.creditsIncluded,
  };
}

export type WalletPlanRow = {
  planId: string;
  priceCny: number;
  creditsIncluded: number;
  period?: string;
  dailyRuns?: number;
};

function walletApiUrl(path: string): string {
  const baked = getApiBaseUrl().replace(/\/$/, '');
  const root = baked || (typeof window !== 'undefined' ? window.location.origin : 'http://127.0.0.1:8000');
  return `${root}/api/v1${path}`;
}

function mergePlanCatalog(rows: WalletPlanRow[] | undefined): Record<PlanId, PlanDef> {
  const out: Record<PlanId, PlanDef> = {
    free: { ...PLAN_CATALOG.free },
    plus: { ...PLAN_CATALOG.plus },
    pro: { ...PLAN_CATALOG.pro },
    ultra: { ...PLAN_CATALOG.ultra },
  };
  for (const row of rows || []) {
    const id = normalizePlanId(row.planId);
    const credits = Math.max(0, Math.round(Number(row.creditsIncluded) || 0));
    out[id] = {
      ...out[id],
      id,
      priceCny: Math.max(0, Math.round(Number(row.priceCny) || 0)),
      creditsIncluded: credits,
      dailyRuns:
        row.dailyRuns != null && Number.isFinite(Number(row.dailyRuns))
          ? Math.max(0, Math.round(Number(row.dailyRuns)))
          : out[id].dailyRuns,
    };
  }
  return out;
}

async function loadWalletPlans(): Promise<WalletPlanRow[]> {
  const res = await fetch(walletApiUrl('/wallet/plans'));
  if (!res.ok) throw new Error(`wallet plans ${res.status}`);
  const body = (await res.json()) as { plans?: WalletPlanRow[] };
  return Array.isArray(body.plans) ? body.plans : [];
}

/** Public membership SKUs from `/wallet/plans` (Intelligence via API; OSS fallback). */
export function usePlanCatalog(): Record<PlanId, PlanDef> {
  const q = useQuery({
    queryKey: ['wallet', 'plans'],
    queryFn: loadWalletPlans,
    staleTime: 60_000,
  });
  return mergePlanCatalog(q.data);
}

export function walletDtoToSnapshot(
  dto: WalletDto | null | undefined,
  billingFallback = false,
  catalog: Record<PlanId, PlanDef> = PLAN_CATALOG
): WalletSnapshot {
  if (!dto) {
    return {
      ...emptyWalletSnapshot(billingFallback),
      creditsIncluded: catalog.free.creditsIncluded,
    };
  }
  const planId = normalizePlanId(dto.planId);
  let planExpiresAt: number | null = null;
  if (dto.planExpiresAt != null && Number.isFinite(Number(dto.planExpiresAt))) {
    planExpiresAt = Number(dto.planExpiresAt);
  }
  return {
    credits: Math.max(0, Math.round(Number(dto.credits) || 0)),
    planId,
    planExpiresAt,
    planLocked: Boolean(dto.planLocked) && planId !== 'free',
    billingEnabled: billingFallback,
    creditsIncluded: (catalog[planId] || catalog.free).creditsIncluded,
  };
}

/** Balance is live data — never treat `/wallet` as a catalog cache. */
export const WALLET_ME_QUERY_OPTS = {
  staleTime: 0,
  refetchOnMount: 'always' as const,
  refetchOnWindowFocus: true,
};

/** Ledger rows change on spend/redeem — same freshness rules as balance. */
export const WALLET_LEDGER_QUERY_OPTS = {
  staleTime: 0,
  refetchOnMount: 'always' as const,
};

/** After chat / image / tool spend — sidebar chip must update immediately. */
export function refreshWalletAfterSpend(): void {
  void queryClient.invalidateQueries({ queryKey: apiQuery.walletWalletMe.key() });
}

/** After redeem / plan change — balance + ledger + public plan SKUs. */
export async function invalidateWalletCache() {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: apiQuery.walletWalletMe.key() }),
    queryClient.invalidateQueries({ queryKey: apiQuery.walletWalletLedger.key() }),
    queryClient.invalidateQueries({ queryKey: ['wallet', 'plans'] }),
  ]);
}

/** Logout / 401 — drop cached balance so the next account cannot leak. */
export function clearWalletCache() {
  queryClient.removeQueries({ queryKey: apiQuery.walletWalletMe.key() });
  queryClient.removeQueries({ queryKey: apiQuery.walletWalletLedger.key() });
  queryClient.removeQueries({ queryKey: ['wallet', 'plans'] });
}

/** Authed wallet row — credits, plan, billingEnabled from `/wallet`. */
export function useWalletMeQuery(enabled?: boolean) {
  const authed = Boolean(getToken());
  return useQuery({
    ...apiQuery.walletWalletMe.queryOptions({
      enabled: enabled ?? authed,
    }),
    ...WALLET_ME_QUERY_OPTS,
  });
}

/** Public billing flag from `/auth/config` (works before login). */
export function useAuthBillingConfigQuery() {
  return useQuery({
    ...apiQuery.authAuthConfig.queryOptions(),
    staleTime: 60_000,
  });
}

/** Sole UI switch: API `WALLET_BILLING_ENABLED` from `/auth/config` (not wallet errors). */
export function useBillingEnabled(): boolean {
  const configQuery = useAuthBillingConfigQuery();
  const fromConfig = (configQuery.data as { billingEnabled?: boolean } | undefined)?.billingEnabled;
  if (typeof fromConfig === 'boolean') return fromConfig;
  return true;
}

/** Show per-action credit costs when platform billing is on (incl. local dev against cloud wallet). */
export function useShowCreditCosts(): boolean {
  const billingEnabled = useBillingEnabled();
  return billingEnabled;
}

/** Convenience snapshot for chips / plans / ledger header. */
export function useWalletSnapshot(): WalletSnapshot {
  const authed = Boolean(getToken());
  const walletQuery = useWalletMeQuery(authed);
  const catalog = usePlanCatalog();
  const billingEnabled = useBillingEnabled();
  return walletDtoToSnapshot(
    walletQuery.data as WalletDto | undefined,
    billingEnabled,
    catalog
  );
}
