// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { shouldIgnoreShortcut } from './shortcutGuards';
import {
  getSingleKeyShortcutsEnabled,
  setSingleKeyShortcutsEnabled,
  SHORTCUT_SETTINGS_STORAGE_KEY,
} from './shortcutRegistry';

describe('shortcutRegistry', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults singleKeyShortcutsEnabled to true', () => {
    expect(getSingleKeyShortcutsEnabled()).toBe(true);
  });

  it('persists singleKeyShortcutsEnabled to localStorage', () => {
    setSingleKeyShortcutsEnabled(false);
    expect(getSingleKeyShortcutsEnabled()).toBe(false);

    const stored = localStorage.getItem(SHORTCUT_SETTINGS_STORAGE_KEY);
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored!)).toEqual({ singleKeyEnabled: false });

    setSingleKeyShortcutsEnabled(true);
    expect(getSingleKeyShortcutsEnabled()).toBe(true);
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

  it('ignores single key shortcuts when singleKeyShortcutsEnabled is false', () => {
    setSingleKeyShortcutsEnabled(false);

    const plainA = new KeyboardEvent('keydown', { key: 'A' });
    expect(shouldIgnoreShortcut(plainA, { isSingleKey: true })).toBe(true);

    // However, non-single-key shortcuts are NOT blocked by this setting
    const ctrlP = new KeyboardEvent('keydown', { key: 'P', ctrlKey: true });
    expect(shouldIgnoreShortcut(ctrlP, { isSingleKey: false })).toBe(false);
  });
});
