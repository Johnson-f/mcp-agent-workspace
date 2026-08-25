"use client";

import type { McpConnection } from "@agents/contracts";
import { Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface DeleteConnectionDialogProps {
  connection: McpConnection | null;
  busyId: string | null;
  onOpenChange: (open: boolean) => void;
  onDelete: (connectionId: string) => void;
}

export function DeleteConnectionDialog({
  connection,
  busyId,
  onOpenChange,
  onDelete,
}: DeleteConnectionDialogProps) {
  return (
    <AlertDialog onOpenChange={onOpenChange} open={connection !== null}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia className="bg-destructive/10 text-destructive">
            <Trash2 />
          </AlertDialogMedia>
          <AlertDialogTitle>Delete this connection?</AlertDialogTitle>
          <AlertDialogDescription>
            {connection
              ? `${connection.name} and its stored credentials will be removed. This cannot be undone.`
              : "This connection and its stored credentials will be removed."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep connection</AlertDialogCancel>
          <AlertDialogAction
            disabled={connection ? busyId === connection.id : false}
            onClick={() => {
              if (connection) {
                onDelete(connection.id);
              }
            }}
            variant="destructive"
          >
            Delete connection
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
