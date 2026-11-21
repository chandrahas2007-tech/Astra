# Orbits from perigee and apogee
Perigee is the lowest point of an orbit and apogee the highest. Together they give the size of the orbit and how long one lap takes.
## The method
- Semi-major axis: `a = (perigee + apogee) / 2 + 6378 km`
- Period: `T = 2π √(a³ / μ)` with `μ = 398,600 km³/s²`
## Worked examples
- Circular orbit at 550 km: `a` = 6928 km, period about 95.7 minutes, speed about 7.6 km/s
- Geostationary orbit at 35,786 km: period about 1436 minutes, one turn of the Earth
## Try it
- Take a row from the table, compute its period, and compare it with the catalogue value
- The tracker does this for every satellite and reports how many agree
## Limitations
- Two-body physics ignores Earth's bulge and drag, so small differences are normal
