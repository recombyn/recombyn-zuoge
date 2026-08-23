import { useEffect, useRef, useState, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient, apiQuery, getHttpStatus } from '@/service/client';
import { Button, message } from '@/components/base';
import LoadingDots from '@/components/base/LoadingDots';
import { cn } from '@/utils/classnames';

const PREFERRED_ORG_KEY = 'recombyn.preferredOrgId';

export function readPreferredOrgId(): string | null {
  try {
    const v = localStorage.getItem(PREFERRED_ORG_KEY)?.trim();
    return v || null;
  } catch {
    return null;
  }
}

function writePreferredOrgId(orgId: string | null) {
  try {
    if (!orgId) localStorage.removeItem(PREFERRED_ORG_KEY);
    else localStorage.setItem(PREFERRED_ORG_KEY, orgId);
  } catch {
    /* ignore */
  }
}

type OrgRow = {
  id: string;
  name: string;
  role?: string;
};

type MemberRow = {
  org_id?: string;
  user_id: string;
  role: string;
};

type InviteRow = {
  id: string;
  orgId: string;
  orgName?: string | null;
  email?: string | null;
  userId?: string | null;
  role: string;
  status: string;
};

type DirectoryUser = {
  id: string;
  email?: string | null;
  name?: string | null;
};

function roleLabel(role: string | undefined, t: (k: string) => string): string {
  const r = (role || '').toLowerCase();
  if (r === 'owner') return t('account.orgRoleOwner');
  if (r === 'admin') return t('account.orgRoleAdmin');
  return t('account.orgRoleMember');
}

function canManageSettings(role: string | undefined): boolean {
  const r = (role || '').toLowerCase();
  return r === 'owner' || r === 'admin';
}

function canInvite(role: string | undefined): boolean {
  const r = (role || '').toLowerCase();
  return r === 'owner' || r === 'admin';
}

