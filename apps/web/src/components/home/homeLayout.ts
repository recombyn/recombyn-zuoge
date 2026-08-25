/** Fixed home main column width — side gutters come from `mx-auto`, not large px padding. */
export const HOME_CONTENT_MAX_PX = 1300;

/**
 * Scrollable home main pane — reserve gutter so scrollbar never shifts the 1300 shell.
 */
export const HOME_MAIN_SCROLL =
  'relative min-h-0 w-full min-w-0 flex-1 overflow-y-auto overflow-x-hidden bg-transparent [scrollbar-gutter:stable]';

/**
 * Centered shell for 创作 / 灵感 / 项目 / 技能.
 * Desktop: 1300px content; narrow viewports keep minimal inline padding only.
 */
export const HOME_MAIN_SHELL =
  'relative mx-auto box-border w-full min-w-0 max-w-[1300px] px-4 pb-10 pt-[25px] lg:px-0';

/** Skills — 3 cards per row inside the 1300 shell. */
export const HOME_SKILL_GRID =
  'grid w-full grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3';

/**
 * Home content grids (项目 / 灵感 / 资产 / 喜欢) — same breakpoints.
 * Mobile 2 → md 3 → xl 4 (fills the 1300 shell on large screens).
 */
export const HOME_FLOW_GRID =
  'grid w-full grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4';

/** @deprecated alias — use HOME_FLOW_GRID */
export const HOME_INSPIRATION_COLUMNS = HOME_FLOW_GRID;

/** @deprecated alias — use HOME_FLOW_GRID */
export const HOME_PROJECT_GRID = HOME_FLOW_GRID;
