import type { ReactNode } from "react";
import { AppHeader } from "@/components/app-header";
import { AppSidebar } from "@/components/app-sidebar";
import { SettingsModalHost } from "@/components/settings-modal-host";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "../(auth)/auth-provider";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <TooltipProvider delay={200}>
        <div className="fixed inset-0 flex w-full overflow-hidden bg-[#f5f5f6] p-1.5 sm:p-2">
          <AppSidebar />
          <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-black/[0.07] bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
            <AppHeader />
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              {children}
            </div>
          </section>
        </div>
        <SettingsModalHost />
      </TooltipProvider>
    </AuthProvider>
  );
}
