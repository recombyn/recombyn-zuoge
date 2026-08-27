import { useCallback } from 'react';
import {
  removeProjectFromCloud,
  removeProjectsFromCloud,
} from '@/components/editor/useProjectCloudSync';
import { reportProjectDeleteError } from '@/utils/projectDeleteFeedback';

type DeleteOpts = {
  ids: string[];
  deleting: boolean;
  setDeleting: (value: boolean) => void;
  onSuccess: () => void;
  t: (key: string, opts?: Record<string, unknown>) => string;
};

/** Shared delete flow for project list UIs (probe → API → local cleanup). */
export function useProjectDeleteRunner() {
  return useCallback(async (opts: DeleteOpts) => {
    const { ids, deleting, setDeleting, onSuccess, t } = opts;
    if (deleting || !ids.length) return;

    setDeleting(true);
    try {
      if (ids.length === 1) {
        await removeProjectFromCloud(ids[0]);
      } else {
        await removeProjectsFromCloud(ids);
      }
      onSuccess();
    } catch (err) {
      reportProjectDeleteError(err, t);
    } finally {
      setDeleting(false);
    }
  }, []);
}
