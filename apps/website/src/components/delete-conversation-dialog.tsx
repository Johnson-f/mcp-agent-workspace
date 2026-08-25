"use client";

import type { ConversationSummary } from "@agents/contracts";
import { Dialog } from "@base-ui/react/dialog";
import { AlertTriangle, LoaderCircle, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function DeleteConversationDialog({
  conversation,
  onOpenChange,
  onDelete,
}: {
  conversation: ConversationSummary | null;
  onOpenChange: (open: boolean) => void;
  onDelete: (
    conversation: ConversationSummary,
    confirmationTitle: string,
  ) => Promise<void>;
}) {
  const [confirmation, setConfirmation] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (conversation) {
      setConfirmation("");
      setError(null);
    }
  }, [conversation]);

  if (!conversation) return null;
  const linked = conversation.automationId !== null;

  return (
    <Dialog.Root onOpenChange={onOpenChange} open>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-[70] bg-black/25 backdrop-blur-[2px]" />
        <Dialog.Popup className="fixed left-1/2 top-1/2 z-[70] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-black/[0.1] bg-white p-5 outline-none sm:p-6">
          <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-600">
              <AlertTriangle className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <Dialog.Title className="font-semibold text-[#2c2b29]">
                {linked
                  ? "Conversation belongs to an Automation"
                  : "Delete conversation permanently?"}
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-sm leading-6 text-[#74716b]">
                {linked
                  ? "Archive this conversation instead, or manage its linked Automation first."
                  : "Messages, reasoning activity, and Run Brief configuration will be permanently removed. Durable Run records are preserved."}
              </Dialog.Description>
            </div>
            <Dialog.Close
              aria-label="Close delete conversation"
              className="flex size-8 items-center justify-center rounded-lg text-[#77756f] hover:bg-black/[0.05]"
            >
              <X className="size-4" />
            </Dialog.Close>
          </div>
          {linked ? (
            <div className="mt-5 flex justify-end gap-2">
              <Button
                render={
                  <Link href={`/automations/${conversation.automationId}`} />
                }
                nativeButton={false}
              >
                Open Automation
              </Button>
            </div>
          ) : (
            <>
              <p className="mt-5 text-xs text-[#77756f]">
                Enter{" "}
                <span className="font-semibold text-[#34332f]">
                  {conversation.title}
                </span>{" "}
                to confirm.
              </p>
              <Input
                className="mt-2"
                onChange={(event) => setConfirmation(event.target.value)}
                value={confirmation}
              />
              {error ? (
                <p className="mt-3 text-xs text-red-600">{error}</p>
              ) : null}
              <div className="mt-5 flex justify-end gap-2">
                <Dialog.Close render={<Button variant="outline" />}>
                  Cancel
                </Dialog.Close>
                <Button
                  className="bg-red-600 text-white hover:bg-red-700"
                  disabled={confirmation !== conversation.title || deleting}
                  onClick={async () => {
                    setDeleting(true);
                    setError(null);
                    try {
                      await onDelete(conversation, confirmation);
                      onOpenChange(false);
                    } catch (requestError) {
                      setError(
                        requestError instanceof Error
                          ? requestError.message
                          : "Conversation could not be deleted.",
                      );
                    } finally {
                      setDeleting(false);
                    }
                  }}
                  type="button"
                >
                  {deleting ? (
                    <LoaderCircle className="animate-spin" />
                  ) : (
                    <Trash2 />
                  )}
                  Delete permanently
                </Button>
              </div>
            </>
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
