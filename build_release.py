import os
import shutil
import subprocess
import sys
import tomllib
import zipfile
from pathlib import Path


def main():
    # Setup paths
    root_dir = Path(__file__).parent
    dist_dir = root_dir / "dist"
    build_dir = root_dir / "build"

    # Read version from pyproject.toml
    with open(root_dir / "pyproject.toml", "rb") as f:
        data = tomllib.load(f)
        version = data["project"]["version"]

    print(f"📦 Building Akagi-NG v{version}...")

    # Clean previous builds
    if dist_dir.exists():
        shutil.rmtree(dist_dir)
    if build_dir.exists():
        shutil.rmtree(build_dir)

    # Run PyInstaller
    # We use subprocess to run it exactly as a command line tool would
    try:
        subprocess.run([sys.executable, "-m", "PyInstaller", "akagi-ng.spec", "--clean", "--noconfirm"], check=True)
    except subprocess.CalledProcessError:
        print("❌ Build failed!")
        sys.exit(1)

    # Define zip name
    target_dir = dist_dir / "akagi-ng"
    zip_name = dist_dir / f"akagi-ng-v{version}.zip"

    if not target_dir.exists():
        print(f"❌ Target directory {target_dir} not found. Build might have failed.")
        sys.exit(1)

    print(f"🗜️  Zipping to {zip_name} (using LZMA for max compression)...")

    # Create zip archive with LZMA compression
    try:
        with zipfile.ZipFile(zip_name, "w", compression=zipfile.ZIP_LZMA) as zf:
            for root, _dirs, files in os.walk(target_dir):
                for file in files:
                    file_path = Path(root) / file
                    # Ensure the archive path starts with akagi-ng/
                    arcname = file_path.relative_to(dist_dir)
                    zf.write(file_path, arcname)
    except Exception as e:
        print(f"❌ Compression failed: {e}")
        sys.exit(1)

    print(f"✅ Release package created: {zip_name}")


if __name__ == "__main__":
    main()
