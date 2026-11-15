import "@testing-library/jest-dom/vitest";

process.env.FIREBASE_PROJECT_ID ??= "test-project";
process.env.FIREBASE_CLIENT_EMAIL ??= "test@test-project.iam.gserviceaccount.com";
process.env.FIREBASE_PRIVATE_KEY ??= "test";
process.env.APP_URL ??= "http://localhost:3000";
