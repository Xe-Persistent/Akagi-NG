import sys

from akagi_ng.application import AkagiApp


def main() -> int:
    app = AkagiApp()
    app.initialize()
    app.start()
    return app.run()


if __name__ == "__main__":
    sys.exit(main())
