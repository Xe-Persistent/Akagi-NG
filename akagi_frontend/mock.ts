import http from 'node:http';

import type { FullRecommendationData, Settings } from './src/types.ts';

// Visual Verification Mock Server for Recommendations
console.log('Starting server in MOCK mode (SSE) for Recommendation Visual Test.');

const STREAM_INTERVAL_MS = 3000;
const KEEPALIVE_INTERVAL_MS = 3000;

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const port = 8765;
const hostname = '127.0.0.1';

// In-memory settings storage
let mockSettings: Settings = {
  log_level: 'TRACE',
  locale: 'zh-CN',
  game_url: 'https://game.maj-soul.com/1/',
  platform: 'majsoul',
  mitm: {
    enabled: true,
    host: '127.0.0.1',
    port: 6789,
    upstream: '',
  },
  server: {
    host: '0.0.0.0',
    port: 8765,
  },
  ot: {
    online: true,
    server: 'http://127.0.0.1:8765',
    api_key: 'mock',
  },
  model_config: {
    device: 'auto',
    temperature: 0.3,
    enable_amp: false,
    enable_quick_eval: false,
    rule_based_agari_guard: true,
  },
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

  console.log(`[REQUEST] ${req.method} ${req.url}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders);
    res.end();
    return;
  }

  // Handle Settings API
  if (url.pathname === '/api/settings') {
    if (req.method === 'GET') {
      res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify(mockSettings));
      return;
    }

    if (req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk.toString();
      });
      req.on('end', () => {
        try {
          const newSettings = JSON.parse(body);
          mockSettings = { ...mockSettings, ...newSettings };
          console.log('Updated mock settings:', mockSettings);
          res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, data: mockSettings }));
        } catch {
          res.writeHead(400, corsHeaders);
          res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }));
        }
      });
      return;
    }
  }

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/sse')) {
    console.log('SSE client connected');
    let connectionStateCounter = 0;

    res.writeHead(200, {
      ...corsHeaders,
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    const sendData = () => {
      const mockData = generateMockData(connectionStateCounter);
      connectionStateCounter++;
      // 匹配后端格式: event: recommendations
      res.write(`event: recommendations\n`);
      res.write(`data: ${JSON.stringify(mockData)}\n\n`);
    };

    // initial comment + first payload
    res.write(': connected\n\n');
    sendData();

    const keepAliveInterval = setInterval(() => {
      res.write(': keep-alive\n\n');
    }, KEEPALIVE_INTERVAL_MS);

    const dataInterval = setInterval(() => {
      sendData();
    }, STREAM_INTERVAL_MS);

    const cleanup = () => {
      console.log('SSE client disconnected');
      clearInterval(keepAliveInterval);
      clearInterval(dataInterval);
    };

    req.on('close', () => {
      cleanup();
    });

    return;
  }

  res.writeHead(404, corsHeaders);
  res.end('Not Found');
});

server.listen(port, hostname, () => {
  console.log(`Mock server listening on http://${hostname}:${port}`);
});

function generateMockData(counter: number): FullRecommendationData {
  const scenarios = [
    {
      tehai: ['1m', '2m', '3m', '5m', '6m', '7m', '1p', '1p', '5p', '0p', '9p', 'E', 'E', 'W'],
      recommendations: [
        { action: 'W', confidence: 0.85 },
        { action: '9p', confidence: 0.1 },
        { action: '1p', confidence: 0.05 },
      ],
    },
    // Scenario 2: Riichi Lookahead (Ryanpeikou-ish shape)
    {
      tehai: ['1m', '2m', '2m', '3m', '3m', '4m', '4m', '5m', '5m', '6m', '6m', '7m', '7m', '8m'],
      recommendations: [
        {
          action: 'reach',
          confidence: 0.92,
          is_riichi_declaration: true,
          sim_candidates: [
            { tile: '8m', confidence: 0.95 },
            { tile: '1m', confidence: 0.05 },
          ],
        },
        { action: '8m', confidence: 0.05 }, // Dama
        { action: '1m', confidence: 0.03 }, // Dama
      ],
    },

    // Scenario 3: Mixed Kan (Ankan 4m + Kakan 7s)
    {
      tehai: ['4m', '4m', '4m', '4m', '5m', '6m', '7m', 'E', 'E', 'E', '7s'], // has a 7s, 7s, 7s from Pon
      recommendations: [
        { action: 'kan', confidence: 0.9, tile: '4m', consumed: ['4m', '4m', '4m', '4m'] }, // Ankan (consumes 4 from hand)
        { action: 'kan', confidence: 0.9, tile: '7s', consumed: ['7s'] }, // Kakan (consumes 1 from hand)
        { action: '7s', confidence: 0.1 }, // Skip kan
      ],
    },
    // Scenario 4: Pon (Bump) vs Daiminkan (Open Kan)
    // Hand: 999p 123s ... Opponent discards 9p
    {
      tehai: ['9p', '9p', '9p', '1s', '2s', '3s', '4s', '5s', '6s', 'E', 'E', 'S', 'S'],
      recommendations: [
        { action: 'kan', confidence: 0.9, tile: '9p', consumed: ['9p', '9p', '9p'] }, // Daiminkan (consumes 3 from hand)
        { action: 'pon', confidence: 0.08, tile: '9p', consumed: ['9p', '9p'] }, // Pon (consumes 2 from hand)
        { action: 'none', confidence: 0.02 },
      ],
    },
    // Scenario 5: Chi (Eat) - Opponent discards 7m
    // Hand: 56m ...
    {
      tehai: ['5m', '6m', '8m', '9m', '1p', '2p', '3p', '4s', '5s', '6s', 'E', 'E', 'W'],
      recommendations: [
        { action: 'chi', confidence: 0.85, tile: '7m', consumed: ['5m', '6m'] }, // Chi 7m with 56m
        { action: 'none', confidence: 0.15 },
      ],
    },
    // Scenario 6: Ron (Win by discard)
    {
      tehai: ['1m', '2m', '3m', '4m', '5m', '6m', '7p', '8p', '9p', '1s', '2s', '3s', '9m'],
      recommendations: [
        { action: 'ron', confidence: 0.99, tile: '9m' },
        { action: 'none', confidence: 0.01 },
      ],
    },
    // Scenario 7: Tsumo (Win by self-draw)
    {
      tehai: ['1m', '2m', '3m', '4m', '5m', '6m', '7p', '8p', '9p', '1s', '2s', '3s', '9m', '9m'],
      recommendations: [
        { action: 'tsumo', confidence: 0.99, tile: '9m' },
        { action: 'none', confidence: 0.01 },
      ],
    },
    // Scenario 8: Kita (North Pull)
    {
      tehai: ['1m', '2m', '3m', '5m', '6m', '7m', '1p', '2p', '3p', '9p', '9p', 'N', 'E'],
      recommendations: [
        { action: 'nukidora', confidence: 0.9, tile: 'N' },
        { action: '9p', confidence: 0.05 },
        { action: 'E', confidence: 0.05 },
      ],
    },
    // Scenario 9: Ryuukyoku (Kyuushu Kyuuhai)
    {
      tehai: ['1m', '9m', '1p', '9p', '1s', '9s', 'E', 'S', 'W', 'N', 'P', 'F', 'C', '1m'],
      recommendations: [
        { action: 'ryukyoku', confidence: 0.8 },
        { action: '9m', confidence: 0.15 },
        { action: 'C', confidence: 0.05 },
      ],
    },
  ];

  // Cycle through scenarios
  const scenario = scenarios[counter % scenarios.length];

  return {
    recommendations: scenario.recommendations,
    is_riichi: false,
  };
}
