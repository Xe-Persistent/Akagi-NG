import * as protobuf from 'protobufjs';

import {
  FIELD_TYPE_ENUM,
  FIELD_TYPE_MESSAGE,
  LABEL_REPEATED,
  PROTO_TYPE_NAMES,
  type ProtoEnum,
  type ProtoMessage,
  type ProtoModule,
  WIRE_PACKAGE,
} from './lua-protos.js';

/**
 * Renders the extracted Lua descriptors into the protobuf.js descriptor JSON
 * that `assets/liqi.json` uses, i.e. the exact shape `LiqiProto` consumes:
 *
 *   { "nested": { "lq": { "nested": {
 *       "<Message>": { "fields": { "<field>": { "type", "id", "rule"? } } },
 *       "<Enum>": { "values": { "<name>": <number> } },
 *       "<Service>": { "methods": { "<rpc>": { "requestType", "responseType" } } }
 *   } } } }
 */
const PACKAGE_OPTIONS = { go_package: '.;majprotocol' };

/**
 * Messages the bridge cannot work without; a run that loses one of these is
 * treated as a failed extraction instead of silently shipping a broken schema.
 */
export const REQUIRED_MESSAGES = [
  'ResAuthGame',
  'ActionPrototype',
  'ReqSelfOperation',
  'ResSyncGame',
  'RecordNewRound',
  'ReqChiPengGang',
  'OptionalOperationList',
  'Wrapper',
  'ResEnterGame',
  'GameEndResult',
];

export interface ProtoServiceMethod {
  request: string;
  response: string;
}

export interface ProtoConfig {
  service?: Record<string, Record<string, ProtoServiceMethod>>;
}

export interface MessageDescriptorJson {
  fields: Record<string, { type: string; id: number; rule?: string }>;
  nested?: Record<string, unknown>;
}

export interface LiqiDescriptorJson {
  nested: {
    lq: {
      nested: Record<string, unknown>;
      options: Record<string, unknown>;
    };
  };
}

export interface DescriptorStats {
  messages: number;
  enums: number;
  services: number;
  methods: number;
  /** RPCs dropped because their request/response types are stripped from the build. */
  skippedMethods: string[];
  /** Fields whose message/enum type could not be resolved (emitted as `bytes`). */
  unresolvedFields: string[];
}

export interface DescriptorBuild {
  descriptor: LiqiDescriptorJson;
  stats: DescriptorStats;
}

export function buildDescriptor(
  modules: Map<string, ProtoModule>,
  protoConfig: ProtoConfig,
): DescriptorBuild {
  const wireModules = [...modules.values()].filter((module) => module.package === WIRE_PACKAGE);
  const nested: Record<string, unknown> = {};
  /** Relative paths (e.g. `Search.X`), i.e. what protobuf.js resolves under `lq`. */
  const messagePaths = new Set<string>();
  const seenFullNames = new Set<string>();
  const unresolvedFields: string[] = [];

  for (const module of wireModules) {
    for (const item of module.topEnums) nested[item.name] = buildEnumJson(item);
    for (const message of module.topMessages) {
      if (seenFullNames.has(message.fullName)) {
        throw new Error(`Duplicate message ${message.fullName} from ${module.name}`);
      }
      seenFullNames.add(message.fullName);
      const path = relativeName(message.fullName);
      messagePaths.add(path);
      nested[path] = buildMessageJson(message, unresolvedFields);
    }
  }

  const services = normalizeServices(protoConfig);
  const skippedMethods: string[] = [];
  let methodCount = 0;
  for (const [serviceName, methods] of Object.entries(services)) {
    const kept: Record<string, { requestType: string; responseType: string }> = {};
    for (const [methodName, spec] of Object.entries(methods)) {
      const request = resolveMessagePath(spec.request, messagePaths);
      const response = resolveMessagePath(spec.response, messagePaths);
      if (!request || !response) {
        skippedMethods.push(`${serviceName}.${methodName}`);
        continue;
      }
      // `LiqiProto.getMessageClass` prefixes the name with `lq.`, so relative
      // paths are what both the flat and the nested messages need here.
      kept[methodName] = { requestType: request, responseType: response };
      methodCount++;
    }
    if (Object.keys(kept).length > 0) nested[serviceName] = { methods: kept };
  }

  const descriptor: LiqiDescriptorJson = {
    nested: { lq: { nested: sortKeys(nested), options: PACKAGE_OPTIONS } },
  };

  return {
    descriptor,
    stats: {
      messages: messagePaths.size,
      enums: countEnums(wireModules),
      services: Object.keys(services).length,
      methods: methodCount,
      skippedMethods,
      unresolvedFields,
    },
  };
}

