import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Tooltip } from 'antd';
import { Check } from 'lucide-react';

export interface AppContextMenuActionItem {
  key: string;
  label: React.ReactNode;
  icon?: React.ReactNode;
  shortcut?: string;
  disabled?: boolean;
  disabledReason?: string;
  danger?: boolean;
  hidden?: boolean;
  checked?: boolean;
  onClick?: () => void;
}

export interface AppContextMenuDividerItem {
  type: 'divider';
  key?: string;
  hidden?: boolean;
}

export type AppContextMenuItem = AppContextMenuActionItem | AppContextMenuDividerItem;

export interface AppContextMenuProps {
  open: boolean;
  position: { x: number; y: number } | null;
  onClose: () => void;
  items: AppContextMenuItem[];
  minWidth?: number;
  zIndex?: number;
  ariaLabel?: string;
}

export function AppContextMenu({
  open,
  position,
  onClose,
  items,
  minWidth = 180,
  zIndex = 14000,
  ariaLabel = '操作菜单',
}: AppContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  const visibleItems = items.filter((item) => !item.hidden);

  // Calculate clamped viewport position
  useLayoutEffect(() => {
    if (!open || !position) return;

    let targetX = position.x;
    let targetY = position.y;

    if (menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      if (targetX + rect.width > viewportWidth - 8) {
        targetX = Math.max(8, viewportWidth - rect.width - 8);
      }
      if (targetY + rect.height > viewportHeight - 8) {
        targetY = Math.max(8, viewportHeight - rect.height - 8);
      }
    }

    setCoords({ x: targetX, y: targetY });
  }, [open, position, visibleItems.length]);

  // Click outside, scroll, resize, blur and Escape handling
  useEffect(() => {
    if (!open) return;

    const handleMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleScroll = () => {
      onClose();
    };

    const handleResizeOrBlur = () => {
      onClose();
    };

    document.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleResizeOrBlur);
    window.addEventListener('blur', handleResizeOrBlur);

    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleResizeOrBlur);
      window.removeEventListener('blur', handleResizeOrBlur);
    };
  }, [open, onClose]);

  // Keyboard navigation
  useEffect(() => {
    if (!open) return;

    // Focus the first non-disabled button on mount
    const timer = setTimeout(() => {
      if (menuRef.current) {
        const buttons = Array.from(
          menuRef.current.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
        );
        if (buttons.length > 0) {
          buttons[0].focus();
        }
      }
    }, 0);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!menuRef.current) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }

      if (e.key === 'Tab') {
        onClose();
        return;
      }

      const buttons = Array.from(
        menuRef.current.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
      );
      if (buttons.length === 0) return;

      const currentIndex = buttons.indexOf(document.activeElement as HTMLButtonElement);

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const nextIndex = currentIndex < 0 || currentIndex >= buttons.length - 1 ? 0 : currentIndex + 1;
        buttons[nextIndex].focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const prevIndex = currentIndex <= 0 ? buttons.length - 1 : currentIndex - 1;
        buttons[prevIndex].focus();
      } else if (e.key === 'Home') {
        e.preventDefault();
        buttons[0].focus();
      } else if (e.key === 'End') {
        e.preventDefault();
        buttons[buttons.length - 1].focus();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, onClose]);

  if (!open || !position || visibleItems.length === 0) {
    return null;
  }

  const handleItemClick = (item: AppContextMenuActionItem) => {
    if (item.disabled) return;
    onClose();
    item.onClick?.();
  };

  return createPortal(
    <div
      ref={menuRef}
      className="app-context-menu"
      role="menu"
      aria-label={ariaLabel}
      style={{
        position: 'fixed',
        left: coords.x,
        top: coords.y,
        minWidth,
        zIndex,
      }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {visibleItems.map((item, index) => {
        if ('type' in item && item.type === 'divider') {
          return (
            <div
              key={item.key || `divider-${index}`}
              className="app-context-menu-divider"
              role="separator"
            />
          );
        }

        const actionItem = item as AppContextMenuActionItem;
        const button = (
          <button
            key={actionItem.key}
            type="button"
            role="menuitem"
            className={`app-context-menu-item ${actionItem.danger ? 'is-danger' : ''} ${
              actionItem.disabled ? 'is-disabled' : ''
            }`}
            disabled={actionItem.disabled}
            onClick={(e) => {
              e.stopPropagation();
              handleItemClick(actionItem);
            }}
          >
            <span className="app-context-menu-icon">
              {actionItem.checked !== undefined ? (
                actionItem.checked ? (
                  <Check size={14} className="app-context-menu-check-icon" />
                ) : (
                  <span className="app-context-menu-check-placeholder" />
                )
              ) : (
                actionItem.icon || null
              )}
            </span>
            <span className="app-context-menu-label">{actionItem.label}</span>
            {actionItem.shortcut && (
              <span className="app-context-menu-shortcut">{actionItem.shortcut}</span>
            )}
          </button>
        );

        if (actionItem.disabled && actionItem.disabledReason) {
          return (
            <Tooltip
              key={actionItem.key}
              title={actionItem.disabledReason}
              placement="right"
            >
              <span className="app-context-menu-disabled-wrapper">{button}</span>
            </Tooltip>
          );
        }

        return button;
      })}
    </div>,
    document.body,
  );
}
