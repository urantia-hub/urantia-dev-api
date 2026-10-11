// The notices of UrantiaHub: the reader's settings, the devices, and the log of what was sent.
// The API only stores them. UrantiaHub decides what to send and sends it.

export const NOTICE_KINDS = ["daily", "reminder", "releases"] as const;
export type NoticeKind = (typeof NOTICE_KINDS)[number];
export const NOTICE_CHANNELS = ["email", "push"] as const;
export type NoticeChannel = (typeof NOTICE_CHANNELS)[number];

// The settings are one value in the reader's preferences, beside the place and the reader settings.
export const NOTICES_KEY = "hub.notices";
const PLACE_KEY = "hub.place";
export const DEFAULT_HOUR = 7;
export const MAX_DEVICES = 10;
const MAX_CLAIMS = 500;

export type NoticeSettings = {
	email: Record<NoticeKind, boolean>;
	// The local hour of the daily passage, 0 to 23.
	hour: number;
	// An IANA time zone name.
	zone: string;
	// The first sign-in question was answered or closed.
	asked: boolean;
	at: number;
};

const isKind = (value: unknown): value is NoticeKind =>
	typeof value === "string" && (NOTICE_KINDS as readonly string[]).includes(value);
const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);
const isHour = (value: unknown): value is number =>
	typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 23;

export function validZone(zone: unknown): zone is string {
	if (typeof zone !== "string" || zone === "" || zone.length > 64) return false;
	try {
		new Intl.DateTimeFormat("en-US", { timeZone: zone });
		return true;
	} catch {
		return false;
	}
}

// What is stored, with the known fields only. Null when it is not there or not of the right form.
export function parseSettings(value: unknown): NoticeSettings | null {
	if (!isRecord(value) || !isRecord(value.email)) return null;
	const email = value.email;
	return {
		email: {
			daily: email.daily === true,
			reminder: email.reminder === true,
			releases: email.releases === true,
		},
		hour: isHour(value.hour) ? value.hour : DEFAULT_HOUR,
		zone: validZone(value.zone) ? value.zone : "UTC",
		asked: value.asked === true,
		at: typeof value.at === "number" ? value.at : 0,
	};
}

// The settings after a change. The change names only the fields that it changes.
// Null when a field of the change is not valid: nothing is saved then.
export function mergeSettings(
	stored: NoticeSettings | null,
	patch: unknown,
	now: number,
): NoticeSettings | null {
	if (!isRecord(patch)) return null;
	const next: NoticeSettings = stored
		? { ...stored, email: { ...stored.email } }
		: {
				email: { daily: false, reminder: false, releases: false },
				hour: DEFAULT_HOUR,
				zone: "UTC",
				asked: false,
				at: now,
			};
	if (patch.email !== undefined) {
		if (!isRecord(patch.email)) return null;
		for (const [kind, on] of Object.entries(patch.email)) {
			if (!isKind(kind) || typeof on !== "boolean") return null;
			next.email[kind] = on;
		}
	}
	if (patch.hour !== undefined) {
		if (!isHour(patch.hour)) return null;
		next.hour = patch.hour;
	}
	if (patch.zone !== undefined) {
		if (!validZone(patch.zone)) return null;
		next.zone = patch.zone;
	}
	// The question shows one time. Nothing turns it back on.
	if (patch.asked === true) next.asked = true;
	next.at = now;
	return next;
}

export type Device = {
	endpoint: string;
	p256dh: string;
	auth: string;
	kinds: NoticeKind[];
	label: string;
};

// The push services of the browsers. The Hub's server calls the address of a device, so only an
// address of one of these hosts is stored.
const PUSH_HOSTS = [
	/^fcm\.googleapis\.com$/,
	/^([a-z0-9-]+\.)*push\.apple\.com$/,
	/^updates\.push\.services\.mozilla\.com$/,
	/^([a-z0-9-]+\.)*notify\.windows\.com$/,
];
const KEY_TEXT = /^[A-Za-z0-9_-]{8,200}={0,2}$/;