/**
 * Loads the descriptor with protobuf.js and resolves every reference — the same
 * path the bridge takes at runtime, so a schema that fails here never ships.
 */
export function validateDescriptor(descriptor: LiqiDescriptorJson): void {
  const root = protobuf.Root.fromJSON(descriptor as protobuf.INamespace);
  root.resolveAll();

  for (const name of REQUIRED_MESSAGES) {
    if (!root.lookup(`lq.${name}`)) {
      throw new Error(`Required message ${name} is missing from the extracted schema`);
    }
  }
}

/** Loss above this share of the previous schema is reported as suspicious. */
const REGRESSION_THRESHOLD = 0.1;

/**
 * Flags an extraction that lost a noticeable part of the previous schema, which
 * is what a half-downloaded or partially parsed client build looks like.
 */
export function detectRegression(
  previous: LiqiDescriptorJson | null,
  next: LiqiDescriptorJson,
): string | null {
  if (!previous) return null;

  const before = summarize(previous);
  const after = summarize(next);
  const losses: string[] = [];
  for (const [label, previousCount, nextCount] of [
    ['message', before.messages.size, after.messages.size],
    ['rpc route', before.methods.size, after.methods.size],
  ] as const) {
    if (previousCount === 0) continue;
    if ((previousCount - nextCount) / previousCount > REGRESSION_THRESHOLD) {
      losses.push(`${label}s dropped from ${previousCount} to ${nextCount}`);
    }
  }

  return losses.length > 0 ? `the extracted schema looks truncated: ${losses.join('; ')}` : null;
}

/** Human-readable summary of what changed between two descriptor builds. */ export function diffDescriptors(
  previous: LiqiDescriptorJson | null,
  next: LiqiDescriptorJson,
): string[] {
  if (!previous) return ['no previous schema to compare against'];

  const before = summarize(previous);
  const after = summarize(next);
  const changes: string[] = [];

  const addedMessages = [...after.messages].filter((name) => !before.messages.has(name));
  const removedMessages = [...before.messages].filter((name) => !after.messages.has(name));
  const addedMethods = [...after.methods].filter((name) => !before.methods.has(name));
  const removedMethods = [...before.methods].filter((name) => !after.methods.has(name));

  if (addedMessages.length)
    changes.push(`+${addedMessages.length} message(s): ${preview(addedMessages)}`);
  if (removedMessages.length)
    changes.push(`-${removedMessages.length} message(s): ${preview(removedMessages)}`);
  if (addedMethods.length) changes.push(`+${addedMethods.length} rpc(s): ${preview(addedMethods)}`);
  if (removedMethods.length)
    changes.push(`-${removedMethods.length} rpc(s): ${preview(removedMethods)}`);
  if (changes.length === 0) changes.push('schema is unchanged');

  return changes;
}

interface DescriptorSummary {
  messages: Set<string>;
  methods: Set<string>;
}

function summarize(descriptor: LiqiDescriptorJson): DescriptorSummary {
  const messages = new Set<string>();
  const methods = new Set<string>();
  collectSummary(descriptor.nested.lq.nested, '', messages, methods);
  return { messages, methods };
}

