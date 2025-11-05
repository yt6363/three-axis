import Stripe from "stripe";

let stripeClient: Stripe | null = null;

function ensureStripeClient(): Stripe {
  if (stripeClient) {
    return stripeClient;
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error("STRIPE_SECRET_KEY is not configured.");
  }

  stripeClient = new Stripe(secretKey, {
    apiVersion: "2024-06-20",
  });

  return stripeClient;
}

const customerCache = new Map<string, string>();

export async function getStripeCustomerId(email: string, name?: string): Promise<string> {
  if (!email) {
    throw new Error("Customer email is required to look up a Stripe customer.");
  }

  if (customerCache.has(email)) {
    return customerCache.get(email)!;
  }

  const stripe = ensureStripeClient();

  const existingCustomers = await stripe.customers.list({
    email,
    limit: 1,
  });

  const existing = existingCustomers.data[0];
  if (existing) {
    customerCache.set(email, existing.id);
    return existing.id;
  }

  const created = await stripe.customers.create({
    email,
    name,
  });

  customerCache.set(email, created.id);
  return created.id;
}

export function getStripeClient(): Stripe {
  return ensureStripeClient();
}

