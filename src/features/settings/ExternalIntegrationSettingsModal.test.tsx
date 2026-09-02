// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExternalIntegrationSettingsModal } from './ExternalIntegrationSettingsModal';
import * as nativeBridge from '../../api/nativeBridge';

describe('ExternalIntegrationSettingsModal', () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
    vi.restoreAllMocks();

    global.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as any;

    vi.spyOn(nativeBridge, 'getAppExecutablePath').mockResolvedValue(
      'C:\\Program Files\\PrintAssist\\PrintAssist.exe',
    );
    vi.spyOn(nativeBridge, 'getShellIntegrationStatus').mockResolvedValue({
      supported: true,
      fileRegistered: true,
      directoryRegistered: false,
      currentExePath: 'C:\\Program Files\\PrintAssist\\PrintAssist.exe',
      isPathMatched: true,
      isPortable: false,
    });
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('renders Quicker tab with executable path and copy button', async () => {
    render(
      <ExternalIntegrationSettingsModal
        open={true}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText('外部集成 / Quicker 与系统右键')).toBeTruthy();
    expect(screen.getByText('Quicker 动作说明')).toBeTruthy();
    expect(screen.getByText('Quicker 添加文件命令')).toBeTruthy();
  });

  it('switches to Windows Shell context menu tab and displays status', async () => {
    render(
      <ExternalIntegrationSettingsModal
        open={true}
        onClose={vi.fn()}
      />,
    );

    const shellTab = screen.getByText('Windows 资源管理器右键菜单');
    fireEvent.click(shellTab);

    expect(await screen.findByText('菜单注册开关')).toBeTruthy();
    expect(screen.getByText('单文件右键菜单')).toBeTruthy();
    expect(screen.getByText('文件夹右键菜单')).toBeTruthy();
    expect(screen.getByText('检查并修复')).toBeTruthy();
    expect(screen.getByText('全部注销')).toBeTruthy();
  });
});
