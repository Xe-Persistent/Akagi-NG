/** Majsoul protocol constants. */

export enum OperationChiPengGang {
  Chi = 0,
  Peng = 1,
  Gang = 2,
}

export enum OperationAnGangAddGang {
  AddGang = 2,
  AnGang = 3,
}

export const LiqiProtocolConstants = {
  MSG_BLOCK_SIZE: 2,
  BLOCK_TYPE_VARINT: 0,
  BLOCK_TYPE_STRING: 2,
  EMPTY_DATA_LEN: 0,
} as const;
