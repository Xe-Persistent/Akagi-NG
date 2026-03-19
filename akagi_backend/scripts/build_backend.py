import shutil
import subprocess
import sys
import tomllib
from pathlib import Path


def generate_version(backend_root: Path) -> Path:
    pyproject_path = backend_root / "pyproject.toml"
    version_file_path = backend_root / "akagi_ng" / "_version.py"

    if not pyproject_path.exists():
        print(f"Error: {pyproject_path} not found.")
        sys.exit(1)

    version = tomllib.loads(pyproject_path.read_text(encoding="utf-8"))["project"]["version"]

    version_file_content = f'''"""
This file is auto-generated during build.
Do NOT edit it manually!
"""
__version__ = "{version}"
'''
    version_file_path.write_text(version_file_content, encoding="utf-8")
    print(f"Generated version file with version {version}")
    return version_file_path


def main():
    current_dir = Path(__file__).parent
    backend_root = current_dir.parent
    project_root = backend_root.parent

    dist_dir = project_root / "dist" / "backend"
    build_dir = project_root / "build"
    spec_file = backend_root / "akagi-ng.spec"

    print("Building Akagi-NG Backend...")
    print(f"Spec file: {spec_file}")
    print(f"Dist dir:  {dist_dir}")
    print(f"Build dir: {build_dir}")

    if dist_dir.exists():
        print(f"Cleaning {dist_dir}...")
        shutil.rmtree(dist_dir)

    if build_dir.exists():
        print(f"Cleaning {build_dir}...")
        shutil.rmtree(build_dir)

    print("Generating version file...")
    version_file_path = generate_version(backend_root)

    try:
        cmd = [
            sys.executable,
            "-m",
            "PyInstaller",
            str(spec_file),
            "--clean",
            "--noconfirm",
            "--distpath",
            str(dist_dir),
            "--workpath",
            str(build_dir),
        ]

        print(f"Running: {' '.join(cmd)}")
        subprocess.run(cmd, cwd=backend_root, check=True)
    except subprocess.CalledProcessError:
        print("Backend build failed!")
        sys.exit(1)
    finally:
        if version_file_path.exists():
            version_file_path.unlink()

    print("Backend build successful!")
    print(f"Executable: {dist_dir / 'akagi-ng'}")


if __name__ == "__main__":
    main()
