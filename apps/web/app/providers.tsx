"use client";
import { ApiProvider } from "@tp/client/react";
import type { ReactNode } from "react";
import { api } from "@/lib/api";
import { MeProvider } from "@/lib/me";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ApiProvider api={api}>
      <MeProvider>{children}</MeProvider>
    </ApiProvider>
  );
}
