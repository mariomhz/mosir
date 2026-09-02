/*
 * Where the sun is actually standing over the Earth right now.
 *
 * The subsolar point is the one place where the sun is straight overhead, so
 * pointing the scene's light at it puts the terminator exactly where the real
 * one is. Low precision solar coordinates out of the Astronomical Almanac:
 * good to a fraction of a degree, which is far finer than anything visible at
 * this scale, and it needs no ephemeris data.
 */

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

/** Days since J2000.0 (2000-01-01 12:00 UTC). */
function daysSinceJ2000(date) {
  return date.getTime() / 86400000 + 2440587.5 - 2451545.0;
}

/** Latitude and longitude the sun is directly above, in degrees. */
export function subsolarPoint(date = new Date()) {
  const n = daysSinceJ2000(date);

  // The sun's apparent position along the ecliptic. The two sine terms are
  // the first order correction for the Earth's orbit not being circular.
  const meanLongitude = (280.460 + 0.9856474 * n) % 360;
  const meanAnomaly = ((357.528 + 0.9856003 * n) % 360) * DEG;
  const eclipticLongitude =
    (meanLongitude + 1.915 * Math.sin(meanAnomaly) + 0.020 * Math.sin(2 * meanAnomaly)) * DEG;
  const obliquity = (23.439 - 0.0000004 * n) * DEG;

  // Ecliptic to equatorial. Declination is the subsolar latitude directly:
  // +23.4 at the June solstice, -23.4 in December, 0 at the equinoxes.
  const declination = Math.asin(Math.sin(obliquity) * Math.sin(eclipticLongitude)) * RAD;
  const rightAscension =
    Math.atan2(Math.cos(obliquity) * Math.sin(eclipticLongitude), Math.cos(eclipticLongitude)) * RAD;

  // Subtracting Greenwich sidereal time turns a position in the sky into a
  // position over the rotating Earth, and carries the equation of time with
  // it, so noon here is real solar noon rather than clock noon.
  const siderealTime = (280.46061837 + 360.98564736629 * n) % 360;

  let longitude = rightAscension - siderealTime;
  longitude = ((((longitude + 180) % 360) + 360) % 360) - 180;

  return { lat: declination, lon: longitude };
}
