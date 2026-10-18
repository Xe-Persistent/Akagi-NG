import '@/i18n/i18n';
import '@/index.css';

import { StrictMode } from 'react';
import ReactDOM from 'react-dom/client';

import App from '@/App';

// The root reports what the boundaries catch and what escapes them; both end up
// in the log file through `forwardRendererConsole`.
ReactDOM.createRoot(document.getElementById('root')!, {
  onCaughtError: (error, info) => console.error('Render error (caught):', error, info),
  onUncaughtError: (error, info) => console.error('Render error (uncaught):', error, info),
}).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
