# -*- mode: python ; coding: utf-8 -*-

from PyInstaller.utils.hooks import collect_submodules

block_cipher = None

hiddenimports = (
    collect_submodules("uvicorn")
    + collect_submodules("engineio")
    + collect_submodules("socketio")
    + collect_submodules("mjai")
    + collect_submodules("numpy")
)

a = Analysis(
    ['akagi_ng/__main__.py'],
    pathex=['akagi_ng'],
    binaries=[],
    datas=[
        ('assets', 'assets'),
        ('akagi_frontend/frontend', 'frontend'),
    ],
    hiddenimports=hiddenimports,
    excludes=["pytest", "setuptools", "pip"],
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, optimize=2)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='akagi-ng',
    console=False,
    icon='assets/torii.ico',
    version='assets/file_version_info.txt',
    upx=True,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    upx=True,
    name='akagi-ng',
)
