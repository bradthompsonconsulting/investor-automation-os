# PB-D15 Evidence Archive

Provenance record for the original inert-proof step-1 evidence files, preserved before the PB-D29 runner capture stage was implemented.

## Why these were preserved

PB-D29 specifies that runner stage evidence paths are derived rather than stored, and that existing evidence filenames are retained. Applying that derivation to the registry keys `arv` and `property_notes` reproduces the two working evidence filenames exactly. The capture stage therefore writes to the same paths as the original inert-proof runs and will overwrite them.

The originals were copied to a local external archive before capture was implemented.

## Archive location

`C:\Users\brad\Documents\IAOS Evidence\PB-D15 originals\`

This is a local directory on Brad's workstation. It is external to this repository and is not tracked, synced, or backed up by Git.

## Why the JSON itself is not committed

The evidence records contain production data — live contact IDs, tag lists, complete custom-field arrays with their values, and opportunity and pipeline IDs. Committing them would place that data permanently in Git history. Only this manifest is tracked.

## Records

### arv

- Original filename: `inert-proof-arv-step1.json`
- Original timestamp: 2026-07-28 10:57:19.980612200 -0500
- Archived filename: `inert-proof-arv-step1.original-2026-07-28.json`
- Byte count: 1066
- SHA-256: `6dd87465853b770f71605f866a45bef165cb8ad52951c2ac1608ae50bac6db25`

- Original filename: `inert-proof-arv-step2.json`
- Original timestamp: 2026-07-28 11:10:24.890176600 -0500
- Archived filename: `inert-proof-arv-step2.original-2026-07-28.json`
- Byte count: 2110
- SHA-256: `96f649d279f613de223e7886065cf26d0d160e40e2bcce85224a9936262ee598`

### property_notes

- Original filename: `inert-proof-property-notes-step1.json`
- Original timestamp: 2026-07-27 11:49:13.031923100 -0500
- Archived filename: `inert-proof-property-notes-step1.original-2026-07-27.json`
- Byte count: 1066
- SHA-256: `d8d9cc9e7587fcdaeb53ebe1d355720808279f8845ef97fd8dfefafda53b3330`

- Original filename: `inert-proof-property-notes-step2.json`
- Original timestamp: 2026-07-27 12:02:26.472033200 -0500
- Archived filename: `inert-proof-property-notes-step2.original-2026-07-27.json`
- Byte count: 2203
- SHA-256: `aa3aa3f10f5b6b3561ecdb23d86d3255ce9187020e6b97e970dc5c464b2b815e`

## Verification

All four source and archive pairs were confirmed byte-identical by SHA-256 comparison. The step-1 pairs were verified before capture was implemented. The step-2 pairs were verified after the write stage was implemented and before any write execution. The copy preserved the original modification times on the archive copies.
