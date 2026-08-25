import type { McpApprovalMode } from "@agents/contracts";

const sensitiveKey =
	/(authorization|cookie|credential|password|passwd|secret|token|api[-_]?key|private[-_]?key|session)/i;

const canonicalize = (value: unknown): string => {
	if (Array.isArray(value)) {
		return `[${value.map(canonicalize).join(",")}]`;
	}

	if (value && typeof value === "object") {
		return `{${Object.entries(value)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, child]) => `${JSON.stringify(key)}:${canonicalize(child)}`)
			.join(",")}}`;
	}

	return JSON.stringify(value) ?? "null";
};

export const hashToolArguments = async (argumentsValue: Record<string, unknown>) => {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(canonicalize(argumentsValue)),
	);
	return Buffer.from(digest).toString("hex");
};

const redactValue = (value: unknown, key?: string): unknown => {
	if (key && sensitiveKey.test(key)) {
		return "[REDACTED]";
	}
	if (value === null) {
		return null;
	}
	if (Array.isArray(value)) {
		return value.map((child) => redactValue(child));
	}
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value).map(([childKey, child]) => [
				childKey,
				redactValue(child, childKey),
			]),
		);
	}
	if (typeof value === "string") {
		return `[string:${value.length}]`;
	}
	if (typeof value === "number") {
		return "[number]";
	}
	if (typeof value === "boolean") {
		return "[boolean]";
	}
	return `[${typeof value}]`;
};

export const redactToolArguments = (argumentsValue: Record<string, unknown>) =>
	redactValue(argumentsValue) as Record<string, unknown>;

export const toolCallNeedsApproval = (
	approvalMode: McpApprovalMode,
	annotations: Record<string, unknown> | null,
) => {
	if (approvalMode === "always") {
		return true;
	}
	if (approvalMode === "never") {
		return false;
	}

	return !(
		annotations?.readOnlyHint === true &&
		annotations.destructiveHint !== true
	);
};

export const summarizeToolResult = (result: {
	isError?: boolean;
	content?: readonly { type?: unknown }[];
	structuredContent?: unknown;
}) => ({
	isError: result.isError === true,
	contentTypes: (result.content ?? []).reduce<Record<string, number>>(
		(counts, item) => {
			const type = typeof item.type === "string" ? item.type : "unknown";
			counts[type] = (counts[type] ?? 0) + 1;
			return counts;
		},
		{},
	),
	structuredContentPresent: result.structuredContent !== undefined,
});
