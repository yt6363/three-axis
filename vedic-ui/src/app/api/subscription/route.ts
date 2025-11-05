import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';

export async function GET(request: NextRequest) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // TODO: Fetch subscription from your database
    // For now, return a placeholder response
    // Example with a real database:
    // const subscription = await db.subscription.findUnique({
    //   where: { clerkUserId: userId }
    // });

    // Placeholder response - replace with actual database query
    const subscription = {
      status: 'inactive', // or 'active', 'canceled', 'past_due'
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      subscriptionId: null,
    };

    return NextResponse.json(subscription);
  } catch (error) {
    console.error('Subscription fetch error:', error);
    return NextResponse.json({ error: 'Failed to fetch subscription' }, { status: 500 });
  }
}
