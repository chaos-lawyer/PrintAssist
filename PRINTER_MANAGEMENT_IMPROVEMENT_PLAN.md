# 打印机管理功能改进方案

## 目标

增加应用内打印机管理功能，让用户隐藏本软件不需要的打印机、调整显示顺序并恢复隐藏项。该功能只影响打印助手中的展示和快捷切换，不卸载或修改 Windows 系统打印机，也不删除对应的驱动配置和打印历史。

## 最新代码现状

- `App.tsx` 通过 `listSystemPrinters()` 获取 `SystemPrinter[]`，直接保存到 `printers` 并按系统返回顺序展示。
- `refreshPrinters()` 在当前打印机失效时选择 Windows 默认打印机或列表第一项。
- `GlobalSettingsPanel.tsx` 的自绘打印机选择器直接遍历 `printers`。
- 打印机以唯一名称 `SystemPrinter.name` 关联当前设置、保存配置和原生打印命令。
- 隐藏与排序属于应用偏好，不应写入系统打印机或原生配置存储。

## 功能范围

### 打印机管理界面

新增 `src/features/printers/PrinterManagerModal.tsx`，入口放在右侧“打印机”字段标题旁，与刷新按钮并列，使用“管理”或设置图标。弹窗宽度约 680px，包含：

1. **本软件显示的打印机**
   - 支持拖动排序；
   - 支持键盘 `Alt+↑/↓` 调整顺序；
   - 显示打印机名称、在线状态、端口、Windows 默认标记和当前使用标记；
   - 每项提供“隐藏”按钮。
2. **已隐藏的打印机**
   - 默认折叠并显示数量；
   - 每项提供“恢复显示”；
   - 提供“全部恢复”。
3. **批量操作**
   - “隐藏所有离线打印机”；
   - “恢复系统默认顺序”；
   - 打印机较多时提供名称搜索。

弹窗使用本地草稿状态，用户点击“保存”后一次提交；点击“取消”不改变当前列表。打印进行中允许查看，但禁止保存修改。

## 数据模型与持久化

新增 `src/features/printers/printerPreferences.ts`：

```ts
interface PrinterPreferencesV1 {
  version: 1;
  orderedNames: string[];
  hiddenNames: string[];
}
```

使用现有应用惯例保存到 `localStorage`，键名建议为 `printassist_printer_preferences_v1`。

合并规则：

- `systemPrinters` 始终保存本次系统枚举的原始结果；
- 已保存且仍存在的名称按 `orderedNames` 排列；
- 新安装或首次发现的打印机追加到可见列表末尾；
- `hiddenNames` 中的打印机不进入主选择器，但仍保留系统数据和配置；
- 暂时未被系统枚举到的隐藏/排序名称不立即删除，避免网络打印机离线后丢失偏好；
- 偏好损坏时回退到默认顺序：Windows 默认打印机优先，其余保持系统枚举顺序。

建议在 `App.tsx` 中使用：

```ts
const [systemPrinters, setSystemPrinters] = useState<SystemPrinter[]>([]);
const [printerPreferences, setPrinterPreferences] = useState(loadPrinterPreferences);

const orderedPrinters = useMemo(
  () => applyPrinterPreferences(systemPrinters, printerPreferences),
  [systemPrinters, printerPreferences],
);

const visiblePrinters = orderedPrinters.filter((printer) => !printer.hidden);
```

现有传给 `GlobalSettingsPanel` 的 `printers` 改为 `visiblePrinters`；管理弹窗接收完整 `systemPrinters`。

## 关键行为

### 隐藏打印机

- “隐藏”仅从打印助手的选择列表移除，不调用 Windows 删除打印机接口；
- 允许隐藏 Windows 默认打印机，但应明确标记“Windows 默认”，避免误解；
- 至少保留一台可见打印机，禁止保存全部隐藏状态；
- 如果当前打印机被隐藏，保存后自动选择排序后的第一台可见打印机，并走现有能力检测和默认配置加载流程；
- 隐藏打印机的保存配置继续保留，恢复显示后仍可使用；
- 历史记录继续显示当时使用的真实打印机名称。

