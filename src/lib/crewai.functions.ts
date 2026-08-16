import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const ValidateInput = z.object({ topic: z.string().min(2).max(300) });

export const validateTopic = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => ValidateInput.parse(input))
  .handler(async ({ data }): Promise<{ result: string }> => {
    const { validateTopic } = await import("./crewai.server");
    return await validateTopic(data.topic);
  });
