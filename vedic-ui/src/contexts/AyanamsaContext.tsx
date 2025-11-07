"use client";

import React, { createContext, useContext, useEffect, useState } from "react";

export type AyanamsaType = "lahiri" | "raman" | "tropical";

interface AyanamsaContextType {
  ayanamsa: AyanamsaType;
  setAyanamsa: (value: AyanamsaType) => void;
}

const AyanamsaContext = createContext<AyanamsaContextType | undefined>(undefined);

export function AyanamsaProvider({ children }: { children: React.ReactNode }) {
  const [ayanamsa, setAyanamsaState] = useState<AyanamsaType>("lahiri");

  // Load from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem("ayanamsa");
    if (saved && (saved === "lahiri" || saved === "raman" || saved === "tropical")) {
      setAyanamsaState(saved as AyanamsaType);
    }
  }, []);

  // Listen for storage events (changes from other tabs/windows or same tab)
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === "ayanamsa" && e.newValue) {
        if (e.newValue === "lahiri" || e.newValue === "raman" || e.newValue === "tropical") {
          setAyanamsaState(e.newValue as AyanamsaType);
        }
      }
    };

    // Also listen for custom event (for same-tab changes)
    const handleCustomEvent = (e: CustomEvent<AyanamsaType>) => {
      setAyanamsaState(e.detail);
    };

    window.addEventListener("storage", handleStorageChange);
    window.addEventListener("ayanamsaChanged" as any, handleCustomEvent);

    return () => {
      window.removeEventListener("storage", handleStorageChange);
      window.removeEventListener("ayanamsaChanged" as any, handleCustomEvent);
    };
  }, []);

  const setAyanamsa = (value: AyanamsaType) => {
    setAyanamsaState(value);
    localStorage.setItem("ayanamsa", value);
    // Dispatch custom event for same-tab communication
    window.dispatchEvent(new CustomEvent("ayanamsaChanged", { detail: value }));
  };

  return (
    <AyanamsaContext.Provider value={{ ayanamsa, setAyanamsa }}>
      {children}
    </AyanamsaContext.Provider>
  );
}

export function useAyanamsa() {
  const context = useContext(AyanamsaContext);
  if (context === undefined) {
    throw new Error("useAyanamsa must be used within an AyanamsaProvider");
  }
  return context;
}
