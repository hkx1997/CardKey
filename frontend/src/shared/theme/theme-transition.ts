/** 主题圆形过渡互斥与计时 */

const DATASET_KEY = "cardkeyThemeTransition";
const END_EVENT = "cardkey-theme-transition-end";

/** 圆形关键帧时长（与 CSS animation 一致） */
export const THEME_VIEW_TRANSITION_MS = 480;
/** 兜底清理，略长于动画 */
export const THEME_TRANSITION_FALLBACK_MS = THEME_VIEW_TRANSITION_MS + 400;

function getRoot() {
  return typeof document === "undefined" ? undefined : document.documentElement;
}

export function isThemeTransitionRunning() {
  return getRoot()?.dataset[DATASET_KEY] === "running";
}

/** 强制清理卡住的过渡状态（防止以后再也进不了圆形动画） */
export function forceEndThemeTransition() {
  const root = getRoot();
  if (!root) return;
  delete root.dataset[DATASET_KEY];
  delete root.dataset.themeCircle;
  root.style.removeProperty("--theme-x");
  root.style.removeProperty("--theme-y");
  root.style.removeProperty("--theme-r");
}

export function beginThemeTransition() {
  const root = getRoot();
  if (!root) return false;
  // 若上次异常残留 running，先清掉再开始
  if (isThemeTransitionRunning()) {
    forceEndThemeTransition();
  }
  root.dataset[DATASET_KEY] = "running";
  return true;
}

export function endThemeTransition() {
  const root = getRoot();
  if (!root) return false;
  const was = isThemeTransitionRunning();
  forceEndThemeTransition();
  if (was) {
    window.dispatchEvent(new CustomEvent(END_EVENT));
  }
  return was;
}
