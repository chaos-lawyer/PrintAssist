// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { shouldIgnoreShortcut } from './shortcutGuards';
import {
  loadCustomShortcuts,
  saveCustomShortcuts,
  resetCustomShortcuts,
  matchShortcutKeys,
  CUSTOM_SHORTCUTS_STORAGE_KEY,
} from './shortcutRegistry';

describe('shortcutRegistry custom shortcuts', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('loads empty custom shortcuts by default', () => {
    expect(loadCustomShortcuts()).toEqual({});
  });

  it('persists custom shortcuts to localStorage', () => {
    saveCustomShortcuts({ add_file: ['Ctrl', 'N'] });
    expect(loadCustomShortcuts()).toEqual({ add_file: ['Ctrl', 'N'] });

    const stored = localStorage.getItem(CUSTOM_SHORTCUTS_STORAGE_KEY);
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored!)).toEqual({ add_file: ['Ctrl', 'N'] });

    resetCustomShortcuts();
    expect(loadCustomShortcuts()).toEqual({});
  });

  it('matches keyboard event correctly with matchShortcutKeys', () => {
    const ctrlZ = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true });
    expect(matchShortcutKeys(ctrlZ, ['Ctrl', 'Z'])).toBe(true);
    expect(matchShortcutKeys(ctrlZ, ['Ctrl', 'Y'])).toBe(false);

    const minus = new KeyboardEvent('keydown', { key: '-' });
    expect(matchShortcutKeys(minus, ['-'])).toBe(true);

    const equal = new KeyboardEvent('keydown', { key: '=' });
    expect(matchShortcutKeys(equal, ['='])).toBe(true);
  });
});

describe('shouldIgnoreShortcut', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('ignores shortcut when event.defaultPrevented is true', () => {
    const event = new KeyboardEvent('keydown', { key: 'A' });
    Object.defineProperty(event, 'defaultPrevented', { value: true });

    expect(shouldIgnoreShortcut(event, { isSingleKey: true })).toBe(true);
  });

  it('ignores shortcut when event.repeat is true', () => {
    const event = new KeyboardEvent('keydown', { key: 'A', repeat: true });
    expect(shouldIgnoreShortcut(event, { isSingleKey: true })).toBe(true);
  });

  it('ignores shortcut when event.isComposing is true', () => {
    const event = new KeyboardEvent('keydown', { key: 'A' });
    Object.defineProperty(event, 'isComposing', { value: true });
    expect(shouldIgnoreShortcut(event, { isSingleKey: true })).toBe(true);
  });

  it('ignores shortcut when active element is an input or textarea', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    const event = new KeyboardEvent('keydown', { key: 'A' });
    expect(shouldIgnoreShortcut(event, { isSingleKey: true })).toBe(true);

    input.blur();
    expect(shouldIgnoreShortcut(event, { isSingleKey: true })).toBe(false);
  });

  it('ignores shortcut when element is contenteditable', () => {
    const div = document.createElement('div');
    div.setAttribute('contenteditable', 'true');
    document.body.appendChild(div);
    div.focus();

    const event = new KeyboardEvent('keydown', { key: 'S' });
    expect(shouldIgnoreShortcut(event, { isSingleKey: true })).toBe(true);
  });

  it('ignores shortcut when a modal overlay is active in DOM', () => {
    const modalWrap = document.createElement('div');
    modalWrap.className = 'ant-modal-wrap';
    document.body.appendChild(modalWrap);

    const event = new KeyboardEvent('keydown', { key: 'A' });
    expect(shouldIgnoreShortcut(event, { isSingleKey: true })).toBe(true);

    modalWrap.remove();
    expect(shouldIgnoreShortcut(event, { isSingleKey: true })).toBe(false);
  });

  it('ignores single key shortcut when modifier key is pressed', () => {
    const ctrlA = new KeyboardEvent('keydown', { key: 'A', ctrlKey: true });
    expect(shouldIgnoreShortcut(ctrlA, { isSingleKey: true })).toBe(true);

    const altS = new KeyboardEvent('keydown', { key: 'S', altKey: true });
    expect(shouldIgnoreShortcut(altS, { isSingleKey: true })).toBe(true);

    const plainA = new KeyboardEvent('keydown', { key: 'A' });
    expect(shouldIgnoreShortcut(plainA, { isSingleKey: true })).toBe(false);
  });
});
