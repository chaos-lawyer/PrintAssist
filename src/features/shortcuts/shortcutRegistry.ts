export type ShortcutCategory =
  | 'file_queue'
  | 'settings_config'
  | 'print_control'
  | 'nav_selection'
  | 'help';

export interface ShortcutDefinition {
  id: string;
  category: ShortcutCategory;
  name: string;
  keys: string[];
  description?: string;
  isSingleKey: boolean;
}

export const SHORTCUT_CATEGORIES: Record<
  ShortcutCategory,
  { label: string; order: number }
> = {
  file_queue: { label: '文件与队列', order: 1 },
  settings_config: { label: '设置与配置', order: 2 },
  print_control: { label: '打印控制', order: 3 },
  nav_selection: { label: '导航与选择', order: 4 },
  help: { label: '帮助', order: 5 },
};

export const SHORTCUT_DEFINITIONS: ShortcutDefinition[] = [
  // 文件与队列
  {
    id: 'add_file',
    category: 'file_queue',
    name: '添加文件',
    keys: ['A'],
    description: '弹出添加文件对话框',
    isSingleKey: true,
  },
  {
    id: 'add_folder',
    category: 'file_queue',
    name: '添加文件夹',
    keys: ['F'],
    description: '弹出添加文件夹对话框',
    isSingleKey: true,
  },
  {
    id: 'open_file',
    category: 'file_queue',
    name: '打开活动文件',
    keys: ['Enter'],
    description: '使用系统关联程序直接打开当前活动文件',
    isSingleKey: true,
  },
  {
    id: 'locate_file',
    category: 'file_queue',
    name: '在文件夹中显示',
    keys: ['L'],
    description: '在系统文件管理器中定位活动文件',
    isSingleKey: true,
  },
  {
    id: 'copy_item',
    category: 'file_queue',
    name: '复制文件项',
    keys: ['Ctrl', 'C'],
    description: '复制所选文件（或活动行）到队列内部剪贴板',
    isSingleKey: false,
  },
  {
    id: 'cut_item',
    category: 'file_queue',
    name: '剪切文件项',
    keys: ['Ctrl', 'X'],
    description: '剪切所选文件（或活动行），原项显示为半透明',
    isSingleKey: false,
  },
  {
    id: 'paste_item',
    category: 'file_queue',
    name: '粘贴文件项',
    keys: ['Ctrl', 'V'],
    description: '将复制/剪切的文件项粘贴到活动行之后（剪切为移动）',
    isSingleKey: false,
  },
  {
    id: 'undo',
    category: 'file_queue',
    name: '撤销',
    keys: ['Ctrl', 'Z'],
    description: '撤销上一步队列编辑或打印设置操作',
    isSingleKey: false,
  },
  {
    id: 'redo',
    category: 'file_queue',
    name: '重做',
    keys: ['Ctrl', 'Y'],
    description: '重做已被撤销的操作（亦支持 Ctrl + Shift + Z）',
    isSingleKey: false,
  },
  {
    id: 'remove_item',
    category: 'file_queue',
    name: '移除所选文件',
    keys: ['Delete'],
    description: '从待打印队列中移除所选文件',
    isSingleKey: true,
  },
  {
    id: 'select_all',
    category: 'file_queue',
    name: '全选文件',
    keys: ['Ctrl', 'A'],
    description: '选中待打印列表中的全部文件',
    isSingleKey: false,
  },
  {
    id: 'select_duplicates',
    category: 'file_queue',
    name: '选中相同文件副本',
    keys: ['Ctrl', 'Shift', 'A'],
    description: '选择与当前活动文件路径相同的所有副本',
    isSingleKey: false,
  },

  // 设置与配置
  {
    id: 'open_settings',
    category: 'settings_config',
    name: '文件打印设置',
    keys: ['E'],
    description: '单选或活动行打开单文件配置，多选打开批量配置',
    isSingleKey: true,
  },
  {
    id: 'toggle_sides',
    category: 'settings_config',
    name: '调整单双面',
    keys: ['D'],
    description: '快速在单面和双面打印之间切换全局设置',
    isSingleKey: true,
  },
  {
    id: 'toggle_color',
    category: 'settings_config',
    name: '调整黑白/彩色',
    keys: ['S'],
    description: '快速在黑白和彩色打印之间切换全局设置',
    isSingleKey: true,
  },
  {
    id: 'apply_profiles_1_9',
    category: 'settings_config',
    name: '应用打印机配置',
    keys: ['1 ~ 9'],
    description: '快速应用当前打印机保存配置列表中对应的第 1–9 项',
    isSingleKey: true,
  },
  {
    id: 'select_printer_1_9',
    category: 'settings_config',
    name: '选择对应打印机',
    keys: ['Shift', '1 ~ 9'],
    description: '快速切换到对应显示顺序的第 1–9 台打印机（顺序可在管理中调整）',
    isSingleKey: false,
  },
  {
    id: 'prev_printer',
    category: 'settings_config',
    name: '上一个打印机',
    keys: ['['],
    description: '循环切换到上一台可见打印机',
    isSingleKey: true,
  },
  {
    id: 'next_printer',
    category: 'settings_config',
    name: '下一个打印机',
    keys: [']'],
    description: '循环切换到下一台可见打印机',
    isSingleKey: true,
  },

  // 打印控制
  {
    id: 'start_print',
    category: 'print_control',
    name: '开始打印',
    keys: ['Ctrl', 'P'],
    description: '启动当前批次打印任务',
    isSingleKey: false,
  },

  // 导航与选择
  {
    id: 'move_selection',
    category: 'nav_selection',
    name: '移动活动行',
    keys: ['↑', '↓'],
    description: '在文件列表中上下移动活动行',
    isSingleKey: true,
  },
  {
    id: 'extend_selection',
    category: 'nav_selection',
    name: '连续多选',
    keys: ['Shift', '↑ / ↓'],
    description: '扩展当前选中文件范围',
    isSingleKey: false,
  },
  {
    id: 'sort_by_column',
    category: 'nav_selection',
    name: '根据显示列排序',
    keys: ['Ctrl', '1 ~ 4'],
    description: '按当前显示的排序列从左至右排序（按一下正序，再按一下逆序）',
    isSingleKey: false,
  },
  {
    id: 'jump_bounds',
    category: 'nav_selection',
    name: '跳到首项 / 末项',
    keys: ['Home', 'End'],
    description: '快速跳转到列表首行或末行，可配合 Shift 范围选择',
    isSingleKey: true,
  },
  {
    id: 'reorder_items',
    category: 'nav_selection',
    name: '调整顺序',
    keys: ['Alt', '↑ / ↓'],
    description: '将选中的文件项在队列中整体上下调整顺序',
    isSingleKey: false,
  },
  {
    id: 'open_context_menu',
    category: 'nav_selection',
    name: '打开右键菜单',
    keys: ['Shift', 'F10'],
    description: '呼出当前选中项的操作上下文菜单',
    isSingleKey: false,
  },
  {
    id: 'cancel_or_escape',
    category: 'nav_selection',
    name: '取消选择 / 退出',
    keys: ['Esc'],
    description: '先关闭顶层菜单，无浮层时清除剪切状态与队列选中',
    isSingleKey: true,
  },

  // 帮助与历史
  {
    id: 'open_history',
    category: 'help',
    name: '打开打印历史',
    keys: ['H'],
    description: '打开历史打印批次记录与重打界面',
    isSingleKey: true,
  },
  {
    id: 'open_help',
    category: 'help',
    name: '快捷键说明',
    keys: ['/'],
    description: '随时随地打开快捷键帮助说明弹窗',
    isSingleKey: true,
  },
];

export const SHORTCUT_SETTINGS_STORAGE_KEY = 'printassist_shortcuts_v1';

export function getSingleKeyShortcutsEnabled(): boolean {
  try {
    const stored = localStorage.getItem(SHORTCUT_SETTINGS_STORAGE_KEY);
    if (stored !== null) {
      const parsed = JSON.parse(stored);
      if (typeof parsed?.singleKeyEnabled === 'boolean') {
        return parsed.singleKeyEnabled;
      }
    }
  } catch {
    // default to true
  }
  return true;
}

export function setSingleKeyShortcutsEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(
      SHORTCUT_SETTINGS_STORAGE_KEY,
      JSON.stringify({ singleKeyEnabled: enabled }),
    );
  } catch {
    // ignore
  }
}
