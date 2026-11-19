// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import TimeBar from "./TimeBar";

describe("the time bar", () => {
  const later = "2024-06-01T04:10:00.000Z";
  const sixMinutesEarlier = "2024-06-01T04:04:00.000Z";
  const fourMinutesEarlier = "2024-06-01T04:06:00.000Z";

  it("appears after a gap of more than five minutes in an IM layout", () => {
    render(
      <TimeBar
        at={later}
        previousAt={sixMinutesEarlier}
        skin="im-green"
        locale="zh"
        timeZone="Asia/Shanghai"
      />,
    );
    expect(screen.getByRole("separator")).toBeInTheDocument();
    expect(screen.getByText("12:10")).toBeInTheDocument();
  });

  it("does not appear after four minutes", () => {
    render(
      <TimeBar
        at={later}
        previousAt={fourMinutesEarlier}
        skin="im-green"
        locale="zh"
        timeZone="Asia/Shanghai"
      />,
    );
    expect(screen.queryByRole("separator")).toBeNull();
  });

  it("does not change the classic layout", () => {
    render(
      <TimeBar
        at={later}
        previousAt={sixMinutesEarlier}
        skin="classic"
        locale="zh"
        timeZone="Asia/Shanghai"
      />,
    );
    expect(screen.queryByRole("separator")).toBeNull();
  });
});
