import { app } from 'electron';
import path from 'path';

/**
 * 获取项目的根目录。
 * 在开发模式下，通常是代码仓库的根目录。
 * 在打包模式下，是 Resources 目录的父目录（即包含 bin, config, lib, models 等文件夹的目录）。
 */
export function getProjectRoot(): string {
  return !app.isPackaged
    ? path.resolve(__dirname, '../../')
    : path.join(process.resourcesPath, '..');
}

/**
 * 获取指定路径在项目根目录下的绝对路径。
 */
export function getAssetPath(...paths: string[]): string {
  return path.join(getProjectRoot(), ...paths);
}
