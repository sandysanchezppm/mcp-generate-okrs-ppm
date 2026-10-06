import { publicMonitorResponseSchema } from "./types.js"
import type {
  PublicMonitorResponse,
  UptimeIncident,
  UptimeProjectData,
} from "./types.js"
import type { UptimeRobotConfig } from "./config.schema.js"

const PUBLIC_BASE_URL = "https://stats.uptimerobot.com"
const REQUEST_TIMEOUT_MS = 15_000
const HOURS_PER_DAY = 24
const PERCENT = 100

export function buildPublicUrl(config: UptimeRobotConfig): string {
  return `${PUBLIC_BASE_URL}/${config.companyId}/${config.projectId}`
}

export function buildMonitorEndpoint(config: UptimeRobotConfig): string {
  const projectId = encodeURIComponent(config.projectId)
  return `${PUBLIC_BASE_URL}/api/getMonitor/${config.companyId}?m=${projectId}`
}

export async function fetchPublicMonitor(
  config: UptimeRobotConfig
): Promise<PublicMonitorResponse> {
  const response = await fetch(buildMonitorEndpoint(config), {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) {
    throw new Error(`UptimeRobot respondió HTTP ${response.status}`)
  }

  const parsed = publicMonitorResponseSchema.safeParse(await response.json())
  if (!parsed.success) {
    throw new Error("La respuesta pública de UptimeRobot cambió de formato")
  }
  if (String(parsed.data.monitor.monitorId) !== config.projectId) {
    throw new Error(
      `El proyecto ${config.projectId} no coincide con el monitor recibido`
    )
  }
  return parsed.data
}

function getTimezoneOffsetMinutes(timezone: string): number {
  const match = timezone.match(/^([+-])(\d{2}):?(\d{2})$/)
  if (!match) return 0
  const direction = match[1] === "-" ? -1 : 1
  return direction * (Number(match[2]) * 60 + Number(match[3]))
}

function shiftToTimezone(date: Date, timezone: string): Date {
  const offset = getTimezoneOffsetMinutes(timezone)
  return new Date(date.getTime() + offset * 60_000)
}

function getMonthPrefix(date: Date): string {
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, "0")
  return `${year}-${month}`
}

function getIncidentCause(
  reason: PublicMonitorResponse["monitor"]["logs"][number]["reason"]
): string {
  if (Array.isArray(reason)) return "Unknown"
  const detail = reason.detail.short?.trim()
  return detail ? `${reason.code}: ${detail}` : String(reason.code)
}

function collectIncidents(
  response: PublicMonitorResponse,
  monthPrefix: string,
  now: Date
): UptimeIncident[] {
  const logs = [...response.monitor.logs].sort((a, b) => a.time - b.time)
  const incidents: UptimeIncident[] = []

  for (const [index, log] of logs.entries()) {
    if (log.label.toLowerCase() !== "down") continue
    const startedAtUtc = new Date(log.dateGMTISO)
    const startedAt = shiftToTimezone(startedAtUtc, response.timezone)
    if (getMonthPrefix(startedAt) !== monthPrefix) continue

    const recovery = logs
      .slice(index + 1)
      .find((candidate) => candidate.label.toLowerCase() === "up")
    const endedAtUtc = recovery ? new Date(recovery.dateGMTISO) : undefined
    const endedAt = endedAtUtc
      ? shiftToTimezone(endedAtUtc, response.timezone)
      : undefined
    const durationEnd = endedAtUtc ?? now
    incidents.push({
      startedAt,
      endedAt,
      durationHours: Math.max(
        0,
        (durationEnd.getTime() - startedAtUtc.getTime()) / 3_600_000
      ),
      cause: getIncidentCause(log.reason),
    })
  }
  return incidents
}

export function normalizeMonitorData(
  config: UptimeRobotConfig,
  response: PublicMonitorResponse,
  now = new Date()
): UptimeProjectData {
  const localNow = shiftToTimezone(now, response.timezone)
  const monthPrefix = getMonthPrefix(localNow)
  const ratios = response.monitor.dailyRatios.filter((item) =>
    item.date.startsWith(monthPrefix)
  )
  if (ratios.length === 0) {
    throw new Error(`UptimeRobot no devolvió datos para ${monthPrefix}`)
  }

  const dayCount = new Date(
    Date.UTC(
      localNow.getUTCFullYear(),
      localNow.getUTCMonth() + 1,
      0
    )
  ).getUTCDate()
  const incidents = collectIncidents(response, monthPrefix, now)
  const totalHours = dayCount * HOURS_PER_DAY
  const downtimeHours = incidents.reduce(
    (total, incident) => total + incident.durationHours,
    0
  )
  const availability = PERCENT * (1 - downtimeHours / totalHours)

  return {
    companyId: config.companyId,
    projectId: config.projectId,
    monitorName: response.monitor.name,
    monthName: new Intl.DateTimeFormat("es", {
      month: "long",
      timeZone: "UTC",
    }).format(localNow),
    dayCount,
    totalHours,
    downtimeHours,
    availability,
    incidents,
    publicUrl: buildPublicUrl(config),
  }
}

export async function collectUptimeData(
  config: UptimeRobotConfig
): Promise<UptimeProjectData> {
  const response = await fetchPublicMonitor(config)
  return normalizeMonitorData(config, response)
}
