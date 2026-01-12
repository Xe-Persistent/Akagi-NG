import sys

from akagi_ng.core.paths import get_lib_dir

# 将 lib 目录添加到 sys.path 以便导入二进制文件
lib_dir = get_lib_dir()
if str(lib_dir) not in sys.path:
    # 前置到 sys.path 以确保优先从此处加载
    sys.path.insert(0, str(lib_dir))

try:
    import libriichi
    import libriichi3p
except ImportError as e:
    # 如果目录存在但导入失败，可能是缺少或不兼容的二进制文件
    raise ImportError(
        f"Failed to load libriichi/libriichi3p from {lib_dir}. Ensure the .pyd/.so files are present."
    ) from e

__all__ = ["libriichi", "libriichi3p"]
