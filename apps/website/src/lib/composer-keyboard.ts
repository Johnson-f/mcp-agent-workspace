export const shouldSubmitComposerKey = (input: {
  key: string;
  shiftKey: boolean;
  isComposing: boolean;
}) => input.key === "Enter" && !input.shiftKey && !input.isComposing;
