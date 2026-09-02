# 收藏功能强化改进方案

## 目标

将收藏从“打印历史标记”升级为可重复使用的打印任务模板。一个收藏可以同时保存：

- 任务：文件顺序和每个文件的单独设置；
- 打印机：收藏创建时选择的系统打印机；
- 打印配置：保存配置引用及可降级的标准打印参数快照。

加载收藏时，将任务追加到当前队列，并切换到收藏指定的打印机和打印配置。允许任务为空，仅保存打印机和配置。

## 最新代码现状

- `PrintHistoryModal` 的 `isFavorite` 只是历史记录标记；历史数据没有单文件设置、全局打印设置或保存配置 ID，无法准确重建任务。
- 队列追加、打印机切换、保存配置加载和工作区 `Ctrl+Z` 已有独立处理函数，但加载收藏需要把它们合并成一次原子事务。
- 打印机可以在本软件中隐藏和排序；收藏可能引用已隐藏、离线或已卸载的打印机。
- 快捷键系统已支持静态命令以及 `printer:*`、`profile:*` 动态对象绑定，可扩展为 `favorite:*`。

## 产品结构

### 1. 收藏入口

- 顶栏右侧增加收藏图标按钮，放在打印历史和快捷键帮助附近，Tooltip：`收藏（B）`；
- 单键 `B` 打开收藏中心；
- `Ctrl+B` 打开“添加收藏”弹窗，并阻止 WebView2/浏览器默认收藏行为；
- 打印中允许查看和创建收藏，但不允许加载收藏改变当前打印环境。

### 2. 收藏中心

新增 `src/features/favorites/FavoritesModal.tsx`，使用表格或紧凑卡片展示：

- 收藏名称；
- 文件数量，空任务显示“仅打印机与配置”；
- 打印机名称和在线/隐藏/缺失状态；
- 配置名称或“标准设置快照”；
- 已绑定快捷键；
- 最近加载时间；
- 操作：加载、重命名、更新为当前状态、复制、设置快捷键、删除。

支持名称搜索、手动排序以及筛选“可直接加载/存在问题”。删除后提供短时“撤销”，不使用不可恢复的立即删除。

## 数据模型

新增 `src/features/favorites/favoriteTypes.ts`：

```ts
interface FavoriteTemplateV1 {
  schemaVersion: 1;
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  lastLoadedAt?: number;
  order: number;
  task: FavoriteTaskSnapshot | null;
  printer: FavoritePrinterRef | null;
  printConfig: FavoritePrintConfig | null;
  source?: 'manual' | 'history-migration';
}

interface FavoriteTaskSnapshot {
  items: Array<{
    path: string;
    fileName: string;
    kind: SupportedDocumentKind;
    pageCount: number | null;
    override: FileSettingsOverride;
  }>;
}

interface FavoritePrinterRef {
  name: string;
}

interface FavoritePrintConfig {
  persistentProfileId?: string;
  persistentProfileName?: string;
  standardSettings: Omit<
    PrintSettings,
    | 'printerName'
    | 'driverProfileId'
    | 'driverSummary'
    | 'persistentProfileId'
    | 'persistentProfileName'
    | 'profileDirty'
  >;
}
```

约束：

- 不保存队列 item ID、打印状态、错误信息、选择状态和临时 runtime profile ID；
- 文件顺序和单文件 override 必须保存；
- 打印配置依赖指定打印机；选择保存配置时必须同时保存打印机；
- `standardSettings` 用于保存配置缺失或不兼容时降级恢复颜色、单双面、份数、页码、纸盘、缩放和多页拼接等标准参数；
- 驱动私有参数只能通过仍然存在且兼容的 `persistentProfileId` 完整恢复，不能伪造。

## 存储与容量

新增 `favoriteStorage.ts`，使用 `localStorage` 键 `printassist_favorites_v1`，遵循现有历史、打印机偏好和快捷键存储方式。

- 最多 100 个收藏，每个收藏最多 500 个文件；超限时明确提示，不自动淘汰用户收藏；
- 严格校验 schema、字符串长度和数组数量，损坏数据跳过并提示；
- 保存失败必须提示“收藏保存失败，可能是本地存储空间不足”，不能静默丢失；
- 文件路径只保存在本机，不上传；导出时提示其中可能包含敏感路径；
- 收藏 ID 创建后保持不变，重命名不影响快捷键绑定。

## 添加收藏

