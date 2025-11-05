import {
  lemonSqueezySetup,
  createCheckout,
  getSubscription,
  Checkout,
} from '@lemonsqueezy/lemonsqueezy.js';

// Initialize Lemon Squeezy
const apiKey = process.env.LEMONSQUEEZY_API_KEY;
if (apiKey) {
  lemonSqueezySetup({ apiKey });
}

export interface CheckoutOptions {
  variantId: string;
  userEmail?: string;
  userName?: string;
  userId?: string;
}

/**
 * Create a checkout session
 */
export async function createLemonSqueezyCheckout(options: CheckoutOptions) {
  const storeId = process.env.LEMONSQUEEZY_STORE_ID;

  if (!storeId) {
    throw new Error('LEMONSQUEEZY_STORE_ID is not set');
  }

  const checkoutData = {
    productOptions: {
      redirectUrl: `${process.env.NEXT_PUBLIC_APP_URL}/account?success=true`,
    },
    checkoutData: {
      email: options.userEmail,
      name: options.userName,
      custom: {
        user_id: options.userId,
      },
    },
  };

  const response = await createCheckout(storeId, options.variantId, checkoutData);

  if (response.error) {
    throw new Error(response.error.message);
  }

  return response.data;
}

/**
 * Get subscription details
 */
export async function getLemonSqueezySubscription(subscriptionId: string) {
  const response = await getSubscription(subscriptionId);

  if (response.error) {
    throw new Error(response.error.message);
  }

  return response.data;
}

/**
 * Verify webhook signature
 */
export function verifyLemonSqueezyWebhook(
  payload: string,
  signature: string,
  secret: string
): boolean {
  const crypto = require('crypto');
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(payload);
  const digest = hmac.digest('hex');
  return signature === digest;
}
