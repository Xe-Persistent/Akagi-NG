/// <reference types="vite/client" />

// Injected by vite.config.ts.
declare const __AKAGI_VERSION__: string;

declare module '*.svg' {
  import type { ReactElement, SVGProps } from 'react';
  const content: (props: SVGProps<SVGSVGElement>) => ReactElement;
  export default content;
}
