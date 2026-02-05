import { useEffect, useState } from 'react';

interface ConnectionConfig {
  protocol: string;
  backendAddress: string;
  clientId: string;
  apiBase: string;
  backendUrl: string;
}

/**
 * 管理后端连接配置的 Hook
 *
 * 自动从 localStorage 读取配置，在开发模式和生产模式下使用不同的默认值
 */
export function useConnectionConfig(): ConnectionConfig {
  const [protocol] = useState(() => {
    const saved = localStorage.getItem('protocol');
    if (saved) return saved;
    // 开发模式（端口 5173）默认使用 http，否则使用当前协议
    if (window.location.port === '5173') return 'http';
    if (window.location.protocol === 'file:') return 'http';
    return window.location.protocol.replace(':', '');
  });

  const [backendAddress, setBackendAddress] = useState(() => {
    const saved = localStorage.getItem('backendAddress');
    if (saved) return saved;
    // 开发模式默认使用 127.0.0.1:8765
    if (window.location.port === '5173') return '127.0.0.1:8765';
    // Electron file 协议下默认指向本地后端
    if (window.location.protocol === 'file:') return '127.0.0.1:8765';
    // 正式环境使用当前主机
    return window.location.host;
  });

  useEffect(() => {
    if (window.electron) {
      window.electron
        .invoke('get-backend-config')
        .then((cfg) => {
          if (cfg && cfg.host && cfg.port) {
            const newAddress = `${cfg.host}:${cfg.port}`;
            setBackendAddress(newAddress);
            // 缓存到本地，确保刷新页面或下次启动时初始状态正确
            localStorage.setItem('backendAddress', newAddress);
          }
        })
        .catch((err) => {
          console.error('[useConnectionConfig] Failed to fetch backend config from electron:', err);
        });
    }
  }, []);

  const [clientId] = useState(() => {
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  });

  const apiBase = `${protocol}://${backendAddress}`;
  const backendUrl = `${protocol}://${backendAddress}/sse?clientId=${clientId}`;

  return {
    protocol,
    backendAddress,
    clientId,
    apiBase,
    backendUrl,
  };
}
