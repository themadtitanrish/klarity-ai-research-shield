import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const KickoffInput = z.object({ topic: z.string().min(2).max(300) });
const StatusInput = z.object({ kickoffId: z.string().min(1).max(200) });

export type CrewStatusResult = {
  state: string;
  raw?: string | undefined;
  error?: string | undefined;
};

export const kickoffValidation = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => KickoffInput.parse(input))
  .handler(async ({ data }): Promise<{ kickoffId: string }> => {
    const { kickoffCrew } = await import("./crewai.server");
    return { kickoffId: await kickoffCrew(data.topic) };
  });

export const fetchValidationStatus = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => StatusInput.parse(input))
  .handler(async ({ data }): Promise<CrewStatusResult> => {
    const { getCrewStatus } = await import("./crewai.server");
    return await getCrewStatus(data.kickoffId);
  });
