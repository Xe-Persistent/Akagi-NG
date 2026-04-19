from __future__ import annotations

from functools import cache
from pathlib import Path
from types import ModuleType

from google.protobuf import descriptor_pool, message_factory
from google.protobuf.descriptor import FileDescriptor

from akagi_ng.core.paths import get_assets_dir

type ProtoModuleName = str
type DescriptorFileName = str

DESCRIPTOR_DIR = get_assets_dir() / "majsoul_mod"


def _iter_message_names(descriptor: FileDescriptor) -> list[str]:
    return list(descriptor.message_types_by_name)


def _descriptor_path(file_name: DescriptorFileName) -> Path:
    return DESCRIPTOR_DIR / file_name


def _load_descriptor_bytes(file_name: DescriptorFileName) -> bytes:
    return _descriptor_path(file_name).read_bytes()


@cache
def _build_module(module_name: ProtoModuleName, descriptor_file: DescriptorFileName) -> ModuleType:
    pool = descriptor_pool.DescriptorPool()
    descriptor = pool.AddSerializedFile(_load_descriptor_bytes(descriptor_file))
    module = ModuleType(module_name)
    module.DESCRIPTOR = descriptor

    for message_name in _iter_message_names(descriptor):
        full_name = f"{descriptor.package}.{message_name}" if descriptor.package else message_name
        message_descriptor = pool.FindMessageTypeByName(full_name)
        setattr(module, message_name, message_factory.GetMessageClass(message_descriptor))

    return module


config_pb2 = _build_module("config_pb2", "config.desc")
sheets_pb2 = _build_module("sheets_pb2", "sheets.desc")

__all__ = ["config_pb2", "sheets_pb2"]
