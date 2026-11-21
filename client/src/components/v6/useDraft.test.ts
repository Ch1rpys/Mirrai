// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { clearAllDrafts, useDraft } from "./useDraft";

/**
 * The unsent words (C8.10).
 *
 * A half-written message used to live only in React state, so a reload
 * threw it away. It is kept per user and per conversation, and signing
 * out clears all of them.
 */
describe("the draft", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("comes back after a reload", () => {
    const first = renderHook(() => useDraft(1, 5));
    act(() => first.result.current.setValue("还没说完"));
    first.unmount();

    const second = renderHook(() => useDraft(1, 5));
    expect(second.result.current.value).toBe("还没说完");
  });

  it("is cleared when it is sent", () => {
    const hook = renderHook(() => useDraft(1, 5));
    act(() => hook.result.current.setValue("在吗"));
    act(() => hook.result.current.clear());
    expect(hook.result.current.value).toBe("");
    expect(localStorage.getItem("mirrai:draft:1:5")).toBeNull();
  });

  it("is kept per conversation, and switching loads the right one", () => {
    const first = renderHook(({ personaId }) => useDraft(1, personaId), {
      initialProps: { personaId: 5 },
    });
    act(() => first.result.current.setValue("给小满的"));
    first.rerender({ personaId: 6 });
    expect(first.result.current.value).toBe("");
    act(() => first.result.current.setValue("给别人的"));

    first.rerender({ personaId: 5 });
    expect(first.result.current.value).toBe("给小满的");
    expect(localStorage.getItem("mirrai:draft:1:6")).toBe("给别人的");
  });

  it("forgets every draft when the user signs out", () => {
    localStorage.setItem("mirrai:draft:1:5", "a");
    localStorage.setItem("mirrai:draft:1:6", "b");
    localStorage.setItem("something-else", "keep me");
    clearAllDrafts();
    expect(localStorage.getItem("mirrai:draft:1:5")).toBeNull();
    expect(localStorage.getItem("mirrai:draft:1:6")).toBeNull();
    // Nothing else is touched.
    expect(localStorage.getItem("something-else")).toBe("keep me");
  });
});
