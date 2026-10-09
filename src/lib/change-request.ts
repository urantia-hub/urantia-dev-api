// A change request: what the developer of an approved app wants to change, kept apart until a reviewer
// approves it. The app works as before until then. An app that is not approved has no request: its
// edit is live for its owner at once, and the app is in review as a whole.

// What a reviewer approved. A reader sees the name and the logo on the sign-in screen, a return
// address is where a reader is sent, and a permission is what the app can reach.
export type Reviewed = {
	name: string;
	redirectUris: readonly string[];
	scopes: readonly string[];
	logoUrl: string | null;
};

// Only the fields that are new. A field that is absent stays as it is.
export type ChangeRequest = {
	id: string;
	requestedAt: string;
	name?: string;
	redirectUris?: string[];
	scopes?: string[];
	logoUrl?: string;
};

const sameList = (a: readonly string[] | undefined, b: readonly string[] | undefined) =>
	a === b || (!!a && !!b && a.length === b.length && a.every((item, i) => item === b[i]));

const sameContent = (a: ChangeRequest, b: Omit<ChangeRequest, "id" | "requestedAt">) =>
	a.name === b.name &&
	a.logoUrl === b.logoUrl &&
	sameList(a.redirectUris, b.redirectUris) &&
	sameList(a.scopes, b.scopes);

// The request for this edit, or null when nothing needs a review. A removed address or permission
// needs none: the route applies it at once. A logo that waits stays until a new logo replaces it.
export function requestFor(
	live: Reviewed,
	wanted: {
		name?: string;
		redirectUris?: readonly string[];
		scopes?: readonly string[];
		logoUrl?: string;
	},
	existing: ChangeRequest | null,
	make: { id: string; now: Date },
): ChangeRequest | null {
	const content: Omit<ChangeRequest, "id" | "requestedAt"> = {};
	const name = wanted.name?.trim();
	if (name !== undefined && name !== live.name) content.name = name;
	if (wanted.redirectUris?.some((uri) => !live.redirectUris.includes(uri))) {
		content.redirectUris = [...wanted.redirectUris];
	}
	if (wanted.scopes?.some((scope) => !live.scopes.includes(scope))) {
		content.scopes = [...wanted.scopes];
	}
	const logoUrl = wanted.logoUrl ?? existing?.logoUrl;
	if (logoUrl !== undefined && logoUrl !== live.logoUrl) content.logoUrl = logoUrl;

	if (Object.keys(content).length === 0) return null;
	// The reviewer may have this request open. The same content keeps its id.
	if (existing && sameContent(existing, content)) return existing;
	return { id: make.id, requestedAt: make.now.toISOString(), ...content };
}

// The values of the app after an approval of this request.
export function applyRequest(
	live: Reviewed,
	request: ChangeRequest,
): { name: string; redirectUris: string[]; scopes: string[]; logoUrl: string | null } {
	return {
		name: request.name ?? live.name,
		redirectUris: [...(request.redirectUris ?? live.redirectUris)],
		scopes: [...(request.scopes ?? live.scopes)],
		logoUrl: request.logoUrl ?? live.logoUrl,
	};
}

const strings = (value: unknown): value is string[] =>
	Array.isArray(value) && value.every((item) => typeof item === "string");

// The request as the database holds it. A value of the wrong kind is dropped, so no approval applies it.
export function parseRequest(value: unknown): ChangeRequest | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const raw = value as Record<string, unknown>;
	if (typeof raw.id !== "string" || typeof raw.requestedAt !== "string") return null;
	const request: ChangeRequest = { id: raw.id, requestedAt: raw.requestedAt };
	if (typeof raw.name === "string") request.name = raw.name;
	if (strings(raw.redirectUris)) request.redirectUris = raw.redirectUris;
	if (strings(raw.scopes)) request.scopes = raw.scopes;
	if (typeof raw.logoUrl === "string") request.logoUrl = raw.logoUrl;
	return request;
}

export const NOTE_MIN = 10;

// A developer who is declined or suspended must be told why. Null when the note is good or not needed.
export function noteProblem(
	decision: "approved" | "pending" | "declined" | "suspended" | "approve" | "decline",
	note: string | undefined,
): string | null {
	const needed = decision === "declined" || decision === "suspended" || decision === "decline";
	if (!needed || (note?.trim().length ?? 0) >= NOTE_MIN) return null;
	return `Say why, in ${NOTE_MIN} characters or more. The developer reads this.`;
}

// The reviewer approves what the screen showed. An app in review is live for its owner at once, so
// its owner can change it while the reviewer reads. Is the app now what the reviewer saw?
export function sameAsSeen(now: Reviewed, seen: Reviewed): boolean {
	return (
		now.name === seen.name &&
		now.logoUrl === seen.logoUrl &&
		sameList(now.redirectUris, seen.redirectUris) &&
		sameList(now.scopes, seen.scopes)
	);
}

// Logo files. Each upload gets a key of its own, so a logo that waits for a review never replaces the
// live one, and an approval is one database statement that points the app at the new file.
const LOGO_BASE = "https://api.urantia.dev/auth/apps";
const LOGO_FILE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp)$/;

export const isLogoFile = (file: string): boolean => LOGO_FILE.test(file);

export function newLogo(appId: string, ext: "png" | "jpg" | "webp", uuid: string) {
	return { key: `${appId}/logo-${uuid}.${ext}`, url: `${LOGO_BASE}/${appId}/logo/${uuid}.${ext}` };
}

// The object keys behind a stored logo address of this app, for a clean-up. An address of another
// app, or one that is not a logo address, names nothing.
export function logoKeys(appId: string, url: string | null | undefined): string[] {
	if (!url) return [];
	const own = `${LOGO_BASE}/${appId}/logo`;
	// A logo from before each upload had its own key.
	if (url === own) return ["png", "jpg", "webp"].map((ext) => `${appId}/logo.${ext}`);
	const file = url.startsWith(`${own}/`) ? url.slice(own.length + 1) : "";
	return isLogoFile(file) ? [`${appId}/logo-${file}`] : [];
}
