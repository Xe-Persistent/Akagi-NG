import os
import re
from PyInstaller.utils.hooks import collect_submodules

def get_version():
    with open('pyproject.toml', 'r', encoding='utf-8') as f:
        content = f.read()
    match = re.search(r'version\s*=\s*"([^"]+)"', content)
    if match:
        return match.group(1)
    return "0.0.0"

version_str = get_version()
version_tuple = tuple(map(int, version_str.split('.'))) + (0,) * (4 - len(version_str.split('.')))

VERSION_INFO_TEMPLATE = """# UTF-8
#
# For more details about fixed file info 'ffi' see:
# http://msdn.microsoft.com/en-us/library/ms646997.aspx
VSVersionInfo(
  ffi=FixedFileInfo(
    # filevers and prodvers should be always a tuple with four items: (1, 2, 3, 4)
    # Set not needed items to zero 0.
    filevers=(0, 0, 0, 0),
    prodvers=(0, 0, 0, 0),
    # Contains a bitmask that specifies the valid bits 'flags'r
    mask=0x3f,
    # Contains a bitmask that specifies the Boolean attributes of the file.
    flags=0x0,
    # The operating system for which this file was designed.
    # 0x4 - NT and there is no need to define different OS types.
    OS=0x40004,
    # The general type of file.
    # 0x1 - the file is an application.
    fileType=0x1,
    # The function of the file.
    # 0x0 - the function is not defined for this fileType
    subtype=0x0,
    # Creation date and time stamp.
    date=(0, 0)
    ),
  kids=[
    StringFileInfo(
      [
      StringTable(
        u'040904B0',
        [StringStruct(u'CompanyName', u'Akagi-NG Contributors'),
        StringStruct(u'FileDescription', u'Akagi-NG Client'),
        StringStruct(u'FileVersion', u'0.0.0'),
        StringStruct(u'InternalName', u'akagi-ng'),
        StringStruct(u'LegalCopyright', u'AGPL-3.0-only'),
        StringStruct(u'OriginalFilename', u'akagi-ng.exe'),
        StringStruct(u'ProductName', u'Akagi-NG'),
        StringStruct(u'ProductVersion', u'0.0.0')])
      ]),
    VarFileInfo([VarStruct(u'Translation', [1033, 1200])])
  ]
)
"""

# Use the template directly
version_info_content = VERSION_INFO_TEMPLATE

# Replace versions in the content
version_info_content = version_info_content.replace('0.0.0', version_str)
version_info_content = re.sub(
    r'filevers=\(\d+, \d+, \d+, \d+\)',
    f'filevers={version_tuple}',
    version_info_content
)
version_info_content = re.sub(
    r'prodvers=\(\d+, \d+, \d+, \d+\)',
    f'prodvers={version_tuple}',
    version_info_content
)

# Write to the assets file
version_file = 'assets/file_version_info.txt'
with open(version_file, 'w', encoding='utf-8') as f:
    f.write(version_info_content)

def collect_playwright_browsers():
    base_dir = os.path.join(os.environ['LOCALAPPDATA'], 'ms-playwright')
    if not os.path.exists(base_dir):
        print(f"WARNING: Playwright directory not found at {base_dir}")
        return []

    data_entries = []
    print(f"Scanning Playwright browsers in {base_dir}...")
    
    for item in os.listdir(base_dir):
        full_path = os.path.join(base_dir, item)
        if not os.path.isdir(full_path):
            continue

        # Filter logic
        if "chromium-headless-shell" in item:
            print(f"Skipping headless shell: {item}")
            continue
        if "ffmpeg" in item:
            print(f"Skipping ffmpeg: {item}")
            continue
        if "chromium" in item:
            print(f"Including browser: {item}")
            # Target path in dist matches source folder name under ms-playwright
            data_entries.append((full_path, os.path.join('ms-playwright', item)))
        else:
            print(f"Skipping unknown/unused component: {item}")

    return data_entries

block_cipher = None

hiddenimports = (
    collect_submodules("mjai")
    + collect_submodules("numpy")
)

a = Analysis(
    ['akagi_ng/__main__.py'],
    pathex=['akagi_ng'],
    binaries=[],
    datas=[
        ('assets', 'assets'),
        ('akagi_frontend/frontend', 'frontend'),
        ('pyproject.toml', '.'),
    ] + collect_playwright_browsers(),
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
    version=version_file,
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