### 打印机排序

- 排序只改变打印助手中的显示顺序；
- 主打印机下拉框、管理界面及快捷键切换必须使用同一 `visiblePrinters` 顺序；
- Windows 默认打印机通过标签标识，不强制固定在首位，尊重用户自定义顺序；
- 点击“恢复系统默认顺序”只清除自定义排序，不恢复隐藏项。

### 刷新与设备变化

修改 `refreshPrinters()`：

1. 读取最新系统列表；
2. 应用隐藏和排序偏好；
3. 当前打印机仍存在且可见时保持不变；
4. 当前打印机缺失或已隐藏时，优先选择可见的 Windows 默认打印机，否则选择第一台可见打印机；
5. 仅在实际切换打印机时刷新保存配置和自动加载默认配置；
6. 使用现有 request ID 防止旧刷新结果覆盖新状态。

新发现打印机可用一次低干扰提示：`发现新打印机“名称”，已添加到列表末尾`，不要每次刷新重复提示。

## 与快捷键联动

- `P`：切换到下一台可见打印机；
- `Shift+P`：切换到上一台可见打印机；
- 到达末尾后循环；只有一台可见打印机时不操作；
- 切换提示中显示 `打印机名称（2 / 4）`；
- `1–9` 打印配置始终对应切换后打印机的配置列表；
- 快捷键帮助界面说明“打印机顺序可在打印机管理中调整”。

切换打印机和自动加载默认配置应作为一个撤销事务；隐藏与排序作为管理弹窗的一次偏好提交，不进入主工作区 `Ctrl+Z` 撤销栈，用户可在保存前取消或之后重新管理。

## 代码调整

### 新增

- `src/features/printers/printerPreferences.ts`：校验、加载、保存和合并偏好。
- `src/features/printers/PrinterManagerModal.tsx`：管理界面。
- `src/features/printers/PrinterManagerModal.test.tsx`
- `src/features/printers/printerPreferences.test.ts`

### 修改

- `src/App.tsx`：区分原始系统列表与可见排序列表，接入管理弹窗、刷新规则和打印机切换。
- `src/features/settings/GlobalSettingsPanel.tsx`：增加管理入口，只展示可见打印机。
- `src/features/shortcuts/shortcutRegistry.ts`、`ShortcutHelpModal.tsx`：加入 `P / Shift+P`。
- `src/styles.css`：增加管理列表、拖动状态、隐藏区和打印机标签样式。

不需要修改 `SystemPrinter` 原生契约，也不需要新增 Tauri 命令。

## 测试与验收

- 隐藏普通、离线、Windows 默认和当前打印机，验证选择回退规则；
- 验证不能隐藏最后一台可见打印机；
- 排序后重启应用、刷新打印机，顺序保持；
- 新增打印机追加末尾，临时消失后重新出现仍恢复原偏好；
- 恢复隐藏项后，对应保存配置仍存在；
- `P / Shift+P` 只遍历可见打印机，并遵循管理顺序；
- 验证打印进行中无法保存管理改动；
- 验证历史记录及 Windows 系统打印机没有被删除或改名；
- 覆盖偏好 JSON 损坏、重复名称、空列表和 50 台打印机的边界；
- 执行 `npm test`、`npm run lint`、`npm run build`，并在 Windows WebView2 100%/125%/150% 缩放下检查弹窗。

## 推荐实施顺序

1. 实现偏好模型、合并算法和单元测试。
2. 将 `App.tsx` 拆分为原始打印机列表与可见排序列表，完成刷新和回退逻辑。
3. 实现管理弹窗、隐藏/恢复、拖动排序和持久化。
4. 接入 `P / Shift+P` 快捷切换与快捷键帮助。
5. 完成设备变化、配置保留、Windows 缩放及全量回归测试。
