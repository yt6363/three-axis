import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

// Lemon Squeezy webhook signature verification
function verifyWebhookSignature(body: string, signature: string, secret: string): boolean {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(body);
  const digest = hmac.digest('hex');
  return signature === digest;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.text();
    const signature = request.headers.get('x-signature');
    const webhookSecret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET;

    if (!webhookSecret) {
      console.error('Lemon Squeezy webhook secret not configured');
      return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 });
    }

    if (!signature) {
      return NextResponse.json({ error: 'No signature provided' }, { status: 400 });
    }

    // Verify webhook signature
    if (!verifyWebhookSignature(body, signature, webhookSecret)) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    const event = JSON.parse(body);
    const eventName = event.meta.event_name;

    console.log('Lemon Squeezy webhook event:', eventName);

    // Handle different event types
    switch (eventName) {
      case 'subscription_created':
        await handleSubscriptionCreated(event.data);
        break;
      case 'subscription_updated':
        await handleSubscriptionUpdated(event.data);
        break;
      case 'subscription_cancelled':
        await handleSubscriptionCancelled(event.data);
        break;
      case 'subscription_resumed':
        await handleSubscriptionResumed(event.data);
        break;
      case 'subscription_expired':
        await handleSubscriptionExpired(event.data);
        break;
      case 'subscription_paused':
        await handleSubscriptionPaused(event.data);
        break;
      case 'subscription_unpaused':
        await handleSubscriptionUnpaused(event.data);
        break;
      case 'subscription_payment_success':
        await handlePaymentSuccess(event.data);
        break;
      case 'subscription_payment_failed':
        await handlePaymentFailed(event.data);
        break;
      case 'subscription_payment_recovered':
        await handlePaymentRecovered(event.data);
        break;
      case 'order_created':
        await handleOrderCreated(event.data);
        break;
      default:
        console.log('Unhandled event type:', eventName);
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('Webhook error:', error);
    return NextResponse.json({ error: 'Webhook handler failed' }, { status: 500 });
  }
}

async function handleSubscriptionCreated(data: any) {
  console.log('Subscription created:', data);
  // TODO: Save to your database
  // const userId = data.attributes.custom_data?.user_id;
  // const subscriptionId = data.id;
  // const status = data.attributes.status;
  // const variantId = data.attributes.variant_id;
  // const customerId = data.attributes.customer_id;
  // const endsAt = data.attributes.ends_at;
  //
  // await db.subscription.create({
  //   clerkUserId: userId,
  //   lemonSqueezySubscriptionId: subscriptionId,
  //   lemonSqueezyCustomerId: customerId,
  //   status,
  //   variantId,
  //   currentPeriodEnd: new Date(endsAt),
  // });
}

async function handleSubscriptionUpdated(data: any) {
  console.log('Subscription updated:', data);
  // TODO: Update in your database
  // const subscriptionId = data.id;
  // const status = data.attributes.status;
  // const endsAt = data.attributes.ends_at;
  //
  // await db.subscription.update({
  //   where: { lemonSqueezySubscriptionId: subscriptionId },
  //   data: {
  //     status,
  //     currentPeriodEnd: new Date(endsAt),
  //   },
  // });
}

async function handleSubscriptionCancelled(data: any) {
  console.log('Subscription cancelled:', data);
  // TODO: Mark as cancelled in database
  // const subscriptionId = data.id;
  // await db.subscription.update({
  //   where: { lemonSqueezySubscriptionId: subscriptionId },
  //   data: { status: 'cancelled', cancelAtPeriodEnd: true },
  // });
}

async function handleSubscriptionResumed(data: any) {
  console.log('Subscription resumed:', data);
  // TODO: Update status in database
}

async function handleSubscriptionExpired(data: any) {
  console.log('Subscription expired:', data);
  // TODO: Mark as expired in database
}

async function handleSubscriptionPaused(data: any) {
  console.log('Subscription paused:', data);
  // TODO: Mark as paused in database
}

async function handleSubscriptionUnpaused(data: any) {
  console.log('Subscription unpaused:', data);
  // TODO: Mark as active in database
}

async function handlePaymentSuccess(data: any) {
  console.log('Payment succeeded:', data);
  // TODO: Record payment in database
  // const subscriptionId = data.id;
  // const amount = data.attributes.total;
  // const currency = data.attributes.currency;
  //
  // await db.payment.create({
  //   subscriptionId,
  //   amount: amount.toString(),
  //   currency,
  //   status: 'success',
  // });
}

async function handlePaymentFailed(data: any) {
  console.log('Payment failed:', data);
  // TODO: Handle payment failure
  // Send email notification, update subscription status, etc.
}

async function handlePaymentRecovered(data: any) {
  console.log('Payment recovered:', data);
  // TODO: Handle payment recovery
}

async function handleOrderCreated(data: any) {
  console.log('Order created:', data);
  // TODO: Handle one-time purchase if you support it
}
