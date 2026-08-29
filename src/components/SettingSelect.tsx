import { ChevronDown, Check } from 'lucide-react';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/* ────────────────────────────────────────────────────────────────────
 *  SettingSelect — WebView2-safe unified dropdown selector.
 *  Uses position:fixed + createPortal, no Ant Design Select portal.
 * ──────────────────────────────────────────────────────────────────── */

const MENU_GAP = 6;
const VIEWPORT_PAD = 8;
const PREFERRED_MAX_HEIGHT = 280;

export interface SettingSelectOption<T extends string | number = string> {
  value: T;
  label: string;
  disabled?: boolean;
  title?: string;
}

interface MenuPosition {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
  placement: 'bottom' | 'top';
}

interface SettingSelectProps<T extends string | number = string> {
  value: T;
  options: SettingSelectOption<T>[];
  ariaLabelledBy?: string;
  placeholder?: string;
  disabled?: boolean;
  loading?: boolean;
  onChange: (value: T) => void;
}

/** Global close event: when any SettingSelect opens, others close. */
const CLOSE_EVENT = 'setting-select-close';

export function SettingSelect<T extends string | number = string>({
  value,
  options,
  ariaLabelledBy,
  placeholder,
  disabled,
  loading,
  onChange,
}: SettingSelectProps<T>) {
  const instanceId = useId();
  const listboxId = `setting-select-listbox-${instanceId}`;

  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<MenuPosition | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // ── Position calculation ──────────────────────────────────────────
  const updatePosition = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const vh = window.innerHeight;
    const vw = window.innerWidth;

    const below = vh - rect.bottom - MENU_GAP - VIEWPORT_PAD;
    const above = rect.top - MENU_GAP - VIEWPORT_PAD;
    const preferBottom = below >= Math.min(PREFERRED_MAX_HEIGHT, 160) || below >= above;
    const available = Math.max(120, preferBottom ? below : above);
    const maxHeight = Math.min(PREFERRED_MAX_HEIGHT, available);
    const width = Math.min(Math.max(rect.width, 180), vw - VIEWPORT_PAD * 2);
    const rawLeft = rect.left;
    const left = Math.min(
      Math.max(VIEWPORT_PAD, rawLeft),
      vw - width - VIEWPORT_PAD,
    );
    const top = preferBottom
      ? rect.bottom + MENU_GAP
      : Math.max(VIEWPORT_PAD, rect.top - MENU_GAP - maxHeight);

    setMenuPos({ top, left, width, maxHeight, placement: preferBottom ? 'bottom' : 'top' });
  }, []);

  // ── Open / close logic ────────────────────────────────────────────
  const openMenu = useCallback(() => {
    // Signal other instances to close
    window.dispatchEvent(new CustomEvent(CLOSE_EVENT, { detail: instanceId }));
    setOpen(true);
    const selectedIdx = options.findIndex((o) => o.value === value);
    setActiveIndex(selectedIdx >= 0 ? selectedIdx : 0);
  }, [instanceId, options, value]);

  const closeMenu = useCallback((returnFocus = true) => {
    setOpen(false);
    setMenuPos(null);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  // Close when another SettingSelect opens
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail !== instanceId && open) {
        setOpen(false);
        setMenuPos(null);
      }
    };
    window.addEventListener(CLOSE_EVENT, handler);
    return () => window.removeEventListener(CLOSE_EVENT, handler);
  }, [instanceId, open]);

  // Compute position when open
  useLayoutEffect(() => {
    if (open) updatePosition();
  }, [open, updatePosition]);

  // Reposition on scroll/resize
  useEffect(() => {
    if (!open) return;
    const handler = () => updatePosition();
    window.addEventListener('resize', handler);
    window.addEventListener('scroll', handler, true);
    return () => {
      window.removeEventListener('resize', handler);
      window.removeEventListener('scroll', handler, true);
    };
  }, [open, updatePosition]);

  // Click outside to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        triggerRef.current?.contains(target) ||
        menuRef.current?.contains(target)
      ) {
        return;
      }
      closeMenu(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, closeMenu]);

  // ── Keyboard navigation ───────────────────────────────────────────
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const enabledOptions = options.filter((o) => !o.disabled);

      if (!open) {
        if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
          e.preventDefault();
          openMenu();
        }
        return;
      }

      switch (e.key) {
        case 'ArrowDown': {
          e.preventDefault();
          let next = activeIndex + 1;
          while (next < options.length && options[next].disabled) next++;
          if (next < options.length) {
            setActiveIndex(next);
            scrollOptionIntoView(next);
          }
          break;
        }
        case 'ArrowUp': {
          e.preventDefault();
          let prev = activeIndex - 1;
          while (prev >= 0 && options[prev].disabled) prev--;
          if (prev >= 0) {
            setActiveIndex(prev);
            scrollOptionIntoView(prev);
          }
          break;
        }
        case 'Home': {
          e.preventDefault();
          const first = options.findIndex((o) => !o.disabled);
          if (first >= 0) {
            setActiveIndex(first);
            scrollOptionIntoView(first);
          }
          break;
        }
        case 'End': {
          e.preventDefault();
          let last = options.length - 1;
          while (last >= 0 && options[last].disabled) last--;
          if (last >= 0) {
            setActiveIndex(last);
            scrollOptionIntoView(last);
          }
          break;
        }
        case 'Enter':
        case ' ': {
          e.preventDefault();
          const opt = options[activeIndex];
          if (opt && !opt.disabled) {
            onChange(opt.value);
            closeMenu();
          }
          break;
        }
        case 'Escape':
        case 'Tab': {
          e.preventDefault();
          closeMenu();
          break;
        }
      }
    },
    [open, activeIndex, options, onChange, openMenu, closeMenu],
  );

  const scrollOptionIntoView = (index: number) => {
    requestAnimationFrame(() => {
      menuRef.current
        ?.querySelector(`[data-option-index="${index}"]`)
        ?.scrollIntoView({ block: 'nearest' });
    });
  };

  // ── Render ────────────────────────────────────────────────────────
  const selectedOption = options.find((o) => o.value === value);
  const displayLabel = selectedOption?.label ?? placeholder ?? '';

  const menu =
    open && menuPos
      ? createPortal(
          <div
            ref={menuRef}
            id={listboxId}
            className={`setting-select-menu setting-select-menu--${menuPos.placement}`}
            role="listbox"
            tabIndex={-1}
            aria-labelledby={ariaLabelledBy}
            aria-activedescendant={
              activeIndex >= 0 ? `${listboxId}-opt-${activeIndex}` : undefined
            }
            style={{
              top: menuPos.top,
              left: menuPos.left,
              width: menuPos.width,
              maxHeight: menuPos.maxHeight,
            }}
          >
            {options.map((opt, i) => {
              const isSelected = opt.value === value;
              const isFocused = i === activeIndex;
              return (
                <button
                  key={String(opt.value)}
                  id={`${listboxId}-opt-${i}`}
                  type="button"
                  role="option"
                  data-option-index={i}
                  aria-selected={isSelected}
                  aria-disabled={opt.disabled}
                  className={`setting-select-option${isSelected ? ' is-selected' : ''}${
                    isFocused ? ' is-focused' : ''
                  }${opt.disabled ? ' is-disabled' : ''}`}
                  title={opt.title}
                  onClick={() => {
                    if (opt.disabled) return;
                    onChange(opt.value);
                    closeMenu();
                  }}
                  onMouseEnter={() => setActiveIndex(i)}
                >
                  <span className="setting-select-option-label">{opt.label}</span>
                  {isSelected && (
                    <Check size={14} className="setting-select-check" aria-hidden />
                  )}
                </button>
              );
            })}
          </div>,
          document.body,
        )
      : null;

  return (
    <div className="setting-select">
      <button
        ref={triggerRef}
        type="button"
        className={`setting-select-trigger${open ? ' is-open' : ''}${
          loading ? ' is-loading' : ''
        }`}
        aria-labelledby={ariaLabelledBy}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        disabled={disabled || loading}
        onClick={() => (open ? closeMenu() : openMenu())}
        onKeyDown={handleKeyDown}
      >
        <span className="setting-select-value">{displayLabel}</span>
        <ChevronDown size={14} className="setting-select-caret" aria-hidden />
      </button>
      {menu}
    </div>
  );
}
