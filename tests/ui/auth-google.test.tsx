// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import * as matchers from "vitest-axe/matchers";
expect.extend(matchers);

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, refresh: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
const signInWithPopup = vi.fn();
vi.mock("firebase/auth", () => ({
  GoogleAuthProvider: class {},
  signInWithPopup: (...a: unknown[]) => signInWithPopup(...a),
  signInWithEmailAndPassword: vi.fn(), createUserWithEmailAndPassword: vi.fn(), sendEmailVerification: vi.fn(),
  sendPasswordResetEmail: vi.fn(), signOut: vi.fn(), updateProfile: vi.fn(),
}));
vi.mock("@/lib/firebase/client", () => ({
  isFirebaseConfigured: () => true,
  clientAuth: () => ({ currentUser: { getIdToken: async () => "tok_tok_tok_tok_tok_tok" } }),
}));

import { LoginForm } from "@/components/app/auth-forms";
import { AnnouncerProvider } from "@/components/a11y/announcer";
import { DisplaySettingsProvider } from "@/components/a11y/display-settings";

const ui = () => render(<DisplaySettingsProvider><AnnouncerProvider><LoginForm /></AnnouncerProvider></DisplaySettingsProvider>);
const json = (data: unknown, status = 200) => new Response(JSON.stringify({ data }), { status, headers: { "content-type": "application/json" } });

beforeEach(() => { replace.mockReset(); signInWithPopup.mockReset().mockResolvedValue({}); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Google sign-in", () => {
  it("login page is accessible and offers Google with a text label", async () => {
    const { container } = ui();
    expect(screen.getByRole("button", { name: "Continue with Google" })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("existing profile: signs in and goes to the dashboard", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ uid: "u1", emailVerified: true })));
    ui();
    await userEvent.setup().click(screen.getByRole("button", { name: "Continue with Google" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/dashboard"));
  });

  it("new Google user is asked for an account type instead of being guessed, then signed in", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ needsAccountType: true }))
      .mockResolvedValueOnce(json({ uid: "u1", emailVerified: true }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    const { container } = ui();
    await user.click(screen.getByRole("button", { name: "Continue with Google" }));
    expect(await screen.findByRole("heading", { name: "One last step" })).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
    expect(await axe(container)).toHaveNoViolations();
    await user.click(screen.getByRole("radio", { name: /Patient/ }));
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/dashboard"));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).accountType).toBeUndefined();
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).accountType).toBe("patient");
  });

  it("a closed popup shows a clear, focusable error summary", async () => {
    signInWithPopup.mockRejectedValueOnce({ code: "auth/popup-closed-by-user" });
    ui();
    await userEvent.setup().click(screen.getByRole("button", { name: "Continue with Google" }));
    const alert = await screen.findByRole("alert", { name: /We could not complete that/ });
    expect(alert).toHaveTextContent(/closed before it finished/);
  });
});
