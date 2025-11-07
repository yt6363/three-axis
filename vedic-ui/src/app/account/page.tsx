"use client";

import { useUser, useClerk } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

interface SubscriptionData {
  status: string;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
}

type AyanamsaType = "lahiri" | "raman" | "tropical";

export default function AccountPage() {
  const { user, isLoaded } = useUser();
  const { signOut } = useClerk();
  const router = useRouter();
  const [subscription, setSubscription] = useState<SubscriptionData | null>(null);
  const [loading, setLoading] = useState(false);
  const [ayanamsa, setAyanamsa] = useState<AyanamsaType>("lahiri");

  useEffect(() => {
    if (isLoaded && !user) {
      router.push("/auth/signin");
    }
  }, [isLoaded, user, router]);

  useEffect(() => {
    if (user) {
      fetchSubscription();
    }
  }, [user]);

  // Load ayanamsa preference from localStorage
  useEffect(() => {
    const saved = localStorage.getItem("ayanamsa");
    if (saved && (saved === "lahiri" || saved === "raman" || saved === "tropical")) {
      setAyanamsa(saved as AyanamsaType);
    }
  }, []);

  // Save ayanamsa preference to localStorage when changed
  const handleAyanamsaChange = (newAyanamsa: AyanamsaType) => {
    setAyanamsa(newAyanamsa);
    localStorage.setItem("ayanamsa", newAyanamsa);
  };

  const fetchSubscription = async () => {
    try {
      const response = await fetch("/api/subscription");
      if (response.ok) {
        const data = await response.json();
        setSubscription(data);
      }
    } catch (error) {
      console.error("Error fetching subscription:", error);
    }
  };

  const handleSubscribe = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        throw new Error('Failed to create checkout');
      }

      const { checkoutUrl } = await response.json();

      if (checkoutUrl) {
        window.location.href = checkoutUrl;
      } else {
        alert('Failed to create checkout. Please try again.');
      }
    } catch (error) {
      console.error("Error opening checkout:", error);
      alert('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleManageSubscription = async () => {
    alert('Please check your email for a link to manage your subscription, or contact support.');
  };

  if (!isLoaded) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-zinc-400 font-mono uppercase tracking-[0.3em]" style={{ fontSize: '0.65rem' }}>LOADING...</div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div className="min-h-screen bg-black px-8 pt-8">
      {/* Header */}
      <div className="mb-8">
        <button
          onClick={() => router.back()}
          className="text-zinc-600 hover:text-green-400 font-mono uppercase tracking-[0.3em] transition-colors mb-6"
          style={{ fontSize: '0.65rem' }}
        >
          ← TERMINAL
        </button>
        <h1 className="font-mono font-medium text-5xl tracking-widest text-green-400 mb-2">
          ACCOUNT
        </h1>
        <p className="text-zinc-600 font-mono uppercase tracking-[0.3em]" style={{ fontSize: '0.65rem' }}>
          SETTINGS & SUBSCRIPTION
        </p>
      </div>

      {/* Profile Section */}
      <div className="mb-8 border border-zinc-800 bg-black p-6">
        <h2 className="font-mono uppercase tracking-[0.4em] text-zinc-500 mb-4" style={{ fontSize: '0.75rem' }}>
          PROFILE
        </h2>
        <div className="space-y-3">
          <div>
            <div className="text-zinc-400 font-mono uppercase tracking-[0.3em] mb-1" style={{ fontSize: '0.65rem' }}>NAME</div>
            <div className="text-zinc-200 font-mono tracking-[0.3em]" style={{ fontSize: '0.75rem' }}>
              {user.fullName || user.username || 'N/A'}
            </div>
          </div>
          <div>
            <div className="text-zinc-400 font-mono uppercase tracking-[0.3em] mb-1" style={{ fontSize: '0.65rem' }}>EMAIL</div>
            <div className="text-zinc-200 font-mono tracking-[0.3em]" style={{ fontSize: '0.75rem' }}>
              {user.emailAddresses[0]?.emailAddress}
            </div>
          </div>
        </div>
        <button
          onClick={() => signOut({ redirectUrl: "/auth/signin" })}
          className="mt-6 px-3 py-2 font-mono tracking-[0.3em] transition-all duration-200 border"
          style={{
            fontSize: '0.65rem',
            backgroundColor: '#16a34a',
            color: '#000',
            borderColor: '#16a34a',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = '#15803d';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = '#16a34a';
          }}
        >
          SIGN OUT
        </button>
      </div>

      {/* Ayanamsa Preferences Section */}
      <div className="mb-8 border border-zinc-800 bg-black p-6">
        <h2 className="font-mono uppercase tracking-[0.4em] text-zinc-500 mb-4" style={{ fontSize: '0.75rem' }}>
          AYANAMSA SYSTEM
        </h2>
        <p className="text-zinc-600 font-mono uppercase tracking-[0.3em] mb-6" style={{ fontSize: '0.65rem' }}>
          CHOOSE YOUR ZODIAC CALCULATION SYSTEM
        </p>

        <div className="space-y-3">
          {/* Lahiri Option */}
          <button
            onClick={() => handleAyanamsaChange("lahiri")}
            className={`w-full text-left p-4 border transition-all ${
              ayanamsa === "lahiri"
                ? "border-green-400 bg-green-400/5"
                : "border-zinc-800 hover:border-zinc-700"
            }`}
          >
            <div className="flex items-start justify-between mb-2">
              <div className="flex items-center gap-3">
                <div className={`w-3 h-3 rounded-full border-2 flex items-center justify-center ${
                  ayanamsa === "lahiri" ? "border-green-400" : "border-zinc-700"
                }`}>
                  {ayanamsa === "lahiri" && <div className="w-1.5 h-1.5 bg-green-400 rounded-full"></div>}
                </div>
                <div>
                  <div className="text-zinc-200 font-mono uppercase tracking-[0.3em] mb-1" style={{ fontSize: '0.75rem' }}>
                    LAHIRI (CHITRAPAKSHA)
                  </div>
                  <div className="text-zinc-500 font-mono uppercase tracking-[0.3em]" style={{ fontSize: '0.6rem' }}>
                    24° 13' • GOVERNMENT OF INDIA STANDARD
                  </div>
                </div>
              </div>
              {ayanamsa === "lahiri" && (
                <span className="text-green-400 font-mono uppercase tracking-[0.3em]" style={{ fontSize: '0.6rem' }}>
                  ACTIVE
                </span>
              )}
            </div>
            <div className="text-zinc-600 font-mono tracking-[0.3em] ml-6" style={{ fontSize: '0.6rem' }}>
              Most popular in Vedic astrology. Official standard used by the Indian government.
            </div>
          </button>

          {/* BV Raman Option */}
          <button
            onClick={() => handleAyanamsaChange("raman")}
            className={`w-full text-left p-4 border transition-all ${
              ayanamsa === "raman"
                ? "border-green-400 bg-green-400/5"
                : "border-zinc-800 hover:border-zinc-700"
            }`}
          >
            <div className="flex items-start justify-between mb-2">
              <div className="flex items-center gap-3">
                <div className={`w-3 h-3 rounded-full border-2 flex items-center justify-center ${
                  ayanamsa === "raman" ? "border-green-400" : "border-zinc-700"
                }`}>
                  {ayanamsa === "raman" && <div className="w-1.5 h-1.5 bg-green-400 rounded-full"></div>}
                </div>
                <div>
                  <div className="text-zinc-200 font-mono uppercase tracking-[0.3em] mb-1" style={{ fontSize: '0.75rem' }}>
                    BV RAMAN
                  </div>
                  <div className="text-zinc-500 font-mono uppercase tracking-[0.3em]" style={{ fontSize: '0.6rem' }}>
                    22° 46' • TRADITIONAL VEDIC SYSTEM
                  </div>
                </div>
              </div>
              {ayanamsa === "raman" && (
                <span className="text-green-400 font-mono uppercase tracking-[0.3em]" style={{ fontSize: '0.6rem' }}>
                  ACTIVE
                </span>
              )}
            </div>
            <div className="text-zinc-600 font-mono tracking-[0.3em] ml-6" style={{ fontSize: '0.6rem' }}>
              Classical Vedic system by renowned astrologer BV Raman. Widely respected.
            </div>
          </button>

          {/* Tropical Option */}
          <button
            onClick={() => handleAyanamsaChange("tropical")}
            className={`w-full text-left p-4 border transition-all ${
              ayanamsa === "tropical"
                ? "border-green-400 bg-green-400/5"
                : "border-zinc-800 hover:border-zinc-700"
            }`}
          >
            <div className="flex items-start justify-between mb-2">
              <div className="flex items-center gap-3">
                <div className={`w-3 h-3 rounded-full border-2 flex items-center justify-center ${
                  ayanamsa === "tropical" ? "border-green-400" : "border-zinc-700"
                }`}>
                  {ayanamsa === "tropical" && <div className="w-1.5 h-1.5 bg-green-400 rounded-full"></div>}
                </div>
                <div>
                  <div className="text-zinc-200 font-mono uppercase tracking-[0.3em] mb-1" style={{ fontSize: '0.75rem' }}>
                    TROPICAL (WESTERN)
                  </div>
                  <div className="text-zinc-500 font-mono uppercase tracking-[0.3em]" style={{ fontSize: '0.6rem' }}>
                    0° • SEASONAL ZODIAC
                  </div>
                </div>
              </div>
              {ayanamsa === "tropical" && (
                <span className="text-green-400 font-mono uppercase tracking-[0.3em]" style={{ fontSize: '0.6rem' }}>
                  ACTIVE
                </span>
              )}
            </div>
            <div className="text-zinc-600 font-mono tracking-[0.3em] ml-6" style={{ fontSize: '0.6rem' }}>
              Western astrology system based on seasons, not fixed stars.
            </div>
          </button>
        </div>
      </div>

      {/* Subscription Section */}
      <div className="mb-8 border border-zinc-800 bg-black p-6">
        <h2 className="font-mono uppercase tracking-[0.4em] text-zinc-500 mb-4" style={{ fontSize: '0.75rem' }}>
          SUBSCRIPTION
        </h2>

        {subscription?.status === "active" ? (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-2 h-2 bg-green-500 rounded-full"></div>
              <span className="text-green-400 font-mono uppercase tracking-[0.3em]" style={{ fontSize: '0.65rem' }}>ACTIVE</span>
            </div>
            <p className="text-zinc-600 font-mono uppercase tracking-[0.3em] mb-4" style={{ fontSize: '0.65rem' }}>
              {subscription.cancelAtPeriodEnd
                ? `ENDS ${new Date(subscription.currentPeriodEnd!).toLocaleDateString()}`
                : `RENEWS ${new Date(subscription.currentPeriodEnd!).toLocaleDateString()}`}
            </p>
            <button
              onClick={handleManageSubscription}
              disabled={loading}
              className="border border-transparent bg-black px-2 py-1 font-mono text-zinc-300 transition-all uppercase tracking-[0.3em] hover:border-zinc-600/60 hover:bg-zinc-900 disabled:opacity-50"
              style={{ fontSize: '0.65rem' }}
            >
              {loading ? "LOADING..." : "MANAGE"}
            </button>
          </div>
        ) : (
          <div>
            <p className="text-zinc-600 font-mono uppercase tracking-[0.3em] mb-6" style={{ fontSize: '0.65rem' }}>
              SUBSCRIBE FOR PREMIUM FEATURES
            </p>

            {/* Features */}
            <div className="mb-6 space-y-2">
              {[
                'ADVANCED VEDIC ASTROLOGY EVENTS',
                'REAL-TIME MARKET DATA',
                'CUSTOM INDICATORS & DRAWINGS',
                'PRIORITY SUPPORT'
              ].map((feature, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="w-1 h-1 bg-green-500"></div>
                  <span className="text-zinc-500 font-mono uppercase tracking-[0.3em]" style={{ fontSize: '0.65rem' }}>
                    {feature}
                  </span>
                </div>
              ))}
            </div>

            {/* Pricing */}
            <div className="mb-6 flex items-baseline gap-2">
              <span className="text-green-400 font-mono text-2xl tracking-wider">$29</span>
              <span className="text-zinc-600 font-mono uppercase tracking-[0.3em]" style={{ fontSize: '0.65rem' }}>/MONTH</span>
            </div>

            <button
              onClick={handleSubscribe}
              disabled={loading}
              className="px-3 py-2 font-mono tracking-[0.3em] transition-all duration-200 border disabled:opacity-50"
              style={{
                fontSize: '0.65rem',
                backgroundColor: '#16a34a',
                color: '#000',
                borderColor: '#16a34a',
              }}
              onMouseEnter={(e) => {
                if (!loading) {
                  e.currentTarget.style.backgroundColor = '#15803d';
                }
              }}
              onMouseLeave={(e) => {
                if (!loading) {
                  e.currentTarget.style.backgroundColor = '#16a34a';
                }
              }}
            >
              {loading ? "LOADING..." : "SUBSCRIBE"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
