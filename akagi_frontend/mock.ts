import http from "node:http";

interface Recommendation {
    action: string;
    confidence: number;
    consumed?: string[];
    sim_candidates?: { tile: string; confidence: number }[];
    tile?: string;
    is_riichi_declaration?: boolean;
}

interface RecommendationData {
    type: string;
    data: {
        recommendations: Recommendation[];
        tehai: string[];
        is_riichi_declaration?: boolean;
    };
}

// Visual Verification Mock Server for Riichi Discard
console.log("Starting server in MOCK mode (SSE) for Riichi Visual Test.");

const STREAM_INTERVAL_MS = 5000;
const KEEPALIVE_INTERVAL_MS = 3000;

const corsHeaders: Record<string, string> = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
};

const port = 8765;
const hostname = "127.0.0.1";

const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    console.log(`[REQUEST] ${req.method} ${req.url}`);

    if (req.method === "OPTIONS") {
        res.writeHead(204, corsHeaders);
        res.end();
        return;
    }

    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/sse")) {
        console.log("SSE client connected");

        res.writeHead(200, {
            ...corsHeaders,
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
        });

        const sendData = () => {
            const mockData = generateMockData();
            console.log("Generated and sending new mock data");
            res.write(`data: ${JSON.stringify(mockData)}\n\n`);
        }

        // initial comment + first payload
        res.write(": connected\n\n");
        sendData();

        const keepAliveInterval = setInterval(() => {
            res.write(": keep-alive\n\n");
        }, KEEPALIVE_INTERVAL_MS);

        const dataInterval = setInterval(() => {
            sendData();
        }, STREAM_INTERVAL_MS);

        const cleanup = () => {
            console.log("SSE client disconnected");
            clearInterval(keepAliveInterval);
            clearInterval(dataInterval);
        };

        req.on("close", () => {
            cleanup();
        });

        return;
    }

    res.writeHead(404, corsHeaders);
    res.end("Not Found");
});

server.listen(port, hostname, () => {
    console.log(`Mock server listening on http://${hostname}:${port}`);
});

function generateMockData(): RecommendationData {
    // User requested hand: 12233445566778m
    // This is a Ryanpeikou / Chiitoitsu Tenpai shape.
    const tehai = [
        "1m", "2m", "2m", "3m", "3m", "4m", "4m",
        "5m", "5m", "6m", "6m", "7m", "7m", "8m"
    ];

    // Recommendations
    // Hand is Tenpai. Discarding 1m or 8m leads to Ryanpeikou wait.
    // Let's recommend Reach with 8m discard.
    const recommendations: Recommendation[] = [
        {
            action: "reach",
            confidence: 0.92,
            is_riichi_declaration: true,
            sim_candidates: [
                {tile: "8m", confidence: 0.95},
                {tile: "1m", confidence: 0.05}
            ]
        },
        {
            action: "8m", // Dama (Silence)
            confidence: 0.05,
        },
        {
            action: "1m", // Dama (Silence)
            confidence: 0.03,
        }
    ];

    return {
        type: "recommandations",
        data: {
            recommendations: recommendations,
            tehai: tehai,
            is_riichi_declaration: false, // Not yet declared, recommending it
        },
    };
}