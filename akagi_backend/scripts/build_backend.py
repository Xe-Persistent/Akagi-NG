import shutil
import subprocess
import sys
from pathlib import Path


def main():
    # Setup paths
    # This script is in akagi_backend/scripts/build_backend.py
    current_dir = Path(__file__).parent
    backend_root = current_dir.parent  # akagi_backend
    project_root = backend_root.parent  # Akagi-NG

    dist_dir = project_root / "dist" / "backend"
    build_dir = project_root / "build"
    spec_file = backend_root / "akagi-ng.spec"

    print("📦 Building Akagi-NG Backend...")
    print(f"   Spec file: {spec_file}")
    print(f"   Dist dir:  {dist_dir}")
    print(f"   Build dir: {build_dir}")

    # Clean previous backend build
    if dist_dir.exists():
        print(f"   Cleaning {dist_dir}...")
        shutil.rmtree(dist_dir)

    if build_dir.exists():
        print(f"   Cleaning {build_dir}...")
        shutil.rmtree(build_dir)

    # Run PyInstaller
    # We use subprocess to run it exactly as a command line tool would
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

        print(f"   Running: {' '.join(cmd)}")

        # We run from backend_root so that relative paths in spec file (like 'akagi_ng', 'assets') work correctly
        subprocess.run(
            cmd,
            cwd=backend_root,
            check=True,
        )
    except subprocess.CalledProcessError:
        print("❌ Backend build failed!")
        sys.exit(1)

    print("✅ Backend build successful!")
    print(f"   Executable: {dist_dir / 'akagi-ng'}")


if __name__ == "__main__":
    main()
