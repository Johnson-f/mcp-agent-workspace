"use client";

import { LoaderCircle, Plus } from "lucide-react";
import type { FormEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { authTypeLabel, type ConnectionAuthType } from "./connection-utils";

interface ConnectServerFormProps {
  name: string;
  endpointUrl: string;
  authType: ConnectionAuthType;
  bearerToken: string;
  customHeaders: string;
  saving: boolean;
  embedded?: boolean;
  onNameChange: (value: string) => void;
  onEndpointUrlChange: (value: string) => void;
  onAuthTypeChange: (value: ConnectionAuthType) => void;
  onBearerTokenChange: (value: string) => void;
  onCustomHeadersChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

export function ConnectServerForm({
  name,
  endpointUrl,
  authType,
  bearerToken,
  customHeaders,
  saving,
  embedded = false,
  onNameChange,
  onEndpointUrlChange,
  onAuthTypeChange,
  onBearerTokenChange,
  onCustomHeadersChange,
  onSubmit,
}: ConnectServerFormProps) {
  return (
    <section
      className={cn(
        embedded
          ? ""
          : "mt-6 scroll-mt-16 rounded-xl border border-black/[0.07] bg-[#fafafa] p-4",
      )}
      id={embedded ? undefined : "connect-server"}
    >
      {!embedded ? (
        <div className="border-b border-black/[0.05] pb-3">
          <div className="flex items-start gap-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-black/[0.06] bg-white text-[#5f6168]">
              <Plus className="size-3.5" />
            </span>
            <div>
              <h2 className="text-sm font-semibold text-[#202123]">
                Connect a server
              </h2>
              <p className="mt-0.5 text-xs text-[#74767e]">
                Add an MCP endpoint, then review its tools.
              </p>
            </div>
          </div>
        </div>
      ) : null}
      <div className={cn(!embedded && "pt-4")}>
        <form className="grid gap-3.5 sm:grid-cols-2" onSubmit={onSubmit}>
          <div className="grid gap-2">
            <Label htmlFor="connection-name">Connection name</Label>
            <Input
              className="h-9 rounded-lg border-black/[0.08] bg-white px-3"
              id="connection-name"
              maxLength={80}
              onChange={(event) => onNameChange(event.target.value)}
              placeholder="Research server"
              required
              value={name}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="authentication">Authentication</Label>
            <Select
              onValueChange={(value) =>
                onAuthTypeChange(value as ConnectionAuthType)
              }
              value={authType}
            >
              <SelectTrigger
                className="h-9 w-full rounded-lg border-black/[0.08] bg-white px-3"
                id="authentication"
              >
                <SelectValue>{authTypeLabel(authType)}</SelectValue>
              </SelectTrigger>
              <SelectContent align="start">
                <SelectItem value="auto">Automatic</SelectItem>
                <SelectItem value="none">No authentication</SelectItem>
                <SelectItem value="bearer">Bearer token</SelectItem>
                <SelectItem value="oauth2">OAuth</SelectItem>
                <SelectItem value="custom_headers">Custom headers</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2 sm:col-span-2">
            <Label htmlFor="mcp-endpoint">MCP endpoint</Label>
            <Input
              className="h-9 rounded-lg border-black/[0.08] bg-white px-3 font-mono text-xs"
              id="mcp-endpoint"
              onChange={(event) => onEndpointUrlChange(event.target.value)}
              placeholder="https://example.com/mcp"
              required
              type="url"
              value={endpointUrl}
            />
          </div>
          {authType === "bearer" ? (
            <div className="grid gap-2 sm:col-span-2">
              <Label htmlFor="bearer-token">Bearer token</Label>
              <Input
                autoComplete="off"
                className="h-9 rounded-lg border-black/[0.08] bg-white px-3 font-mono text-xs"
                id="bearer-token"
                onChange={(event) => onBearerTokenChange(event.target.value)}
                required
                type="password"
                value={bearerToken}
              />
            </div>
          ) : null}
          {authType === "custom_headers" ? (
            <div className="grid gap-2 sm:col-span-2">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="custom-headers">Custom headers</Label>
                <Badge className="h-6 px-2" variant="outline">
                  JSON
                </Badge>
              </div>
              <Textarea
                className="min-h-28 resize-y rounded-lg border-black/[0.08] bg-white p-3 font-mono text-xs leading-5"
                id="custom-headers"
                onChange={(event) => onCustomHeadersChange(event.target.value)}
                required
                spellCheck={false}
                value={customHeaders}
              />
            </div>
          ) : null}
          <div className="flex items-center justify-between gap-4 sm:col-span-2">
            <p className="hidden text-xs text-muted-foreground sm:block">
              Credentials are encrypted before storage.
            </p>
            <Button
              className="h-8 w-full rounded-lg bg-[#202125] px-3 text-xs text-white shadow-sm hover:bg-black sm:ml-auto sm:w-auto"
              disabled={saving}
              type="submit"
            >
              {saving ? <LoaderCircle className="animate-spin" /> : <Plus />}
              Connect server
            </Button>
          </div>
        </form>
      </div>
    </section>
  );
}
