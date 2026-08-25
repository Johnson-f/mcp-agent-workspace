export async function createGreeting(name: string): Promise<string> {
  return `Hello, ${name}! This greeting came from a Temporal Activity.`;
}

export * from "./bridge/activities";
