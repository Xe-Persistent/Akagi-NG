/**
 * Unity's shared type-tree string table.
 *
 * Type-tree blobs store most strings as byte offsets into the bundle's own
 * string buffer, but names Unity treats as "common" are instead stored as an
 * offset into this fixed table (`m_TypeStrOffset`/`m_NameStrOffset` with the
 * high bit set). The offsets are computed by concatenating the entries with a
 * NUL terminator each, exactly like Unity lays them out.
 *
 * Generated data — do not edit by hand. Refresh with the `tpk` database shipped
 * by UnityPy (`TPKTYPETREE.CommonString.GetStrings(TPKTYPETREE.StringBuffer)`),
 * which is the same table the reference extractor (Akagi's `extract_liqi.py`)
 * resolves through `UnityPy.helpers.TypeTreeNode.get_common_strings`.
 */
export const UNITY_COMMON_STRINGS: readonly string[] = [
  'AABB',
  'AnimationClip',
  'AnimationCurve',
  'AnimationState',
  'Array',
  'Base',
  'BitField',
  'bitset',
  'bool',
  'char',
  'ColorRGBA',
  'Component',
  'data',
  'deque',
  'double',
  'dynamic_array',
  'FastPropertyName',
  'first',
  'float',
  'Font',
  'GameObject',
  'Generic Mono',
  'GradientNEW',
  'GUID',
  'GUIStyle',
  'int',
  'list',
  'long long',
  'map',
  'Matrix4x4f',
  'MdFour',
  'MonoBehaviour',
  'MonoScript',
  'm_ByteSize',
  'm_Curve',
  'm_EditorClassIdentifier',
  'm_EditorHideFlags',
  'm_Enabled',
  'm_ExtensionPtr',
  'm_GameObject',
  'm_Index',
  'm_IsArray',
  'm_IsStatic',
  'm_MetaFlag',
  'm_Name',
  'm_ObjectHideFlags',
  'm_PrefabInternal',
  'm_PrefabParentObject',
  'm_Script',
  'm_StaticEditorFlags',
  'm_Type',
  'm_Version',
  'Object',
  'pair',
  'PPtr<Component>',
  'PPtr<GameObject>',
  'PPtr<Material>',
  'PPtr<MonoBehaviour>',
  'PPtr<MonoScript>',
  'PPtr<Object>',
  'PPtr<Prefab>',
  'PPtr<Sprite>',
  'PPtr<TextAsset>',
  'PPtr<Texture>',
  'PPtr<Texture2D>',
  'PPtr<Transform>',
  'Prefab',
  'Quaternionf',
  'Rectf',
  'RectInt',
  'RectOffset',
  'second',
  'set',
  'short',
  'size',
  'SInt16',
  'SInt32',
  'SInt64',
  'SInt8',
  'staticvector',
  'string',
  'TextAsset',
  'TextMesh',
  'Texture',
  'Texture2D',
  'Transform',
  'TypelessData',
  'UInt16',
  'UInt32',
  'UInt64',
  'UInt8',
  'unsigned int',
  'unsigned long long',
  'unsigned short',
  'vector',
  'Vector2f',
  'Vector3f',
  'Vector4f',
  'm_ScriptingClassIdentifier',
  'Gradient',
  'Type*',
  'int2_storage',
  'int3_storage',
  'BoundsInt',
  'm_CorrespondingSourceObject',
  'm_PrefabInstance',
  'm_PrefabAsset',
  'FileSize',
  'Hash128',
  'RenderingLayerMask',
  'fixed_array',
  'EntityId',
];

const OFFSET_TO_COMMON_STRING = new Map<number, string>();
{
  let offset = 0;
  for (const value of UNITY_COMMON_STRINGS) {
    OFFSET_TO_COMMON_STRING.set(offset, value);
    offset += Buffer.byteLength(value, 'utf8') + 1;
  }
}

/** Resolves a common-string byte offset; returns undefined for unknown offsets. */
export function lookupCommonString(offset: number): string | undefined {
  return OFFSET_TO_COMMON_STRING.get(offset);
}
