// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { translate } from "@/i18n";

const create = vi.fn();
const invalidate = vi.fn();
const onClose = vi.fn();
let result: any = { created: true };

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ scheduled: { list: { invalidate } } }),
    scheduled: {
      create: {
        useMutation: (options?: { onSuccess?: (data: any) => void }) => ({
          mutate: (input: unknown) => {
            create(input);
            options?.onSuccess?.(result);
          },
          isPending: false,
        }),
      },
    },
  },
}));

vi.mock("@/contexts/LocaleContext", () => ({
  useLocale: () => ({
    t: (key: any, params?: any) => translate("zh", key, params),
    locale: "zh",
    localeName: "中文",
    setLocale: () => {},
  }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import ScheduledSend from "./ScheduledSend";

describe("sending later from the chat (C5.3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    result = { created: true };
  });

  it("sends a message with the day the user picked", () => {
    render(<ScheduledSend personaId={5} name="小满" open onClose={onClose} />);
    fireEvent.change(screen.getByPlaceholderText("想在那天说的一句话"), {
      target: { value: "到那天再说" },
    });
    fireEvent.change(screen.getByLabelText("什么时候发"), {
      target: { value: "2099-01-01T20:00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "定下来" }));
    expect(create).toHaveBeenCalledWith({
      personaId: 5,
      kind: "message",
      body: "到那天再说",
      dueAt: new Date("2099-01-01T20:00").toISOString(),
    });
    expect(invalidate).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("does not send without a day", () => {
    render(<ScheduledSend personaId={5} name="小满" open onClose={onClose} />);
    fireEvent.change(screen.getByPlaceholderText("想在那天说的一句话"), {
      target: { value: "到那天再说" },
    });
    fireEvent.click(screen.getByRole("button", { name: "定下来" }));
    expect(create).not.toHaveBeenCalled();
  });

  it("shows the help when the line is a crisis", () => {
    result = { created: false, crisis: true, help: "请先停下来。\n12356" };
    render(<ScheduledSend personaId={5} name="小满" open onClose={onClose} />);
    fireEvent.change(screen.getByPlaceholderText("想在那天说的一句话"), {
      target: { value: "我不想活了" },
    });
    fireEvent.change(screen.getByLabelText("什么时候发"), {
      target: { value: "2099-01-01T20:00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "定下来" }));
    expect(screen.getByText("先等一下")).toBeInTheDocument();
    expect(screen.getByText(/12356/)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("renders nothing while closed", () => {
    const { container } = render(
      <ScheduledSend personaId={5} name="小满" open={false} onClose={onClose} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
