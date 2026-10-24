/**
 * Parser for the client's protobuf descriptors, which are shipped as Lua
 * `ProtoDeclare` scripts (`LuaByte/Lua/Protol/*_pb.lua.bytes`).
 *
 * Each script assigns `FieldDescriptor()`/`Descriptor()` objects and then sets
 * properties on them, e.g.
 *
 *   local b = require("Protol.liqi_struct_pb")
 *   local ReqLogin = x.Descriptor()
 *   local name = x.FieldDescriptor()
 *   name.name = "name"
 *   name.number = 1
 *   name.type = 9
 *   ReqLogin.fields = { name }
 *
 * The payloads are XOR-scrambled with a fixed key (same obfuscation the client
 * itself uses), so they are decoded before parsing.
 */
export const WIRE_PACKAGE = 'lq';
export const LABEL_REPEATED = 3;
export const FIELD_TYPE_MESSAGE = 11;
export const FIELD_TYPE_ENUM = 14;

/** FieldDescriptorProto type numbering, as emitted in the Lua. */
export const PROTO_TYPE_NAMES: Record<number, string> = {
  1: 'double',
  2: 'float',
  3: 'int64',
  4: 'uint64',
  5: 'int32',
  6: 'fixed64',
  7: 'fixed32',
  8: 'bool',
  9: 'string',
  10: 'group',
  11: 'message',
  12: 'bytes',
  13: 'uint32',
  14: 'enum',
  15: 'sfixed32',
  16: 'sfixed64',
  17: 'sint32',
  18: 'sint64',
};

const LUA_XOR_KEY = Buffer.from('wrelupqezdfrqdsd', 'ascii');

/** Property values come out of a regex capture, so they are `unknown` until checked. */
const isString = (value: unknown): value is string => typeof value === 'string';
const isNumber = (value: unknown): value is number => typeof value === 'number';

export interface ProtoField {
  name: string;
  number: number;
  label: number;
  typeCode: number;
  index: number;
  typeRef?: string;
  typeFqn?: string;
}

export interface ProtoEnumValue {
  name: string;
  number: number;
  index: number;
}

export interface ProtoEnum {
  varName: string;
  name: string;
  fullName: string;
  values: ProtoEnumValue[];
}

export interface ProtoMessage {
  varName: string;
  name: string;
  fullName: string;
  fields: ProtoField[];
  nestedMessages: ProtoMessage[];
  nestedEnums: ProtoEnum[];
  hasContainingType: boolean;
}

export interface ProtoModule {
  name: string;
  package: string;
  imports: Map<string, string>;
  messagesByVar: Map<string, ProtoMessage>;
  enumsByVar: Map<string, ProtoEnum>;
  topMessages: ProtoMessage[];
  topEnums: ProtoEnum[];
}

type DeclarationKind = 'message' | 'enum' | 'enum_value' | 'field';

const DECLARATIONS: [DeclarationKind, RegExp][] = [
  ['message', /(\w+)\s*=\s*\w+\.Descriptor\(\)/g],
  ['enum', /(\w+)\s*=\s*\w+\.EnumDescriptor\(\)/g],
  ['enum_value', /(\w+)\s*=\s*\w+\.EnumValueDescriptor\(\)/g],
  ['field', /(\w+)\s*=\s*\w+\.FieldDescriptor\(\)/g],
];

const IMPORT_RE = /local\s+(\w+)\s*=\s*require\(?["'](Protol\.[^"']+)["']\)?/g;
const STRING_PROP_RE = /(\w+)\.(\w+)\s*=\s*"((?:\\.|[^"\\])*)"/g;
const NUMBER_PROP_RE = /(\w+)\.(\w+)\s*=\s*(-?\d+)(?![\w.])/g;
const REFERENCE_PROP_RE = /(\w+)\.(message_type|enum_type|containing_type)\s*=\s*(\w+(?:\.\w+)?)/g;
const LIST_PROP_RE = /(\w+)\.(fields|nested_types|enum_types|values)\s*=\s*\{/g;

/** True when a payload already looks like Lua source; otherwise it is scrambled. */
export function looksLikeLua(data: Uint8Array): boolean {
  const sample = data.subarray(0, 4096);
  if (sample.length === 0) return false;
  let printable = 0;
  for (const byte of sample) {
    if (byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte <= 126)) printable++;
  }
  if (printable / sample.length < 0.85) return false;
  const head = Buffer.from(sample.subarray(0, 16)).toString('latin1').trimStart();
  return ['--', 'local', 'return', 'module', 'function'].some((prefix) => head.startsWith(prefix));
}

