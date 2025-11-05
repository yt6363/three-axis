import { NextRequest, NextResponse } from 'next/server';
import { auth, currentUser } from '@clerk/nextjs/server';
import { createLemonSqueezyCheckout } from '@/lib/lemonsqueezy';

export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await currentUser();
    const variantId = process.env.LEMONSQUEEZY_VARIANT_ID;
    const storeId = process.env.LEMONSQUEEZY_STORE_ID;

    console.log('Environment check:', {
      hasVariantId: !!variantId,
      hasStoreId: !!storeId,
      hasApiKey: !!process.env.LEMONSQUEEZY_API_KEY,
    });

    if (!variantId) {
      return NextResponse.json({ error: 'Variant ID not configured' }, { status: 500 });
    }

    if (!storeId) {
      return NextResponse.json({ error: 'Store ID not configured' }, { status: 500 });
    }

    const checkout = await createLemonSqueezyCheckout({
      variantId,
      userEmail: user?.emailAddresses[0]?.emailAddress,
      userName: user?.fullName || user?.username || undefined,
      userId,
    });

    return NextResponse.json({ checkoutUrl: checkout?.attributes.url });
  } catch (error: any) {
    console.error('Checkout error:', error);
    console.error('Error details:', error.message, error.stack);
    return NextResponse.json(
      { error: error.message || 'Failed to create checkout' },
      { status: 500 }
    );
  }
}
