/**
 * Wallet DTO types — HTTP via `apiClient` / `apiQuery`.
 */

import type { PlanId } from '@/utils/wallet';

export type WalletLedgerDto = {
  id: string;
  kind: 'redeem' | 'spend' | 'plan' | 'recharge';
  amount: number;
  balanceAfter: number;
  detail?: string;
  createdAt: number;
};

export type WalletDto = {
  credits: number;
  planId?: PlanId | string;
  /** Unix seconds; null when free / unset. */
  planExpiresAt?: number | null;
  /** True while a paid plan is still within its term. */
  planLocked?: boolean;
  /** Platform credit billing (WALLET_BILLING_ENABLED); false on self-host / local. */
  billingEnabled?: boolean;
  ledger: WalletLedgerDto[];
};

export type RedeemResultDto = {
  kind?: 'credit' | 'plan' | string;
  creditsAdded: number;
  credits: number;
  planId?: PlanId | string;
  planExpiresAt?: number | null;
  planLocked?: boolean;
  ledger: WalletLedgerDto[];
};

export type WalletLedgerKindFilter = 'all' | 'redeem' | 'spend';

export type PaginatedWalletLedger = {
  credits: number;
  planId?: PlanId | string;
  planExpiresAt?: number | null;
  planLocked?: boolean;
  items: WalletLedgerDto[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
  kind: WalletLedgerKindFilter | string;
};