/** Decodes a Lua descriptor payload, undoing the client's XOR obfuscation. */
export function decodeLuaPayload(data: Uint8Array): Uint8Array {
  if (looksLikeLua(data)) return data;
  const result = new Uint8Array(data.length);
  for (const [index, byte] of data.entries()) {
    result[index] = byte ^ (LUA_XOR_KEY[index % LUA_XOR_KEY.length] ?? 0);
  }
  return result;
}

export function parseLuaModule(moduleName: string, source: string): ProtoModule {
  const kinds = new Map<string, DeclarationKind>();
  for (const [kind, pattern] of DECLARATIONS) {
    for (const match of source.matchAll(pattern)) {
      const name = match[1];
      if (name === undefined) continue;
      // A variable is declared once; the first declaration wins its kind.
      if (!kinds.has(name)) kinds.set(name, kind);
    }
  }

  const props = new Map<string, Map<string, unknown>>();
  for (const varName of kinds.keys()) props.set(varName, new Map());

  const collect = (
    pattern: RegExp,
    assign: (target: Map<string, unknown>, prop: string, value: string) => void,
  ): void => {
    for (const match of source.matchAll(pattern)) {
      const [, name, prop, value] = match;
      if (name === undefined || prop === undefined || value === undefined) continue;
      const target = props.get(name);
      if (target) assign(target, prop, value);
    }
  };

  collect(STRING_PROP_RE, (target, prop, value) => target.set(prop, unescapeLua(value)));
  collect(NUMBER_PROP_RE, (target, prop, value) => {
    if (!target.has(prop)) target.set(prop, Number.parseInt(value, 10));
  });
  collect(REFERENCE_PROP_RE, (target, prop, value) => target.set(prop, value));
  collect(LIST_PROP_RE, (target, prop, _value) => target.set(prop, []));

  for (const match of source.matchAll(LIST_PROP_RE)) {
    const [, name, prop] = match;
    if (name === undefined || prop === undefined) continue;
    const target = props.get(name);
    if (!target) continue;
    const openIndex = match.index + match[0].length - 1;
    const closeIndex = findMatchingBrace(source, openIndex);
    const inner = source.slice(openIndex + 1, closeIndex);
    target.set(
      prop,
      [...inner.matchAll(/\w+/g)].map((item) => item[0]),
    );
  }

  const imports = new Map<string, string>();
  for (const match of source.matchAll(IMPORT_RE)) {
    const [varName, path] = [match[1], match[2]];
    if (varName === undefined || path === undefined) continue;
    const serviceName = path.split('.')[1];
    if (serviceName !== undefined) imports.set(varName, serviceName);
  }

  const enumsByVar = parseEnums(kinds, props);
  const messagesByVar = parseMessages(kinds, props);

  for (const [varName, message] of messagesByVar) {
    const own = props.get(varName) as Map<string, unknown>;
    for (const fieldVar of asStringArray(own.get('fields'))) {
      if (kinds.get(fieldVar) !== 'field') continue;
      const fieldProps = props.get(fieldVar);
      const field = fieldProps ? parseField(fieldProps) : null;
      if (field) message.fields.push(field);
    }
    message.fields.sort((a, b) => a.number - b.number);

    for (const nestedVar of asStringArray(own.get('nested_types'))) {
      const nested = messagesByVar.get(nestedVar);
      if (nested) message.nestedMessages.push(nested);
    }
    for (const nestedVar of asStringArray(own.get('enum_types'))) {
      const nested = enumsByVar.get(nestedVar);
      if (nested) message.nestedEnums.push(nested);
    }
  }

  const nestedMessageVars = new Set<string>();
  const nestedEnumVars = new Set<string>();
  for (const message of messagesByVar.values()) {
    for (const nested of message.nestedMessages) nestedMessageVars.add(nested.varName);
    for (const nested of message.nestedEnums) nestedEnumVars.add(nested.varName);
  }

  const topMessages = [...messagesByVar.values()].filter(
    (message) => !nestedMessageVars.has(message.varName) && !message.hasContainingType,
  );
  const topEnums = [...enumsByVar.values()].filter((item) => !nestedEnumVars.has(item.varName));

  let packageName = '';
  for (const item of [...messagesByVar.values(), ...enumsByVar.values()]) {
    const parts = item.fullName.replace(/^\./, '').split('.');
    if (parts.length > 1) {
      packageName = parts.slice(0, -1).join('.');
      break;
    }
  }

  return {
    name: moduleName,
    package: packageName,
    imports,
    messagesByVar,
    enumsByVar,
    topMessages,
    topEnums,
  };
}

