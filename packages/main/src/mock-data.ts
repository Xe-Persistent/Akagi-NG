// Removed frontend type dependency for isolated compilation
export function generateMockData(counter: number): Record<string, unknown> {
  const scenarios = [
    // 场景 1：普通打牌
    {
      tehai: ['1m', '2m', '3m', '5m', '6m', '7m', '1p', '1p', '5p', '0p', '9p', 'E', 'E', 'W'],
      recommendations: [
        { action: 'W', confidence: 0.85 },
        { action: '9p', confidence: 0.1 },
        { action: '1p', confidence: 0.05 },
      ],
    },
    // 场景 2：立直前瞻（类似二杯口的形态）
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

    // 场景 3：混合杠（暗杠 4m + 加杠 7s）
    {
      tehai: ['4m', '4m', '4m', '4m', '5m', '6m', '7m', 'E', 'E', 'E', '7s'], // has a 7s, 7s, 7s from Pon
      recommendations: [
        { action: 'kan', confidence: 0.9, tile: '5m', consumed: ['5m', '5mr', '5m', '5m'] }, // Ankan (consumes 4 from hand)
        { action: 'kan', confidence: 0.9, tile: '7s', consumed: ['7s'] }, // Kakan (consumes 1 from hand)
        { action: '7s', confidence: 0.1 }, // Skip kan
      ],
    },
    // 场景 4：碰 vs 大明杠
    // 手牌：999p 123s ... 对手打出 9p
    {
      tehai: ['9p', '9p', '9p', '1s', '2s', '3s', '4s', '5s', '6s', 'E', 'E', 'S', 'S'],
      recommendations: [
        { action: 'kan', confidence: 0.9, tile: '9p', consumed: ['9p', '9p', '9p'] }, // Daiminkan (consumes 3 from hand)
        { action: 'pon', confidence: 0.08, tile: '9p', consumed: ['9p', '9p'] }, // Pon (consumes 2 from hand)
        { action: 'none', confidence: 0.02 },
      ],
    },
    // 场景 5：吃 - 对手打出 7m
    // 手牌：56m ...
    {
      tehai: ['5m', '6m', '8m', '9m', '1p', '2p', '3p', '4s', '5s', '6s', 'E', 'E', 'W'],
      recommendations: [
        { action: 'chi', confidence: 0.85, tile: '7m', consumed: ['5m', '6m'] }, // Chi 7m with 56m
        { action: 'none', confidence: 0.15 },
      ],
    },
    // 场景 6：荣和
    {
      tehai: ['1m', '2m', '3m', '4m', '5m', '6m', '7p', '8p', '9p', '1s', '2s', '3s', '9m'],
      recommendations: [
        { action: 'ron', confidence: 0.99, tile: '9m' },
        { action: 'none', confidence: 0.01 },
      ],
    },
    // 场景 7：自摸
    {
      tehai: ['1m', '2m', '3m', '4m', '5m', '6m', '7p', '8p', '9p', '1s', '2s', '3s', '9m', '9m'],
      recommendations: [
        { action: 'tsumo', confidence: 0.99, tile: '9m' },
        { action: 'none', confidence: 0.01 },
      ],
    },
    // 场景 8：拔北
    {
      tehai: ['1m', '2m', '3m', '5m', '6m', '7m', '1p', '2p', '3p', '9p', '9p', 'N', 'E'],
      recommendations: [
        { action: 'nukidora', confidence: 0.9, tile: 'N' },
        { action: '9p', confidence: 0.05 },
        { action: 'E', confidence: 0.05 },
      ],
    },
    // 场景 9：流局（九种九牌）
    {
      tehai: ['1m', '9m', '1p', '9p', '1s', '9s', 'E', 'S', 'W', 'N', 'P', 'F', 'C', '1m'],
      recommendations: [
        { action: 'ryukyoku', confidence: 0.8 },
        { action: '9m', confidence: 0.15 },
        { action: 'C', confidence: 0.05 },
      ],
    },
  ];

  // 轮换场景
  const scenario = scenarios[counter % scenarios.length];

  // 轮换状态用于可视化验证
  const statusStates: Array<Record<string, unknown>> = [
    { engine_type: 'akagiot', fallback_used: false, circuit_open: false }, // Online (Green)
    { engine_type: 'mortal', fallback_used: false, circuit_open: false }, // Local (Blue)
    { engine_type: 'akagiot', fallback_used: true, circuit_open: false }, // Fallback (Yellow)
    { engine_type: 'akagiot', fallback_used: true, circuit_open: true }, // Circuit Open (Red)
    { engine_type: 'unknown', fallback_used: false, circuit_open: false }, // Null Engine (Gray)
  ];
  const status = statusStates[counter % statusStates.length];

  return {
    recommendations: scenario.recommendations,
    ...status,
  };
}
