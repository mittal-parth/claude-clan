import { describe, expect, it } from "vitest";
import { getSignInDialogContent } from "./SignInDialog";

describe("getSignInDialogContent", () => {
  it("returns sign in prompt and login button for unauthenticated users", () => {
    const content = getSignInDialogContent({
      action: "dispatch a crew",
      isAuthenticated: false,
    });

    expect(content.title).toBe("Sign in to dispatch a crew");
    expect(content.description).toContain("The demo city is a tour");
    expect(content.buttonLabel).toBe("LOGIN WITH GITHUB");
    expect(content.helperText).toContain("You'll pick exactly which repositories to share");
  });

  it("returns repos restriction prompt and pick repo button for authenticated users", () => {
    const content = getSignInDialogContent({
      action: "dispatch a crew",
      isAuthenticated: true,
    });

    expect(content.title).toBe("You can only dispatch orders in your repos");
    expect(content.description).toContain("The demo city is a tour");
    expect(content.buttonLabel).toBe("PICK REPO");
    expect(content.helperText).toContain("Switch to an imported repository");
  });
});
