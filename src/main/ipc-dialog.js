'use strict';
const { dialog } = require('electron');
const path = require('path');

async function openImport(win) {
  return dialog.showOpenDialog(win || null, {
    title: '导入自定义词库',
    properties: ['openFile'],
    filters: [
      { name: '词库文件', extensions: ['json', 'jsonl', 'csv', 'tsv', 'txt'] },
      { name: '全部文件', extensions: ['*'] },
    ],
  });
}

async function openDictDir() {
  const r = await dialog.showOpenDialog(null, {
    title: '选择词库目录',
    properties: ['openDirectory'],
  });
  return r;
}

async function confirm(message, detail, buttons = ['确定', '取消']) {
  const { dialog } = require('electron');
  const idx = await dialog.showMessageBox({
    type: 'question',
    message,
    detail,
    buttons,
    defaultId: 0,
    cancelId: buttons.length - 1,
  });
  return idx.response === 0;
}

module.exports = { openImport, openDictDir, confirm };