"use client";
import { ApiProvider } from "@tp/client/react";
import type { ReactNode } from "react";
import { api } from "@/lib/api";
import { StaffProvider } from "@/lib/me";

export function Providers({ children }: { children: ReactNode }) {
  return <ApiProvider api={api}><StaffProvider>{children}</StaffProvider></ApiProvider>;
}
