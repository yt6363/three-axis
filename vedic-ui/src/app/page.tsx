"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DateTime } from "luxon";
import { useUser } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { JupiterTerminal } from "@/components/JupiterTerminal";
import { Pane } from "@/components/Pane";
import { UserButton } from "@/components/UserButton";
import { fetchSwissHorizon, fetchSwissMonthly, fetchSwissMonthlyBatch, type SwissMonthlyResponse } from "@/lib/api";

// Vedic Terminal Ingress App — TypeScript + React
// Accurate Lahiri sidereal using Swiss Ephemeris when available, with astronomia/internal fallbacks.
// Features: Lagna (Ascendant) sign ingresses, Moon & Sun sign ingresses,
//           Retrograde/direct stations (Mercury..Saturn), Combustion windows vs Sun,
//           Mutual major aspects (60°, 90°, 120°, 180°) between classical planets.
// UI is a sharp terminal look; CSV export for each table.
//
// Fix notes:
// - Closed every JSX tag and string (previous unterminated JSX/string errors fixed)
// - All onClick handlers fully parenthesized before className props
// - Finished cut-off Pane bodies and map() blocks
// - Added LOG pane with autoscroll
// - Kept existing tests; added a few more sanity tests

function cls(...xs: (string | false | null | undefined)[]) {
  return xs.filter(Boolean).join(" ");
}

function must(ok: boolean, msg: string) {
  if (!ok) throw new Error(msg);
}

const PLANET_DISPLAY_CODES: Record<string, string> = {
  Sun: "S",
  Moon: "Mo",
  Mercury: "Me",
  Venus: "V",
  Mars: "Ma",
  Jupiter: "J",
  Saturn: "Sa",
  Rahu: "NN",  // North Node
  Ketu: "SN",  // South Node
  Neptune: "N",
  Uranus: "U",
  Pluto: "P",
};

const PLANET_CANONICAL_NAMES: Record<string, string> = {
  sun: "Sun",
  moon: "Moon",
  mercury: "Mercury",
  venus: "Venus",
  mars: "Mars",
  jupiter: "Jupiter",
  saturn: "Saturn",
  uranus: "Uranus",
  neptune: "Neptune",
  pluto: "Pluto",
  rahu: "Rahu",
  ketu: "Ketu",
};

const EVENT_DISPLAY_CODES = {
  ingress: "I",
  combustion: "C",
  retro: "R",
  velocity: "V",
  lagna: "L",
  moon: "NAK",
} as const;

function displayPlanet(name: string | null | undefined, full = false): string {
  if (!name) return "";
  if (full) return name;
  return PLANET_DISPLAY_CODES[name] ?? name.slice(0, 2).toUpperCase();
}

function normalizePlanetName(
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const key = trimmed.toLowerCase();
  if (PLANET_CANONICAL_NAMES[key]) {
    return PLANET_CANONICAL_NAMES[key];
  }
  return trimmed.replace(/\s+/g, " ");
}

function hasSignTransition(from?: string | null, to?: string | null): boolean {
  if (!from || !to) return false;
  return from.trim().toLowerCase() !== to.trim().toLowerCase();
}

// -----------------------------------------------------------------------------
// Math & helpers (no external deps)
// -----------------------------------------------------------------------------
const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

function mod360(x: number) {
  const y = x % 360;
  return y < 0 ? y + 360 : y;
}
function angdiff(a: number, b: number) {
  let d = mod360(a - b);
  if (d > 180) d -= 360;
  return d;
}
function absSep(a: number, b: number) {
  return Math.abs(angdiff(a, b));
}
function signIndex(deg: number) {
  return Math.floor(mod360(deg) / 30) | 0;
}

const RASHI = [
  "Mesha",
  "Vrishabha",
  "Mithuna",
  "Karka",
  "Simha",
  "Kanya",
  "Tula",
  "Vrischika",
  "Dhanu",
  "Makara",
  "Kumbha",
  "Meena",
] as const;

const NAKSHATRA_NAMES = [
  "Ashwini",
  "Bharani",
  "Krittika",
  "Rohini",
  "Mrigashira",
  "Ardra",
  "Punarvasu",
  "Pushya",
  "Ashlesha",
  "Magha",
  "Purva Phalguni",
  "Uttara Phalguni",
  "Hasta",
  "Chitra",
  "Swati",
  "Vishakha",
  "Anuradha",
  "Jyeshtha",
  "Moola",
  "Purva Ashadha",
  "Uttara Ashadha",
  "Shravana",
  "Dhanishta",
  "Shatabhisha",
  "Purva Bhadrapada",
  "Uttara Bhadrapada",
  "Revati",
] as const;
const PADA_SEGMENT_DEG = 360 / 27 / 4;

type RashiName = (typeof RASHI)[number];

const COMMON_TIMEZONES = [
  { value: "UTC", label: "UTC" },
  {
    value: "America/New_York",
    label: "New York (ET)",
    lat: "40.7128",
    lon: "-74.0060",
  },
  {
    value: "Europe/London",
    label: "London (GMT/BST)",
    lat: "51.5074",
    lon: "-0.1278",
  },
  {
    value: "Asia/Kolkata",
    label: "India (IST)",
    lat: "22.5726",
    lon: "88.3639",
  },
  {
    value: "Asia/Singapore",
    label: "Singapore",
    lat: "1.3521",
    lon: "103.8198",
  },
  {
    value: "Australia/Sydney",
    label: "Sydney (AET)",
    lat: "-33.8688",
    lon: "151.2093",
  },
];

// JD (UTC) and JDE
function toJD(utc: Date): number {
  return utc.getTime() / 86400000 + 2440587.5;
}
function deltaTSeconds(date: Date): number {
  const y = date.getUTCFullYear() + (date.getUTCMonth() + 0.5) / 12;
  const t = y - 2000;
  if (y >= 2005 && y <= 2050) return 62.92 + 0.32217 * t + 0.005589 * t * t;
  if (y > 2050) return 32 + 0.5 * ((y - 1820) ** 2) / 41000;
  if (y >= 2000) return 64 + 0.33 * (y - 2000);
  if (y >= 1986)
    return (
      63.86 +
      0.3345 * (y - 2000) -
      0.060374 * (y - 2000) ** 2 +
      0.0017275 * (y - 2000) ** 3 +
      0.000651814 * (y - 2000) ** 4 +
      0.00002373599 * (y - 2000) ** 5
    );
  return 64;
}
function toJDE(utc: Date): number {
  return toJD(utc) + deltaTSeconds(utc) / 86400;
}

// GMST (deg)
function gmstDeg(jd: number): number {
  const T = (jd - 2451545.0) / 36525.0;
  const gmst =
    280.46061837 +
    360.98564736629 * (jd - 2451545.0) +
    0.000387933 * T * T -
    (T * T * T) / 38710000.0;
  return mod360(gmst);
}

// mean ε (rad) & apparent ε using astronomia if present
function meanObliquityRad(jd: number): number {
  const T = (jd - 2451545.0) / 36525.0;
  const seconds = 21.448 - 46.815 * T - 0.00059 * T * T + 0.001813 * T * T * T;
  const eps = 23 + 26 / 60 + seconds / 3600; // deg
  return eps * DEG2RAD;
}

let __astroLib: any | null = null; // optional astronomia module
function gastDeg(jd: number): number {
  try {
    const sid =
      (__astroLib as any)?.sidereal ||
      (__astroLib as any)?.siderealtime ||
      (__astroLib as any)?.siderealTime;
    if (sid && typeof sid.apparent === "function") {
      const hours = sid.apparent(jd); // hours
      return mod360((hours % 24) * 15);
    }
  } catch {}
  return gmstDeg(jd);
}
function trueObliquityRad(jd: number): number {
  try {
    const nut = (__astroLib as any)?.nutation;
    if (nut && typeof nut.nutation === "function") {
      const res = nut.nutation(jd);
      const dE = Array.isArray(res) ? res[1] : (res?.obl || res?.obliq || 0);
      return meanObliquityRad(jd) + (typeof dE === "number" ? dE : 0);
    }
  } catch {}
  return meanObliquityRad(jd);
}

function localSiderealThetaRad(jd: number, lonDeg: number): number {
  return (gastDeg(jd) + lonDeg) * DEG2RAD;
}

// Ascendant: compute tropical then subtract ayanamsa for sidereal
function ayanamsaLahiriDeg(jd: number): number {
  const tYears = (jd - 2451545.0) / 365.2425;
  const T = (jd - 2451545.0) / 36525.0;
  const base = 23 + 51 / 60 + 25 / 3600; // 23.856944...
  const arcsec = 50.291 * tYears + 1.11161 * T;
  return base + arcsec / 3600.0;
}
function ascendantTropicalDeg(utc: Date, latDeg: number, lonDeg: number): number {
  const jd = toJD(utc);
  const phi = latDeg * DEG2RAD;
  const eps = trueObliquityRad(jd);
  const theta = localSiderealThetaRad(jd, lonDeg);
  const y = Math.sin(theta) * Math.cos(eps) - Math.tan(phi) * Math.sin(eps);
  const x = Math.cos(theta);
  return mod360(Math.atan2(y, x) * RAD2DEG);
}
function ascendantSiderealDeg(
  utc: Date,
  latDeg: number,
  lonDeg: number
): number {
  return mod360(
    ascendantTropicalDeg(utc, latDeg, lonDeg) - ayanamsaLahiriDeg(toJD(utc))
  );
}

// Sun (tropical) quick series
function sunTropicalLonDeg(utc: Date): number {
  const jd = toJD(utc);
  const T = (jd - 2451545.0) / 36525.0;
  const L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T * T;
  const M = 357.52911 + 35999.05029 * T - 0.0001537 * T * T;
  const Mr = M * DEG2RAD;
  const C =
    (1.914602 - 0.004817 * T - 0.000014 * T * T) * Math.sin(Mr) +
    (0.019993 - 0.000101 * T) * Math.sin(2 * Mr) +
    0.000289 * Math.sin(3 * Mr);
  return mod360(L0 + C);
}
function sunSiderealLonDeg(utc: Date): number {
  return mod360(sunTropicalLonDeg(utc) - ayanamsaLahiriDeg(toJD(utc)));
}

// Moon (tropical) fallback (truncated)
function moonTropicalLonDegFallback(utc: Date): number {
  const jd = toJD(utc);
  const T = (jd - 2451545.0) / 36525.0;
  const L1 =
    218.3164477 +
    481267.88123421 * T -
    0.0015786 * T * T +
    (T * T * T) / 538841 -
    (T * T * T * T) / 65194000;
  const D =
    297.8501921 +
    445267.1114034 * T -
    0.0018819 * T * T +
    (T * T * T) / 545868 -
    (T * T * T * T) / 113065000;
  const M =
    357.5291092 +
    35999.0502909 * T -
    0.0001536 * T * T +
    (T * T * T) / 24490000;
  const Mp =
    134.9633964 +
    477198.8675055 * T +
    0.0087414 * T * T +
    (T * T * T) / 69699 -
    (T * T * T * T) / 14712000;
  const F =
    93.272095 +
    483202.0175233 * T -
    0.0036539 * T * T -
    (T * T * T) / 3526000 +
    (T * T * T * T) / 863310000;
  const Dr = D * DEG2RAD,
    Mr = M * DEG2RAD,
    Mpr = Mp * DEG2RAD,
    Fr = F * DEG2RAD;
  const terms = [
    [6288774, Math.sin(Mpr)],
    [1274027, Math.sin(2 * Dr - Mpr)],
    [658314, Math.sin(2 * Dr)],
    [213618, Math.sin(2 * Mpr)],
    [-185116, Math.sin(Mr)],
    [-114332, Math.sin(2 * Fr)],
  ];
  let sigmaL = 0;
  for (const [A, s] of terms) sigmaL += (A as number) * (s as number);
  return mod360(L1 + sigmaL / 1e6);
}
function moonTropicalLonDegEngine(utc: Date): number {
  if (__astroLib?.moonposition?.position) {
    const pos = __astroLib.moonposition.position(toJDE(utc)); // {lon,lat,dist} radians
    return mod360(pos.lon * RAD2DEG);
  }
  return moonTropicalLonDegFallback(utc);
}
function moonSiderealLonDeg(utc: Date): number {
  return mod360(moonTropicalLonDegEngine(utc) - ayanamsaLahiriDeg(toJD(utc)));
}

// -----------------------------------------------------------------------------
// Optional library loaders (dynamic import allowed anywhere)
// -----------------------------------------------------------------------------
async function loadAstronomia(): Promise<boolean> {
  if (__astroLib) return true;
  try {
    __astroLib = await import("astronomia");
    return true;
  } catch {}
  const cdns = [
    "https://cdn.jsdelivr.net/npm/astronomia/+esm",
    "https://esm.sh/astronomia",
    "https://cdn.skypack.dev/astronomia",
  ];
  for (const url of cdns) {
    try {
      // @ts-ignore
      __astroLib = await import(
        /* webpackIgnore: true */ /* @vite-ignore */ url
      );
      return true;
    } catch {}
  }
  for (const url of cdns) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const code = await res.text();
      const blob = new Blob([code], { type: "text/javascript" });
      const blobUrl = URL.createObjectURL(blob);
      // @ts-ignore
      __astroLib = await import(
        /* webpackIgnore: true */ /* @vite-ignore */ blobUrl
      );
      URL.revokeObjectURL(blobUrl);
      return true;
    } catch {}
  }
  return false;
}

// Swiss Ephemeris
let __swe: any | null = null;
let __swePromise: Promise<boolean> | null = null;
let __sweScriptPromise: Promise<boolean> | null = null;

const dynamicImport = new Function("src", "return import(src);") as (src: string) => Promise<any>;

async function initSwissModule(
  factory: (moduleArg?: Record<string, unknown>) => Promise<any>,
  base: string,
): Promise<boolean> {
  try {
    const module = await factory({
      locateFile: (path: string) => {
        if (/^(?:[a-z]+:)?\//i.test(path)) {
          return path;
        }
        let cleaned = path.startsWith("./") ? path.slice(2) : path;
        if (cleaned.startsWith("wsam/")) {
          cleaned = cleaned.slice(5);
        }
        return `${base}${cleaned}`;
      },
    });
    if (module) {
      __swe = module;
      try {
        __swe.set_sid_mode?.(__swe.SIDM_LAHIRI);
      } catch {}
      return true;
    }
  } catch (error) {
    console.warn("Swiss module init failed", error);
  }
  return false;
}

