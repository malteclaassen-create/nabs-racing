# Aerial maps: sources and supported layouts

Prepared 2026-09-05. Images are downloaded once and served locally. Geographic crops/resampling; Red Bull Ring uses unmodified JPEG tiles embedded in an SVG. Credits and source links remain under the live map.

| Circuit ID | Approved layout name | Source | License | P90 fit residual |
|---|---|---|---|---|
| rt_autodrom_most | NABS Autodrom Most (no chicane) | [Aerial © ČÚZK](https://geoportal.cuzk.cz/Default.aspx?mode=TextMeta&side=ortofoto&text=ortofoto_info) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | 5.4 m |
| vhe_hockenheim | NABS Hockenheim 2026 | [Datenquelle: LGL, www.lgl-bw.de](https://www.lgl-bw.de/Produkte/Open-Data/) | [dl-de/by-2-0](https://www.govdata.de/dl-de/by-2-0) | 6.0 m |
| ks_red_bull_ring | Red Bull Ring - F1 2025 - EuroRacers | [Datenquelle: basemap.at](https://basemap.at/) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | 5.7 m |
| lilski_watkins_glen | Watkins Glen Boot | [Aerial: USDA NAIP / USGS](https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer) | [Public domain](https://www.usgs.gov/centers/eros/science/usgs-eros-archive-aerial-photography-national-agriculture-imagery-program-naip) | 5.4 m |
| rs_tor_poznanl | Tor Poznań | [Aerial: GUGiK](https://www.geoportal.gov.pl/en/data/orthophotomap-orto/) | [Open data](https://www.geoportal.gov.pl/en/data/orthophotomap-orto/) | 5.8 m |
| magny_cours | NABS Magny-Cours 2023 | [Aerial © IGN BD ORTHO](https://geoservices.ign.fr/bdortho) | [Licence Ouverte 2.0](https://www.etalab.gouv.fr/licence-ouverte-open-licence/) | 11.4 m |
| vhe_interlagos | NABS Interlagos 2025 v2 | [Aerial © PMSP / GeoSampa 2020](https://prefeitura.sp.gov.br/web/licenciamento/w/licen%C3%A7a-para-uso-de-dados-do-geosampa) | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 7.6 m |

Interlagos cropped imagery is distributed under CC BY-SA 4.0, like its source. Other assets retain their listed licenses. These licenses apply to the respective map assets.

Spa remains available under its existing SPW 2023 / CC BY 4.0 attribution.

Fit residuals measure distance to the reference line, not guaranteed vehicle accuracy. Magny-Cours requires a bounded affine fit because game and geographic geometry differ. Map-frame corner coverage and rendering with sample cars were checked; real on-track telemetry still needs validation for these new layouts.

Only the exact track IDs and layout display names above are enabled. Other mods/layouts do not inherit a potentially incorrect mapping. The four Google Earth maps below now cover the remaining calendar circuits, for their listed installed layouts.

Geometry: © OpenStreetMap contributors, ODbL (https://www.openstreetmap.org/copyright). Most, Hockenheim, Red Bull Ring, Watkins Glen, Poznan and Magny-Cours use OSM API geometry. Interlagos uses bacinger/f1-circuits br-1940.geojson (MIT; OSM-derived geometry). Preparation configs, gate extraction, source geometry and alignment previews are retained in the project copy under work/satellite.

## Google Earth captures

Four static, north-up screenshots captured from the Google Earth web interface on 2026-09-05 for this non-commercial recreational league. These images are **not open-licensed**; use is subject to [Google Geo Guidelines](https://about.google/brand-resource-center/products-and-services/geo-guidelines/) and the linked Google terms. The source credit **Google · Airbus** is displayed immediately below each map and remains visible while following a car. Embedded Google image watermarks are retained. Do not replace these credits with an open-data license, move them to the site footer, or repurpose the images for commercial/promotional use.

| Circuit ID | Approved layout display name | AC layout directory | Source | Geographic fit P90 |
|---|---|---|---|---|
| baku_2022 | NABS Baku 2024 | nabs_baku | Google · Airbus | 6.6 m |
| singapore_2020 | Euroracers Singapore GP 2025 | er_singapore_2025 | Google · Airbus, selected image 2025-05-28 | 8.6 m |
| ks_silverstone | Silverstone F1 2025 | silverstone_f1_2025 | Google · Airbus | 7.5 m |
| abu_dhabi_2021_chq | Euroracers Abu Dhabi 2025 | er_abudhabi_2025 | Google · Airbus | 5.6 m |

Four visible KML control points register each screenshot to geographic coordinates. The AC racing line is fitted to bacinger/f1-circuits reference geometry with scale constrained to avoid degenerate fits. Start/finish and sector gates come from the installed layout's KN5 timing nodes. Baku's absent decorative billboards2024.kn5 was skipped; all three paired timing gates were found in the other listed models. Viewport chrome and control points are excluded from delivered crops. Geographic fit residuals exclude imagery, terrain and control-point errors, so they are not guarantees of live car accuracy. Other layout names retain the normal track map until separately verified.

Preparation scripts, KML points, raw/reference captures and alignment previews are retained locally in `C:/Users/malte/Documents/Codex/2026-09-05/kannst-du-3d-modelle-in-blender`. The website only serves the four static JPEGs and metadata; no Google API key, browser automation or image processing runs on the live server.
