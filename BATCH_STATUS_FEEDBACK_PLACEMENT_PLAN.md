# 批次状态提示位置改进方案

## 目标

只调整“打印完成”和“已开始新批次”的提示位置与视觉语义，减少对文件列表空间的占用，让结果状态靠近后续操作。不得改变打印、暂停/继续/终止、批次备份、恢复和历史记录行为。

## 当前实现（以最新代码为准）

- `src/App.tsx` 在 `.queue-heading` 下方依次渲染 `restore-batch-banner` 和 `PrintSummary`，两者都会挤压 `.queue-body`。
- 全部打印成功时，`PrintSummary` 显示大块成功 `Alert`；底部同时已显示 `CompletionActions`，信息和操作分离。
- 新批次由 `previousBatchBackupRef` 与 `canRestoreBatch` 提供一次恢复能力；该状态在添加文件、恢复上一批或清空队列时失效。
- `src/features/queue/PrintPlaybackControls.tsx` 及新增的 `pausing / paused / terminating` 状态不属于本次修改范围。

## 修改方案

### 1. 全部打印成功：摘要移到底部操作栏

涉及：`src/App.tsx`、`src/features/results/PrintSummary.tsx`、`src/styles.css`

- 当 `phase === 'completed'` 且 `lastSummary.failed === 0 && lastSummary.skipped === 0` 时，不再在列表顶部渲染成功 `Alert`。
- 在 `.queue-footer-stats` 中显示紧凑状态：成功图标 + `已完成：N 个文件`；页数已知时追加 `· 共 N 页`。
- 右侧继续使用现有 `CompletionActions`，按钮文案及行为不变。
- `PrintSummary` 仍负责“存在失败”或“存在未打印项”的警告、说明及失败明细，不弱化需要用户处理的结果。
- 删除全部成功分支中重复的 `message.success("打印完成……")`；异常、失败和取消消息保持现状，避免同一成功结果同时以浮层和固定状态重复出现。

### 2. 已开始新批次：恢复条移到底部

涉及：`src/App.tsx`、`src/styles.css`

- 将 `canRestoreBatch` 对应提示从 `.queue-heading` 下方移动到 `.queue-body` 之后、`.queue-footer` 之前。
- 文案保持 `已开始新批次`，右侧保留 `恢复上一批`；不增加自动消失计时，恢复能力的现有失效条件保持不变。
- 改用白色/浅灰或浅蓝的中性撤销条，不再使用绿色成功背景。
- 将当前带 `role="button"` 的 `span` 改为真实 `Button type="link"`，点击逻辑仍调用 `handleRestorePreviousBatch`，无需自行处理 Enter/Space 键。
- 提示使用 `role="status"` 和 `aria-live="polite"`，出现时不主动抢夺焦点。

## 状态规则

| 页面状态 | 顶部结果区 | 底部左侧 | 底部上方恢复条 |
|---|---|---|---|
| 全部成功 | 不显示 | 显示紧凑成功摘要 | 不显示 |
| 部分失败 | 保留警告和失败明细 | 保留现有文件统计 | 不显示 |
| 已取消/有未打印项 | 保留说明 | 保留现有文件统计 | 不显示 |
| 已开始新批次且可恢复 | 不显示 | 显示 `共 0 个文件` | 显示中性恢复条 |
| 添加新文件或恢复上一批后 | 按现有状态 | 按现有状态 | 立即消失 |

## 验证清单

- 为 `PrintSummary` 补充测试：全部成功不输出顶部摘要；失败和未打印摘要仍正常输出。
- 为批次页面补充测试：成功摘要出现在底栏；恢复条位于底栏之前；点击“恢复上一批”后文件、摘要和 `completed` 状态恢复。
- 回归 `queueReducer.test.ts` 现有的 `start_new_batch`、`restore_batch` 和播放控制状态机测试。
- 执行 `npm test`、`npm run lint`、`npm run build`。
- 人工检查 1366×768 和当前设计分辨率：长文件列表、空批次、全部成功、部分失败、取消后继续等状态不得遮挡底部按钮或产生双滚动条。

## 验收标准

- 全部成功后，列表顶部不再出现大块绿色提示，完成状态与后续操作集中在底栏。
- 开始新批次后，恢复提示位于底栏上方，视觉上表达“可撤销操作”而非“打印成功”。
- 原有按钮、批次恢复时机、打印结果、播放式控制和用户行为均保持不变。

## 推荐实施顺序

1. 先拆分全部成功与失败/取消的摘要渲染，并加入底栏成功摘要。
2. 再移动并调整恢复条语义与键盘可访问性。
3. 最后补齐测试，执行完整前端回归与分辨率检查。
