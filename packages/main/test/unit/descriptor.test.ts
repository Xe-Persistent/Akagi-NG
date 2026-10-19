/**
 * The descriptor is what `assets/liqi.json` holds at runtime: get a field type or
 * a service method wrong here and the bridge stops decoding that message. These
 * tests build the input modules by hand so each shape is explicit.
 */
import { describe, expect, it } from 'vitest';

import {
  buildDescriptor,
  detectRegression,
  diffDescriptors,
  type LiqiDescriptorJson,
  type ProtoConfig,
  REQUIRED_MESSAGES,
  validateDescriptor,
} from '../../src/protocol/bootstrap/descriptor.js';
import type {
  ProtoEnum,
  ProtoField,
  ProtoMessage,
  ProtoModule,
} from '../../src/protocol/bootstrap/lua-protos.js';

const field = (over: Partial<ProtoField> & { name: string; number: number }): ProtoField => ({
  label: 1,
  typeCode: 9,
  index: 0,
  ...over,
});

const message = (
  over: Partial<ProtoMessage> & { name: string; fullName: string },
): ProtoMessage => ({
  varName: over.name,
  fields: [],
  nestedMessages: [],
  nestedEnums: [],
  hasContainingType: false,
  ...over,
});

const enumeration = (over: Partial<ProtoEnum> & { name: string; fullName: string }): ProtoEnum => ({
  varName: over.name,
  values: [],
  ...over,
});

function moduleOf(over: Partial<ProtoModule> & { name: string }): ProtoModule {
  const topMessages = over.topMessages ?? [];
  const topEnums = over.topEnums ?? [];
  return {
    package: 'lq',
    imports: new Map(),
    messagesByVar: new Map(topMessages.map((item) => [item.varName, item])),
    enumsByVar: new Map(topEnums.map((item) => [item.varName, item])),
    topMessages,
    topEnums,
    ...over,
  };
}

const players = message({
  name: 'Player',
  fullName: '.lq.Player',
  fields: [
    field({ name: 'account_id', number: 1, typeCode: 5 }),
    field({ name: 'nickname', number: 2, typeCode: 9, label: 3 }),
  ],
});

describe('building the descriptor', () => {
  it('renders fields with the protobuf.js type names and ids', () => {
    const { descriptor, stats } = buildDescriptor(
      new Map([['a', moduleOf({ name: 'a', topMessages: [players] })]]),
      {},
    );

    expect(descriptor.nested.lq.nested.Player).toEqual({
      fields: {
        account_id: { type: 'int32', id: 1 },
        nickname: { type: 'string', id: 2, rule: 'repeated' },
      },
    });
    expect(stats.messages).toBe(1);
  });

  it('resolves a message field to a path under the wire package', () => {
    const holder = message({
      name: 'Holder',
      fullName: '.lq.Holder',
      fields: [field({ name: 'player', number: 1, typeCode: 11, typeFqn: '.lq.Player' })],
    });

    const { descriptor, stats } = buildDescriptor(
      new Map([['a', moduleOf({ name: 'a', topMessages: [players, holder] })]]),
      {},
    );

    expect(descriptor.nested.lq.nested.Holder).toEqual({
      fields: { player: { type: 'Player', id: 1 } },
    });
    expect(stats.unresolvedFields).toEqual([]);
  });

  it('falls back to bytes and reports a type it could not resolve', () => {
    const holder = message({
      name: 'Holder',
      fullName: '.lq.Holder',
      fields: [field({ name: 'player', number: 1, typeCode: 11 })],
    });

    const { descriptor, stats } = buildDescriptor(
      new Map([['a', moduleOf({ name: 'a', topMessages: [holder] })]]),
      {},
    );

    expect(
      (descriptor.nested.lq.nested.Holder as { fields: Record<string, unknown> }).fields,
    ).toEqual({ player: { type: 'bytes', id: 1 } });
    expect(stats.unresolvedFields).toEqual(['.lq.Holder.player']);
  });

  it('nests a child message and an enum under their parent', () => {
    const inner = message({ name: 'Inner', fullName: '.lq.Outer.Inner', hasContainingType: true });
    const kind = enumeration({
      name: 'Kind',
      fullName: '.lq.Outer.Kind',
      values: [{ name: 'A', number: 1, index: 0 }],
    });
    const outer = message({
      name: 'Outer',
      fullName: '.lq.Outer',
      nestedMessages: [inner],
      nestedEnums: [kind],
    });

    const { descriptor, stats } = buildDescriptor(
      new Map([['a', moduleOf({ name: 'a', topMessages: [outer], topEnums: [] })]]),
      {},
    );

    expect(descriptor.nested.lq.nested.Outer).toMatchObject({
      fields: {},
      nested: { Inner: { fields: {} }, Kind: { values: { A: 1 } } },
    });
    expect(stats.enums).toBe(1);
  });

  it('keeps a service method whose types both exist', () => {
    const protoConfig: ProtoConfig = {
      service: { FastTest: { authGame: { request: 'ReqAuthGame', response: '.lq.ResAuthGame' } } },
    };
    const request = message({ name: 'ReqAuthGame', fullName: '.lq.ReqAuthGame' });
    const response = message({ name: 'ResAuthGame', fullName: '.lq.ResAuthGame' });

    const { descriptor, stats } = buildDescriptor(
      new Map([['a', moduleOf({ name: 'a', topMessages: [request, response] })]]),
      protoConfig,
    );

    expect(descriptor.nested.lq.nested.FastTest).toEqual({
      methods: { authGame: { requestType: 'ReqAuthGame', responseType: 'ResAuthGame' } },
    });
    expect(stats.methods).toBe(1);
    expect(stats.skippedMethods).toEqual([]);
  });

  it('drops a route whose types were stripped from the build', () => {
    const protoConfig: ProtoConfig = {
      service: { FastTest: { authGame: { request: 'ReqGone', response: 'ResGone' } } },
    };

    const { descriptor, stats } = buildDescriptor(new Map(), protoConfig);

    expect(descriptor.nested.lq.nested.FastTest).toBeUndefined();
    expect(stats.skippedMethods).toEqual(['FastTest.authGame']);
    expect(stats.methods).toBe(0);
  });

  it('ignores a module from another package', () => {
    const foreign = moduleOf({
      name: 'foreign',
      package: 'pm',
      topMessages: [message({ name: 'Other', fullName: '.pm.Other' })],
    });

    const { descriptor, stats } = buildDescriptor(new Map([['f', foreign]]), {});

    expect(descriptor.nested.lq.nested).toEqual({});
    expect(stats.messages).toBe(0);
  });

  it('refuses to build from two modules declaring the same message', () => {
    const duplicate = message({ name: 'Player', fullName: '.lq.Player' });

    expect(() =>
      buildDescriptor(
        new Map([
          ['a', moduleOf({ name: 'a', topMessages: [players] })],
          ['b', moduleOf({ name: 'b', topMessages: [duplicate] })],
        ]),
        {},
      ),
    ).toThrow('Duplicate message .lq.Player');
  });
});