async function loadSwissFromScript(url: string): Promise<boolean> {
  if (typeof window === "undefined") return false;
  const tryInit = async (factory: any, baseHref: string) => {
    if (typeof factory !== "function") return false;
    return initSwissModule(factory, baseHref);
  };

  if (__sweScriptPromise) {
    return __sweScriptPromise;
  }

  __sweScriptPromise = new Promise<boolean>((resolve) => {
    const existingFactory = window.Swisseph;
    const attemptExisting = async (factory: any, src: string) => {
      const base = src.slice(0, src.lastIndexOf("/") + 1);
      const ok = await tryInit(factory, base);
      resolve(ok);
      __sweScriptPromise = null;
    };
    if (typeof existingFactory === "function") {
      attemptExisting(existingFactory, window.location.origin + url);
      return;
    }

    const script = document.createElement("script");
    script.async = true;
    script.src = url;
    script.onload = () => {
      const factory = window.Swisseph;
      const scriptSrc =
        script.src || new URL(url, window.location.href).href;
      if (!factory) {
        resolve(false);
        __sweScriptPromise = null;
        return;
      }
      attemptExisting(factory, scriptSrc);
    };
    script.onerror = () => {
      resolve(false);
      __sweScriptPromise = null;
    };
    document.head.appendChild(script);
  });
  return __sweScriptPromise;
}

async function loadSwiss(): Promise<boolean> {
  if (__swe) return true;
  if (__swePromise) return __swePromise;
  const urls = [
    "/vendor/swisseph.js",
    "https://cdn.jsdelivr.net/npm/swisseph-wasm@0.0.2/wsam/swisseph.js",
  ];
  const loader = async () => {
    for (const url of urls) {
      try {
        const mod = await dynamicImport(url);
        const factory = (mod && mod.default) || mod;
        if (typeof factory !== "function") continue;
        const base = url.slice(0, url.lastIndexOf("/") + 1);
        const ok = await initSwissModule(factory, base);
        if (ok) return true;
      } catch (error) {
        console.warn("Swiss load failed", url, error);
      }
    }
    if (typeof window !== "undefined") {
      for (const url of urls) {
        const ok = await loadSwissFromScript(url);
        if (ok) return true;
      }
    }
    return false;
  };
  __swePromise = loader().finally(() => {
    __swePromise = null;
  });
  return __swePromise;
}
function sweJuldayUTC(d: Date): number {
  const y = d.getUTCFullYear(),
    m = d.getUTCMonth() + 1,
    day = d.getUTCDate();
  const h =
    d.getUTCHours() +
    d.getUTCMinutes() / 60 +
    d.getUTCSeconds() / 3600 +
    d.getUTCMilliseconds() / 3.6e6;
  try {
    return __swe.julday(y, m, day, h, __swe.GREG_CAL);
  } catch {
    return toJD(d);
  }
}
type SweLonSpeed = { lon: number; speedDegPerDay: number | null };
function sweCalcLonSiderealWithSpeed(jd_ut: number, ipl: number): SweLonSpeed {
  try {
    const flags = __swe.FLG_MOSEPH | __swe.FLG_SIDEREAL | __swe.FLG_SPEED;
    const res = __swe.calc_ut(jd_ut, ipl, flags);
    let xx: any = res;
    if (Array.isArray(res) && Array.isArray(res[0])) xx = res[0];
    else if (res?.xx) xx = res.xx;
    const lon = mod360(parseFloat(xx[0]));
    const speedRaw = parseFloat(xx[3]);
    const speed = Number.isFinite(speedRaw) ? speedRaw : null;
    return { lon, speedDegPerDay: speed };
  } catch {
    return { lon: NaN, speedDegPerDay: null };
  }
}
function sweCalcLonSidereal(jd_ut: number, ipl: number): number {
  return sweCalcLonSiderealWithSpeed(jd_ut, ipl).lon;
}
function ascendantSiderealDegSwiss(
  utc: Date,
  latDeg: number,
  lonDeg: number
): number {
  const jd = sweJuldayUTC(utc);
  try {
    let ascmc: any;
    try {
      [, ascmc] = __swe.houses(jd, latDeg, lonDeg, "P");
    } catch {
      [, ascmc] = __swe.houses(jd, latDeg, lonDeg, "P".charCodeAt(0));
    }
    const ascTrop = (
      Array.isArray(ascmc) ? ascmc[0] : (ascmc?.asc ?? ascmc?.ASC ?? 0)
    ) % 360;
    const ay = __swe.get_ayanamsa_ut(jd);
    return mod360(ascTrop - ay);
  } catch {
    return ascendantSiderealDeg(utc, latDeg, lonDeg);
  }
}
function planetSiderealLonDegSwiss(utc: Date, ipl: number): number {
  const jd = sweJuldayUTC(utc);
  const lon = sweCalcLonSidereal(jd, ipl);
  return Number.isFinite(lon) ? lon : NaN;
}
function planetSiderealLonSpeedSwiss(
  utc: Date,
  ipl: number
): { lon: number; speedDegPerDay: number | null } {
  const jd = sweJuldayUTC(utc);
  const res = sweCalcLonSiderealWithSpeed(jd, ipl);
  return res;
}
function sunSiderealLonDegSwiss(utc: Date): number {
  const lon = planetSiderealLonDegSwiss(utc, __swe?.SUN ?? 0);
  return Number.isFinite(lon) ? lon : sunSiderealLonDeg(utc);
}
function moonSiderealLonDegSwiss(utc: Date): number {
  const lon = planetSiderealLonDegSwiss(utc, __swe?.MOON ?? 1);
  return Number.isFinite(lon) ? lon : moonSiderealLonDeg(utc);
}

// -----------------------------------------------------------------------------
// Scanning helpers (coarse scan + bisection to ~1s)
// -----------------------------------------------------------------------------
function refineBoundary(
  f: (d: Date) => number,
  left: Date,
  right: Date,
  desiredSec = 1
): Date {
  let a = left,
    b = right;
  const sL = signIndex(f(a)),
    sR = signIndex(f(b));
  if (sL === sR) return b;
  while ((b.getTime() - a.getTime()) / 1000 > desiredSec) {
    const m = new Date((a.getTime() + b.getTime()) / 2);
    const sM = signIndex(f(m));
    if (sM === sL) a = m;
    else b = m;
  }
  return b;
}
async function findSignChanges(
  f: (d: Date) => number,
  startUTC: Date,
  endUTC: Date,
  coarseMinutes: number,
  onProgress?: (n: number) => void
): Promise<{ timeUTC: Date; from: number; to: number }[]> {
  const out: { timeUTC: Date; from: number; to: number }[] = [];
  const coarseMs = coarseMinutes * 60 * 1000;

  // seed prev sign with first valid sample
  let t = new Date(startUTC);
  let prev: number | null = null;
  for (let guard = 0; guard < 10 && t <= endUTC; guard++) {
    const deg = f(t);
    if (Number.isFinite(deg)) {
      prev = signIndex(deg);
      break;
    }
    t = new Date(Math.min(t.getTime() + coarseMs, endUTC.getTime()));
  }
  if (prev === null) return out; // nothing computable

  let lastPushed: Date | null = null;
  while (t < endUTC) {
    const tNext = new Date(Math.min(t.getTime() + coarseMs, endUTC.getTime()));
    const degNext = f(tNext);
    if (!Number.isFinite(degNext)) {
      t = tNext;
      onProgress?.(1);
      await new Promise((r) => setTimeout(r, 0));
      continue;
    }
    const nxt = signIndex(degNext as number);

    if (nxt !== prev) {
      const exact = refineBoundary(f, t, tNext, 1);
      // verify immediate neighborhood is valid and truly crosses
      const beforeDeg = f(new Date(exact.getTime() - 1000));
      const afterDeg = f(new Date(exact.getTime() + 1000));
      if (Number.isFinite(beforeDeg) && Number.isFinite(afterDeg)) {
        const before = signIndex(beforeDeg as number);
        const after = signIndex(afterDeg as number);
        if (before === prev && after === nxt) {
          // de-duplicate jitter within 5 seconds
          if (!lastPushed || exact.getTime() - lastPushed.getTime() > 5000) {
            out.push({ timeUTC: exact, from: prev, to: nxt });
            lastPushed = exact;
          }
          prev = nxt;
        }
      }
    }

    t = tNext;
    onProgress?.(1);
    // yield occasionally for UI
    await new Promise((r) => setTimeout(r, 0));
  }
  return out;
}

// Stations (velocity sign flip), Combustion windows, Mutual Aspects
function velocityDegPerHr(f: (d: Date) => number, t: Date): number {
  const h = 0.5;
  const t1 = new Date(t.getTime() - h * 3600 * 1000);
  const t2 = new Date(t.getTime() + h * 3600 * 1000);
  return angdiff(f(t2), f(t1)) / (2 * h);
}
async function findStations(
  f: (d: Date) => number,
  startUTC: Date,
  endUTC: Date,
  coarseMinutes = 60,
  speedFn?: (d: Date) => number | null
): Promise<{ timeUTC: Date; kind: "retrograde" | "direct" }[]> {
  const out: { timeUTC: Date; kind: "retrograde" | "direct" }[] = [];
  const stepMs = coarseMinutes * 60 * 1000;
  const velocityAt = (date: Date) => {
    if (typeof speedFn === "function") {
      const perDay = speedFn(date);
      if (!Number.isFinite(perDay)) return NaN;
      return (perDay as number) / 24;
    }
    return velocityDegPerHr(f, date);
  };
  const safeSign = (vel: number) => {
    if (!Number.isFinite(vel)) return 0;
    const abs = Math.abs(vel);
    const EPS = 1e-6;
    if (abs < EPS) return 0;
    return vel > 0 ? 1 : -1;
  };

  let prevTime = new Date(startUTC);
  let prevSign = 0;
  for (let guard = 0; guard < 48 && prevTime < endUTC && prevSign === 0; guard++) {
    prevSign = safeSign(velocityAt(prevTime));
    if (prevSign === 0) {
      prevTime = new Date(Math.min(prevTime.getTime() + stepMs, endUTC.getTime()));
    }
  }
  if (prevSign === 0) return out;

  let t = new Date(prevTime);
  while (t < endUTC) {
    const tNext = new Date(Math.min(t.getTime() + stepMs, endUTC.getTime()));
    const currVel = velocityAt(tNext);
    const currSign = safeSign(currVel);
    if (currSign !== 0 && prevSign !== 0 && currSign !== prevSign) {
      let a = prevTime;
      let b = tNext;
      let signA = prevSign;
      for (let i = 0; i < 40 && b.getTime() - a.getTime() > 1000; i++) {
        const m = new Date((a.getTime() + b.getTime()) / 2);
        const mSign = safeSign(velocityAt(m));
        if (mSign === 0) {
          a = m;
          signA = 0;
          continue;
        }
        if (mSign === signA || signA === 0) {
          a = m;
          signA = mSign;
        } else {
          b = m;
        }
      }
      const kind = currSign < 0 ? "retrograde" : "direct";
      const MIN_EVENT_GAP_MS = 6 * 3600 * 1000;
      const lastEvent = out[out.length - 1];
      if (lastEvent) {
        const gap = b.getTime() - lastEvent.timeUTC.getTime();
        if (gap < MIN_EVENT_GAP_MS) {
          if (lastEvent.kind === kind) {
            prevSign = currSign;
            prevTime = tNext;
            t = tNext;
            continue;
          } else {
            out.pop();
            prevSign = currSign;
            prevTime = tNext;
            t = tNext;
            continue;
          }
        }
      }
      out.push({ timeUTC: b, kind });
      prevSign = currSign;
      prevTime = tNext;
    } else if (currSign !== 0) {
      prevSign = currSign;
      prevTime = tNext;
    }
    t = tNext;
  }
  return out;
}
async function findCombustion(
  sunF: (d: Date) => number,
  planetF: (d: Date) => number,
  startUTC: Date,
  endUTC: Date,
  orbDeg: number,
  coarseMinutes = 60
): Promise<{ startUTC: Date; endUTC: Date }[]> {
  const out: { startUTC: Date; endUTC: Date }[] = [];
  let t = new Date(startUTC);
  const stepMs = coarseMinutes * 60 * 1000;
  let inComb = false;
  let winStart: Date | null = null;
  while (t <= endUTC) {
    const sep = absSep(sunF(t), planetF(t));
    const nowComb = sep <= orbDeg;
    if (!inComb && nowComb) {
      inComb = true;
      winStart = new Date(t);
    }
    if (inComb && !nowComb) {
      inComb = false;
      out.push({ startUTC: winStart!, endUTC: new Date(t) });
      winStart = null;
    }
    t = new Date(Math.min(t.getTime() + stepMs, endUTC.getTime() + 1));
  }
  return out;
}
// -----------------------------------------------------------------------------
// CSV helpers