// Only the characters of a plain address. A backslash, a space, an "@", or a control character can
// make two programs read one address in two ways.
const PLAIN_ADDRESS = /^[A-Za-z0-9\-._~:/?&=%+!$'()*,;]+$/;

// The address in the one form that the parser gives, or null. Store and call that form only.
export function pushEndpoint(value: unknown): string | null {
	if (typeof value !== "string" || value.length > 1000 || !PLAIN_ADDRESS.test(value)) return null;
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return null;
	}
	if (url.protocol !== "https:" || url.port !== "" || url.username || url.password || url.hash)
		return null;
	return PUSH_HOSTS.some((host) => host.test(url.hostname)) ? url.href : null;
}

export function parseDevice(value: unknown): Device | null {
	if (!isRecord(value)) return null;
	const endpoint = pushEndpoint(value.endpoint);
	if (!endpoint) return null;
	if (typeof value.p256dh !== "string" || !KEY_TEXT.test(value.p256dh)) return null;
	if (typeof value.auth !== "string" || !KEY_TEXT.test(value.auth)) return null;
	if (!Array.isArray(value.kinds) || !value.kinds.every(isKind)) return null;
	const label = value.label ?? "";
	if (typeof label !== "string" || label.length > 60) return null;
	return {
		endpoint,
		p256dh: value.p256dh,
		auth: value.auth,
		kinds: [...new Set(value.kinds)],
		label,
	};
}

export type Claim = { userId: string; kind: NoticeKind; key: string; channel: NoticeChannel };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseClaim(value: unknown): Claim | null {
	if (!isRecord(value)) return null;
	const { userId, kind, key, channel } = value;
	if (typeof userId !== "string" || !UUID.test(userId) || !isKind(kind)) return null;
	if (typeof key !== "string" || key === "" || key.length > 80) return null;
	if (channel !== "email" && channel !== "push") return null;
	return { userId, kind, key, channel };
}

// A list of claims from the Hub. One claim that is not valid refuses the whole list.
export function parseClaims(value: unknown): Claim[] | null {
	const list = isRecord(value) ? value.claims : null;
	if (!Array.isArray(list) || list.length === 0 || list.length > MAX_CLAIMS) return null;
	const claims = list.map(parseClaim);
	return claims.every((claim): claim is Claim => claim !== null) ? claims : null;
}

export type ReaderRow = {
	userId: string;
	email: string | null;
	preferences: Record<string, unknown>;
	devices: Array<{ endpoint: string; p256dh: string; auth: string; kinds: string[] }>;
};
export type DueReader = {
	userId: string;
	email: string | null;
	settings: NoticeSettings | null;
	place: unknown;
	devices: Array<{ endpoint: string; p256dh: string; auth: string; kinds: NoticeKind[] }>;
};

// What the Hub's job gets: each reader who can get a notice now, and nothing else of the record.
export function dueReaders(rows: ReaderRow[]): DueReader[] {
	const out: DueReader[] = [];
	for (const row of rows) {
		const settings = parseSettings(row.preferences[NOTICES_KEY]);
		const devices = row.devices
			.map(({ endpoint, p256dh, auth, kinds }) => ({
				endpoint,
				p256dh,
				auth,
				kinds: kinds.filter(isKind),
			}))
			.filter((device) => device.kinds.length > 0);
		const byEmail =
			row.email !== null && settings !== null && Object.values(settings.email).some(Boolean);
		if (!byEmail && devices.length === 0) continue;
		out.push({
			userId: row.userId,
			email: row.email,
			settings,
			place: row.preferences[PLACE_KEY] ?? null,
			devices,
		});
	}
	return out;
}

export interface NoticeStore {
	preferences(userId: string): Promise<Record<string, unknown>>;
	savePreference(userId: string, key: string, value: unknown): Promise<void>;
	devices(
		userId: string,
	): Promise<Array<{ id: string; endpoint: string; label: string; kinds: string[] }>>;
	// Saves the device for this reader. A device has one reader: the last one who saved it.
	saveDevice(userId: string, device: Device, keep: number): Promise<void>;
	removeDevice(userId: string, endpoint: string): Promise<void>;
	removeDevices(userId: string): Promise<void>;
	readers(): Promise<ReaderRow[]>;
	// Inserts the log rows, and answers the ones that were not there before.
	claim(claims: Claim[]): Promise<Claim[]>;
	release(claims: Claim[]): Promise<void>;
	removeEndpoints(endpoints: string[]): Promise<void>;
	touchEndpoints(endpoints: string[], now: Date): Promise<void>;
}
