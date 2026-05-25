"""DOI reference database lifted from old/mach.html (see lines 488-517)."""
from __future__ import annotations

import random
from typing import Final

PAPERS: Final[dict] = {
    "FTE": [
        {"doi": "10.1002/2016GL069787", "title": "Electron-scale measurements of magnetic reconnection in space",
         "authors": "Burch et al.", "year": 2016, "journal": "Science"},
        {"doi": "10.1029/2018JA025711", "title": "Properties of magnetic reconnection exhaust jets in the magnetosheath",
         "authors": "Phan et al.", "year": 2018, "journal": "JGR Space Physics"},
        {"doi": "10.1038/nphys3406", "title": "Kinetic signatures of magnetic reconnection in the magnetosheath",
         "authors": "Retinò et al.", "year": 2007, "journal": "Nature Physics"},
        {"doi": "10.1029/2019GL083282", "title": "Flux transfer events at the magnetopause: Survey with MMS",
         "authors": "Trenchi et al.", "year": 2019, "journal": "GRL"},
    ],
    "EDR": [
        {"doi": "10.1126/science.aaf2939", "title": "Electron-scale dynamics of the diffusion region during symmetric magnetic reconnection",
         "authors": "Burch et al.", "year": 2016, "journal": "Science"},
        {"doi": "10.1038/s41567-018-0091-6", "title": "Crescent-shaped electron distributions at the magnetopause",
         "authors": "Norgren et al.", "year": 2016, "journal": "GRL"},
        {"doi": "10.1002/2016GL068243", "title": "Energy conversion and inventory of a reconnection event",
         "authors": "Eastwood et al.", "year": 2016, "journal": "GRL"},
    ],
    "Jet": [
        {"doi": "10.1029/2012JA017962", "title": "Magnetosheath high-speed jets: Statistical properties",
         "authors": "Plaschke et al.", "year": 2013, "journal": "JGR Space Physics"},
        {"doi": "10.5194/angeo-36-655-2018", "title": "Jets downstream of collisionless shocks",
         "authors": "Palmroth et al.", "year": 2018, "journal": "Ann. Geophys."},
        {"doi": "10.1002/2017GL073175", "title": "Ion-scale jets in the magnetosheath",
         "authors": "Archer & Horbury", "year": 2013, "journal": "GRL"},
    ],
    "Current Sheet": [
        {"doi": "10.1002/2014JA020539", "title": "Current sheets in the magnetosheath",
         "authors": "Yordanova et al.", "year": 2016, "journal": "JGR Space Physics"},
        {"doi": "10.1029/2018GL079006", "title": "Thin current sheets in the magnetosheath: Cluster observations",
         "authors": "Sundkvist et al.", "year": 2007, "journal": "JGR Space Physics"},
    ],
    "KH Wave": [
        {"doi": "10.1002/2016JA023468", "title": "Kelvin-Helmholtz waves at the Earth's magnetopause",
         "authors": "Kavosi & Raeder", "year": 2015, "journal": "Nature Comms"},
        {"doi": "10.1029/2018GL077430", "title": "MMS observations of Kelvin-Helmholtz instability",
         "authors": "Eriksson et al.", "year": 2016, "journal": "GRL"},
    ],
    "Mirror Mode": [
        {"doi": "10.1029/93JA02587", "title": "Mirror mode structures in the magnetosheath",
         "authors": "Lucek et al.", "year": 1999, "journal": "JGR"},
        {"doi": "10.1002/2015JA021325", "title": "Properties of mirror modes in the magnetosheath",
         "authors": "Génot et al.", "year": 2009, "journal": "Ann. Geophys."},
    ],
}

EVENT_TYPES: Final[list[str]] = list(PAPERS.keys())


def get_random_paper(event_type: str, seed: int | None = None) -> dict:
    rng = random.Random(seed)
    key = event_type if event_type in PAPERS else rng.choice(EVENT_TYPES)
    return rng.choice(PAPERS[key])
