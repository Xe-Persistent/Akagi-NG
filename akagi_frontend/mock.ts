import http from 'node:http';

interface Recommendation {
  action: string;
  confidence: number;
  consumed?: string[];
  sim_candidates?: { tile: string; confidence: number }[];
  tile?: string;
  is_riichi_declaration?: boolean;
}

interface RecommendationData {
  type: string;
  data: {
    recommendations: Recommendation[];
    tehai: string[];
    is_riichi_declaration?: boolean;
  };
}

// Visual Verification Mock Server for Riichi Discard
console.log('Starting server in MOCK mode (SSE) for Riichi Visual Test.');

const STREAM_INTERVAL_MS = 5000;
const KEEPALIVE_INTERVAL_MS = 3000;

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const port = 8765;
const hostname = '127.0.0.1';

// In-memory settings storage
let mockSettings = {
  log_level: 'INFO',
  locale: 'zh-CN',
  majsoul_url: 'https://www.majsoul.com/1/',
  model: 'mortal',
  browser: {
    headless: false,
    channel: 'msedge',
    window_size: '1280x720',
  },
  server: {
    host: '127.0.0.1',
    port: 8765,
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
        } catch (e) {
          res.writeHead(400, corsHeaders);
          res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }));
        }
      });
      return;
    }
  }

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/sse')) {
    console.log('SSE client connected');

    res.writeHead(200, {
      ...corsHeaders,
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    const sendData = () => {
      const mockData = generateMockData();
      console.log('Generated and sending new mock data');
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

let stateCounter = 0;

function generateMockData(): RecommendationData {
  const scenarios = [
    // Scenario 1: Standard Discard (Mid-game)
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

    // Scenario 3 (Revised): Pure Multi-Kan Self Turn
    // Hand: 4444m 567m 7777s (holding all 4)
    {
      tehai: ['4m', '4m', '4m', '4m', '5m', '6m', '7m', '7s', '7s', '7s', '7s', 'E', 'E', 'S'],
      recommendations: [
        { action: 'kan_select', confidence: 0.9, tile: '4m', consumed: ['4m', '4m', '4m', '4m'] },
        { action: 'kan_select', confidence: 0.9, tile: '7s', consumed: ['7s', '7s', '7s', '7s'] },
        { action: '7s', confidence: 0.1 }, // Skip kan
      ],
    },
    // Scenario 4: Pon (Bump) vs Daiminkan (Open Kan)
    // Hand: 999p 123s ... Opponent discards 9p
    {
      tehai: ['9p', '9p', '9p', '1s', '2s', '3s', '4s', '5s', '6s', 'E', 'E', 'S', 'S'],
      recommendations: [
        { action: 'kan_select', confidence: 0.9, tile: '9p', consumed: ['9p', '9p', '9p'] }, // Daiminkan (consumes 3 from hand)
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
  ];

  // Cycle through scenarios
  const scenario = scenarios[stateCounter % scenarios.length];
  stateCounter++;

  return {
    type: 'recommandations',
    data: {
      recommendations: scenario.recommendations,
      tehai: scenario.tehai,
      is_riichi_declaration: false,
    },
  };
}
