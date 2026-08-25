const fiveFieldCron = /^([0-9*/,-]+\s+){4}[0-9*/,-]+$/;

const clockToCron = (value: string, weekdaysOnly: boolean) => {
	const match = value.match(
		/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i,
	);
	if (!match) return null;

	const minute = Number(match[2] ?? "0");
	let hour = Number(match[1]);
	const meridiem = match[3]?.toLowerCase();
	if (minute > 59 || hour > (meridiem ? 12 : 23) || hour < 0) return null;
	if (meridiem === "am" && hour === 12) hour = 0;
	if (meridiem === "pm" && hour !== 12) hour += 12;

	return `${minute} ${hour} * * ${weekdaysOnly ? "1-5" : "*"}`;
};

export const normalizeRecurringScheduleRule = (rule: string | null) => {
	const trimmed = rule?.trim();
	if (!trimmed) return null;
	if (fiveFieldCron.test(trimmed)) return trimmed.replace(/\s+/g, " ");

	const natural = trimmed.match(
		/^(daily|every day|weekdays|every weekday)\s+at\s+(.+)$/i,
	);
	if (!natural) return null;

	return clockToCron(
		natural[2],
		/^weekdays$|^every weekday$/i.test(natural[1]),
	);
};