// -----------------------------------------------------------------------------
function rowsToCSV(head: string[], rows: (string | number)[][]): string {
  const h = head.join(",");
  const b = rows.map((r) => r.join(",")).join("\n");
  return `${h}\n${b}\n`;
}
function download(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// -----------------------------------------------------------------------------
// Self-tests (sync + async)
// -----------------------------------------------------------------------------
function runSelfTests(): string[] {
  const notes: string[] = [];
  const ok = (name: string, cond: boolean) =>
    notes.push(`${name} ${cond ? "ok" : "FAIL"}`);
  ok("mod360 positive", mod360(370) === 10);
  ok("mod360 negative", mod360(-10) === 350);
  ok("angdiff symmetry", angdiff(10, 20) === -angdiff(20, 10));
  ok("absSep symmetry", absSep(33, 111) === absSep(111, 33));
  ok(
    "signIndex edges",
    signIndex(0) === 0 &&
      signIndex(29.999) === 0 &&
      signIndex(30) === 1 &&
      signIndex(359.9) === 11
  );
  ok("signIndex boundaries", signIndex(30) === 1 && signIndex(60) === 2);
  const jdCheck = 2451545.0;
  ok("gmstDeg range", gmstDeg(jdCheck) >= 0 && gmstDeg(jdCheck) < 360);
  ok("epsilon rad finite", Number.isFinite(meanObliquityRad(jdCheck)));
  const ay0 = ayanamsaLahiriDeg(jdCheck),
    ay1 = ayanamsaLahiriDeg(jdCheck + 365);
  ok("ayanamsa varying", ay1 !== ay0);
  const mockStart = new Date(Date.UTC(2025, 0, 1, 0, 0, 0));
  const fMock = (d: Date) => 29 + ((d.getTime() - mockStart.getTime()) / (2 * 3600 * 1000)) * 2; // 29..31
  const exact = refineBoundary(
    fMock,
    mockStart,
    new Date(mockStart.getTime() + 2 * 3600 * 1000)
  );
  ok("refineBoundary finds crossing", Math.abs(fMock(exact) - 30) < 0.05);
  const asc = ascendantSiderealDeg(mockStart, 40.7128, -74.006);
  const sl = sunSiderealLonDeg(mockStart);
  const ml = moonSiderealLonDeg(mockStart);
  ok("asc range", asc >= 0 && asc < 360);
  ok("sun range", sl >= 0 && sl < 360);
  ok("moon range", ml >= 0 && ml < 360);
  ok("asc swiss wrapper fallback finite", Number.isFinite(ascendantSiderealDegSwiss(mockStart, 40.7128, -74.006)));
  // findSignChanges no-change case
  // Extra: rowsToCSV
  const csv = rowsToCSV(["a", "b"], [
    [1, 2],
    [3, 4],
  ]);
  ok("rowsToCSV includes header", csv.startsWith("a,b\n"));
  return notes;
}

async function runSelfTestsAsync(log: (s: string) => void) {
  const start = new Date(Date.UTC(2025, 0, 1, 0, 0, 0));
  const end = new Date(start.getTime() + 2 * 3600 * 1000);
  const fMock = (d: Date) => 29 + ((d.getTime() - start.getTime()) / (2 * 3600 * 1000)) * 2;
  const hits = await findSignChanges(fMock, start, end, 30);
  log(`async test findSignChanges one hit ${hits.length === 1 ? "ok" : "FAIL"}`);
  let calls = 0;
  const fWeird = (d: Date) => {
    calls += 1;
    if (calls === 1) return NaN;
    return fMock(d);
  };
  const hits2 = await findSignChanges(fWeird, start, end, 30);
  log(`async test seed handles NaN ${hits2.length === 1 ? "ok" : "FAIL"}`);
  // Stations: linear function has constant velocity sign -> no flips
  const fLinear = (d: Date) => (d.getTime() - start.getTime()) / (3600 * 1000);
  const st = await findStations(fLinear, start, end, 30);
  log(`async test stations no flips ${st.length === 0 ? "ok" : "FAIL"}`);
  const hitsConst = await findSignChanges(() => 15, start, end, 10);
  log(`async test findSignChanges no-change ${hitsConst.length === 0 ? "ok" : "FAIL"}`);
  const fParab = (d: Date) => {
    const dt = (d.getTime() - start.getTime()) / 3600000;
    return dt * dt;
  };
const stParab = await findStations(
  fParab,
  new Date(start.getTime() - 7200000),
  new Date(start.getTime() + 7200000),
  30
);
log(`async test stations parabola ${stParab.length >= 1 ? "ok" : "FAIL"}`);
}

type StationWindow = {
  planet: StationPlanetName;
  state: "retrograde";
  startISO: string;
  endISO: string | null;
};


const PLANET_ID_FALLBACKS: Record<string, number> = {
  Sun: 0,
  Moon: 1,
  Mercury: 2,
  Venus: 3,
  Mars: 4,
  Jupiter: 5,
  Saturn: 6,
  Uranus: 7,
  Neptune: 8,
  Pluto: 9,
  MeanNode: 10,
  TrueNode: 11,
  MERCURY: 2,
  VENUS: 3,
  MARS: 4,
  JUPITER: 5,
  SATURN: 6,
  URANUS: 7,
  NEPTUNE: 8,
  PLUTO: 9,
  TRUE_NODE: 11,
  MEAN_NODE: 10,
};

const PLANET_INGRESS_PLANETS = [
  "Mercury",
  "Venus",
  "Mars",
  "Jupiter",
  "Saturn",
  "Uranus",
  "Neptune",
  "Pluto",
  "Rahu",
  "Ketu",
] as const;

type PlanetIngressName = (typeof PLANET_INGRESS_PLANETS)[number];

function isRashiName(value: string): value is RashiName {
  return (RASHI as readonly string[]).includes(value);
}

function isPlanetIngressName(value: string): value is PlanetIngressName {
  return (PLANET_INGRESS_PLANETS as readonly string[]).includes(value);
}

const STATION_PLANETS = [
  "Mercury",
  "Venus",
  "Mars",
  "Jupiter",
  "Saturn",
  "Uranus",
  "Neptune",
  "Pluto",
  "Rahu",  // North Node
  "Ketu",  // South Node
] as const;

type StationPlanetName = (typeof STATION_PLANETS)[number];
type CombustionPlanetName = StationPlanetName | "Moon";

type MoonChangeRow = {
  timeISO: string;
  nakshatra: string;
  pada: number;
};

type VelocityExtremumRow = {
  timeISO: string;
  planet: string;
  kind: "max" | "min";
  speed: number;
};

type ChartIngressEvent = {
  body: string;
  from: RashiName;
  to: RashiName;
  timeISO: string;
};

type ChartCombustionEvent = {
  startISO: string;
  endISO: string | null;
  planet: CombustionPlanetName;
  orbDeg: number;
};

type ChartRetroEvent = StationWindow;

type ChartVelocityEvent = VelocityExtremumRow;

function applyMonthUpdate<T>(
  prev: Map<string, T[]>,
  key: string,
  rows: T[],
): Map<string, T[]> {
  const next = new Map(prev);
  if (rows.length) {
    next.set(key, rows);
  } else {
    next.delete(key);
  }
  return next;
}

const normalizeKind = (kind: string | null | undefined): "max" | "min" => {
  return kind === "min" ? "min" : "max";
};

function extractMonthlyChartEvents(
  swissMonthly: SwissMonthlyResponse,
): {
  ingress: ChartIngressEvent[];
  combustion: ChartCombustionEvent[];
  retro: ChartRetroEvent[];
  velocity: ChartVelocityEvent[];
} {
  const ingress: ChartIngressEvent[] = [];
  for (const row of swissMonthly.sunRows ?? []) {
    if (!row || !isRashiName(row.from) || !isRashiName(row.to)) continue;
    if (!hasSignTransition(row.from, row.to)) continue;
    ingress.push({
      body: "Sun",
      from: row.from,
      to: row.to,
      timeISO: row.timeISO,
    });
  }
  for (const row of swissMonthly.otherIngressRows ?? []) {
    if (!row) continue;
    if (!isPlanetIngressName(row.body)) continue;
    if (!isRashiName(row.from) || !isRashiName(row.to)) continue;
    if (!hasSignTransition(row.from, row.to)) continue;
    const canonicalBody = normalizePlanetName(row.body);
    if (!canonicalBody || !isPlanetIngressName(canonicalBody)) continue;
    ingress.push({
      body: canonicalBody,
      from: row.from,
      to: row.to,
      timeISO: row.timeISO,
    });
  }

  const combustion: ChartCombustionEvent[] = [];
  for (const row of swissMonthly.combRows ?? []) {
    if (!row) continue;
    if (!isCombustionPlanetName(row.planet)) continue;
    const canonical = normalizePlanetName(row.planet);
    const finalPlanet = isCombustionPlanetName(canonical ?? "") ? canonical : row.planet;
    combustion.push({
      startISO: row.startISO,
      endISO: row.endISO ?? null,
      planet: finalPlanet as CombustionPlanetName,
      orbDeg: row.orbDeg,
    });
  }

  const retro: ChartRetroEvent[] = [];
  for (const row of swissMonthly.stationRows ?? []) {
    if (!row) continue;
    if (!isStationPlanetName(row.planet)) continue;
    const canonical = normalizePlanetName(row.planet);
    const finalPlanet = isStationPlanetName(canonical ?? "") ? canonical : row.planet;
    retro.push({
      planet: finalPlanet as StationWindow["planet"],
      state: "retrograde",
      startISO: row.startISO,
      endISO: row.endISO ?? null,
    });
  }

  const velocity: ChartVelocityEvent[] = [];
  for (const row of swissMonthly.velocityRows ?? []) {
    if (!row || !row.timeISO) continue;
    const kind = normalizeKind(row.kind);
    const canonical = normalizePlanetName(row.planet);
    const finalPlanet = canonical ?? row.planet;
    velocity.push({
      timeISO: row.timeISO,
      planet: finalPlanet,
      kind,
      speed: row.speed,
    });
  }

  return { ingress, combustion, retro, velocity };
}

const MOON_MIDPOINT_SUFFIX = /\s+\(M\)$/;
function nakshatraFromLongitude(lon: number): { nakshatra: string; pada: number } {
  const deg = mod360(lon);
  const segment = Math.floor(deg / PADA_SEGMENT_DEG);
  const nakIndex = Math.floor(segment / 4) % NAKSHATRA_NAMES.length;
  const pada = (segment % 4) + 1;
  return { nakshatra: NAKSHATRA_NAMES[nakIndex], pada };
}
function normalizeMoonRows(
  rows: MoonChangeRow[],
  tz: string,
  format: string
): MoonChangeRow[] {
  const sorted = [...rows].sort((a, b) => a.timeISO.localeCompare(b.timeISO));
  let lastNak: string | null = null;
  let lastPada: number | null = null;
  const hasSwiss =
    typeof __swe === "object" &&
    __swe !== null &&
    typeof __swe.MOON === "number" &&
    Number.isFinite(__swe.MOON);
  return sorted.map((row) => {
    const name = row.nakshatra.replace(MOON_MIDPOINT_SUFFIX, "");
    let parsed = DateTime.fromFormat(row.timeISO, format, { zone: tz });
    if (!parsed.isValid) {
      parsed = DateTime.fromISO(row.timeISO, { zone: tz });
    }
    let computed: { nakshatra: string; pada: number } | null = null;
    if (hasSwiss && parsed.isValid) {
      const lon = moonSiderealLonDegSwiss(parsed.toUTC().toJSDate());
      if (Number.isFinite(lon)) {
        computed = nakshatraFromLongitude(lon);
      }
    }

    const finalName = computed?.nakshatra ?? name;
    let finalPada = computed?.pada ?? (Number.isFinite(row.pada) ? row.pada : NaN);

    if (!Number.isFinite(finalPada)) {
      lastNak = finalName;
      lastPada = null;
      return { ...row, nakshatra: finalName, pada: row.pada };
    }
    if (lastNak === finalName && lastPada !== null) {
      const expected = lastPada === 4 ? 1 : lastPada + 1;
      if (finalPada !== expected) {
        finalPada = expected;
      }
    }
    lastNak = finalName;
    lastPada = finalPada;
    return { ...row, nakshatra: finalName, pada: finalPada };
  });
}

function isStationPlanetName(value: string): value is StationPlanetName {
  return (STATION_PLANETS as readonly string[]).includes(value);
}

function isCombustionPlanetName(value: string): value is CombustionPlanetName {
  return value === "Moon" || isStationPlanetName(value);
}

type PlanetFn = (d: Date) => number;
type PlanetSpeedFn = (d: Date) => number | null;
type SwissPlanetFnMap = {
  Sun: PlanetFn;
  Moon: PlanetFn;
  Mercury: PlanetFn;
  Venus: PlanetFn;
  Mars: PlanetFn;
  Jupiter: PlanetFn;
  Saturn: PlanetFn;
  Uranus: PlanetFn;
  Neptune: PlanetFn;
  Pluto: PlanetFn;
  Rahu: PlanetFn;
  Ketu: PlanetFn;
};
type SwissPlanetSpeedFnMap = {
  Sun: PlanetSpeedFn;
  Moon: PlanetSpeedFn;
  Mercury: PlanetSpeedFn;
  Venus: PlanetSpeedFn;
  Mars: PlanetSpeedFn;
  Jupiter: PlanetSpeedFn;
  Saturn: PlanetSpeedFn;
  Uranus: PlanetSpeedFn;
  Neptune: PlanetSpeedFn;
  Pluto: PlanetSpeedFn;
  Rahu: PlanetSpeedFn;
  Ketu: PlanetSpeedFn;
};

declare global {
  interface Window {
    Swisseph?: (moduleArg?: Record<string, unknown>) => Promise<any>;
  }
}

function makeSwissPlanetPair(
  ipl: number,
  lonTransform?: (lon: number) => number,
  speedTransform?: (speed: number | null) => number | null
): { lon: PlanetFn; speed: PlanetSpeedFn } {
  let cacheTime = Number.NaN;
  let cacheLon = Number.NaN;
  let cacheSpeed: number | null = null;
  const ensureCache = (date: Date) => {
    const t = date.getTime();
    if (t === cacheTime) return;
    const res = planetSiderealLonSpeedSwiss(date, ipl);
    cacheTime = t;
    cacheLon = res.lon;
    cacheSpeed = res.speedDegPerDay;
  };
  return {
    lon: (d: Date) => {
      ensureCache(d);
      const base = cacheLon;
      if (!Number.isFinite(base)) return NaN;
      const transformed = lonTransform ? lonTransform(base) : base;
      return mod360(transformed);
    },
    speed: (d: Date) => {
      ensureCache(d);
      const base = cacheSpeed;
      const transformed = speedTransform ? speedTransform(base) : base;
      return typeof transformed === "number" && Number.isFinite(transformed)
        ? transformed
        : null;
    },
  };
}

function buildSwissPlanetFns():
  | {
      id: (key: string) => number | undefined;
      fn: SwissPlanetFnMap;
      speed: SwissPlanetSpeedFnMap;
    }
  | null {
  if (!__swe) return null;
  const SWE = __swe;
  const id = (key: string) => {
    const upper = key.toUpperCase();
    return (
      (SWE?.[key] as number | undefined) ??
      (SWE?.[upper] as number | undefined) ??
      (SWE?.[`SE_${upper}`] as number | undefined) ??
      PLANET_ID_FALLBACKS[key] ??
      PLANET_ID_FALLBACKS[upper]
    );
  };
  const trueNodeId = id("TRUE_NODE") ?? 11;
  const sunPair = makeSwissPlanetPair(SWE?.SUN ?? 0);
  const moonPair = makeSwissPlanetPair(SWE?.MOON ?? 1);
  const mercuryPair = makeSwissPlanetPair(id("MERCURY") ?? 2);
  const venusPair = makeSwissPlanetPair(id("VENUS") ?? 3);
  const marsPair = makeSwissPlanetPair(id("MARS") ?? 4);
  const jupiterPair = makeSwissPlanetPair(id("JUPITER") ?? 5);
  const saturnPair = makeSwissPlanetPair(id("SATURN") ?? 6);
  const uranusPair = makeSwissPlanetPair(id("URANUS") ?? 7);
  const neptunePair = makeSwissPlanetPair(id("NEPTUNE") ?? 8);
  const plutoPair = makeSwissPlanetPair(id("PLUTO") ?? 9);
  const rahuPair = makeSwissPlanetPair(trueNodeId);
  const ketuPair = makeSwissPlanetPair(
    trueNodeId,
    (lon) => lon + 180,
    (speed) => (typeof speed === "number" ? -speed : null)
  );
  const fn: SwissPlanetFnMap = {
    Sun: sunPair.lon,
    Moon: moonPair.lon,
    Mercury: mercuryPair.lon,
    Venus: venusPair.lon,
    Mars: marsPair.lon,
    Jupiter: jupiterPair.lon,
    Saturn: saturnPair.lon,
    Uranus: uranusPair.lon,
    Neptune: neptunePair.lon,
    Pluto: plutoPair.lon,
    Rahu: rahuPair.lon,
    Ketu: ketuPair.lon,
  };
  const speed: SwissPlanetSpeedFnMap = {
    Sun: sunPair.speed,
    Moon: moonPair.speed,
    Mercury: mercuryPair.speed,
    Venus: venusPair.speed,
    Mars: marsPair.speed,
    Jupiter: jupiterPair.speed,
    Saturn: saturnPair.speed,
    Uranus: uranusPair.speed,
    Neptune: neptunePair.speed,
    Pluto: plutoPair.speed,
    Rahu: rahuPair.speed,
    Ketu: ketuPair.speed,
  };
  return { id, fn, speed };
}

void loadAstronomia;
void loadSwiss;
void sunSiderealLonDegSwiss;
void moonSiderealLonDegSwiss;
void findCombustion;
void buildSwissPlanetFns;

// -----------------------------------------------------------------------------
// Main component
// -----------------------------------------------------------------------------
export default function VedicTerminalIngressApp() {
  const { user, isLoaded } = useUser();
  const router = useRouter();

  // Always start with false on server to avoid hydration mismatch
  const [appMounted, setAppMounted] = useState(false);

  useEffect(() => {
    // Check if animation has already been shown this session
    const hasShownAnimation = sessionStorage.getItem('startupAnimationShown') === 'true';

    if (hasShownAnimation) {
      // Skip animation if already shown
      setAppMounted(true);
    } else {
      // Show THREE AXIS animation for 2.5 seconds
      const timer = setTimeout(() => {
        setAppMounted(true);
        sessionStorage.setItem('startupAnimationShown', 'true');
      }, 2500);
      return () => clearTimeout(timer);
    }
  }, []);

  const tzGuess = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    []
  );

  // Initialize state from sessionStorage to persist across navigation
  const [activeTab, setActiveTab] = useState<"market" | "ingress" | "location">(() => {
    if (typeof window !== 'undefined') {
      const saved = sessionStorage.getItem('activeTab');
      return (saved as "market" | "ingress" | "location") || "market";
    }
    return "market";
  });

  const [plan, setPlan] = useState<'free' | 'plus' | 'admin'>(() => {
    if (typeof window !== 'undefined') {
      const saved = sessionStorage.getItem('plan');
      return (saved as 'free' | 'plus' | 'admin') || 'free';
    }
    return 'free';
  });

  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [upgradeFeature, setUpgradeFeature] = useState<string>("");

  // Persist plan and activeTab changes to sessionStorage
  useEffect(() => {
    sessionStorage.setItem('plan', plan);
  }, [plan]);

  useEffect(() => {
    sessionStorage.setItem('activeTab', activeTab);
  }, [activeTab]);

  // Disable console logging for non-admin tiers
  useEffect(() => {
    if (plan !== 'admin') {
      const noop = () => {};
      console.log = noop;
      console.info = noop;
      console.warn = noop;
      console.debug = noop;
    }
  }, [plan]);
  const [latStr, setLatStr] = useState("40.7128");
  const [lonStr, setLonStr] = useState("-74.0060");
  const [tz, setTz] = useState(tzGuess);
  const [timezoneMenuOpen, setTimezoneMenuOpen] = useState(false);
  const timezoneMenuRef = useRef<HTMLDivElement | null>(null);
  const timezoneSelectValue = useMemo(() => (COMMON_TIMEZONES.some((opt) => opt.value === tz) ? tz : "custom"), [tz]);
  const handleTimezoneOptionSelect = useCallback((value: string) => {
    if (value === "custom") {
      setTz("");
      setTimezoneMenuOpen(false);
      return;
    }
    const option = COMMON_TIMEZONES.find((opt) => opt.value === value);
    if (!option) return;
    setTz(option.value);
    if (typeof option.lat === "string") {
      setLatStr(option.lat);
    }
    if (typeof option.lon === "string") {
      setLonStr(option.lon);
    }
    setTimezoneMenuOpen(false);
  }, []);
  const showCustomTimezone = timezoneSelectValue === "custom";
  const timezoneButtonLabel = useMemo(() => {
    if (showCustomTimezone) {
      return tz ? `${tz}` : "Custom…";
    }
    const option = COMMON_TIMEZONES.find((opt) => opt.value === timezoneSelectValue);
    return option?.label ?? timezoneSelectValue;
  }, [timezoneSelectValue, tz, showCustomTimezone]);

  useEffect(() => {
    if (!timezoneMenuOpen) return;
    function handleClickOutside(event: MouseEvent) {
      if (!timezoneMenuRef.current) return;
      if (!timezoneMenuRef.current.contains(event.target as Node)) {
        setTimezoneMenuOpen(false);
      }
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setTimezoneMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKey);
    };
  }, [timezoneMenuOpen]);

  const [startLocal, setStartLocal] = useState(() =>
    DateTime.now().toISO({ includeOffset: false }).slice(0, 16)
  );
  const [ascHours, setAscHours] = useState(24);
  const [log, setLog] = useState<string[]>([]);
  const logRef = useRef<HTMLDivElement | null>(null);
  const horizonRequestRef = useRef(0);
  const ingressRequestRef = useRef(0);
  const retroRequestRef = useRef(0);
  const combRequestRef = useRef(0);
  const prefetchRequestRef = useRef(0);
  const swissMonthlyCacheRef = useRef(new Map<string, SwissMonthlyResponse>());
  const swissMonthlyPendingRef = useRef(new Map<string, Promise<SwissMonthlyResponse>>());
  const [horizonLoading, setHorizonLoading] = useState(false);
  const [ingressLoading, setIngressLoading] = useState(false);
  const [retroLoading, setRetroLoading] = useState(false);
  const [combLoading, setCombLoading] = useState(false);
  const [prefetchLoading, setPrefetchLoading] = useState(false);

  const [lagnaRows, setLagnaRows] = useState<
    { timeISO: string; from: RashiName; to: RashiName; degree: number }[]
  >([]);
