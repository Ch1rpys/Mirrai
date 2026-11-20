// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { translate } from "@/i18n";

const saveConfig = vi.fn();
const testEmail = vi.fn();
const clearConfig = vi.fn();
const refetch = vi.fn();
let config: any = {
  configured: false,
  host: null,
  port: null,
  secure: true,
  user: null,
  from: null,
  to: null,
  subjectWithName: false,
};
let configError = false;

vi.mock("@/lib/trpc", () => ({
  trpc: {
    email: {
      getConfig: {
        useQuery: () => ({ data: config, isLoading: false, isError: configError, refetch }),
      },
      saveConfig: { useMutation: () => ({ mutate: saveConfig, isPending: false }) },
      test: { useMutation: () => ({ mutate: testEmail, isPending: false }) },
      clear: { useMutation: () => ({ mutate: clearConfig, isPending: false }) },
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

import EmailDelivery from "./EmailDelivery";

describe("the mail server settings (C5.5)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configError = false;
    config = {
      configured: false,
      host: null,
      port: null,
      secure: true,
      user: null,
      from: null,
      to: null,
      subjectWithName: false,
    };
  });

  it("saves the server the user filled in", () => {
    render(<EmailDelivery />);
    fireEvent.change(screen.getByLabelText("邮件服务器"), { target: { value: "smtp.example.test" } });
    fireEvent.change(screen.getByLabelText("端口"), { target: { value: "587" } });
    fireEvent.change(screen.getByLabelText("用户名"), { target: { value: "me@example.test" } });
    fireEvent.change(screen.getByLabelText("密码"), { target: { value: "secret" } });
    fireEvent.change(screen.getByLabelText("发件地址"), { target: { value: "mirrai@example.test" } });
    fireEvent.change(screen.getByLabelText("收件地址（你自己的邮箱）"), { target: { value: "me@example.test" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(saveConfig).toHaveBeenCalledWith({
      host: "smtp.example.test",
      port: 587,
      secure: true,
      user: "me@example.test",
      pass: "secret",
      from: "mirrai@example.test",
      to: "me@example.test",
      subjectWithName: false,
    });
  });

  it("shows the saved server without a password, and tests it", () => {
    config = {
      configured: true,
      host: "smtp.example.test",
      port: 465,
      secure: true,
      user: "me@example.test",
      from: "mirrai@example.test",
      to: "me@example.test",
      subjectWithName: true,
    };
    render(<EmailDelivery />);
    expect((screen.getByLabelText("邮件服务器") as HTMLInputElement).value).toBe("smtp.example.test");
    expect((screen.getByLabelText("密码") as HTMLInputElement).value).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "发一封测试信" }));
    expect(testEmail).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "清除配置" }));
    expect(clearConfig).toHaveBeenCalled();
  });

  it("does not save without a password on a fresh setup", () => {
    render(<EmailDelivery />);
    fireEvent.change(screen.getByLabelText("邮件服务器"), { target: { value: "smtp.example.test" } });
    fireEvent.change(screen.getByLabelText("用户名"), { target: { value: "me@example.test" } });
    fireEvent.change(screen.getByLabelText("发件地址"), { target: { value: "mirrai@example.test" } });
    fireEvent.change(screen.getByLabelText("收件地址（你自己的邮箱）"), { target: { value: "me@example.test" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(saveConfig).not.toHaveBeenCalled();
  });

  it("shows a failure with a retry, not an empty form", () => {
    configError = true;
    render(<EmailDelivery />);
    expect(screen.getByText(/没有读到邮件配置/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(refetch).toHaveBeenCalled();
  });
});
