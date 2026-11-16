# Real circuits

The centre line and track width of real circuits, one CSV per circuit:
`x_m, y_m, w_tr_right_m, w_tr_left_m`, a point every ~5 m.

From the TUM racetrack-database (Chair of Automotive Technology, Technical
University of Munich): https://github.com/TUMFTM/racetrack-database. The
centre lines come from OpenStreetMap, the widths were measured on satellite
images. Licensed under the GNU LGPL v3, see LICENSE in this folder.

`lib/realTracks.js` lays one of these over a track's AI line and, when it
fits, draws the telemetry map's road from it instead of from the AI file.
