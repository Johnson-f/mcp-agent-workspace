"use client";

import { resolveConversationModeForMessage } from "@agents/contracts";
import { LoaderCircle, SendHorizontal, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import { ConversationModeSelect } from "@/components/conversation-mode-select";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useConversationMode } from "@/hooks/use-conversation-mode";
import {
  pendingConversationMessageKey,
  pendingConversationModeKey,
} from "@/hooks/use-conversation-websocket";
import { isDevAuthEnabled, useAuthSession } from "@/lib/auth-session";
import { shouldSubmitComposerKey } from "@/lib/composer-keyboard";
import { agentsRpc } from "@/lib/rpc";

export function NewAutomationClient() {
  const router = useRouter();
  const { isInitialized, session } = useAuthSession();
  const [goal, setGoal] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { mode, setMode } = useConversationMode();

  useEffect(() => {
    if (isInitialized && !session && !isDevAuthEnabled()) {
      router.replace("/login");
    }
  }, [isInitialized, router, session]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setCreating(true);
    setError(null);
    try {
      const content = goal.trim();
      const effectiveMode = resolveConversationModeForMessage(mode, content);
      setMode(effectiveMode);
      const result = await agentsRpc.createConversation({});
      sessionStorage.setItem(
        pendingConversationMessageKey(result.conversation.id),
        content,
      );
      sessionStorage.setItem(
        pendingConversationModeKey(result.conversation.id),
        effectiveMode,
      );
      router.push(`/conversations/${result.conversation.id}`);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "The Automation Conversation could not be created.",
      );
    } finally {
      setCreating(false);
    }
  };

  return (
    <main className="flex min-h-full w-full bg-white">
      <form
        className="mx-auto flex w-full max-w-3xl flex-col justify-center px-4 py-12 sm:px-6 lg:pb-32"
        onSubmit={submit}
      >
        <div className="mb-5 flex items-center justify-center gap-3 text-center">
          <Sparkles className="size-7 text-[#d97757]" strokeWidth={1.6} />
          <h1 className="text-2xl font-medium tracking-[-0.035em] text-[#2c2b29] sm:text-[2rem]">
            How can I help?
          </h1>
        </div>
        {error ? (
          <p className="mb-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        ) : null}
        <div className="overflow-hidden rounded-[20px] border border-black/[0.09] bg-[#fefefd] shadow-[0_4px_18px_rgba(24,24,22,0.055)] transition-[border-color,box-shadow] duration-150 focus-within:border-[#d97757]/35 focus-within:shadow-[0_7px_24px_rgba(24,24,22,0.08)]">
          <Label className="sr-only" htmlFor="automation-goal">
            Message the AI
          </Label>
          <Textarea
            className="min-h-[76px] resize-none rounded-none border-0 bg-transparent px-5 pb-2 pt-4 text-[15px] leading-6 shadow-none focus-visible:ring-0"
            id="automation-goal"
            onChange={(event) => setGoal(event.target.value)}
            onKeyDown={(event) => {
              if (
                shouldSubmitComposerKey({
                  key: event.key,
                  shiftKey: event.shiftKey,
                  isComposing: event.nativeEvent.isComposing,
                })
              ) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            placeholder="Message the AI..."
            required
            value={goal}
          />
          <div className="flex min-h-11 items-center px-3 pb-2.5">
            <ConversationModeSelect
              disabled={creating}
              onValueChange={setMode}
              value={mode}
            />
            <Button
              className="ml-auto size-9 rounded-full bg-[#202123] p-0 text-white shadow-[0_1px_2px_rgba(0,0,0,0.16)] hover:bg-black"
              disabled={creating || !goal.trim()}
              type="submit"
            >
              {creating ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <SendHorizontal />
              )}
              <span className="sr-only">Start conversation</span>
            </Button>
          </div>
        </div>
      </form>
    </main>
  );
}
