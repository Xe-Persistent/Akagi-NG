/// <reference types="vite/client" />

// ===== 自定义全局变量 (由 vite.config.ts 注入) =====
declare const __AKAGI_VERSION__: string;

// ===== 资源类型扩展 =====

// .svg
declare module '*.svg' {
  import type { FC, SVGProps } from 'react';
  const content: FC<SVGProps<SVGSVGElement>>;
  export default content;
}
