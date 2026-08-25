"use client";

import { Dialog } from "@base-ui/react/dialog";
import { Settings, X } from "lucide-react";
import { useEffect, useState } from "react";
import { SettingsClient } from "@/app/(app)/settings/settings-client";
import { SETTINGS_MODAL_OPEN_EVENT } from "@/lib/settings-modal";

export function SettingsModalHost() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const showSettings = () => setOpen(true);
    window.addEventListener(SETTINGS_MODAL_OPEN_EVENT, showSettings);
    return () =>
      window.removeEventListener(SETTINGS_MODAL_OPEN_EVENT, showSettings);
  }, []);

  return (
    <Dialog.Root onOpenChange={setOpen} open={open}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/25 backdrop-blur-[2px] transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <Dialog.Popup className="fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100svh-2rem)] w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-black/[0.1] bg-[#fbfbfa] text-[#302f2c] outline-none transition duration-150 data-ending-style:scale-[0.98] data-ending-style:opacity-0 data-starting-style:scale-[0.98] data-starting-style:opacity-0">
          <header className="flex items-start gap-3 border-b border-black/[0.07] px-5 py-4 sm:px-6">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#efefec] text-[#55534e]">
              <Settings className="size-4.5" />
            </span>
            <div className="min-w-0 flex-1">
              <Dialog.Title className="text-base font-semibold text-[#2c2b29]">
                Settings
              </Dialog.Title>
              <Dialog.Description className="mt-0.5 text-xs leading-5 text-[#77756f]">
                Configure how Agents works in this workspace.
              </Dialog.Description>
            </div>
            <Dialog.Close
              aria-label="Close settings"
              className="flex size-8 shrink-0 items-center justify-center rounded-lg text-[#77756f] transition-colors hover:bg-black/[0.05] hover:text-[#2c2b29] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5b63f6]/30"
            >
              <X className="size-4" />
            </Dialog.Close>
          </header>
          <div className="min-h-0 overflow-y-auto px-5 py-5 sm:px-6 sm:py-6">
            <SettingsClient embedded />
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
