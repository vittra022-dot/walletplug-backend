/**
 * WalletPlug Pay for Shopify
 * Main Application Server
 */

require("dotenv").config();

const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");

const paymentRoutes = require("./payment.routes");

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Middleware ───────────────────────────────
app.use(cors());

// Note: /api/payment/webhook uses express.raw() inside the route itself
// for signature verification — so we use bodyParser only for other routes
app.use((req, res, next) => {
  if (req.path === "/api/payment/webhook") return next();
  bodyParser.json()(req, res, next);
});
app.use((req, res, next) => {
  if (req.path === "/api/payment/webhook") return next();
  bodyParser.urlencoded({ extended: true })(req, res, next);
});

// ─── Routes ───────────────────────────────────
app.use("/api/payment", paymentRoutes);

// Health check
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "WalletPlug Pay for Shopify",
    version: "1.0.0",
    environment: process.env.WALLETPLUG_ENVIRONMENT || "sandbox",
    timestamp: new Date().toISOString(),
  });
});

// Shopify App install endpoint (OAuth entry point)
app.get("/", (req, res) => {
  const { shop } = req.query;
  if (!shop) {
    return res.send(`
      <html>
        <body style="font-family:sans-serif;text-align:center;padding:60px;">
          <h1>WalletPlug Pay for Shopify</h1>
          <p>Install this app from your Shopify Partner Dashboard or provide <code>?shop=your-store.myshopify.com</code></p>
        </body>
      </html>
    `);
  }
  // TODO: Begin Shopify OAuth flow
  res.redirect(`https://${shop}/admin/oauth/authorize?client_id=${process.env.SHOPIFY_API_KEY}&scope=${process.env.SHOPIFY_SCOPES}&redirect_uri=${process.env.SHOPIFY_APP_URL}/auth/callback`);
});

// Shopify OAuth callback
app.get("/auth/callback", (req, res) => {
  // TODO: Exchange code for permanent access token and store it
  const { shop, code } = req.query;
  console.log(`[Shopify] OAuth callback | shop=${shop} | code=${code}`);
  res.json({ message: "OAuth callback received. Implement token exchange here.", shop, code });
});

// 404 fallback
app.use((req, res) => {
  res.status(404).json({ error: "Route not found" });
});

// Error handler
app.use((err, req, res, next) => {
  console.error("[Server] Unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
});

// ─── Start ────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 WalletPlug Pay for Shopify`);
  console.log(`   Server running on port ${PORT}`);
  console.log(`   Environment: ${process.env.WALLETPLUG_ENVIRONMENT || "sandbox"}`);
  console.log(`   Health: http://localhost:${PORT}/health\n`);
});

module.exports = app;
