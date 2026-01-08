import asyncio
import contextlib
import queue
import threading

from mitmproxy import options
from mitmproxy.tools.dump import DumpMaster

from akagi_ng.mitm_client.addon import MajsoulAddon, mjai_messages
from akagi_ng.mitm_client.logger import logger
from akagi_ng.settings import local_settings


class MitmClient:
    def __init__(self):
        self.running = False
        self._thread: threading.Thread | None = None
        self._master: DumpMaster | None = None
        self._loop: asyncio.AbstractEventLoop | None = None

    async def _start_proxy(self, host: str, port: int, upstream: str = ""):
        """
        Async task to start the proxy.
        """
        opts = options.Options(listen_host=host, listen_port=port)
        if upstream:
            opts.mode = [f"upstream:{upstream}"]
        self._master = DumpMaster(
            opts,
            with_termlog=False,
            with_dumper=False,
        )
        self._master.addons.add(MajsoulAddon())
        logger.info(f"Starting MITM proxy server at {host}:{port}")

        try:
            await self._master.run()
        except Exception as e:
            logger.error(f"MITM proxy error: {e}")
        finally:
            logger.info("MITM proxy server stopped")

    def _run_in_thread(self, host: str, port: int, upstream: str = ""):
        """
        Thread target to run the asyncio loop.
        """
        self._loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self._loop)
        try:
            self._loop.run_until_complete(self._start_proxy(host, port, upstream))
        finally:
            with contextlib.suppress(Exception):
                pending = asyncio.all_tasks(self._loop)
                if pending:
                    for task in pending:
                        task.cancel()
                    self._loop.run_until_complete(asyncio.gather(*pending, return_exceptions=True))
            self._loop.close()

    def start(self):
        if self.running:
            return

        conf = local_settings.mitm
        if not conf.enabled:
            logger.info("MITM is disabled in settings.")
            return

        self.running = True
        self._thread = threading.Thread(
            target=self._run_in_thread, args=(conf.host, conf.port, conf.upstream), daemon=True
        )
        self._thread.start()

    def stop(self):
        if not self.running:
            return

        logger.info("Stopping MITM client...")
        if self._master:
            self._master.shutdown()

        if self._thread:
            self._thread.join(timeout=2.0)

        self.running = False
        logger.info("MITM client stopped.")

    def dump_messages(self) -> list[dict]:
        ans: list[dict] = []
        while not mjai_messages.empty():
            try:
                message = mjai_messages.get_nowait()
                # logger.debug(f"Message: {message}")
                ans.append(message)
            except queue.Empty:
                break
        return ans