/** Resolves every field reference to a fully-qualified `.lq.X` style name. */
export function resolveTypes(modules: Map<string, ProtoModule>): void {
  for (const module of modules.values()) {
    for (const message of module.messagesByVar.values()) {
      for (const field of message.fields) {
        if (field.typeRef) field.typeFqn = resolveReference(field.typeRef, module, modules);
      }
    }
  }
}

function parseEnums(
  kinds: Map<string, DeclarationKind>,
  props: Map<string, Map<string, unknown>>,
): Map<string, ProtoEnum> {
  const enums = new Map<string, ProtoEnum>();
  for (const [varName, kind] of kinds) {
    if (kind !== 'enum') continue;
    const own = props.get(varName) as Map<string, unknown>;
    const name = own.get('name');
    const fullName = own.get('full_name');
    if (!isString(name) || !isString(fullName)) continue;

    const parsed: ProtoEnum = { varName, name, fullName, values: [] };
    for (const valueVar of asStringArray(own.get('values'))) {
      if (kinds.get(valueVar) !== 'enum_value') continue;
      const valueProps = props.get(valueVar);
      if (!valueProps) continue;
      const valueName = valueProps.get('name');
      const valueNumber = valueProps.get('number');
      if (!isString(valueName) || !isNumber(valueNumber)) continue;
      const index = valueProps.get('index');
      parsed.values.push({
        name: valueName,
        number: valueNumber,
        index: isNumber(index) ? index : 0,
      });
    }
    parsed.values.sort((a, b) => a.index - b.index);
    enums.set(varName, parsed);
  }
  return enums;
}

function parseMessages(
  kinds: Map<string, DeclarationKind>,
  props: Map<string, Map<string, unknown>>,
): Map<string, ProtoMessage> {
  const messages = new Map<string, ProtoMessage>();
  for (const [varName, kind] of kinds) {
    if (kind !== 'message') continue;
    const own = props.get(varName) as Map<string, unknown>;
    const name = own.get('name');
    const fullName = own.get('full_name');
    if (!isString(name) || !isString(fullName)) continue;
    messages.set(varName, {
      varName,
      name,
      fullName,
      fields: [],
      nestedMessages: [],
      nestedEnums: [],
      hasContainingType: isString(own.get('containing_type')),
    });
  }
  return messages;
}

/**
 * One `FieldDescriptor` declaration, or null when the script left out a property
 * the descriptor cannot be built without.
 */
function parseField(props: Map<string, unknown>): ProtoField | null {
  const name = props.get('name');
  const number = props.get('number');
  const label = props.get('label');
  const typeCode = props.get('type');
  if (!isString(name) || !isNumber(number) || !isNumber(label) || !isNumber(typeCode)) {
    return null;
  }

  const index = props.get('index');
  const messageType = props.get('message_type');
  const enumType = props.get('enum_type');

  return {
    name,
    number,
    label,
    typeCode,
    index: isNumber(index) ? index : 0,
    typeRef: isString(messageType) ? messageType : isString(enumType) ? enumType : undefined,
  };
}

function resolveReference(
  reference: string,
  module: ProtoModule,
  modules: Map<string, ProtoModule>,
): string | undefined {
  if (!reference.includes('.')) {
    const target = module.messagesByVar.get(reference) ?? module.enumsByVar.get(reference);
    return target?.fullName;
  }
  const [alias, varName] = splitOnce(reference, '.');
  const imported = modules.get(module.imports.get(alias) ?? '');
  if (!imported) return undefined;
  const target = imported.messagesByVar.get(varName) ?? imported.enumsByVar.get(varName);
  return target?.fullName;
}

function splitOnce(value: string, separator: string): [string, string] {
  const index = value.indexOf(separator);
  return [value.slice(0, index), value.slice(index + separator.length)];
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function findMatchingBrace(text: string, openIndex: number): number {
  let depth = 0;
  let quote: string | undefined;
  let escaped = false;

  for (let i = openIndex; i < text.length; i++) {
    const char = text[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = undefined;
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === '{') depth++;
    else if (char === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  throw new Error(`Unbalanced brace at offset ${openIndex}`);
}

function unescapeLua(value: string): string {
  const escapes: Record<string, string> = {
    n: '\n',
    r: '\r',
    t: '\t',
    '\\': '\\',
    '"': '"',
    "'": "'",
  };
  return value.replace(/\\(\d{1,3}|.)/g, (_match, group: string) => {
    if (/^\d+$/.test(group)) return String.fromCharCode(Number.parseInt(group, 10));
    return escapes[group] ?? group;
  });
}
