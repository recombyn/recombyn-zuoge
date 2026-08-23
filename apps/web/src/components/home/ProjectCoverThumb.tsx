import { memo, type ReactNode } from 'react';
import ProjectCoverCollage from '@/components/home/ProjectCoverCollage';

type Props = {
  /** Single URL or up to 4 cover URLs from API — render as-is, no document fallback. */
  thumbnail?: string | string[] | null;
  /** Cache-bust token (updatedAt / revision). */
  version?: number | string | null;
  className?: string;
  children?: ReactNode;
};

/**
 * Project card cover for 最近打开 / 我的项目 — multi-element collage (max 4).
 * Only shows server `thumbnailUrl` tiles; empty API cover → empty card.
 */
function ProjectCoverThumb({
  thumbnail,
  version,
  className,
  children,
}: Props): ReactNode {
  return (
    <ProjectCoverCollage urls={thumbnail} version={version} className={className}>
      {children}
    </ProjectCoverCollage>
  );
}

export default memo(ProjectCoverThumb);