function collectSummary(
  entries: Record<string, unknown>,
  prefix: string,
  messages: Set<string>,
  methods: Set<string>,
): void {
  for (const [name, value] of Object.entries(entries)) {
    const entry = value as {
      fields?: unknown;
      nested?: Record<string, unknown>;
      methods?: unknown;
    };
    if (entry.fields) messages.add(`${prefix}${name}`);
    if (entry.nested) collectSummary(entry.nested, `${prefix}${name}.`, messages, methods);
    if (entry.methods) {
      for (const method of Object.keys(entry.methods as Record<string, unknown>)) {
        methods.add(`${name}.${method}`);
      }
    }
  }
}

function buildMessageJson(
  message: ProtoMessage,
  unresolvedFields: string[],
): MessageDescriptorJson {
  const fields: MessageDescriptorJson['fields'] = {};
  for (const field of message.fields) {
    let type: string;
    if (field.typeCode === FIELD_TYPE_MESSAGE || field.typeCode === FIELD_TYPE_ENUM) {
      const resolved = field.typeFqn ? relativeName(field.typeFqn) : undefined;
      if (resolved) {
        type = resolved;
      } else {
        type = 'bytes';
        unresolvedFields.push(`${message.fullName}.${field.name}`);
      }
    } else {
      type = PROTO_TYPE_NAMES[field.typeCode] ?? 'bytes';
    }

    fields[field.name] = {
      type,
      id: field.number,
      ...(field.label === LABEL_REPEATED ? { rule: 'repeated' } : {}),
    };
  }

  const json: MessageDescriptorJson = { fields };
  const nestedEntries: Record<string, unknown> = {};
  for (const nestedMessage of message.nestedMessages) {
    nestedEntries[nestedMessage.name] = buildMessageJson(nestedMessage, unresolvedFields);
  }
  for (const nestedEnum of message.nestedEnums) {
    nestedEntries[nestedEnum.name] = buildEnumJson(nestedEnum);
  }
  if (Object.keys(nestedEntries).length > 0) json.nested = sortKeys(nestedEntries);

  return json;
}

/** Alphabetical key order keeps the rendered JSON byte-stable across runs. */
function sortKeys(entries: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(entries).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)),
  );
}

function buildEnumJson(item: ProtoEnum): { values: Record<string, number> } {
  const values: Record<string, number> = {};
  for (const value of item.values) values[value.name] = value.number;
  return { values };
}

function normalizeServices(
  protoConfig: ProtoConfig,
): Record<string, Record<string, ProtoServiceMethod>> {
  const services: Record<string, Record<string, ProtoServiceMethod>> = {};
  for (const [serviceName, methods] of Object.entries(protoConfig.service ?? {})) {
    const normalized: Record<string, ProtoServiceMethod> = {};
    for (const [methodName, spec] of Object.entries(methods)) {
      if (typeof spec?.request === 'string' && typeof spec.response === 'string') {
        normalized[methodName] = { request: spec.request, response: spec.response };
      }
    }
    if (Object.keys(normalized).length > 0) services[serviceName] = normalized;
  }
  return services;
}

/** `.lq.Search.X` -> `Search.X`; unknown packages keep their full name. */
function relativeName(fullName: string): string {
  return fullName.replace(/^\./, '').replace(WIRE_PACKAGE_PREFIX, '');
}

const WIRE_PACKAGE_PREFIX = new RegExp(`^${WIRE_PACKAGE}\\.`);

/**
 * `proto_config.bytes` names its types without the package, while the Lua
 * descriptors carry fully-qualified names — accept both spellings.
 */
function resolveMessagePath(name: string, messagePaths: Set<string>): string | null {
  const candidate = relativeName(name);
  return messagePaths.has(candidate) ? candidate : null;
}

function countEnums(modules: ProtoModule[]): number {
  let count = 0;
  for (const module of modules) {
    count += module.topEnums.length;
    for (const message of module.messagesByVar.values()) count += message.nestedEnums.length;
  }
  return count;
}

function preview(values: string[]): string {
  const head = values.slice(0, 5).join(', ');
  return values.length > 5 ? `${head}, …` : head;
}
