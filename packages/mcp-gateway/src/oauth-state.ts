import { getRedis } from "./redis/client";

interface OAuthState {
  userId: string;
  connectionId: string;
}

const keyFor = (state: string) => `mcp:oauth:state:${state}`;

export const saveOAuthState = async (state: string, value: OAuthState) => {
  await getRedis().set(keyFor(state), JSON.stringify(value), "EX", 10 * 60);
};

export const deleteOAuthState = async (state: string) => {
  await getRedis().del(keyFor(state));
};

export const consumeOAuthState = async (
  state: string,
): Promise<OAuthState | null> => {
  const value = await getRedis().getdel(keyFor(state));

  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as OAuthState;
  } catch {
    return null;
  }
};