新增 `AddFavoriteModal.tsx`，由主界面按钮或 `Ctrl+B` 打开。

表单内容：

- 名称：必填，1–60 字符；默认使用首个文件名，空任务时使用“打印机名 · 配置名”；名称大小写不敏感且必须唯一；
- 保存内容预览：`N 个文件 / 打印机 / 配置`；
- 三个包含项：当前任务、当前打印机、当前打印配置；
- 队列为空时自动关闭“当前任务”选项，仍允许保存打印机和配置；
- 至少选择一项；选择配置时自动包含打印机；
- 当前配置未保存为持久配置时提示“将保存标准参数快照，驱动专属选项可能无法恢复”。

创建收藏只保存定义，不改变队列和打印设置，因此不进入工作区撤销栈。

## 加载收藏

### 预检流程

加载前完成以下检查，不要边检查边修改界面：

1. **文件检查**
   - 批量检查路径是否存在且类型仍受支持；
   - 保留收藏中的顺序和单文件 override；
   - 缺失文件不加入队列，并在结果中列出；
   - 与当前队列重复时复用现有重复文件决策：全部追加、仅追加新文件、取消。
2. **打印机检查**
   - 已安装且可见：正常加载；
   - 已安装但在本软件隐藏：提示“恢复显示并加载 / 仅追加任务 / 取消”；
   - 已卸载或当前不可枚举：保留当前打印机，只追加任务，并明确警告；
   - 离线或错误：允许加载环境，但标明当前不能打印。
3. **配置检查**
   - 保存配置 ID 存在且兼容：通过现有 `loadPrinterProfile` 完整加载；
   - 配置被重命名但 ID 相同：正常加载并更新收藏显示名称；
   - 配置缺失或不兼容：对目标打印机执行能力清洗后应用 `standardSettings`，并提示驱动私有参数未恢复；
   - 收藏没有配置：只处理任务和打印机。

### 提交规则

- 所有异步预检成功后构建最终 `WorkspaceSnapshot`，使用一次 `commit('加载收藏“名称”', ...)` 同时追加任务、切换打印机和应用配置；
- `Ctrl+Z` 必须一次撤销整个加载结果，不能分别撤销任务、打印机和配置；
- 加载只追加任务，不替换现有队列，也不覆盖已有文件的单独设置；
- 收藏任务为空时，只切换打印机和配置；
- 当前批次已完成时，加载收藏先开始新批次，再追加收藏任务，并合并为一个撤销事务；
- 打印中、暂停中或终止中禁止加载；
- 成功后提示：`已加载“合同打印”：追加 8 个文件，应用打印机“办公室”，配置“装订双面”`；存在降级时使用警告提示并提供“查看详情”。

## 命名、更新与版本

- 支持行内重命名或小弹窗重命名；重名时阻止保存；
- “更新为当前状态”允许选择只更新任务、只更新环境或全部更新，保存前展示差异摘要；
- 支持“复制收藏”，自动命名为“原名称 - 副本”；
- 收藏数据发生更新时刷新 `updatedAt`，加载只更新 `lastLoadedAt`；
- 首版不保存多版本历史；覆盖更新后提供一次短时撤销，防止误覆盖。

## 快捷键设计

### 固定入口

- `B`：打开收藏中心；
- `Ctrl+B`：添加收藏。

### 收藏专属快捷键

- 动态快捷键 ID 使用 `favorite:{favoriteId}`；
- 在收藏中心复用 `ShortcutBindingButton`，允许用户为单个收藏绑定快捷键；
- 建议快捷键为 `Alt+1`–`Alt+9`，避免与打印配置的 `1–9`、队列单键和系统常用组合冲突；
- 用户也可录入其他组合，但禁止纯 `B`、`Ctrl+B`、`Ctrl+Z/Y/P`、`Alt+F4`、`Tab` 等保留键；
- 删除收藏时同时清理对应的 `favorite:*` 快捷键；重命名不清理；
- 快捷键帮助界面增加“收藏”分组，显示收藏名称、绑定键和当前可加载状态。

当前动态快捷键查找只处理 `printer:*` 和 `profile:*`，需扩展为 `favorite:*`。同时新增统一的 `findShortcutConflict()`，在静态命令、打印机、打印配置和收藏之间进行冲突检查；不能依赖 `Object.entries()` 顺序决定同一快捷键执行哪个对象。

可选的高效模式：收藏中心打开后，前 9 个收藏显示 `1–9` 键帽，按数字直接加载；该数字只在收藏弹窗作用域内生效，不与全局配置数字键冲突。

