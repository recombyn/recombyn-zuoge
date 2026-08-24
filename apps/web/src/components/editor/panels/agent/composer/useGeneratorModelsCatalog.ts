import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ChatModelsResponse, LlmModel } from '@/service/chat';
import { apiQuery } from '@/service/client';

export function useGeneratorModelsCatalog(opts: {
  buildList: (res: ChatModelsResponse | undefined) => LlmModel[];
  modelId: string;
  setModelId: (id: string) => void;
  /** Pick or normalize model id after catalog load (e.g. nextVideoModelId). */
  resolveModelId?: (list: LlmModel[], currentId: string) => string | null;
  resetKey?: string;
}) {
  const { buildList, modelId, setModelId, resolveModelId, resetKey } = opts;
  const [models, setModels] = useState<LlmModel[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [catalogAvailable, setCatalogAvailable] = useState<boolean | null>(null);

  const modelsCatalogQuery = useQuery({
    ...apiQuery.chatGetModels.queryOptions(),
    staleTime: 60_000,
  });

  useEffect(() => {
    if (modelsCatalogQuery.isPending) {
      setStatus('loading');
      setCatalogAvailable(null);
      return;
    }
    if (modelsCatalogQuery.isError) {
      setModels([]);
      setStatus('error');
      setCatalogAvailable(false);
      return;
    }
    if (!modelsCatalogQuery.isFetched) return;
    const res = modelsCatalogQuery.data as ChatModelsResponse | undefined;
    if (!res) {
      setModels([]);
      setStatus('error');
      setCatalogAvailable(false);
      return;
    }
    const list = buildList(res);
    setModels(list);
    setStatus('ready');
    setCatalogAvailable(Boolean(res.available));
    const nextId = resolveModelId
      ? resolveModelId(list, modelId)
      : list.length && !list.some((m) => m.id === modelId)
        ? (list[0]?.id ?? null)
        : null;
    if (nextId) setModelId(nextId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    modelsCatalogQuery.data,
    modelsCatalogQuery.isPending,
    modelsCatalogQuery.isError,
    modelsCatalogQuery.isFetched,
    resetKey,
    resolveModelId,
  ]);

  return { models, status, catalogAvailable, modelsCatalogQuery };
}
