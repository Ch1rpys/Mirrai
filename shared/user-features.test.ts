import { describe, expect, it } from "vitest";
import {
  DEFAULT_USER_FEATURES,
  mergeUserFeatures,
  normalizeUserFeatures,
} from "./user-features";

describe("the experimental feature flags", () => {
  it("are all off by default", () => {
    expect(normalizeUserFeatures(undefined)).toEqual(DEFAULT_USER_FEATURES);
    expect(normalizeUserFeatures(null)).toEqual({ groupChat: false });
    expect(normalizeUserFeatures("oops")).toEqual({ groupChat: false });
    expect(normalizeUserFeatures({})).toEqual({ groupChat: false });
  });

  it("turn a feature on only for a literal true", () => {
    expect(normalizeUserFeatures({ groupChat: true })).toEqual({ groupChat: true });
    expect(normalizeUserFeatures({ groupChat: "yes" })).toEqual({ groupChat: false });
    expect(normalizeUserFeatures({ groupChat: 1 })).toEqual({ groupChat: false });
  });

  it("drop keys the app does not know", () => {
    expect(normalizeUserFeatures({ groupChat: true, telepathy: true })).toEqual({
      groupChat: true,
    });
  });

  it("merge a patch over the stored value", () => {
    expect(mergeUserFeatures({ groupChat: true }, { groupChat: false })).toEqual({
      groupChat: false,
    });
    expect(mergeUserFeatures({ groupChat: false }, {})).toEqual({ groupChat: false });
    expect(mergeUserFeatures(undefined, { groupChat: true })).toEqual({ groupChat: true });
  });
});
