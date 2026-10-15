import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { app } from 'electron';

// Built output lives under dist/main/shared, so the project root is three levels up.
const moduleDir = dirname(fileURLToPath(import.meta.url));

/**
 * 获取项目的根目录。
 * 在开发模式下，通常是代码仓库的根目录。
 * 在打包模式下，是 Resources 目录的父目录（即包含 config, models 等文件夹的目录）。
 */
export function getProjectRoot(): string {
  return !app.isPackaged ? resolve(moduleDir, '../../..') : join(process.resourcesPath, '..');
}

/**
 * 获取指定路径在项目根目录下的绝对路径。
 */
export function getAssetPath(...paths: string[]): string {
  return join(getProjectRoot(), ...paths);
}

/**
 * 获取前端构建产物（dist/renderer）下的路径。
 */
export function getRendererPath(...paths: string[]): string {
  return join(moduleDir, '../../renderer', ...paths);
}

/**
 * 获取 contextBridge 预加载脚本（dist/main/preload.cjs）的路径。
 */
export function getPreloadPath(): string {
  return join(moduleDir, '../preload.cjs');
}
