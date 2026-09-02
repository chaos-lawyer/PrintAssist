export interface ShortcutGuardOptions {
  /** 是否允许按下 '/' 呼出快捷键帮助（即便是无特殊焦点） */
  allowHelpSlash?: boolean;
  /** 当前按键是否属于单键快捷键（无修饰键） */
  isSingleKey?: boolean;
}

/**
 * 判断当前按键事件是否处于需要被忽略的上下文中。
 * 满足以下任一条件时，单键/常规快捷键均应被严格忽略：
 * 1. 焦点位于 input, textarea, select, contenteditable 或数值输入控件；
 * 2. 处于中文/输入法合成阶段（event.isComposing 为 true）；
 * 3. 按键长按连发（event.repeat 为 true）；
 * 4. 事件已被上层 defaultPrevented；
 * 5. 页面中存在活动的 Modal、Drawer、选择器下拉菜单或右键上下文菜单；
 * 6. 单键模式下按下了 Ctrl / Alt / Meta 修饰键；
 * 7. 用户在设置中停用了单键快捷键（仅单键被阻断，组合键如 Ctrl+A / Ctrl+P 仍允许）。
 */
function isOverlayVisible(el: Element): boolean {
  if (!(el instanceof HTMLElement)) return false;
  // If element has hidden class
  if (
    el.classList.contains('ant-modal-wrap-hidden') ||
    el.classList.contains('ant-dropdown-hidden') ||
    el.classList.contains('ant-select-dropdown-hidden') ||
    el.classList.contains('ant-drawer-hidden') ||
    el.classList.contains('is-hidden')
  ) {
    return false;
  }
  // If element has inline style display: none (with or without spaces)
  if (el.style.display === 'none') {
    return false;
  }
  if (el.getAttribute('aria-hidden') === 'true') {
    return false;
  }
  // Check if closed/hidden via computed style if available
  if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
    try {
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') {
        return false;
      }
    } catch {
      // ignore
    }
  }
  return true;
}

export function shouldIgnoreShortcut(
  event: KeyboardEvent,
  options?: ShortcutGuardOptions,
): boolean {
  // 1. 已被前置处理或处于长按连发
  if (event.defaultPrevented || event.repeat || event.isComposing) {
    return true;
  }

  // 2. 检查当前焦点元素是否处于输入/编辑态
  const activeEl = document.activeElement as HTMLElement | null;
  const targetEl = event.target as HTMLElement | null;

  const isInputElement = (el: HTMLElement | null): boolean => {
    if (!el || typeof el.tagName !== 'string') return false;
    const tagName = el.tagName.toUpperCase();
    if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') {
      return true;
    }
    if (el.isContentEditable || el.getAttribute?.('contenteditable') === 'true') {
      return true;
    }
    if (
      el.classList &&
      (el.classList.contains('ant-input') ||
        el.classList.contains('ant-input-number-input') ||
        el.classList.contains('ant-select-selection-search-input'))
    ) {
      return true;
    }
    if (typeof el.closest === 'function') {
      return Boolean(el.closest('input, textarea, select, [contenteditable="true"]'));
    }
    return false;
  };

  if (isInputElement(activeEl) || isInputElement(targetEl)) {
    return true;
  }

  // 3. 检查页面中是否存在活动的浮层（Modal, Drawer, 下拉菜单, 右键菜单等）
  const overlays = document.querySelectorAll(
    '.ant-modal-wrap, .ant-drawer-open, .app-context-menu, .ant-dropdown, .ant-select-dropdown',
  );
  let hasActiveOverlay = false;
  for (let i = 0; i < overlays.length; i++) {
    if (isOverlayVisible(overlays[i])) {
      hasActiveOverlay = true;
      break;
    }
  }

  if (hasActiveOverlay) {
    return true;
  }

  // 4. 单键快捷键专属检查
  if (options?.isSingleKey) {
    // 按下了修饰键（Ctrl, Alt, Meta, 或包含 Shift 但非指定）
    if (event.ctrlKey || event.altKey || event.metaKey) {
      return true;
    }
  }

  return false;
}
