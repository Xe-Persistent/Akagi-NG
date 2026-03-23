import platform
import shutil
import subprocess
import sys
import tempfile
import tomllib
import urllib.request
from pathlib import Path

RELEASE_DATE = "20260320"
PYTHON_VERSION = "3.12.13"
URL_TEMPLATE = "https://github.com/astral-sh/python-build-standalone/releases/download/{date}/cpython-{python_version}+{date}-{arch}-{os_tag}-install_only.tar.gz"


def get_download_url() -> str:
    system = platform.system().lower()
    machine = platform.machine().lower()

    if system == "windows":
        os_tag = "pc-windows-msvc"
        arch = "x86_64" if machine in ["amd64", "x86_64"] else "aarch64"
    elif system == "darwin":
        os_tag = "apple-darwin"
        arch = "aarch64" if machine in ["arm64", "aarch64"] else "x86_64"
    else:
        os_tag = "unknown-linux-gnu"
        arch = "aarch64" if machine in ["arm64", "aarch64"] else "x86_64"

    return URL_TEMPLATE.format(date=RELEASE_DATE, python_version=PYTHON_VERSION, arch=arch, os_tag=os_tag)


def write_version_to_dest(backend_root: Path, packages_dest: Path) -> str:
    print("   Generating version file inside the bundle...")
    pyproject_path = backend_root / "pyproject.toml"
    version = tomllib.loads(pyproject_path.read_text(encoding="utf-8"))["project"]["version"]
    version_file_path = packages_dest / "akagi_ng" / "_version.py"
    version_file_content = f'''"""
This file is auto-generated during build.
Do NOT edit it manually!
"""
__version__ = "{version}"
'''
    if version_file_path.parent.exists():
        version_file_path.write_text(version_file_content, encoding="utf-8")
    return version


def cleanup_python_dist(python_dir: Path):
    print("   Sweeping Python standard library bloat...")
    for p in python_dir.glob("**/include"):
        shutil.rmtree(p, ignore_errors=True)
    for p in python_dir.rglob("*.a"):
        p.unlink(missing_ok=True)
    for p in python_dir.glob("**/share"):
        shutil.rmtree(p, ignore_errors=True)
    for useless_dir in ["idlelib", "tkinter", "turtledemo", "test"]:
        for p in python_dir.rglob(useless_dir):
            if p.is_dir():
                shutil.rmtree(p, ignore_errors=True)


def cleanup_app_packages(app_packages_dir: Path):
    print("   Cleaning up bloated files...")
    for p in app_packages_dir.rglob("*.c"):
        p.unlink(missing_ok=True)
    for p in app_packages_dir.rglob("*.cpp"):
        p.unlink(missing_ok=True)
    for p in app_packages_dir.rglob("*.cc"):
        p.unlink(missing_ok=True)
    for p in app_packages_dir.rglob("*.h"):
        p.unlink(missing_ok=True)
    for p in app_packages_dir.rglob("*.hpp"):
        p.unlink(missing_ok=True)
    for p in app_packages_dir.glob("**/include"):
        if p.is_dir():
            shutil.rmtree(p, ignore_errors=True)
    for p in app_packages_dir.glob("*.dist-info"):
        shutil.rmtree(p, ignore_errors=True)
    for p in app_packages_dir.glob("*.egg-info"):
        shutil.rmtree(p, ignore_errors=True)


def download_and_extract_python(dist_dir: Path) -> None:
    url = get_download_url()
    print(f"   Downloading portable Python from: {url}")

    temp_path = Path(tempfile.gettempdir()) / "portable_python.tar.gz"
    urllib.request.urlretrieve(url, temp_path)

    print("   Extracting portable Python...")
    shutil.unpack_archive(temp_path, extract_dir=dist_dir, format="gztar", filter="data")

    temp_path.unlink(missing_ok=True)


def install_dependencies_and_compile(backend_root: Path, packages_dest: Path) -> None:
    print(f"   Exporting project and dependencies to {packages_dest}...")
    cmd = [
        sys.executable,
        "-m",
        "pip",
        "install",
        ".",
        "--target",
        str(packages_dest),
    ]

    subprocess.run(cmd, cwd=backend_root, check=True)

    print("   Pre-compiling Python bytecode for startup performance...")
    subprocess.run([sys.executable, "-m", "compileall", "-q", str(packages_dest)], check=False)


def patch_and_rename_binaries(dist_dir: Path, backend_root: Path, version_str: str) -> None:
    print("   Renaming binaries for OS process identification...")
    python_dir = dist_dir / "python"

    win_exe = python_dir / "python.exe"
    win_w_exe = python_dir / "pythonw.exe"
    if win_exe.exists():
        akagi_exe = python_dir / "akagi-ng.exe"
        win_exe.rename(akagi_exe)

        rcedit_path = backend_root.parent / "node_modules" / "electron-winstaller" / "vendor" / "rcedit.exe"
        icon_path = backend_root.parent / "assets" / "torii.ico"
        if rcedit_path.exists() and icon_path.exists():
            print(f"   Patching icon and metadata for {akagi_exe.name}...")
            subprocess.run(
                [
                    str(rcedit_path),
                    str(akagi_exe),
                    "--set-icon",
                    str(icon_path),
                    "--set-version-string",
                    "CompanyName",
                    "Akagi-NG Contributors",
                    "--set-version-string",
                    "FileDescription",
                    "Akagi-NG Service",
                    "--set-version-string",
                    "InternalName",
                    "akagi-ng",
                    "--set-version-string",
                    "LegalCopyright",
                    "Copyright (C) 2026 Akagi-NG Contributors",
                    "--set-version-string",
                    "OriginalFilename",
                    "akagi-ng.exe",
                    "--set-version-string",
                    "ProductName",
                    "Akagi-NG",
                    "--set-file-version",
                    version_str,
                    "--set-product-version",
                    version_str,
                ],
                check=False,
            )

    if win_w_exe.exists():
        win_w_exe.unlink()

    unix_bin_dir = python_dir / "bin"
    unix_exe = unix_bin_dir / "python3"
    if unix_exe.exists():
        real_exe = unix_exe.resolve()
        if real_exe.exists():
            real_exe.rename(unix_bin_dir / "akagi-ng")
        for item in unix_bin_dir.iterdir():
            if item.is_symlink():
                item.unlink(missing_ok=True)


def main():
    current_dir = Path(__file__).parent
    backend_root = current_dir.parent
    project_root = backend_root.parent

    dist_dir = project_root / "dist" / "backend" / "akagi-ng"
    packages_dest = dist_dir / "app_packages"

    print("Building Akagi-NG Portable Backend...")

    if dist_dir.exists():
        shutil.rmtree(dist_dir)

    dist_dir.mkdir(parents=True, exist_ok=True)

    download_and_extract_python(dist_dir)
    cleanup_python_dist(dist_dir / "python")
    install_dependencies_and_compile(backend_root, packages_dest)
    cleanup_app_packages(packages_dest)

    version_str = write_version_to_dest(backend_root, packages_dest)
    patch_and_rename_binaries(dist_dir, backend_root, version_str)

    print(f"Backend build successful. Portable backend is at: {dist_dir}")


if __name__ == "__main__":
    main()
