import http from "node:http";

interface Recommendation {
    action: string;
    confidence: number;
    consumed?: string[];
}

interface RecommendationData {
    type: string;
    data: {
        recommendations: Recommendation[];
        tehai: string[];
        last_kawa_tile: string;
    };
}

// This server is now only for mocking data for local frontend development.
console.log("Starting server in MOCK mode (SSE).");

const STREAM_INTERVAL_MS = 20000;
const KEEPALIVE_INTERVAL_MS = 10000;

const corsHeaders: Record<string, string> = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
};

const port = 8766;
const hostname = "0.0.0.0";

const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    if (req.method === "OPTIONS") {
        res.writeHead(204, corsHeaders);
        res.end();
        return;
    }

    if (req.method === "GET" && url.pathname === "/") {
        console.log("SSE client connected");

        res.writeHead(200, {
            ...corsHeaders,
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
        });

        // initial comment + first payload
        res.write(": connected\n\n");
        res.write(`data: ${JSON.stringify(generateMockData())}\n\n`);

        const keepAliveInterval = setInterval(() => {
            res.write(": keep-alive\n\n");
        }, KEEPALIVE_INTERVAL_MS);

        const dataInterval = setInterval(() => {
            const mockData = generateMockData();
            console.log("Generated and sending new mock data");
            res.write(`data: ${JSON.stringify(mockData)}\n\n`);
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

// ... existing code ...

function generateMockData(): RecommendationData {
    const tiles = [
        "1m", "2m", "3m", "4m", "5m", "5mr", "6m", "7m", "8m", "9m",
        "1p", "2p", "3p", "4p", "5p", "5pr", "6p", "7p", "8p", "9p",
        "1s", "2s", "3s", "4s", "5s", "5sr", "6s", "7s", "8s", "9s",
        "E", "S", "W", "N", "P", "F", "C"
    ];
    const nonRedDoraTiles = tiles.filter((t) => !t.endsWith("r"));
    const getRandomTile = (exclude: string[] = [], source: string[] = tiles) => {
        let tile;
        do {
            tile = source[Math.floor(Math.random() * source.length)];
        } while (exclude.includes(tile));
        return tile;
    };

    // Generate a mock hand
    const tehai = Array.from({length: 13}, () => getRandomTile());

    // Generate recommendations
    const recommendations: Recommendation[] = [];
    const numRecommendations = Math.floor(Math.random() * 2) + 3; // 3 to 4 recommendations

    const actionTypes = ["dahai", "chi_low", "chi_mid", "chi_high", "pon", "kan_select", "reach", "none"];

    // Ensure at least one chi or pon for testing
    let last_kawa_tile = getRandomTile();

    for (let i = 0; i < numRecommendations; i++) {
        let actionType = actionTypes[Math.floor(Math.random() * actionTypes.length)];

        // Ensure the first recommendation is something interesting for testing
        if (i === 0) {
            const testActions = ["chi_low", "pon", "kan_select"];
            actionType = testActions[Math.floor(Math.random() * testActions.length)];
        }

        const rec: Recommendation = {
            action: "",
            confidence: Math.random(),
        };

        switch (actionType) {
            case "dahai": {
                rec.action = tehai[Math.floor(Math.random() * tehai.length)];
                break;
            }
            case "chi_low":
            case "chi_mid":
            case "chi_high": {
                rec.action = actionType;
                const suits = ["m", "p", "s"];
                const suit = suits[Math.floor(Math.random() * suits.length)];
                const startNum = Math.floor(Math.random() * 7) + 1; // 1 to 7

                const t1 = `${startNum}${suit}`;
                const t2 = `${startNum + 1}${suit}`;
                const t3 = `${startNum + 2}${suit}`;

                if (actionType === "chi_low") {
                    last_kawa_tile = t3;
                    rec.consumed = [t1, t2];
                } else if (actionType === "chi_mid") {
                    last_kawa_tile = t2;
                    rec.consumed = [t1, t3];
                } else {
                    last_kawa_tile = t1;
                    rec.consumed = [t2, t3];
                }
                break;
            }
            case "pon": {
                rec.action = "pon";
                const ponTile = getRandomTile([], nonRedDoraTiles);
                last_kawa_tile = ponTile;
                rec.consumed = [ponTile, ponTile];
                break;
            }
            case "kan_select": {
                rec.action = "kan_select";
                const kanTile = getRandomTile([], nonRedDoraTiles);
                rec.consumed = [kanTile, kanTile, kanTile];
                break;
            }
            case "reach": {
                rec.action = "reach";
                break;
            }
            case "none": {
                rec.action = "none";
                break;
            }
            default: {
                rec.action = getRandomTile();
            }
        }
        recommendations.push(rec);
    }

    return {
        type: "recommandations",
        data: {
            recommendations: recommendations.sort((a, b) => b.confidence - a.confidence),
            tehai: tehai,
            last_kawa_tile: last_kawa_tile,
        },
    };
}