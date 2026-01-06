import sys

from akagi_ng.core.app import AkagiApp


def main() -> int:
    app = AkagiApp()
    app.start()
    return app.run()


if __name__ == "__main__":
    sys.exit(main())
