import { message } from '@/components/base';
import { ProjectDeleteBlockedError } from '@/components/editor/useProjectCloudSync';

export function reportProjectDeleteError(
  err: unknown,
  t: (key: string) => string
): void {
  if (err instanceof ProjectDeleteBlockedError) {
    message.warning(t('home.deleteProjectOpenBlocked'));
    return;
  }
  message.error(t('home.batchDeleteFailed'));
}
