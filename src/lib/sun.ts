import { ZONE_COORDS } from './zoneCoords'

const RAD = Math.PI / 180
const DAY_MS = 86_400_000
const J1970 = 2440587.5
const J2000 = 2451545

const toJulian = (ms: number) => ms / DAY_MS + J1970
const fromJulian = (j: number) => new Date((j - J1970) * DAY_MS)

export type SunTimes =
  | { kind: 'normal'; rise: Date; set: Date }
  /** the sun stays up all day (summer beyond the polar circle) */
  | { kind: 'day' }
  /** the sun stays down all day (winter beyond the polar circle) */
  | { kind: 'night' }

/** sunrise and sunset on the local calendar day of `date`, at `lat`/`lon` (degrees, east positive), by the
 *  sunrise equation: accurate to a minute or two, which is plenty for switching a reading theme */
export function sunTimes(date: Date, lat: number, lon: number): SunTimes {
  const noon = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), 12)
  const n = Math.round(toJulian(noon) - J2000 + 0.0008)
  const jStar = n - lon / 360
  const m = ((357.5291 + 0.98560028 * jStar) % 360) * RAD
  const c = 1.9148 * Math.sin(m) + 0.02 * Math.sin(2 * m) + 0.0003 * Math.sin(3 * m)
  const lambda = ((m / RAD + c + 180 + 102.9372) % 360) * RAD
  const transit = J2000 + jStar + 0.0053 * Math.sin(m) - 0.0069 * Math.sin(2 * lambda)
  const sinDec = Math.sin(lambda) * Math.sin(23.4397 * RAD)
  const cosDec = Math.cos(Math.asin(sinDec))
  const cosW = (Math.sin(-0.833 * RAD) - Math.sin(lat * RAD) * sinDec) / (Math.cos(lat * RAD) * cosDec)
  if (cosW > 1) return { kind: 'night' }
  if (cosW < -1) return { kind: 'day' }
  const w = Math.acos(cosW) / RAD
  return { kind: 'normal', rise: fromJulian(transit - w / 360), set: fromJulian(transit + w / 360) }
}

/** where the device roughly is, from its time zone alone (no location permission): the zone's main city, or for an
 *  unknown zone a longitude from the UTC offset at a mid latitude */
export function deviceCoords(zone = currentZone(), now = new Date()): [number, number] {
  const known = zone ? ZONE_COORDS[zone] : undefined
  if (known) return known
  return [35, -now.getTimezoneOffset() / 4]
}

function currentZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    return undefined
  }
}
