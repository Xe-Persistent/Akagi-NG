/**
 * The bootstrap turns the Lua descriptors a game client ships into the schema the
 * bridge decodes with. These tests drive the pure half: picking the protocol
 * assets out of a bundle listing, and compiling sources into a validated schema.
 */
import { describe, expect, it } from 'vitest';

import {
  collectProtocolAssetPaths,
  compileProtocolDescriptor,
  PROTO_CONFIG_ASSET,
  type ProtocolSources,
  PROTOL_ASSET_PREFIX,
} from '../../src/protocol/bootstrap/bootstrap.js';
import { REQUIRED_MESSAGES } from '../../src/protocol/bootstrap/descriptor.js';

/** The smallest Lua that declares a message the descriptor can render. */
function luaMessage(name: string): string {
  return (
    `local ${name} = x.Descriptor()\n` +
    `${name}.name = "${name}"\n` +
    `${name}.full_name = ".lq.${name}"\n`
  );
}

function sources(luaSources: Map<string, string>): ProtocolSources {
  return { luaSources, protoConfig: {}, issuer: 'web', productVersion: '0.11', bundleHash: 'abc' };
}

describe('picking the protocol assets out of a bundle', () => {
  const assets = [
    'LuaByte/Lua/Protol/liqi_struct_pb.lua.bytes',
    'LuaByte/Lua/Protol/liqi_pb.lua.bytes',
    'LuaByte/Lua/Protol/README.txt',
    'LuaByte/Lua/Other/liqi_pb.lua.bytes',
    'MyAssets/docs/proto_config.bytes',
    'MyAssets/docs/other.bytes',
    'Assets/Resources/logo.png',
  ];

  it('keeps the Lua descriptors and the proto config', () => {
    expect(collectProtocolAssetPaths(assets)).toEqual([
      'LuaByte/Lua/Protol/liqi_struct_pb.lua.bytes',
      'LuaByte/Lua/Protol/liqi_pb.lua.bytes',
      'MyAssets/docs/proto_config.bytes',
    ]);
  });

  it('keeps the order the bundle listed them in', () => {
    const reversed = [...assets].reverse();

    expect(collectProtocolAssetPaths(reversed)).toEqual([
      'MyAssets/docs/proto_config.bytes',
      'LuaByte/Lua/Protol/liqi_pb.lua.bytes',
      'LuaByte/Lua/Protol/liqi_struct_pb.lua.bytes',
    ]);
  });

  it('matches the exact suffix and prefix, not a substring', () => {
    expect(collectProtocolAssetPaths([`${PROTOL_ASSET_PREFIX}x.lua.bytes.bak`])).toEqual([]);
    expect(collectProtocolAssetPaths([`${PROTO_CONFIG_ASSET}.bak`])).toEqual([]);
    expect(collectProtocolAssetPaths([`prefix/${PROTO_CONFIG_ASSET}`])).toEqual([]);
  });

  it('finds nothing in a bundle that does not carry the protocol', () => {
    expect(collectProtocolAssetPaths(['Assets/Resources/logo.png'])).toEqual([]);
  });
});

describe('compiling the sources', () => {
  it('produces a schema that validates against the required messages', () => {
    const lua = [...REQUIRED_MESSAGES].map(luaMessage).join('\n');

    const build = compileProtocolDescriptor(sources(new Map([['liqi_pb', lua]])));

    expect(build.stats.messages).toBe(REQUIRED_MESSAGES.length);
    expect(Object.keys(build.descriptor.nested.lq.nested)).toEqual(
      expect.arrayContaining(REQUIRED_MESSAGES),
    );
  });

  it('refuses to ship a schema missing a message the bridge needs', () => {
    const partial = REQUIRED_MESSAGES.filter((name) => name !== 'Wrapper')
      .map(luaMessage)
      .join('\n');

    expect(() => compileProtocolDescriptor(sources(new Map([['liqi_pb', partial]])))).toThrow(
      'Required message Wrapper is missing',
    );
  });

  it('resolves a field type that lives in another module', () => {
    const struct = `
local Account = x.Descriptor()
Account.name = "Account"
Account.full_name = ".lq.Account"
`;
    const login = `
local b = require("Protol.liqi_struct_pb")
${[...REQUIRED_MESSAGES].map(luaMessage).join('\n')}
local Holder = x.Descriptor()
Holder.name = "Holder"
Holder.full_name = ".lq.Holder"
local account = x.FieldDescriptor()
account.name = "account"
account.number = 1
account.label = 1
account.type = 11
account.message_type = b.Account
Holder.fields = { account }
`;

    const build = compileProtocolDescriptor(
      sources(
        new Map([
          ['liqi_struct_pb', struct],
          ['liqi_pb', login],
        ]),
      ),
    );

    expect(build.descriptor.nested.lq.nested).toMatchObject({
      Holder: { fields: { account: { type: 'Account', id: 1 } } },
    });
    expect(build.stats.unresolvedFields).toEqual([]);
  });
});
