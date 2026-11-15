import { AiNotImplementedError, type AiServices } from "./types";

/** Phase 1 stub. Phase 2 replaces this with the Gemini-backed implementation. */
export const aiServices: AiServices = {
  prescriptionExtractor: {
    async extract() {
      throw new AiNotImplementedError("Prescription scanning");
    },
  },
  careAssistant: {
    async answer() {
      throw new AiNotImplementedError("The care assistant");
    },
  },
};

export * from "./types";
