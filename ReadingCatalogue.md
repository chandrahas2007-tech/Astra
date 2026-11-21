# Reading a satellite catalogue
A catalogue is a list of objects with an ID, an owner, a launch date and a status. Ours is CelesTrak's **SATCAT**, filtered to payloads still in orbit.
## Active, inactive, unknown
- **Active**: the catalogue marks it operational or in a working reserve state
- **Inactive**: marked non-operational. It still orbits but cannot be commanded to move
- **Unknown**: the status code is missing or not one we classify
## Try it
- Filter the tracker to *Inactive* and pick an owner. Which launch years dominate?
- Search a satellite by NORAD ID, then look it up on CelesTrak
## Limitations
- Status comes from the catalogue and can lag reality
- Only publicly catalogued payloads appear. Debris and rocket bodies are not counted
