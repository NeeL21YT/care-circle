import "@testing-library/jest-dom/vitest";
import { configure } from "@testing-library/react";

// CI machines are slower than laptops: give findBy*/waitFor 4s (default 1s) so UI tests check behavior, not speed.
configure({ asyncUtilTimeout: 4000 });

process.env.FIREBASE_PROJECT_ID ??= "test-project";
process.env.FIREBASE_CLIENT_EMAIL ??= "test@test-project.iam.gserviceaccount.com";
process.env.FIREBASE_PRIVATE_KEY ??= "test";
process.env.APP_URL ??= "http://localhost:3000";
