import { useMemo, useState, type ReactNode, memo } from 'react';
import TemplateThumbnail from '@/components/templates/TemplateThumbnail';
import LazyTemplateThumb from '@/components/home/LazyTemplateThumb';
import {
  projectThumbFrameClass,
  projectThumbZoomLayerClass,
  withThumbCacheBust,
} from '@/utils/projectThumb';
import {
  extractFrameDocument,
  listArtboardFrames,
} from '@/utils/plazaCover';
import { cn } from '@/utils/classnames';

const MAX_TILES = 4;
const GRID_2_CLASS = 'absolute inset-0 grid grid-cols-2 gap-1 overflow-hidden';
const GRID_4_CLASS = 'absolute inset-0 grid grid-cols-2 grid-rows-2 gap-1 overflow-hidden';

export function normalizeThumbnailUrls(
  input: string | string[] | null | undefined
): string[] {
  if (Array.isArray(input)) {
    return input.map((u) => String(u || '').trim()).filter(Boolean).slice(0, MAX_TILES);
  }
  const one = String(input || '').trim();
  return one ? [one] : [];
}

type DocTile = { id: string; document: unknown };

function collectDocTiles(document: unknown): DocTile[] {
  if (!document || typeof document !== 'object') return [];
  const frames = listArtboardFrames(document).slice(0, MAX_TILES);
  const out: DocTile[] = [];
  for (const frame of frames) {
    const id = String(frame.id || '').trim() || `frame-${out.length}`;
    const slice = extractFrameDocument(document, frame, { contentFit: true });
    if (slice) out.push({ id, document: slice });
  }
  return out;
}

type Props = {
  /** Up to 4 cover image URLs from API. */
  urls?: string | string[] | null;
  version?: number | string | null;
  /** Live document — only for Publish preview when URLs not ready yet. */
  document?: unknown;
  className?: string;
  children?: ReactNode;
};

type Mode = 'urls' | 'docs' | 'doc-full' | 'empty';

function CollageCells({
  count,
  renderCell,
}: {
  count: number;
  renderCell: (index: number, className?: string) => ReactNode;
}) {
  if (count <= 0) return null;
  if (count === 1) {
    return <div className="absolute inset-0 overflow-hidden">{renderCell(0)}</div>;
  }
  if (count === 2) {
    return (
      <div className={GRID_2_CLASS}>
        {renderCell(0)}
        {renderCell(1)}
      </div>
    );
  }
  if (count === 3) {
    return (
      <div className={GRID_4_CLASS}>
        {renderCell(0, 'row-span-2')}
        {renderCell(1)}
        {renderCell(2)}
      </div>
    );
  }
  return (
    <div className={GRID_4_CLASS}>
      {renderCell(0)}
      {renderCell(1)}
      {renderCell(2)}
      {renderCell(3)}
    </div>
  );
}

/**
 * Project card cover for 最近打开 / 我的项目 — multi `<img>` collage (max 4).
 * Layout: 1 full · 2 side-by-side · 3 tall-left · 4 = 2×2 CSS grid (equal gutters).
 */
function ProjectCoverCollage({
  urls,
  version,
  document,
  className,
  children,
}: Props) {
  const urlTiles = useMemo(
    () =>
      normalizeThumbnailUrls(urls)
        .map((u) => withThumbCacheBust(u, version))
        .filter(Boolean),
    [urls, version]
  );
  const docTiles = useMemo(() => collectDocTiles(document), [document]);

  const { mode, imgList } = useMemo((): { mode: Mode; imgList: string[] } => {
    if (urlTiles.length >= 1) return { mode: 'urls', imgList: urlTiles };
    if (docTiles.length >= 1) return { mode: 'docs', imgList: [] };
    if (document) return { mode: 'doc-full', imgList: [] };
    return { mode: 'empty', imgList: [] };
  }, [urlTiles, docTiles, document]);

  if (mode === 'doc-full') {
    return (
      <LazyTemplateThumb document={document} fit="cover" className={className}>
        {children}
      </LazyTemplateThumb>
    );
  }

  let collage: ReactNode = null;
  if (mode === 'urls') {
    collage = <ImgCollage urls={imgList} />;
  } else if (mode === 'docs') {
    collage = <DocCollage tiles={docTiles} />;
  }

  return (
    <div className={projectThumbFrameClass(className)}>
      {collage ? (
        <div className={cn('absolute inset-0', projectThumbZoomLayerClass)}>{collage}</div>
      ) : null}
      {children}
    </div>
  );
}

/** Grid cell: min-h-0 so tall imgs cannot blow past the 170px frame; overflow clips. */
function ImgTile({ src, className }: { src: string; className?: string }) {
  const [errored, setErrored] = useState(false);
  if (errored) return null;
  return (
    <div className={cn('relative min-h-0 min-w-0 overflow-hidden', className)}>
      <img
        src={src}
        alt=""
        className="absolute inset-0 h-full w-full bg-[var(--canvas)] object-cover"
        loading="lazy"
        onError={() => setErrored(true)}
      />
    </div>
  );
}

/** Multi-tile collage — always map ``thumbnailUrl`` list to ``<img>`` (max 4). */
function ImgCollage({ urls }: { urls: string[] }) {
  const list = urls.filter(Boolean).slice(0, MAX_TILES);
  return (
    <CollageCells
      count={list.length}
      renderCell={(index, cellClass) => (
        <ImgTile key={list[index]} src={list[index]!} className={cellClass} />
      )}
    />
  );
}

function DocCollage({ tiles }: { tiles: DocTile[] }) {
  const list = tiles.slice(0, MAX_TILES);
  return (
    <CollageCells
      count={list.length}
      renderCell={(index, cellClass) => {
        const tile = list[index]!;
        return (
          <div
            key={tile.id}
            className={cn('relative min-h-0 min-w-0 overflow-hidden', cellClass)}
          >
            <TemplateThumbnail document={tile.document} fit="cover" />
          </div>
        );
      }}
    />
  );
}

export default memo(ProjectCoverCollage);
