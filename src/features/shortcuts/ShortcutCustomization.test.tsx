// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ShortcutHelpModal } from './ShortcutHelpModal';
import {
  SHORTCUT_DEFINITIONS,
  loadCustomShortcuts,
  saveCustomShortcuts,
  resetCustomShortcuts,
  getEffectiveShortcuts,
  matchShortcutKeys,
} from './shortcutRegistry';

describe('Shortcut Customization & New Shortcuts', () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('includes undo, redo, prev_profile, and next_profile in definitions', () => {
    const undoDef = SHORTCUT_DEFINITIONS.find((d) => d.id === 'undo');
    const redoDef = SHORTCUT_DEFINITIONS.find((d) => d.id === 'redo');
    const prevProf = SHORTCUT_DEFINITIONS.find((d) => d.id === 'prev_profile');
    const nextProf = SHORTCUT_DEFINITIONS.find((d) => d.id === 'next_profile');

    expect(undoDef?.keys).toEqual(['Ctrl', 'Z']);
    expect(redoDef?.keys).toEqual(['Ctrl', 'Y']);
    expect(prevProf?.keys).toEqual(['-']);
    expect(nextProf?.keys).toEqual(['=']);
  });

  it('matchShortcutKeys matches single keys and combos including - and =', () => {
    const minusEvent = new KeyboardEvent('keydown', { key: '-' });
    expect(matchShortcutKeys(minusEvent, ['-'])).toBe(true);

    const equalEvent = new KeyboardEvent('keydown', { key: '=' });
    expect(matchShortcutKeys(equalEvent, ['='])).toBe(true);

    const ctrlZEvent = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true });
    expect(matchShortcutKeys(ctrlZEvent, ['Ctrl', 'Z'])).toBe(true);
    expect(matchShortcutKeys(ctrlZEvent, ['Ctrl', 'Y'])).toBe(false);

    const ctrlYEvent = new KeyboardEvent('keydown', { key: 'y', ctrlKey: true });
    expect(matchShortcutKeys(ctrlYEvent, ['Ctrl', 'Y'])).toBe(true);
  });

  it('allows customizing shortcuts via recording in ShortcutHelpModal', () => {
    const onCustomChange = vi.fn();
    render(
      <ShortcutHelpModal
        open={true}
        onClose={vi.fn()}
        onCustomShortcutsChange={onCustomChange}
      />,
    );

    // Enter customization mode
    const customBtn = screen.getByRole('button', { name: /自定义快捷键/ });
    fireEvent.click(customBtn);
    expect(screen.getByText('自定义模式')).toBeDefined();

    // Click on '添加文件' row to record
    const addFileRow = screen.getByText('添加文件').closest('.shortcut-compact-row');
    expect(addFileRow).not.toBeNull();
    fireEvent.click(addFileRow!);

    expect(screen.getByText('按下按键...')).toBeDefined();

    // Press 'N' key
    const nEvent = new KeyboardEvent('keydown', { key: 'n', bubbles: true });
    window.dispatchEvent(nEvent);

    // Should have saved custom shortcut ['N']
    expect(onCustomChange).toHaveBeenCalled();
    const loaded = loadCustomShortcuts();
    expect(loaded.add_file).toEqual(['N']);
  });

  it('resets custom shortcuts when reset button is clicked', () => {
    saveCustomShortcuts({ add_file: ['N'] });
    expect(loadCustomShortcuts().add_file).toEqual(['N']);

    const onCustomChange = vi.fn();
    render(
      <ShortcutHelpModal
        open={true}
        onClose={vi.fn()}
        onCustomShortcutsChange={onCustomChange}
      />,
    );

    const resetBtn = screen.getByRole('button', { name: /恢复默认/ });
    fireEvent.click(resetBtn);

    expect(loadCustomShortcuts()).toEqual({});
    expect(onCustomChange).toHaveBeenCalledWith({});
  });
});
