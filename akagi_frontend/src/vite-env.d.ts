/// <reference types="vite/client" />

// Document Picture-in-Picture API
declare global {
  interface Window {
    documentPictureInPicture?: {
      requestWindow(options: { width: number; height: number }): Promise<Window>;
      window: Window | null;
      onenter: ((this: EventTarget, ev: Event) => void) | null;
    };
  }
}

export {};