/** A descriptor holding exactly the messages the bridge requires. */
function completeDescriptor(extra: Record<string, unknown> = {}): LiqiDescriptorJson {
  const nested: Record<string, unknown> = { ...extra };
  for (const name of REQUIRED_MESSAGES) nested[name] = { fields: {} };
  // The route needs its request type to exist, or protobuf.js cannot resolve it.
  nested.ReqAuthGame = { fields: {} };
  nested.FastTest = {
    methods: { authGame: { requestType: 'ReqAuthGame', responseType: 'ResAuthGame' } },
  };
  return { nested: { lq: { nested, options: {} } } };
}

describe('validating a descriptor', () => {
  it('accepts one that holds every required message', () => {
    expect(() => validateDescriptor(completeDescriptor())).not.toThrow();
  });

  it('names the message that is missing', () => {
    const descriptor = completeDescriptor();
    delete (descriptor.nested.lq.nested as Record<string, unknown>).Wrapper;

    expect(() => validateDescriptor(descriptor)).toThrow('Required message Wrapper is missing');
  });
});

describe('comparing a descriptor with the previous one', () => {
  const previous = completeDescriptor();
  const shrunk = completeDescriptor();
  delete (shrunk.nested.lq.nested as Record<string, unknown>).ActionPrototype;
  delete (shrunk.nested.lq.nested as Record<string, unknown>).ReqChiPengGang;

  it('has nothing to say without a previous schema', () => {
    expect(detectRegression(null, previous)).toBeNull();
  });

  it('flags an extraction that lost a large part of the schema', () => {
    expect(detectRegression(previous, shrunk)).toContain('looks truncated');
  });

  it('stays quiet for a schema that barely moved', () => {
    const grown = completeDescriptor({ SomethingNew: { fields: {} } });

    expect(detectRegression(previous, grown)).toBeNull();
    expect(diffDescriptors(previous, grown)).toEqual(['+1 message(s): SomethingNew']);
  });
});

describe('describing what changed', () => {
  const previous = completeDescriptor();

  it('says there is nothing to compare against', () => {
    expect(diffDescriptors(null, previous)).toEqual(['no previous schema to compare against']);
  });

  it('reports an unchanged schema', () => {
    expect(diffDescriptors(previous, completeDescriptor())).toEqual(['schema is unchanged']);
  });

  it('reports messages and routes that disappeared', () => {
    const next = completeDescriptor();
    const nested = next.nested.lq.nested as Record<string, unknown>;
    delete nested.Wrapper;
    delete nested.FastTest;

    const changes = diffDescriptors(previous, next);

    expect(changes).toContain('-1 message(s): Wrapper');
    expect(changes).toContain('-1 rpc(s): FastTest.authGame');
  });
});
