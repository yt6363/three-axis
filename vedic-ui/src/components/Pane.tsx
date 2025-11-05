"use client";

import type { ReactNode } from "react";

export type PaneProps = {
  title: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
};

export function Pane({ title, right, children, className }: PaneProps) {
  return (
    <div
      className={`bg-black ${className ?? ""}`}
    >
      <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-2">
        <div className="text-zinc-400 font-mono text-xs tracking-wide uppercase">
          {title}
        </div>
        <div>{right}</div>
      </div>
      <div className="p-4 text-zinc-100 font-mono text-xs">{children}</div>
    </div>
  );
}
