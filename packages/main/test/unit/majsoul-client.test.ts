/**
 * The bundle names its text assets one way and `proto_config.bytes` names the
 * same asset another, so the lookup tries the spellings in order.
 */
import { describe, expect, it } from 'vitest';

import {
  findTextAsset,
  type RemoteTextAsset,
} from '../../src/protocol/bootstrap/majsoul-client.js';

const asset = (name: string): RemoteTextAsset => ({ name, data: new Uint8Array([1, 2, 3]) });

describe('finding a text asset', () => {
  it('matches the base name of a nested path', () => {
    const assets = new Map([['proto_config', asset('proto_config')]]);

    expect(findTextAsset(assets, 'MyAssets/docs/proto_config.bytes')?.name).toBe('proto_config');
  });

  it('falls back to the name without the .bytes suffix', () => {
    const assets = new Map([['liqi_struct_pb.lua', asset('liqi_struct_pb.lua')]]);

    expect(findTextAsset(assets, 'LuaByte/Lua/Protol/liqi_struct_pb.lua.bytes')?.name).toBe(
      'liqi_struct_pb.lua',
    );
  });

  it('tries the stored name with .bytes appended last', () => {
    const assets = new Map([['proto_config.bytes', asset('proto_config.bytes')]]);

    expect(findTextAsset(assets, 'proto_config')?.name).toBe('proto_config.bytes');
  });

  it('returns undefined when the bundle does not carry it', () => {
    const assets = new Map([['something-else', asset('something-else')]]);

    expect(findTextAsset(assets, 'MyAssets/docs/proto_config.bytes')).toBeUndefined();
  });

  it('does not match on a partial name', () => {
    const assets = new Map([['proto', asset('proto')]]);

    expect(findTextAsset(assets, 'MyAssets/docs/proto_config.bytes')).toBeUndefined();
  });
});
