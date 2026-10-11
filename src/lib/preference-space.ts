import { NOTICES_KEY } from "./notices.ts";

// Which preferences a caller can read and write. One record holds the preferences of a reader for
// each app, so each app gets only its own part: an app must not read or change the data of another.

type Preferences = Record<string, unknown>;
export type TokenApp = { id: string; firstParty: boolean };

// The keys of UrantiaHub. Our own apps use them as they are.
const HUB = "hub.";

const pick = (all: Preferences, keep: (key: string) => boolean): Preferences =>
	Object.fromEntries(Object.entries(all).filter(([key]) => keep(key)));

// The start of each stored key of an app that is not ours.
export const appPreferencePrefix = (appId: string): string => `app:${appId}:`;

export function preferenceSpace(app: TokenApp | null): {
	// What the caller sees of the stored record.
	visible(stored: Preferences): Preferences;
	// What a change of the caller writes to the stored record.
	patch(body: Preferences): Preferences;
} {
	// The notice settings have routes of their own. This route never reads or writes them.
	if (!app) {
		// The reader, signed in on the accounts site.
		const keep = (key: string) => key !== NOTICES_KEY;
		return { visible: (stored) => pick(stored, keep), patch: (body) => pick(body, keep) };
	}
	if (app.firstParty) {
		const keep = (key: string) => key.startsWith(HUB) && key !== NOTICES_KEY;
		return { visible: (stored) => pick(stored, keep), patch: (body) => pick(body, keep) };
	}
	// Another app: its keys are stored under its id, and it sees them under their plain names.
	// An app id has no ":", so no id is the start of the part of another app.
	const prefix = appPreferencePrefix(app.id);
	return {
		visible: (stored) =>
			Object.fromEntries(
				Object.entries(stored)
					.filter(([key]) => key.startsWith(prefix))
					.map(([key, value]) => [key.slice(prefix.length), value]),
			),
		patch: (body) =>
			Object.fromEntries(Object.entries(body).map(([key, value]) => [`${prefix}${key}`, value])),
	};
}
