import { useEffect } from 'react';
import { listenForProjectOpenProbes } from '@/utils/openProjectSessions';

/** Editor tab: answer delete probes from the home/projects page. */
export function useOpenProjectSession(projectId: string | null | undefined) {
  useEffect(() => listenForProjectOpenProbes(projectId), [projectId]);
}
