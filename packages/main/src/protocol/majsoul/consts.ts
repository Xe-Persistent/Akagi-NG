/** 雀魂协议常量定义 */

/** 吃碰杠操作类型 */
export enum OperationChiPengGang {
  Chi = 0,
  Peng = 1,
  Gang = 2,
}

/** 暗杠/加杠操作类型 */
export enum OperationAnGangAddGang {
  AddGang = 2,
  AnGang = 3,
}

/** Liqi 协议常量 */
export const LiqiProtocolConstants = {
  // 消息块类型
  MSG_BLOCK_SIZE: 2, // 标准消息块大小
  BLOCK_TYPE_VARINT: 0, // varint 类型
  BLOCK_TYPE_STRING: 2, // string 类型

  // 空数据长度
  EMPTY_DATA_LEN: 0, // 空数据长度
} as const;
