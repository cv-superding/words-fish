'use strict';

/** 悬浮窗可映射的手势事件 */
const GESTURE_EVENTS = [
  { key: 'click', label: '单击' },
  { key: 'dblclick', label: '双击' },
  { key: 'rightclick', label: '右键单击' },
  { key: 'middleclick', label: '中键单击' },
  { key: 'wheelUp', label: '滚轮上滚' },
  { key: 'wheelDown', label: '滚轮下滚' },
  { key: 'longpress', label: '长按 (0.5s)' },
];

/** 手势可绑定的动作 */
const GESTURE_ACTIONS = [
  { key: 'none', label: '无动作' },
  { key: 'close', label: '关闭悬浮窗' },
  { key: 'nextWord', label: '下一个单词' },
  { key: 'prevWord', label: '上一个单词' },
  { key: 'toggleMeaning', label: '显示 / 隐藏释义' },
  { key: 'markUnknown', label: '标记为生词' },
  { key: 'markKnown', label: '标记为已掌握' },
  { key: 'speak', label: '朗读单词' },
  { key: 'togglePin', label: '切换钉住状态' },
  { key: 'copyWord', label: '复制单词' },
  { key: 'openSettings', label: '打开设置' },
];

/** 可注册的全局快捷键动作 */
const HOTKEY_ITEMS = [
  { key: 'togglePopup', label: '呼出 / 收起单词悬浮窗', default: 'Shift+X' },
  { key: 'nextWord', label: '换下一个单词', default: 'Shift+C' },
  { key: 'markUnknown', label: '把当前单词标记为生词', default: 'Shift+Z' },
  { key: 'toggleMeaning', label: '显示 / 隐藏释义', default: '' },
  { key: 'openSettings', label: '打开设置面板', default: '' },
  { key: 'panic', label: '一键隐藏全部窗口（老板键）', default: 'Shift+Esc' },
];

/** 悬浮窗主题 */
const THEMES = [
  { key: 'light', label: '素白' },
  { key: 'dark', label: '暗夜' },
  { key: 'ink', label: '水墨' },
  { key: 'mint', label: '薄荷' },
  { key: 'ide', label: '伪装代码' },
];

const WORD_STATUS = {
  NEW: 'new',
  LEARNING: 'learning',
  KNOWN: 'known',
};

module.exports = { GESTURE_EVENTS, GESTURE_ACTIONS, HOTKEY_ITEMS, THEMES, WORD_STATUS };
