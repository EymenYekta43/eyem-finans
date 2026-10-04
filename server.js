const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const HOST = "0.0.0.0";

const STATE_FILE = path.join(__dirname, "market-state.json");

const DEFAULT_STOCKS = [
    { symbol: "EYEM", name: "EYEM Holding", price: 125.00 },
    { symbol: "EYMS", name: "EYEM Sanayi", price: 87.50 },
    { symbol: "EMRD", name: "EMRD Teknoloji", price: 64.20 },
    { symbol: "EMZA", name: "EMZA Enerji", price: 92.40 },
    { symbol: "EMRZ", name: "EMRZ Lojistik", price: 48.75 },
    { symbol: "FTKR", name: "FTKR Finans", price: 73.60 },
    { symbol: "MERZ", name: "MERZ Holding", price: 112.30 },
    { symbol: "EYFN", name: "EYFN Finans", price: 56.80 },
    { symbol: "KTPL", name: "KTPL Teknoloji", price: 39.40 },
    { symbol: "HBDA", name: "HBDA Sağlık", price: 81.25 },
    { symbol: "EYUL", name: "EYUL Ulaştırma", price: 67.90 },
    { symbol: "ANTR", name: "ANTR İnşaat", price: 45.60 }
];

function loadMarket() {
    try {
        if (fs.existsSync(STATE_FILE)) {
            const data = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));

            if (Array.isArray(data.stocks) && data.stocks.length > 0) {
                return data;
            }
        }
    } catch (error) {
        console.error("Market verisi okunamadı:", error);
    }

    const market = {
        stocks: DEFAULT_STOCKS,
        updatedAt: Date.now()
    };

    saveMarket(market);

    return market;
}

function saveMarket(market) {
    try {
        fs.writeFileSync(
            STATE_FILE,
            JSON.stringify(market, null, 2),
            "utf8"
        );
    } catch (error) {
        console.error("Market verisi kaydedilemedi:", error);
    }
}

let market = loadMarket();


// ==========================================
// 24/7 KENDİ BORSAMIZ
// ==========================================

function updatePrices() {
    market.stocks.forEach(stock => {

        // Küçük fiyat hareketleri
        const change = Math.random() < 0.5 ? -0.01 : 0.01;

        const nextPrice = Number(
            (Number(stock.price) + change).toFixed(2)
        );

        if (nextPrice > 0.01) {
            stock.price = nextPrice;
        }
    });

    market.updatedAt = Date.now();

    saveMarket(market);
}


// Her 4 saniyede merkezi fiyat güncellemesi
setInterval(updatePrices, 4000);


// ==========================================
// HTTP SERVER
// ==========================================

const server = http.createServer((req, res) => {

    // CORS
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    // OPTIONS
    if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
    }


    // ======================================
    // MERKEZİ MARKET API
    // ======================================

    if (req.url === "/api/market" && req.method === "GET") {

        res.writeHead(200, {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store"
        });

        res.end(JSON.stringify({
            success: true,
            stocks: market.stocks,
            updatedAt: market.updatedAt
        }));

        return;
    }


    // ======================================
    // SAĞLIK KONTROLÜ
    // ======================================

    if (req.url === "/api/health" && req.method === "GET") {

        res.writeHead(200, {
            "Content-Type": "application/json; charset=utf-8"
        });

        res.end(JSON.stringify({
            success: true,
            server: "EYEM Finans Merkezi",
            status: "online",
            time: new Date().toISOString()
        }));

        return;
    }


    // ======================================
    // ANA SAYFA
    // ======================================

    if (req.url === "/" && req.method === "GET") {

        const htmlFile = path.join(
            __dirname,
            "eyem_finans_merkezi.html"
        );

        if (!fs.existsSync(htmlFile)) {
            res.writeHead(404, {
                "Content-Type": "text/plain; charset=utf-8"
            });

            res.end("eyem_finans_merkezi.html bulunamadı.");
            return;
        }

        const html = fs.readFileSync(htmlFile, "utf8");

        res.writeHead(200, {
            "Content-Type": "text/html; charset=utf-8"
        });

        res.end(html);

        return;
    }


    // ======================================
    // BULUNAMADI
    // ======================================

    res.writeHead(404, {
        "Content-Type": "application/json; charset=utf-8"
    });

    res.end(JSON.stringify({
        success: false,
        error: "Sayfa bulunamadı"
    }));
});


// ==========================================
// SERVER BAŞLAT
// ==========================================

server.listen(PORT, HOST, () => {
    console.log("=================================");
    console.log("EYEM Finans Merkezi");
    console.log("Server aktif");
    console.log("Host:", HOST);
    console.log("Port:", PORT);
    console.log("24/7 alım-satım sistemi aktif");
    console.log("=================================");
});