/** Team orgs — create, prefer for new projects, search+pending invites. */
function AccountOrgPanel() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const searchTimer = useRef<number | null>(null);
  const [name, setName] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [inviteQuery, setInviteQuery] = useState('');
  const [inviteSearchQ, setInviteSearchQ] = useState('');
  const [selectedInvitee, setSelectedInvitee] = useState<DirectoryUser | null>(null);
  const [preferredId, setPreferredId] = useState<string | null>(() => readPreferredOrgId());
  const [renameDraft, setRenameDraft] = useState('');

  const orgsQuery = useQuery({
    ...apiQuery.orgsListMyOrgs.queryOptions({}),
  });

  const orgs: OrgRow[] = (() => {
    const data = orgsQuery.data as { orgs?: OrgRow[] } | undefined;
    return Array.isArray(data?.orgs) ? data.orgs : [];
  })();

  useEffect(() => {
    if (!selectedId && orgs.length > 0) setSelectedId(orgs[0].id);
    if (selectedId && orgs.length > 0 && !orgs.some((o) => o.id === selectedId)) {
      setSelectedId(orgs[0]?.id ?? null);
    }
  }, [orgs, selectedId]);

  const selected = orgs.find((o) => o.id === selectedId) || null;

  useEffect(() => {
    setRenameDraft(selected?.name || '');
  }, [selected?.id, selected?.name]);

  const myInvitesQuery = useQuery({
    ...apiQuery.orgsListMyPendingInvites.queryOptions({}),
  });
  const myInvites: InviteRow[] = (() => {
    const data = myInvitesQuery.data as { invites?: InviteRow[] } | undefined;
    return Array.isArray(data?.invites) ? data.invites : [];
  })();

  const membersQuery = useQuery({
    ...apiQuery.orgsListMembers.queryOptions({
      input: { params: { org_id: selectedId || '' } },
      enabled: Boolean(selectedId),
    }),
  });

  const members: MemberRow[] = (() => {
    const data = membersQuery.data as { members?: MemberRow[] } | undefined;
    return Array.isArray(data?.members) ? data.members : [];
  })();

  const outgoingQuery = useQuery({
    ...apiQuery.orgsListOrgPendingInvites.queryOptions({
      input: { params: { org_id: selectedId || '' } },
      enabled: Boolean(selectedId && canInvite(selected?.role)),
    }),
  });
  const outgoing: InviteRow[] = (() => {
    const data = outgoingQuery.data as { invites?: InviteRow[] } | undefined;
    return Array.isArray(data?.invites) ? data.invites : [];
  })();

  useEffect(() => {
    const q = inviteQuery.trim();
    if (searchTimer.current) window.clearTimeout(searchTimer.current);
    if (q.length < 1 || selectedInvitee) {
      setInviteSearchQ('');
      return;
    }
    searchTimer.current = window.setTimeout(() => {
      setInviteSearchQ(q);
    }, 280);
    return () => {
      if (searchTimer.current) window.clearTimeout(searchTimer.current);
    };
  }, [inviteQuery, selectedInvitee]);

  const inviteSearch = useQuery({
    ...apiQuery.usersUsersSearch.queryOptions({
      input: { query: { q: inviteSearchQ, limit: 12 } },
      enabled: inviteSearchQ.length >= 1 && !selectedInvitee,
    }),
    staleTime: 15_000,
  });
  const searchHits =
    ((inviteSearch.data as { items?: DirectoryUser[] } | undefined)?.items || []);
  const searching =
    !selectedInvitee &&
    inviteQuery.trim().length >= 1 &&
    (inviteSearchQ !== inviteQuery.trim() || inviteSearch.isFetching);

  const invalidateOrgQueries = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: apiQuery.orgsListMyOrgs.key() }),
      qc.invalidateQueries({ queryKey: apiQuery.orgsListMyPendingInvites.key() }),
      qc.invalidateQueries({ queryKey: apiQuery.orgsListMembers.key() }),
      qc.invalidateQueries({ queryKey: apiQuery.orgsListOrgPendingInvites.key() }),
    ]);
  };

  const createMut = useMutation({
    mutationFn: async (orgName: string) =>
      apiClient.orgsCreateOrg({ body: { name: orgName } }) as Promise<{
        org?: OrgRow;
      }>,
    onSuccess: async (res) => {
      message.success(t('account.orgCreated'));
      setName('');
      await qc.invalidateQueries({ queryKey: apiQuery.orgsListMyOrgs.key() });
      const id = res?.org?.id;
      if (id) setSelectedId(id);
    },
    onError: () => message.error(t('account.orgCreateFailed')),
  });

  const inviteMut = useMutation({
    mutationFn: async (opts: {
      orgId: string;
      userId?: string;
      email?: string;
    }) =>
      apiClient.orgsInviteMember({
        params: { org_id: opts.orgId },
        body: {
          userId: opts.userId,
          email: opts.email,
          role: 'member',
        },
      }),
    onSuccess: async (res) => {
      const invite = (res as { invite?: { emailSent?: boolean } } | undefined)?.invite;
      if (invite?.emailSent) message.success(t('account.orgInviteSentEmail'));
      else message.success(t('account.orgInviteSent'));
      setInviteQuery('');
      setSelectedInvitee(null);
      await invalidateOrgQueries();
    },
    onError: (err) => {
      const status = getHttpStatus(err);
      const body = (err as { data?: { body?: { detail?: { code?: string } } } })?.data
        ?.body?.detail;
      const code =
        typeof body === 'object' && body && 'code' in body
          ? String((body as { code?: string }).code || '')
          : '';
      if (code === 'already_member') message.warning(t('account.orgInviteAlreadyMember'));
      else if (status === 404) message.error(t('account.orgInviteUserMissing'));
      else if (status === 403) message.error(t('account.orgInviteForbidden'));
      else message.error(t('account.orgInviteFailed'));
    },
  });

  const acceptMut = useMutation({
    mutationFn: async (inviteId: string) =>
      apiClient.orgsAcceptInvite({ params: { invite_id: inviteId } }),
    onSuccess: async () => {
      message.success(t('account.orgInviteAccepted'));
      await invalidateOrgQueries();
    },
    onError: () => message.error(t('account.orgInviteAcceptFailed')),
  });

  const declineMut = useMutation({
    mutationFn: async (inviteId: string) =>
      apiClient.orgsDeclineInvite({ params: { invite_id: inviteId } }),
    onSuccess: async () => {
      message.success(t('account.orgInviteDeclined'));
      await invalidateOrgQueries();
    },
    onError: () => message.error(t('account.orgInviteDeclineFailed')),
  });

  const renameMut = useMutation({
    mutationFn: async (opts: { orgId: string; name: string }) =>
      apiClient.orgsRenameOrg({
        params: { org_id: opts.orgId },
        body: { name: opts.name },
      }),
    onSuccess: async () => {
      message.success(t('account.orgRenamed'));
      await invalidateOrgQueries();
    },
    onError: () => message.error(t('account.orgRenameFailed')),
  });

  const removeMemberMut = useMutation({
    mutationFn: async (opts: { orgId: string; userId: string }) =>
      apiClient.orgsRemoveMember({
        params: { org_id: opts.orgId, user_id: opts.userId },
      }),
    onSuccess: async () => {
      message.success(t('account.orgMemberRemoved'));
      await invalidateOrgQueries();
    },
    onError: (err) => {
      const status = getHttpStatus(err);
      if (status === 400) message.warning(t('account.orgCannotRemoveOwner'));
      else message.error(t('account.orgMemberRemoveFailed'));
    },
  });

  const onCreate = () => {
    const n = name.trim();
    if (!n) {
      message.warning(t('account.orgNameRequired'));
      return;
    }
    createMut.mutate(n);
  };

  const onInvite = () => {
    if (!selectedId) return;
    if (selectedInvitee?.id) {
      inviteMut.mutate({
        orgId: selectedId,
        userId: selectedInvitee.id,
        email: selectedInvitee.email || undefined,
      });
      return;
    }
    const q = inviteQuery.trim();
    if (q.includes('@')) {
      inviteMut.mutate({ orgId: selectedId, email: q.toLowerCase() });
      return;
    }
    message.warning(t('account.orgInvitePickOrEmail'));
  };

  const onTogglePreferred = (orgId: string) => {
    const next = preferredId === orgId ? null : orgId;
    writePreferredOrgId(next);
    setPreferredId(next);
    message.success(
      next ? t('account.orgPreferredOn') : t('account.orgPreferredOff')
    );
  };

  const inputClass = cn(
    'h-10 w-full rounded-lg border-0 bg-[var(--account-main)] px-3 text-[14px] text-[var(--ink)] outline-none ring-1 ring-[var(--line)]',
    'placeholder:text-[var(--muted)] focus:ring-[var(--ink)]/25 disabled:opacity-60'
  );

  return (
    <div className="space-y-6">
      {myInvites.length > 0 ? (
        <section className="rounded-xl bg-[var(--account-card)] p-6 ring-1 ring-[var(--line)]">
          <h2 className="mb-1 text-[15px] font-semibold text-[var(--ink)]">
            {t('account.orgPendingForYou')}
          </h2>
          <p className="mb-4 text-[13px] text-[var(--muted)]">
            {t('account.orgPendingForYouHint')}
          </p>
          <ul className="space-y-2">
            {myInvites.map((inv) => (
              <li
                key={inv.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-[var(--account-main)] px-3 py-2.5"
              >
                <div className="min-w-0">
                  <div className="truncate text-[14px] font-medium text-[var(--ink)]">
                    {inv.orgName || inv.orgId}
                  </div>
                  <div className="text-[12px] text-[var(--muted)]">
                    {roleLabel(inv.role, t)}
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button
                    shape="round"
                    disabled={acceptMut.isPending || declineMut.isPending}
                    onClick={() => declineMut.mutate(inv.id)}
                  >
                    {t('account.orgInviteDecline')}
                  </Button>
                  <Button
                    type="primary"
                    shape="round"
                    loading={acceptMut.isPending}
                    disabled={acceptMut.isPending || declineMut.isPending}
                    onClick={() => acceptMut.mutate(inv.id)}
                  >
                    {t('account.orgInviteAccept')}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="rounded-xl bg-[var(--account-card)] p-6 ring-1 ring-[var(--line)]">
        <h2 className="mb-1 text-[15px] font-semibold text-[var(--ink)]">
          {t('account.orgCreateTitle')}
        </h2>
        <p className="mb-4 text-[13px] leading-relaxed text-[var(--muted)]">
          {t('account.orgCreateHint')}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, 120))}
            maxLength={120}
            disabled={createMut.isPending}
            className={cn(inputClass, 'max-w-md flex-1')}
            placeholder={t('account.orgNamePlaceholder')}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onCreate();
            }}
          />
          <Button
            type="primary"
            shape="round"
            loading={createMut.isPending}
            disabled={createMut.isPending}
            onClick={onCreate}
          >
            {t('account.orgCreateAction')}
          </Button>
        </div>
      </section>

      <section className="rounded-xl bg-[var(--account-card)] p-6 ring-1 ring-[var(--line)]">
        <h2 className="mb-4 text-[15px] font-semibold text-[var(--ink)]">
          {t('account.orgListTitle')}
        </h2>
        {orgsQuery.isPending ? (
          <LoadingDots
            label={t('common.loading')}
            className="py-10"
          />
        ) : orgs.length === 0 ? (
          <p className="text-[13px] text-[var(--muted)]">{t('account.orgEmpty')}</p>
        ) : (
          <ul className="space-y-2">
            {orgs.map((org) => {
              const active = org.id === selectedId;
              const preferred = org.id === preferredId;
              return (
                <li key={org.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(org.id)}
                    className={cn(
                      'flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left transition',
                      active
                        ? 'bg-[var(--accent-soft)] ring-1 ring-[var(--line)]'
                        : 'hover:bg-[var(--account-main)]'
                    )}
                  >
                    <div className="min-w-0">
                      <div className="truncate text-[14px] font-medium text-[var(--ink)]">
                        {org.name}
                        {preferred ? (
                          <span className="ml-2 text-[11px] font-normal text-[var(--muted)]">
                            {t('account.orgPreferredBadge')}
                          </span>
                        ) : null}
                      </div>
                      <div className="text-[12px] text-[var(--muted)]">
                        {roleLabel(org.role, t)}
                      </div>
                    </div>
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation();
                        onTogglePreferred(org.id);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          e.stopPropagation();
                          onTogglePreferred(org.id);
                        }
                      }}
                      className={cn(
                        'shrink-0 rounded-md px-2 py-1 text-[12px]',
                        preferred
                          ? 'bg-[var(--ink)] text-[var(--surface)]'
                          : 'bg-[var(--account-main)] text-[var(--muted)] ring-1 ring-[var(--line)]'
                      )}
                    >
                      {preferred
                        ? t('account.orgPreferredUnset')
                        : t('account.orgPreferredSet')}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {selected ? (
        <section className="rounded-xl bg-[var(--account-card)] p-6 ring-1 ring-[var(--line)]">
          <h2 className="mb-1 text-[15px] font-semibold text-[var(--ink)]">
            {t('account.orgMembersTitle', { name: selected.name })}
          </h2>
          <p className="mb-4 text-[13px] text-[var(--muted)]">
            {t('account.orgMembersHint')}
          </p>

          {canManageSettings(selected.role) ? (
            <div className="mb-5 flex flex-wrap items-center gap-3">
              <input
                value={renameDraft}
                onChange={(e) => setRenameDraft(e.target.value.slice(0, 120))}
                className={cn(inputClass, 'max-w-md flex-1')}
                placeholder={t('account.orgNamePlaceholder')}
              />
              <Button
                shape="round"
                loading={renameMut.isPending}
                disabled={
                  renameMut.isPending ||
                  !renameDraft.trim() ||
                  renameDraft.trim() === selected.name
                }
                onClick={() => {
                  if (!selectedId) return;
                  renameMut.mutate({
                    orgId: selectedId,
                    name: renameDraft.trim(),
                  });
                }}
              >
                {t('account.orgRenameAction')}
              </Button>
            </div>
          ) : null}

          {membersQuery.isPending ? (
            <LoadingDots
              label={t('common.loading')}
              className="mb-4 py-8"
            />
          ) : (
            <ul className="mb-5 space-y-1.5">
              {members.map((m) => (
                <li
                  key={`${m.user_id}-${m.role}`}
                  className="flex items-center justify-between gap-3 rounded-lg bg-[var(--account-main)] px-3 py-2 text-[13px]"
                >
                  <span className="min-w-0 truncate font-mono text-[var(--ink)]">
                    {m.user_id}
                  </span>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-[var(--muted)]">{roleLabel(m.role, t)}</span>
                    {canInvite(selected.role) && m.role !== 'owner' ? (
                      <button
                        type="button"
                        className="text-[12px] text-red-500 hover:underline"
                        disabled={removeMemberMut.isPending}
                        onClick={() => {
                          if (!selectedId) return;
                          removeMemberMut.mutate({
                            orgId: selectedId,
                            userId: m.user_id,
                          });
                        }}
                      >
                        {t('account.orgMemberRemove')}
                      </button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}

          {canInvite(selected.role) ? (
            <div className="space-y-4 border-t border-[var(--line)] pt-5">
              <div className="relative max-w-md">
                <input
                  value={
                    selectedInvitee
                      ? selectedInvitee.name ||
                        selectedInvitee.email ||
                        selectedInvitee.id
                      : inviteQuery
                  }
                  onChange={(e) => {
                    setSelectedInvitee(null);
                    setInviteQuery(e.target.value.slice(0, 320));
                  }}
                  disabled={inviteMut.isPending}
                  className={inputClass}
                  placeholder={t('account.orgInvitePlaceholder')}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') onInvite();
                  }}
                />
                {(searching || searchHits.length > 0) &&
                inviteQuery.trim() &&
                !selectedInvitee ? (
                  <ul className="absolute z-10 mt-1 max-h-48 w-full overflow-auto rounded-lg bg-[var(--account-card)] py-1 shadow-lg ring-1 ring-[var(--line)]">
                    {searchHits.map((u) => (
                      <li key={u.id}>
                        <button
                          type="button"
                          className="flex w-full flex-col px-3 py-2 text-left text-[13px] hover:bg-[var(--account-main)]"
                          onClick={() => {
                            setSelectedInvitee(u);
                            setInviteQuery('');
                            setInviteSearchQ('');
                          }}
                        >
                          <span className="font-medium text-[var(--ink)]">
                            {u.name || u.email || u.id}
                          </span>
                          {u.email ? (
                            <span className="text-[12px] text-[var(--muted)]">
                              {u.email}
                            </span>
                          ) : null}
                        </button>
                      </li>
                    ))}
                    {!searching && searchHits.length === 0 ? (
                      <li className="px-3 py-2 text-[12px] text-[var(--muted)]">
                        {t('account.orgInviteSearchEmpty')}
                      </li>
                    ) : null}
                  </ul>
                ) : null}
              </div>
              <Button
                type="primary"
                shape="round"
                loading={inviteMut.isPending}
                disabled={inviteMut.isPending}
                onClick={onInvite}
              >
                {t('account.orgInviteAction')}
              </Button>

              {outgoing.length > 0 ? (
                <div className="pt-2">
                  <h3 className="mb-2 text-[13px] font-medium text-[var(--ink)]">
                    {t('account.orgOutgoingPending')}
                  </h3>
                  <ul className="space-y-1.5">
                    {outgoing.map((inv) => (
                      <li
                        key={inv.id}
                        className="flex items-center justify-between gap-3 rounded-lg bg-[var(--account-main)] px-3 py-2 text-[13px]"
                      >
                        <span className="min-w-0 truncate text-[var(--ink)]">
                          {inv.email || inv.userId || inv.id}
                        </span>
                        <span className="shrink-0 text-[var(--muted)]">
                          {t('account.orgInvitePendingBadge')}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : (
            <p className="border-t border-[var(--line)] pt-4 text-[13px] text-[var(--muted)]">
              {t('account.orgInviteNeedAdmin')}
            </p>
          )}
        </section>
      ) : null}
    </div>
  );
}

export default memo(AccountOrgPanel);
