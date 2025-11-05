"use client";

import { UserButton as ClerkUserButton, useUser } from "@clerk/nextjs";
import { useRouter } from "next/navigation";

export function UserButton() {
  const { isSignedIn, isLoaded } = useUser();
  const router = useRouter();

  if (!isLoaded) {
    return (
      <div className="w-8 h-8 rounded-full bg-zinc-800 animate-pulse" />
    );
  }

  if (!isSignedIn) {
    return (
      <button
        onClick={() => router.push("/auth/signin")}
        className="px-4 py-2 bg-green-600 hover:bg-green-700 text-black font-mono text-sm uppercase tracking-wide transition-colors rounded-none"
      >
        Sign In
      </button>
    );
  }

  return (
    <div className="flex items-center gap-4">
      <button
        onClick={() => router.push("/account")}
        className="text-zinc-400 hover:text-green-400 font-mono text-sm uppercase tracking-wide transition-colors"
      >
        Account
      </button>
      <ClerkUserButton
        appearance={{
          elements: {
            avatarBox: "w-8 h-8",
          },
        }}
      />
    </div>
  );
}
