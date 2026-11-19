import { describe, expect, it } from "bun:test";
import { errorCause } from "../../src/lib/errors.ts";

describe("errorCause", () => {
	it("returns nothing for an error without a cause", () => {
		expect(errorCause(new Error("plain"))).toEqual({});
	});

	it("returns the message and code of the deepest cause", () => {
		const pg = Object.assign(new Error("too many connections"), { code: "53300" });
		const mid = new Error("connect failed", { cause: pg });
		const top = new Error("Failed query: select 1", { cause: mid });
		expect(errorCause(top)).toEqual({ cause: "too many connections", cause_code: "53300" });
	});

	it("handles a cause that is not an Error", () => {
		expect(errorCause(new Error("x", { cause: "socket closed" }))).toEqual({ cause: "socket closed" });
	});

	it("stops on a cause cycle", () => {
		const a = new Error("a");
		const b = new Error("b", { cause: a });
		(a as { cause?: unknown }).cause = b;
		expect(errorCause(a).cause).toBeDefined();
	});
});
