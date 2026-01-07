import queue
import threading
import traceback

from playwright.sync_api import Page, WebSocket, sync_playwright

from akagi_ng.bridge import MajsoulBridge
from akagi_ng.core.context import get_playwright_data_dir
from akagi_ng.playwright_client.logger import logger
from akagi_ng.settings import local_settings

# Because in Majsouls, every flow's message has an id, we need to use one bridge for each flow
activated_flows: list[str] = []  # store all flow.id ([-1] is the recently opened)
majsoul_bridges: dict[WebSocket, MajsoulBridge] = {}  # store all flow.id -> MajsoulBridge
mjai_messages: queue.Queue[dict] = queue.Queue()  # store all messages


class PlaywrightController:
    """
    A controller for a Playwright browser instance that runs in a separate thread.
    It manages a single page, processes commands from a queue, monitors WebSockets,
    and handles clicking based on a normalized 16x9 grid.
    """

    def __init__(self, url: str, frontend_url: str):
        """
        Initializes the controller.

        Args:
            url (str): The fixed URL the browser page will navigate to.
            mjai_queue (queue.Queue): The queue to put parsed MJAI messages into.
        """
        self.url = url
        self.frontend_url = frontend_url
        self.command_queue: queue.Queue[dict] = queue.Queue()
        self.running = False
        self.majsoul_page: Page | None = None
        self.frontend_page: Page | None = None
        self.bridge_lock = threading.Lock()

    def _on_web_socket(self, ws: WebSocket):
        """
        Callback for new WebSocket connections. Equivalent to `websocket_start`.
        """
        global majsoul_bridges
        logger.info("[WebSocket] Connection opened")
        logger.info(f"[WebSocket] Connection opened: {ws.url}")

        # Create and store a bridge for this new WebSocket flow
        majsoul_bridges[ws] = MajsoulBridge()

        # Set up listeners for messages and closure on this specific WebSocket instance
        def handle_sent(payload: str | bytes):
            self._on_frame(ws, payload, from_client=True)

        def handle_received(payload: str | bytes):
            self._on_frame(ws, payload, from_client=False)

        def handle_close(_: WebSocket):
            self._on_socket_close(ws)

        ws.on("framesent", handle_sent)
        ws.on("framereceived", handle_received)
        ws.on("close", handle_close)

    def _on_frame(self, ws: WebSocket, payload: str | bytes, from_client: bool):
        """
        Callback for WebSocket messages. Equivalent to `websocket_message`.
        """
        global mjai_messages, majsoul_bridges
        direction = "<- Sent" if from_client else "-> Received"
        logger.trace(f"[WebSocket] {direction}: {payload}")

        bridge = majsoul_bridges.get(ws)
        if not bridge:
            logger.error(f"[WebSocket] Message received from untracked WebSocket: {ws.url}")
            return

        try:
            # Acquire lock to ensure thread-safe parsing
            with self.bridge_lock:
                msgs = bridge.parse(payload)

            if msgs is None:
                return

            # Add parsed messages to the shared queue
            for m in msgs:
                mjai_messages.put(m)
        except Exception:
            # The 'with' statement handles lock release even on error
            logger.error(f"[WebSocket] Error during message parsing: {traceback.format_exc()}")

    def _on_socket_close(self, ws: WebSocket):
        """
        Callback for WebSocket closures. Equivalent to `websocket_end`.
        """
        global majsoul_bridges
        if ws in majsoul_bridges:
            logger.info(f"[WebSocket] Connection closed: {ws.url}")
            # Clean up the bridge for the closed WebSocket
            del majsoul_bridges[ws]
        else:
            logger.warning(f"[WebSocket] Untracked WebSocket connection closed: {ws.url}")

    def _process_commands(self):
        """The main loop to process commands from the queue."""
        while True:
            try:
                # Wait for a command, with a timeout to allow checking the stop event
                command_data = self.command_queue.get_nowait()
                command = command_data.get("command")
                if command == "stop":
                    while not self.command_queue.empty():
                        self.command_queue.get_nowait()
                    break
                else:
                    logger.warning(f"Unknown command received: {command}")

            except queue.Empty:
                # Queue was empty, loop continues to check the stop event

                # If frontend page exists, use it as the main lifecycle indicator
                if self.frontend_page:
                    if self.frontend_page.is_closed():
                        logger.info("Frontend page closed. Stopping...")
                        break
                    try:
                        self.frontend_page.wait_for_timeout(20)
                    except Exception:
                        # If waiting fails, assume closed or error
                        break
                # Fallback to old behavior if frontend page never opened
                elif self.majsoul_page:
                    self.majsoul_page.wait_for_timeout(20)  # Use a small timeout (in ms)
                continue
            except Exception as e:
                logger.error(f"An error occurred in the command processing loop: {e}")

    def start(self):
        """
        Starts the Playwright instance, opens the browser, and begins
        the command processing loop. This method should be the target
        of a thread.
        """
        logger.info("Controller Starting...")
        self.running = True

        try:
            with sync_playwright() as p:
                # Prepare launch arguments
                launch_args = []
                window_size = local_settings.browser.window_size
                if window_size == "maximized":
                    launch_args.append("--start-maximized")
                elif window_size:
                    launch_args.append(f"--window-size={window_size}")

                user_data_dir = get_playwright_data_dir()
                context = p.chromium.launch_persistent_context(
                    user_data_dir=user_data_dir,
                    headless=local_settings.browser.headless,
                    locale=local_settings.locale,
                    no_viewport=True,
                    ignore_default_args=["--enable-automation"],
                    args=launch_args,
                )

                # Listen for new pages created in the context (e.g., new tabs)
                # and automatically attach WebSocket listeners
                context.on("page", lambda new_page: new_page.on("websocket", self._on_web_socket))

                # List all pages in the browser context
                page = context.pages[0]
                self.majsoul_page = page

                # Attach WebSocket listeners to all existing pages
                for existing_page in context.pages:
                    existing_page.on("websocket", self._on_web_socket)

                logger.info(f"Navigating to {self.url}...")
                page.goto(self.url)
                logger.info("Page loaded. Ready for commands.")
                try:
                    logger.info(f"Opening Akagi frontend: {self.frontend_url}")
                    frontend_page = context.new_page()
                    frontend_page.goto(self.frontend_url)
                    self.frontend_page = frontend_page
                except Exception as e:
                    logger.error(f"Failed to open Akagi frontend page: {e}")
                # Start processing commands
                self._process_commands()

        except Exception as e:
            logger.error(f"A critical error occurred during Playwright startup or operation: {e}")
        finally:
            logger.info("Shutting down...")
            self.running = False
            logger.info("Controller Stopped.")

    def stop(self):
        """
        Signals the controller to stop and cleans up resources.
        This method is thread-safe.
        """
        if self.running:
            logger.info("Sending stop signal...")
            self.command_queue.put({"command": "stop"})
        else:
            logger.info("Controller already stopped.")
