import React, { useRef, useState } from 'react';
import { Tooltip, type TooltipProps } from 'antd';

export interface OverflowTooltipTextProps {
  text: string;
  className?: string;
  tooltipTitle?: React.ReactNode;
  placement?: TooltipProps['placement'];
  onDoubleClick?: (e: React.MouseEvent<HTMLSpanElement>) => void;
  style?: React.CSSProperties;
  role?: string;
  tabIndex?: number;
  onKeyDown?: (e: React.KeyboardEvent<HTMLSpanElement>) => void;
}

export function OverflowTooltipText({
  text,
  className,
  tooltipTitle,
  placement = 'topLeft',
  onDoubleClick,
  style,
  role,
  tabIndex,
  onKeyDown,
}: OverflowTooltipTextProps) {
  const textRef = useRef<HTMLSpanElement>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);

  const checkOverflow = () => {
    const el = textRef.current;
    if (!el) return false;
    return el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1;
  };

  const handleMouseEnter = () => {
    setIsOverflowing(checkOverflow());
  };

  const content = (
    <span
      ref={textRef}
      className={className}
      style={style}
      role={role}
      tabIndex={tabIndex}
      onMouseEnter={handleMouseEnter}
      onDoubleClick={onDoubleClick}
      onKeyDown={onKeyDown}
    >
      {text}
    </span>
  );

  return (
    <Tooltip
      title={isOverflowing ? (tooltipTitle || text) : null}
      placement={placement}
      mouseEnterDelay={0.2}
    >
      {content}
    </Tooltip>
  );
}
