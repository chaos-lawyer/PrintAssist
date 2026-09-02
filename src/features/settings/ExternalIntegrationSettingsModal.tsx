import {
  Alert,
  Button,
  Card,
  Divider,
  Input,
  Modal,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  CheckCircle2,
  AlertTriangle,
  Copy,
  ExternalLink,
  Info,
  RefreshCw,
  Terminal,
  Trash2,
  Wrench,
  XCircle,
  Play,
} from 'lucide-react';
import React, { useCallback, useEffect, useState } from 'react';
import {
  getAppExecutablePath,
  getShellIntegrationStatus,
  registerShellIntegration,
  repairShellIntegration,
  unregisterShellIntegration,
  type ShellIntegrationStatus,
  pickFiles,
} from '../../api/nativeBridge';
import {
  buildQuickerAddCommand,
  clearExternalLogs,
  loadExternalLogs,
  type ExternalRequestLogEntry,
} from '../external/externalRequestHandler';
import type { ExternalRequestV1 } from '../external/externalTypes';

interface ExternalIntegrationSettingsModalProps {
  open: boolean;
  onClose: () => void;
  onSimulateExternalRequest?: (request: ExternalRequestV1) => void;
}

export const ExternalIntegrationSettingsModal: React.FC<ExternalIntegrationSettingsModalProps> = ({
  open,
  onClose,
  onSimulateExternalRequest,
}) => {
  const [activeTab, setActiveTab] = useState('quicker');
  const [exePath, setExePath] = useState<string>('PrintAssist.exe');
  const [shellStatus, setShellStatus] = useState<ShellIntegrationStatus | null>(null);
  const [loadingShell, setLoadingShell] = useState(false);
  const [logs, setLogs] = useState<ExternalRequestLogEntry[]>([]);

  const fetchStatus = useCallback(async () => {
    try {
      setLoadingShell(true);
      const [path, status] = await Promise.all([
        getAppExecutablePath(),
        getShellIntegrationStatus(),
      ]);
      setExePath(path);
      setShellStatus(status);
    } catch {
      // ignore
    } finally {
      setLoadingShell(false);
    }
  }, []);

  const refreshLogs = useCallback(() => {
    setLogs(loadExternalLogs());
  }, []);

  useEffect(() => {
    if (open) {
      void fetchStatus();
      refreshLogs();
    }
  }, [open, fetchStatus, refreshLogs]);

  const handleCopyText = async (text: string, tip: string) => {
    try {
      await navigator.clipboard.writeText(text);
      message.success(tip);
    } catch {
      message.error('复制失败');
    }
  };

  const handleToggleFiles = async (checked: boolean) => {
    if (!shellStatus) return;
    try {
      setLoadingShell(true);
      const res = await registerShellIntegration({
        enableFiles: checked,
        enableDirectories: shellStatus.directoryRegistered,
      });
      setShellStatus(res);
      message.success(checked ? '已启用文件右键菜单' : '已关闭文件右键菜单');
    } catch (err) {
      message.error(err instanceof Error ? err.message : '更新右键菜单失败');
    } finally {
      setLoadingShell(false);
    }
  };

  const handleToggleDirectories = async (checked: boolean) => {
    if (!shellStatus) return;
    try {
      setLoadingShell(true);
      const res = await registerShellIntegration({
        enableFiles: shellStatus.fileRegistered,
        enableDirectories: checked,
      });
      setShellStatus(res);
      message.success(checked ? '已启用文件夹右键菜单' : '已关闭文件夹右键菜单');
    } catch (err) {
      message.error(err instanceof Error ? err.message : '更新右键菜单失败');
    } finally {
      setLoadingShell(false);
    }
  };

  const handleRepairShell = async () => {
    try {
      setLoadingShell(true);
      const res = await repairShellIntegration();
      setShellStatus(res);
      message.success('已将系统右键菜单修复并指向当前程序路径');
    } catch (err) {
      message.error(err instanceof Error ? err.message : '修复失败');
    } finally {
      setLoadingShell(false);
    }
  };

  const handleUnregisterShell = async () => {
    try {
      setLoadingShell(true);
      const res = await unregisterShellIntegration();
      setShellStatus(res);
      message.success('已注销全部右键菜单');
    } catch (err) {
      message.error(err instanceof Error ? err.message : '注销失败');
    } finally {
      setLoadingShell(false);
    }
  };

  const handleClearLogs = () => {
    clearExternalLogs();
    refreshLogs();
    message.success('已清空外部调用日志');
  };

  const handleTestCall = async () => {
    try {
      const selected = await pickFiles();
      if (!selected || selected.length === 0) return;

      const testReq: ExternalRequestV1 = {
        version: 1,
        requestId: `test_${Date.now()}`,
        action: 'add',
        paths: selected,
        duplicatePolicy: 'ask',
      };

      if (onSimulateExternalRequest) {
        onSimulateExternalRequest(testReq);
        message.success(`已模拟发送外部添加请求（${selected.length} 个文件）`);
        setTimeout(() => refreshLogs(), 300);
      }
    } catch (err) {
      message.error(err instanceof Error ? err.message : '测试调用失败');
    }
  };

  const quickerAddCommand = buildQuickerAddCommand(exePath);

  const logColumns: ColumnsType<ExternalRequestLogEntry> = [
    {
      title: '时间',
      dataIndex: 'timestamp',
      key: 'timestamp',
      width: 150,
      render: (t: number) => new Date(t).toLocaleTimeString('zh-CN', { hour12: false }),
    },
    {
      title: '动作',
      dataIndex: 'action',
      key: 'action',
      width: 80,
      align: 'center',
      render: (a: 'add' | 'print') =>
        a === 'print' ? <Tag color="blue">直接打印</Tag> : <Tag color="cyan">追加文件</Tag>,
    },
    {
      title: '文件数',
      dataIndex: 'pathsCount',
      key: 'pathsCount',
      width: 80,
      align: 'right',
      render: (c: number) => `${c} 个`,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 90,
      align: 'center',
      render: (s: string) => {
        if (s === 'completed') return <Tag color="green">完成</Tag>;
        if (s === 'accepted') return <Tag color="blue">已接受</Tag>;
        if (s === 'rejected') return <Tag color="orange">已拒绝</Tag>;
        return <Tag color="red">失败</Tag>;
      },
    },
    {
      title: '信息',
      dataIndex: 'message',
      key: 'message',
      ellipsis: true,
    },
  ];

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={[
        <Button key="close" type="primary" onClick={onClose}>
          完成
        </Button>,
      ]}
      title={
        <Space align="center" size={8}>
          <Terminal size={18} style={{ color: '#1557d0' }} />
          <span>外部集成 / Quicker 与系统右键</span>
        </Space>
      }
      width={720}
      destroyOnClose
    >
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          {
            key: 'quicker',
            label: 'Quicker 动作集成',
            children: (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <Alert
                  type="info"
                  showIcon
                  icon={<Info size={16} />}
                  message="Quicker 动作说明"
                  description="在 Windows 资源管理器中选中文件后，通过 Quicker 动作将文件追加到打印助手当前任务，或绑定指定收藏模板直接打印。"
                />

                <Card size="small" title="当前程序执行路径">
                  <Space.Compact style={{ width: '100%' }}>
                    <Input readOnly value={exePath} style={{ fontFamily: 'monospace' }} />
                    <Button
                      icon={<Copy size={14} />}
                      onClick={() => handleCopyText(exePath, '已复制程序绝对路径')}
                    >
                      复制路径
                    </Button>
                  </Space.Compact>
                </Card>

                <Card
                  size="small"
                  title="Quicker 添加文件命令"
                  extra={
                    <Button
                      type="link"
                      size="small"
                      icon={<Copy size={13} />}
                      onClick={() => handleCopyText(quickerAddCommand, '已复制 Quicker 添加命令')}
                    >
                      复制命令
                    </Button>
                  }
                >
                  <Input.TextArea
                    readOnly
                    rows={2}
                    value={quickerAddCommand}
                    style={{ fontFamily: 'monospace', fontSize: 12, resize: 'none' }}
                  />
                  <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 6 }}>
                    说明：在 Quicker 的【运行或打开】模块中粘贴此命令，将 <code>{`{selectedPaths}`}</code> 替换为 Quicker 获取选中文档的变量输出。
                  </Typography.Text>
                </Card>

                <Card size="small" title="Quicker 直接打印">
                  <Typography.Paragraph style={{ fontSize: 13, marginBottom: 8 }}>
                    在【收藏中心（B）】中，点击任意收藏模板的更多菜单 <code>...</code>，选择【复制 Quicker 打印命令】，即可生成绑定该收藏模板的稳定直接打印命令。
                  </Typography.Paragraph>
                  <Space>
                    <Button icon={<Play size={14} />} onClick={handleTestCall}>
                      模拟测试外部调用
                    </Button>
                  </Space>
                </Card>
              </div>
            ),
          },
          {
            key: 'shell',
            label: 'Windows 资源管理器右键菜单',
            children: (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {!shellStatus?.supported ? (
                  <Alert
                    type="warning"
                    showIcon
                    message="当前操作系统不支持注册 Windows 资源管理器菜单"
                    description="仅 Windows 操作系统支持注册当前用户 HKCU 右键快捷菜单。"
                  />
                ) : (
                  <>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '8px 12px',
                        background: 'var(--color-fill-quaternary, #f4f7fb)',
                        borderRadius: 8,
                      }}
                    >
                      <Space size={8}>
                        {shellStatus.isPathMatched && (shellStatus.fileRegistered || shellStatus.directoryRegistered) ? (
                          <Tag color="success" icon={<CheckCircle2 size={12} style={{ verticalAlign: -1 }} />}>
                            正常已注册
                          </Tag>
                        ) : !shellStatus.fileRegistered && !shellStatus.directoryRegistered ? (
                          <Tag color="default">未注册</Tag>
                        ) : (
                          <Tag color="warning" icon={<AlertTriangle size={12} style={{ verticalAlign: -1 }} />}>
                            路径已变更（建议修复）
                          </Tag>
                        )}
                        {shellStatus.isPortable && <Tag color="purple">便携模式</Tag>}
                      </Space>
                      <Space size={8}>
                        <Button
                          size="small"
                          icon={<Wrench size={13} />}
                          loading={loadingShell}
                          onClick={handleRepairShell}
                        >
                          检查并修复
                        </Button>
                        <Button
                          size="small"
                          danger
                          loading={loadingShell}
                          onClick={handleUnregisterShell}
                        >
                          全部注销
                        </Button>
                      </Space>
                    </div>

                    <Card size="small" title="菜单注册开关">
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div>
                            <Typography.Text strong>单文件右键菜单</Typography.Text>
                            <Typography.Paragraph type="secondary" style={{ margin: 0, fontSize: 12 }}>
                              右键单击 PDF / Office / 图片文档时显示【使用打印助手打印】
                            </Typography.Paragraph>
                          </div>
                          <Switch
                            checked={shellStatus.fileRegistered}
                            loading={loadingShell}
                            onChange={handleToggleFiles}
                          />
                        </div>
                        <Divider style={{ margin: '4px 0' }} />
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div>
                            <Typography.Text strong>文件夹右键菜单</Typography.Text>
                            <Typography.Paragraph type="secondary" style={{ margin: 0, fontSize: 12 }}>
                              右键单击文件夹时显示【使用打印助手打印文件夹】
                            </Typography.Paragraph>
                          </div>
                          <Switch
                            checked={shellStatus.directoryRegistered}
                            loading={loadingShell}
                            onChange={handleToggleDirectories}
                          />
                        </div>
                      </div>
                    </Card>

                    {shellStatus.isPortable && (
                      <Alert
                        type="info"
                        showIcon
                        message="便携版注意事项"
                        description="便携版注册的右键菜单绑定当前 EXE 目录。若移动了便携版所在的文件夹或 U 盘盘符，请点击【检查并修复】重新写入，或在移动前点击【全部注销】。"
                      />
                    )}
                  </>
                )}
              </div>
            ),
          },
          {
            key: 'logs',
            label: `调用日志 (${logs.length})`,
            children: (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    记录来自 Quicker 及命令行传递的最近 50 次外部调用记录
                  </Typography.Text>
                  <Space>
                    <Button size="small" icon={<RefreshCw size={12} />} onClick={refreshLogs}>
                      刷新
                    </Button>
                    <Button size="small" danger icon={<Trash2 size={12} />} onClick={handleClearLogs}>
                      清空
                    </Button>
                  </Space>
                </div>
                <Table
                  dataSource={logs}
                  columns={logColumns}
                  rowKey="id"
                  size="small"
                  pagination={{ pageSize: 5 }}
                />
              </div>
            ),
          },
        ]}
      />
    </Modal>
  );
};
