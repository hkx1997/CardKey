/** 主题过渡互斥（对齐 bh-web） */

const DATASET_KEY = "cardkeyThemeTransition";
const END_EVENT = "cardkey-theme-transition-end";

/** 对齐 bh theme-button：450ms 圆形关键帧 */
export const THEME_TRANSITION_FALLBACK_MS = 1200;
export const THEME_VIEW_TRANSITION_MS = 450;

function getRoot() {
  return typeof document === "undefined" ? undefined : document.documentElement;
}

export function isThemeTransitionRunning() {
  return getRoot()?.dataset[DATASET_KEY] === "running";
}

export function beginThemeTransition() {
  const root = getRoot();
  if (!root || isThemeTransitionRunning()) return false;
  root.dataset[DATASET_KEY] = "running";
  return true;
}

export function endThemeTransition() {
  const root = getRoot();
  if (!root || !isThemeTransitionRunning()) return false;
  delete root.dataset[DATASET_KEY];
  window.dispatchEvent(new CustomEvent(END_EVENT));
  return true;
}
