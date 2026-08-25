import { users } from "./schema";
import { getDatabase } from "./client";

export interface AuthenticatedUserIdentity {
  userId: string;
}

export class DisabledUserError extends Error {
  constructor() {
    super("This user has been disabled.");
    this.name = "DisabledUserError";
  }
}

export const upsertAuthenticatedUser = async (
  identity: AuthenticatedUserIdentity,
) => {
  const now = new Date();
  const [user] = await getDatabase()
    .insert(users)
    .values({
      stytchUserId: identity.userId,
      lastSeenAt: now,
    })
    .onConflictDoUpdate({
      target: users.stytchUserId,
      set: {
        lastSeenAt: now,
        updatedAt: now,
      },
    })
    .returning({
      id: users.id,
      stytchUserId: users.stytchUserId,
      primaryEmail: users.primaryEmail,
      displayName: users.displayName,
      avatarUrl: users.avatarUrl,
      status: users.status,
    });

  if (!user) {
    throw new Error("The authenticated user could not be persisted.");
  }

  if (user.status === "disabled") {
    throw new DisabledUserError();
  }

  return user;
};
