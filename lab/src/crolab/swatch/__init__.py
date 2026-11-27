"""Swatch calibration: printable marker sheet, photo analyzer, synthetic photos.

* ``make_sheet``  -- printable ArUco marker sheets/card (+ ``sheet_layout.json``)
* ``analyze``     -- photo -> homography -> rectified swatch -> size, gauge, lattice
* ``texture``     -- periodicity (gauge) estimation from fabric texture
* ``synth``       -- synthetic photos with known ground truth (tests, notebook)
* ``records``     -- rows for the fitting CSV (``crolab.fitting`` input format)

See ``lab/swatch/README.md`` and ``lab/swatch/PROTOCOL.md``.
"""
