/**
 * Shopify Payment Routes
 *
 * Shopify calls these endpoints as part of the offsite payment gateway flow.
 *
 *  POST /api/payment/initiate   — Called when customer clicks "Pay Now"
 *  GET  /api/payment/success    — Customer lands here after successful payment
 *  GET  /api/payment/failure    — Customer lands here after failed payment
 *  GET  /api/payment/cancel     — Customer lands here after cancelling
 *  POST /api/payment/webhook    — WalletPlug IPN / webhook notification
 *  GET  /api/payment/verify     — Poll payment status by trxId
 */

const express = require("express");
const router = express.Router();
const WalletPlugService = require("./walletplug.service");

const walletplug = new WalletPlugService();

// ─────────────────────────────────────────────
// POST /api/payment/initiate
// Shopify sends order details → we create a WalletPlug session and redirect
// ─────────────────────────────────────────────
router.post("/initiate", async (req, res) => {
  try {
    const {
      amount,
      currency,
      order_id,
      shop,
      description,
      customer_email,
      customer_name,
    } = req.body;

    if (!amount || !currency || !order_id || !shop) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: amount, currency, order_id, shop",
      });
    }

    // Unique, stable reference combining shop + order
    const reference = `${shop.replace(/\./g, "_")}_${order_id}_${Date.now()}`;

    const appUrl = process.env.SHOPIFY_APP_URL || `https://${req.hostname}`;

    const result = await walletplug.initiatePayment({
      amount,
      currency,
      reference,
      description: description || `Shopify Order #${order_id}`,
      successUrl: `${appUrl}/api/payment/success?order_id=${order_id}&shop=${shop}&ref=${reference}`,
      failureUrl: `${appUrl}/api/payment/failure?order_id=${order_id}&shop=${shop}&ref=${reference}`,
      cancelUrl: `${appUrl}/api/payment/cancel?order_id=${order_id}&shop=${shop}&ref=${reference}`,
      webhookUrl: `${appUrl}/api/payment/webhook`,
    });

    if (!result.success) {
      console.error("[WalletPlug] Payment initiation failed:", result.error);
      return res.status(502).json({
        success: false,
        error: result.error || "Payment initiation failed",
      });
    }

    console.log(
      `[WalletPlug] Payment initiated | ref=${reference} | url=${result.paymentUrl}`
    );

    return res.json({
      success: true,
      payment_url: result.paymentUrl,
      reference,
    });
  } catch (err) {
    console.error("[WalletPlug] /initiate error:", err.message);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// ─────────────────────────────────────────────
// GET /api/payment/success
// WalletPlug redirects customer here on success
// ─────────────────────────────────────────────
router.get("/success", async (req, res) => {
  const { order_id, shop, ref, trx_id } = req.query;

  console.log(`[WalletPlug] Success redirect | order=${order_id} | trx=${trx_id}`);

  // Optionally verify payment before confirming to Shopify
  if (trx_id) {
    const verify = await walletplug.verifyPayment(trx_id);
    if (!verify.success) {
      console.warn(`[WalletPlug] Success redirect but payment not verified | trx=${trx_id}`);
      return res.redirect(
        `https://${shop}/pages/payment-pending?order_id=${order_id}`
      );
    }
  }

  // Redirect back to Shopify order confirmation page
  return res.redirect(
    `https://${shop}/orders/${order_id}?walletplug_status=success`
  );
});

// ─────────────────────────────────────────────
// GET /api/payment/failure
// WalletPlug redirects customer here on failure
// ─────────────────────────────────────────────
router.get("/failure", (req, res) => {
  const { order_id, shop } = req.query;
  console.log(`[WalletPlug] Payment failed | order=${order_id}`);
  return res.redirect(
    `https://${shop}/checkouts?walletplug_status=failed&order_id=${order_id}`
  );
});

// ─────────────────────────────────────────────
// GET /api/payment/cancel
// Customer cancelled payment
// ─────────────────────────────────────────────
router.get("/cancel", (req, res) => {
  const { order_id, shop } = req.query;
  console.log(`[WalletPlug] Payment cancelled | order=${order_id}`);
  return res.redirect(
    `https://${shop}/checkouts?walletplug_status=cancelled&order_id=${order_id}`
  );
});

// ─────────────────────────────────────────────
// POST /api/payment/webhook
// WalletPlug IPN — updates Shopify order status
// ─────────────────────────────────────────────
router.post("/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  const rawBody = req.body.toString("utf8");
  const signature = req.headers["x-signature"];

  // 1. Verify webhook signature
  if (!walletplug.verifyWebhookSignature(rawBody, signature)) {
    console.warn("[WalletPlug] Webhook signature verification FAILED");
    return res.status(401).json({ error: "Invalid signature" });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return res.status(400).json({ error: "Invalid JSON payload" });
  }

  const { status, data, message } = payload;
  const isSandbox = data?.is_sandbox === true || data?.environment === "sandbox";

  console.log(
    `[WalletPlug] Webhook received | status=${status} | ref=${data?.ref_trx} | sandbox=${isSandbox}`
  );

  // 2. Handle payment status
  switch (status) {
    case "completed":
      await handlePaymentCompleted(data, isSandbox);
      break;
    case "failed":
      await handlePaymentFailed(data, isSandbox);
      break;
    case "cancelled":
      await handlePaymentCancelled(data, isSandbox);
      break;
    case "pending":
      console.log(`[WalletPlug] Payment pending | ref=${data?.ref_trx}`);
      break;
    default:
      console.warn(`[WalletPlug] Unknown webhook status: ${status}`);
  }

  return res.status(200).json({ received: true });
});

// ─────────────────────────────────────────────
// GET /api/payment/verify?trx_id=TXNXXXXXX
// Manually verify a transaction status
// ─────────────────────────────────────────────
router.get("/verify", async (req, res) => {
  const { trx_id } = req.query;
  if (!trx_id) {
    return res.status(400).json({ error: "trx_id query param required" });
  }

  const result = await walletplug.verifyPayment(trx_id);
  return res.json(result);
});

// ─────────────────────────────────────────────
// Internal Helpers — connect to Shopify Admin API
// ─────────────────────────────────────────────

async function handlePaymentCompleted(data, isSandbox) {
  // In production: use Shopify Admin API to mark the order as paid
  // Example: POST /admin/api/2024-01/orders/{id}/transactions.json
  console.log(
    `[WalletPlug] ✅ Payment COMPLETED | ref=${data?.ref_trx} | amount=${data?.amount} ${data?.currency_code} | sandbox=${isSandbox}`
  );
  // TODO: shopifyAdminAPI.markOrderPaid(data.ref_trx, data.amount);
}

async function handlePaymentFailed(data, isSandbox) {
  console.log(
    `[WalletPlug] ❌ Payment FAILED | ref=${data?.ref_trx} | sandbox=${isSandbox}`
  );
  // TODO: shopifyAdminAPI.cancelOrder(data.ref_trx);
}

async function handlePaymentCancelled(data, isSandbox) {
  console.log(
    `[WalletPlug] ⚠️  Payment CANCELLED | ref=${data?.ref_trx} | sandbox=${isSandbox}`
  );
  // TODO: shopifyAdminAPI.voidOrder(data.ref_trx);
}

module.exports = router;
