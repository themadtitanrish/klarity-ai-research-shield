import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const ValidateInput = z.object({ topic: z.string().min(2).max(300) });

export const validateTopic = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => ValidateInput.parse(input))
  .handler(async ({ data }): Promise<{ result: string } | { error: string }> => {
    const { validateTopic } = await import("./crewai.server");
    try {
      return await validateTopic(data.topic);
    } catch (error) {
      // Return safe error codes explicitly: production server functions can
      // redact thrown messages, hiding actionable cooldown/timeout guidance.
      const code = error instanceof Error ? (error.message.split(":")[0] ?? "SERVICE") : "SERVICE";
      return { error: ["RATE_LIMIT", "TIMEOUT", "NETWORK", "AUTH"].includes(code) ? code : "SERVICE" };
    }
  });