## 与打印历史收藏的关系

现有历史星标不能继续叫作完整收藏，否则用户会误以为它能恢复打印配置。建议：

1. 将历史中的“收藏”改名为“保留记录”，继续承担防止历史自动淘汰的作用；
2. 历史行新增“保存为收藏”，新历史若已扩展记录配置快照则完整转换；旧历史只能生成“任务 + 打印机”的部分收藏并提示“原记录未保存打印配置”；
3. 首次升级时可将旧 `isFavorite` 记录批量迁移为部分收藏，名称使用打印时间和首个文件名，迁移完成后保留原历史标记以便回滚；
4. 后续新历史记录应额外保存标准配置快照和持久配置 ID，便于准确转为收藏。

## 其他必要细节

- 收藏引用的文件可能被移动或删除，管理界面应支持“检查收藏”并显示缺失数量；
- 支持导出/导入收藏 JSON 作为备份；导入时校验 schema、名称、快捷键冲突和文件数量，默认不覆盖同名收藏；
- 打印机或配置重命名时以稳定 ID 优先，打印机当前只有名称标识，无法识别 Windows 侧重命名，需要按“缺失打印机”处理；
- 收藏加载不得自动开始打印；用户仍需检查列表后执行打印；
- 收藏管理中的隐藏、排序、命名和快捷键操作应具备键盘操作及无障碍标签；
- 文件路径、配置名称等长文本必须截断显示并提供 Tooltip。

## 代码调整

### 新增

- `src/features/favorites/favoriteTypes.ts`
- `src/features/favorites/favoriteStorage.ts`
- `src/features/favorites/favoriteResolver.ts`：文件、打印机和配置预检及最终快照构建
- `src/features/favorites/FavoritesModal.tsx`
- `src/features/favorites/AddFavoriteModal.tsx`
- 对应存储、解析、快捷键和界面测试

### 修改

- `src/App.tsx`：收藏状态、添加/加载入口、原子 commit、动态快捷键和顶栏按钮；
- `src/features/history/historyStorage.ts`、`PrintHistoryModal.tsx`：历史“保留记录”、转为收藏及新记录配置快照；
- `src/features/shortcuts/shortcutRegistry.ts`：增加 `B`、`Ctrl+B` 和动态收藏冲突校验；
- `src/features/shortcuts/ShortcutHelpModal.tsx`：增加收藏分组和动态绑定展示；
- `src/features/shortcuts/ShortcutBindingButton.tsx`：增加保留键、跨对象冲突检测及替换确认；
- `src/styles.css`：收藏中心、状态标签、键帽、缺失项和顶栏入口样式。

不需要新增 Tauri 收藏命令；文件存在性可复用现有原生路径/元数据能力。若现有批量接口无法返回缺失路径，应补充只读批量校验命令，而不是逐文件调用。

## 测试与验收

- 创建包含任务、打印机和配置的收藏，以及仅打印机/配置的空任务收藏；
- 验证文件顺序、单文件 override、全局设置和保存配置完整恢复；
- 验证加载追加而非替换，并复用重复文件决策；
- 验证缺失文件、隐藏/离线/卸载打印机、缺失/不兼容配置的降级路径；
- 验证一次 `Ctrl+Z` 撤销完整收藏加载；
- 验证打印中禁止加载，但允许查看和创建；
- 验证命名、重命名、复制、覆盖更新、删除撤销和容量限制；
- 验证 `B`、`Ctrl+B`、收藏自定义快捷键以及跨静态/打印机/配置的冲突检测；
- 验证旧历史收藏迁移和旧 schema 数据兼容；
- 验证导入恶意/损坏 JSON 不造成崩溃或覆盖现有收藏；
- 执行 `npm test`、`npm run lint`、`npm run build`，并在 Windows WebView2 100%/125%/150% 缩放下检查布局。

## 推荐实施顺序

1. 完成收藏 schema、存储、迁移和文件/环境预检测试。
2. 实现添加收藏与收藏中心，包括空任务、命名、重命名和管理操作。
3. 实现原子加载、重复文件处理、缺失资源降级和 `Ctrl+Z`。
4. 接入 `B`、`Ctrl+B`、动态收藏快捷键和统一冲突检测。
5. 调整打印历史语义并接入“保存为收藏”。
6. 增加导入/导出、性能边界、Windows 缩放和全量回归测试。
