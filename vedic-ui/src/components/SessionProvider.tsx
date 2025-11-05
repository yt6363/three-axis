"use client";

import { SessionProvider as NextAuthSessionProvider } from "next-auth/react";
import { ReactNode, useEffect } from "react";

export default function SessionProvider({
  children,
}: {
  children: ReactNode;
}) {
  useEffect(() => {

    // Suppress NextAuth errors when credentials aren't configured
    const originalError = console.error;
    const originalWarn = console.warn;

    console.error = (...args) => {
      const errorMessage = String(args[0]);
      if (
        errorMessage.includes("ClientFetchError") ||
        errorMessage.includes("Unexpected end of JSON input") ||
        errorMessage.includes("autherror") ||
        errorMessage.includes("authjs.dev") ||
        errorMessage.includes("Failed to execute")
      ) {
        // Silently ignore NextAuth configuration errors
        return;
      }
      originalError.apply(console, args);
    };

    console.warn = (...args) => {
      const warnMessage = String(args[0]);
      if (
        warnMessage.includes("ClientFetchError") ||
        warnMessage.includes("autherror")
      ) {
        return;
      }
      originalWarn.apply(console, args);
    };

    // Also suppress unhandled promise rejections from NextAuth
    const handleRejection = (event: PromiseRejectionEvent) => {
      const errorMessage = String(event.reason);
      if (
        errorMessage.includes("ClientFetchError") ||
        errorMessage.includes("Unexpected end of JSON input") ||
        errorMessage.includes("autherror")
      ) {
        event.preventDefault();
      }
    };

    window.addEventListener("unhandledrejection", handleRejection);

    return () => {
      console.error = originalError;
      console.warn = originalWarn;
      window.removeEventListener("unhandledrejection", handleRejection);
    };
  }, []);

  return (
    <NextAuthSessionProvider
      refetchOnWindowFocus={false}
      refetchInterval={0}
      session={null}
    >
      {children}
    </NextAuthSessionProvider>
  );
}
