import { memo } from 'react';
import WalletAccountChip from '@/components/layout/WalletAccountChip';

/** Home header trailing actions — account chip only (lang/theme live in account menu / login). */
function AuthHeader() {
  return (
    <div className="flex shrink-0 items-center gap-3">
      <WalletAccountChip />
    </div>
  );
}

export default memo(AuthHeader);
