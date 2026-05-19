/**
 * WalletPlug API Service
 * Handles all communication with the WalletPlug payment API
 * Docs: https://walletplug.com/api-docs
 */

const axios = require("axios");

class WalletPlugService {
  constructor() {
    this.baseUrl =
      process.env.WALLETPLUG_BASE_URL || "https://walletplug.com";
    this.environment = process.env.WALLETPLUG_ENVIRONMENT || "sandbox";
    this.merchantKey = process.env.WALLETPLUG_MERCHANT_KEY;
    this.apiKey = process.env.WALLETPLUG_API_KEY;

    if (!this.merchantKey || !this.apiKey) {
      throw new Error(
        "[WalletPlug] WALLETPLUG_MERCHANT_KEY and WALLETPLUG_API_KEY must be set."
      );
    }
  }

  /**
   * Common headers for all WalletPlug API requests
   */
  _getHeaders(accept = false) {
    const headers = {
      "Content-Type": "application/json",
      "X-Environment": this.environment,
      "X-Merchant-Key": this.merchantKey,
      "X-API-Key": this.apiKey,
    };
    if (accept) headers["Accept"] = "application/json";
    return headers;
  }

  /**
   * Initiate a new payment session
   * POST /api/v1/initiate-payment
   *
   * @param {object} params
   * @param {number}  params.amount         - Payment amount (min 1.00)
   * @param {string}  params.currency       - 3-letter currency code (e.g. "USD")
   * @param {string}  params.reference      - Unique order/transaction reference
   * @param {string}  params.description    - Order description
   * @param {string}  params.successUrl     - Redirect URL on success
   * @param {string}  params.failureUrl     - Redirect URL on failure
   * @param {string}  params.cancelUrl      - Redirect URL on cancel
   * @param {string}  params.webhookUrl     - IPN / webhook URL
   * @param {string}  [params.paymentMethods] - Comma-separated payment methods
   * @returns {Promise<{success: boolean, paymentUrl: string, info: object}>}
   */
  async initiatePayment({
    amount,
    currency,
    reference,
    description,
    successUrl,
    failureUrl,
    cancelUrl,
    webhookUrl,
    paymentMethods,
  }) {
    const payload = {
      payment_amount: parseFloat(amount),
      currency_code: currency.toUpperCase(),
      ref_trx: reference,
      description: description || `Order ${reference}`,
      success_redirect: successUrl,
      failure_url: failureUrl,
      cancel_redirect: cancelUrl,
      ipn_url: webhookUrl,
    };

    if (paymentMethods) {
      payload.allow_payment_methods = paymentMethods;
    }

    try {
      const response = await axios.post(
        `${this.baseUrl}/api/v1/initiate-payment`,
        payload,
        { headers: this._getHeaders(), timeout: 30000 }
      );

      const data = response.data;

      return {
        success: true,
        paymentUrl: data.payment_url,
        info: data.info,
      };
    } catch (error) {
      const message =
        error.response?.data?.message ||
        error.response?.data?.error ||
        error.message;
      console.error("[WalletPlug] initiatePayment error:", message);
      return { success: false, error: message };
    }
  }

  /**
   * Verify the status of an existing payment
   * GET /api/v1/verify-payment/{trxId}
   *
   * @param {string} trxId - WalletPlug transaction ID
   * @returns {Promise<{success: boolean, status: string, data: object}>}
   */
  async verifyPayment(trxId) {
    try {
      const response = await axios.get(
        `${this.baseUrl}/api/v1/verify-payment/${trxId}`,
        { headers: this._getHeaders(true), timeout: 30000 }
      );

      const data = response.data;

      return {
        success: data.status === "success" || data.status === "completed",
        status: data.status,
        data,
      };
    } catch (error) {
      const message =
        error.response?.data?.message || error.message;
      console.error("[WalletPlug] verifyPayment error:", message);
      return { success: false, status: "error", error: message };
    }
  }

  /**
   * Verify an incoming webhook signature (HMAC-SHA256)
   * @param {string} rawBody     - Raw JSON string from request body
   * @param {string} signature   - Value of X-Signature header
   * @returns {boolean}
   */
  verifyWebhookSignature(rawBody, signature) {
    const crypto = require("crypto");
    const secret = process.env.WALLETPLUG_WEBHOOK_SECRET;

    if (!secret) {
      console.warn("[WalletPlug] WALLETPLUG_WEBHOOK_SECRET not set — skipping signature check");
      return true;
    }

    if (!signature) return false;

    const expected =
      "sha256=" +
      crypto.createHmac("sha256", secret).update(rawBody).digest("hex");

    try {
      return crypto.timingSafeEqual(
        Buffer.from(expected),
        Buffer.from(signature)
      );
    } catch {
      return false;
    }
  }
}

module.exports = WalletPlugService;
