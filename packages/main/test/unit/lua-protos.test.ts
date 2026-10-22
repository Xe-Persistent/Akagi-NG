/**
 * The client ships its protobuf descriptors as Lua source with the properties
 * set on `Descriptor()`/`FieldDescriptor()` objects. Everything the bootstrap
 * builds -- the descriptor JSON the whole protocol layer runs on -- comes out of
 * this parser, so the shapes it reads are spelled out here as real snippets.
 */
import { describe, expect, it } from 'vitest';

import {
  decodeLuaPayload,
  looksLikeLua,
  parseLuaModule,
  resolveTypes,
} from '../../src/protocol/bootstrap/lua-protos.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** The obfuscation the client applies to these payloads. */
const XOR_KEY = 'wrelupqezdfrqdsd';

const accountModule = `
local Account = x.Descriptor()
Account.name = "Account"
Account.full_name = ".lq.Account"
local accountId = x.FieldDescriptor()
accountId.name = "account_id"
accountId.number = 2
accountId.label = 1
accountId.type = 5
local nickname = x.FieldDescriptor()
nickname.name = "nickname"
nickname.number = 1
nickname.label = 1
nickname.type = 9
Account.fields = { accountId, nickname }

local Color = x.EnumDescriptor()
Color.name = "Color"
Color.full_name = ".lq.Color"
local blue = x.EnumValueDescriptor()
blue.name = "BLUE"
blue.number = 2
blue.index = 1
local red = x.EnumValueDescriptor()
red.name = "RED"
red.number = 1
red.index = 0
Color.values = { red, blue }
`;

const loginModule = `
local b = require("Protol.liqi_struct_pb")
local ReqLogin = x.Descriptor()
ReqLogin.name = "ReqLogin"
ReqLogin.full_name = ".lq.ReqLogin"
local account = x.FieldDescriptor()
account.name = "account"
account.number = 1
account.label = 1
account.type = 11
account.message_type = b.Account
local Inner = x.Descriptor()
Inner.name = "Inner"
Inner.full_name = ".lq.ReqLogin.Inner"
Inner.containing_type = ReqLogin
local identity = x.FieldDescriptor()
identity.name = "identity"
identity.number = 1
identity.label = 1
identity.type = 11
identity.message_type = Inner
Inner.fields = { identity }
ReqLogin.nested_types = { Inner }
ReqLogin.fields = { account }
`;

describe('telling a Lua payload from a scrambled one', () => {
  it('accepts source that starts like a Lua file', () => {
    expect(looksLikeLua(encoder.encode(accountModule))).toBe(true);
    expect(looksLikeLua(encoder.encode('-- a comment\nlocal x = 1'))).toBe(true);
  });

  it('rejects binary and empty payloads', () => {
    expect(looksLikeLua(new Uint8Array())).toBe(false);
    expect(looksLikeLua(Uint8Array.from([0x00, 0xff, 0x93, 0x7a]))).toBe(false);
  });

  it('undoes the client obfuscation, and leaves plain source alone', () => {
    const plain = encoder.encode(accountModule);
    const scrambled = Uint8Array.from(
      plain,
      (byte, index) => byte ^ XOR_KEY.charCodeAt(index % XOR_KEY.length),
    );

    expect(looksLikeLua(scrambled)).toBe(false);
    expect(decoder.decode(decodeLuaPayload(scrambled))).toBe(accountModule);
    expect(decodeLuaPayload(plain)).toBe(plain);
  });
});

describe('a parsed module', () => {
  const module = parseLuaModule('liqi_struct_pb', accountModule);

  it('keeps the messages and enums it declares', () => {
    expect([...module.messagesByVar.keys()]).toEqual(['Account']);
    expect([...module.enumsByVar.keys()]).toEqual(['Color']);
    expect(module.topMessages.map((message) => message.fullName)).toEqual(['.lq.Account']);
  });

  it('sorts the fields the way the descriptor expects them', () => {
    const fields = module.messagesByVar.get('Account')!.fields;

    // Declared out of order on purpose: the descriptor is built by number.
    expect(fields.map((field) => [field.number, field.name])).toEqual([
      [1, 'nickname'],
      [2, 'account_id'],
    ]);
    expect(fields[1]).toMatchObject({ label: 1, typeCode: 5, index: 0 });
  });

  it('keeps the enum values in their declared index order', () => {
    const colour = module.enumsByVar.get('Color')!;

    expect(colour.values.map((value) => value.name)).toEqual(['RED', 'BLUE']);
    expect(colour.values.map((value) => value.number)).toEqual([1, 2]);
  });

  it('reads the package off the full names', () => {
    expect(module.package).toBe('lq');
  });
});

describe('a module that imports another', () => {
  const modules = new Map([['liqi_struct_pb', parseLuaModule('liqi_struct_pb', accountModule)]]);

  it('records the require as an import alias', () => {
    const module = parseLuaModule('liqi_pb', loginModule);

    expect([...module.imports]).toEqual([['b', 'liqi_struct_pb']]);
  });

  it('leaves a nested message out of the top level', () => {
    const module = parseLuaModule('liqi_pb', loginModule);

    expect(module.topMessages.map((message) => message.fullName)).toEqual(['.lq.ReqLogin']);
    expect(
      module.messagesByVar.get('ReqLogin')!.nestedMessages.map((message) => message.fullName),
    ).toEqual(['.lq.ReqLogin.Inner']);
  });

  it('resolves a field type inside the same module', () => {
    const module = parseLuaModule('liqi_pb', loginModule);
    modules.set('liqi_pb', module);
    resolveTypes(modules);

    const inner = module.messagesByVar.get('Inner')!;
    expect(inner.fields[0]!.typeFqn).toBe('.lq.ReqLogin.Inner');
  });

  it('resolves a field type across an import', () => {
    const module = parseLuaModule('liqi_pb', loginModule);
    modules.set('liqi_pb', module);
    resolveTypes(modules);

    const login = module.messagesByVar.get('ReqLogin')!;
    expect(login.fields[0]).toMatchObject({ name: 'account', typeFqn: '.lq.Account' });
  });

  it('leaves a reference to a module that was never loaded unresolved', () => {
    const module = parseLuaModule('liqi_pb', loginModule);
    resolveTypes(new Map([['liqi_pb', module]]));

    expect(module.messagesByVar.get('ReqLogin')!.fields[0]!.typeFqn).toBeUndefined();
  });
});
