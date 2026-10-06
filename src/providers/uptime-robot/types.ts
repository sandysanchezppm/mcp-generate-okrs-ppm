import { z } from "zod"

const ratioSchema = z.object({
  ratio: z.string().regex(/^\d+(?:\.\d+)?$/),
})

const logSchema = z.object({
  label: z.string(),
  dateGMTISO: z.string(),
  time: z.number(),
  timezone: z.string(),
  reason: z.union([
    z.object({
      code: z.union([z.string(), z.number()]),
      detail: z.object({ short: z.string().optional() }).loose(),
    }).loose(),
    z.array(z.unknown()),
  ]),
})

export const publicMonitorResponseSchema = z
  .object({
    status: z.literal("ok"),
    title: z.string(),
    monitor: z
      .object({
        monitorId: z.number(),
        name: z.string(),
        logs: z.array(logSchema),
        "30dRatio": ratioSchema,
        dailyRatios: z.array(
          ratioSchema.extend({
            date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          })
        ),
      })
      .loose(),
    timezone: z.string(),
  })
  .loose()

export type PublicMonitorResponse = z.infer<typeof publicMonitorResponseSchema>

export interface UptimeIncident {
  startedAt: Date
  endedAt?: Date
  durationHours: number
  cause: string
}

export interface UptimeProjectData {
  companyId: string
  projectId: string
  monitorName: string
  monthName: string
  dayCount: number
  totalHours: number
  downtimeHours: number
  availability: number
  incidents: UptimeIncident[]
  publicUrl: string
}