const [moonRows, setMoonRows] = useState<MoonChangeRow[]>([]);
const [, setMoonMonthlyRows] = useState<MoonChangeRow[]>([]);
const [velocityRows, setVelocityRows] = useState<VelocityExtremumRow[]>([]);
  const [sunRows, setSunRows] = useState<
    { timeISO: string; from: RashiName; to: RashiName }[]
  >([]);
  const [otherIngressRows, setOtherIngressRows] = useState<
    { body: PlanetIngressName; timeISO: string; from: RashiName; to: RashiName }[]
  >([]);
  const [ingressEventsByMonth, setIngressEventsByMonth] = useState<
    Map<string, ChartIngressEvent[]>
  >(() => new Map());

  const [stationRows, setStationRows] = useState<StationWindow[]>([]);
const [combRows, setCombRows] = useState<
  { startISO: string; endISO: string | null; planet: CombustionPlanetName; orbDeg: number }[]
>([]);
  const [combustionEventsByMonth, setCombustionEventsByMonth] = useState<
    Map<string, ChartCombustionEvent[]>
  >(() => new Map());
const velocityRequestRef = useRef(0);
const [velocityLoading, setVelocityLoading] = useState(false);
  const [retroEventsByMonth, setRetroEventsByMonth] = useState<
    Map<string, ChartRetroEvent[]>
  >(() => new Map());
  const [velocityEventsByMonth, setVelocityEventsByMonth] = useState<
    Map<string, ChartVelocityEvent[]>
  >(() => new Map());
  const [swissAvailable, setSwissAvailable] = useState(false);
  const [now, setNow] = useState(() => DateTime.now().setZone(tz));
  const isPlus = plan === 'plus' || plan === 'admin';
  const isAdmin = plan === 'admin';

  const showUpgradePrompt = (feature: string) => {
    setUpgradeFeature(feature);
    setShowUpgradeModal(true);
  };

  const busy = horizonLoading || ingressLoading || retroLoading || combLoading || velocityLoading;
  const timeFormat = "yyyy-LL-dd HH:mm:ss";
  type LuxonDateTime = ReturnType<typeof DateTime.now>;
  const parseLocalTime = useCallback(
    (value: string | null | undefined) => {
      if (!value) {
        return DateTime.invalid("invalid-input");
      }
      let dt = DateTime.fromFormat(value, timeFormat, { zone: tz });
      if (!dt.isValid) {
        dt = DateTime.fromISO(value, { zone: tz });
      }
      return dt;
    },
    [tz]
  );
  const lagnaTimes = useMemo(
    () => lagnaRows.map((row) => parseLocalTime(row.timeISO)),
    [lagnaRows, parseLocalTime]
  );
  const moonTimes = useMemo(
    () => moonRows.map((row) => parseLocalTime(row.timeISO)),
    [moonRows, parseLocalTime]
  );
  const otherIngressTimes = useMemo(
    () => otherIngressRows.map((row) => parseLocalTime(row.timeISO)),
    [otherIngressRows, parseLocalTime]
  );
  const lagnaHighlightIndex = useMemo(() => {
    if (!lagnaTimes.length) return -1;
    const idx = lagnaTimes.findIndex((dt) => dt.isValid && dt >= now);
    return idx === -1 ? -1 : idx;
  }, [lagnaTimes, now]);
  const moonHighlightIndex = useMemo(() => {
    if (!moonTimes.length) return -1;
    const idx = moonTimes.findIndex((dt) => dt.isValid && dt >= now);
    return idx === -1 ? -1 : idx;
  }, [moonTimes, now]);

  const sunTimes = useMemo(
    () => sunRows.map((row) => parseLocalTime(row.timeISO)),
    [sunRows, parseLocalTime]
  );
  const combTimes = useMemo(
    () => combRows.map((row) => parseLocalTime(row.startISO)),
    [combRows, parseLocalTime]
  );

  const stationIntervals = useMemo(
    () =>
      stationRows.map((row) => ({
        ...row,
        start: row.startISO ? parseLocalTime(row.startISO) : null,
        end: row.endISO ? parseLocalTime(row.endISO) : null,
      })),
    [stationRows, parseLocalTime]
  );
  const [stationMonth, setStationMonth] = useState(() => now.startOf("month"));
  const [combMonth, setCombMonth] = useState(() => now.startOf("month"));
  const [velocityMonth, setVelocityMonth] = useState(() => now.startOf("month"));

  const sunRowsWithTime = useMemo(
    () => sunRows.map((row, idx) => ({ ...row, dt: sunTimes[idx] ?? parseLocalTime(row.timeISO) })),
    [sunRows, sunTimes, parseLocalTime]
  );
  const combRowsWithTime = useMemo(
    () =>
      combRows.map((row, idx) => ({
        ...row,
        start: combTimes[idx] ?? parseLocalTime(row.startISO),
        end: parseLocalTime(row.endISO),
      })),
    [combRows, combTimes, parseLocalTime]
  );
  const velocityRowsWithTime = useMemo(
    () =>
      velocityRows.map((row) => ({
        ...row,
        dt: parseLocalTime(row.timeISO),
      })),
    [velocityRows, parseLocalTime]
  );

  const ingressRows = useMemo(() => {
    const sunIngress = sunRowsWithTime.map((row) => ({
      body: "Sun",
      from: row.from,
      to: row.to,
      timeISO: row.timeISO,
      dt: row.dt,
    }));
    const otherIngress = otherIngressRows.map((row, idx) => ({
      ...row,
      dt: otherIngressTimes[idx] ?? parseLocalTime(row.timeISO),
    }));
    return [...sunIngress, ...otherIngress]
      .filter((row) => row.dt?.isValid)
      .sort((a, b) => {
        const aMillis = a.dt?.toMillis?.() ?? Number.MAX_SAFE_INTEGER;
        const bMillis = b.dt?.toMillis?.() ?? Number.MAX_SAFE_INTEGER;
        return aMillis - bMillis;
      });
  }, [sunRowsWithTime, otherIngressRows, otherIngressTimes, parseLocalTime]);

  const ingressEventsForMain = useMemo(() => {
    const aggregated: ChartIngressEvent[] = [];
    ingressEventsByMonth.forEach((events) => {
      aggregated.push(...events);
    });
    aggregated.sort((a, b) => {
      const aDt = parseLocalTime(a.timeISO);
      const bDt = parseLocalTime(b.timeISO);
      const aMillis = aDt.isValid ? aDt.toMillis() : Number.MAX_SAFE_INTEGER;
      const bMillis = bDt.isValid ? bDt.toMillis() : Number.MAX_SAFE_INTEGER;
      return aMillis - bMillis;
    });
    return aggregated;
  }, [ingressEventsByMonth, parseLocalTime]);

  const combustionEventsForMain = useMemo(() => {
    const aggregated: ChartCombustionEvent[] = [];
    combustionEventsByMonth.forEach((events) => {
      aggregated.push(...events);
    });
    aggregated.sort((a, b) => {
      const aDt = parseLocalTime(a.startISO);
      const bDt = parseLocalTime(b.startISO);
      const aMillis = aDt.isValid ? aDt.toMillis() : Number.MAX_SAFE_INTEGER;
      const bMillis = bDt.isValid ? bDt.toMillis() : Number.MAX_SAFE_INTEGER;
      return aMillis - bMillis;
    });
    return aggregated;
  }, [combustionEventsByMonth, parseLocalTime]);

  const retroEventsForMain = useMemo(() => {
    const aggregated: ChartRetroEvent[] = [];
    retroEventsByMonth.forEach((events) => {
      aggregated.push(...events);
    });
    aggregated.sort((a, b) => {
      const aDt = parseLocalTime(a.startISO);
      const bDt = parseLocalTime(b.startISO);
      const aMillis = aDt.isValid ? aDt.toMillis() : Number.MAX_SAFE_INTEGER;
      const bMillis = bDt.isValid ? bDt.toMillis() : Number.MAX_SAFE_INTEGER;
      return aMillis - bMillis;
    });
    return aggregated;
  }, [parseLocalTime, retroEventsByMonth]);

  const velocityEventsForMain = useMemo(() => {
    const aggregated: ChartVelocityEvent[] = [];
    velocityEventsByMonth.forEach((events) => {
      aggregated.push(...events);
    });
    aggregated.sort((a, b) => {
      const aDt = parseLocalTime(a.timeISO);
      const bDt = parseLocalTime(b.timeISO);
      const aMillis = aDt.isValid ? aDt.toMillis() : Number.MAX_SAFE_INTEGER;
      const bMillis = bDt.isValid ? bDt.toMillis() : Number.MAX_SAFE_INTEGER;
      return aMillis - bMillis;
    });
    return aggregated;
  }, [parseLocalTime, velocityEventsByMonth]);

  const [ingressMonth, setIngressMonth] = useState(() => {
    const first = ingressRows.find((row) => row.dt?.isValid)?.dt ?? now;
    return first.startOf("month");
  });

  useEffect(() => {
    const firstValid = ingressRows.find((row) => row.dt?.isValid)?.dt;
    if (!firstValid) return;
    setIngressMonth((prev: LuxonDateTime) => (prev.hasSame(firstValid, "month") ? prev : firstValid.startOf("month")));
  }, [ingressRows]);

  const ingressRowsFiltered = useMemo(
    () => ingressRows.filter((row) => row.dt?.isValid && row.dt.hasSame(ingressMonth, "month")),
    [ingressRows, ingressMonth]
  );
  const velocityRowsFiltered = useMemo(
    () =>
      velocityRowsWithTime.filter((row) => row.dt?.isValid && row.dt.hasSame(velocityMonth, "month")),
    [velocityRowsWithTime, velocityMonth]
  );
  const velocityHighlightIndex = useMemo(() => {
    const idx = velocityRowsFiltered.findIndex((row) => row.dt?.isValid && row.dt >= now);
    return idx === -1 ? -1 : idx;
  }, [velocityRowsFiltered, now]);

  const stationRowsFiltered = useMemo(() => {
    const monthStart = stationMonth.startOf("month");
    const nextMonth = monthStart.plus({ months: 1 });
    const startMillis = monthStart.toMillis();
    const endMillis = nextMonth.toMillis();
    return stationIntervals.filter((row) => {
      const rowStart = row.start?.isValid ? row.start.toMillis() : null;
      if (rowStart === null) return false;
      const rowEnd = row.end?.isValid ? row.end.toMillis() : Infinity;
      return rowStart < endMillis && rowEnd >= startMillis;
    });
  }, [stationIntervals, stationMonth]);
  const combRowsFiltered = useMemo(() => {
    const monthStart = combMonth.startOf("month");
    const nextMonth = monthStart.plus({ months: 1 });
    const startMillis = monthStart.toMillis();
    const endMillis = nextMonth.toMillis();
    return combRowsWithTime.filter((row) => {
      const rowStart = row.start?.isValid ? row.start.toMillis() : null;
      if (rowStart === null) return false;
      const rowEnd = row.end?.isValid ? row.end.toMillis() : Infinity;
      return rowStart < endMillis && rowEnd >= startMillis;
    });
  }, [combRowsWithTime, combMonth]);

  const ingressMonthLabel = ingressMonth.toFormat("LLL yyyy");
  const stationMonthLabel = stationMonth.toFormat("LLL yyyy");
  const combMonthLabel = combMonth.toFormat("LLL yyyy");
  const velocityMonthLabel = velocityMonth.toFormat("LLL yyyy");

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log]);

  useEffect(() => {
    setNow(DateTime.now().setZone(tz));
    const id = window.setInterval(() => {
      setNow(DateTime.now().setZone(tz));
    }, 60000);
    return () => window.clearInterval(id);
  }, [tz]);

  const append = useCallback((msg: string) => {
    setLog((l) => [...l.slice(-400), msg]);
  }, [setLog]);
  function formatError(err: unknown): string {
    if (err instanceof Error) return err.message;
    if (typeof err === "string") return err;
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }
  const assertTimezone = useCallback(() => {
    const zone = DateTime.local().setZone(tz);
    must(zone.isValid, `invalid timezone: ${tz}`);
  }, [tz]);

  const readCoordinates = useCallback(() => {
    const lat = Number.parseFloat(latStr);
    const lon = Number.parseFloat(lonStr);
    must(Number.isFinite(lat), "latitude is blank or invalid");
    must(Number.isFinite(lon), "longitude is blank or invalid");
    must(lat >= -90 && lat <= 90, "latitude must be between -90 and 90");
    must(lon >= -180 && lon <= 180, "longitude must be between -180 and 180");
    return { lat, lon };
  }, [latStr, lonStr]);

  const getMonthWindow = useCallback((target: LuxonDateTime) => {
    const base = target.setZone(tz).startOf("month");
    const next = base.plus({ months: 1 });
    return {
      monthStart: base,
      monthEnd: next,
      windowStart: base.minus({ days: 3 }),
      windowEnd: next.plus({ days: 3 }),
    };
  }, [tz]);

  useEffect(() => {
    swissMonthlyCacheRef.current.clear();
    swissMonthlyPendingRef.current.clear();
    setIngressEventsByMonth(
      () => new Map<string, ChartIngressEvent[]>(),
    );
    setCombustionEventsByMonth(
      () => new Map<string, ChartCombustionEvent[]>(),
    );
    setRetroEventsByMonth(
      () => new Map<string, ChartRetroEvent[]>(),
    );
    setVelocityEventsByMonth(
      () => new Map<string, ChartVelocityEvent[]>(),
    );
  }, [latStr, lonStr, tz]);

  const getSwissMonthly = useCallback(
    async (lat: number, lon: number, monthStartISO: string) => {
      const key = `${lat.toFixed(6)}|${lon.toFixed(6)}|${tz}|${monthStartISO}`;
      const cached = swissMonthlyCacheRef.current.get(key);
      if (cached) return cached;
      const pending = swissMonthlyPendingRef.current.get(key);
      if (pending) return pending;
      const request = fetchSwissMonthly({
        lat,
        lon,
        tz,
        monthStartISO,
      }).then((data) => {
        swissMonthlyCacheRef.current.set(key, data);
        return data;
      });
      swissMonthlyPendingRef.current.set(key, request);
      try {
        return await request;
      } finally {
      swissMonthlyPendingRef.current.delete(key);
      }
    },
    [tz],
  );

  const prefetchMonthlyData = useCallback(
    async (range: { start: number | null; end: number | null }) => {
      // Cancel any existing prefetch request
      const requestId = prefetchRequestRef.current + 1;
      prefetchRequestRef.current = requestId;

      // Prevent duplicate requests
      if (prefetchLoading) {
        append("⚠️ prefetch already in progress, skipping...");
        return;
      }

      setPrefetchLoading(true);

      try {
        const startSeconds = range.start ?? range.end;
        const endSeconds = range.end ?? range.start;
        if (startSeconds == null && endSeconds == null) {
          return;
        }

        let start = startSeconds;
        let end = endSeconds ?? startSeconds;
        if (start != null && end != null && start > end) {
          [start, end] = [end, start];
        }
        if (start == null) start = end;
        if (end == null) end = start;
        if (start == null || end == null) return;

        const startMonth = DateTime.fromSeconds(start, { zone: tz }).startOf("month").minus({ months: 1 });
        const endMonth = DateTime.fromSeconds(end, { zone: tz }).startOf("month").plus({ months: 1 });
        if (!startMonth.isValid || !endMonth.isValid) return;

        let coords: { lat: number; lon: number };
        try {
          assertTimezone();
          coords = readCoordinates();
        } catch (err: unknown) {
          append(`prefetch skipped: ${formatError(err)}`);
          return;
        }

      // Collect all months that need data
      const monthsToCheck: LuxonDateTime[] = [];
      let cursor = startMonth;
      const final = endMonth;
      while (cursor.toMillis() <= final.toMillis()) {
        monthsToCheck.push(cursor);
        cursor = cursor.plus({ months: 1 });
      }

      // Filter to only months that need at least one event type
      const monthsNeedingData: { month: LuxonDateTime; monthKey: string; monthStartISO: string }[] = [];
      for (const monthStart of monthsToCheck) {
        const monthKey = monthStart.toFormat("yyyy-LL");
        const needIngress = !ingressEventsByMonth.has(monthKey);
        const needCombustion = !combustionEventsByMonth.has(monthKey);
        const needRetro = !retroEventsByMonth.has(monthKey);
        const needVelocity = !velocityEventsByMonth.has(monthKey);
        if (needIngress || needCombustion || needRetro || needVelocity) {
          const monthStartISO = monthStart
            .set({ hour: 0, minute: 0, second: 0, millisecond: 0 })
            .toFormat("yyyy-LL-dd'T'HH:mm:ss");
          monthsNeedingData.push({ month: monthStart, monthKey, monthStartISO });
        }
      }

      if (monthsNeedingData.length === 0) {
        return;
      }

        // Use batch API for better performance (max 60 months per batch)
        const BATCH_SIZE = 60;
        for (let i = 0; i < monthsNeedingData.length; i += BATCH_SIZE) {
          // Check if request was cancelled
          if (prefetchRequestRef.current !== requestId) {
            append("⚠️ prefetch cancelled");
            return;
          }

          const batch = monthsNeedingData.slice(i, i + BATCH_SIZE);
          const monthStartISOs = batch.map((m) => m.monthStartISO);

          try {
            append(`fetching ${batch.length} months in batch (${batch[0].month.toFormat("MMM yyyy")} - ${batch[batch.length - 1].month.toFormat("MMM yyyy")})...`);

            const batchResponse = await fetchSwissMonthlyBatch({
              lat: coords.lat,
              lon: coords.lon,
              tz,
              monthStartISOs,
            });

            // Check again after async operation
            if (prefetchRequestRef.current !== requestId) {
              append("⚠️ prefetch cancelled");
              return;
            }

            if (!batchResponse.ok) {
              throw new Error("Batch request failed");
            }

          // Process each month in the batch
          for (const { monthKey, monthStartISO } of batch) {
            const swissMonthly = batchResponse.months[monthStartISO];
            if (!swissMonthly || !swissMonthly.ok) {
              append(`⚠️ ${monthKey}: ${swissMonthly?.error || "no data"}`);
              continue;
            }

            const { ingress, combustion, retro, velocity } = extractMonthlyChartEvents(swissMonthly);
            const needIngress = !ingressEventsByMonth.has(monthKey);
            const needCombustion = !combustionEventsByMonth.has(monthKey);
            const needRetro = !retroEventsByMonth.has(monthKey);
            const needVelocity = !velocityEventsByMonth.has(monthKey);

            if (needIngress) {
              setIngressEventsByMonth((prev) => applyMonthUpdate(prev, monthKey, ingress));
            }
            if (needCombustion) {
              setCombustionEventsByMonth((prev) => applyMonthUpdate(prev, monthKey, combustion));
            }
            if (needRetro) {
              setRetroEventsByMonth((prev) => applyMonthUpdate(prev, monthKey, retro));
            }
            if (needVelocity) {
              setVelocityEventsByMonth((prev) => applyMonthUpdate(prev, monthKey, velocity));
            }
          }

          append(`✓ loaded ${batch.length} months`);
        } catch (err: unknown) {
          append(`batch error: ${formatError(err)}`);
          // Fall back to individual requests for this batch
          for (const { month: monthStart, monthKey, monthStartISO } of batch) {
            try {
              const swissMonthly = await getSwissMonthly(coords.lat, coords.lon, monthStartISO);
              const { ingress, combustion, retro, velocity } = extractMonthlyChartEvents(swissMonthly);
              const needIngress = !ingressEventsByMonth.has(monthKey);
              const needCombustion = !combustionEventsByMonth.has(monthKey);
              const needRetro = !retroEventsByMonth.has(monthKey);
              const needVelocity = !velocityEventsByMonth.has(monthKey);

              if (needIngress) {
                setIngressEventsByMonth((prev) => applyMonthUpdate(prev, monthKey, ingress));
              }
              if (needCombustion) {
                setCombustionEventsByMonth((prev) => applyMonthUpdate(prev, monthKey, combustion));
              }
              if (needRetro) {
                setRetroEventsByMonth((prev) => applyMonthUpdate(prev, monthKey, retro));
              }
              if (needVelocity) {
                setVelocityEventsByMonth((prev) => applyMonthUpdate(prev, monthKey, velocity));
              }
            } catch (fallbackErr: unknown) {
              append(`prefetch ${monthStart.toFormat("LLL yyyy")} error: ${formatError(fallbackErr)}`);
            }
          }
        }
        }
      } finally {
        // Only clear loading if this is still the current request
        if (prefetchRequestRef.current === requestId) {
          setPrefetchLoading(false);
        }
      }
    },
    [
      append,
      assertTimezone,
      combustionEventsByMonth,
      getSwissMonthly,
      ingressEventsByMonth,
      prefetchLoading,
      readCoordinates,
      retroEventsByMonth,
      tz,
      velocityEventsByMonth,
    ],
  );

  const handleTerminalRangeChange = useCallback(
    (range: { start: number | null; end: number | null }) => {
      void prefetchMonthlyData(range);
    },
    [prefetchMonthlyData],
  );

  const locationPane = (
    <Pane title="LOCATION & TIME">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="space-y-2">
          <label className="block text-xs text-zinc-500">latitude</label>
          <input
            type="text"
            inputMode="decimal"
            pattern="[-+]?[0-9]*\.?[0-9]*"
            value={latStr}
            onChange={(event) => setLatStr(event.target.value)}
            className="w-full bg-black border border-zinc-800 px-3 py-2 outline-none focus:border-green-600 font-mono text-xs text-zinc-300"
          />
        </div>
        <div className="space-y-2">
          <label className="block text-xs text-zinc-500">longitude (east +)</label>
          <input
            type="text"
            inputMode="decimal"
            pattern="[-+]?[0-9]*\.?[0-9]*"
            value={lonStr}
            onChange={(event) => setLonStr(event.target.value)}
            className="w-full bg-black border border-zinc-800 px-3 py-2 outline-none focus:border-green-600 font-mono text-xs text-zinc-300"
          />
        </div>
        <div className="space-y-2">
          <label className="block text-xs text-zinc-500">timezone</label>
          <div className="relative" ref={timezoneMenuRef}>
            <button
              type="button"
              onClick={() => setTimezoneMenuOpen((open) => !open)}
              className={cls(
                "w-full border px-3 py-2 text-left font-mono text-xs transition-colors",
                timezoneMenuOpen ? "border-green-600 bg-zinc-900 text-green-400" : "border-zinc-800 bg-black text-zinc-300 hover:border-zinc-700",
              )}
            >
              <span className="flex items-center justify-between">
                <span>{timezoneButtonLabel}</span>
                <span className="text-[10px] text-zinc-600">{timezoneMenuOpen ? "▴" : "▾"}</span>
              </span>
            </button>
            {timezoneMenuOpen && (
              <div className="absolute z-20 mt-1 w-full border border-zinc-800 bg-zinc-900">
                <ul className="max-h-60 overflow-y-auto font-mono">
                  {COMMON_TIMEZONES.map((opt) => {
                    const isActive = opt.value === timezoneSelectValue;
                    return (
                      <li key={opt.value}>
                        <button
                          type="button"
                          onClick={() => handleTimezoneOptionSelect(opt.value)}
                          className={cls(
                            "w-full px-3 py-2 text-left text-xs transition-colors",
                            isActive ? "bg-green-600/30 text-green-400" : "text-zinc-400 hover:bg-black hover:text-zinc-200",
                          )}
                        >
                          {opt.label}
                        </button>
                      </li>
                    );
                  })}
                  <li>
                    <button
                      type="button"
                      onClick={() => handleTimezoneOptionSelect("custom")}
                      className={cls(
                        "w-full px-3 py-2 text-left text-xs transition-colors",
                        showCustomTimezone ? "bg-green-600/30 text-green-400" : "text-zinc-400 hover:bg-black hover:text-zinc-200",
                      )}
                    >
                      Custom…
                    </button>
                  </li>
                </ul>
              </div>
            )}
          </div>
          {showCustomTimezone && (
            <input
              type="text"
              value={tz}
              onChange={(event) => setTz(event.target.value)}
              className="w-full bg-black border border-zinc-800 px-3 py-2 outline-none focus:border-green-500 font-mono text-sm"
              placeholder="e.g. Europe/Paris"
            />
          )}
          <div className="flex gap-2 mt-2">
            <button
              onClick={() => setTz(tzGuess)}
              className="border border-transparent bg-zinc-900 px-2 py-1 text-xs text-zinc-300 transition-colors focus:outline-none focus:ring-1 focus:ring-green-500 hover:text-green-300"
            >
              Use System
            </button>
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="space-y-2 md:col-span-2">
          <label className="block text-xs text-zinc-500">start date and time</label>
          <input
            type="datetime-local"
            value={startLocal}
            onChange={(event) => setStartLocal(event.target.value)}
            className="w-full bg-black border border-zinc-800 px-3 py-2 outline-none focus:border-green-600 font-mono text-xs text-zinc-300"
          />
        </div>
        <div className="space-y-2">
          <label className="block text-xs text-zinc-500">asc horizon hours</label>
          <input
            type="number"
            min={1}
            max={168}
            value={ascHours}
            onChange={(event) => {
              const raw = Number.parseInt(event.target.value, 10);
              if (Number.isNaN(raw)) {
                setAscHours(24);
                return;
              }
              const clamped = Math.min(168, Math.max(1, raw));
              setAscHours(clamped);
            }}
            className="w-full bg-black border border-zinc-800 px-3 py-2 outline-none focus:border-green-600 font-mono text-xs text-zinc-300"
          />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          onClick={() => void runAll()}
          disabled={busy}
          className={cls(
            "rounded-none px-4 py-2 font-mono text-sm border",
            busy
              ? "border-zinc-800 bg-zinc-900 text-zinc-500"
              : "border-green-600 bg-green-900/20 text-green-400 hover:bg-green-900/30",
          )}
        >
          {busy ? "computing" : "run"}
        </button>
        <div className="text-xs text-zinc-500">
          Location drives Swiss horizon + monthly events for the chart and tables.
        </div>
      </div>
    </Pane>
  );

  const locationSummaryPane = (
    <Pane title="LOCATION">
      <div className="flex flex-wrap items-center justify-between gap-4 text-xs text-zinc-300">
        <div className="flex flex-wrap gap-4 font-mono">
          <div>Lat: {latStr || "—"}</div>
          <div>Lon: {lonStr || "—"}</div>
          <div>TZ: {tz}</div>
          <div>Start: {startLocal || "—"}</div>
        </div>
        <button
          type="button"
          onClick={() => setActiveTab("location")}
          className="border border-transparent px-3 py-1 text-xs uppercase tracking-wide text-zinc-300 transition-colors hover:border-green-500 hover:text-green-300"
        >
          Edit Location
        </button>
      </div>
    </Pane>
  );

  const loadHorizonWindow = useCallback(
    async () => {
      const requestId = horizonRequestRef.current + 1;
      horizonRequestRef.current = requestId;
      setHorizonLoading(true);

      try {
        assertTimezone();
        const { lat, lon } = readCoordinates();
        const startDT = parseLocalTime(startLocal);
        must(startDT.isValid, "invalid start datetime");
        const moonWindowDays = Math.max(ascHours / 24, 1);
        append(
          `horizon scan: asc ${ascHours}h, moon ${ascHours}h from ${startDT.toFormat(timeFormat)}`,
        );

        const startLocalISO = startDT.toFormat("yyyy-LL-dd'T'HH:mm:ss");
        const result = await fetchSwissHorizon({
          lat,
          lon,
          tz,
          startLocalISO,
          ascHours,
          moonDays: moonWindowDays,
        });

        if (horizonRequestRef.current !== requestId) return;

        setSwissAvailable(Boolean(result.swissAvailable));

        const lagnaNext: typeof lagnaRows = [];
        for (const row of result.lagnaRows ?? []) {
          if (!isRashiName(row.from) || !isRashiName(row.to)) continue;
          lagnaNext.push({
            timeISO: row.timeISO,
            from: row.from,
            to: row.to,
            degree: row.degree,
          });
        }
        const moonNext: typeof moonRows = [];
        for (const row of result.moonRows ?? []) {
          if (typeof row.pada !== "number" || !row.nakshatra) continue;
          moonNext.push({
            timeISO: row.timeISO,
            nakshatra: row.nakshatra,
            pada: row.pada,
          });
        }

        setLagnaRows(lagnaNext);
        setMoonRows(normalizeMoonRows(moonNext, tz, timeFormat));
        result.notes?.forEach((note) => append(`horizon note: ${note}`));
        append(
          `horizon ready (lagna ${lagnaNext.length}, moon ${moonNext.length})`,
        );
      } catch (err: unknown) {
        if (horizonRequestRef.current === requestId) {
          setLagnaRows([]);
          setMoonRows([]);
          setSwissAvailable(false);
        }
        append(`horizon error: ${formatError(err)}`);
      } finally {
        if (horizonRequestRef.current === requestId) {
          setHorizonLoading(false);
        }
      }
    },
    [
      tz,
      timeFormat,
      append,
      assertTimezone,
      readCoordinates,
      parseLocalTime,
      startLocal,
      ascHours,
    ],
  );

  const loadIngressMonth = useCallback(
    async (month: LuxonDateTime) => {
      const requestId = ingressRequestRef.current + 1;
      ingressRequestRef.current = requestId;
      setIngressLoading(true);
      const { monthStart } = getMonthWindow(month);
      const monthKey = monthStart.toFormat("yyyy-LL");
      setIngressMonth(monthStart);
      const monthLabel = monthStart.toFormat("LLL yyyy");
      append(`ingress ${monthLabel}: starting scan`);

      try {
        assertTimezone();
        const { lat, lon } = readCoordinates();
        const monthStartISO = monthStart
          .set({ hour: 0, minute: 0, second: 0, millisecond: 0 })
          .toFormat("yyyy-LL-dd'T'HH:mm:ss");
        const swissMonthly = await getSwissMonthly(lat, lon, monthStartISO);
        if (ingressRequestRef.current !== requestId) return;
        setSwissAvailable(Boolean(swissMonthly.swissAvailable));

        const moonNext: MoonChangeRow[] = [];
        for (const row of swissMonthly.moonMonthlyRows ?? []) {
          if (typeof row.pada !== "number" || !row.nakshatra) continue;
          moonNext.push({
            timeISO: row.timeISO,
            nakshatra: row.nakshatra,
            pada: row.pada,
          });
        }

        const sunNext: typeof sunRows = [];
        for (const row of swissMonthly.sunRows ?? []) {
          if (!isRashiName(row.from) || !isRashiName(row.to)) continue;
          if (!hasSignTransition(row.from, row.to)) continue;
          sunNext.push({
            timeISO: row.timeISO,
            from: row.from,
            to: row.to,
          });
        }

        const otherIngress: typeof otherIngressRows = [];
        for (const row of swissMonthly.otherIngressRows ?? []) {
          if (!isPlanetIngressName(row.body)) continue;
          if (!isRashiName(row.from) || !isRashiName(row.to)) continue;
          if (!hasSignTransition(row.from, row.to)) continue;
          const canonicalBody = normalizePlanetName(row.body);
          if (!canonicalBody || !isPlanetIngressName(canonicalBody)) continue;
          otherIngress.push({
            body: canonicalBody,
            from: row.from,
            to: row.to,
            timeISO: row.timeISO,
          });
        }

        const chartIngressEvents: ChartIngressEvent[] = [
          ...sunNext.map((row) => ({
            body: "Sun",
            from: row.from,
            to: row.to,
            timeISO: row.timeISO,
          })),
          ...otherIngress.map((row) => ({
            body: row.body,
            from: row.from,
            to: row.to,
            timeISO: row.timeISO,
          })),
        ];

        const velocityNext: VelocityExtremumRow[] = [];
        for (const row of swissMonthly.velocityRows ?? []) {
          if (!row || typeof row.speed !== "number" || !row.timeISO) continue;
          const kind = normalizeKind(row.kind);
          const canonical = normalizePlanetName(row.planet);
          const finalPlanet = canonical ?? row.planet;
          velocityNext.push({
            timeISO: row.timeISO,
            planet: finalPlanet,
            kind,
            speed: row.speed,
          });
        }

        setMoonMonthlyRows(normalizeMoonRows(moonNext, tz, timeFormat));
        setSunRows(sunNext);
        setOtherIngressRows(otherIngress);
        setIngressEventsByMonth((prev) => applyMonthUpdate(prev, monthKey, chartIngressEvents));
        setVelocityEventsByMonth((prev) => applyMonthUpdate(prev, monthKey, velocityNext));
        if (velocityMonth.hasSame(monthStart, "month")) {
          setVelocityRows(velocityNext);
        }
        append(
          `ingress ${monthLabel} ready (moon ${moonNext.length}, sun ${sunNext.length}, data ${otherIngress.length}, velocity ${velocityNext.length})`,
        );
      } catch (err: unknown) {
        if (ingressRequestRef.current === requestId) {
          setMoonMonthlyRows([]);
          setSunRows([]);
          setOtherIngressRows([]);
          setIngressEventsByMonth((prev) => applyMonthUpdate(prev, monthKey, []));
          setVelocityEventsByMonth((prev) => applyMonthUpdate(prev, monthKey, []));
          if (velocityMonth.hasSame(monthStart, "month")) {
            setVelocityRows([]);
          }
          setSwissAvailable(false);
        }
        append(`ingress error: ${formatError(err)}`);
      } finally {
        if (ingressRequestRef.current === requestId) {
          setIngressLoading(false);
        }
      }
    },
    [append, assertTimezone, getMonthWindow, getSwissMonthly, readCoordinates, timeFormat, tz, velocityMonth],
  );

  const loadVelocityMonth = useCallback(
    async (month: LuxonDateTime) => {
      const requestId = velocityRequestRef.current + 1;
      velocityRequestRef.current = requestId;
      setVelocityLoading(true);
      const { monthStart } = getMonthWindow(month);
      const monthKey = monthStart.toFormat("yyyy-LL");
      setVelocityMonth(monthStart);
      const monthLabel = monthStart.toFormat("LLL yyyy");
      append(`velocity ${monthLabel}: requesting Swiss backend`);

      try {
        assertTimezone();
        const { lat, lon } = readCoordinates();
        const monthStartISO = monthStart
          .set({ hour: 0, minute: 0, second: 0, millisecond: 0 })
          .toFormat("yyyy-LL-dd'T'HH:mm:ss");
        const swissMonthly = await getSwissMonthly(lat, lon, monthStartISO);
        if (velocityRequestRef.current !== requestId) return;
        setSwissAvailable(Boolean(swissMonthly.swissAvailable));

        const velocityNext: VelocityExtremumRow[] = [];
        for (const row of swissMonthly.velocityRows ?? []) {
          if (!row || typeof row.speed !== "number" || !row.timeISO) continue;
          const kind = row.kind === "min" ? "min" : "max";
          const canonical = normalizePlanetName(row.planet);
          const finalPlanet = canonical ?? row.planet;
          velocityNext.push({
            timeISO: row.timeISO,
            planet: finalPlanet,
            kind,
            speed: row.speed,
          });
        }

        setVelocityRows(velocityNext);
        setVelocityEventsByMonth((prev) => applyMonthUpdate(prev, monthKey, velocityNext));
        append(`velocity ${monthLabel} ready (${velocityNext.length})`);
      } catch (err: unknown) {
        if (velocityRequestRef.current === requestId) {
          setVelocityRows([]);
          setSwissAvailable(false);
          setVelocityEventsByMonth((prev) => applyMonthUpdate(prev, monthKey, []));
        }
        append(`velocity error: ${formatError(err)}`);
      } finally {
        if (velocityRequestRef.current === requestId) {
          setVelocityLoading(false);
        }
      }
    },
    [
      append,
      assertTimezone,
      getMonthWindow,
      getSwissMonthly,
      readCoordinates,
    ],
  );

  const loadRetrogradeMonth = useCallback(
    async (month: LuxonDateTime) => {
      const requestId = retroRequestRef.current + 1;
      retroRequestRef.current = requestId;
      setRetroLoading(true);
      const { monthStart } = getMonthWindow(month);
      const monthKey = monthStart.toFormat("yyyy-LL");
      setStationMonth(monthStart);
      const monthLabel = monthStart.toFormat("LLL yyyy");
      append(`stations ${monthLabel}: requesting Swiss backend`);

      try {
        assertTimezone();
        const { lat, lon } = readCoordinates();
        const monthStartISO = monthStart
          .set({ hour: 0, minute: 0, second: 0, millisecond: 0 })
          .toFormat("yyyy-LL-dd'T'HH:mm:ss");
        const swissMonthly = await getSwissMonthly(lat, lon, monthStartISO);
        if (retroRequestRef.current !== requestId) return;

        setSwissAvailable(Boolean(swissMonthly.swissAvailable));

        const stationNext: StationWindow[] = [];
        for (const row of swissMonthly.stationRows ?? []) {
          if (!isStationPlanetName(row.planet)) continue;
          const canonical = normalizePlanetName(row.planet);
          const finalPlanet = isStationPlanetName(canonical ?? "") ? canonical : row.planet;
          stationNext.push({
            planet: finalPlanet as StationWindow["planet"],
            state: "retrograde",
            startISO: row.startISO,
            endISO: row.endISO ?? null,
          });
        }

        setStationRows(stationNext);
        setRetroEventsByMonth((prev) => applyMonthUpdate(prev, monthKey, stationNext));
        append(`stations ${monthLabel} ready (${stationNext.length})`);
      } catch (err: unknown) {
        if (retroRequestRef.current === requestId) {
          setStationRows([]);
          setSwissAvailable(false);
          setRetroEventsByMonth((prev) => applyMonthUpdate(prev, monthKey, []));
        }
        append(`stations error: ${formatError(err)}`);
      } finally {
        if (retroRequestRef.current === requestId) {
          setRetroLoading(false);
        }
      }
    },
    [append, assertTimezone, getMonthWindow, getSwissMonthly, readCoordinates],
  );

  const loadCombustionMonth = useCallback(
    async (month: LuxonDateTime) => {
      const requestId = combRequestRef.current + 1;
      combRequestRef.current = requestId;
      setCombLoading(true);
      const { monthStart } = getMonthWindow(month);
      const monthKey = monthStart.toFormat("yyyy-LL");
      setCombMonth(monthStart);
      const monthLabel = monthStart.toFormat("LLL yyyy");
      append(`combustion ${monthLabel}: requesting Swiss backend`);

      try {
        assertTimezone();
        const { lat, lon } = readCoordinates();
        const monthStartISO = monthStart
          .set({ hour: 0, minute: 0, second: 0, millisecond: 0 })
          .toFormat("yyyy-LL-dd'T'HH:mm:ss");
        const swissMonthly = await getSwissMonthly(lat, lon, monthStartISO);
        if (combRequestRef.current !== requestId) return;

        setSwissAvailable(Boolean(swissMonthly.swissAvailable));

        const combNext: typeof combRows = [];
        for (const row of swissMonthly.combRows ?? []) {
          if (!isCombustionPlanetName(row.planet)) continue;
          const canonical = normalizePlanetName(row.planet);
          const finalPlanet = isCombustionPlanetName(canonical ?? "") ? canonical : row.planet;
          combNext.push({
            startISO: row.startISO,
            endISO: row.endISO ?? null,
            planet: finalPlanet as CombustionPlanetName,
            orbDeg: row.orbDeg,
          });
        }

        setCombRows(combNext);
        setCombustionEventsByMonth((prev) => applyMonthUpdate(prev, monthKey, combNext));
        append(`combustion ${monthLabel} ready (${combNext.length})`);
      } catch (err: unknown) {
        if (combRequestRef.current === requestId) {
          setCombRows([]);
          setSwissAvailable(false);
          setCombustionEventsByMonth((prev) => applyMonthUpdate(prev, monthKey, []));
        }
        append(`combustion error: ${formatError(err)}`);
      } finally {
        if (combRequestRef.current === requestId) {
          setCombLoading(false);
        }
      }
    },
    [append, assertTimezone, getMonthWindow, getSwissMonthly, readCoordinates],
  );

  const shiftIngressMonth = useCallback(
    (delta: number) => {
      const next = ingressMonth.plus({ months: delta }).startOf("month");
      void loadIngressMonth(next);
    },
    [ingressMonth, loadIngressMonth],
  );

  const shiftStationMonth = useCallback(
    (delta: number) => {
      const next = stationMonth.plus({ months: delta }).startOf("month");
      setStationMonth(next);
      void loadRetrogradeMonth(next);
    },
    [stationMonth, loadRetrogradeMonth],
  );

  const shiftCombMonth = useCallback(
    (delta: number) => {
      const next = combMonth.plus({ months: delta }).startOf("month");
      void loadCombustionMonth(next);
    },
    [combMonth, loadCombustionMonth],
  );

  const shiftVelocityMonth = useCallback(
    (delta: number) => {
      const next = velocityMonth.plus({ months: delta }).startOf("month");
      void loadVelocityMonth(next);
    },
    [velocityMonth, loadVelocityMonth],
  );

  const runAll = useCallback(async () => {
    setLog([]);
    append("run: refreshing horizon and monthly tables");
    await Promise.all([
      loadHorizonWindow(),
      loadIngressMonth(ingressMonth),
      loadRetrogradeMonth(stationMonth),
      loadCombustionMonth(combMonth),
      loadVelocityMonth(velocityMonth),
    ]);
  }, [
    loadHorizonWindow,
    loadIngressMonth,
    loadRetrogradeMonth,
    loadCombustionMonth,
    loadVelocityMonth,
    ingressMonth,
    stationMonth,
    combMonth,
    velocityMonth,
    append,
  ]);

  const initialRunRef = useRef(false);
  useEffect(() => {
    if (initialRunRef.current) return;
    initialRunRef.current = true;
    void runAll();
  }, [runAll]);

  // Show loading screen to prevent flicker
  if (!appMounted) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="font-mono text-5xl font-medium tracking-widest text-green-400">
          THREE AXIS
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black px-8 pt-8 pb-4 text-zinc-100">
      <div className="w-full space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-4 pb-4">
          <h1 className="font-mono text-5xl font-medium tracking-widest text-green-400">
            THREE AXIS
          </h1>
          <div className="flex items-center gap-4">
            {user ? (
              <button
                onClick={() => router.push("/account")}
                className="border border-transparent bg-black px-2 py-1 font-mono text-zinc-300 transition-all uppercase tracking-[0.3em] hover:border-zinc-600/60 hover:bg-zinc-900"
                style={{ fontSize: '0.65rem' }}
              >
                ACCOUNT
              </button>
            ) : (
              <button
                onClick={() => router.push("/auth/signin")}
                className="border border-transparent bg-black px-2 py-1 font-mono text-zinc-300 transition-all uppercase tracking-[0.3em] hover:border-zinc-600/60 hover:bg-zinc-900"
                style={{ fontSize: '0.65rem' }}
              >
                SIGN IN
              </button>
            )}
            <div className="flex items-center gap-2 text-[0.65rem] uppercase tracking-[0.3em] text-zinc-500">
              <span>PLAN</span>
              <div className="inline-flex overflow-hidden rounded-none border border-zinc-800/40">
                {(["free", "plus", "admin"] as const).map((mode) => {
                  const active = plan === mode;
                  return (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setPlan(mode)}
                      className="px-3 py-1 font-mono tracking-[0.3em] transition-all duration-200 border-l first:border-l-0"
                      style={{
                        fontSize: '0.65rem',
                        backgroundColor: active ? 'rgba(20, 83, 45, 0.4)' : '#000',
                        color: active ? '#86efac' : '#d4d4d8',
                        borderColor: active ? 'rgba(21, 128, 61, 0.5)' : '#27272a',
                      }}
                      onMouseEnter={(e) => {
                        if (!active) {
                          e.currentTarget.style.backgroundColor = '#000';
                          e.currentTarget.style.color = '#22c55e';
                          e.currentTarget.style.borderColor = 'rgba(21,128,61,0.4)';
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (!active) {
                          e.currentTarget.style.backgroundColor = '#000';
                          e.currentTarget.style.color = '#d4d4d8';
                          e.currentTarget.style.borderColor = '#27272a';
                        }
                      }}
                    >
                      {mode === "free" ? "FREE" : mode === "plus" ? "PLUS" : "ADMIN"}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </header>

        <div
          role="tablist"
          aria-label="Three Axis sections"
          className="flex flex-wrap items-center gap-2 border-b border-zinc-800 pb-4"
        >
          {[
            { key: "market" as const, label: "MAIN" },
            { key: "ingress" as const, label: "LIST" },
            { key: "location" as const, label: "LOCATION" },
          ].map((tab) => {
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                role="tab"
                aria-selected={isActive}
                onClick={() => setActiveTab(tab.key)}
                className="px-4 py-2 font-mono uppercase tracking-[0.4em] border transition-colors focus:outline-none focus:ring-1 focus:ring-green-500"
                style={{
                  fontSize: '0.75rem',
                  borderRadius: 0,
                  borderColor: isActive ? '#16a34a' : '#27272a',
                  backgroundColor: isActive ? 'rgba(20, 83, 45, 0.2)' : '#000',
                  color: isActive ? '#4ade80' : '#7f7f83',
                }}
                onMouseEnter={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.borderColor = '#3f3f46';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.borderColor = '#27272a';
                  }
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        <div
          className={cls(activeTab === "market" ? "" : "hidden")}
          style={{ height: "calc(100vh - 220px)" }}
        >
          <JupiterTerminal
            plan={plan}
            tz={tz}
            ingressEvents={ingressEventsForMain}
            combustionEvents={combustionEventsForMain}
            retroEvents={retroEventsForMain}
            velocityEvents={velocityEventsForMain}
            lagnaEvents={lagnaRows}
            moonEvents={moonRows}
            onRangeChange={handleTerminalRangeChange}
          />
        </div>
        <div className={cls(activeTab === "ingress" ? "" : "hidden")}>
          <div className="space-y-6">
            {locationSummaryPane}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Pane
                title={`L (${ascHours}h)`}
                right={
                  <button
                    onClick={() => {
                      if (!isPlus) {
                        showUpgradePrompt('CSV downloads');
                        return;
                      }
                      download(
                        "lagna_sidereal_changes_lahiri.csv",
                        rowsToCSV(
                          ["change_time_local", "from", "to", "degree"],
                          lagnaRows.map((r) => [r.timeISO, r.from, r.to, r.degree]),
                        ),
                      );
                    }}
                    className="rounded-none border border-transparent bg-zinc-900 px-2 py-1 text-xs text-zinc-300 transition-colors focus:outline-none focus:ring-1 focus:ring-green-500 hover:text-green-300"
                  >
                    D
                  </button>
                }
              >
                  <div className="overflow-x-auto">
                    <table className="min-w-full border-collapse text-xs">
                      <thead className="text-zinc-500 uppercase tracking-[0.2em]">
                        <tr>
                          <th className="border-b border-zinc-800 px-2 py-1 text-left">time (local)</th>
                          {isAdmin && (
                            <>
                              <th className="border-b border-zinc-800 px-2 py-1 text-left">from</th>
                              <th className="border-b border-zinc-800 px-2 py-1 text-left">to</th>
                              <th className="border-b border-zinc-800 px-2 py-1 text-left">degree</th>
                            </>
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {lagnaRows.length === 0 ? (
                          <tr>
                            <td colSpan={isAdmin ? 4 : 1} className="px-2 py-4 text-center text-zinc-500">
                              run the scanner to compute ascendant changes
                            </td>
                          </tr>
                        ) : (
                          lagnaRows.map((row, idx) => {
                            const rowTime = lagnaTimes[idx];
                            const prevTime = idx > 0 ? lagnaTimes[idx - 1] : null;
                            const rowValid = rowTime?.isValid;
                            const prevValid = prevTime?.isValid;
                            const isNewDay = rowValid ? idx === 0 || !prevValid || !prevTime?.hasSame(rowTime, "day") : idx === 0;
                            const isActive = rowValid && idx === lagnaHighlightIndex;
                            const topBorderClass = isNewDay ? "border-t border-orange-500" : "border-t border-transparent";
                            const textClass = isActive
                              ? "text-red-200"
                              : row.degree === 15
                                ? "text-amber-200"
                                : "text-zinc-200";
                            const displayTime = rowValid ? rowTime.toFormat(timeFormat) : row.timeISO;
                            return (
                              <tr key={`${row.timeISO}-${idx}`} className={cls(isActive && "bg-red-900/30")}>
                                <td className={cls("border-b border-zinc-900 px-2 py-1", topBorderClass, textClass)}>{displayTime}</td>
                                {isAdmin && (
                                  <>
                                    <td className={cls("border-b border-zinc-900 px-2 py-1", topBorderClass, textClass)}>{row.from}</td>
                                    <td className={cls("border-b border-zinc-900 px-2 py-1", topBorderClass, textClass)}>{row.to}</td>
                                    <td className={cls("border-b border-zinc-900 px-2 py-1", topBorderClass, textClass)}>{row.degree.toFixed(2)}</td>
                                  </>
                                )}
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </Pane>

                <Pane
                  title={`NAK (${ascHours}h)`}
                  right={
                    <button
                      onClick={() => {
                        if (!isPlus) {
                          showUpgradePrompt('CSV downloads');
                          return;
                        }
                        download(
                          "moon_nakshatra_changes_lahiri.csv",
                          rowsToCSV(
                            ["change_time_local", "nakshatra", "pada"],
                            moonRows.map((r, idx) => {
                              const dt = moonTimes[idx];
                              const timeLocal = dt?.isValid ? dt.toFormat(timeFormat) : r.timeISO;
                              return [timeLocal, r.nakshatra, String(r.pada)];
                            }),
                          ),
                        );
                      }}
                      className="rounded-none border border-transparent bg-zinc-900 px-2 py-1 text-xs text-zinc-300 transition-colors focus:outline-none focus:ring-1 focus:ring-green-500 hover:text-green-300"
                    >
                      D
                    </button>
                  }
                >
                  <div className="overflow-x-auto">
                    <table className="min-w-full border-collapse text-xs">
                      <thead className="text-zinc-500 uppercase tracking-[0.2em]">
                        <tr>
                          <th className="border-b border-zinc-800 px-2 py-1 text-left">time (local)</th>
                          {isAdmin ? (
                            <>
                              <th className="border-b border-zinc-800 px-2 py-1 text-left">nakshatra</th>
                              <th className="border-b border-zinc-800 px-2 py-1 text-left">pada</th>
                            </>
                          ) : (
                            <th className="border-b border-zinc-800 px-2 py-1 text-left">P</th>
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {moonRows.length === 0 ? (
                          <tr>
                            <td colSpan={isAdmin ? 3 : 2} className="px-2 py-4 text-center text-zinc-500">
                              run the scanner to compute moon changes
                            </td>
                          </tr>
                        ) : (
                          moonRows.map((row, idx) => {
                            const rowTime = moonTimes[idx];
                            const prevTime = idx > 0 ? moonTimes[idx - 1] : null;
                            const rowValid = rowTime?.isValid;
                            const prevValid = prevTime?.isValid;
                            const isNewDay = rowValid ? idx === 0 || !prevValid || !prevTime?.hasSame(rowTime, "day") : idx === 0;
                            const isActive = rowValid && idx === moonHighlightIndex;
                            const topBorderClass = isNewDay ? "border-t border-orange-500" : "border-t border-transparent";
                            const textClass = isActive ? "text-red-200" : "text-zinc-200";
                            const displayTime = rowValid ? rowTime.toFormat(timeFormat) : row.timeISO;
                            return (
                              <tr key={`${row.timeISO}-${idx}`} className={cls(isActive && "bg-red-900/30")}>
                                <td className={cls("border-b border-zinc-900 px-2 py-1", topBorderClass, textClass)}>{displayTime}</td>
                                {isAdmin ? (
                                  <>
                                    <td className={cls("border-b border-zinc-900 px-2 py-1", topBorderClass, textClass)}>{row.nakshatra}</td>
                                    <td className={cls("border-b border-zinc-900 px-2 py-1", topBorderClass, textClass)}>{row.pada}</td>
                                  </>
                                ) : (
                                  <td className={cls("border-b border-zinc-900 px-2 py-1", topBorderClass, textClass)}>P{row.pada}</td>
                                )}
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </Pane>

                <Pane
                  title="LIST"
                  right={
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          if (!isPlus) {
                            showUpgradePrompt('month navigation');
                            return;
                          }
                          shiftIngressMonth(-1);
                        }}
                        className="rounded-none border border-transparent bg-zinc-900 px-2 py-1 text-xs text-zinc-300 transition-colors focus:outline-none focus:ring-1 focus:ring-green-500 hover:text-green-300"
                        aria-label="Previous month"
                      >
                        &lt;
                      </button>
                      <span className="font-mono text-xs text-zinc-400">{ingressMonthLabel}</span>
                      <button
                        onClick={() => {
                          if (!isPlus) {
                            showUpgradePrompt('month navigation');
                            return;
                          }
                          shiftIngressMonth(1);
                        }}
                        className="rounded-none border border-transparent bg-zinc-900 px-2 py-1 text-xs text-zinc-300 transition-colors focus:outline-none focus:ring-1 focus:ring-green-500 hover:text-green-300"
                        aria-label="Next month"
                      >
                        &gt;
                      </button>
                      <button
                        onClick={() => {
                          if (!isPlus) {
                            showUpgradePrompt('CSV downloads');
                            return;
                          }
                          download(
                            "list_events.csv",
                            rowsToCSV(
                              ["body", "change_time_local", "from", "to"],
                              ingressRowsFiltered.map((row) => [row.body, row.dt?.isValid ? row.dt.toFormat(timeFormat) : row.timeISO, row.from, row.to]),
                            ),
                          );
                        }}
                        className="rounded-none border border-transparent bg-zinc-900 px-2 py-1 text-xs text-zinc-300 transition-colors focus:outline-none focus:ring-1 focus:ring-green-500 hover:text-green-300"
                      >
                        D
                      </button>
                    </div>
                  }
                >
                  <div className="overflow-x-auto">
                    <table className="min-w-full border-collapse text-xs">
                      <thead className="text-zinc-500 uppercase tracking-[0.2em]">
                        <tr>
                          <th className="border-b border-zinc-800 px-2 py-1 text-left">time (local)</th>
                          <th className="border-b border-zinc-800 px-2 py-1 text-left">{isAdmin ? "planet" : "P"}</th>
                          {isAdmin && (
                            <>
                              <th className="border-b border-zinc-800 px-2 py-1 text-left">from</th>
                              <th className="border-b border-zinc-800 px-2 py-1 text-left">to</th>
                            </>
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {ingressRowsFiltered.length === 0 ? (
                          <tr>
                            <td colSpan={isAdmin ? 4 : 2} className="px-2 py-4 text-center text-zinc-500">
                              no list events tracked in {ingressMonthLabel}. adjust the month or location to cover this period.
                            </td>
                          </tr>
                        ) : (
                          ingressRowsFiltered.map((row, idx) => {
                            const displayTime = row.dt?.isValid ? row.dt.toFormat(timeFormat) : row.timeISO;
                            const planetLabel = displayPlanet(row.body, isAdmin);
                            return (
                              <tr key={`${row.body}-${row.timeISO}-${idx}`}>
                                <td className="border-b border-zinc-900 px-2 py-1 text-zinc-200">{displayTime}</td>
                                <td className="border-b border-zinc-900 px-2 py-1 text-zinc-200">{planetLabel}</td>
                                {isAdmin && (
                                  <>
                                    <td className="border-b border-zinc-900 px-2 py-1 text-zinc-200">{row.from}</td>
                                    <td className="border-b border-zinc-900 px-2 py-1 text-zinc-200">{row.to}</td>
                                  </>
                                )}
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </Pane>

                <Pane
                  title="STATIONS"
                  right={
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          if (!isPlus) {
                            showUpgradePrompt('month navigation');
                            return;
                          }
                          shiftStationMonth(-1);
                        }}
                        className="rounded-none border border-transparent bg-zinc-900 px-2 py-1 text-xs text-zinc-300 transition-colors focus:outline-none focus:ring-1 focus:ring-green-500 hover:text-green-300"
                        aria-label="Previous month"
                      >
                        &lt;
                      </button>
                      <span className="font-mono text-xs text-zinc-400">{stationMonthLabel}</span>
                      <button
                        onClick={() => {
                          if (!isPlus) {
                            showUpgradePrompt('month navigation');
                            return;
                          }
                          shiftStationMonth(1);
                        }}
                        className="rounded-none border border-transparent bg-zinc-900 px-2 py-1 text-xs text-zinc-300 transition-colors focus:outline-none focus:ring-1 focus:ring-green-500 hover:text-green-300"
                        aria-label="Next month"
                      >
                        &gt;
                      </button>
                      <button
                        onClick={() => {
                          if (!isPlus) {
                            showUpgradePrompt('CSV downloads');
                            return;
                          }
                          download(
                            "retrograde_windows.csv",
                            rowsToCSV(
                              ["planet", "state", "start_time_local", "end_time_local"],
                              stationRows.map((r) => [r.planet, r.state, r.startISO, r.endISO ?? ""]),
                            ),
                          );
                        }}
                        className="rounded-none border border-transparent bg-zinc-900 px-2 py-1 text-xs text-zinc-300 transition-colors focus:outline-none focus:ring-1 focus:ring-green-500 hover:text-green-300"
                      >
                        D
                      </button>
                    </div>
                  }
                >
                  <div className="overflow-x-auto">
                    <table className="min-w-full border-collapse text-xs">
                      <thead className="text-zinc-500 uppercase tracking-[0.2em]">
                        <tr>
                          <th className="border-b border-zinc-800 px-2 py-1 text-left">start (local)</th>
                          <th className="border-b border-zinc-800 px-2 py-1 text-left">end (local)</th>
                          <th className="border-b border-zinc-800 px-2 py-1 text-left">{isAdmin ? "planet" : "P"}</th>
                          <th className="border-b border-zinc-800 px-2 py-1 text-left">{isAdmin ? "state" : EVENT_DISPLAY_CODES.retro}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stationRowsFiltered.length === 0 ? (
                          <tr>
                            <td colSpan={4} className="px-2 py-4 text-center text-zinc-500">
                              {swissAvailable
                                ? `no stations in {stationMonthLabel}. try a nearby month.`
                                : "stations require Swiss Ephemeris to load"}
                            </td>
                          </tr>
                        ) : (
                          stationRowsFiltered.map((row, idx) => {
                            const startDisplay = row.start?.isValid ? row.start.toFormat(timeFormat) : row.startISO;
                            const endDisplay = row.end?.isValid ? row.end.toFormat(timeFormat) : row.endISO ?? "";
                            return (
                              <tr key={`${row.startISO}-${row.planet}-${idx}`}>
                                <td className="border-b border-zinc-900 px-2 py-1 text-zinc-200">{startDisplay}</td>
                                <td className="border-b border-zinc-900 px-2 py-1 text-zinc-200">{endDisplay}</td>
                                <td className="border-b border-zinc-900 px-2 py-1 text-zinc-200">{displayPlanet(row.planet, isAdmin)}</td>
                                <td className="border-b border-zinc-900 px-2 py-1 text-zinc-200">
                                  {isAdmin ? (row.state === "retrograde" ? "Retrograde" : row.state) : EVENT_DISPLAY_CODES.retro}
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </Pane>

                <Pane
                  title="CB"
                  right={
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          if (!isPlus) {
                            showUpgradePrompt('month navigation');
                            return;
                          }
                          shiftCombMonth(-1);
                        }}
                      className="rounded-none border border-transparent bg-zinc-900 px-2 py-1 text-xs text-zinc-300 transition-colors focus:outline-none focus:ring-1 focus:ring-green-500 hover:text-green-300"
                        aria-label="Previous month"
                      >
                        &lt;
                      </button>
                      <span className="font-mono text-xs text-zinc-400">{combMonthLabel}</span>
                      <button
                        onClick={() => {
                          if (!isPlus) {
                            showUpgradePrompt('month navigation');
                            return;
                          }
                          shiftCombMonth(1);
                        }}
                        className="rounded-none border border-transparent bg-zinc-900 px-2 py-1 text-xs text-zinc-300 transition-colors focus:outline-none focus:ring-1 focus:ring-green-500 hover:text-green-300"
                        aria-label="Next month"
                      >
                        &gt;
                      </button>
                      <button
                        onClick={() => {
                          if (!isPlus) {
                            showUpgradePrompt('CSV downloads');
                            return;
                          }
                          download(
                            "combustion_windows.csv",
                            rowsToCSV(
                              ["start_time_local", "end_time_local", "planet", "min_orb_deg"],
                              combRows.map((r) => [r.startISO, r.endISO ?? "ongoing", r.planet, r.orbDeg.toFixed(2)]),
                            ),
                          );
                        }}
                        className="rounded-none border border-transparent bg-zinc-900 px-2 py-1 text-xs text-zinc-300 transition-colors focus:outline-none focus:ring-1 focus:ring-green-500 hover:text-green-300"
                      >
                        D
                      </button>
                    </div>
                  }
                >
                  <div className="overflow-x-auto">
                    <table className="min-w-full border-collapse text-xs">
                      <thead className="text-zinc-500 uppercase tracking-[0.2em]">
                        <tr>
                          <th className="border-b border-zinc-800 px-2 py-1 text-left">start (local)</th>
                          <th className="border-b border-zinc-800 px-2 py-1 text-left">end (local)</th>
                          <th className="border-b border-zinc-800 px-2 py-1 text-left">{isAdmin ? "planet" : "P"}</th>
                          {isAdmin && <th className="border-b border-zinc-800 px-2 py-1 text-left">min orb (°)</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {combRowsFiltered.length === 0 ? (
                          <tr>
                            <td colSpan={isAdmin ? 4 : 3} className="px-2 py-4 text-center text-zinc-500">
                              {swissAvailable
                                ? `no combustion windows in {combMonthLabel}. try a nearby month.`
                                : "combustion windows require Swiss Ephemeris to load"}
                            </td>
                          </tr>
                        ) : (
                          combRowsFiltered.map((row, idx) => {
                            const startDisplay = row.start?.isValid ? row.start.toFormat(timeFormat) : row.startISO;
                            const endDisplay = row.end?.isValid ? row.end.toFormat(timeFormat) : row.endISO ?? "ongoing";
                            return (
                              <tr key={`${row.startISO}-${row.planet}-${idx}`}>
                                <td className="border-b border-zinc-900 px-2 py-1 text-zinc-200">{startDisplay}</td>
                                <td className="border-b border-zinc-900 px-2 py-1 text-zinc-200">{endDisplay}</td>
                                <td className="border-b border-zinc-900 px-2 py-1 text-zinc-200">{displayPlanet(row.planet, isAdmin)}</td>
                                {isAdmin && (
                                  <td className="border-b border-zinc-900 px-2 py-1 text-zinc-200">{row.orbDeg.toFixed(2)}</td>
                                )}
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </Pane>

                <Pane
                  title="VEL"
                  right={
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          if (!isPlus) {
                            showUpgradePrompt('month navigation');
                            return;
                          }
                          shiftVelocityMonth(-1);
                        }}
                        className="rounded-none border border-transparent bg-zinc-900 px-2 py-1 text-xs text-zinc-300 transition-colors focus:outline-none focus:ring-1 focus:ring-green-500 hover:text-green-300"
                        aria-label="Previous month"
                      >
                        &lt;
                      </button>
                      <span className="font-mono text-xs text-zinc-400">{velocityMonthLabel}</span>
                      <button
                        onClick={() => {
                          if (!isPlus) {
                            showUpgradePrompt('month navigation');
                            return;
                          }
                          shiftVelocityMonth(1);
                        }}
                        className="rounded-none border border-transparent bg-zinc-900 px-2 py-1 text-xs text-zinc-300 transition-colors focus:outline-none focus:ring-1 focus:ring-green-500 hover:text-green-300"
                        aria-label="Next month"
                      >
                        &gt;
                      </button>
                      <button
                        onClick={() => {
                          if (!isPlus) {
                            showUpgradePrompt('CSV downloads');
                            return;
                          }
                          download(
                            "velocity_extrema.csv",
                            rowsToCSV(
                              ["time_local", "planet", "kind", "speed_deg_per_day"],
                              velocityRowsFiltered.map((row) => {
                                const displayTime = row.dt?.isValid ? row.dt.toFormat(timeFormat) : row.timeISO;
                                return [displayTime, row.planet, row.kind, row.speed.toFixed(6)];
                              }),
                            ),
                          );
                        }}
                        className="rounded-none border border-transparent bg-zinc-900 px-2 py-1 text-xs text-zinc-300 transition-colors focus:outline-none focus:ring-1 focus:ring-green-500 hover:text-green-300"
                      >
                        D
                      </button>
                    </div>
                  }
                >
                  <div className="overflow-x-auto">
                    <table className="min-w-full border-collapse text-xs">
                      <thead className="text-zinc-500 uppercase tracking-[0.2em]">
                        <tr>
                          <th className="border-b border-zinc-800 px-2 py-1 text-left">time (local)</th>
                          <th className="border-b border-zinc-800 px-2 py-1 text-left">{isAdmin ? "planet" : "P"}</th>
                          <th className="border-b border-zinc-800 px-2 py-1 text-left">{isAdmin ? "event" : "V"}</th>
                          {isAdmin && <th className="border-b border-zinc-800 px-2 py-1 text-left">speed (°/d)</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {velocityRowsFiltered.length === 0 ? (
                          <tr>
                            <td colSpan={isAdmin ? 4 : 3} className="px-2 py-4 text-center text-zinc-500">
                              velocity extrema need Swiss monthly data for this location/month
                            </td>
                          </tr>
                        ) : (
                          velocityRowsFiltered.map((row, idx) => {
                            const dt = row.dt;
                            const prev = idx > 0 ? velocityRowsFiltered[idx - 1].dt : null;
                            const rowValid = dt?.isValid;
                            const prevValid = prev?.isValid ?? false;
                            const isNewDay = rowValid ? idx === 0 || !prevValid || !prev?.hasSame(dt, "day") : idx === 0;
                            const isActive = rowValid && idx === velocityHighlightIndex;
                            const topBorderClass = isNewDay ? "border-t border-orange-500" : "border-t border-transparent";
                            const tone =
                              row.kind === "max"
                                ? "text-emerald-200"
                                : row.kind === "min"
                                  ? "text-sky-200"
                                  : "text-zinc-200";
                            const textClass = isActive ? "text-red-200" : tone;
                            const displayTime = rowValid ? dt.toFormat(timeFormat) : row.timeISO;
                            return (
                              <tr key={`${row.planet}-${row.kind}-${row.timeISO}-${idx}`} className={cls(isActive && "bg-red-900/30")}>
                                <td className={cls("border-b border-zinc-900 px-2 py-1", topBorderClass, textClass)}>{displayTime}</td>
                                <td className={cls("border-b border-zinc-900 px-2 py-1", topBorderClass, textClass)}>{displayPlanet(row.planet, isAdmin)}</td>
                                <td className={cls("border-b border-zinc-900 px-2 py-1", topBorderClass, textClass)}>
                                  {isPlus
                                    ? `Velocity ${row.kind === "max" ? "Maximum" : "Minimum"}`
                                    : `${EVENT_DISPLAY_CODES.velocity}${row.kind === "max" ? "↑" : row.kind === "min" ? "↓" : ""}`}
                                </td>
                                {isAdmin && (
                                  <td className={cls("border-b border-zinc-900 px-2 py-1", topBorderClass, textClass)}>{row.speed.toFixed(6)}</td>
                                )}
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </Pane>
              </div>
          </div>
        </div>

        <div className={cls(activeTab === "location" ? "" : "hidden")}>
          <div className="space-y-6">
            {locationPane}
            {plan === 'admin' && (
              <Pane title="LOG">
                <div
                  ref={logRef}
                  className="h-48 overflow-y-auto rounded-none border border-zinc-900 bg-black/60 px-3 py-2 text-xs text-zinc-300 space-y-1"
                >
                  {log.length === 0 ? (
                    <div className="text-zinc-500">log output will appear here</div>
                  ) : (
                    log.map((line, idx) => (
                      <div key={`${idx}-${line}`} className="whitespace-pre-wrap break-words">
                        {line}
                      </div>
                    ))
                  )}
                </div>
              </Pane>
            )}
          </div>
        </div>

      {/* Upgrade Modal */}
      {showUpgradeModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90"
          onClick={() => setShowUpgradeModal(false)}
        >
          <div
            className="w-full max-w-md border border-zinc-800 bg-black p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-4 font-mono text-sm tracking-wide uppercase text-green-400">
              Upgrade Required
            </h2>
            <p className="mb-6 font-mono text-[10px] text-zinc-500">
              {upgradeFeature} requires premium access.
            </p>
            <div className="mb-6 space-y-2 font-mono text-[10px] text-zinc-600">
              <p className="text-zinc-400 uppercase tracking-wide">Premium Features</p>
              <ul className="list-inside list-disc space-y-1 pl-1">
                <li>Advanced data events</li>
                <li>Real-time market data</li>
                <li>Download all data as CSV</li>
                <li>Navigate to any month</li>
                <li>Custom indicators</li>
                <li>Priority support</li>
              </ul>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowUpgradeModal(false);
                  router.push('/account');
                }}
                className="flex-1 bg-green-600 border border-green-600 px-4 py-2 font-mono text-[10px] uppercase tracking-wide text-black transition-colors hover:bg-green-700"
              >
                Upgrade
              </button>
              <button
                onClick={() => setShowUpgradeModal(false)}
                className="flex-1 border border-zinc-800 bg-black px-4 py-2 font-mono text-[10px] uppercase tracking-wide text-zinc-400 transition-colors hover:bg-zinc-900"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  </div>
  );
}
