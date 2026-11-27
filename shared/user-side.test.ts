import { describe, expect, it } from "vitest";
import {
  EVENT_LABELS,
  RELATIONSHIP_EVENT_KINDS,
  isRelationshipEventKind,
} from "./user-side";

/**
 * The relationship events the app can name (C3.5).
 *
 * "I said it" is written by the exit list when the user records how it
 * went. It is one of the events the timeline draws and one of the labels
 * the persona's prompt reads — so it has to be in the same list as the
 * rest, or the timeline shows the raw key and the prompt falls back to
 * the bare title.
 */
describe("relationship event kinds", () => {
  it("knows the events the app writes itself", () => {
    expect(RELATIONSHIP_EVENT_KINDS).toContain("said_it");
    expect(isRelationshipEventKind("said_it")).toBe(true);
    expect(EVENT_LABELS.said_it.zh).toContain("说出口");
    expect(EVENT_LABELS.said_it.en.length).toBeGreaterThan(0);
  });

  it("has a label for every kind", () => {
    for (const kind of RELATIONSHIP_EVENT_KINDS) {
      expect(EVENT_LABELS[kind]?.zh, kind).toBeTruthy();
      expect(EVENT_LABELS[kind]?.en, kind).toBeTruthy();
    }
  });
});
