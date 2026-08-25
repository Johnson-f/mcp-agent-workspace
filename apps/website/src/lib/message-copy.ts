export type MessageCopyStatus = "copied" | "failed";

export const copyMessageText = async (
  content: string,
  writeText: (text: string) => Promise<void>,
): Promise<MessageCopyStatus> => {
  try {
    await writeText(content);
    return "copied";
  } catch {
    return "failed";
  }
};
