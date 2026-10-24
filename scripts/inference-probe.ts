/**
 * Live smoke test for the online inference service.
 *
 * Usage:
 *   AKAGI_OT_KEY=ot_xxx tsx scripts/inference-probe.ts [--no-react] [--timeout 3000]
 *                                                     [--model ID] [--all-models]
 *
 * It exercises the same client, stream shaping and mapping the app uses, so a
 * failure here is a failure in the app. The key is read from the environment or
 * `--key`, is only ever sent in the `Authorization` header, and is printed
 * masked. `--no-react` skips the paid `/v3/react` call and only reads the plan,
 * the model list and the health. By default one decision is requested with the
 * server's default model; `--model` picks a specific one and `--all-models`
 * sweeps the list (rate limits apply).
 */
import {
  DEFAULT_BASE_URL,
  InferenceClient,
  InferenceError,
} from '../packages/main/src/services/online/inference-client.js';
import { buildApiEvents } from '../packages/main/src/services/online/kyoku-stream.js';
import type { MJAIEvent } from '../packages/main/src/shared/schema/mjai.js';

interface Options {
  key: string;
  baseUrl: string;
  reactTimeoutMs: number;
  react: boolean;
  /** Model ids to try; empty means the server default only. */
  models: string[];
  allModels: boolean;
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    key: process.env.AKAGI_OT_KEY ?? '',
    baseUrl: DEFAULT_BASE_URL,
    reactTimeoutMs: 3000,
    react: true,
    models: [],
    allModels: false,
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    switch (arg) {
      case '--no-react':
        options.react = false;
        break;
      case '--key':
        options.key = argv[++index] ?? '';
        break;
      case '--base':
        options.baseUrl = argv[++index] ?? options.baseUrl;
        break;
      case '--timeout':
        options.reactTimeoutMs = Number(argv[++index]);
        break;
      case '--model':
        options.models.push(argv[++index] ?? '');
        break;
      case '--all-models':
        // A key is rate limited per minute (`rpm` in `/v3/key`), and a sweep
        // spends one call per model: ask for it explicitly.
        options.allModels = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

interface Window {
  label: string;
  events: MJAIEvent[];
}

/**
 * Two windows from one legal 4-player opening, because the two decision kinds
 * take different paths through the service: our own turn (where a reach needs a
 * second call for the discard) and a seat-1 discard we hold a pair for (a pon
 * window, which is legal from any seat). Neither spends a call on a turn with
 * nothing to choose.
 */
function windows(): Window[] {
  const hidden = Array.from({ length: 13 }, () => '?');
  const ourHand = ['2m', '3m', '4m', '5m', '6m', '7m', 'E', 'E', '4p', '6s', '7s', '8s', 'S'];
  // A closed hand one tile from tenpai, where the model usually declares.
  const reachable = ['2m', '3m', '4m', '5m', '6m', '7m', '2p', '3p', '4p', '6s', '7s', '8s', 'E'];

  const start = (hand: string[]): MJAIEvent[] => [
    { type: 'start_game', names: ['p0', 'p1', 'p2', 'p3'], num_players: 4 },
    {
      type: 'start_kyoku',
      bakaze: 'E',
      dora_marker: '5s',
      kyoku: 1,
      honba: 0,
      kyotaku: 0,
      oya: 0,
      scores: [25000, 25000, 25000, 25000],
      tehais: [hand, hidden, hidden, hidden],
    },
  ];

  return [
    {
      label: 'our own turn (draw)',
      events: [...start(ourHand), { type: 'tsumo', actor: 0, pai: '1s' }],
    },
    {
      label: 'our own turn, closed hand (reach?)',
      events: [...start(reachable), { type: 'tsumo', actor: 0, pai: '1p' }],
    },
    {
      label: 'pon window (seat 1 discards E)',
      events: [
        ...start(ourHand),
        { type: 'tsumo', actor: 0, pai: '1s' },
        { type: 'dahai', actor: 0, pai: '1s', tsumogiri: true },
        { type: 'tsumo', actor: 1, pai: '?' },
        { type: 'dahai', actor: 1, pai: 'E', tsumogiri: false },
      ],
    },
  ];
}

function mask(key: string): string {
  return key.length <= 4 ? '****' : `****${key.slice(-4)}`;
}

function step(label: string): void {
  console.log(`\n=== ${label} ===`);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (!options.key.trim()) {
    throw new Error('No API key: set AKAGI_OT_KEY or pass --key');
  }

  const client = new InferenceClient({
    apiKey: options.key,
    baseUrl: options.baseUrl,
    reactTimeoutMs: options.reactTimeoutMs,
  });

  console.log(`server ${client.baseUrl}`);
  console.log(`key    ${mask(options.key)}`);

  step('GET /healthz (no key)');
  console.log(await InferenceClient.health(client.baseUrl));

  step('GET /v3/key');
  console.log(await client.keyStatus());

  step('GET /v3/models');
  const models = await client.models();
  console.table(models);

  if (!options.react) {
    console.log('\n--no-react: skipping the paid decision call');
    return;
  }

  const targets = options.allModels
    ? ['', ...models.map((entry) => entry.id)]
    : options.models.length > 0
      ? options.models
      : [''];

  for (const model of targets) {
    for (const window of windows()) {
      const events = buildApiEvents(window.events, 0, false);
      if (!events) throw new Error(`the window "${window.label}" did not validate`);

      step(`POST /v3/react — ${window.label} (model: ${model || 'server default'})`);
      const startedAt = Date.now();
      try {
        const response = await client.react(model, 0, events);
        const elapsed = Date.now() - startedAt;
        console.log(`model      ${response.model ?? '(none)'}`);
        console.log(`elapsed    ${elapsed}ms (budget ${client.reactTimeoutMs}ms)`);
        console.log(`reaction   ${JSON.stringify(response.reaction)}`);
        console.table(response.candidates);

        if (response.reaction?.type === 'reach') {
          // A bare reach needs a follow-up call to learn which tile to discard.
          const followUp = [...events, { type: 'reach', actor: 0 }];
          const second = await client.react(model, 0, followUp);
          console.log(`follow-up  ${JSON.stringify(second.reaction)}`);
        }
      } catch (error) {
        if (error instanceof InferenceError) {
          console.error(`failed (${error.kind}, status ${error.status ?? '-'}): ${error.message}`);
        } else {
          console.error('failed:', error);
        }
      }
    }
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
